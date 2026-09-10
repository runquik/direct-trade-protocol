// Mandatory multi-connection PostgreSQL + real HTTP acceptance. Never skips for
// absent infrastructure and refuses remote/non-test/pre-existing databases.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { postgresJsDb } from "../../../supabase/functions/dtp-store/db.ts";
import type { Db } from "../../../supabase/functions/dtp-store/db.ts";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, member, object, person, policy, profile, record, string } from "../v04/helpers.ts";
import { draftCommand, signCommand } from "../../src/v04/wire.ts";

let sql: ReturnType<typeof postgres>, db: Db, store: Awaited<ReturnType<typeof createDtpStore>>, client: Client;
let pauseNextUpdate: { entered: () => void; resume: Promise<void> } | undefined;
let onNextLockRequest: (() => void) | undefined;
let failNextUpdate = false;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function reached(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("expected transaction boundary not reached")), 15000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
before(async () => {
  const connection = process.env.DTP_TEST_DATABASE_URL;
  assert.ok(connection, "set DTP_TEST_DATABASE_URL to a fresh disposable local /dtp_test database; this required gate cannot skip");
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/dtp_test", "only a disposable loopback dtp_test database is allowed");
  assert.equal(url.search, "", "connection overrides are not allowed for isolated database tests");
  sql = postgres(connection, { max: 10, connect_timeout: 5, connection: { statement_timeout: 20000 } });
  db = postgresJsDb(sql);
  assert.equal((await db.query("select 1 from information_schema.schemata where schema_name='dtp_v04'")).length, 0, "refuses existing DTP v0.4 schema; never erases data");
  await sql.unsafe(readFileSync(new URL("../../../spec/v0.4/store.sql", import.meta.url), "utf8"));
  const observed: Db = { query: (q, p) => db.query(q, p), transaction: fn => db.transaction(tx => {
    const wrapped: Db = { query: async <T>(q: string, p?: unknown[]) => {
      if (q.startsWith("select pg_advisory_xact_lock")) { const notified = onNextLockRequest; onNextLockRequest = undefined; notified?.(); }
      const rows = await tx.query<T>(q, p);
      if (q.startsWith("update dtp_v04.state")) {
        const paused = pauseNextUpdate; pauseNextUpdate = undefined;
        if (paused) { paused.entered(); await paused.resume; }
        if (failNextUpdate) { failNextUpdate = false; throw new Error("synthetic failure after SQL update but before commit"); }
      }
      return rows;
    }, transaction: inner => inner(wrapped) };
    return fn(wrapped);
  }) };
  store = await createDtpStore({ db: observed }); client = new Client(store.audience);
});
after(async () => { if (store) await store.close(); await sql?.end({ timeout: 5 }); });

test("v0.4 PostgreSQL: concurrent last-stock reservations serialize without overselling or partial effects", { timeout: 30000 }, async () => {
  const owner = await person(client), org = await company(client, owner), pool = crypto.randomUUID(), product = crypto.randomUUID();
  const pol = await policy(client, owner, org, [grant(owner)]);
  const schema = object({ company_id: string(), pool_id: string(), source_id: string(), observation_id: string(),
    expected_revision: { type: "integer", minimum: 0, maximum: 1000000 }, occurred_at: string(), kind: string(), quantity: string(), unit: string(), reservation_id: string() },
    ["company_id", "pool_id", "source_id", "observation_id", "expected_revision", "occurred_at", "kind", "quantity", "unit"]);
  const profileDigest = await profile(client, owner, org, schema, "inventory-v1");
  await client.ok(owner, "inventory.create", org, { policy_id: pol, pool_id: pool, product_id: product, base_unit: "unit" });
  const event = (kind: string, expected_revision: number, quantity: string, extra: any = {}) => ({ company_id: org, pool_id: pool, source_id: "synthetic-pg-scanner", observation_id: crypto.randomUUID(), expected_revision, occurred_at: new Date().toISOString(), kind, quantity, unit: "unit", ...extra });
  await client.ok(owner, "record.append", org, record(org, pol, pool, profileDigest, event("receive", 0, "1")));
  const claims = ["buyer-a", "buyer-b"].map(reservation_id => record(org, pol, pool, profileDigest, event("reserve", 1, "1", { reservation_id })));
  const results = await Promise.all(claims.map(payload => client.act(owner, "record.append", org, payload)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const loser = results.find(r => r.status !== 200); assert.equal(loser.error.code, "revision_conflict");
  const balance = await client.ok(owner, "inventory.get", org, { policy_id: pol, pool_id: pool });
  assert.equal(balance.on_hand, "1"); assert.equal(balance.revision, 2);
  assert.deepEqual(Object.values(balance.reservations), ["1"]);
  const retryWithCurrentRevision = await client.act(owner, "record.append", org, record(org, pol, pool, profileDigest, event("reserve", 2, "1", { reservation_id: "buyer-c" })));
  assert.equal(retryWithCurrentRevision.status, 409); assert.equal(retryWithCurrentRevision.error.code, "insufficient_stock");
  const rows = await client.ok(owner, "records.list", org, { after: 0, limit: 100, profile_digests: [profileDigest] });
  assert.equal(rows.records.length, 2, "only receive and winning reservation persist");
  assert.equal((await client.ok(owner, "inventory.get", org, { policy_id: pol, pool_id: pool })).revision, 2, "rejected reservation did not mutate balance revision");
});

test("v0.4 PostgreSQL: concurrent supersession produces exactly one new head", { timeout: 30000 }, async () => {
  const owner = await person(client), org = await company(client, owner), pol = await policy(client, owner, org, [grant(owner)]), schema = await profile(client, owner, org);
  const original = record(org, pol, crypto.randomUUID(), schema, { note: "synthetic original" }); await client.ok(owner, "record.append", org, original);
  const candidates = ["a", "b"].map(note => ({ ...original, id: crypto.randomUUID(), supersedes: original.id, body: { note } }));
  const results = await Promise.all(candidates.map(payload => client.act(owner, "record.append", org, payload)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const rows = await client.ok(owner, "records.list", org, { after: 0, limit: 100, profile_digests: [schema] });
  assert.equal(rows.records.length, 2); assert.equal(rows.records.filter((r: any) => r.is_head).length, 1);
  assert.equal(rows.records.find((r: any) => r.id === original.id).is_head, false);
});

test("v0.4 PostgreSQL: queued signed read observes committed membership revocation", { timeout: 30000 }, async () => {
  const owner = await person(client), staff = await person(client), org = await company(client, owner);
  await member(client, owner, org, staff);
  const pol = await policy(client, owner, org, [grant(owner), grant(staff)]), schema = await profile(client, owner, org);
  const payload = record(org, pol, crypto.randomUUID(), schema, { note: "SYNTHETIC-REVOKED-READ-CANARY" }); await client.ok(owner, "record.append", org, payload);
  const request = await signCommand(draftCommand(client.audience, staff, "record.get", org, { id: payload.id, profile_digest: schema }), [staff.key]);
  assert.equal((await client.send(request)).status, 200);
  const entered = deferred(), resume = deferred(); pauseNextUpdate = { entered: entered.resolve, resume: resume.promise };
  const revoking = client.act(owner, "membership.revoke", org, { person_id: staff.id });
  let queuedRead: ReturnType<Client["send"]> | undefined;
  try {
    await reached(entered.promise);
    const lock = await db.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(1346523188) as acquired");
    assert.equal(lock[0].acquired, false, "revocation holds the actual PostgreSQL advisory lock until commit");
    const queued = deferred(); onNextLockRequest = queued.resolve;
    queuedRead = client.send(request); await reached(queued.promise);
  } finally { resume.resolve(); }
  assert.equal((await revoking).status, 200);
  assert.ok(queuedRead); const denied = await queuedRead;
  assert.equal(denied.status, 404); assert.ok(!JSON.stringify(denied).includes("CANARY"));
  assert.notEqual((await client.send(request)).status, 200, "cached replay cannot bypass current revocation");
});

test("v0.4 PostgreSQL: post-update failure rolls back record, receipt and state revision; identical request can retry", { timeout: 30000 }, async () => {
  const owner = await person(client), org = await company(client, owner), pol = await policy(client, owner, org, [grant(owner)]), schema = await profile(client, owner, org);
  const payload = record(org, pol, crypto.randomUUID(), schema, { note: "Synthetic rollback test" });
  const command = await signCommand(draftCommand(client.audience, owner, "record.append", org, payload), [owner.key]);
  const before = (await db.query<{ revision: string | number }>("select revision from dtp_v04.state where singleton=true"))[0].revision;
  failNextUpdate = true;
  const failed = await client.send(command); assert.equal(failed.status, 500); assert.equal(failed.error.code, "internal");
  assert.ok(!JSON.stringify(failed).includes("synthetic failure"));
  const after = (await db.query<{ revision: string | number; present: boolean; receipt: boolean }>("select revision, body->'records' ? $1 as present, body->'receipts' ? $2 as receipt from dtp_v04.state where singleton=true", [payload.id, command.request_id]))[0];
  assert.equal(String(after.revision), String(before)); assert.equal(after.present, false); assert.equal(after.receipt, false);
  assert.equal((await client.send(command)).status, 200);
  assert.equal((await client.ok(owner, "record.get", org, { id: payload.id, profile_digest: schema })).body.note, payload.body.note);
});
