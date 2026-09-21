// Real PostgreSQL only. Isolated loopback database; never drop/truncate existing data.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { postgresJsDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity, LEASE_MS, CLOCK_MARGIN_MS, verifyResolution } from '../../src/foundation/identity.ts';
import type { Transition, IdentityState } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';

let sql: ReturnType<typeof postgres>, db: Db;
const application = `dtp-foundation-review-${crypto.randomUUID()}`;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('expected PostgreSQL boundary timed out')), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function waiting(marker: string) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await db.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where application_name=$1 and query like $2 and wait_event_type=$3', [application, `%${marker}%`, 'Lock']);
    if (rows[0].n > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('competing transaction never reached a PostgreSQL lock wait');
}
function observed(base: Db, hooks: { marker?: string; afterQuery?: (text: string) => Promise<void> }): Db {
  return { query: (q, p) => base.query(q, p), transaction: fn => base.transaction(tx => {
    const wrap: Db = { query: async <T>(q: string, p?: unknown[]) => {
      const query = hooks.marker && q.endsWith('for update') ? `${q} /* ${hooks.marker} */` : q;
      const rows = await tx.query<T>(query, p); await hooks.afterQuery?.(q); return rows;
    }, transaction: inner => inner(wrap) }; return fn(wrap);
  }) };
}

before(async () => {
  const connection = process.env.DTP_FOUNDATION_TEST_DATABASE_URL ?? 'postgres://dtp_test:synthetic-dtp-local-only@127.0.0.1:15439/dtp_foundation_tests';
  const url = new URL(connection);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'only explicit loopback PostgreSQL allowed');
  assert.equal(url.pathname, '/dtp_foundation_tests', 'refuses Supabase, old release and other databases');
  assert.equal(url.search, '', 'connection overrides prohibited'); assert.equal(url.hash, '', 'connection fragments prohibited');
  sql = postgres(connection, { max: 12, connect_timeout: 5, connection: { statement_timeout: 15000, application_name: application } }); db = postgresJsDb(sql);
  const server = (await db.query<{ version: string; database: string }>('select version() as version,current_database() as database'))[0];
  assert.match(server.version, /^PostgreSQL /); assert.equal(server.database, 'dtp_foundation_tests');
  // CREATE IF NOT EXISTS is additive; unique fixture identities never replace prior rows.
  await sql.unsafe(IDENTITY_REGISTRY_SCHEMA);
}, { timeout: 15000 });
after(async () => { await sql?.end({ timeout: 5 }); });

async function fixture() {
  const [person, recovery, resolver, next, alternate] = await Promise.all(Array.from({ length: 5 }, generateKeyPair));
  let now = 1_800_000_000_000;
  const config = { id: crypto.randomUUID(), audience: 'https://postgres-resolver.example', key: resolver, now: () => now };
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [person.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 } }, [person, recovery]);
  const initial = await createIdentity(genesis, { id: config.id, key_id: resolver.keyId }, now);
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: initial.head.identity_id, genesis_digest: initial.genesis_digest,
    resolver_id: config.id, resolver_key: resolver.keyId, audience: config.audience, nonce: 'a'.repeat(64), issued_at: now, expires_at: now + 300000 }, [person, recovery]);
  const registry = createIdentityRegistry(db, config), identity = initial.head.identity_id;
  const command = (kind: 'rotate' | 'recover', newKey = next) => signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', {
    identity_id: identity, expected_digest: initial.head_digest, sequence: 1, kind, operational: { keys: [newKey.keyId], threshold: 1 }, recovery: initial.head.recovery, issued_at: now, expires_at: now + 300000,
  }, [kind === 'rotate' ? person : recovery, newKey]);
  const request = { identity_id: identity, audience: 'https://postgres-company.example', challenge: 'b'.repeat(64) };
  const row = () => db.query<{ body: IdentityState; revision: string }>('select body,revision from dtp_foundation.identities where identity_id=$1', [identity]);
  const history = () => db.query('select * from dtp_foundation.identity_history where identity_id=$1 order by sequence', [identity]);
  return { person, recovery, resolver, next, alternate, config, initial, identity, genesis, enrollment, registry, command, request, row, history, get now() { return now; }, advance: (ms: number) => { now += ms; } };
}

async function assertPhysicalJsonObjects(identity: string, expectedHistory: number, expectedResults: number) {
  const identityTypes = await db.query<{ shape: string }>('select jsonb_typeof(body) as shape from dtp_foundation.identities where identity_id=$1', [identity]);
  assert.deepEqual(identityTypes, [{ shape: 'object' }], 'identity JSONB must be a physical object, not an adapter-decoded scalar string');
  const historyTypes = await db.query<{ body_shape: string; result_shape: string | null }>('select jsonb_typeof(body) as body_shape,jsonb_typeof(result) as result_shape from dtp_foundation.identity_history where identity_id=$1 order by sequence', [identity]);
  assert.equal(historyTypes.length, expectedHistory);
  assert.ok(historyTypes.every(row => row.body_shape === 'object'), 'every stored signed history body must be a physical JSONB object');
  const resultTypes = historyTypes.filter(row => row.result_shape !== null);
  assert.equal(resultTypes.length, expectedResults);
  assert.ok(resultTypes.every(row => row.result_shape === 'object'), 'every nonnull accepted receipt must be a physical JSONB object');
}

test('foundation PostgreSQL: eight concurrent exact enrollments commit one identity/history', { timeout: 20000 }, async () => {
  const f = await fixture();
  const receipts = await Promise.all(Array.from({ length: 8 }, () => createIdentityRegistry(db, f.config).enroll(f.genesis, f.enrollment)));
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
  assert.equal((await f.row()).length, 1); assert.equal((await f.history()).length, 1);
  await assertPhysicalJsonObjects(f.identity, 1, 0);
  const different = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { ...f.enrollment.body, nonce: 'c'.repeat(64) }, [f.person, f.recovery]);
  await assert.rejects(f.registry.enroll(f.genesis, different), /conflict/);
});

test('foundation PostgreSQL: competing operational rotation and recovery have one CAS winner', { timeout: 20000 }, async () => {
  const f = await fixture(); await f.registry.enroll(f.genesis, f.enrollment);
  const [rotation, recovery] = await Promise.all([f.command('rotate'), f.command('recover', f.alternate)]);
  const results = await Promise.allSettled([f.registry.transition(f.identity, rotation), f.registry.transition(f.identity, recovery)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const winner = results[0].status === 'fulfilled' ? f.next : f.alternate;
  assert.deepEqual((await f.row())[0].body.head.operational.keys, [winner.keyId]); assert.equal((await f.history()).length, 2);
  await assertPhysicalJsonObjects(f.identity, 2, 1);
});

test('foundation PostgreSQL: lease issuance ahead of queued transition persists its full drain barrier', { timeout: 20000 }, async () => {
  const f = await fixture(); await f.registry.enroll(f.genesis, f.enrollment);
  const entered = deferred(), release = deferred(), marker = `lease_first_${crypto.randomUUID().replaceAll('-', '')}`;
  const held = createIdentityRegistry(observed(db, { afterQuery: async q => { if (q.endsWith('for update')) { entered.resolve(); await release.promise; } } }), f.config);
  const leasing = held.resolve(f.request); void leasing.catch(() => {});
  let transition: ReturnType<typeof f.registry.transition> | undefined;
  try {
    await bounded(entered.promise);
    transition = createIdentityRegistry(observed(db, { marker }), f.config).transition(f.identity, await f.command('recover')); void transition.catch(() => {});
    await waiting(marker); release.resolve();
    const proof = await leasing, accepted = await transition;
    assert.equal(proof.body.head.sequence, 0); assert.equal(accepted.effective_at, proof.body.expires_at + CLOCK_MARGIN_MS);
    assert.equal((await f.row())[0].body.last_lease_expiry, f.now + LEASE_MS);
    await assert.rejects(f.registry.resolve(f.request), /barrier/);
    f.advance(LEASE_MS + CLOCK_MARGIN_MS);
    const fresh = await f.registry.resolve({ ...f.request, challenge: 'd'.repeat(64) });
    assert.equal((await verifyResolution(fresh, { ...f.request, challenge: 'd'.repeat(64), resolver_id: f.config.id, resolver_key: f.resolver.keyId, resolver_epoch: 0, minimum_sequence: 1, minimum_digest: accepted.head_digest }, f.now)).sequence, 1);
  } finally { release.resolve(); await Promise.allSettled([leasing, ...(transition ? [transition] : [])]); }
});

test('foundation PostgreSQL: transition ahead of queued resolution cannot issue another old-head lease', { timeout: 20000 }, async () => {
  const f = await fixture(); await f.registry.enroll(f.genesis, f.enrollment);
  const entered = deferred(), release = deferred(), marker = `transition_first_${crypto.randomUUID().replaceAll('-', '')}`;
  const held = createIdentityRegistry(observed(db, { afterQuery: async q => { if (q.startsWith('update dtp_foundation.identities')) { entered.resolve(); await release.promise; } } }), f.config);
  const transition = held.transition(f.identity, await f.command('rotate')); void transition.catch(() => {});
  let leasing: ReturnType<typeof f.registry.resolve> | undefined;
  try {
    await bounded(entered.promise); leasing = createIdentityRegistry(observed(db, { marker }), f.config).resolve(f.request); void leasing.catch(() => {});
    await waiting(marker); release.resolve(); await transition;
    await assert.rejects(leasing, /barrier/); assert.equal((await f.row())[0].body.last_lease_expiry, f.now);
  } finally { release.resolve(); await Promise.allSettled([transition, ...(leasing ? [leasing] : [])]); }
});

test('foundation PostgreSQL: a genuinely blocked identity does not serialize an unrelated identity', { timeout: 20000 }, async () => {
  const a = await fixture(), b = await fixture(); await a.registry.enroll(a.genesis, a.enrollment); await b.registry.enroll(b.genesis, b.enrollment);
  const entered = deferred(), release = deferred(), marker = `blocked_identity_${crypto.randomUUID().replaceAll('-', '')}`;
  const blocker = db.transaction(async tx => { await tx.query('select identity_id from dtp_foundation.identities where identity_id=$1 for update', [a.identity]); entered.resolve(); await release.promise; }); void blocker.catch(() => {});
  let blocked: ReturnType<typeof a.registry.resolve> | undefined, settled = false;
  try {
    await bounded(entered.promise); blocked = createIdentityRegistry(observed(db, { marker }), a.config).resolve(a.request);
    void blocked.then(() => { settled = true; }, () => { settled = true; });
    await waiting(marker);
    const other = await bounded(b.registry.resolve(b.request), 5000);
    assert.equal(other.body.identity_id, b.identity); assert.equal(settled, false, 'unrelated completion must occur while target is still blocked');
  } finally { release.resolve(); await Promise.allSettled([blocker, ...(blocked ? [blocked] : [])]); }
});

test('foundation PostgreSQL: SQL failure after history insertion rolls back both accepted head and history', { timeout: 20000 }, async () => {
  const f = await fixture(); await f.registry.enroll(f.genesis, f.enrollment); const before = await f.row(), oldHistory = await f.history();
  const failing: Db = { query: (q, p) => db.query(q, p), transaction: fn => db.transaction(tx => {
    const wrap: Db = { query: async <T>(q: string, p?: unknown[]) => {
      const rows = await tx.query<T>(q, p);
      if (q.startsWith('insert into dtp_foundation.identity_history')) await tx.query('select 1/0');
      return rows;
    }, transaction: inner => inner(wrap) }; return fn(wrap);
  }) };
  const command = await f.command('rotate');
  await assert.rejects(createIdentityRegistry(failing, f.config).transition(f.identity, command), (error: any) => error.code === '22012');
  assert.deepEqual(await f.row(), before); assert.deepEqual(await f.history(), oldHistory);
  const restarted = createIdentityRegistry(db, f.config);
  const accepted = await restarted.transition(f.identity, command);
  assert.equal(accepted.sequence, 1); assert.equal((await f.row())[0].body.head.sequence, 1);
  assert.equal(BigInt((await f.row())[0].revision), BigInt(before[0].revision) + 1n);
  assert.equal((await f.history()).length, oldHistory.length + 1);
  await assertPhysicalJsonObjects(f.identity, 2, 1);
});

test('foundation PostgreSQL: exact expired transition retry returns original durable receipt without state or history mutation', { timeout: 20000 }, async () => {
  const f = await fixture(); await f.registry.enroll(f.genesis, f.enrollment);
  const command = await f.command('rotate'), receipt = await f.registry.transition(f.identity, command);
  f.advance(300001);
  const state = (await f.row())[0].body;
  const subsequent = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: f.identity, expected_digest: state.head_digest, sequence: 2,
    kind: 'rotate', operational: { keys: [f.alternate.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: f.now, expires_at: f.now + 300000 }, [f.next, f.alternate]);
  await f.registry.transition(f.identity, subsequent);
  const before = await f.row(), history = await f.history();
  const replayed = await createIdentityRegistry(db, f.config).transition(f.identity, command);
  assert.deepEqual(replayed, receipt); assert.deepEqual(await f.row(), before); assert.deepEqual(await f.history(), history);
  const reordered = { ...command, signatures: [...command.signatures].reverse() };
  await assert.rejects(f.registry.transition(f.identity, reordered), /envelope conflict/);
  await db.query('update dtp_foundation.identities set status=$1 where identity_id=$2', ['frozen', f.identity]);
  await assert.rejects(f.registry.transition(f.identity, command), /frozen/);
});
