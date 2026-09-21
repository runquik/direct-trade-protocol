/** Root-owned integration changes; requires review by a different implementer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { persistenceFixture } from './persistence-fixture.ts';

async function fixture() {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA);
  try { return { pg, ...await persistenceFixture(pgliteDb(pg)) }; }
  catch (e) { await pg.close(); throw e; }
}
test('finalization requires an explicit trusted deadline implementation', async () => {
  const f = await fixture(); try {
    const hooks: any = { ...f.hooks }; delete hooks.beforeCommit;
    assert.throws(() => createFoundationStore(f.db, { ...f.options, hooks }), /required local hook: beforeCommit/);
  } finally { await f.pg.close(); }
});
test('late grant expiry rolls back all business writes rather than trusting admission time', async () => {
  const f = await fixture(); try {
    const before = await f.counts(), authority = await f.authority(); let finalCalls = 0;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks,
      approveUsage: async (...args) => { const result = await f.hooks.approveUsage(...args); f.state.now = f.grant.expires_at; return result; },
      beforeCommit: async () => { finalCalls++; },
    } });
    await assert.rejects(store.execute(f.organization_id, f.request()), /grant inactive/);
    assert.deepEqual(await f.counts(), before); assert.deepEqual(await f.authority(), authority); assert.equal(finalCalls, 0);
  } finally { await f.pg.close(); }
});
test('last callback sees exact request and deadline, can abort writes, and runs on historical retries', async () => {
  const f = await fixture(); try {
    const request = f.request(), before = await f.counts(); let refuse = true; const modes: boolean[] = [];
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, beforeCommit: async (_tx, input) => {
      modes.push(input.replay); assert.deepEqual(input.request, request); assert.equal(input.valid_until, f.grant.expires_at);
      assert.ok(Object.isFrozen(input.request)); assert.equal(input.now, f.state.now);
      if (refuse) throw Error('synthetic expired credential');
    } } });
    await assert.rejects(store.execute(f.organization_id, request), /synthetic expired credential/); assert.deepEqual(await f.counts(), before);
    refuse = false; const receipt = await store.execute(f.organization_id, request), after = await f.counts();
    refuse = true; await assert.rejects(store.execute(f.organization_id, request), /synthetic expired credential/);
    refuse = false; assert.deepEqual(await store.execute(f.organization_id, request), receipt);
    assert.deepEqual(modes, [false, false, true, true]); assert.deepEqual(await f.counts(), after);
    assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('receipt retry cannot substitute a different grant even with identical actor and scope', async () => {
  const f = await fixture(); try {
    const request = f.request(); await f.store.execute(f.organization_id, request);
    const replacement = { ...f.grant, id: crypto.randomUUID() }; await f.store.govern(f.organization_id, { action: 'grant', grant: replacement }, f.controller);
    const counts = await f.counts(), authority = await f.authority(); request.grant_id = replacement.id;
    await assert.rejects(f.store.execute(f.organization_id, request), /operation ID conflict/);
    assert.deepEqual(await f.counts(), counts); assert.deepEqual(await f.authority(), authority);
  } finally { await f.pg.close(); }
});
test('regressed clock at finalization fails closed and late approval expiry rolls back', async () => {
  const f = await fixture(); try {
    const before = await f.counts(), now = f.state.now;
    const regressed = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, approveUsage: async (...args) => {
      const result = await f.hooks.approveUsage(...args); f.state.now--; return result;
    } } });
    await assert.rejects(regressed.execute(f.organization_id, f.request()), /clock regressed/); assert.deepEqual(await f.counts(), before);
    f.state.now = now;
    const approver = { kind: 'person' as const, id: crypto.randomUUID(), organization_id: null };
    const grant = { ...f.grant, id: crypto.randomUUID(), approval: { people: [approver], threshold: 1, exclude_actor: true } };
    await f.store.govern(f.organization_id, { action: 'grant', grant }, f.controller);
    const request = f.request(); request.grant_id = grant.id; const afterGrant = await f.counts();
    const expires = now + 100;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, approveUsage: async (_tx, input) => {
      const result = await f.hooks.approveUsage(_tx, input); f.state.now = expires;
      return { ...result, approvals: [{ person: approver, organization_id: f.organization_id, operation_id: input.verified.intent.operation_id,
        intent_digest: input.evaluation.intent_digest, plan_digest: input.plan_digest, grant_id: grant.id, expires_at: expires }] };
    } } });
    await assert.rejects(store.execute(f.organization_id, request), /exact live approval quorum/);
    assert.deepEqual(await f.counts(), afterGrant); assert.equal((await f.authority()).grants.find(g => g.grant.id === grant.id)!.used[0].amount, '0');
  } finally { await f.pg.close(); }
});
