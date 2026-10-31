// GAP (red team, surface 5: host behaviour and portability). Gap observations, not fixes: these tests pin the
// current behaviour so CI stays green, and their `GAP:` assertions flip when the gap is closed.
//
// A snapshot carries every key the company's history ever bound: revoked installations' keys and people's retired
// keys included. Import refuses the company if any of those keys is already bound at the destination to another
// identity (`snapshot.ts`, "installation key aliases another identity" / "personal key aliases another identity"),
// or if the destination already holds a person with the same ID but a different key history ("destination identity
// diverged"). Person IDs derive from the genesis key, and person registration is open to anyone holding a key.
// So whoever holds a key that has left the company's control (a revoked module vendor holding its installation key,
// or the holder of a retired, for example compromised, personal key) can register it at any host before the company
// arrives, and that host can then never import the company. Nothing in the company's control can undo it: the
// history cannot be redacted, and no command removes another person's registration.
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

/** Prepare at the source and upload every chunk to the destination; returns the destination's answer to migration.ready. */
async function tryReady(h: Hosts, org: string) {
  const manifest = await h.a.ok(h.owner, "migration.prepare", org, { destination: { audience: h.destination.audience, key_id: h.destination.keyId } });
  const migration_id = manifest.body.manifest.migration_id;
  await h.b.ok(h.owner, "migration.stage", null, { manifest });
  for (const index of manifest.body.manifest.chunk_hashes.map((_: unknown, i: number) => i) as number[]) {
    const chunk = await h.a.ok(h.owner, "migration.chunk", org, { migration_id, index });
    await h.b.ok(h.owner, "migration.upload", null, { migration_id, index, data: chunk.data });
  }
  return { migration_id, ready: await h.b.act(h.owner, "migration.ready", null, { migration_id }) };
}
/** Someone holding `key` registers it at a host as a brand-new person: open to anyone, no company involved. */
async function squat(client: Client, key: KeyPair): Promise<Person> { return person(client, { id: await personId(key.keyId), key }); }

test("GAP: a revoked module vendor registers its old installation key as a person at a host, and that host can never import the company", { timeout: 120000 }, async () => {
  // Control: the same company, with no squat, is ready to move to the second host (see the GAP host below).
  const control = await hosts();
  try {
    const org = await company(control.a, control.owner), pol = await policy(control.a, control.owner, org, [grant(control.owner)]);
    await control.a.ok(control.owner, "record.append", org, record(org, pol, crypto.randomUUID(), await profile(control.a, control.owner, org), { note: "Synthetic record" }));
    const { ready } = await tryReady(control, org);
    assert.equal(ready.status, 200, `control: an ordinary company is portable: ${JSON.stringify(ready.error)}`);
  } finally { await control.close(); }

  const h = await hosts();
  try {
    const org = await company(h.a, h.owner), schema = await profile(h.a, h.owner, org), pol = await policy(h.a, h.owner, org, [grant(h.owner)]);
    await h.a.ok(h.owner, "record.append", org, record(org, pol, crypto.randomUUID(), schema, { note: "Synthetic record" }));
    const assessorKey = await generateKeyPair(), issuer = "https://synthetic-assessor.example.test";
    h.assessmentPins[issuer] = assessorKey.keyId;
    const artifact_digest = "b".repeat(64);
    const assessment = await signToken({ kind: "module-assessment", issuer, issued_at: new Date().toISOString(), expires_at: expiry(), artifact_digest, outcome: "approved" }, { audience: issuer, storeKey: assessorKey, pins: {}, now: Date.now() });
    const release = await h.a.ok(h.owner, "release.publish", org, { module_id: crypto.randomUUID(), version: "1.0.0", artifact_digest, profiles: [schema], actions: ["read"], visibility: "private", assessment });
    // The module vendor generates and keeps the installation key: that is what lets it act as the installation.
    const vendorKey = await generateKeyPair(), installation_id = crypto.randomUUID();
    await h.a.ok(h.owner, "installation.create", org, { installation_id, release_digest: release.digest, key_id: vendorKey.keyId, policy_ids: [pol], actions: ["read"], mode: "interactive", expires_at: expiry() }, [vendorKey]);
    // The company drops the module. The installation stays in the signed history, so its key stays in every snapshot.
    await h.a.ok(h.owner, "installation.revoke", org, { installation_id });

    // The former vendor, with no rights in the company, registers its key as a person at the host the company will move to.
    await squat(h.b, vendorKey);
    const { ready } = await tryReady(h, org);
    assert.equal(ready.status, 409, "GAP: the destination refuses the whole company");
    assert.equal(ready.error.code, "conflict");
    assert.match(ready.error.message, /installation key aliases another identity/, "GAP: because a third party bound a revoked key there first");
  } finally { await h.close(); }
});

test("GAP: whoever holds a member's retired genesis key takes that member's ID at another host and blocks the company's import there for good", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const org = await company(h.a, h.owner), pol = await policy(h.a, h.owner, org, [grant(h.owner)]);
    // A member of the company, registered only at the source.
    const genesis = await generateKeyPair(), worker: Person = { id: await personId(genesis.keyId), key: genesis };
    await person(h.a, worker); await member(h.a, h.owner, org, worker);
    await h.a.ok(h.owner, "record.append", org, record(org, pol, crypto.randomUUID(), await profile(h.a, h.owner, org), { note: "Synthetic record" }));
    // The member's genesis key is compromised; the documented remedy is to rotate it away (SPEC §3, person.rotate).
    const fresh = await generateKeyPair();
    await h.a.ok(worker, "person.rotate", null, { add: [fresh.keyId], revoke: [genesis.keyId] }, [fresh]);

    // The thief registers the retired key at the destination: the person ID derives from the key, so it is the member's ID.
    const thief = await squat(h.b, genesis);
    assert.equal(thief.id, worker.id, "the squatted identity has the member's own person ID");
    // ...and rotates to a key only the thief holds, so the member can no longer act as that ID at the destination.
    const thiefKey = await generateKeyPair();
    await h.b.ok(thief, "person.rotate", null, { add: [thiefKey.keyId], revoke: [genesis.keyId] }, [thiefKey]);

    const { ready } = await tryReady(h, org);
    assert.equal(ready.status, 409, "GAP: the destination refuses the whole company");
    assert.equal(ready.error.code, "conflict");
    assert.match(ready.error.message, /destination identity diverged/, "GAP: because the member's ID there now carries the thief's key history");
    // The member cannot repair the destination copy of their own ID: their genesis key is retired there and the current key is the thief's.
    const repair = await h.b.act({ id: worker.id, key: fresh }, "person.rotate", null, { add: [], revoke: [thiefKey.keyId] });
    assert.equal(repair.status, 403, "GAP: the rightful member cannot reclaim their ID at the destination"); assert.equal(repair.error.message, "inactive personal authority");
    const again = await h.b.act({ id: worker.id, key: genesis }, "person.rotate", null, { add: [fresh.keyId], revoke: [thiefKey.keyId] }, [fresh]);
    assert.equal(again.status, 403, "GAP: not even with the genesis key the ID was derived from"); assert.equal(again.error.message, "inactive personal authority");
  } finally { await h.close(); }
});
