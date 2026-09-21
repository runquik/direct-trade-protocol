import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { canonicalize, sha256Hex } from '../../src/canonical.ts';
import type { OperationIntent } from '../../src/foundation/semantics.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore, entityRevisionDigest } from '../../src/foundation/persistence.ts';
import { persistenceFixture, PROFILE } from './persistence-fixture.ts';

async function setup(initial = 10, prerequisites: string[] = []) {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA);
  try { return { pg, ...await persistenceFixture(pgliteDb(pg), initial, prerequisites) }; }
  catch (e) { await pg.close(); throw e; }
}
test('semantic execution commits exact revisions, authority charge, attribution, receipt and outbox together', async () => {
  const f = await setup(); try {
    const request = f.request(2), receipt = await f.store.execute(f.organization_id, request);
    assert.equal(receipt.revisions.length, 2);
    assert.equal((await f.authority()).grants[0].used[0].amount, '2');
    assert.deepEqual(await f.counts(), { entity_revisions: 3, resource_heads: 1, business_receipts: 1, transactional_outbox: 4, governance_history: 2 });
    const revisions = await f.db.query<{ exact_ref: any; profile_digest: string; body: any; attribution: any }>('select exact_ref,profile_digest,body,attribution from dtp_foundation.entity_revisions where organization_id=$1', [f.organization_id]);
    for (const row of revisions) assert.equal(row.exact_ref.digest, await entityRevisionDigest(row.exact_ref.entity, row.exact_ref.revision_id, row.profile_digest, row.body));
    const effect = revisions.find(r => r.attribution.kind === 'host_effect')!;
    assert.deepEqual(effect.attribution.original_signed_request, request);
    assert.equal(effect.attribution.plan_digest, receipt.plan_digest);
    assert.equal(Object.hasOwn(effect.attribution, 'user_signature_over_effect'), false);
    assert.deepEqual(revisions.find(r => r.attribution.kind === 'imported_original')!.attribution.original_signed_record, f.initial.original_signed_record);
  } finally { await f.pg.close(); }
});
test('lost response/restarted host exact retry returns original receipt without reevaluation or double charge', async () => {
  const f = await setup(); try {
    const first = f.request(2), receipt = await f.store.execute(f.organization_id, first);
    await f.store.execute(f.organization_id, f.request(3));
    const before = await f.counts(), calls = [f.state.handlerCalls, f.state.accountingCalls];
    const replacement = createFoundationStore(f.db, f.options);
    assert.deepEqual(await replacement.execute(f.organization_id, first), receipt);
    assert.deepEqual(await f.counts(), before); assert.deepEqual([f.state.handlerCalls, f.state.accountingCalls], calls);
    assert.equal((await f.authority()).grants[0].used[0].amount, '5');
    const conflict = structuredClone(first); (conflict.intent as any).parameters.quantity = 1;
    await assert.rejects(replacement.execute(f.organization_id, conflict), /operation ID conflict/);
  } finally { await f.pg.close(); }
});
test('old receipts are not disclosed after read, live mandate, profile or grant revocation', async () => {
  const f = await setup(); try {
    const request = f.request(); await f.store.execute(f.organization_id, request);
    f.state.readAllowed = false; await assert.rejects(f.store.execute(f.organization_id, request), /read policy denied/); f.state.readAllowed = true;
    f.state.liveAllowed = false; await assert.rejects(f.store.execute(f.organization_id, request), /live authority denied/); f.state.liveAllowed = true;
    f.state.profilesAllowed = false; await assert.rejects(f.store.execute(f.organization_id, request), /profile use denied/); f.state.profilesAllowed = true;
    await f.store.govern(f.organization_id, { action: 'revoke', grant_id: f.grant.id }, f.controller);
    await assert.rejects(f.store.execute(f.organization_id, request), /grant inactive/);
    assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('failures at each persistence stage roll back heads, immutable history, budgets, receipts and outbox', async () => {
  const f = await setup(); try {
    const before = await f.counts(), authority = await f.authority();
    for (const prefix of ['update dtp_foundation.organization_authority', 'insert into dtp_foundation.entity_revisions', 'update dtp_foundation.resource_heads', 'insert into dtp_foundation.transactional_outbox', 'insert into dtp_foundation.business_receipts']) {
      const failing: Db = { ...f.db, transaction: fn => f.db.transaction(tx => fn({ ...tx, query: async (sql, params) => { if (sql.startsWith(prefix)) throw new Error('synthetic fault'); return tx.query(sql, params); } })) };
      await assert.rejects(createFoundationStore(failing, f.options).execute(f.organization_id, f.request()), /synthetic fault/);
      assert.deepEqual(await f.counts(), before); assert.deepEqual(await f.authority(), authority);
    }
  } finally { await f.pg.close(); }
});
test('concurrent accepted commands cannot overallocate and exact concurrent retries allocate once', async () => {
  const f = await setup(); try {
    const results = await Promise.allSettled([f.store.execute(f.organization_id, f.request(6)), f.store.execute(f.organization_id, f.request(6))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const request = f.request(2), receipts = await Promise.all([f.store.execute(f.organization_id, request), f.store.execute(f.organization_id, request)]);
    assert.deepEqual(receipts[0], receipts[1]); assert.equal((await f.authority()).grants[0].used[0].amount, '8');
    assert.equal((await f.counts()).business_receipts, 2);
  } finally { await f.pg.close(); }
});
test('organization authority and indexed reference scope cannot widen through intent or governance', async () => {
  const f = await setup(); try {
    const other = await persistenceFixture(f.db), request = f.request();
    (request.intent as any).inputs = [other.initial.revision];
    const denied = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, authorizeRead: async (_tx, input) => {
      assert.ok(input.revisions.every(r => r.entity.organization_id === f.organization_id), 'origin read denied');
    } } });
    await assert.rejects(denied.execute(f.organization_id, request), /origin read denied/);
    const approved = await f.store.execute(f.organization_id, request);
    const stored = (await f.db.query<{ body: any }>('select body from dtp_foundation.business_receipts where organization_id=$1 and operation_id=$2', [f.organization_id, approved.operation_id]))[0].body;
    assert.deepEqual(stored.verified.intent.inputs, [other.initial.revision]);
    assert.equal((await other.authority()).grants[0].used[0].amount, '0');
    const resourceRequest = f.request(); (resourceRequest.intent as any).resources = [other.resource];
    await assert.rejects(f.store.execute(f.organization_id, resourceRequest), /resource scope mismatch/);
    await assert.rejects(f.store.govern(f.organization_id, { action: 'grant', grant: other.grant }, f.controller), /grant organization mismatch/);
    const one = f.request(), two = other.request(); (two.intent as any).operation_id = (one.intent as any).operation_id;
    await f.store.execute(f.organization_id, one); await other.store.execute(other.organization_id, two);
    assert.equal((await f.authority()).grants[0].used[0].amount, '4');
    assert.equal((await other.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('unadmitted semantics and additional prerequisite grants fail closed before effects', async () => {
  const f = await setup(10, ['stock.consume', 'order.approve']); try {
    await assert.rejects(f.store.execute(f.organization_id, f.request()), /prerequisite grants/);
    const request = f.request(); (request.intent as any).handler_digest = 'c'.repeat(64);
    await assert.rejects(f.store.execute(f.organization_id, request), /semantic pins/);
    assert.equal(f.state.handlerCalls, 0); assert.equal((await f.counts()).business_receipts, 0);
  } finally { await f.pg.close(); }
});
test('immutable imports are verified, preserved and cannot bypass an existing resource head or record entity', async () => {
  const f = await setup(); try {
    const overwrite = structuredClone(f.initial); overwrite.revision.revision_id = crypto.randomUUID();
    overwrite.revision.digest = await entityRevisionDigest(overwrite.revision.entity, overwrite.revision.revision_id, PROFILE, overwrite.body);
    overwrite.original_signed_record = { revision: overwrite.revision as any, profile_digest: PROFILE, body: overwrite.body, signature: 'synthetic-original' };
    await assert.rejects(f.store.importRevision(f.organization_id, overwrite, f.controller), /cannot append/);
    const fake = structuredClone(f.initial); fake.revision.entity.id = crypto.randomUUID();
    await assert.rejects(f.store.importRevision(f.organization_id, fake, f.controller));
    const request = f.request(), recordId = (request.intent as any).parameters.record_id;
    const importedRecord = structuredClone(f.initial); importedRecord.revision.entity = { kind: 'record', id: recordId, organization_id: f.organization_id };
    importedRecord.revision.digest = await entityRevisionDigest(importedRecord.revision.entity, importedRecord.revision.revision_id, PROFILE, importedRecord.body);
    importedRecord.original_signed_record = { revision: importedRecord.revision as any, profile_digest: PROFILE, body: importedRecord.body, signature: 'synthetic-original' };
    await f.store.importRevision(f.organization_id, importedRecord, f.controller);
    const before = await f.counts(); await assert.rejects(f.store.execute(f.organization_id, request), /new entity/);
    assert.deepEqual(await f.counts(), before); assert.equal((await f.authority()).grants[0].used[0].amount, '0');
  } finally { await f.pg.close(); }
});
test('caller and callback mutation cannot change an authenticated intent or plan during awaits', async () => {
  const f = await setup(); try {
    const request = f.request(2), original = structuredClone(request);
    const options = { ...f.options, hooks: { ...f.hooks, authenticateOperation: async (...args: Parameters<typeof f.hooks.authenticateOperation>) => {
      (request.intent as any).parameters.quantity = 9;
      assert.throws(() => { ((args[1].request.intent as any).parameters).quantity = 8; }, TypeError);
      return f.hooks.authenticateOperation(...args);
    }, approveUsage: async (...args: Parameters<typeof f.hooks.approveUsage>) => {
      assert.throws(() => { args[1].evaluation.plan.effects[0].body.quantity = 0; }, TypeError);
      return f.hooks.approveUsage(...args);
    } } };
    const receipt = await createFoundationStore(f.db, options).execute(f.organization_id, request);
    const rows = await f.db.query<{ body: any }>('select body from dtp_foundation.business_receipts where organization_id=$1', [f.organization_id]);
    assert.deepEqual(rows[0].body.original_signed_request, original); assert.equal((await f.authority()).grants[0].used[0].amount, '2');
    assert.equal(receipt.revisions.length, 2);
  } finally { await f.pg.close(); }
});
test('closed bounded requests refuse unsafe containers/accessors and missing trusted hooks', async () => {
  const f = await setup(); try {
    for (const request of [[], new Date(), JSON.parse('{"__proto__":1}'), { get intent() { throw Error('getter executed'); } }, { value: 'x'.repeat(262145) }, { value: 1.25 }])
      await assert.rejects(f.store.execute(f.organization_id, request as any), /JSON|object|property|integer/);
    assert.throws(() => createFoundationStore(f.db, { ...f.options, hooks: {} as any }), /required local hook/);
    assert.equal((await f.counts()).business_receipts, 0);
  } finally { await f.pg.close(); }
});
test('sibling delegated operations share their parent cumulative budget in the same atomic commit', async () => {
  const f = await setup(20); try {
    const parent = { ...f.grant, id: crypto.randomUUID(), delegation_depth: 1, limits: [{ metric: f.metric, amount: '5' }] };
    await f.store.govern(f.organization_id, { action: 'grant', grant: parent }, f.controller);
    const children = [0, 1].map(() => ({ ...parent, id: crypto.randomUUID(), parent_id: parent.id, delegation_depth: 0 }));
    for (const grant of children) await f.store.govern(f.organization_id, { action: 'grant', grant }, f.controller);
    const a = f.request(3), b = f.request(3); a.grant_id = children[0].id; b.grant_id = children[1].id;
    await f.store.execute(f.organization_id, a); const before = await f.counts();
    await assert.rejects(f.store.execute(f.organization_id, b), /cumulative grant budget/);
    assert.deepEqual(await f.counts(), before);
    const good = f.request(2); good.grant_id = children[1].id; await f.store.execute(f.organization_id, good);
    const authority = await f.authority();
    assert.equal(authority.grants.find(g => g.grant.id === parent.id)!.used[0].amount, '5');
    assert.equal(authority.grants.find(g => g.grant.id === children[1].id)!.used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('an approval for the same intent but stale evaluated resource plan fails until reapproved', async () => {
  const f = await setup(); try {
    const approver = { kind: 'person' as const, id: crypto.randomUUID(), organization_id: null };
    const grant = { ...f.grant, id: crypto.randomUUID(), approval: { people: [approver], threshold: 1, exclude_actor: true } };
    await f.store.govern(f.organization_id, { action: 'grant', grant }, f.controller);
    const request = f.request(2); request.grant_id = grant.id;
    const intent = request.intent as unknown as OperationIntent;
    const initialPlan = await f.options.semantics.evaluateAuthorized({ intent, authorized_inputs: [], snapshots: [{ resource: f.resource, profile_digest: PROFILE, current_revision: f.initial.revision, body: f.initial.body }], accepted_at: new Date(f.state.now).toISOString() });
    const staleDigest = await sha256Hex(canonicalize(initialPlan.plan));
    await f.store.execute(f.organization_id, f.request(1));
    let freshApproval = false;
    const options = { ...f.options, hooks: { ...f.hooks, approveUsage: async (...args: Parameters<typeof f.hooks.approveUsage>) => ({
      ...(await f.hooks.approveUsage(...args)), approvals: [{ person: approver, organization_id: f.organization_id, operation_id: intent.operation_id,
        intent_digest: args[1].evaluation.intent_digest, plan_digest: freshApproval ? args[1].plan_digest : staleDigest, grant_id: grant.id, expires_at: f.state.now + 1000 }],
    }) } };
    const store = createFoundationStore(f.db, options), before = await f.counts();
    await assert.rejects(store.execute(f.organization_id, request), /exact live approval quorum/);
    assert.deepEqual(await f.counts(), before);
    freshApproval = true; await store.execute(f.organization_id, request);
    assert.equal((await f.authority()).grants.find(g => g.grant.id === grant.id)!.used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('resource revision CAS is rechecked after trusted asynchronous admission work and failures roll back', async () => {
  const f = await setup(); try {
    const before = await f.counts(), options = { ...f.options, hooks: { ...f.hooks, approveUsage: async (...args: Parameters<typeof f.hooks.approveUsage>) => {
      // Fault-injection only: a trusted adapter modifies a read dependency in this transaction.
      await args[0].query('update dtp_foundation.resource_heads set exact_ref=$3::text::jsonb where organization_id=$1 and resource_id=$2', [f.organization_id, f.resource.id, JSON.stringify({ ...f.initial.revision, digest: 'f'.repeat(64) })]);
      return f.hooks.approveUsage(...args);
    } } };
    await assert.rejects(createFoundationStore(f.db, options).execute(f.organization_id, f.request()), /resource CAS conflict/);
    assert.deepEqual(await f.counts(), before); assert.equal((await f.authority()).grants[0].used[0].amount, '0');
    const rows = await f.db.query<{ exact_ref: any }>('select exact_ref from dtp_foundation.resource_heads where organization_id=$1 and resource_id=$2', [f.organization_id, f.resource.id]);
    assert.deepEqual(rows[0].exact_ref, f.initial.revision);
  } finally { await f.pg.close(); }
});
test('DTP-ENTITY-REVISION-1 canonical preimage pins body, scope, revision and profile without signing attribution', async () => {
  const entity = { kind: 'resource' as const, id: '11111111-1111-1111-1111-111111111111', organization_id: '22222222-2222-2222-2222-222222222222' }, revision = '33333333-3333-3333-3333-333333333333';
  const preimage = { domain: 'DTP-ENTITY-REVISION-1', entity, revision_id: revision, profile_digest: PROFILE, body: { quantity: 10 } };
  assert.equal(canonicalize(preimage), '{"body":{"quantity":10},"domain":"DTP-ENTITY-REVISION-1","entity":{"id":"11111111-1111-1111-1111-111111111111","kind":"resource","organization_id":"22222222-2222-2222-2222-222222222222"},"profile_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision_id":"33333333-3333-3333-3333-333333333333"}');
  const digest = await entityRevisionDigest(entity, revision, PROFILE, { quantity: 10 });
  assert.equal(digest, 'e5fa7cf9eaac9cdf96fbf4a1172f7a975a524fca326ac8af51807ea5f39aca59');
  assert.notEqual(await entityRevisionDigest(entity, revision, PROFILE, { quantity: 0 }), digest);
  assert.notEqual(await entityRevisionDigest({ ...entity, organization_id: '44444444-4444-4444-4444-444444444444' }, revision, PROFILE, { quantity: 10 }), digest);
});
