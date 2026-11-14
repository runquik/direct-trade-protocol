// Builds spec/core-1/vectors/record.json: Core-1 signed records (DTP-RECORD-1, spec/core-1/README.md part 5) a
// verifier must accept, with their digest and signers, and records it must refuse, with the error code; plus pairs
// of records where the second must, or must not, supersede the first. Keys come from fixed seeds and Ed25519 is
// deterministic, so the file is reproducible byte for byte. Run from sdk/: node scripts/build-core1-record-vectors.ts
// (add --check to compare with the file on disk instead of writing it).
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalBytes, sha256Hex } from "../src/canonical.ts";
import { encodeKeyId, encodeSecretKey } from "../src/keys.ts";
import { sha256Sync } from "../src/sha256.ts";
import { signEnvelope } from "../src/core1/envelope.ts";
import { recordDigest, signRecord, type RecordBody } from "../src/core1/record.ts";

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string) {
  const seed = sha256Sync(`dtp-core1-record-vector:${label}`);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), { name: "Ed25519" }, true, ["sign"]);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey("jwk", key)).x!, "base64url"));
  return { label, key_id: encodeKeyId(publicKey), secret_key: encodeSecretKey(seed, publicKey) };
}
const labels = ["alice-op-1", "alice-op-2", "alice-rec", "bob-op-1", "bob-op-2", "bob-rec", "stranger"] as const;
const k = Object.fromEntries(await Promise.all(labels.map(async l => [l, await fixedKey(l)]))) as { [L in typeof labels[number]]: Awaited<ReturnType<typeof fixedKey>> };
const digest = (value: unknown) => sha256Hex(canonicalBytes(value));

// Identity-log heads (the foundation layer's Control) and a governance head, as a verifier holds them after it
// has verified the logs. The vectors give each head with its digest; how the logs are verified is part 4's.
const ALICE = "6a1f0c2e-8d4b-4f3a-9e21-0b7c5d3e2f10", BOB = "9c3e5a71-2b0d-4e6f-8a19-4d2c7b1e0f35", ORG = "2e7d9b40-6c1a-4f85-b3e2-81a0f4c6d927";
const aliceHead = { identity_id: ALICE, sequence: 2, previous_digest: "11".repeat(32), operational: { keys: [k["alice-op-1"].key_id, k["alice-op-2"].key_id], threshold: 1 }, recovery: { keys: [k["alice-rec"].key_id], threshold: 1 }, effective_at: 1762000000000 };
const bobHead = { identity_id: BOB, sequence: 0, previous_digest: null, operational: { keys: [k["bob-op-1"].key_id, k["bob-op-2"].key_id], threshold: 2 }, recovery: { keys: [k["bob-rec"].key_id], threshold: 1 }, effective_at: 1761000000000 };
const orgHead = { organization_id: ORG, sequence: 1, previous_digest: "22".repeat(32), controllers: [ALICE], threshold: 1 };
const heads = {
  alice: { head: aliceHead, head_digest: await digest(aliceHead) },
  bob: { head: bobHead, head_digest: await digest(bobHead) },
  org: { head: orgHead, head_digest: await digest(orgHead) },
};
const PROFILE = await digest({ profile: "example.note@1" }), OTHER_PROFILE = await digest({ profile: "example.other@1" });

const base: RecordBody = {
  issuer: { identity: ALICE, head: { sequence: 2, digest: heads.alice.head_digest } },
  organization: null,
  profile: PROFILE, sequence: 1, supersedes: null, issued_at: 1762000100000,
  payload: { note: "café", amount: "12.50" },
};
const forOrg: RecordBody = { ...base, organization: { id: ORG, head: { sequence: 1, digest: heads.org.head_digest } } };
const byBob: RecordBody = { ...base, issuer: { identity: BOB, head: { sequence: 0, digest: heads.bob.head_digest } } };

const sign = (body: RecordBody, ...who: (typeof labels[number])[]) => signRecord(body, who.map(l => k[l].secret_key));
// Signs without the record check, for bodies the reference refuses to sign: a verifier must still refuse them.
const raw = (body: unknown, ...who: (typeof labels[number])[]) => signEnvelope("DTP-RECORD-1", body, who.map(l => k[l].secret_key));

const first = await sign(base, "alice-op-1");
const firstDigest = await recordDigest(first);
const second = await sign({ ...base, sequence: 2, supersedes: firstDigest, issued_at: 1762000200000, payload: { note: "café", amount: "13.00" } }, "alice-op-1");
const orgFirst = await sign(forOrg, "alice-op-2");
const bobBoth = await sign(byBob, "bob-op-1", "bob-op-2");
const accepted = async (why: string, envelope: Awaited<ReturnType<typeof sign>>, person: keyof typeof heads, organization: "org" | null, signers: string[]) =>
  ({ why, envelope, profile: PROFILE, person, organization, digest: await recordDigest(envelope), signers });

const accept = [
  await accepted("a person's first record, signed by one operational key at the named head", first, "alice", null, [k["alice-op-1"].key_id]),
  await accepted("a record that supersedes the first, with the next sequence", second, "alice", null, [k["alice-op-1"].key_id]),
  await accepted("a record issued for an organisation by one of its controllers", orgFirst, "alice", "org", [k["alice-op-2"].key_id]),
  await accepted("a record whose issuer's threshold is two, signed by both operational keys", bobBoth, "bob", null, [k["bob-op-1"].key_id, k["bob-op-2"].key_id]),
  await accepted("the same record with its two signatures in the other order: the same record digest, because the digest takes the signatures in ascending order of key_id", { body: bobBoth.body, signatures: [bobBoth.signatures[1], bobBoth.signatures[0]] }, "bob", null, [k["bob-op-1"].key_id, k["bob-op-2"].key_id]),
];

const reject = [
  { why: "verified under the record domain, but the body changed after signing", envelope: { ...first, body: { ...base, payload: { note: "café", amount: "99.00" } } }, code: "invalid_signature" },
  { why: "a member beside the seven record members", envelope: await raw({ ...base, kind: "note" }, "alice-op-1"), code: "invalid_record" },
  { why: "the organization member left out rather than null", envelope: await raw(Object.fromEntries(Object.entries(base).filter(([n]) => n !== "organization")), "alice-op-1"), code: "invalid_record" },
  { why: "an issuer identity that is not a lower-case UUID", envelope: await raw({ ...base, issuer: { ...base.issuer, identity: ALICE.toUpperCase() } }, "alice-op-1"), code: "invalid_record" },
  { why: "a head digest that is not lower-case SHA-256 hex", envelope: await raw({ ...base, issuer: { ...base.issuer, head: { sequence: 2, digest: "sha256:" + heads.alice.head_digest } } }, "alice-op-1"), code: "invalid_record" },
  { why: "a profile that is not a digest", envelope: await raw({ ...base, profile: "example.note@1" }, "alice-op-1"), code: "invalid_record" },
  { why: "sequence 0", envelope: await raw({ ...base, sequence: 0 }, "alice-op-1"), code: "invalid_record" },
  { why: "a record that supersedes nothing but has sequence 2", envelope: await raw({ ...base, sequence: 2 }, "alice-op-1"), code: "invalid_record" },
  { why: "a record that supersedes another but has sequence 1", envelope: await raw({ ...base, supersedes: firstDigest }, "alice-op-1"), code: "invalid_record" },
  { why: "a payload that is an array", envelope: await raw({ ...base, payload: ["café"] }, "alice-op-1"), code: "invalid_record" },
  { why: "an issued_at that is an ISO-8601 string (Core-1 metadata time is integer ms)", envelope: await raw({ ...base, issued_at: "2025-11-01T12:01:40.000Z" }, "alice-op-1"), code: "invalid_record" },
  { why: "a record of another profile than the verifier expects", envelope: await sign({ ...base, profile: OTHER_PROFILE }, "alice-op-1"), profile: PROFILE, code: "unexpected_profile" },
  { why: "a record naming an older head than the one given", envelope: await sign({ ...base, issuer: { ...base.issuer, head: { sequence: 1, digest: "33".repeat(32) } } }, "alice-op-1"), person: "alice", code: "wrong_head" },
  { why: "a signer that is not an operational key at the named head (a recovery key)", envelope: await sign(base, "alice-rec"), person: "alice", code: "unauthorized_signer" },
  { why: "an operational key with a key from outside the head beside it", envelope: await sign(base, "alice-op-1", "stranger"), person: "alice", code: "unauthorized_signer" },
  { why: "one of two keys where the issuer's threshold is two", envelope: await sign(byBob, "bob-op-1"), person: "bob", code: "unauthorized_signer" },
  { why: "a record for an organisation whose controllers do not include the issuer", envelope: await sign({ ...byBob, organization: forOrg.organization }, "bob-op-1", "bob-op-2"), person: "bob", organization: "org", code: "unauthorized_signer" },
  { why: "a record for an organisation checked without its governance head", envelope: orgFirst, person: "alice", code: "wrong_head" },
  { why: "a record for an organisation naming another governance head", envelope: await sign({ ...forOrg, organization: { id: ORG, head: { sequence: 0, digest: "44".repeat(32) } } }, "alice-op-1"), person: "alice", organization: "org", code: "wrong_head" },
];

const supersession = {
  accept: [{ why: "the next sequence, the previous digest, the same profile and issuer", previous: first, next: second }],
  reject: [
    { why: "names another digest", previous: first, next: await sign({ ...base, sequence: 2, supersedes: "55".repeat(32) }, "alice-op-1"), code: "broken_supersession" },
    { why: "skips a sequence", previous: first, next: await sign({ ...base, sequence: 3, supersedes: firstDigest }, "alice-op-1"), code: "broken_supersession" },
    { why: "changes the profile", previous: first, next: await sign({ ...base, profile: OTHER_PROFILE, sequence: 2, supersedes: firstDigest }, "alice-op-1"), code: "broken_supersession" },
    { why: "another person supersedes it", previous: first, next: await sign({ ...byBob, sequence: 2, supersedes: firstDigest }, "bob-op-1", "bob-op-2"), code: "broken_supersession" },
    { why: "the same person supersedes a personal record with one issued for an organisation", previous: first, next: await sign({ ...forOrg, sequence: 2, supersedes: firstDigest }, "alice-op-1"), code: "broken_supersession" },
  ],
};

const out = {
  description: "Core-1 signed records (spec/core-1/README.md, part 5): Signed<Record> under DTP-RECORD-1. For accept: verify the envelope under DTP-RECORD-1, check the body and the expected profile, check the signers against heads[person] and, when organization is set, heads[organization]; the record digest (SHA-256 of the canonical envelope, signatures included and taken in ascending order of key_id, so the order they arrive in does not change it) and the signers must match. For reject: run the same steps, using profile, person and organization when given, and expect the code. For supersession: both records verify; check that next supersedes previous. Keys come from fixed seeds; never use them for anything real.",
  keys: labels.map(l => k[l]),
  heads, accept, reject, supersession,
};
const text = JSON.stringify(out, null, 2) + "\n";
const path = new URL("../../spec/core-1/vectors/record.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text) { console.error("spec/core-1/vectors/record.json is out of date: run node scripts/build-core1-record-vectors.ts"); process.exit(1); }
  console.log("core-1 record vectors: up to date");
} else {
  writeFileSync(path, text);
  console.log("core-1 record vectors:", accept.length, "accept,", reject.length, "reject,", supersession.accept.length + supersession.reject.length, "supersession");
}
