// Core-1's one signed envelope (spec/core-1/README.md, part 3): the conformance vectors, signing, and the fact
// that what the foundation layer already signs is a Core-1 envelope unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CORE1_DOMAINS, EnvelopeError, MAX_SIGNATURES, MAX_SIGNING_INPUT_BYTES, meetsQuorum, signEnvelope, signingInput, verifyEnvelope } from "../src/core1/envelope.ts";
import { FloatNotAllowedError } from "../src/canonical.ts";
import { generateKeyPair } from "../src/keys.ts";
import { UnsafeJsonError, parseUntrustedJson } from "../src/safe-json.ts";
import { IDENTITY_BOUNDS, signIdentity } from "../src/foundation/identity.ts";

const vectors = parseUntrustedJson(readFileSync(new URL("../../spec/core-1/vectors/envelope.json", import.meta.url), "utf8")) as {
  accept: { why: string; domain: string; envelope: unknown; signers: string[] }[];
  reject: { why: string; domain: string; envelope: unknown; code: string }[];
};
const keys = JSON.parse(readFileSync(new URL("../../spec/vectors/keys.json", import.meta.url), "utf8"));

test("conformance vectors: every accepted envelope verifies with its signers, every refused one with its code", async () => {
  assert.ok(vectors.accept.length >= 5 && vectors.reject.length >= 16);
  for (const v of vectors.accept) {
    const { signers } = await verifyEnvelope(v.domain, v.envelope);
    assert.deepEqual([...signers].sort(), [...v.signers].sort(), v.why);
  }
  for (const v of vectors.reject) {
    await assert.rejects(verifyEnvelope(v.domain, v.envelope), (error: unknown) => error instanceof EnvelopeError && error.code === v.code, v.why);
  }
});

test("a body that is not I-JSON is refused as invalid_envelope, not with a canonicalization error (#124)", async () => {
  const signed = await signEnvelope("DTP-RECORD-1", { a: 1 }, [keys.secret_key]);
  for (const body of [{ amount: 1.5 }, { n: 2 ** 53 }, { n: -(2 ** 53) }, { s: "\ud800" }, { s: "\udc00x" }, { nested: [{ n: Infinity }] }]) {
    await assert.rejects(verifyEnvelope("DTP-RECORD-1", { body, signatures: signed.signatures }),
      (error: unknown) => error instanceof EnvelopeError && error.code === "invalid_envelope", JSON.stringify(body));
  }
});

test("signing is deterministic, refuses what a receiver would refuse, and never lets a key sign twice", async () => {
  const body = { b: [1, 2], a: "x" };
  const one = await signEnvelope("DTP-RECORD-1", body, [keys.secret_key]);
  const two = await signEnvelope("DTP-RECORD-1", { a: "x", b: [1, 2] }, [keys.secret_key]);
  assert.deepEqual(one, two, "member order does not change what is signed");
  await assert.rejects(signEnvelope("DTP-RECORD-1", { ["a" + String.fromCharCode(92)]: 1 }, [keys.secret_key]), UnsafeJsonError);
  await assert.rejects(signEnvelope("DTP-RECORD-1", { amount: 1.5 }, [keys.secret_key]), FloatNotAllowedError);
  await assert.rejects(signEnvelope("DTP-RECORD-1", body, [keys.secret_key, keys.secret_key]), EnvelopeError);
  await assert.rejects(signEnvelope("record", body, [keys.secret_key]), EnvelopeError);
  await assert.rejects(signEnvelope("DTP-RECORD-1", body, []), EnvelopeError);
});

test("the signer refuses what the verifier refuses: a signing input above 65536 bytes and more than 24 keys (#218)", async () => {
  const base = signingInput("DTP-RECORD-1", { note: "" }).length;
  const at = { note: "x".repeat(MAX_SIGNING_INPUT_BYTES - base) }, past = { note: "x".repeat(MAX_SIGNING_INPUT_BYTES - base + 1) };
  await verifyEnvelope("DTP-RECORD-1", await signEnvelope("DTP-RECORD-1", at, [keys.secret_key]));
  await assert.rejects(signEnvelope("DTP-RECORD-1", past, [keys.secret_key]), (e: unknown) => e instanceof EnvelopeError && e.code === "invalid_envelope");
  const pairs = await Promise.all(Array.from({ length: MAX_SIGNATURES + 1 }, () => generateKeyPair()));
  await verifyEnvelope("DTP-RECORD-1", await signEnvelope("DTP-RECORD-1", { n: 1 }, pairs.slice(0, MAX_SIGNATURES).map(k => k.secretKey)));
  await assert.rejects(signEnvelope("DTP-RECORD-1", { n: 1 }, pairs.map(k => k.secretKey)), (e: unknown) => e instanceof EnvelopeError && e.code === "invalid_envelope");
  // The identity signer holds the identity bounds of part 4 the same way.
  await assert.rejects(signIdentity("DTP-PERSON-GENESIS-1", { n: 1 }, pairs), /1 to 24 keys sign/);
  await assert.rejects(signIdentity("DTP-PERSON-GENESIS-1", { note: "x".repeat(IDENTITY_BOUNDS.signing_input_bytes) }, [pairs[0]]), /identity payload too large/);
});

test("the bounds are Core-1's, not the caller's: verifyEnvelope takes no limit options (#218)", () => {
  assert.equal(verifyEnvelope.length, 2);
  assert.deepEqual({ ...IDENTITY_BOUNDS }, { signing_input_bytes: 16_384, signatures: 24, keys_per_set: 8, key_id_length: 64, signature_text: 128 });
});

test("a threshold is several signatures over one input; the quorum is the caller's rule", async () => {
  const [a, b, c] = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
  const signed = await signEnvelope("DTP-ORGANIZATION-TRANSITION-1", { organization_id: "x", sequence: 2 }, [a.secretKey, b.secretKey]);
  const { signers } = await verifyEnvelope("DTP-ORGANIZATION-TRANSITION-1", signed);
  assert.equal(meetsQuorum({ keys: [a.keyId, b.keyId, c.keyId], threshold: 2 }, signers), true);
  assert.equal(meetsQuorum({ keys: [a.keyId, c.keyId], threshold: 2 }, signers), false);
});

test("what the foundation layer signs today is a Core-1 envelope, unchanged", async () => {
  const key = await generateKeyPair();
  const body = { operational: { keys: [key.keyId], threshold: 1 }, created_at: 1760000000000 };
  const signed = await signIdentity("DTP-PERSON-GENESIS-1", body, [key]);
  const { signers } = await verifyEnvelope("DTP-PERSON-GENESIS-1", signed);
  assert.deepEqual([...signers], [key.keyId]);
  assert.deepEqual(await signEnvelope("DTP-PERSON-GENESIS-1", body, [key.secretKey]), signed, "the same bytes and signature either way");
});

test("the Core-1 domain list is the one the profile names", () => {
  assert.deepEqual([...CORE1_DOMAINS].sort(), [
    "DTP-IDENTITY-LOG-HEAD-1", "DTP-IDENTITY-REHOME-1", "DTP-IDENTITY-TRANSITION-1", "DTP-ORGANIZATION-CONSENT-1",
    "DTP-ORGANIZATION-GENESIS-1", "DTP-ORGANIZATION-TRANSITION-1", "DTP-PERSON-GENESIS-1", "DTP-RECORD-1",
  ]);
  const profile = readFileSync(new URL("../../spec/core-1/README.md", import.meta.url), "utf8");
  for (const domain of CORE1_DOMAINS) assert.ok(profile.includes(domain), `spec/core-1/README.md names ${domain}`);
});
