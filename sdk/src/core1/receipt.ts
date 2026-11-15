// Core-1 host receipts (spec/core-1/README.md, part 5; data-layer security proposal 5.2, S1 and S20): a host that
// accepts a record appends a leaf for it to an RFC 9162 Merkle log and signs the new head under DTP-LOG-HEAD-1.
// The receipt is that head, the leaf, and the leaf's inclusion path; the record is the head's last leaf. No
// platform imports.
//
//   Leaf    = { record: <record digest>, accepted_at: <integer ms>, effects: [<digest>, ...] }    // 0..64 effects
//   LogHead = { log_id: <uuid>, size: <integer >= 1>, root: <hex>, signed_at: <integer ms> }
//   Receipt = { head: Signed<LogHead>, leaf: Leaf, path: [<hex>, ...] }                      // leaf index = size - 1
//
// Leaf hash SHA-256(0x00 || canonical leaf), node hash SHA-256(0x01 || left || right), as RFC 9162 section 2.1.1.
// A verifier needs the inclusion check (RFC 9162 section 2.1.3.2) and one Ed25519 verification.

import { bytesToHex, canonicalBytes, hexToBytes } from "../canonical.ts";
import { sha256Sync } from "../sha256.ts";
import { EnvelopeError, signEnvelope, verifyEnvelope, type Signed } from "./envelope.ts";

export const LOG_HEAD_DOMAIN = "DTP-LOG-HEAD-1";
export const MAX_EFFECTS = 64;
/** A path never needs more than 53 nodes: a log's size is a safe integer. */
export const MAX_PATH = 53;

export interface Leaf { record: string; accepted_at: number; effects: string[] }
export interface LogHead { log_id: string; size: number; root: string; signed_at: number }
export interface Receipt { head: Signed<LogHead>; leaf: Leaf; path: string[] }

export type ReceiptErrorCode = "invalid_receipt" | "unauthorized_host" | "wrong_record" | "not_included" | "time_order";
export class ReceiptError extends Error {
  readonly code: ReceiptErrorCode;
  constructor(code: ReceiptErrorCode, message: string) {
    super(message);
    this.name = "ReceiptError";
    this.code = code;
  }
}

const fail = (code: ReceiptErrorCode, message: string): never => { throw new ReceiptError(code, message); };
const invalid = (message: string): never => fail("invalid_receipt", message);
const isObject = (value: unknown): value is { [name: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const exactly = (value: unknown, members: string[], what: string): { [name: string]: unknown } => {
  if (!isObject(value)) invalid(`${what} is an object`);
  const object = value as { [name: string]: unknown };
  const names = Object.keys(object);
  if (names.length !== members.length || !members.every(m => Object.hasOwn(object, m))) invalid(`${what} must have exactly the members ${members.join(", ")}`);
  return object;
};
const count = (value: unknown, min: number, what: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < min) invalid(`${what} is an integer of at least ${min}`);
};
const digest = (value: unknown, what: string) => {
  if (typeof value !== "string" || !HEX.test(value)) invalid(`${what} is lower-case SHA-256 hex`);
};

/** Checks that `value` is a Leaf, member by member (`invalid_receipt`). */
export function parseLeaf(value: unknown): Leaf {
  const leaf = exactly(value, ["record", "accepted_at", "effects"], "a leaf");
  digest(leaf.record, "leaf.record");
  count(leaf.accepted_at, 0, "leaf.accepted_at");
  if (!Array.isArray(leaf.effects) || leaf.effects.length > MAX_EFFECTS) invalid(`leaf.effects is a list of at most ${MAX_EFFECTS} digests`);
  (leaf.effects as unknown[]).forEach((e, i) => digest(e, `leaf.effects[${i}]`));
  return leaf as unknown as Leaf;
}

/** Checks that `value` is a LogHead, member by member (`invalid_receipt`). */
export function parseLogHead(value: unknown): LogHead {
  const head = exactly(value, ["log_id", "size", "root", "signed_at"], "a log head");
  if (typeof head.log_id !== "string" || !UUID.test(head.log_id)) invalid("log_id is a lower-case UUID");
  count(head.size, 1, "size");
  digest(head.root, "root");
  count(head.signed_at, 0, "signed_at");
  return head as unknown as LogHead;
}

const LEAF_PREFIX = Uint8Array.of(0x00), NODE_PREFIX = Uint8Array.of(0x01);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256Sync(concat(NODE_PREFIX, left, right));

/** RFC 9162 leaf hash of a leaf: SHA-256(0x00 || canonical leaf), in lower-case hex. */
export function leafHash(leaf: Leaf): string {
  return bytesToHex(sha256Sync(concat(LEAF_PREFIX, canonicalBytes(leaf))));
}

const largestPowerOfTwoBelow = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
function treeHash(hashes: Uint8Array[]): Uint8Array {
  if (hashes.length === 1) return hashes[0];
  const k = largestPowerOfTwoBelow(hashes.length);
  return nodeHash(treeHash(hashes.slice(0, k)), treeHash(hashes.slice(k)));
}

/** RFC 9162 Merkle tree hash over the leaf hashes (see leafHash), in order. A log with a head has at least one leaf. */
export function merkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) throw new RangeError("a log head covers at least one leaf");
  return bytesToHex(treeHash(leafHashes.map(hexToBytes)));
}

/** RFC 9162 inclusion path for the leaf at `index` in the tree over `leafHashes` (section 2.1.3.1), lower-case hex. */
export function inclusionPath(leafHashes: string[], index: number): string[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= leafHashes.length) throw new RangeError("the index is not a leaf of the tree");
  const path = (m: number, hashes: Uint8Array[]): Uint8Array[] => {
    if (hashes.length === 1) return [];
    const k = largestPowerOfTwoBelow(hashes.length);
    return m < k ? [...path(m, hashes.slice(0, k)), treeHash(hashes.slice(k))] : [...path(m - k, hashes.slice(k)), treeHash(hashes.slice(0, k))];
  };
  return path(index, leafHashes.map(hexToBytes)).map(bytesToHex);
}

/** RFC 9162 section 2.1.3.2: whether `path` proves the leaf hash at `index` in a tree of `size` with `root`. */
export function verifyInclusion(leafHashHex: string, index: number, size: number, path: string[], root: string): boolean {
  if (index >= size) return false;
  let fn = index, sn = size - 1;
  let r = hexToBytes(leafHashHex);
  for (const p of path) {
    if (sn === 0) return false;
    const node = hexToBytes(p);
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(node, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else {
      r = nodeHash(r, node);
    }
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && bytesToHex(r) === root;
}

/** Signs a log head under DTP-LOG-HEAD-1 with the host's key. Refuses a body that is not a LogHead. */
export async function signLogHead(head: LogHead, hostSecretKey: string): Promise<Signed<LogHead>> {
  parseLogHead(structuredClone(head));
  return signEnvelope(LOG_HEAD_DOMAIN, head, [hostSecretKey]);
}

/**
 * Verifies a Signed<LogHead>: the envelope under DTP-LOG-HEAD-1 (EnvelopeError), the body (`invalid_receipt`), and
 * that exactly one key signed it, the host key the caller names (`unauthorized_host`).
 */
export async function verifyLogHead(signed: unknown, hostKey: string): Promise<LogHead> {
  const { body, signers } = await verifyEnvelope(LOG_HEAD_DOMAIN, signed);
  const head = parseLogHead(body);
  if (signers.size !== 1 || !signers.has(hostKey)) fail("unauthorized_host", "a log head is signed by exactly the host's key");
  return head;
}

/**
 * Verifies a receipt for the record with digest `recordDigest`, against the host key the caller names. In order:
 * the receipt's structure (`invalid_receipt`); the head's envelope (EnvelopeError) and signer (`unauthorized_host`);
 * that the leaf names this record (`wrong_record`); that the leaf is the head's last leaf, by the inclusion path
 * (`not_included`); and that the leaf was accepted no later than the head was signed (`time_order`). Returns the head
 * and the leaf; `leaf.accepted_at` is the host's signed acceptance time.
 */
export async function verifyReceipt(receipt: unknown, recordDigest: string, hostKey: string): Promise<{ head: LogHead; leaf: Leaf }> {
  const r = exactly(receipt, ["head", "leaf", "path"], "a receipt");
  const leaf = parseLeaf(r.leaf);
  if (!Array.isArray(r.path) || r.path.length > MAX_PATH) invalid(`path is a list of at most ${MAX_PATH} node hashes`);
  (r.path as unknown[]).forEach((p, i) => digest(p, `path[${i}]`));
  const head = await verifyLogHead(r.head, hostKey);
  if (leaf.record !== recordDigest) fail("wrong_record", "the receipt's leaf names another record");
  if (!verifyInclusion(leafHash(leaf), head.size - 1, head.size, r.path as string[], head.root)) fail("not_included", "the leaf is not the last leaf of the signed head");
  if (leaf.accepted_at > head.signed_at) fail("time_order", "the leaf was accepted after the head that includes it was signed");
  return { head, leaf };
}

/**
 * Compares two log heads, each already verified against the same host key. `unrelated`: different logs.
 * `same`: identical. `re-signed`: same size and root, a later or earlier `signed_at`. `ordered`: different sizes
 * whose times run with their sizes (whether the larger extends the smaller is a consistency proof's question).
 * `equivocation`: same size, different roots, portable proof that the host forked its log. `time_order`: the larger
 * head was signed before the smaller one, which no honest host does.
 */
export function compareLogHeads(a: LogHead, b: LogHead): "unrelated" | "same" | "re-signed" | "ordered" | "equivocation" | "time_order" {
  if (a.log_id !== b.log_id) return "unrelated";
  if (a.size === b.size) {
    if (a.root !== b.root) return "equivocation";
    return a.signed_at === b.signed_at ? "same" : "re-signed";
  }
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  return large.signed_at < small.signed_at ? "time_order" : "ordered";
}

export { EnvelopeError };
