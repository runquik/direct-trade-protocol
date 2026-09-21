import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { persistenceFixture } from './persistence-fixture.ts';

async function fixture(quantity = 10) {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA);
  try { return { pg, ...await persistenceFixture(pgliteDb(pg), quantity) }; } catch (e) { await pg.close(); throw e; }
}
async function rows(f: Awaited<ReturnType<typeof fixture>>) {
  const result: Record<string, unknown[]> = {};
  for (const table of ['organization_authority', 'entity_revisions', 'resource_heads', 'business_receipts', 'transactional_outbox', 'governance_history'])
    result[table] = await f.db.query(`select * from dtp_foundation.${table} where organization_id=$1 order by to_jsonb(${table})::text`, [f.organization_id]);
  return result;
}

test('independent finalization: exact exhausted budget is checked against original locked authority without a second charge', async () => {
  const f = await fixture(2); try {
    let calls = 0;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, beforeCommit: async (tx, input) => {
      calls++; assert.equal(input.authority.grants[0].used[0].amount, '0');
      const stored = (await tx.query<{ body: any }>('select body from dtp_foundation.organization_authority where organization_id=$1', [f.organization_id]))[0];
      assert.equal(stored.body.grants[0].used[0].amount, '2'); assert.equal(input.valid_until, f.grant.expires_at);
    } } });
    await store.execute(f.organization_id, f.request(2)); assert.equal(calls, 1); assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  } finally { await f.pg.close(); }
});

test('independent finalization: last hook failure after receipt insertion rolls back every exact row', async () => {
  const f = await fixture(); try {
    const before = await rows(f); let reached = false;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, beforeCommit: async (tx, input) => {
      const receipt = await tx.query('select body from dtp_foundation.business_receipts where organization_id=$1 and operation_id=$2', [f.organization_id, input.verified.intent.operation_id]);
      assert.equal(receipt.length, 1); reached = true; await tx.query('select 1/0');
    } } });
    await assert.rejects(store.execute(f.organization_id, f.request()), (e: any) => e.code === '22012'); assert.equal(reached, true); assert.deepEqual(await rows(f), before);
  } finally { await f.pg.close(); }
});

test('independent finalization: delegated expiry and exact-plan approval expiry bound the final deadline', async () => {
  const f = await fixture(); try {
    const approver = { kind: 'person' as const, id: crypto.randomUUID(), organization_id: null }, start = f.state.now;
    const parent = { ...f.grant, id: crypto.randomUUID(), delegation_depth: 1, expires_at: start + 500 };
    const child = { ...parent, id: crypto.randomUUID(), parent_id: parent.id, delegation_depth: 0, expires_at: start + 400,
      approval: { people: [approver], threshold: 1, exclude_actor: true } };
    await f.store.govern(f.organization_id, { action: 'grant', grant: parent }, f.controller); await f.store.govern(f.organization_id, { action: 'grant', grant: child }, f.controller);
    let lastDeadline = 0;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, approveUsage: async (tx, input) => ({ ...await f.hooks.approveUsage(tx, input), approvals: [{ person: approver,
      organization_id: f.organization_id, operation_id: input.verified.intent.operation_id, intent_digest: input.evaluation.intent_digest, plan_digest: input.plan_digest, grant_id: child.id, expires_at: start + 200 }] }),
      beforeCommit: async (_tx, input) => { lastDeadline = input.valid_until; assert.ok(Object.isFrozen(input.authority.grants[0])); assert.equal(input.verified.grant_id, child.id); }
    } });
    const request = f.request(); request.grant_id = child.id; await store.execute(f.organization_id, request); assert.equal(lastDeadline, start + 200);
    f.state.now = start + 250; await store.execute(f.organization_id, request); assert.equal(lastDeadline, start + 400, 'historical replay needs live grant but does not reapprove old business effects');
    assert.equal((await f.authority()).grants.find(g => g.grant.id === parent.id)!.used[0].amount, '2');
  } finally { await f.pg.close(); }
});

test('independent finalization: revoked permission discovered by final serialized hook aborts all provisional effects', async () => {
  const f = await fixture(); try {
    const before = await rows(f); let calls = 0;
    const store = createFoundationStore(f.db, { ...f.options, hooks: { ...f.hooks, approveUsage: async (...args) => {
      const result = await f.hooks.approveUsage(...args); f.state.liveAllowed = false; return result;
    }, beforeCommit: async (tx, input) => { calls++; await f.hooks.authorizeLive(tx, input); } } });
    await assert.rejects(store.execute(f.organization_id, f.request()), /live authority denied/); assert.equal(calls, 1); assert.deepEqual(await rows(f), before);
  } finally { await f.pg.close(); }
});
