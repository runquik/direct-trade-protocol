// PBP 0.3 multi-connection transaction/revocation proof. Same disposable database
// as v0.2 CI, separate schema; never drops/truncates an existing schema.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { postgresJsDb, type Db } from "../../../supabase/functions/dtp-store/db.ts";
import { handle } from "../../../supabase/functions/pbp-store/router.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { draftCommand, signCommand, personId, organizationId, type Command } from "../../src/v03/wire.ts";

let sql: ReturnType<typeof postgres>, db: Db;
let storeKey: Awaited<ReturnType<typeof generateKeyPair>>;
let owner: { id: string; key: Awaited<ReturnType<typeof generateKeyPair>> }, member: typeof owner;
const audience = "http://pbp-local.test";
async function send(command: Command, selected = db) {
  const response = await handle(new Request(audience + "/pbp-store/commands", { method: "POST", body: JSON.stringify(command) }),
    { db: selected, audience, storeKey, trustedSources: [] });
  return { status: response.status, body: await response.json() as any };
}
async function cmd(person: typeof owner, action: string, org: string | null, payload: any) { return signCommand(draftCommand(audience, person, action, org, payload), [person.key]); }
before(async () => {
  const connection = process.env.DTP_TEST_DATABASE_URL;
  assert.ok(connection, "requires a disposable local /dtp_test database");
  const url = new URL(connection);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/dtp_test");
  sql = postgres(connection, { max: 10, connect_timeout: 5, connection: { statement_timeout: 15000 } }); db = postgresJsDb(sql);
  assert.equal((await db.query("select 1 from information_schema.schemata where schema_name = 'pbp_v03'")).length, 0, "refuses existing PBP schema");
  await sql.unsafe(readFileSync(new URL("../../../spec/v0.3/store.sql", import.meta.url), "utf8"));
  storeKey = await generateKeyPair();
  const first = await generateKeyPair(), second = await generateKeyPair();
  owner = { id: await personId(first.keyId), key: first }; member = { id: await personId(second.keyId), key: second };
  for (const p of [owner, member]) assert.equal((await send(await cmd(p, "person.register", null, { keys: [p.key.keyId] }))).status, 200);
});
after(async () => { await sql?.end({ timeout: 5 }); });
test("PBP PostgreSQL: concurrent identical bootstrap commits only one authority event", { timeout: 20000 }, async () => {
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  const command = await cmd(owner, "organization.create", org, { name: "Concurrent", nonce, controllers: [owner.id], threshold: 1 });
  const results = await Promise.all(Array.from({ length: 8 }, () => send(command)));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  const state = (await db.query<any>("select body from pbp_v03.state where singleton = true"))[0].body;
  assert.equal(state.organizations[org].audit.length, 1);
});
test("PBP PostgreSQL: queued member request observes preceding revocation commit", { timeout: 20000 }, async () => {
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce), invitation = crypto.randomUUID();
  assert.equal((await send(await cmd(owner, "organization.create", org, { name: "Revocation", nonce, controllers: [owner.id], threshold: 1 }))).status, 200);
  assert.equal((await send(await cmd(owner, "membership.invite", org, { invitation_id: invitation, person_id: member.id,
    permissions: ["records.read:finance.invoice"], expires_at: new Date(Date.now() + 86400000).toISOString() }))).status, 200);
  assert.equal((await send(await cmd(member, "membership.accept", org, { invitation_id: invitation }))).status, 200);
  let reached!: () => void, release!: () => void;
  const paused = new Promise<void>(r => { reached = r; }), resume = new Promise<void>(r => { release = r; });
  const gated: Db = { query: (q, p) => db.query(q, p), transaction: fn => db.transaction(tx => {
    const wrap: Db = { query: async <T>(q: string, p?: unknown[]) => {
      const rows = await tx.query<T>(q, p);
      if (q.startsWith("update pbp_v03.state")) { reached(); await resume; }
      return rows;
    }, transaction: inner => inner(wrap) };
    return fn(wrap);
  }) };
  const revoking = send(await cmd(owner, "membership.revoke", org, { person_id: member.id }), gated);
  await paused;
  let reading: ReturnType<typeof send> | undefined;
  try {
    const lock = await db.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(1346523187) as acquired");
    assert.equal(lock[0].acquired, false);
    reading = send(await cmd(member, "workspace.view", org, {}));
  } finally { release(); }
  assert.equal((await revoking).status, 200);
  const denied = await reading!; assert.equal(denied.status, 403); assert.equal(denied.body.error.code, "forbidden");
});
