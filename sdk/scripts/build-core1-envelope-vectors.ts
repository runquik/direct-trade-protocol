// Builds spec/core-1/vectors/envelope.json: Core-1 envelopes a verifier must accept, with the key ids that signed,
// and envelopes it must refuse, with the error code. Signed with the fixed test key (spec/vectors/keys.json), so the
// file is reproducible byte for byte. Run from sdk/: node scripts/build-core1-envelope-vectors.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { MAX_SIGNATURES, MAX_SIGNATURE_TEXT, MAX_SIGNING_INPUT_BYTES, signEnvelope, signingInput, type Signed } from "../src/core1/envelope.ts";
import { decodeSignature, encodeKeyId, encodeSecretKey, encodeSignature, signBytes, type KeyPair } from "../src/keys.ts";
import { sha256Sync } from "../src/sha256.ts";

const keys = JSON.parse(readFileSync(new URL("../../spec/vectors/keys.json", import.meta.url), "utf8"));
const secret: string = keys.secret_key, keyId: string = keys.key_id;

const record = { issuer: "0b6f1d2e-4c3a-4e8b-9f10-2a3b4c5d6e7f", profile: "sha256:" + "ab".repeat(32), sequence: 1, payload: { note: "café", amount: "12.50" } };
const signed = await signEnvelope("DTP-RECORD-1", record, [secret]);

// The same signature with S + L: the same point equation holds, but S is not canonical (RFC 8032 section 5.1.7).
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const raw = decodeSignature(signed.signatures[0].signature);
let s = 0n; for (let i = 63; i >= 32; i--) s = (s << 8n) + BigInt(raw[i]);
const bumped = s + L, highS = raw.slice();
for (let i = 32, v = bumped; i < 64; i++, v >>= 8n) highS[i] = Number(v & 0xffn);

// Core-1 part 1: a signed body nests at most 48 levels; the body is level 0 and each array adds one.
const nested = (depth: number): unknown => { let v: unknown = 0; for (let i = 0; i < depth; i++) v = [v]; return v; };

// Core-1 part 3 (#218): fixed bounds on the signing input and the signatures. Keys from fixed seeds, so the file stays
// reproducible; they are published test keys, never for anything real.
const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-core1-envelope-vector:${label}`);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), { name: "Ed25519" }, true, ["sign"]);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey("jwk", key)).x!, "base64url"));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const many = await Promise.all(Array.from({ length: MAX_SIGNATURES + 1 }, (_, i) => fixedKey(`signer-${i}`)));
// Past a bound the reference signer refuses, so these are signed byte by byte: every signature is genuine, and a
// verifier that skipped the bound would accept the envelope.
async function signPastBounds<T>(domain: string, body: T, signers: KeyPair[]): Promise<Signed<T>> {
  const bytes = signingInput(domain, body);
  return { body, signatures: await Promise.all(signers.map(async k => ({ key_id: k.keyId, signature: encodeSignature(await signBytes(k.secretKey, bytes)) }))) };
}
const padding = MAX_SIGNING_INPUT_BYTES - signingInput("DTP-RECORD-1", { note: "" }).length;
const sized = (bytes: number) => ({ note: "x".repeat(padding - MAX_SIGNING_INPUT_BYTES + bytes) });
const threshold = { organization_id: "0b6f1d2e-4c3a-4e8b-9f10-2a3b4c5d6e7f", sequence: 2 };
// A signature text one character past the bound: the real signature with leading base58 zeros. A verifier that
// skipped the length check would decode it and answer invalid_signature instead.
const long = signed.signatures[0].signature.replace("ed25519:", "ed25519:" + "1".repeat(MAX_SIGNATURE_TEXT + 1 - signed.signatures[0].signature.length));

const accept = [
  { why: "a record signed by one key", domain: "DTP-RECORD-1", envelope: signed, signers: [keyId] },
  { why: "an identity genesis body under its domain", domain: "DTP-PERSON-GENESIS-1", envelope: await signEnvelope("DTP-PERSON-GENESIS-1", { identity_hint: "", operational: { keys: [keyId], threshold: 1 }, created_at: 1760000000000 }, [secret]), signers: [keyId] },
  { why: "a body nested exactly 48 levels deep, the Core-1 limit", domain: "DTP-RECORD-1", envelope: await signEnvelope("DTP-RECORD-1", nested(48), [secret]), signers: [keyId] },
  { why: "a signing input of exactly 65536 bytes, the Core-1 limit", domain: "DTP-RECORD-1", envelope: await signEnvelope("DTP-RECORD-1", sized(MAX_SIGNING_INPUT_BYTES), [secret]), signers: [keyId] },
  { why: "24 signatures over one input, the Core-1 limit", domain: "DTP-ORGANIZATION-TRANSITION-1", envelope: await signEnvelope("DTP-ORGANIZATION-TRANSITION-1", threshold, many.slice(0, MAX_SIGNATURES).map(k => k.secretKey)), signers: many.slice(0, MAX_SIGNATURES).map(k => k.keyId) },
];
const reject = [
  { why: "verified under another domain than it was signed under", domain: "DTP-PERSON-GENESIS-1", envelope: signed, code: "invalid_signature" },
  { why: "the body changed after signing", domain: "DTP-RECORD-1", envelope: { ...signed, body: { ...record, sequence: 2 } }, code: "invalid_signature" },
  { why: "a signature whose S is not canonical (S + L)", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [{ key_id: keyId, signature: encodeSignature(highS) }] }, code: "invalid_signature" },
  { why: "a member beside body and signatures", domain: "DTP-RECORD-1", envelope: { ...signed, domain: "DTP-RECORD-1" }, code: "invalid_envelope" },
  { why: "a member beside key_id and signature", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [{ ...signed.signatures[0], alg: "Ed25519" }] }, code: "invalid_envelope" },
  { why: "the same key signing twice", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [signed.signatures[0], signed.signatures[0]] }, code: "invalid_envelope" },
  { why: "no signatures", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [] }, code: "invalid_envelope" },
  { why: "a key id that is not a key", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [{ key_id: "ed25519:not-a-key", signature: signed.signatures[0].signature }] }, code: "invalid_envelope" },
  { why: "a domain that names no format version", domain: "DTP-RECORD", envelope: signed, code: "invalid_envelope" },
  { why: "a body holding a number with a fraction", domain: "DTP-RECORD-1", envelope: { ...signed, body: { ...record, sequence: 1.5 } }, code: "invalid_envelope" },
  { why: "a body holding an integer beyond 2^53-1", domain: "DTP-RECORD-1", envelope: { ...signed, body: { ...record, sequence: 2 ** 53 } }, code: "invalid_envelope" },
  { why: "a body holding a lone surrogate in a string value", domain: "DTP-RECORD-1", envelope: { ...signed, body: { ...record, payload: { ...record.payload, note: "caf\ud800" } } }, code: "invalid_envelope" },
  // The reference cannot sign this body (signing refuses it too), so the signature is the base record's: the depth
  // is checked before any signature, and a verifier that skipped the check would answer invalid_signature instead.
  { why: "a body nested 49 levels deep, one past the Core-1 limit", domain: "DTP-RECORD-1", envelope: { body: nested(49), signatures: signed.signatures }, code: "invalid_envelope" },
  { why: "a signing input of 65537 bytes, one past the Core-1 limit, with a genuine signature", domain: "DTP-RECORD-1", envelope: await signPastBounds("DTP-RECORD-1", sized(MAX_SIGNING_INPUT_BYTES + 1), [{ keyId, secretKey: secret } as KeyPair]), code: "invalid_envelope" },
  { why: "25 genuine signatures over one input, one past the Core-1 limit", domain: "DTP-ORGANIZATION-TRANSITION-1", envelope: await signPastBounds("DTP-ORGANIZATION-TRANSITION-1", threshold, many), code: "invalid_envelope" },
  { why: "a signature text of 129 characters, one past the Core-1 limit (checked before decoding, so not invalid_signature)", domain: "DTP-RECORD-1", envelope: { ...signed, signatures: [{ key_id: keyId, signature: long }] }, code: "invalid_envelope" },
];
if (signingInput("DTP-RECORD-1", sized(MAX_SIGNING_INPUT_BYTES)).length !== MAX_SIGNING_INPUT_BYTES || long.length !== MAX_SIGNATURE_TEXT + 1) throw new Error("generator: a bound case is not at its bound");

mkdirSync(new URL("../../spec/core-1/vectors/", import.meta.url), { recursive: true });
const out = {
  description: "Core-1 signed envelopes (spec/core-1/README.md, part 3). signing input = canonical({domain, body}). Verify each envelope under the given domain: accept gives the key ids that signed; reject gives the error code. Signed with the fixed test key in spec/vectors/keys.json, and, for the signature-count bound, keys from fixed seeds. The bounds of part 3 are fixed: a signing input of at most 65536 bytes, 1 to 24 signatures, a signature text of at most 128 characters.",
  accept, reject,
};
writeFileSync(new URL("../../spec/core-1/vectors/envelope.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("core-1 envelope vectors:", accept.length, "accept,", reject.length, "reject");
