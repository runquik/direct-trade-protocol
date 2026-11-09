// #107: a migration snapshot carries owned state only. The source's cached counterparty authority
// (short-lived organization-authority tokens) is not part of it, so refreshing a counterparty's
// authority during a migration window no longer changes snapshot_hash, and a snapshot that still
// carries the member is refused with invalid_snapshot.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import type { Context } from "../../src/v04/model.ts";
import { emptyState } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { draftCommand, signCommand, personId, organizationId, digest } from "../../src/v04/wire.ts";
import { buildSnapshot, validateSnapshot, applySnapshot } from "../../src/v04/snapshot.ts";

async function makeHost(audience: string) {
  const storeKey = await generateKeyPair(); const s = emptyState(); const pins: Record<string, string> = {};
  const ctx: Context = { audience, storeKey, pins, now: Date.parse("2026-09-10T12:00:00.000Z") };
  const call = async (action: string, org: string | null, payload: any, who: any) => {
    ctx.now += 1; return execute(s, await signCommand(draftCommand(ctx.audience, who, action, org, payload, ctx.now), [who.key]), ctx);
  };
  return { storeKey, s, ctx, pins, call };
}
async function registerPerson(h: Awaited<ReturnType<typeof makeHost>>) {
  const key = await generateKeyPair(); const who = { id: await personId(key.keyId), key };
  await h.call("person.register", null, { keys: [key.keyId] }, who); return who;
}
async function makeCompany(h: Awaited<ReturnType<typeof makeHost>>, owner: any, name: string) {
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await h.call("organization.create", org, { name, nonce, controllers: [owner.id], threshold: 1 }, owner);
  const policy = crypto.randomUUID(), resource = crypto.randomUUID(), expiry = new Date(h.ctx.now + 3600000).toISOString();
  await h.call("policy.create", org, { policy_id: policy, expected_revision: 0, classification: "business", stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ["read", "write", "export"], resource_ids: "*", expires_at: expiry }] }, owner);
  return { org, policy, resource };
}

test("a snapshot carries no cached counterparty authority, and refreshing it leaves the hash unchanged (#107)", async () => {
  const hostT = await makeHost("https://host-t.test");
  const bOwner = await registerPerson(hostT); const B = await makeCompany(hostT, bOwner, "Synthetic Counterparty");
  const hostS = await makeHost("https://host-s.test");
  const aOwner = await registerPerson(hostS); const A = await makeCompany(hostS, aOwner, "Synthetic Company");
  hostS.pins[hostT.ctx.audience] = hostT.storeKey.keyId;
  await hostS.call("authority.import", A.org, { token: await hostT.call("authority.export", B.org, {}, bOwner) }, aOwner);
  const schema = { type: "object", properties: { note: { type: "string", maxLength: 10 } }, required: ["note"], additionalProperties: false };
  const profile = await digest({ publisher_id: A.org, name: "memo", version: "1.0.0", schema, semantics: "structural", dependencies: [] });
  await hostS.call("profile.publish", A.org, { name: "memo", version: "1.0.0", schema, semantics: "structural", dependencies: [], visibility: "private", readers: [], digest: profile }, aOwner);
  const rec = crypto.randomUUID();
  await hostS.call("record.append", A.org, { id: rec, root_id: rec, supersedes: null, organization_id: A.org, policy_id: A.policy, resource_id: A.resource, profile_digest: profile, counterparty_ids: [B.org], body: { note: "hi" } }, aOwner);
  assert.ok(hostS.s.remote_authorities[B.org], "the source holds B's authority, as the record requires");

  const snap1 = buildSnapshot(hostS.s, A.org, hostS.ctx);
  assert.ok(!("remote_authorities" in snap1));
  const hash1 = await digest(snap1);
  hostT.ctx.now += 1000;
  await hostS.call("authority.import", A.org, { token: await hostT.call("authority.export", B.org, {}, bOwner) }, aOwner);
  assert.equal(await digest(buildSnapshot(hostS.s, A.org, hostS.ctx)), hash1, "a counterparty authority refresh is not a change to what migrates");

  const dest = emptyState(); await validateSnapshot(dest, structuredClone(snap1)); await applySnapshot(dest, structuredClone(snap1));
  assert.ok(dest.organizations[A.org]);
  const withMember: any = { ...structuredClone(snap1), remote_authorities: [] };
  await assert.rejects(validateSnapshot(emptyState(), withMember), (e: any) => e.code === "invalid_snapshot");
});
