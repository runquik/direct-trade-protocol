// Real multi-connection PostgreSQL tests. CI provisions a disposable database.
// Refuses remote/non-test databases and never drops or truncates an existing schema.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { postgresJsDb, type Db } from "../../../supabase/functions/dtp-store/db.ts";
import { handle } from "../../../supabase/functions/dtp-store/router.ts";
import { draft } from "../../src/client.ts";
import { generateKeyPair, signRecord, nowIso } from "../../src/index.ts";
import { companyBody, contractBody } from "../helpers.ts";

let sql: ReturnType<typeof postgres>, db: Db;
let owner: Awaited<ReturnType<typeof company>>, seller: Awaited<ReturnType<typeof company>>;
async function request(path: string, body?: unknown, token?: string, selectedDb?: Db) {
  const res = await handle(new Request("http://local/dtp-store" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), { db: selectedDb ?? db });
  return { status: res.status, data: await res.json() as any };
}
async function company(id: string) {
  const kp = await generateKeyPair();
  const result = await request("/companies", await signRecord(draft({ type: "core.company", subject_company_id: id,
    visibility: "public", issuer: { key_id: kp.keyId, company_id: id, module_id: null }, body: companyBody(kp, id)
  }), kp.secretKey));
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { id, kp, token: result.data.keys[0].token as string };
}
before(async () => {
  const connection = process.env.DTP_TEST_DATABASE_URL;
  assert.ok(connection, "set DTP_TEST_DATABASE_URL to a disposable local /dtp_test database");
  const url = new URL(connection);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/dtp_test", "only a disposable local dtp_test database is allowed");
  sql = postgres(connection, { max: 10, connect_timeout: 5, connection: { statement_timeout: 15000 } });
  db = postgresJsDb(sql);
  assert.equal((await db.query("select 1 from information_schema.schemata where schema_name = 'protocol'")).length, 0, "test database must be fresh; existing data is not erased");
  await sql.unsafe(readFileSync(new URL("../../../supabase/migrations/20260903000000_protocol_store.sql", import.meta.url), "utf8"));
  owner = await company("pg-owner.dtp");
  seller = await company("pg-seller.dtp");
});
after(async () => { await sql?.end({ timeout: 5 }); });

test("event cursors cannot overtake an uncommitted append", { timeout: 20000 }, async () => {
  let reached!: () => void, release!: () => void;
  const paused = new Promise<void>(r => { reached = r; });
  const resume = new Promise<void>(r => { release = r; });
  const gated: Db = {
    query: (q, p) => db.query(q, p),
    transaction: fn => db.transaction(tx => {
      const wrapped: Db = {
        query: async <T>(q: string, p?: unknown[]) => {
          const rows = await tx.query<T>(q, p);
          if (q.startsWith("update protocol.records set seq")) { reached(); await resume; }
          return rows;
        }, transaction: inner => inner(wrapped)
      };
      return fn(wrapped);
    })
  };
  async function envelope(po: string) {
    return signRecord(draft({ type: "trade.contract", subject_company_id: owner.id,
      counterparty_ids: [seller.id], issuer: { key_id: owner.kp.keyId, company_id: owner.id, module_id: null },
      body: contractBody(owner.id, seller.id, { buyer_po_number: po }) }), owner.kp.secretKey);
  }
  const first = await envelope("first"), second = await envelope("second");
  const a = request("/records", first, owner.token, gated);
  await paused;
  let b: ReturnType<typeof request> | undefined;
  try {
    const held = await db.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(1146376208) as acquired");
    assert.equal(held[0].acquired, false, "append holds the commit-order lock until commit");
    b = request("/records", second, owner.token);
    const during = await request("/events?company=" + owner.id, undefined, owner.token);
    assert.equal(during.status, 200);
    assert.ok(during.data.events.every((e: any) => ![first.record_id, second.record_id].includes(e.record_id)));
  } finally { release(); }
  const [ar, br] = await Promise.all([a, b!]);
  assert.equal(ar.status, 201, JSON.stringify(ar.data));
  assert.equal(br.status, 201, JSON.stringify(br.data));
  assert.ok(ar.data.record.seq < br.data.record.seq);
  const feed = await request("/events?company=" + owner.id + "&after=" + (ar.data.record.seq - 1), undefined, owner.token);
  assert.deepEqual(feed.data.events.map((e: any) => e.record_id), [first.record_id, second.record_id]);
  const replays = await Promise.all(Array.from({ length: 5 }, () => request("/records", second, owner.token)));
  assert.ok(replays.every(r => r.status === 200 && r.data.created === false));
  assert.equal((await db.query("select 1 from protocol.events where record_id = $1", [second.record_id])).length, 1);
});

test("a module request queued before revocation rechecks its grant inside the transaction", { timeout: 20000 }, async () => {
  const mk = await generateKeyPair();
  const moduleId = "pg-finance";
  const m = await request("/modules", await signRecord(draft({ type: "core.module", subject_company_id: owner.id,
    visibility: "public", issuer: { key_id: mk.keyId, company_id: owner.id, module_id: moduleId },
    body: { module_id: moduleId, name: moduleId, publisher_company_id: owner.id,
      keys: [{ key_id: mk.keyId, role: "root", status: "active", added_at: nowIso() }] }
  }), mk.secretKey), owner.token);
  assert.equal(m.status, 201, JSON.stringify(m.data));
  const g = await request("/records", await signRecord(draft({ type: "core.grant", subject_company_id: owner.id,
    visibility: "private", issuer: { key_id: owner.kp.keyId, company_id: owner.id, module_id: null },
    body: { module_id: moduleId, scopes: [{ namespace: "finance", access: "write" }], status: "active", expires_at: null }
  }), owner.kp.secretKey), owner.token);
  assert.equal(g.status, 201);
  let reached!: () => void, release!: () => void;
  const paused = new Promise<void>(r => { reached = r; });
  const resume = new Promise<void>(r => { release = r; });
  const gated: Db = { query: (q, p) => db.query(q, p), transaction: async fn => { reached(); await resume; return db.transaction(fn); } };
  const env = await signRecord(draft({ type: "finance.settlement_event", subject_company_id: owner.id,
    counterparty_ids: [seller.id], issuer: { key_id: mk.keyId, company_id: owner.id, module_id: moduleId },
    body: { kind: "adjustment", from_company_id: owner.id, to_company_id: seller.id, amount: { amount: "1", currency: "USD" },
      occurred_at: nowIso(), rail: "mock", references: {}, reverses: null }
  }), mk.secretKey);
  const writing = request("/records", env, m.data.keys[0].token, gated);
  await paused;
  try {
    const revoked = await request("/records", await signRecord(draft({ type: "core.grant", subject_company_id: owner.id,
      visibility: "private", issuer: { key_id: owner.kp.keyId, company_id: owner.id, module_id: null },
      supersedes: g.data.record.record_id, root_id: g.data.record.root_id, body: { ...g.data.record.body, status: "revoked" }
    }), owner.kp.secretKey), owner.token);
    assert.equal(revoked.status, 201);
  } finally { release(); }
  const rejected = await writing;
  assert.equal(rejected.status, 403);
  assert.equal(rejected.data.error.code, "grant_missing");
  assert.equal((await db.query("select 1 from protocol.records where record_id = $1", [env.record_id])).length, 0);
});
