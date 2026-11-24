// Core-1's one signed envelope (spec/core-1/README.md, part 3). No platform imports; runs on any runtime.
//
//   Signed<T>     = { body: T, signatures: [{ key_id, signature }, ...] }
//   signing input = canonical({ domain, body })
//
// Every signed object in Core-1 has this shape and this signing rule; only the domain differs. The domain names
// what the body is and its format version, is permanent, is never derived from a software release, and is
// supplied by the verifier from context, never read from the message. Several signatures over the same input
// express a threshold; who must sign is the caller's rule (see meetsQuorum), not the envelope's.

import { CanonicalizationError, FloatNotAllowedError, canonicalBytes } from "../canonical.ts";
import { decodeKeyId, decodeSignature, encodeSignature, keyPairFromSecret, signBytes, verifyBytes } from "../keys.ts";
import { assertSafeMemberNames, parseUntrustedJson, parseUntrustedJsonBytes } from "../safe-json.ts";

export interface Signature { key_id: string; signature: string }
export interface Signed<T> { body: T; signatures: Signature[] }
export interface KeySet { keys: string[]; threshold: number }

/** The domains a Core-1 verifier implements: identity (part 4) and records (part 5). Extensions add their own. */
export const CORE1_DOMAINS = Object.freeze([
  "DTP-PERSON-GENESIS-1",
  "DTP-IDENTITY-TRANSITION-1",
  "DTP-IDENTITY-REHOME-1",
  "DTP-IDENTITY-LOG-HEAD-1",
  "DTP-ORGANIZATION-GENESIS-1",
  "DTP-ORGANIZATION-TRANSITION-1",
  "DTP-ORGANIZATION-CONSENT-1",
  "DTP-RECORD-1",
] as const);

/** A domain's shape: `DTP-` then upper-case words, ending in its format version, such as DTP-RECORD-1. */
const DOMAIN = /^DTP-[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[1-9][0-9]*$/;

export class EnvelopeError extends Error {
  readonly code: "invalid_envelope" | "invalid_signature";
  constructor(code: "invalid_envelope" | "invalid_signature", message: string) {
    super(message);
    this.name = "EnvelopeError";
    this.code = code;
  }
}

const refuse = (message: string): never => { throw new EnvelopeError("invalid_envelope", message); };
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactly = (value: Record<string, unknown>, members: string[], what: string) => {
  const names = Object.keys(value);
  if (names.length !== members.length || !members.every(m => Object.hasOwn(value, m))) refuse(`${what} must have exactly the members ${members.join(", ")}`);
};

/** Core-1 part 1: a signed body nests at most this many levels. The body itself is level 0; each array or object adds one. */
export const MAX_DEPTH = 48;

/**
 * Refuses a body that nests deeper than MAX_DEPTH, without recursion, so the answer depends on the value alone and never
 * on the stack. Runs before canonicalization on both the signing and the verifying side.
 */
function assertDepth(body: unknown): void {
  const pending: [unknown, number][] = [[body, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (depth > MAX_DEPTH) refuse(`the body nests deeper than ${MAX_DEPTH} levels`);
    if (value !== null && typeof value === "object") for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
}

/**
 * Core-1 part 1: reads a received Core-1 text (an envelope, a record, an identity or governance log, a bundle) the way
 * every Core-1 receiver must, before anything is verified. On the raw text, before parsing, it refuses a member name
 * written with an escape sequence (`unsafe_member_name`), an object that names a member twice (`duplicate_member_name`)
 * and a number written with a fraction or an exponent (`non_integer_number`, #217), as an UnsafeJsonError with that
 * code. The integer rule is lexical, so `1.0`, `2.0`, `1.7620001e12` and `1.0000000000000001` are refused whatever value
 * a parser would give them: whether a text is valid depends on its bytes alone. Bytes must be UTF-8.
 */
export function parseCore1Text(text: string | Uint8Array): unknown {
  return typeof text === "string" ? parseUntrustedJson(text, { integerNumbers: true }) : parseUntrustedJsonBytes(text, { integerNumbers: true });
}

/** The bytes every signer signs and every verifier checks, for one domain and one body. */
export function signingInput(domain: string, body: unknown): Uint8Array {
  if (typeof domain !== "string" || !DOMAIN.test(domain)) refuse(`not a domain: ${String(domain)}`);
  return canonicalBytes({ domain, body });
}

/**
 * Signs `body` under `domain` with each secret key, in order. Refuses a body a receiver would refuse (a member
 * name that needs an escape, a number that is not a safe integer), so nothing unverifiable is ever produced.
 */
export async function signEnvelope<T>(domain: string, body: T, secretKeys: string[]): Promise<Signed<T>> {
  if (!Array.isArray(secretKeys) || secretKeys.length === 0) refuse("at least one key signs");
  assertDepth(body);
  const copied = structuredClone(body);
  assertSafeMemberNames(copied);
  const bytes = signingInput(domain, copied);
  const signatures: Signature[] = [];
  for (const secret of secretKeys) {
    const pair = await keyPairFromSecret(secret);
    if (signatures.some(s => s.key_id === pair.keyId)) refuse(`${pair.keyId} would sign twice`);
    signatures.push({ key_id: pair.keyId, signature: encodeSignature(await signBytes(secret, bytes)) });
  }
  return { body: copied, signatures };
}

/**
 * Verifies an envelope under the domain the caller expects. Returns the key ids that signed. Refuses the whole
 * envelope, rather than ignoring a part, if it has any other member, if a signature entry has any other member, if a
 * key signs twice, if any signature fails strict Ed25519 verification, if the signing input exceeds `maxBytes`, if the
 * body nests deeper than MAX_DEPTH levels (checked first, before canonicalization), or if the body is not I-JSON (a number that is not a safe integer, or a lone surrogate in a string). Every refusal is an
 * EnvelopeError: a body that cannot be canonicalized is `invalid_envelope`, never a canonicalization error.
 */
export async function verifyEnvelope<T = unknown>(domain: string, signed: unknown, { maxBytes = 65_536, maxSignatures = 24 } = {}): Promise<{ body: T; signers: Set<string> }> {
  if (!isObject(signed)) refuse("an envelope is an object");
  const envelope = signed as Record<string, unknown>;
  exactly(envelope, ["body", "signatures"], "an envelope");
  const list = envelope.signatures;
  if (!Array.isArray(list) || list.length === 0 || list.length > maxSignatures) refuse(`an envelope carries 1 to ${maxSignatures} signatures`);
  assertDepth(envelope.body);
  let bytes: Uint8Array;
  try { bytes = signingInput(domain, envelope.body); } catch (error) {
    if (error instanceof FloatNotAllowedError || error instanceof CanonicalizationError) refuse(`the body is not I-JSON: ${error.message}`);
    throw error;
  }
  if (bytes.length > maxBytes) refuse(`the signing input exceeds ${maxBytes} bytes`);
  const signers = new Set<string>();
  for (const entry of list as unknown[]) {
    if (!isObject(entry)) refuse("a signature entry is an object");
    const s = entry as Record<string, unknown>;
    exactly(s, ["key_id", "signature"], "a signature entry");
    if (typeof s.key_id !== "string" || typeof s.signature !== "string" || s.signature.length > 128) refuse("a signature entry holds a key id and a signature");
    const keyId = s.key_id as string;
    try { decodeKeyId(keyId); } catch { refuse(`not a key id: ${keyId}`); }
    if (signers.has(keyId)) refuse(`${keyId} signs twice`);
    let raw: Uint8Array;
    try { raw = decodeSignature(s.signature as string); } catch { throw new EnvelopeError("invalid_signature", `the signature by ${keyId} is not a signature`); }
    if (!(await verifyBytes(keyId, bytes, raw))) throw new EnvelopeError("invalid_signature", `the signature by ${keyId} does not verify`);
    signers.add(keyId);
  }
  return { body: envelope.body as T, signers };
}

/** Whether the signers include at least `threshold` of the set's keys. */
export function meetsQuorum(keys: KeySet, signers: Set<string>): boolean {
  return keys.keys.filter(k => signers.has(k)).length >= keys.threshold;
}
