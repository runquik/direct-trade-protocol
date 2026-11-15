// Builds spec/core-1/vectors/receipt.json: Core-1 host receipts (DTP-LOG-HEAD-1, spec/core-1/README.md part 5) a
// verifier must accept, with the head and leaf they prove, and receipts it must refuse, with the error code; plus
// pairs of signed log heads and how they compare (equivocation among them). Keys come from fixed seeds and Ed25519
// is deterministic, so the file is reproducible byte for byte. Run from sdk/: node scripts/build-core1-receipt-vectors.ts
// (add --check to compare with the file on disk instead of writing it).
import { readFileSync, writeFileSync } from "node:fs";
import { encodeKeyId, encodeSecretKey } from "../src/keys.ts";
import { sha256HexSync, sha256Sync } from "../src/sha256.ts";
import { signEnvelope } from "../src/core1/envelope.ts";
import { inclusionPath, leafHash, merkleRoot, signLogHead, type Leaf, type LogHead } from "../src/core1/receipt.ts";

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string) {
  const seed = sha256Sync(`dtp-core1-receipt-vector:${label}`);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), { name: "Ed25519" }, true, ["sign"]);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey("jwk", key)).x!, "base64url"));
  return { label, key_id: encodeKeyId(publicKey), secret_key: encodeSecretKey(seed, publicKey) };
}
const host = await fixedKey("host"), other = await fixedKey("other-host");

// One policy log of five records, a head signed after each. Record digests stand for Signed<Record> digests (part 5).
const LOG = "4b0e6f2a-91c3-4d7e-a85b-3f12c0d9e6a4", OTHER_LOG = "d3a8c51e-07b2-4f69-9e4d-62a1b7f0c835";
const record = (n: number) => sha256HexSync(`dtp-core1-receipt-vector:record-${n}`);
const effect = (n: number) => sha256HexSync(`dtp-core1-receipt-vector:effect-${n}`);
const T0 = 1762000000000;
const leaves: Leaf[] = [1, 2, 3, 4, 5].map(n => ({ record: record(n), accepted_at: T0 + n * 1000, effects: n === 2 ? [effect(1), effect(2)] : [] }));
const hashes = leaves.map(leafHash);
const head = (size: number, signedAt = T0 + size * 1000 + 5, logId = LOG): LogHead => ({ log_id: logId, size, root: merkleRoot(hashes.slice(0, size)), signed_at: signedAt });
const heads = await Promise.all([1, 2, 3, 4, 5].map(size => signLogHead(head(size), host.secret_key)));
const receiptAt = (size: number) => ({ head: heads[size - 1], leaf: leaves[size - 1], path: inclusionPath(hashes.slice(0, size), size - 1) });

const accept = [
  { why: "the first record: a log of one leaf, an empty path", receipt: receiptAt(1), record: record(1) },
  { why: "a record with two effects, second of two leaves", receipt: receiptAt(2), record: record(2) },
  { why: "the last leaf of an unbalanced tree of three", receipt: receiptAt(3), record: record(3) },
  { why: "the last leaf of a balanced tree of four", receipt: receiptAt(4), record: record(4) },
  { why: "the last leaf of a tree of five", receipt: receiptAt(5), record: record(5) },
  { why: "a receipt whose head was re-signed later with the same size and root", receipt: { ...receiptAt(3), head: await signLogHead(head(3, T0 + 3_600_000), host.secret_key) }, record: record(3) },
].map(v => ({ ...v, host_key: host.key_id, head: v.receipt.head.body, leaf: v.receipt.leaf }));

const r3 = receiptAt(3), r5 = receiptAt(5);
const tooMany = Array.from({ length: 65 }, (_, i) => effect(100 + i));
const raw = (body: unknown, ...secrets: string[]) => signEnvelope("DTP-LOG-HEAD-1", body, secrets);
// A leaf accepted after its head: the host signs a head whose signed_at precedes the leaf's accepted_at.
const lateLeaves = [...leaves.slice(0, 2), { ...leaves[2], accepted_at: T0 + 9000 }];
const lateHashes = lateLeaves.map(leafHash);
const lateHead = await signLogHead({ log_id: LOG, size: 3, root: merkleRoot(lateHashes), signed_at: T0 + 8000 }, host.secret_key);

const reject = [
  { why: "a member beside head, leaf and path", receipt: { ...r3, index: 2 }, code: "invalid_receipt" },
  { why: "a leaf without effects", receipt: { ...r3, leaf: { record: record(3), accepted_at: leaves[2].accepted_at } }, code: "invalid_receipt" },
  { why: "a leaf with 65 effects", receipt: { ...r3, leaf: { ...leaves[2], effects: tooMany } }, code: "invalid_receipt" },
  { why: "a path node in upper-case hex", receipt: { ...r3, path: r3.path.map(p => p.toUpperCase()) }, code: "invalid_receipt" },
  { why: "an accepted_at that is an ISO-8601 string", receipt: { ...r3, leaf: { ...leaves[2], accepted_at: "2025-11-01T12:00:03.000Z" } }, code: "invalid_receipt" },
  { why: "a head of size 0", receipt: { ...r3, head: await raw({ ...head(3), size: 0 }, host.secret_key) }, code: "invalid_receipt" },
  { why: "a head whose log_id is not a lower-case UUID", receipt: { ...r3, head: await raw({ ...head(3), log_id: LOG.toUpperCase() }, host.secret_key) }, code: "invalid_receipt" },
  { why: "a head with a member beside the four", receipt: { ...r3, head: await raw({ ...head(3), host: "example" }, host.secret_key) }, code: "invalid_receipt" },
  { why: "a head whose root changed after signing", receipt: { ...r3, head: { ...r3.head, body: { ...r3.head.body, root: heads[4].body.root } } }, code: "invalid_signature" },
  { why: "a head signed under the identity head attestation domain", receipt: { ...r3, head: await signEnvelope("DTP-IDENTITY-LOG-HEAD-1", head(3), [host.secret_key]) }, code: "invalid_signature" },
  { why: "a head signed by another host's key", receipt: { ...r3, head: await signLogHead(head(3), other.secret_key) }, code: "unauthorized_host" },
  { why: "a head signed by the host and a second key", receipt: { ...r3, head: await raw(head(3), host.secret_key, other.secret_key) }, code: "unauthorized_host" },
  { why: "a receipt for another record", receipt: r3, record: record(2), code: "wrong_record" },
  { why: "a leaf whose effects changed: the path no longer reaches the root", receipt: { ...receiptAt(2), leaf: { ...leaves[1], effects: [effect(1)] } }, record: record(2), code: "not_included" },
  { why: "a leaf whose accepted_at changed", receipt: { ...r3, leaf: { ...leaves[2], accepted_at: leaves[2].accepted_at - 1 } }, code: "not_included" },
  { why: "a later head with the path of an earlier size: the record is not the head's last leaf", receipt: { ...r3, head: heads[4] }, code: "not_included" },
  { why: "the path of another leaf of the same head", receipt: { ...r5, leaf: leaves[2], path: inclusionPath(hashes, 2) }, record: record(3), code: "not_included" },
  { why: "a path with one node too many", receipt: { ...r3, path: [...r3.path, hashes[0]] }, code: "not_included" },
  { why: "a path with its last node removed", receipt: { ...r5, path: r5.path.slice(0, -1) }, record: record(5), code: "not_included" },
  { why: "a leaf accepted after the head that includes it was signed", receipt: { head: lateHead, leaf: lateLeaves[2], path: inclusionPath(lateHashes, 2) }, code: "time_order" },
].map(v => ({ record: record(3), ...v, host_key: host.key_id }));

// A fork: the host signs a head of size 3 over a different third leaf.
const forked = [...hashes.slice(0, 2), leafHash({ record: record(9), accepted_at: T0 + 3000, effects: [] })];
const pair = (why: string, a: unknown, b: unknown, result: string) => ({ why, a, b, host_key: host.key_id, result });
const pairs = [
  pair("one head twice", heads[2], heads[2], "same"),
  pair("an unchanged head re-signed at a later time", heads[2], await signLogHead(head(3, T0 + 3_600_000), host.secret_key), "re-signed"),
  pair("two sizes, the larger signed later", heads[1], heads[4], "ordered"),
  pair("two heads of one size with different roots: the host equivocated", heads[2], await signLogHead({ ...head(3), root: merkleRoot(forked) }, host.secret_key), "equivocation"),
  pair("a larger head signed before a smaller one", heads[3], await signLogHead(head(5, T0 + 1000), host.secret_key), "time_order"),
  pair("heads of two different logs", heads[2], await signLogHead(head(3, T0 + 3005, OTHER_LOG), host.secret_key), "unrelated"),
];

const file = {
  description: "Core-1 host receipts (spec/core-1/README.md part 5; data-layer security proposal 5.2, S1). A receipt is { head: Signed<LogHead> under DTP-LOG-HEAD-1, leaf, path }; the record is the head's last leaf (index size - 1). Leaf hash SHA-256(0x00 || canonical leaf), node hash SHA-256(0x01 || left || right) (RFC 9162). Check, in order: structure (invalid_receipt); the head's envelope (invalid_envelope, invalid_signature) and its one signer, the host key given (unauthorized_host); that the leaf names the record (wrong_record); inclusion at index size - 1 (not_included); accepted_at <= signed_at (time_order). `pairs` compare two verified heads of one host: unrelated, same, re-signed, ordered, equivocation or time_order.",
  generated_by: "sdk/scripts/build-core1-receipt-vectors.ts",
  keys: [host, other].map(k => ({ label: k.label, key_id: k.key_id, secret_key: k.secret_key })),
  log: { log_id: LOG, leaves, leaf_hashes: hashes, roots: hashes.map((_, i) => merkleRoot(hashes.slice(0, i + 1))) },
  accept, reject, pairs,
};

const text = JSON.stringify(file, null, 2) + "\n";
const out = new URL("../../spec/core-1/vectors/receipt.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== text) { console.error("spec/core-1/vectors/receipt.json is out of date; run node scripts/build-core1-receipt-vectors.ts"); process.exit(1); }
  console.log("spec/core-1/vectors/receipt.json is up to date");
} else {
  writeFileSync(out, text);
  console.log(`wrote spec/core-1/vectors/receipt.json: ${accept.length} accepted, ${reject.length} refused, ${pairs.length} pairs`);
}
