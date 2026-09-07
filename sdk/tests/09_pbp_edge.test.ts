import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEdge } from "../../supabase/functions/pbp-store/edge.ts";
import { generateKeyPair } from "../src/keys.ts";
import { createPbpStore } from "../scripts/pbp-dev-server.ts";
import { draftCommand, signCommand, personId } from "../src/v03/wire.ts";
const audience = "https://project.supabase.co/functions/v1";
const options = { accessToken: "a".repeat(64), allowedOrigins: ["http://localhost:3000"], revision: "test" };
test("PBP Edge: path prefix, private access gate and explicit browser origins", async () => {
  const deps = { audience, storeKey: await generateKeyPair(), trustedSources: [], db: { query: async () => { throw new Error("must not query"); }, transaction: async () => { throw new Error("must not transact"); } } };
  const run = (path: string, init?: RequestInit) => handleEdge(new Request(audience + path, init), deps, options);
  const health = await run("/pbp-store/health"); assert.equal(health.status, 200); assert.equal((await health.json()).audience, audience);
  assert.equal((await run("/pbp-store/commands", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await run("/pbp-store/commands", { method: "POST", headers: { "x-pbp-dev-token": "wrong" } })).status, 401);
  assert.equal((await run("/pbp-store/commands", { method: "POST", headers: { "x-pbp-dev-token": options.accessToken }, body: "{}" })).status, 500); // gate passed; DB stub rejects
  const preflight = await run("/pbp-store/commands", { method: "OPTIONS", headers: { origin: "http://localhost:3000" } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const denied = await run("/pbp-store/health", { headers: { origin: "https://untrusted.invalid" } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get("access-control-allow-origin"), null);
});
test("PBP Edge: builder access does not replace signatures; state limit rolls back enrollment", async () => {
  const store = await createPbpStore();
  try {
    const key = await generateKeyPair(), person = { id: await personId(key.keyId), key };
    const deps = { db: store.db, audience, storeKey: await generateKeyPair(), trustedSources: [], maxStateBytes: 1 };
    const send = (body: unknown) => handleEdge(new Request(audience + "/pbp-store/commands", { method: "POST", headers: { "x-pbp-dev-token": options.accessToken }, body: JSON.stringify(body) }), deps, options);
    const command = draftCommand(audience, person, "person.register", null, { keys: [key.keyId] });
    assert.equal((await send(command)).status, 400);
    assert.equal((await send(await signCommand(command, [key]))).status, 507);
    const state = (await store.db.query<any>("select body from pbp_v03.state where singleton = true"))[0].body;
    assert.deepEqual(state.persons, {});
  } finally { await store.close(); }
});
