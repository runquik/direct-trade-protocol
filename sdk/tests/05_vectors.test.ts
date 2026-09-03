import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DtpStoreClient } from "../src/client.ts";
import { canonicalize, sha256Hex, keyPairFromSecret, signRecord, verifyRecord, signingInput, signBytes, verifyBytes, decodeSignature } from "../src/index.ts";
import { storeUnderTest } from "./helpers.ts";

const vectors = resolve(dirname(fileURLToPath(import.meta.url)), "../../spec/vectors");
const keys = JSON.parse(readFileSync(join(vectors, "keys.json"), "utf8"));
const canon = JSON.parse(readFileSync(join(vectors, "canonicalization.json"), "utf8"));
const sigs = JSON.parse(readFileSync(join(vectors, "signatures.json"), "utf8"));

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
});
after(async () => store.close());

test("fixed key round-trips through the encodings", async () => {
  const kp = await keyPairFromSecret(keys.secret_key);
  assert.equal(kp.keyId, keys.key_id);
  assert.equal(Buffer.from(kp.publicKey).toString("hex"), keys.public_key_hex);
  assert.equal(Buffer.from(kp.seed).toString("hex"), keys.seed_hex);
});

test("canonicalization vectors", async () => {
  for (const c of canon.cases) {
    const text = canonicalize(c.input);
    assert.equal(text, c.canonical, c.name);
    assert.equal(await sha256Hex(text), c.sha256, c.name);
  }
});

test("raw signature vector verifies and is reproduced deterministically", async () => {
  const msg = new TextEncoder().encode(sigs.raw.message_utf8);
  const sig = await signBytes(keys.secret_key, msg);
  assert.equal(Buffer.from(sig).toString("hex"), sigs.raw.signature_hex);
  assert.equal(await verifyBytes(keys.key_id, msg, decodeSignature(sigs.raw.signature)), true);
});

test("record vectors: signing input, hash, and signature all match; store agrees", async () => {
  for (const r of sigs.records) {
    assert.equal(new TextDecoder().decode(signingInput(r.envelope)), r.signing_input, r.name);
    assert.equal(await sha256Hex(signingInput(r.envelope)), r.payload_hash, r.name);
    const v = await verifyRecord(r.envelope);
    assert.equal(v.ok, true, `${r.name}: ${v.error}`);
    const { signature, ...unsigned } = r.envelope;
    const re = await signRecord(unsigned, keys.secret_key);
    assert.equal(re.signature, signature, `${r.name}: deterministic re-sign`);
    const d = await base.canonicalize(r.envelope);
    assert.equal(d.canonical, r.signing_input);
    assert.equal(d.payload_hash, r.payload_hash);
    assert.equal(d.signature_valid, true);
    const t = await base.canonicalize({ ...r.envelope, body: { ...r.envelope.body, display_name: "x" } });
    assert.equal(t.signature_valid, false);
  }
});
