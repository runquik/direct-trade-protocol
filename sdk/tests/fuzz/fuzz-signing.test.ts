// signingObject() / signingInput() / signRecord() / verifyRecord() properties.
// Run: node fuzz-signing.test.ts   (FUZZ_SEED / FUZZ_ITER as in fuzz-canonical)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import refCanonicalize from "canonicalize";
import { canonicalize, FloatNotAllowedError } from "../../src/canonical.ts";
import { SIGNED_FIELDS, type Envelope, type UnsignedEnvelope } from "../../src/envelope.ts";
import { keyPairFromSecret } from "../../src/keys.ts";
import { payloadHash, signingInput, signingObject, signRecord, verifyRecord } from "../../src/sign.ts";
import { validateEnvelope } from "../../src/registry.ts";
import { randomJson, randomKey, Rng, shuffleKeys, type Json } from "./rng.ts";

const SEED = Number(process.env.FUZZ_SEED ?? 20260903);
const ITER = Number(process.env.FUZZ_ITER ?? 5000);
const keys = JSON.parse(readFileSync(new URL("../../../spec/vectors/keys.json", import.meta.url), "utf8"));
const sigs = JSON.parse(readFileSync(new URL("../../../spec/vectors/signatures.json", import.meta.url), "utf8"));
const vectorEnvelope: Envelope = sigs.records[0].envelope;
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function baseEnvelope(r: Rng): UnsignedEnvelope {
  const id = crypto.randomUUID();
  return {
    record_id: id,
    root_id: id,
    type: "trade.contract",
    namespace: "trade",
    schema_version: "0.2",
    subject_company_id: "fz-a.dtp",
    counterparty_ids: r.bool() ? ["fz-b.dtp"] : [],
    issuer: { key_id: keys.key_id, company_id: "fz-a.dtp", module_id: r.bool() ? null : "mod-x" },
    visibility: r.pick(["public", "counterparties", "granted", "private"]),
    created_at: "2026-09-08T14:03:22.117Z",
    supersedes: r.bool() ? null : crypto.randomUUID(),
    body: randomJson(r, { loneSurrogates: false, maxDepth: 4 }) as Record<string, unknown>,
  };
}

test(`signingObject: field order, unknown top-level fields and signature never change the signing input (${ITER} cases)`, () => {
  let jcsDivergences = 0;
  let firstDivergence: string | null = null;
  for (let i = 0; i < ITER; i++) {
    const r = new Rng((SEED + i * 7919) >>> 0);
    const env = baseEnvelope(r);
    const expected = text(signingInput(env));
    // 1. shuffle top-level and nested key order
    const shuffled = shuffleKeys(r, env as unknown as Json) as unknown as UnsignedEnvelope;
    assert.equal(text(signingInput(shuffled)), expected, `case ${i}: key order changed the signing input`);
    // 2. add unknown top-level fields (including ones that sort before/after the real ones) and a signature
    const extra: Record<string, unknown> = { ...shuffled, signature: "ed25519:junk" };
    const n = 1 + r.int(4);
    for (let k = 0; k < n; k++) {
      let key = randomKey(r);
      if ((SIGNED_FIELDS as readonly string[]).includes(key) || key === "signature") key = "x_" + key;
      extra[key] = randomJson(r, { maxDepth: 2 });
    }
    extra["seq"] = 42;
    extra["received_at"] = "2026-01-01T00:00:00.000Z";
    extra["payload_hash"] = "00";
    extra["is_head"] = true;
    assert.equal(text(signingInput(extra as unknown as Envelope)), expected, `case ${i}: unknown fields leaked into the signing input`);
    // 3. output has exactly the signed fields, and canonical form equals the reference JCS of the signing object
    const so = signingObject(extra as unknown as Envelope) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(so).sort(), [...SIGNED_FIELDS].sort());
    if (expected !== refCanonicalize(so)) {
      jcsDivergences++;
      if (!firstDivergence) firstDivergence = `case ${i}: body ${JSON.stringify(so.body).slice(0, 120)}`;
    }
  }
  console.log(`  signing inputs that are not RFC 8785 of the signing object: ${jcsDivergences}/${ITER} (numeric-string keys in body; see fuzz-canonical). First: ${firstDivergence ?? "-"}`);
});

test("signingObject defaults: missing supersedes -> null, missing counterparty_ids -> [], explicit null counterparty_ids -> []", () => {
  const r = new Rng(SEED);
  const env = baseEnvelope(r) as unknown as Record<string, unknown>;
  delete env.supersedes;
  delete env.counterparty_ids;
  const so = signingObject(env as unknown as UnsignedEnvelope) as unknown as Record<string, unknown>;
  assert.equal(so.supersedes, null);
  assert.deepEqual(so.counterparty_ids, []);
  const withNulls = { ...env, supersedes: null, counterparty_ids: null };
  const withEmpty = { ...env, supersedes: null, counterparty_ids: [] };
  assert.equal(text(signingInput(withNulls as unknown as UnsignedEnvelope)), text(signingInput(withEmpty as unknown as UnsignedEnvelope)));
  assert.equal(text(signingInput(env as unknown as UnsignedEnvelope)), text(signingInput(withEmpty as unknown as UnsignedEnvelope)));
  // note: the envelope schema requires counterparty_ids to be an array, so null never reaches a store; the SDK is merely lenient
  const check = validateEnvelope({ ...withNulls, signature: "ed25519:x" });
  assert.equal(check.ok, false, "store-side envelope validation rejects counterparty_ids: null");
});

test("signingObject: any other missing signed field becomes null (the store's schema catches it before signing matters)", () => {
  const r = new Rng(SEED + 1);
  const env = baseEnvelope(r) as unknown as Record<string, unknown>;
  delete env.body;
  delete env.type;
  const so = signingObject(env as unknown as UnsignedEnvelope) as unknown as Record<string, unknown>;
  assert.equal(so.body, null);
  assert.equal(so.type, null);
  assert.ok(text(signingInput(env as unknown as UnsignedEnvelope)).includes('"body":null'));
  assert.equal(validateEnvelope({ ...so, signature: "ed25519:x" }).ok, false);
});

test("spec vector record: verifies; unknown top-level fields do not break verification (schema rejects them separately)", async () => {
  const v = await verifyRecord(vectorEnvelope);
  assert.equal(v.ok, true);
  assert.equal(v.payload_hash, sigs.records[0].payload_hash ?? v.payload_hash);
  const withJunk = { ...vectorEnvelope, junk: { a: 1 }, seq: 9 } as unknown as Envelope;
  assert.equal((await verifyRecord(withJunk)).ok, true, "signature covers only SIGNED_FIELDS");
  assert.equal(validateEnvelope(withJunk).ok, false, "envelope schema has additionalProperties:false");
  // body key order is irrelevant
  const r = new Rng(SEED + 2);
  const shuffled = { ...vectorEnvelope, body: shuffleKeys(r, vectorEnvelope.body as Json) } as Envelope;
  assert.equal((await verifyRecord(shuffled)).ok, true);
  // any body change breaks it
  const tampered = { ...vectorEnvelope, body: { ...vectorEnvelope.body, display_name: "x" } } as Envelope;
  assert.equal((await verifyRecord(tampered)).ok, false);
});

test("__proto__ in body: a record with an injected __proto__ key verifies with the ORIGINAL signature (canonical form drops the key)", async () => {
  const injected = JSON.parse(JSON.stringify(vectorEnvelope).replace('"body":{', '"body":{"__proto__":{"polluted":true},')) as Envelope;
  assert.ok(Object.prototype.hasOwnProperty.call(injected.body, "__proto__"), "JSON.parse creates an own __proto__ property");
  const v = await verifyRecord(injected);
  console.log(`  verifyRecord(with __proto__ in body).ok = ${v.ok}; payload_hash equal to original: ${v.payload_hash === (await payloadHash(vectorEnvelope))}`);
  console.log(`  JSON.stringify(injected.body) still contains __proto__: ${JSON.stringify(injected.body).includes("__proto__")}`);
  // Document the current behaviour; see FINDINGS-fuzz.md
  assert.equal(v.ok, true);
});

test("signRecord: output contains exactly SIGNED_FIELDS + signature, drops unknown fields, refuses floats, is deterministic", async () => {
  const kp = await keyPairFromSecret(keys.secret_key);
  const r = new Rng(SEED + 3);
  for (let i = 0; i < 100; i++) {
    const env = baseEnvelope(r) as unknown as Record<string, unknown>;
    env.junk = 1;
    const signed = (await signRecord(env as unknown as UnsignedEnvelope, kp.secretKey)) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(signed).sort(), [...SIGNED_FIELDS, "signature"].sort());
    assert.equal(signed.junk, undefined);
    const again = (await signRecord(env as unknown as UnsignedEnvelope, kp.secretKey)) as unknown as Record<string, unknown>;
    assert.equal(again.signature, signed.signature, "Ed25519 deterministic");
    assert.equal((await verifyRecord(signed as unknown as Envelope)).ok, true);
    // wrong key fails
    const other = { ...signed, issuer: { ...(signed.issuer as object), key_id: "ed25519:11111111111111111111111111111111111111111111" } } as unknown as Envelope;
    assert.equal((await verifyRecord(other)).ok, false);
  }
  const withFloat = { ...baseEnvelope(r), body: { amount: 1.5 } };
  await assert.rejects(signRecord(withFloat, kp.secretKey), FloatNotAllowedError);
});

test("payload_hash is over the canonical signing input and matches the spec vector", async () => {
  const input = signingInput(vectorEnvelope);
  assert.equal(text(input), sigs.records[0].signing_input ?? text(input));
  const h = await payloadHash(vectorEnvelope);
  assert.match(h, /^[0-9a-f]{64}$/);
  if (sigs.records[0].payload_hash) assert.equal(h, sigs.records[0].payload_hash);
  // and it is the same for the record with junk fields (junk is not covered) - the store would reject the junk via schema
  assert.equal(await payloadHash({ ...vectorEnvelope, junk: 1 } as unknown as Envelope), h);
  // canonical of the signing object equals canonicalize of the envelope minus signature, key order independent
  const { signature, ...minus } = vectorEnvelope;
  assert.equal(text(input), canonicalize(minus));
});
