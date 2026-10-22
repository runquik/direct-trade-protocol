// Builds spec/core-1/vectors/envelope.json: Core-1 envelopes a verifier must accept, with the key ids that signed,
// and envelopes it must refuse, with the error code. Signed with the fixed test key (spec/vectors/keys.json), so the
// file is reproducible byte for byte. Run from sdk/: node scripts/build-core1-envelope-vectors.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { signEnvelope } from "../src/core1/envelope.ts";
import { decodeSignature, encodeSignature } from "../src/keys.ts";

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

const accept = [
  { why: "a record signed by one key", domain: "DTP-RECORD-1", envelope: signed, signers: [keyId] },
  { why: "an identity genesis body under its domain", domain: "DTP-PERSON-GENESIS-1", envelope: await signEnvelope("DTP-PERSON-GENESIS-1", { identity_hint: "", operational: { keys: [keyId], threshold: 1 }, created_at: 1760000000000 }, [secret]), signers: [keyId] },
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
];

mkdirSync(new URL("../../spec/core-1/vectors/", import.meta.url), { recursive: true });
const out = {
  description: "Core-1 signed envelopes (spec/core-1/README.md, part 3). signing input = canonical({domain, body}). Verify each envelope under the given domain: accept gives the key ids that signed; reject gives the error code. Signed with the fixed test key in spec/vectors/keys.json.",
  accept, reject,
};
writeFileSync(new URL("../../spec/core-1/vectors/envelope.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("core-1 envelope vectors:", accept.length, "accept,", reject.length, "reject");
