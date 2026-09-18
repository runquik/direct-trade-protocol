/** Real server COMMIT probes; no PGlite fallback, no production policy or service authentication claim. */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { postgresJsDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { issueResolution } from '../../src/foundation/identity.ts';
import { persistenceFixture } from '../foundation/persistence-fixture.ts';
import type { OperationIntent } from '../../src/foundation/semantics.ts';
import { personReviewFixture, asJson } from '../foundation/person-authentication-review-fixture.ts';
let sql: ReturnType<typeof postgres>, db: Db;
before(async () => {
  const connection = process.env.DTP_FOUNDATION_TEST_DATABASE_URL ?? 'postgres://dtp_test:synthetic-dtp-local-only@127.0.0.1:15439/dtp_foundation_tests', url = new URL(connection);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol)); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '15439'); assert.equal(url.pathname, '/dtp_foundation_tests'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  sql = postgres(connection, { max: 8, connect_timeout: 5, onnotice: () => {}, connection: { statement_timeout: 15000 } }); db = postgresJsDb(sql);
  assert.equal((await db.query<{ version: string }>("select current_setting('server_version_num') as version"))[0].version, '170011');
  await sql.unsafe(FOUNDATION_STORE_SCHEMA); await sql.unsafe(PERSON_AUTHENTICATION_SCHEMA);
}, { timeout: 15000 });
after(async () => { await sql?.end({ timeout: 5 }); });

async function rows(organization: string) {
  const values: Record<string, unknown[]> = {};
  for (const table of ['organization_authority', 'entity_revisions', 'resource_heads', 'business_receipts', 'transactional_outbox', 'governance_history'])
    values[table] = await db.query(`select * from dtp_foundation.${table} where organization_id=$1 order by to_jsonb(${table})::text`, [organization]);
  return values;
}

test('person PostgreSQL independent: deferred SQL guard rejects COMMIT after JS tail returns past actual deadline', { timeout: 20000 }, async () => {
  const f = await personReviewFixture(db), request = await f.request(), before = await rows(f.organization_id); let callbackReturned = false;
  const store = createFoundationStore(db, { ...f.storeOptions, hooks: { ...f.storeOptions.hooks, beforeCommit: async (tx, input) => {
    const deadline = Date.now() + 6000; await f.auth.beforeCommit(tx, { ...input, now: Date.now(), valid_until: deadline });
    const challenge = (await tx.query<{ deadline_ms: string }>('select deadline_ms from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.host_id, request.authentication.challenge.nonce]))[0];
    assert.equal(Number(challenge.deadline_ms), deadline);
    await new Promise(resolve => setTimeout(resolve, 6500)); callbackReturned = true;
  } } });
  await assert.rejects(store.execute(f.organization_id, asJson(request)), /deadline expired before commit/); assert.equal(callbackReturned, true, 'failure must occur after the JS callback completed');
  assert.deepEqual(await rows(f.organization_id), before); assert.equal((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null);
  assert.deepEqual(await db.query('select person_id from dtp_foundation.person_auth_checkpoints where host_id=$1', [f.host_id]), []);
  await createFoundationStore(db, f.storeOptions).execute(f.organization_id, asJson(request)); assert.equal((await f.counts()).business_receipts, 1);
});

test('person PostgreSQL independent: two identical signed requests consume one challenge and commit one business effect', { timeout: 15000 }, async () => {
  const f = await personReviewFixture(db), request = await f.request();
  const outcomes = await Promise.allSettled([f.store.execute(f.organization_id, asJson(request)), createFoundationStore(db, f.storeOptions).execute(f.organization_id, asJson(request))]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(r => r.status === 'rejected').length, 1);
  assert.match((outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message, /already consumed/);
  assert.equal((await f.counts()).business_receipts, 1); assert.equal((await f.authority()).grants.find(g => g.grant.id === f.grant.id)!.used[0].amount, '2');
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.person_auth_challenges where host_id=$1 and consumed_at is not null', [f.host_id]))[0].n, 1);
});

test('person PostgreSQL independent: one durable person checkpoint serializes authentication across different organizations', { timeout: 15000 }, async () => {
  const f = await personReviewFixture(db); await f.store.execute(f.organization_id, asJson(await f.request()));
  const other = await persistenceFixture(db); other.state.now = Date.now();
  const grant = { ...other.grant, id: crypto.randomUUID(), subject: f.actor, not_before: Date.now() - 1000, expires_at: Date.now() + 120000 };
  await other.store.govern(other.organization_id, { action: 'grant', grant }, other.controller);
  const intent = other.request().intent as unknown as OperationIntent;
  const c = await db.transaction(tx => f.auth.issueChallenge(tx, { organization_id: other.organization_id, person_id: f.actor.id, intent, grant_id: grant.id }));
  const proof = (await issueResolution(f.identity, { identity_id: f.actor.id, audience: f.audience, challenge: c.nonce }, f.resolver, Date.now())).proof;
  const request = await signPersonOperation({ intent, actor: f.actor, grant_id: grant.id, challenge: c, resolution: proof }, [f.operational]);
  let release!: () => void, entered!: () => void; const barrier = new Promise<void>(r => { release = r; }), reached = new Promise<void>(r => { entered = r; });
  const lock = db.transaction(async tx => { await tx.query('select sequence from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2 for update', [f.host_id, f.actor.id]); entered(); await barrier; }); void lock.catch(() => {});
  const marker = `person_scope_${crypto.randomUUID().replaceAll('-', '')}`;
  const marked: Db = { query: (q, p) => db.query(q, p), transaction: fn => db.transaction(tx => {
    const wrapped: Db = { query: (q, p) => tx.query(q.includes('person_auth_checkpoints') ? `${q} /* ${marker} */` : q, p), transaction: inner => inner(wrapped) }; return fn(wrapped);
  }) };
  let execution: Promise<unknown> | undefined, settled = false;
  try {
    await reached;
    const store = createFoundationStore(marked, { ...other.options, now: Date.now, hooks: { ...other.hooks, authenticateOperation: f.auth.authenticateOperation, beforeCommit: f.auth.beforeCommit } });
    execution = store.execute(other.organization_id, asJson(request)); void execution.then(() => { settled = true; }, () => { settled = true; });
    const end = Date.now() + 3000; let observed = false;
    while (Date.now() < end) {
      const waiting = await db.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname='dtp_foundation_tests' and query like $1 and wait_event_type='Lock'", [`%${marker}%`]);
      if (waiting[0].n > 0) { observed = true; break; } await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(observed, true, 'second organization must contend on the same person row at the server'); assert.equal(settled, false);
    // Normal queued work must not confuse elapsed lock wait with mismatched wall clocks.
    await new Promise(r => setTimeout(r, 1250));
    release(); await lock; await execution;
    assert.equal((await other.counts()).business_receipts, 1);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.host_id, f.actor.id]))[0].n, 1);
  } finally { release(); await Promise.allSettled([lock, ...(execution ? [execution] : [])]); }
});
