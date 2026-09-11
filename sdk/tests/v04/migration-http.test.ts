// Mandatory migration acceptance: real HTTP + signed commands + actual snapshot
// validation against disposable stores. No DB access or stubbed validation hooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { generateKeyPair } from "../../src/keys.ts";
import type { KeyPair } from "../../src/keys.ts";
import { draftCommand, signCommand, signToken } from "../../src/v04/wire.ts";
import { Client, company, expiry, grant, member, person, policy, profile, record } from "./helpers.ts";
import type { Person } from "./helpers.ts";

async function hosts() {
  const clock = { offset: 0 }, now = () => Date.now() + clock.offset, assessmentPins: Record<string, string> = {};
  const source = await createDtpStore({ now, assessmentPins });
  let destination: Awaited<ReturnType<typeof createDtpStore>> | undefined;
  try {
    destination = await createDtpStore({ now, assessmentPins });
    source.pins[destination.audience] = destination.keyId; destination.pins[source.audience] = source.keyId;
    const a = new Client(source.audience), b = new Client(destination.audience), owner = await person(a);
    await person(b, owner);
    return { source, destination, a, b, owner, clock, now, assessmentPins,
      close: async () => { await Promise.all([source.close(), destination!.close()]); } };
  } catch (error) { await source.close(); if (destination) await destination.close(); throw error; }
}
type Hosts = Awaited<ReturnType<typeof hosts>>;
async function signed(client: Client, actor: Person, action: string, org: string | null, payload: any, cosign: KeyPair[] = [], now = Date.now()) {
  return signCommand(draftCommand(client.audience, actor, action, org, payload, now), [actor.key, ...cosign]);
}
function denied(result: any, codes: string[]) { assert.notEqual(result.status, 200, "unauthorized operation succeeded"); assert.ok(codes.includes(result.error?.code), JSON.stringify(result)); }
async function prepare(h: Hosts, org: string, cosign: KeyPair[] = []) {
  return h.a.ok(h.owner, "migration.prepare", org, { destination: { audience: h.destination.audience, key_id: h.destination.keyId } }, cosign);
}
async function stageAll(h: Hosts, org: string, manifest: any, cosign: KeyPair[] = [], reverse = false) {
  const migration_id = manifest.body.manifest.migration_id;
  await h.b.ok(h.owner, "migration.stage", null, { manifest });
  const indexes = manifest.body.manifest.chunk_hashes.map((_: unknown, i: number) => i) as number[];
  if (reverse) indexes.reverse();
  for (const index of indexes) {
    const chunk = await h.a.ok(h.owner, "migration.chunk", org, { migration_id, index }, cosign);
    assert.ok(Buffer.byteLength(chunk.data, "base64") <= 65536);
    await h.b.ok(h.owner, "migration.upload", null, { migration_id, index, data: chunk.data });
  }
  return h.b.ok(h.owner, "migration.ready", null, { migration_id });
}

test("v0.4 HTTP migration: genuine >1MiB state survives adversarial chunks, cutover retries and remote-party continuation", { timeout: 180000 }, async () => {
  const h = await hosts();
  try {
    const org = await company(h.a, h.owner, "Synthetic Migrating Manufacturer"), partner = await company(h.a, h.owner, "Synthetic Partner Stays Here");
    const schema = await profile(h.a, h.owner, org), pol = await policy(h.a, h.owner, org, [grant(h.owner)]), resource = crypto.randomUUID();
    const originals: any[] = [];
    for (let i = 0; i < 12; i++) {
      const payload = record(org, pol, resource, schema, { note: `${i}:` + "SYNTHETIC-ONLY-".repeat(4200) }, [partner]);
      await h.a.ok(h.owner, "record.append", org, payload);
      originals.push(await h.a.ok(h.owner, "record.get", org, { id: payload.id, profile_digest: schema }));
    }
    const manifest = await prepare(h, org), m = manifest.body.manifest, migration_id = m.migration_id;
    assert.ok(m.byte_length > 1024 * 1024, `snapshot must really exceed request limit, got ${m.byte_length}`);
    assert.ok(Buffer.byteLength(JSON.stringify(manifest)) < 1024 * 1024);
    await h.b.ok(h.owner, "migration.stage", null, { manifest });
    denied(await h.b.act(h.owner, "migration.ready", null, { migration_id }), ["incomplete_migration"]);
    const first = await h.a.ok(h.owner, "migration.chunk", org, { migration_id, index: 0 });
    const badData = (first.data[0] === "A" ? "B" : "A") + first.data.slice(1);
    denied(await h.b.act(h.owner, "migration.upload", null, { migration_id, index: 0, data: badData }), ["invalid_chunk"]);
    denied(await h.b.act(h.owner, "migration.upload", null, { migration_id, index: m.chunk_hashes.length, data: first.data }), ["invalid_chunk"]);
    const upload = await signed(h.b, h.owner, "migration.upload", null, { migration_id, index: 0, data: first.data });
    assert.equal((await h.b.send(upload)).status, 200); assert.equal((await h.b.send(upload)).status, 200);
    denied(await h.b.act(h.owner, "migration.ready", null, { migration_id }), ["incomplete_migration"]);
    const ready = await stageAll(h, org, manifest, [], true);
    assert.deepEqual(await h.b.ok(h.owner, "migration.ready", null, { migration_id }), ready);
    assert.equal((await h.a.ok(h.owner, "record.get", org, { id: originals[0].id, profile_digest: schema })).body.note, originals[0].body.note);
    const commitRequest = await signed(h.a, h.owner, "migration.commit", org, { migration_id, ready });
    const committed = await h.a.send(commitRequest); assert.equal(committed.status, 200, JSON.stringify(committed.error));
    assert.deepEqual((await h.a.send(commitRequest)).result, committed.result);
    assert.deepEqual(await h.a.ok(h.owner, "migration.receipt", org, { migration_id }), committed.result);
    denied(await h.a.act(h.owner, "record.append", org, record(org, pol, resource, schema, { note: "should never write frozen source" }, [partner])), ["migrated"]);
    const finalRequest = await signed(h.b, h.owner, "migration.finalize", null, { migration_id, commit: committed.result });
    assert.equal((await h.b.send(finalRequest)).status, 200);
    const finalAgain = await h.b.send(finalRequest); assert.equal(finalAgain.status, 200); assert.equal(finalAgain.result.generation, 2);
    const migrated = await h.b.ok(h.owner, "records.list", org, { after: 0, limit: 100, profile_digests: [schema] });
    assert.equal(migrated.records.length, originals.length);
    for (let i = 0; i < originals.length; i++) {
      assert.equal(migrated.records[i].id, originals[i].id);
      assert.deepEqual(migrated.records[i].command, originals[i].command, "migration preserves original signed bytes");
      assert.deepEqual(migrated.records[i].body, originals[i].body);
    }
    const sourceOrgs = await h.a.ok(h.owner, "organizations.list", null, {});
    assert.equal(sourceOrgs.find((o: any) => o.id === partner).status, "active");
    assert.equal(sourceOrgs.find((o: any) => o.id === org).status, "migrated");
    const next = record(org, pol, resource, schema, { note: "Post-migration trade with partner remaining at source" }, [partner]);
    denied(await h.b.act(h.owner, "record.append", org, next), ["authority_unavailable"]);
    const token = await h.a.ok(h.owner, "authority.export", partner, {});
    await h.b.ok(h.owner, "authority.import", org, { token });
    assert.equal((await h.b.ok(h.owner, "record.append", org, next)).id, next.id);
    const destinationOrgs = await h.b.ok(h.owner, "organizations.list", null, {});
    assert.equal(destinationOrgs.some((o: any) => o.id === partner), false, "remote authority must not fabricate local company");
    // A fresh signed request can recover durable finalization after token expiry.
    h.clock.offset += 2 * 3600000;
    const recovered = await h.b.send(await signed(h.b, h.owner, "migration.finalize", null, { migration_id, commit: committed.result }, [], h.now()));
    assert.equal(recovered.status, 200, JSON.stringify(recovered.error));
    assert.equal(recovered.result.generation, 2);
  } finally { await h.close(); }
});

test("v0.4 HTTP migration: stale or expired destination readiness never freezes writable source", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const org = await company(h.a, h.owner), schema = await profile(h.a, h.owner, org), pol = await policy(h.a, h.owner, org, [grant(h.owner)]), resource = crypto.randomUUID();
    const manifest = await prepare(h, org), migration_id = manifest.body.manifest.migration_id, ready = await stageAll(h, org, manifest);
    await h.a.ok(h.owner, "record.append", org, record(org, pol, resource, schema, { note: "Change after destination validated" }));
    denied(await h.a.act(h.owner, "migration.commit", org, { migration_id, ready }), ["conflict"]);
    await h.a.ok(h.owner, "record.append", org, record(org, pol, resource, schema, { note: "Source remains writable after stale rejection" }));
    const cancel = await h.a.ok(h.owner, "migration.cancel", org, { migration_id });
    await h.b.ok(h.owner, "migration.abort", null, { migration_id, cancel });
    const freshManifest = await prepare(h, org), freshId = freshManifest.body.manifest.migration_id, freshReady = await stageAll(h, org, freshManifest);
    h.clock.offset += 3600001;
    const expired = await h.a.send(await signed(h.a, h.owner, "migration.commit", org, { migration_id: freshId, ready: freshReady }, [], h.now()));
    denied(expired, ["expired", "conflict"]);
    const writable = await h.a.send(await signed(h.a, h.owner, "record.append", org, record(org, pol, resource, schema, { note: "Source remains writable after readiness expired" }), [], h.now()));
    assert.equal(writable.status, 200, JSON.stringify(writable.error));
  } finally { await h.close(); }
});

test("v0.4 HTTP migration: personnel export requires current stewards for manifest and chunks, and keeps destination privacy", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const org = await company(h.a, h.owner), hr = await person(h.a), employee = await person(h.a);
    await member(h.a, h.owner, org, hr); await member(h.a, h.owner, org, employee);
    const schema = await profile(h.a, h.owner, org), resource = crypto.randomUUID();
    const pol = await policy(h.a, h.owner, org, [grant(hr), grant(employee, [resource], ["read"])], [hr], "personnel");
    const sensitive = record(org, pol, resource, schema, { note: "SYNTHETIC-EMPLOYEE-COMPENSATION-CANARY" });
    await h.a.ok(hr, "record.append", org, sensitive);
    const destination = { audience: h.destination.audience, key_id: h.destination.keyId };
    const unauthorized = await h.a.act(h.owner, "migration.prepare", org, { destination });
    denied(unauthorized, ["approval_required"]); assert.ok(!JSON.stringify(unauthorized).includes("CANARY"));
    const manifest = await prepare(h, org, [hr.key]), migration_id = manifest.body.manifest.migration_id;
    const chunkDenied = await h.a.act(h.owner, "migration.chunk", org, { migration_id, index: 0 });
    denied(chunkDenied, ["approval_required"]); assert.ok(!JSON.stringify(chunkDenied).includes("CANARY"));
    const ready = await stageAll(h, org, manifest, [hr.key]);
    denied(await h.a.act(h.owner, "migration.commit", org, { migration_id, ready }), ["approval_required"]);
    const commit = await h.a.ok(h.owner, "migration.commit", org, { migration_id, ready }, [hr.key]);
    await h.b.ok(h.owner, "migration.finalize", null, { migration_id, commit });
    denied(await h.b.act(h.owner, "record.get", org, { id: sensitive.id, profile_digest: schema }), ["not_found"]);
    const visible = await h.b.ok(employee, "record.get", org, { id: sensitive.id, profile_digest: schema });
    assert.equal(visible.body.note, sensitive.body.note);
    assert.deepEqual(visible.command.payload, sensitive);
    const ownerView = await h.b.ok(h.owner, "workspace.view", org, { after: 0, limit: 100, profile_digests: [schema] });
    assert.equal(ownerView.records.length, 0); assert.ok(!JSON.stringify(ownerView).includes("CANARY"));
  } finally { await h.close(); }
});

test("v0.4 HTTP migration: active and previously revoked installations both arrive disabled", { timeout: 120000 }, async () => {
  const h = await hosts();
  try {
    const org = await company(h.a, h.owner), schema = await profile(h.a, h.owner, org), pol = await policy(h.a, h.owner, org, [grant(h.owner)]), resource = crypto.randomUUID();
    const payload = record(org, pol, resource, schema, { note: "Synthetic module-visible business record" });
    await h.a.ok(h.owner, "record.append", org, payload);
    const assessorKey = await generateKeyPair(), issuer = "https://synthetic-assessor.example.test";
    h.assessmentPins[issuer] = assessorKey.keyId;
    const artifact_digest = "a".repeat(64);
    const assessment = await signToken({ kind: "module-assessment", issuer, issued_at: new Date().toISOString(), expires_at: expiry(), artifact_digest, outcome: "approved" }, { audience: issuer, storeKey: assessorKey, pins: {}, now: Date.now() });
    const release = await h.a.ok(h.owner, "release.publish", org, { module_id: crypto.randomUUID(), version: "1.0.0", artifact_digest, profiles: [schema], actions: ["read"], visibility: "private", assessment });
    const installations: { id: string; key: KeyPair }[] = [];
    for (let i = 0; i < 2; i++) {
      const installation = { id: crypto.randomUUID(), key: await generateKeyPair() };
      await h.a.ok(h.owner, "installation.create", org, { installation_id: installation.id, release_digest: release.digest, key_id: installation.key.keyId, policy_ids: [pol], actions: ["read"], mode: "interactive", expires_at: expiry() }, [installation.key]);
      installations.push(installation);
    }
    async function readAs(client: Client, installation: { id: string; key: KeyPair }) {
      const command = draftCommand(client.audience, h.owner, "record.get", org, { id: payload.id, profile_digest: schema });
      command.actor = { kind: "installation", id: installation.id, key_id: installation.key.keyId };
      return client.send(await signCommand(command, [installation.key, h.owner.key]));
    }
    assert.equal((await readAs(h.a, installations[0])).status, 200);
    await h.a.ok(h.owner, "installation.revoke", org, { installation_id: installations[1].id });
    denied(await readAs(h.a, installations[1]), ["forbidden"]);
    const manifest = await prepare(h, org), migration_id = manifest.body.manifest.migration_id, ready = await stageAll(h, org, manifest);
    const commit = await h.a.ok(h.owner, "migration.commit", org, { migration_id, ready });
    await h.b.ok(h.owner, "migration.finalize", null, { migration_id, commit });
    assert.equal((await h.b.ok(h.owner, "record.get", org, { id: payload.id, profile_digest: schema })).body.note, payload.body.note);
    for (const installation of installations) denied(await readAs(h.b, installation), ["forbidden"]);
  } finally { await h.close(); }
});
