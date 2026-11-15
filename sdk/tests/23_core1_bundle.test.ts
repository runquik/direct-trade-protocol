// Core-1 exchange bundles (spec/core-1/README.md part 5): the conformance vectors, and the reference's own guarantees
// beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EnvelopeError } from "../src/core1/envelope.ts";
import { RecordError } from "../src/core1/record.ts";
import { ReceiptError } from "../src/core1/receipt.ts";
import { BundleError, verifyBundle, type BundleOptions } from "../src/core1/bundle.ts";
import { parseUntrustedJson } from "../src/safe-json.ts";

const vectors = parseUntrustedJson(readFileSync(new URL("../../spec/core-1/vectors/bundle.json", import.meta.url), "utf8")) as {
  accept: { why: string; bundle: unknown; options: BundleOptions; expect: { digest: string; signers: string[]; accepted_at: number | null } }[];
  reject: { why: string; bundle: unknown; options: BundleOptions; code: string }[];
};
const coded = (code: string) => (error: unknown) =>
  (error instanceof BundleError || error instanceof RecordError || error instanceof ReceiptError || error instanceof EnvelopeError) && error.code === code;

test("conformance vectors: accepted bundles give their record digest, signers and receipt time", async () => {
  assert.ok(vectors.accept.length >= 10);
  for (const v of vectors.accept) {
    const got = await verifyBundle(v.bundle, v.options);
    assert.equal(got.digest, v.expect.digest, v.why);
    assert.deepEqual([...got.signers].sort(), v.expect.signers, v.why);
    assert.equal(got.receipt === null ? null : got.receipt.leaf.accepted_at, v.expect.accepted_at, v.why);
  }
});

test("conformance vectors: refused bundles give their code", async () => {
  for (const v of vectors.reject) await assert.rejects(verifyBundle(v.bundle, v.options), coded(v.code), v.why);
  const codes = new Set(vectors.reject.map(v => v.code));
  for (const code of ["invalid_bundle", "invalid_signature", "unexpected_profile", "wrong_head", "unauthorized_signer", "history_conflict", "unauthorized_host", "wrong_record", "stale_head"]) assert.ok(codes.has(code), code);
});

test("stale_head: the same record is accepted with its early receipt and refused without one", async () => {
  const late = vectors.accept.find(v => v.why.startsWith("a record naming an older head, with a receipt"))!;
  const bare = { ...(late.bundle as object), receipt: null };
  await assert.rejects(verifyBundle(bare, late.options), coded("stale_head"));
  // Without the next head anywhere in view, the receipt is not needed.
  const genesisOnly = vectors.accept.find(v => v.why.startsWith("a record naming the last head the recipient knows of"))!;
  await verifyBundle(genesisOnly.bundle, genesisOnly.options);
});

test("the verifier needs no network and does not change what it is given", async () => {
  const v = vectors.accept[6];
  const before = JSON.stringify(v);
  const fetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("no network"); }) as typeof fetch;
  try { await verifyBundle(v.bundle, v.options); } finally { globalThis.fetch = fetch; }
  assert.equal(JSON.stringify(v), before);
});
