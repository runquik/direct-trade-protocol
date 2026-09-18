// Real PostgreSQL qualification of the bounded store with EXPLICIT SYNTHETIC hooks.
// No production authentication claim; no remote DB, schema drop, truncation or cleanup.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { postgresJsDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { createFoundationStore, FOUNDATION_STORE_SCHEMA, entityRevisionDigest } from '../../src/foundation/persistence.ts';
import { persistenceFixture } from '../foundation/persistence-fixture.ts';

let sql: ReturnType<typeof postgres>, db: Db;
const application = `dtp-persistence-review-${crypto.randomUUID()}`;
const tables = ['organization_authority', 'entity_revisions', 'resource_heads', 'business_receipts', 'transactional_outbox', 'governance_history'] as const;
before(async () => {
  const connection = process.env.DTP_FOUNDATION_TEST_DATABASE_URL ?? 'postgres://dtp_test:synthetic-dtp-local-only@127.0.0.1:15439/dtp_foundation_tests';
  const url = new URL(connection);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '15439');
  assert.equal(url.pathname, '/dtp_foundation_tests'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  sql = postgres(connection, { max: 12, connect_timeout: 5, onnotice: () => {}, connection: { application_name: application, statement_timeout: 15000 } });
  db = postgresJsDb(sql);
  const actual = (await db.query<{ version: string; database: string }>("select current_setting('server_version_num') as version,current_database() as database"))[0];
  assert.equal(actual.version, '170011', 'qualification requires the pinned PostgreSQL 17.11 server'); assert.equal(actual.database, 'dtp_foundation_tests');
  await sql.unsafe(FOUNDATION_STORE_SCHEMA);
}, { timeout: 15000 });
after(async () => { await sql?.end({ timeout: 5 }); });

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PostgreSQL boundary timeout')), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function waiting(marker: string) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await db.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where application_name=$1 and query like $2 and wait_event_type=$3', [application, `%${marker}%`, 'Lock']);
    if (rows[0].n > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('operation did not reach real PostgreSQL lock wait');
}
function observed(hooks: { marker?: string; afterQuery?: (tx: Db, text: string) => Promise<void> }): Db {
  return { query: (q, p) => db.query(q, p), transaction: fn => db.transaction(tx => {
    const wrapped: Db = { query: async <T>(q: string, p?: unknown[]) => {
      const actual = hooks.marker && q.endsWith('for update') ? `${q} /* ${hooks.marker} */` : q;
      const rows = await tx.query<T>(actual, p); await hooks.afterQuery?.(tx, q); return rows;
    }, transaction: inner => inner(wrapped) }; return fn(wrapped);
  }) };
}
async function stored(organization: string) {
  const result: Record<string, unknown[]> = {};
  for (const table of tables) result[table] = await db.query(`select * from dtp_foundation.${table} where organization_id=$1 order by to_jsonb(${table})::text`, [organization]);
  return result;
}
async function physicalObjects(organization: string) {
  const columns: Record<typeof tables[number], string[]> = {
    organization_authority: ['body'], entity_revisions: ['exact_ref', 'body', 'attribution'], resource_heads: ['exact_ref'],
    business_receipts: ['body'], transactional_outbox: ['body'], governance_history: ['body'],
  };
  for (const table of tables) for (const column of columns[table]) {
    const rows = await db.query<{ shape: string }>(`select jsonb_typeof(${column}) as shape from dtp_foundation.${table} where organization_id=$1`, [organization]);
    assert.ok(rows.length > 0, `${table}.${column} fixture must be nonvacuous`);
    assert.ok(rows.every(r => r.shape === 'object'), `${table}.${column} must physically store JSON objects`);
  }
}

test('persistence PostgreSQL: concurrent sibling grants cannot split a shared cumulative parent budget', { timeout: 20000 }, async () => {
  const f = await persistenceFixture(db, 20);
  const parent = { ...f.grant, id: crypto.randomUUID(), delegation_depth: 1, limits: [{ metric: f.metric, amount: '5' }] };
  await f.store.govern(f.organization_id, { action: 'grant', grant: parent }, f.controller);
  const children = [0, 1].map(() => ({ ...parent, id: crypto.randomUUID(), parent_id: parent.id, delegation_depth: 0 }));
  for (const grant of children) await f.store.govern(f.organization_id, { action: 'grant', grant }, f.controller);
  const requests = children.map(grant => ({ ...f.request(3), grant_id: grant.id }));
  const result = await Promise.allSettled(requests.map(r => createFoundationStore(db, f.options).execute(f.organization_id, r)));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const loser = result.findIndex(r => r.status === 'rejected'); assert.ok(loser >= 0);
  assert.match((result[loser] as PromiseRejectedResult).reason.message, /cumulative grant budget/);
  let authority = await f.authority();
  assert.equal(authority.grants.find(g => g.grant.id === parent.id)!.used[0].amount, '3');
  assert.equal(authority.grants.find(g => g.grant.id === children[loser].id)!.used[0].amount, '0');
  assert.equal((await f.counts()).business_receipts, 1);
  await createFoundationStore(db, f.options).execute(f.organization_id, { ...f.request(2), grant_id: children[loser].id });
  authority = await f.authority(); assert.equal(authority.grants.find(g => g.grant.id === parent.id)!.used[0].amount, '5');
  assert.equal((await db.query<{ body: any }>('select r.body from dtp_foundation.resource_heads h join dtp_foundation.entity_revisions r on r.organization_id=h.organization_id and r.entity_id=h.resource_id and r.entity_kind=$2 and r.revision_id=h.revision_id where h.organization_id=$1', [f.organization_id, 'resource']))[0].body.quantity, 15);
  await physicalObjects(f.organization_id);
});

test('persistence PostgreSQL: eight same-operation attempts and later fresh-instance retry commit once', { timeout: 20000 }, async () => {
  const f = await persistenceFixture(db), request = f.request(2);
  const receipts = await Promise.all(Array.from({ length: 8 }, () => createFoundationStore(db, f.options).execute(f.organization_id, request)));
  receipts.forEach(r => assert.deepEqual(r, receipts[0])); assert.equal(f.state.handlerCalls, 1); assert.equal(f.state.accountingCalls, 1);
  assert.equal((await f.authority()).grants[0].used[0].amount, '2');
  assert.deepEqual(await f.counts(), { entity_revisions: 3, resource_heads: 1, business_receipts: 1, transactional_outbox: 4, governance_history: 2 });
  await f.store.execute(f.organization_id, f.request(1));
  const before = await stored(f.organization_id), calls = [f.state.handlerCalls, f.state.accountingCalls];
  assert.deepEqual(await createFoundationStore(db, f.options).execute(f.organization_id, request), receipts[0]);
  assert.deepEqual(await stored(f.organization_id), before); assert.deepEqual([f.state.handlerCalls, f.state.accountingCalls], calls);
  const changed = structuredClone(request); (changed.intent as any).parameters.quantity = 1;
  await assert.rejects(f.store.execute(f.organization_id, changed), /operation ID conflict/); assert.deepEqual(await stored(f.organization_id), before);
});

for (const prefix of ['update dtp_foundation.organization_authority', 'insert into dtp_foundation.entity_revisions', 'update dtp_foundation.resource_heads', 'insert into dtp_foundation.transactional_outbox', 'insert into dtp_foundation.business_receipts']) {
  test(`persistence PostgreSQL: SQL failure after ${prefix} rolls back every exact row`, { timeout: 20000 }, async () => {
    const f = await persistenceFixture(db), before = await stored(f.organization_id), request = f.request(2);
    let reached = false;
    const failing = observed({ afterQuery: async (tx, q) => { if (q.startsWith(prefix)) { reached = true; await tx.query('select 1/0'); } } });
    await assert.rejects(createFoundationStore(failing, f.options).execute(f.organization_id, request), (e: any) => e.code === '22012');
    assert.equal(reached, true); assert.deepEqual(await stored(f.organization_id), before);
    const receipt = await createFoundationStore(db, f.options).execute(f.organization_id, request);
    assert.equal(receipt.revisions.length, 2); assert.equal((await f.counts()).business_receipts, 1);
    assert.equal((await f.authority()).grants[0].used[0].amount, '2'); await physicalObjects(f.organization_id);
  });
}

test('persistence PostgreSQL: locked organization permits unrelated organization to complete', { timeout: 20000 }, async () => {
  const a = await persistenceFixture(db), b = await persistenceFixture(db), beforeA = await stored(a.organization_id);
  const entered = deferred(), release = deferred(), marker = `org_lock_${crypto.randomUUID().replaceAll('-', '')}`;
  const holding = db.transaction(async tx => { await tx.query('select organization_id from dtp_foundation.organization_authority where organization_id=$1 for update', [a.organization_id]); entered.resolve(); await release.promise; }); void holding.catch(() => {});
  let blocked: ReturnType<typeof a.store.execute> | undefined, settled = false;
  try {
    await bounded(entered.promise); blocked = createFoundationStore(observed({ marker }), a.options).execute(a.organization_id, a.request());
    void blocked.then(() => { settled = true; }, () => { settled = true; }); await waiting(marker);
    const receipt = await bounded(b.store.execute(b.organization_id, b.request()));
    assert.equal(receipt.organization_id, b.organization_id); assert.equal(settled, false);
    assert.deepEqual(await stored(a.organization_id), beforeA); assert.equal((await b.counts()).business_receipts, 1);
  } finally { release.resolve(); await Promise.allSettled([holding, ...(blocked ? [blocked] : [])]); }
});

test('persistence PostgreSQL: foreign inputs retain exact source identity/provenance and do not mutate source rows', { timeout: 20000 }, async () => {
  const source = await persistenceFixture(db), reader = await persistenceFixture(db), sourceBefore = await stored(source.organization_id), readerBefore = await stored(reader.organization_id);
  const request = reader.request(2); (request.intent as any).inputs = [source.initial.revision];
  const denied = createFoundationStore(db, { ...reader.options, hooks: { ...reader.hooks, authorizeRead: async (_tx, input) => {
    assert.ok(input.revisions.every(r => r.entity.organization_id === reader.organization_id), 'source access denied');
  } } });
  await assert.rejects(denied.execute(reader.organization_id, request), /source access denied/);
  assert.equal(reader.state.handlerCalls, 0); assert.deepEqual(await stored(reader.organization_id), readerBefore);
  const wrong = structuredClone(request); (wrong.intent as any).inputs[0].digest = 'f'.repeat(64);
  await assert.rejects(reader.store.execute(reader.organization_id, wrong), /exact revision unavailable/);
  const rehomed = structuredClone(request); (rehomed.intent as any).inputs[0].entity.organization_id = reader.organization_id;
  await assert.rejects(reader.store.execute(reader.organization_id, rehomed), /exact revision unavailable/);
  const accepted = await reader.store.execute(reader.organization_id, request);
  const receipt = (await db.query<{ body: any }>('select body from dtp_foundation.business_receipts where organization_id=$1 and operation_id=$2', [reader.organization_id, accepted.operation_id]))[0].body;
  assert.deepEqual(receipt.verified.intent.inputs, [source.initial.revision]); assert.deepEqual(receipt.original_signed_request, request);
  assert.deepEqual(await stored(source.organization_id), sourceBefore);
  const revisions = await db.query<{ exact_ref: any; profile_digest: string; body: any; attribution: any }>('select exact_ref,profile_digest,body,attribution from dtp_foundation.entity_revisions where organization_id=$1', [reader.organization_id]);
  for (const row of revisions) {
    assert.equal(row.exact_ref.entity.organization_id, reader.organization_id);
    assert.equal(row.exact_ref.digest, await entityRevisionDigest(row.exact_ref.entity, row.exact_ref.revision_id, row.profile_digest, row.body));
    if (row.attribution.kind === 'host_effect') assert.deepEqual(row.attribution.original_signed_request, request);
  }
  assert.deepEqual(revisions.find(r => r.attribution.kind === 'imported_original')!.attribution.original_signed_record, reader.initial.original_signed_record);
});

test('persistence PostgreSQL: failed governance outbox does not revoke or advance any durable row', { timeout: 20000 }, async () => {
  const f = await persistenceFixture(db), before = await stored(f.organization_id);
  const failing = observed({ afterQuery: async (tx, q) => { if (q.startsWith('insert into dtp_foundation.transactional_outbox')) await tx.query('select 1/0'); } });
  await assert.rejects(createFoundationStore(failing, f.options).govern(f.organization_id, { action: 'revoke', grant_id: f.grant.id }, f.controller), (e: any) => e.code === '22012');
  assert.deepEqual(await stored(f.organization_id), before); await createFoundationStore(db, f.options).execute(f.organization_id, f.request());
  assert.equal((await f.authority()).grants[0].used[0].amount, '2');
});

for (const first of ['revoke', 'execute'] as const) {
  test(`persistence PostgreSQL: ${first} holding authority lock orders queued competing action`, { timeout: 20000 }, async () => {
    const f = await persistenceFixture(db), request = f.request(), entered = deferred(), release = deferred();
    const marker = `revocation_order_${crypto.randomUUID().replaceAll('-', '')}`;
    const held = createFoundationStore(observed({ afterQuery: async (_tx, q) => { if (q.startsWith('update dtp_foundation.organization_authority')) { entered.resolve(); await release.promise; } } }), f.options);
    const holding = first === 'revoke' ? held.govern(f.organization_id, { action: 'revoke', grant_id: f.grant.id }, f.controller) : held.execute(f.organization_id, request); void holding.catch(() => {});
    let queued: Promise<unknown> | undefined;
    try {
      await bounded(entered.promise); const other = createFoundationStore(observed({ marker }), f.options);
      queued = first === 'revoke' ? other.execute(f.organization_id, request) : other.govern(f.organization_id, { action: 'revoke', grant_id: f.grant.id }, f.controller); void queued.catch(() => {});
      await waiting(marker); release.resolve(); await holding;
      if (first === 'revoke') { await assert.rejects(queued, /grant inactive/); assert.equal((await f.counts()).business_receipts, 0); }
      else { await queued; assert.equal((await f.counts()).business_receipts, 1); await assert.rejects(f.store.execute(f.organization_id, request), /grant inactive/); }
    } finally { release.resolve(); await Promise.allSettled([holding, ...(queued ? [queued] : [])]); }
  });
}
