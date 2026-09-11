import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
// This second client deliberately uses the reference SDK; the NativeClient above
// has no dependency on its signing/canonicalization or these reference helpers.
import { Client as ReferenceClient, person as referencePerson } from "./helpers.ts";
import { NativeClient, base58, unbase58, canonical, hash, identity, personId, organizationId, commandBytes, draft, resign, verifyCommand } from "./independent-client.ts";

test("v0.4 independent native crypto reproduces frozen vector, self-certifying ID and exact signature", () => {
  const vector = JSON.parse(readFileSync(new URL("../../../spec/v0.4/signing-vector.json", import.meta.url), "utf8"));
  const fixed = identity(new Uint8Array(32).fill(4));
  assert.equal(fixed.id, vector.person_id); assert.equal(fixed.keyId, vector.command.actor.key_id);
  assert.equal(personId(fixed.keyId), vector.person_id);
  assert.equal(commandBytes(vector.command).toString("utf8"), vector.signing_input_utf8);
  assert.equal(hash(vector.command), vector.request_hash);
  assert.equal(verifyCommand(vector.command), true);
  assert.deepEqual(resign(vector.command, [fixed]), vector.command);
  const broken = structuredClone(vector.command); broken.payload.keys = [identity().keyId]; assert.equal(verifyCommand(broken), false);
  const repeated = structuredClone(vector.command); repeated.signatures.push(repeated.signatures[0]); assert.equal(verifyCommand(repeated), false);
});

test("v0.4 independent canonicalizer uses UTF16 ordering and fails closed on ambiguous JSON values", () => {
  assert.equal(canonical({ "2": 2, "10": 10 }), '{"10":10,"2":2}');
  assert.equal(canonical({ "\ue000": "later", "😀": "earlier" }), '{"😀":"earlier","":"later"}');
  assert.equal(canonical({ note: 'escaped\\\n"', value: -0 }), '{"note":"escaped\\\\\\n\\\"","value":0}');
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, undefined, "\ud800", "\udc00", [undefined], Array(1)]) assert.throws(() => canonical(value));
  const cycle: any = {}; cycle.self = cycle; assert.throws(() => canonical(cycle));
  for (const bytes of [Buffer.from([0]), Buffer.from([0, 0, 1]), Buffer.from([255, 10, 42]), Buffer.alloc(32, 4)]) assert.deepEqual(unbase58(base58(bytes)), bytes);
  assert.throws(() => unbase58("0OIl"));
});

test("v0.4 independent HTTP client interoperates bidirectionally with reference client through company, policy, profile and records", { timeout: 60000 }, async () => {
  const store = await createDtpStore();
  try {
    const native = new NativeClient(store.audience), reference = new ReferenceClient(store.audience), owner = identity();
    await native.ok(owner, "person.register", null, { keys: [owner.keyId] });
    const staff = await referencePerson(reference);
    const nonce = crypto.randomUUID(), org = organizationId(owner.id, nonce);
    await native.ok(owner, "organization.create", org, { name: "Synthetic Cross-Client Manufacturer", nonce, controllers: [owner.id], threshold: 1 });
    const invitation_id = crypto.randomUUID(), expires_at = new Date(Date.now() + 86400000).toISOString();
    await native.ok(owner, "membership.invite", org, { invitation_id, person_id: staff.id, permissions: [], expires_at });
    await reference.ok(staff, "membership.accept", org, { invitation_id });
    const resource = crypto.randomUUID(), policy_id = crypto.randomUUID();
    await native.ok(owner, "policy.create", org, { policy_id, expected_revision: 0, classification: "business", stewards: [owner.id], threshold: 1,
      grants: [owner.id, staff.id].map(person_id => ({ person_id, actions: ["read", "write"], resource_ids: [resource], expires_at })) });
    const schema = { type: "object", properties: { product: { type: "string", maxLength: 120 }, cases: { type: "integer", minimum: 0, maximum: 10000 }, units_per_case: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["product", "cases", "units_per_case"], additionalProperties: false };
    const contract = { publisher_id: org, name: "native.package-summary", version: "1.0.0", schema, semantics: "structural", dependencies: [] }, profileDigest = hash(contract);
    const { publisher_id: _, ...published } = contract;
    await native.ok(owner, "profile.publish", org, { ...published, digest: profileDigest, visibility: "private", readers: [] });
    const admitted = await reference.ok(staff, "profile.get", org, { digest: profileDigest });
    assert.deepEqual(admitted.schema, schema); assert.equal(admitted.digest, profileDigest); assert.equal(verifyCommand(admitted.command), true);
    const originalId = crypto.randomUUID(), payload = { id: originalId, root_id: originalId, supersedes: null, organization_id: org, policy_id, resource_id: resource, profile_digest: profileDigest, counterparty_ids: [], body: { product: "Synthetic jerky", cases: 12, units_per_case: 8 } };
    const nativeRequest = draft(store.audience, owner, "record.append", org, payload);
    assert.equal((await native.send(nativeRequest)).status, 200); assert.equal((await native.send(nativeRequest)).status, 200);
    const referenceRead = await reference.ok(staff, "record.get", org, { id: originalId, profile_digest: profileDigest });
    assert.deepEqual(referenceRead.command, nativeRequest); assert.equal(verifyCommand(referenceRead.command), true);
    assert.equal(BigInt(referenceRead.body.cases) * BigInt(referenceRead.body.units_per_case), 96n);
    const correction = { ...payload, id: crypto.randomUUID(), supersedes: originalId, body: { product: "Synthetic jerky", cases: 10, units_per_case: 8 } };
    await reference.ok(staff, "record.append", org, correction);
    const nativeRead = await native.ok(owner, "record.get", org, { id: correction.id, profile_digest: profileDigest });
    assert.deepEqual(nativeRead.body, correction.body); assert.equal(verifyCommand(nativeRead.command), true);
    assert.equal(nativeRead.command.actor.id, staff.id);
    const page = await native.ok(owner, "records.list", org, { after: 0, limit: 1, profile_digests: [profileDigest] });
    assert.equal(page.records.length, 1); assert.ok(page.next_cursor > 0);
    const final = await reference.ok(staff, "records.list", org, { after: page.next_cursor, limit: 1, profile_digests: [profileDigest] });
    assert.equal(final.records[0].id, correction.id); assert.equal(final.next_cursor, null);
  } finally { await store.close(); }
});

test("v0.4 native HTTP signatures cannot cross audience/version boundaries or authorize tampered bytes", { timeout: 60000 }, async () => {
  const store = await createDtpStore();
  try {
    const native = new NativeClient(store.audience), owner = identity();
    await native.ok(owner, "person.register", null, { keys: [owner.keyId] });
    const nonce = crypto.randomUUID(), org = organizationId(owner.id, nonce);
    await native.ok(owner, "organization.create", org, { name: "Synthetic Native Fail-Closed", nonce, controllers: [owner.id], threshold: 1 });
    const wrongAudience = draft("https://unrelated.example.test", owner, "organizations.list", null, {});
    assert.equal((await native.send(wrongAudience)).status, 400);
    const wrongVersion = draft(store.audience, owner, "organizations.list", null, {}); wrongVersion.version = "0.3";
    assert.equal((await native.send(resign(wrongVersion, [owner]))).status, 400);
    const tampered = draft(store.audience, owner, "organization.policy", org, { controllers: [owner.id], threshold: 1 });
    tampered.payload.controllers = [identity().id];
    const rejected = await native.send(tampered); assert.equal(rejected.status, 401); assert.equal(rejected.error.code, "signature_invalid");
    const list = await native.ok(owner, "organizations.list", null, {}); assert.equal(list[0].id, org);
    const expired = draft(store.audience, owner, "organizations.list", null, {}, Date.now() - 300000); assert.equal((await native.send(expired)).status, 401);
    const wrongDomain = draft(store.audience, owner, "organizations.list", null, {});
    const { signatures: _, ...unsigned } = wrongDomain;
    const legacyBytes = Buffer.from(canonical({ domain: "PBP-COMMAND-0.3", command: unsigned }));
    wrongDomain.signatures = [{ key_id: owner.keyId, signature: "ed25519:" + base58(sign(null, legacyBytes, owner.privateKey)) }];
    assert.equal((await native.send(wrongDomain)).status, 401);
  } finally { await store.close(); }
});
