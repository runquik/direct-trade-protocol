// Core-1 host receipts (DTP-LOG-HEAD-1, spec/core-1/README.md part 5): the conformance vectors, and the reference's
// own guarantees beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToHex, hexToBytes } from "../src/canonical.ts";
import { sha256Sync } from "../src/sha256.ts";
import { EnvelopeError } from "../src/core1/envelope.ts";
import { ReceiptError, compareLogHeads, inclusionPath, leafHash, merkleRoot, signLogHead, verifyInclusion, verifyLogHead, verifyReceipt, type Leaf } from "../src/core1/receipt.ts";
import { parseUntrustedJson } from "../src/safe-json.ts";

const vectors = parseUntrustedJson(readFileSync(new URL("../../spec/core-1/vectors/receipt.json", import.meta.url), "utf8")) as {
  keys: { label: string; key_id: string; secret_key: string }[];
  log: { log_id: string; leaves: Leaf[]; leaf_hashes: string[]; roots: string[] };
  accept: { why: string; receipt: unknown; record: string; host_key: string; head: unknown; leaf: unknown }[];
  reject: { why: string; receipt: unknown; record: string; host_key: string; code: string }[];
  pairs: { why: string; a: unknown; b: unknown; host_key: string; result: string }[];
};

test("conformance vectors: the log's leaf hashes and roots", () => {
  assert.deepEqual(vectors.log.leaves.map(leafHash), vectors.log.leaf_hashes);
  vectors.log.roots.forEach((root, i) => assert.equal(merkleRoot(vectors.log.leaf_hashes.slice(0, i + 1)), root));
});

test("conformance vectors: accepted receipts give their head and leaf; refused ones give their code", async () => {
  assert.ok(vectors.accept.length >= 6 && vectors.reject.length >= 20);
  for (const v of vectors.accept) {
    const { head, leaf } = await verifyReceipt(v.receipt, v.record, v.host_key);
    assert.deepEqual(head, v.head, v.why);
    assert.deepEqual(leaf, v.leaf, v.why);
  }
  for (const v of vectors.reject) {
    await assert.rejects(verifyReceipt(v.receipt, v.record, v.host_key), (error: unknown) => (error instanceof ReceiptError || error instanceof EnvelopeError) && error.code === v.code, v.why);
  }
  const codes = new Set(vectors.reject.map(v => v.code));
  for (const code of ["invalid_receipt", "invalid_signature", "unauthorized_host", "wrong_record", "not_included", "time_order"]) assert.ok(codes.has(code), code);
});

test("conformance vectors: pairs of log heads", async () => {
  for (const v of vectors.pairs) {
    const a = await verifyLogHead(v.a, v.host_key), b = await verifyLogHead(v.b, v.host_key);
    assert.equal(compareLogHeads(a, b), v.result, v.why);
    assert.equal(compareLogHeads(b, a), v.result, `${v.why} (either order)`);
  }
  assert.deepEqual(new Set(vectors.pairs.map(v => v.result)), new Set(["unrelated", "same", "re-signed", "ordered", "equivocation", "time_order"]));
});

// RFC 6962's reference test data (the Certificate Transparency tree tests): eight raw leaves and the root of each
// prefix. RFC 9162 keeps the same tree hash, so these pin the hashing independently of DTP's leaf format.
const RFC_LEAVES = ["", "00", "10", "2021", "3031", "40414243", "5051525354555657", "606162636465666768696a6b6c6d6e6f"];
const RFC_ROOTS = [
  "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
  "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
  "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
  "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
  "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
  "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
  "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
];
const rfcLeafHash = (hex: string) => bytesToHex(sha256Sync(new Uint8Array([0, ...(hex ? hexToBytes(hex) : [])])));

test("the tree hash is RFC 9162's: RFC 6962 reference roots, and every inclusion path verifies", () => {
  const hashes = RFC_LEAVES.map(rfcLeafHash);
  for (let size = 1; size <= hashes.length; size++) {
    const tree = hashes.slice(0, size);
    assert.equal(merkleRoot(tree), RFC_ROOTS[size - 1], `root of ${size}`);
    for (let index = 0; index < size; index++) {
      const path = inclusionPath(tree, index);
      assert.ok(verifyInclusion(tree[index], index, size, path, RFC_ROOTS[size - 1]), `leaf ${index} of ${size}`);
      assert.ok(!verifyInclusion(tree[(index + 1) % size], index, size, path, RFC_ROOTS[size - 1]) || size === 1, `another leaf at ${index} of ${size}`);
      assert.ok(!verifyInclusion(tree[index], size, size, path, RFC_ROOTS[size - 1]), `an index past the tree for ${index} of ${size}`);
    }
  }
});

test("the reference refuses to sign a head that is not a LogHead", async () => {
  const [hostKey] = vectors.keys;
  const good = { log_id: vectors.log.log_id, size: 1, root: vectors.log.roots[0], signed_at: 1 };
  await assert.rejects(signLogHead({ ...good, size: 0 }, hostKey.secret_key), (e: unknown) => e instanceof ReceiptError && e.code === "invalid_receipt");
  await assert.rejects(signLogHead({ ...good, extra: 1 } as never, hostKey.secret_key), (e: unknown) => e instanceof ReceiptError && e.code === "invalid_receipt");
  const signed = await signLogHead(good, hostKey.secret_key);
  assert.deepEqual(await verifyLogHead(signed, hostKey.key_id), good);
});

test("a receipt built by a host for every leaf of a growing log verifies, and only for its own record", async () => {
  const [hostKey] = vectors.keys;
  const leaves: Leaf[] = [];
  for (let n = 0; n < 17; n++) {
    leaves.push({ record: bytesToHex(sha256Sync(`r${n}`)), accepted_at: 1000 + n, effects: [] });
    const hashes = leaves.map(leafHash);
    const head = await signLogHead({ log_id: vectors.log.log_id, size: leaves.length, root: merkleRoot(hashes), signed_at: 1000 + n }, hostKey.secret_key);
    const receipt = { head, leaf: leaves[n], path: inclusionPath(hashes, n) };
    await verifyReceipt(receipt, leaves[n].record, hostKey.key_id);
    if (n > 0) await assert.rejects(verifyReceipt({ ...receipt, leaf: leaves[n - 1], path: inclusionPath(hashes, n - 1) }, leaves[n - 1].record, hostKey.key_id), (e: unknown) => e instanceof ReceiptError && e.code === "not_included");
  }
});
