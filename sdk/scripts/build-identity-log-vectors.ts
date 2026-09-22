// Builds spec/vectors/identity-log.json from fixed seeds and instants. Ed25519 signatures are
// deterministic, so rerunning this must leave the file unchanged; `--check` compares without
// writing. The keys are published on purpose: never use them for anything real.
// Format and rules: docs/foundation/identity-log.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Sync } from '../src/sha256.ts';
import { encodeKeyId, encodeSecretKey } from '../src/keys.ts';
import type { KeyPair } from '../src/keys.ts';
import { createIdentity, signIdentity, CLOCK_MARGIN_MS, LEASE_MS } from '../src/foundation/identity.ts';
import type { Transition } from '../src/foundation/identity.ts';
import { attestHead, buildIdentityLog, verifyIdentityLog, HEAD_ATTESTATION_DOMAIN, IDENTITY_LOG_FORMAT } from '../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogParts } from '../src/foundation/identity-log.ts';

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-identity-log-vector:${label}`);
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, true, ['sign']);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey('jwk', key)).x!, 'base64url'));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const labels = ['operational-0', 'recovery-0', 'operational-1', 'operational-2', 'recovery-1', 'resolver', 'stranger'] as const;
const k = Object.fromEntries(await Promise.all(labels.map(async l => [l, await fixedKey(l)]))) as Record<typeof labels[number], KeyPair>;

const T = 1_800_000_000_000, resolverId = '5e5e5e5e-0000-4000-8000-00000000000a', audience = 'https://resolver.example';
const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: '0f0e0d0c-0b0a-4908-8706-050403020100',
  operational: { keys: [k['operational-0'].keyId], threshold: 1 }, recovery: { keys: [k['recovery-0'].keyId], threshold: 1 } }, [k['operational-0'], k['recovery-0']]);
const at0 = T + 2_000, state0 = await createIdentity(genesis, { id: resolverId, key_id: k.resolver.keyId }, at0), id = state0.head.identity_id;
const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: id, genesis_digest: state0.genesis_digest, resolver_id: resolverId,
  resolver_key: k.resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: T, expires_at: T + 300_000 }, [k['operational-0'], k['recovery-0']]);

/** Builds the chain one verified step at a time, so each expected_digest is the real previous head. */
const parts: IdentityLogParts = { genesis, enrollment, genesis_effective_at: at0, transitions: [] };
async function headDigest() { return (await verifyIdentityLog(await buildIdentityLog(parts, null), { require_attestation: false })); }
async function transition(kind: Transition['kind'], operational: string[], recovery: string[], signers: KeyPair[], issued_at: number, overrides: Partial<Transition> = {}) {
  const current = await headDigest();
  return signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: id, expected_digest: current.head_digest, sequence: current.head.sequence + 1, kind,
    operational: { keys: operational, threshold: 1 }, recovery: { keys: recovery, threshold: 1 }, issued_at, expires_at: issued_at + 300_000, ...overrides }, signers);
}
const op = (n: 0 | 1 | 2) => k[`operational-${n}`], rec = (n: 0 | 1) => k[`recovery-${n}`];
// Head 1: a lease issued at T+60,000 was outstanding, so control took effect at the barrier, after acceptance.
parts.transitions.push({ command: await transition('rotate', [op(1).keyId], [rec(0).keyId], [op(0), op(1)], T + 61_000), effective_at: T + 60_000 + LEASE_MS + CLOCK_MARGIN_MS });
// Head 2: no outstanding lease; effective at acceptance.
parts.transitions.push({ command: await transition('recover', [op(2).keyId], [rec(0).keyId], [rec(0), op(2)], T + 200_000), effective_at: T + 200_750 });
parts.transitions.push({ command: await transition('recovery-policy', [op(2).keyId], [rec(1).keyId], [rec(0), rec(1)], T + 400_000), effective_at: T + 400_000 + LEASE_MS + CLOCK_MARGIN_MS });

const attested = await buildIdentityLog(parts, k.resolver), bare = await buildIdentityLog(parts, null);
const genesisOnly = await buildIdentityLog({ ...parts, transitions: [] }, k.resolver);
const clone = <V>(v: V): V => structuredClone(v);
function damaged(base: IdentityLog, change: (log: IdentityLog) => void | Promise<void>) { const log = clone(base); return Promise.resolve(change(log)).then(() => log); }
const last = attested.entries.length - 1;
const shifted = await damaged(bare, l => { l.entries[last].effective_at += 1; });
// Signed material that is individually genuine but breaks a control rule.
const current = await headDigest();
const bad = async (kind: Transition['kind'], operational: string[], recovery: string[], signers: KeyPair[], overrides: Partial<Transition> = {}): Promise<IdentityLog> =>
  ({ ...clone(bare), entries: [...clone(bare.entries), { effective_at: T + 700_000, attestation: null, transition: await transition(kind, operational, recovery, signers, T + 700_000, overrides) }] });

type Accept = [string, IdentityLog, boolean];
const accept: Accept[] = [
  ['a genesis-only log, attested', genesisOnly, true],
  ['rotation, recovery and a recovery-policy change, every head attested; heads 1 and 3 took effect at the lease barrier, after acceptance', attested, true],
  ['the same history with no attestations, for a verifier that accepts unattested heads', bare, false],
  ['the same history with its FINAL instant moved one millisecond and no attestation: the log alone cannot detect this, the head digest differs, and only an attestation or a pinned checkpoint exposes it', shifted, false],
];
const reject: Accept[] = [
  ['unattested heads where the verifier requires attestation', bare, true],
  ['entries reordered', await damaged(bare, l => { [l.entries[1], l.entries[2]] = [l.entries[2], l.entries[1]]; }), false],
  ['a middle entry dropped', await damaged(bare, l => { l.entries.splice(2, 1); }), false],
  ['the genesis entry dropped', await damaged(bare, l => { l.entries.shift(); }), false],
  ['an entry repeated', await damaged(bare, l => { l.entries.splice(2, 0, clone(l.entries[1])); }), false],
  ['an INTERIOR instant moved one millisecond: the next transition\'s owner-signed expected_digest no longer matches', await damaged(bare, l => { l.entries[1].effective_at += 1; }), false],
  ['the genesis instant moved one millisecond', await damaged(bare, l => { l.entries[0].effective_at += 1; }), false],
  ['the final instant moved while its attestation still describes the original head', await damaged(attested, l => { l.entries[last].effective_at += 1; }), false],
  ['an instant before the transition\'s signed window', await damaged(genesisOnly, async l => { l.entries[0].attestation = null; l.entries.push({ ...clone(bare.entries[1]), effective_at: T + 60_999 }); }), false],
  ['an instant beyond expires_at - 1 + lease + margin', await damaged(genesisOnly, async l => { l.entries[0].attestation = null; l.entries.push({ ...clone(bare.entries[1]), effective_at: T + 61_000 + 300_000 + LEASE_MS + CLOCK_MARGIN_MS }); }), false],
  ['a genesis instant outside the enrollment window', await damaged(genesisOnly, l => { l.entries[0].attestation = null; l.entries[0].effective_at = T + 300_000; }), false],
  ['a transition signature replaced by another valid signature', await damaged(bare, l => { l.entries[1].transition!.signatures[0].signature = l.entries[2].transition!.signatures[0].signature; }), false],
  ['a transition body altered after signing', await damaged(bare, l => { l.entries[1].transition!.body.operational.keys = [k.stranger.keyId]; }), false],
  ['the new key\'s possession signature removed', await damaged(bare, l => { l.entries[1].transition!.signatures.pop(); }), false],
  ['a head attested by a key the owner never enrolled', await damaged(attested, async l => { l.entries[1].attestation = await attestHead((await verifyIdentityLog(clone(attested), { require_attestation: true })).heads[1].head, { id: resolverId, epoch: 0 }, k.stranger); }), false],
  ['an attestation moved to a different entry', await damaged(attested, l => { l.entries[1].attestation = clone(l.entries[2].attestation); }), false],
  ['an attestation naming a different resolver epoch', await damaged(attested, l => { l.entries[1].attestation!.body.resolver_epoch = 1; }), false],
  ['a rotation signed only by the recovery quorum', await bad('rotate', [k.stranger.keyId], [rec(1).keyId], [rec(1), k.stranger]), false],
  ['a recovery signed only by the operational quorum', await bad('recover', [k.stranger.keyId], [rec(1).keyId], [op(2), k.stranger]), false],
  ['a rotation that changes recovery authority', await bad('rotate', [op(2).keyId], [k.stranger.keyId], [op(2), k.stranger]), false],
  ['a retired operational key reinstated', await bad('recover', [op(0).keyId], [rec(1).keyId], [rec(1), op(0)]), false],
  ['a retired recovery key reinstated', await bad('recovery-policy', [op(2).keyId], [rec(0).keyId], [rec(1), rec(0)]), false],
  ['the resolver key given control of the person', await bad('recover', [k.resolver.keyId], [rec(1).keyId], [rec(1), k.resolver]), false],
  ['a skipped sequence number', await bad('recover', [k.stranger.keyId], [rec(1).keyId], [rec(1), k.stranger], { sequence: current.head.sequence + 2 }), false],
  ['a transition naming a predecessor that is not the previous head', await bad('recover', [k.stranger.keyId], [rec(1).keyId], [rec(1), k.stranger], { expected_digest: current.heads[1].head_digest }), false],
  ['a signed window longer than 300,000 ms', await bad('recover', [k.stranger.keyId], [rec(1).keyId], [rec(1), k.stranger], { expires_at: T + 700_000 + 300_001 }), false],
  ['an unknown format', await damaged(bare, l => { (l as { format: string }).format = 'dtp-identity-log-2'; }), false],
  ['an extra top-level member', await damaged(bare, l => { (l as unknown as Record<string, unknown>).note = 'x'; }), false],
  ['an extra entry member', await damaged(bare, l => { (l.entries[1] as unknown as Record<string, unknown>).accepted_at = T; }), false],
  ['a transition on the genesis entry', await damaged(bare, l => { l.entries[0].transition = clone(l.entries[1].transition); }), false],
  ['no entries', await damaged(bare, l => { l.entries = []; }), false],
];

const out = {
  description: 'Portable identity log. A verifier MUST accept every log under "accept" under the stated attestation policy and derive exactly the expected values, and MUST refuse every log under "reject". Refusal reasons are not normative. All keys here are published test keys.',
  format: IDENTITY_LOG_FORMAT, attestation_domain: HEAD_ATTESTATION_DOMAIN, lease_ms: LEASE_MS, clock_margin_ms: CLOCK_MARGIN_MS,
  keys: labels.map(label => ({ label, key_id: k[label].keyId, secret_key: k[label].secretKey })),
  accept: await Promise.all(accept.map(async ([why, log, require_attestation]) => {
    const v = await verifyIdentityLog(clone(log), { require_attestation });
    return { why, require_attestation, log, expect: { identity_id: v.identity_id, genesis_digest: v.genesis_digest, resolver: v.resolver,
      heads: v.heads.map(h => ({ sequence: h.head.sequence, head_digest: h.head_digest, effective_at: h.head.effective_at, attested: h.attested })),
      operational: v.head.operational, recovery: v.head.recovery, retired_keys: v.retired_keys, unattested: v.unattested } };
  })),
  reject: reject.map(([why, log, require_attestation]) => ({ why, require_attestation, log })),
};
for (const [why, log, require_attestation] of reject) {
  const refused = await verifyIdentityLog(clone(log), { require_attestation }).then(() => false, () => true);
  if (!refused) throw new Error(`generator: the reference verifier accepted "${why}"`);
}
const target = new URL('../../spec/vectors/identity-log.json', import.meta.url), text = JSON.stringify(out, null, 2) + '\n';
if (!process.argv.includes('--check')) writeFileSync(target, text);
// A checkout may have converted line endings; the content is what must not drift.
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/identity-log.json is stale; rerun this script without --check'); process.exit(1); }
console.log('vectors:', out.accept.length, 'accept,', out.reject.length, 'reject');
