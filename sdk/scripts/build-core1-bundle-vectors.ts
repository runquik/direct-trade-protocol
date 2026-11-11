// Builds spec/core-1/vectors/bundle.json: Core-1 exchange bundles (spec/core-1/README.md part 5) a recipient must
// accept offline, with the record digest, signers and receipt time they give, and bundles it must refuse, with the
// error code, including the backdating rule (`stale_head`, S2 of the data-layer security proposal). The identity
// and governance logs are real ones, replayable from their genesis. Keys come from fixed seeds and Ed25519 is
// deterministic, so the file is reproducible byte for byte. Run from sdk/: node scripts/build-core1-bundle-vectors.ts
// (add --check to compare with the file on disk instead of writing it).
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalBytes, sha256Hex } from "../src/canonical.ts";
import { encodeKeyId, encodeSecretKey, type KeyPair } from "../src/keys.ts";
import { sha256HexSync, sha256Sync } from "../src/sha256.ts";
import { createIdentity, signIdentity, type Transition } from "../src/foundation/identity.ts";
import { buildIdentityLog, verifyIdentityLog, type IdentityLog, type IdentityLogParts } from "../src/foundation/identity-log.ts";
import { controlFromIdentityLogs, governanceTransitionDigest, organizationGenesisDigest, organizationId, signOrganizationConsent, verifyGovernanceLog,
  GOVERNANCE_LOG_FORMAT, ORGANIZATION_WINDOW_MS, type GovernanceLog, type GovernanceTransition, type OrganizationGenesis } from "../src/foundation/organization.ts";
import { recordDigest, signRecord, type RecordBody } from "../src/core1/record.ts";
import { inclusionPath, leafHash, merkleRoot, signLogHead, type Leaf } from "../src/core1/receipt.ts";
import { verifyBundle, type Bundle } from "../src/core1/bundle.ts";

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair & { label: string }> {
  const seed = sha256Sync(`dtp-core1-bundle-vector:${label}`);
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8, ...seed]), { name: "Ed25519" }, true, ["sign"]);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey("jwk", key)).x!, "base64url"));
  return { label, keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const labels = ["alice-op-0", "alice-op-1", "alice-op-fork", "alice-rec", "bob-op-1", "bob-op-2", "bob-rec", "resolver", "host", "other-host"] as const;
const k = Object.fromEntries(await Promise.all(labels.map(async l => [l, await fixedKey(l)]))) as Record<typeof labels[number], KeyPair & { label: string }>;
const clone = <V>(v: V): V => structuredClone(v);
const T = 1_800_000_000_000, resolverId = "5e5e5e5e-0000-4000-8000-00000000000d", audience = "https://resolver.example";

/** A person enrolled at the fixed resolver, every head attested, with an optional rotation at head 1. */
async function person(ops: KeyPair[], threshold: number, rec: KeyPair, nonce: string, rotateTo: KeyPair | null) {
  const genesis = await signIdentity("DTP-PERSON-GENESIS-1", { nonce, operational: { keys: ops.map(o => o.keyId), threshold }, recovery: { keys: [rec.keyId], threshold: 1 } }, [...ops, rec]);
  const state = await createIdentity(genesis, { id: resolverId, key_id: k.resolver.keyId }, T + 1_000), id = state.head.identity_id;
  const enrollment = await signIdentity("DTP-IDENTITY-ENROLLMENT-1", { identity_id: id, genesis_digest: state.genesis_digest, resolver_id: resolverId, resolver_key: k.resolver.keyId, audience, nonce: "e".repeat(64), issued_at: T, expires_at: T + 300_000 }, [...ops, rec]);
  const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: T + 1_000, transition: null, rehome: null, attestation: null }] };
  const genesisOnly = await buildIdentityLog(parts, k.resolver);
  let full = genesisOnly;
  if (rotateTo !== null) {
    const command = await signIdentity<Transition>("DTP-IDENTITY-TRANSITION-1", { identity_id: id, expected_digest: state.head_digest, sequence: 1, kind: "rotate", operational: { keys: [rotateTo.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: T + 50_000, expires_at: T + 350_000 }, [...ops, rotateTo]);
    full = await buildIdentityLog({ ...parts, entries: [...parts.entries, { effective_at: T + 50_500, transition: command, rehome: null, attestation: null }] }, k.resolver);
  }
  const verified = await verifyIdentityLog(full, { require_attestation: true });
  return { id, genesisOnly, log: full, heads: verified.heads };
}
const alice = await person([k["alice-op-0"]], 1, k["alice-rec"], "0f0e0d0c-0b0a-4908-8706-050403020110", k["alice-op-1"]);
// The same genesis with another rotation: a fork of Alice's history, as a thief holding her recovery key could sign.
const aliceFork = await person([k["alice-op-0"]], 1, k["alice-rec"], "0f0e0d0c-0b0a-4908-8706-050403020110", k["alice-op-fork"]);
const bob = await person([k["bob-op-1"], k["bob-op-2"]], 1, k["bob-rec"], "0f0e0d0c-0b0a-4908-8706-050403020111", null);
const E1 = alice.heads[1].head.effective_at;

// An organisation founded by Alice and Bob (either may act alone); at governance head 1, Alice is removed.
const genesis: OrganizationGenesis = { nonce: "00010203-0405-4607-8809-0a0b0c0d0e1f", founder: alice.id, controllers: [alice.id, bob.id].sort(), threshold: 1 };
const orgId = await organizationId(genesis), genesisDigest = await organizationGenesisDigest(genesis);
const consent = (who: { id: string; heads: typeof alice.heads }, keys: KeyPair[], subject: "genesis" | "transition", digest: string, at: number) =>
  signOrganizationConsent({ organization_id: orgId, subject, digest, person_id: who.id, head_digest: who.heads[0].head_digest, issued_at: at, expires_at: at + 3_600_000 }, keys);
const govGenesisOnly: GovernanceLog = { format: GOVERNANCE_LOG_FORMAT, genesis, consents: [await consent(alice, [k["alice-op-0"]], "genesis", genesisDigest, T + 10_000), await consent(bob, [k["bob-op-1"]], "genesis", genesisDigest, T + 10_500)], entries: [] };
const lookup = controlFromIdentityLogs([await verifyIdentityLog(alice.log, { require_attestation: true }), await verifyIdentityLog(bob.log, { require_attestation: true })]);
const gov0 = (await verifyGovernanceLog(govGenesisOnly, lookup)).heads[0];
const TG1 = T + 100_000;
const t1: GovernanceTransition = { organization_id: orgId, expected_digest: gov0.head_digest, sequence: 1, controllers: [bob.id], threshold: 1, issued_at: TG1, expires_at: TG1 + ORGANIZATION_WINDOW_MS };
const govFull: GovernanceLog = { ...clone(govGenesisOnly), entries: [{ transition: t1, consents: [await consent(bob, [k["bob-op-1"]], "transition", await governanceTransitionDigest(t1), TG1 + 1_000)] }] };
const gov1 = (await verifyGovernanceLog(govFull, lookup)).heads[1];

// Records.
const PROFILE = await sha256Hex(canonicalBytes({ profile: "example.note@1" })), OTHER_PROFILE = await sha256Hex(canonicalBytes({ profile: "example.other@1" }));
const body = (who: typeof alice, n: number, org: { head: typeof gov0; sequence: number } | null, issued_at: number): RecordBody => ({
  issuer: { identity: who.id, head: { sequence: n, digest: who.heads[n].head_digest } },
  organization: org === null ? null : { id: orgId, head: { sequence: org.sequence, digest: org.head.head_digest } },
  profile: PROFILE, sequence: 1, supersedes: null, issued_at, payload: { note: "pallets", amount: "12.50" },
});
const sign = (b: RecordBody, ...keys: KeyPair[]) => signRecord(b, keys.map(key => key.secretKey));
const atHead1 = await sign(body(alice, 1, null, T + 60_000), k["alice-op-1"]);
const atHead0 = await sign(body(alice, 0, null, T + 40_000), k["alice-op-0"]);
const orgByAlice = await sign(body(alice, 1, { head: gov0, sequence: 0 }, T + 90_000), k["alice-op-1"]);
const orgByBob0 = await sign(body(bob, 0, { head: gov0, sequence: 0 }, T + 120_000), k["bob-op-1"]);
const byBobTwoKeys = await sign(body(bob, 0, null, T + 130_000), k["bob-op-1"], k["bob-op-2"]);
const reordered = { ...clone(byBobTwoKeys), signatures: [...byBobTwoKeys.signatures].reverse() };

// Host receipts: the record is the last of three leaves in the host's log, accepted at `at`, the head signed 5 ms later.
const LOG = "7c2d0e5b-3a14-4b8f-9d61-e0a5f3c2b947";
const filler = (n: number): Leaf => ({ record: sha256HexSync(`dtp-core1-bundle-vector:other-record-${n}`), accepted_at: T + 1_000 + n, effects: [] });
async function receipt(signed: unknown, at: number, key = k.host) {
  const leaves = [filler(1), filler(2), { record: await recordDigest(signed as never), accepted_at: at, effects: [] }], hashes = leaves.map(leafHash);
  return { head: await signLogHead({ log_id: LOG, size: 3, root: merkleRoot(hashes), signed_at: at + 5 }, key.secretKey), leaf: leaves[2], path: inclusionPath(hashes, 2) };
}

type Options = { host_key: string | null; require_attestation: boolean; profile?: string; held?: { identity_logs: IdentityLog[]; governance_logs: GovernanceLog[] } };
const base: Options = { host_key: k.host.keyId, require_attestation: true };
const bundle = (record: unknown, identity_logs: IdentityLog[], governance_log: GovernanceLog | null, r: unknown | null): Bundle => ({ record: record as never, identity_logs, governance_log, receipt: r });
const held = (identity_logs: IdentityLog[], governance_logs: GovernanceLog[] = []) => ({ ...base, held: { identity_logs, governance_logs } });

const acceptCases: [string, Bundle, Options][] = [
  ["a person's record at her current head, exchanged with no host", bundle(atHead1, [alice.log], null, null), base],
  ["the same record with its host receipt", bundle(atHead1, [alice.log], null, await receipt(atHead1, T + 60_100)), base],
  ["a record naming an older head, with a receipt from before the next head took effect: valid however late it arrives", bundle(atHead0, [alice.log], null, await receipt(atHead0, E1 - 1)), base],
  ["a record naming the last head the recipient knows of, with no receipt: nothing later is known", bundle(atHead0, [alice.genesisOnly], null, null), base],
  ["the recipient holds the issuer's later head; the receipt predates it", bundle(atHead0, [alice.genesisOnly], null, await receipt(atHead0, T + 40_100)), held([alice.log])],
  ["a record for an organisation, by a controller, with its governance log and the consenting controllers' logs", bundle(orgByAlice, [alice.log, bob.log], govGenesisOnly, null), base],
  ["a record for an organisation whose issuer is removed later, with a receipt from before the removal was issued", bundle(orgByAlice, [alice.log, bob.log], govFull, await receipt(orgByAlice, TG1 - 1)), base],
  ["a controller's record naming an older governance head, where only another controller was removed since", bundle(orgByBob0, [bob.log, alice.log], govFull, null), base],
  ["a record signed by two keys of a threshold-one identity", bundle(byBobTwoKeys, [bob.log], null, await receipt(byBobTwoKeys, T + 130_100)), base],
  ["unattested logs, where the recipient's policy allows them", bundle(atHead1, [await buildIdentityLog({ genesis: alice.log.genesis, enrollment: alice.log.enrollment, entries: alice.log.entries.map(e => ({ ...e, attestation: null })) }, null)], null, null), { ...base, require_attestation: false }],
];

const withoutIssuerLog = bundle(atHead1, [bob.log], null, null);
const rejectCases: [string, unknown, Options, string][] = [
  ["a member beside the four", { ...bundle(atHead1, [alice.log], null, null), sender: "example" }, base, "invalid_bundle"],
  ["no identity logs", bundle(atHead1, [], null, null), base, "invalid_bundle"],
  ["the issuer's identity log left out", withoutIssuerLog, base, "invalid_bundle"],
  ["two logs for one identity", bundle(atHead1, [alice.log, alice.genesisOnly], null, null), base, "invalid_bundle"],
  ["an identity log whose interior instant was moved", bundle(atHead1, [{ ...clone(alice.log), entries: alice.log.entries.map((e, i) => i === 0 ? { ...e, effective_at: e.effective_at + 1 } : e) }], null, null), base, "invalid_bundle"],
  ["unattested logs, where the recipient requires attestation", bundle(atHead1, [{ ...clone(alice.log), entries: alice.log.entries.map(e => ({ ...e, attestation: null })) }], null, null), base, "invalid_bundle"],
  ["a governance log beside a record issued by a person alone", bundle(atHead1, [alice.log, bob.log], govGenesisOnly, null), base, "invalid_bundle"],
  ["a record for an organisation without its governance log", bundle(orgByAlice, [alice.log, bob.log], null, null), base, "invalid_bundle"],
  ["a governance log whose consenting controller's identity log is left out", bundle(orgByAlice, [alice.log], govGenesisOnly, null), base, "invalid_bundle"],
  ["the record's body changed after signing", bundle({ ...clone(atHead1), body: { ...atHead1.body, payload: { note: "pallets", amount: "99.00" } } }, [alice.log], null, null), base, "invalid_signature"],
  ["a record of another profile than the recipient expects", bundle(await sign({ ...body(alice, 1, null, T + 60_000), profile: OTHER_PROFILE }, k["alice-op-1"]), [alice.log], null, null), { ...base, profile: PROFILE }, "unexpected_profile"],
  ["a record naming a head the bundle's log does not reach", bundle(atHead1, [alice.genesisOnly], null, null), base, "wrong_head"],
  ["a record naming a head digest of a fork the bundle does not carry", bundle(atHead1, [aliceFork.log], null, null), base, "wrong_head"],
  ["a record naming a governance head the bundle's log does not carry", bundle(await sign(body(bob, 0, { head: gov1, sequence: 1 }, T + 120_000), k["bob-op-1"]), [bob.log, alice.log], govGenesisOnly, null), base, "wrong_head"],
  ["a record at the current head signed by the key rotated out", bundle(await sign(body(alice, 1, null, T + 60_000), k["alice-op-0"]), [alice.log], null, null), base, "unauthorized_signer"],
  ["a record for an organisation by a person who is not its controller at the named head", bundle(await sign(body(alice, 1, { head: gov1, sequence: 1 }, T + 120_000), k["alice-op-1"]), [alice.log, bob.log], govFull, null), base, "unauthorized_signer"],
  ["the recipient holds a fork of the issuer's history", bundle(atHead1, [alice.log], null, null), held([aliceFork.log]), "history_conflict"],
  ["a receipt where the recipient trusts no host key", bundle(atHead1, [alice.log], null, await receipt(atHead1, T + 60_100)), { ...base, host_key: null }, "unauthorized_host"],
  ["a receipt signed by another host than the one the recipient trusts", bundle(atHead1, [alice.log], null, await receipt(atHead1, T + 60_100, k["other-host"])), base, "unauthorized_host"],
  ["a receipt for another record", bundle(atHead1, [alice.log], null, await receipt(atHead0, T + 60_100)), base, "wrong_record"],
  ["a record whose signatures were reordered after the host accepted it: another record digest", bundle(reordered, [bob.log], null, await receipt(byBobTwoKeys, T + 130_100)), base, "wrong_record"],
  ["a record naming an older head, with no receipt, where the bundle carries the next head", bundle(atHead0, [alice.log], null, null), base, "stale_head"],
  ["a record naming an older head, with no receipt, where the recipient already admitted the next head", bundle(atHead0, [alice.genesisOnly], null, null), held([alice.log]), "stale_head"],
  ["a receipt accepted at the instant the next head took effect", bundle(atHead0, [alice.log], null, await receipt(atHead0, E1)), base, "stale_head"],
  ["a receipt accepted after the next head took effect", bundle(atHead0, [alice.genesisOnly], null, await receipt(atHead0, E1 + 60_000)), held([alice.log]), "stale_head"],
  ["a record for an organisation whose issuer was removed later, with no receipt", bundle(orgByAlice, [alice.log, bob.log], govFull, null), base, "stale_head"],
  ["a record for an organisation, accepted when the issuer's removal was issued", bundle(orgByAlice, [alice.log, bob.log], govFull, await receipt(orgByAlice, TG1)), base, "stale_head"],
  ["the recipient holds the later governance log; the record has no receipt", bundle(orgByAlice, [alice.log, bob.log], govGenesisOnly, null), held([], [govFull]), "stale_head"],
];

const accept = [];
for (const [why, b, options] of acceptCases) {
  const v = await verifyBundle(clone(b), clone(options));
  accept.push({ why, bundle: b, options, expect: { digest: v.digest, signers: [...v.signers].sort(), accepted_at: v.receipt === null ? null : v.receipt.leaf.accepted_at } });
}
const reject = [];
for (const [why, b, options, code] of rejectCases) {
  const got = await verifyBundle(clone(b), clone(options)).then(() => "accepted", (error: { code?: string }) => error.code ?? String(error));
  if (got !== code) throw new Error(`reject case "${why}": expected ${code}, got ${got}`);
  reject.push({ why, bundle: b, options, code });
}

const out = {
  description: "Core-1 exchange bundles (spec/core-1/README.md, part 5). For each case, verify the bundle offline with its options: host_key is the host key the recipient trusts for receipts (null: none); require_attestation is the identity-log attestation policy; profile, when given, is the profile digest the recipient expects; held, when given, holds the identity and governance logs the recipient admitted before. For accept: the record digest, the signers (sorted) and the receipt's accepted_at (null without a receipt) must match. For reject: expect the code. Keys come from fixed seeds; never use them for anything real.",
  keys: labels.map(l => ({ label: l, key_id: k[l].keyId })),
  instants: { alice_head_1_effective_at: E1, governance_head_1_issued_at: TG1 },
  accept, reject,
};
const text = JSON.stringify(out, null, 2) + "\n";
const path = new URL("../../spec/core-1/vectors/bundle.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text) { console.error("spec/core-1/vectors/bundle.json is out of date: run node scripts/build-core1-bundle-vectors.ts"); process.exit(1); }
  console.log("core-1 bundle vectors: up to date");
} else {
  writeFileSync(path, text);
  console.log("core-1 bundle vectors:", accept.length, "accept,", reject.length, "reject");
}
