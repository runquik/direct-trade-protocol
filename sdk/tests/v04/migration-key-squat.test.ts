// A key that has left the company's control cannot veto the company's move (#137; replaces gap test #138).
// Import keeps key uniqueness for every key that can still act for the company (a person's current key, an active
// installation's key). A retired key or a revoked installation's key is historical only: someone outside the company
// who registered it at the destination first does not stop the import. A retired genesis key registered elsewhere
// forks that person ID; a forked person who is no longer a controller, member or invitee keeps the destination's
// record, and a current one is refused with 409 naming the person. Every key-collision refusal names who collides.
// Rule: spec/v0.4/SPEC.md sections 3 and 8. Vectors: spec/vectors/snapshot-key-collision.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { generateKeyPair } from "../../src/keys.ts";
import type { KeyPair } from "../../src/keys.ts";
import { personId, signToken } from "../../src/v04/wire.ts";
import { Client, company, expiry, grant, member, person, policy, profile, record } from "./helpers.ts";
import type { Person } from "./helpers.ts";

async function hosts() {
  const assessmentPins: Record<string, string> = {};
  const source = await createDtpStore({ assessmentPins });
  let destination: Awaited<ReturnType<typeof createDtpStore>> | undefined;
  try {
    destination = await createDtpStore({ assessmentPins });
    source.pins[destination.audience] = destination.keyId; destination.pins[source.audience] = source.keyId;
    const a = new Client(source.audience), b = new Client(destination.audience), owner = await person(a);
    await person(b, owner);
    return { source, destination, a, b, owner, assessmentPins, close: async () => { await Promise.all([source.close(), destination!.close()]); } };
  } catch (error) { await source.close(); if (destination) await destination.close(); throw error; }
}
type Hosts = Awaited<ReturnType<typeof hosts>>;

async function tryReady(h: Hosts, org: string) {
  const manifest = await h.a.ok(h.owner, "migration.prepare", org, { destination: { audience: h.destination.audience, key_id: h.destination.keyId } });
  const migration_id = manifest.body.manifest.migration_id;
  await h.b.ok(h.owner, "migration.stage", null, { manifest });
  for (const index of manifest.body.manifest.chunk_hashes.map((_: unknown, i: number) => i) as number[]) {
    const chunk = await h.a.ok(h.owner, "migration.chunk", org, { migration_id, index });
    await h.b.ok(h.owner, "migration.upload", null, { migration_id, index, data: chunk.data });
  }
  return { migration_id, ...(await h.b.act(h.owner, "migration.ready", null, { migration_id })) };
}
/** After a refused ready, the source cancels and the destination aborts the stage, so the company can move again. */
async function abandon(h: Hosts, org: string, migration_id: string) {
  const cancel = await h.a.ok(h.owner, "migration.cancel", org, { migration_id });
  await h.b.ok(h.owner, "migration.abort", null, { migration_id, cancel });
}
async function squat(client: Client, key: KeyPair): Promise<Person> { return person(client, { id: await personId(key.keyId), key }); }
async function seeded(h: Hosts) {
  const org = await company(h.a, h.owner), schema = await profile(h.a, h.owner, org), pol = await policy(h.a, h.owner, org, [grant(h.owner)]);
  await h.a.ok(h.owner, "record.append", org, record(org, pol, crypto.randomUUID(), schema, { note: "Synthetic record" }));
  return { org, schema, pol };
}
async function install(h: Hosts, org: string, schema: string, pol: string) {
  const assessorKey = await generateKeyPair(), issuer = "https://synthetic-assessor.example.test";
  h.assessmentPins[issuer] = assessorKey.keyId;
  const artifact_digest = "b".repeat(64);
  const assessment = await signToken({ kind: "module-assessment", issuer, issued_at: new Date().toISOString(), expires_at: expiry(), artifact_digest, outcome: "approved" }, { audience: issuer, storeKey: assessorKey, pins: {}, now: Date.now() });
  const release = await h.a.ok(h.owner, "release.publish", org, { module_id: crypto.randomUUID(), version: "1.0.0", artifact_digest, profiles: [schema], actions: ["read"], visibility: "private", assessment });
  const vendorKey = await generateKeyPair(), installation_id = crypto.randomUUID();
  await h.a.ok(h.owner, "installation.create", org, { installation_id, release_digest: release.digest, key_id: vendorKey.keyId, policy_ids: [pol], actions: ["read"], mode: "interactive", expires_at: expiry() }, [vendorKey]);
  return { vendorKey, installation_id };
}

test("a revoked module vendor who registers its old installation key at the destination does not block the import", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const { org, schema, pol } = await seeded(h), { vendorKey, installation_id } = await install(h, org, schema, pol);
    await h.a.ok(h.owner, "installation.revoke", org, { installation_id });
    await squat(h.b, vendorKey);
    const ready = await tryReady(h, org);
    assert.equal(ready.status, 200, JSON.stringify(ready.error));
  } finally { await h.close(); }
});

test("an active installation's key bound at the destination still refuses the import, naming the installation", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const { org, schema, pol } = await seeded(h), { vendorKey, installation_id } = await install(h, org, schema, pol);
    await squat(h.b, vendorKey);
    const ready = await tryReady(h, org);
    assert.equal(ready.status, 409); assert.equal(ready.error.code, "conflict");
    assert.match(ready.error.message, new RegExp(`installation key aliases another identity: the current key \\S+ of installation ${installation_id} is already bound at the destination`));
  } finally { await h.close(); }
});

test("a member's retired non-genesis key, registered as a new identity at the destination, does not block the import", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const { org } = await seeded(h);
    const genesis = await generateKeyPair(), worker: Person = { id: await personId(genesis.keyId), key: genesis };
    await person(h.a, worker); await member(h.a, h.owner, org, worker);
    const second = await generateKeyPair();
    await h.a.ok(worker, "person.rotate", null, { add: [second.keyId], revoke: [] }, [second]);
    await h.a.ok(worker, "person.rotate", null, { add: [], revoke: [second.keyId] });
    const squatter = await squat(h.b, second);
    assert.notEqual(squatter.id, worker.id);
    const ready = await tryReady(h, org);
    assert.equal(ready.status, 200, JSON.stringify(ready.error));
  } finally { await h.close(); }
});

test("a member's current key bound at the destination to another identity still refuses the import, naming the member", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const { org } = await seeded(h);
    const genesis = await generateKeyPair(), worker: Person = { id: await personId(genesis.keyId), key: genesis };
    await person(h.a, worker); await member(h.a, h.owner, org, worker);
    const second = await generateKeyPair();
    await h.a.ok(worker, "person.rotate", null, { add: [second.keyId], revoke: [] }, [second]);
    await squat(h.b, second);
    const ready = await tryReady(h, org);
    assert.equal(ready.status, 409); assert.equal(ready.error.code, "conflict");
    assert.match(ready.error.message, new RegExp(`personal key aliases another identity: the current key ${second.keyId} of person ${worker.id} is already bound at the destination`));
  } finally { await h.close(); }
});

test("a retired genesis key forks a former member's ID at the destination: the import keeps the destination's record", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const { org } = await seeded(h);
    const genesis = await generateKeyPair(), worker: Person = { id: await personId(genesis.keyId), key: genesis };
    await person(h.a, worker); await member(h.a, h.owner, org, worker);
    const fresh = await generateKeyPair();
    await h.a.ok(worker, "person.rotate", null, { add: [fresh.keyId], revoke: [genesis.keyId] }, [fresh]);
    const thief = await squat(h.b, genesis), thiefKey = await generateKeyPair();
    assert.equal(thief.id, worker.id);
    await h.b.ok(thief, "person.rotate", null, { add: [thiefKey.keyId], revoke: [genesis.keyId] }, [thiefKey]);

    // While the member is current, the fork is refused, and the refusal names the person and the remedy.
    const refused = await tryReady(h, org);
    assert.equal(refused.status, 409); assert.equal(refused.error.code, "conflict");
    assert.match(refused.error.message, new RegExp(`destination identity diverged: person ${worker.id} .*still a controller, member or invitee.*revoke the membership`));

    // The remedy: revoke the membership at the source and move again.
    await abandon(h, org, refused.migration_id);
    await h.a.ok(h.owner, "membership.revoke", org, { person_id: worker.id });
    const ready = await tryReady(h, org);
    assert.equal(ready.status, 200, JSON.stringify(ready.error));
  } finally { await h.close(); }
});
