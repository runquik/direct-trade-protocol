import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore, entityRevisionDigest } from '../../src/foundation/persistence.ts';
import { persistenceFixture, PROFILE } from './persistence-fixture.ts';

// Uses the declared synthetic-hook fixture to test persistence, never claims real authentication.
async function setup() {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA);
  try { return { pg, ...await persistenceFixture(pgliteDb(pg)) }; } catch (e) { await pg.close(); throw e; }
}
async function stored(db: Db, organization: string) {
  const result: Record<string, unknown[]> = {};
  for (const table of ['organization_authority', 'entity_revisions', 'resource_heads', 'business_receipts', 'transactional_outbox', 'governance_history']) {
    result[table] = await db.query(`select * from dtp_foundation.${table} where organization_id=$1 order by to_jsonb(${table})::text`, [organization]);
  }
  return result;
}
function afterWrite(db: Db, prefix: string): Db {
  return { query: (sql, args) => db.query(sql, args), transaction: action => db.transaction(tx => {
    const wrapped: Db = { query: async <T>(sql: string, args?: unknown[]) => {
      const rows = await tx.query<T>(sql, args); if (sql.startsWith(prefix)) await tx.query('select 1/0'); return rows;
    }, transaction: inner => inner(wrapped) }; return action(wrapped);
  }) };
}

test('independent persistence: actual SQL error after every write stage rolls back exact rows, not only counts', async () => {
  const f = await setup(); try {
    const before = await stored(f.db, f.organization_id);
    for (const prefix of ['update dtp_foundation.organization_authority', 'insert into dtp_foundation.entity_revisions', 'update dtp_foundation.resource_heads', 'insert into dtp_foundation.transactional_outbox', 'insert into dtp_foundation.business_receipts']) {
      const request = f.request(); await assert.rejects(createFoundationStore(afterWrite(f.db, prefix), f.options).execute(f.organization_id, request), (e: any) => e.code === '22012');
      assert.deepEqual(await stored(f.db, f.organization_id), before);
    }
    const request = f.request(), replacement = createFoundationStore(f.db, f.options); await replacement.execute(f.organization_id, request);
    assert.equal((await f.counts()).business_receipts, 1); assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});

test('independent persistence: failed governance outbox write does not revoke capability or partially advance authority', async () => {
  const f = await setup(); try {
    const before = await stored(f.db, f.organization_id), faulty = createFoundationStore(afterWrite(f.db, 'insert into dtp_foundation.transactional_outbox'), f.options);
    await assert.rejects(faulty.govern(f.organization_id, { action: 'revoke', grant_id: f.grant.id }, f.controller), (e: any) => e.code === '22012');
    assert.deepEqual(await stored(f.db, f.organization_id), before); await createFoundationStore(f.db, f.options).execute(f.organization_id, f.request());
    assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});

test('independent persistence: reused immutable revision IDs cannot rewind a resource or leave a charged receipt', async () => {
  const f = await setup(); try {
    await f.store.execute(f.organization_id, f.request()); const before = await stored(f.db, f.organization_id);
    const request = f.request(); (request.intent as any).parameters.next_revision_id = f.initial.revision.revision_id;
    await assert.rejects(f.store.execute(f.organization_id, request)); assert.deepEqual(await stored(f.db, f.organization_id), before);
  } finally { await f.pg.close(); }
});

test('independent persistence: old receipt retry never invokes evaluation/accounting but still denies each revoked live permission', async () => {
  const f = await setup(); try {
    const request = f.request(), receipt = await f.store.execute(f.organization_id, request), before = await stored(f.db, f.organization_id);
    const noAccounting = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, approveUsage: async () => { throw Error('receipt retry must not approve fresh usage'); } } });
    const calls = f.state.handlerCalls; assert.deepEqual(await noAccounting.execute(f.organization_id, request), receipt); assert.equal(f.state.handlerCalls, calls);
    for (const property of ['readAllowed', 'liveAllowed', 'profilesAllowed'] as const) {
      f.state[property] = false; await assert.rejects(noAccounting.execute(f.organization_id, request)); f.state[property] = true;
      assert.deepEqual(await stored(f.db, f.organization_id), before);
    }
    f.state.now = f.grant.expires_at; await assert.rejects(noAccounting.execute(f.organization_id, request), /grant inactive/); assert.deepEqual(await stored(f.db, f.organization_id), before);
  } finally { await f.pg.close(); }
});

test('independent persistence: signed-request attribution and SQL JSON physical objects survive fresh instance reads', async () => {
  const f = await setup(); try {
    const request = f.request(), original = structuredClone(request), receipt = await f.store.execute(f.organization_id, request);
    (request.intent as any).parameters.quantity = 999;
    const physical = await f.db.query<{ body: string; attribution: string; ref: string }>('select jsonb_typeof(body) as body,jsonb_typeof(attribution) as attribution,jsonb_typeof(exact_ref) as ref from dtp_foundation.entity_revisions where organization_id=$1', [f.organization_id]);
    assert.ok(physical.length > 0); assert.ok(physical.every(x => x.body === 'object' && x.attribution === 'object' && x.ref === 'object'));
    const row = (await f.db.query<{ body: any }>('select body from dtp_foundation.business_receipts where organization_id=$1 and operation_id=$2', [f.organization_id, receipt.operation_id]))[0];
    assert.deepEqual(row.body.original_signed_request, original); assert.deepEqual(await createFoundationStore(f.db, f.options).execute(f.organization_id, original), receipt);
    const head = (await f.db.query<{ exact_ref: any; profile_digest: string }>('select exact_ref,profile_digest from dtp_foundation.resource_heads where organization_id=$1', [f.organization_id]))[0];
    assert.equal(head.profile_digest, PROFILE); assert.deepEqual(head.exact_ref, receipt.revisions.find(r => r.entity.kind === 'resource'));
  } finally { await f.pg.close(); }
});

test('independent persistence: authorization denial prevents private inputs reaching the admitted handler', async () => {
  const f = await setup(); try {
    const before = await stored(f.db, f.organization_id), foreign = await persistenceFixture(f.db), request = f.request(); (request.intent as any).inputs = [foreign.initial.revision];
    const restricted = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, authorizeRead: async (_tx, input) => {
      assert.ok(input.revisions.every(r => r.entity.organization_id === f.organization_id), 'foreign input unauthorized');
    } } });
    await assert.rejects(restricted.execute(f.organization_id, request), /foreign input unauthorized/); assert.equal(f.state.handlerCalls, 0);
    assert.deepEqual(await stored(f.db, f.organization_id), before); assert.equal((await foreign.authority()).grants[0].used[0].amount, '0');
  } finally { await f.pg.close(); }
});

test('independent persistence: native SHA256 of fixed canonical bytes agrees with revision-domain digest', async () => {
  const entity = { kind: 'resource' as const, id: '11111111-1111-1111-1111-111111111111', organization_id: '22222222-2222-2222-2222-222222222222' }, revision = '33333333-3333-3333-3333-333333333333';
  const bytes = '{"body":{"quantity":10},"domain":"DTP-ENTITY-REVISION-1","entity":{"id":"11111111-1111-1111-1111-111111111111","kind":"resource","organization_id":"22222222-2222-2222-2222-222222222222"},"profile_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision_id":"33333333-3333-3333-3333-333333333333"}';
  const expected = createHash('sha256').update(bytes, 'utf8').digest('hex'); assert.equal(expected, 'e5fa7cf9eaac9cdf96fbf4a1172f7a975a524fca326ac8af51807ea5f39aca59');
  assert.equal(await entityRevisionDigest(entity, revision, PROFILE, { quantity: 10 }), expected);
  await assert.rejects(entityRevisionDigest(entity, revision, PROFILE, { quantity: 1.5 }));
});
