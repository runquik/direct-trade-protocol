// Conformance: the Ed25519 verification rule (spec/v0.4/SPEC.md section 2, #44). Every DTP signature check goes
// through verifyBytes, so the reference must give exactly the expected outcome for every vector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeKeyId, decodeSignature, verifyBytes } from "../src/keys.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../spec/vectors/${name}`, import.meta.url), "utf8"));
const vectors = read("signature-verification.json") as { cases: { name: string; expected: "accept" | "refuse"; message_hex: string; public_key_hex: string; signature_hex: string; key_id: string; signature: string }[] };
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const littleEndian = (b: Uint8Array) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };

test("signature verification vectors: the reference accepts and refuses exactly as the vectors require", async () => {
  assert.ok(vectors.cases.some(c => c.expected === "accept") && vectors.cases.filter(c => c.expected === "refuse").length >= 9);
  for (const c of vectors.cases) {
    assert.deepEqual(decodeKeyId(c.key_id), hex(c.public_key_hex), `${c.name}: key id encoding`);
    assert.deepEqual(decodeSignature(c.signature), hex(c.signature_hex), `${c.name}: signature encoding`);
    assert.equal(await verifyBytes(c.key_id, hex(c.message_hex), hex(c.signature_hex)), c.expected === "accept", c.name);
  }
});

test("signature verification vectors: the S + L case is the fixed key's raw signature with S raised by the group order", () => {
  const raw = decodeSignature(read("signatures.json").raw.signature);
  const malleated = hex(vectors.cases.find(c => c.name === "fixed key, S + L")!.signature_hex);
  assert.deepEqual(malleated.subarray(0, 32), raw.subarray(0, 32));
  assert.equal(littleEndian(malleated.subarray(32)), littleEndian(raw.subarray(32)) + L);
});
