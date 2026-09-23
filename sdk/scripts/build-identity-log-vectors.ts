// Builds spec/vectors/identity-log.json from fixed seeds and instants. Ed25519 signatures are
// deterministic, so rerunning this must leave the file unchanged; `--check` compares without
// writing. The keys are published on purpose: never use them for anything real.
// Format and rules: docs/foundation/identity-log.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Sync } from '../src/sha256.ts';
import { canonicalBytes } from '../src/canonical.ts';
import { encodeKeyId, encodeSecretKey, encodeSignature, signBytes } from '../src/keys.ts';
import type { KeyPair } from '../src/keys.ts';
import { createIdentity, signIdentity, CLOCK_MARGIN_MS, LEASE_MS } from '../src/foundation/identity.ts';
import type { Rehome, Signed, Transition } from '../src/foundation/identity.ts';
import { attestHead, buildIdentityLog, compareRehomeRefusal, judgeIdentityLog, precedence, receiveIdentityLogPush, refuseRehome, verifyIdentityLog, verifyRehomeRefusal,
  HEAD_ATTESTATION_DOMAIN, IDENTITY_LOG_FORMAT, IDENTITY_LOG_PUSH_ACK_FORMAT, IDENTITY_LOG_PUSH_FORMAT, LEGACY_IDENTITY_LOG_FORMAT, REHOME_REFUSAL_DOMAIN } from '../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogParts, IdentityLogPush, RehomeRefusal, ResolverPin } from '../src/foundation/identity-log.ts';

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-identity-log-vector:${label}`);
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, true, ['sign']);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey('jwk', key)).x!, 'base64url'));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const labels = ['operational-0', 'recovery-0', 'operational-1', 'operational-2', 'recovery-1', 'resolver', 'stranger', 'resolver-b', 'operational-3'] as const;
const k = Object.fromEntries(await Promise.all(labels.map(async l => [l, await fixedKey(l)]))) as Record<typeof labels[number], KeyPair>;

const T = 1_800_000_000_000, resolverId = '5e5e5e5e-0000-4000-8000-00000000000a', audience = 'https://resolver.example';
const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: '0f0e0d0c-0b0a-4908-8706-050403020100',
  operational: { keys: [k['operational-0'].keyId], threshold: 1 }, recovery: { keys: [k['recovery-0'].keyId], threshold: 1 } }, [k['operational-0'], k['recovery-0']]);
const at0 = T + 2_000, state0 = await createIdentity(genesis, { id: resolverId, key_id: k.resolver.keyId }, at0), id = state0.head.identity_id;
const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: id, genesis_digest: state0.genesis_digest, resolver_id: resolverId,
  resolver_key: k.resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: T, expires_at: T + 300_000 }, [k['operational-0'], k['recovery-0']]);

/** Builds the chain one verified step at a time, so each expected_digest is the real previous head. */
const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: at0, transition: null, rehome: null, attestation: null }] };
async function headDigest() { return (await verifyIdentityLog(await buildIdentityLog(parts, null), { require_attestation: false })); }
async function transition(kind: Transition['kind'], operational: string[], recovery: string[], signers: KeyPair[], issued_at: number, overrides: Partial<Transition> = {}) {
  const current = await headDigest();
  return signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: id, expected_digest: current.head_digest, sequence: current.head.sequence + 1, kind,
    operational: { keys: operational, threshold: 1 }, recovery: { keys: recovery, threshold: 1 }, issued_at, expires_at: issued_at + 300_000, ...overrides }, signers);
}
const op = (n: 0 | 1 | 2) => k[`operational-${n}`], rec = (n: 0 | 1) => k[`recovery-${n}`];
// Head 1: a lease issued at T+60,000 was outstanding, so control took effect at the barrier, after acceptance.
parts.entries.push({ effective_at: T + 60_000 + LEASE_MS + CLOCK_MARGIN_MS, transition: await transition('rotate', [op(1).keyId], [rec(0).keyId], [op(0), op(1)], T + 61_000), rehome: null, attestation: null });
// Head 2: no outstanding lease; effective at acceptance.
parts.entries.push({ effective_at: T + 200_750, transition: await transition('recover', [op(2).keyId], [rec(0).keyId], [rec(0), op(2)], T + 200_000), rehome: null, attestation: null });
parts.entries.push({ effective_at: T + 400_000 + LEASE_MS + CLOCK_MARGIN_MS, transition: await transition('recovery-policy', [op(2).keyId], [rec(1).keyId], [rec(0), rec(1)], T + 400_000), rehome: null, attestation: null });

const attested = await buildIdentityLog(parts, k.resolver), bare = await buildIdentityLog(parts, null);
const genesisOnly = await buildIdentityLog({ ...parts, entries: parts.entries.slice(0, 1) }, k.resolver);
const clone = <V>(v: V): V => structuredClone(v);
function damaged(base: IdentityLog, change: (log: IdentityLog) => void | Promise<void>) { const log = clone(base); return Promise.resolve(change(log)).then(() => log); }
const last = attested.entries.length - 1;
const shifted = await damaged(bare, l => { l.entries[last].effective_at += 1; });
// Signed material that is individually genuine but breaks a control rule.
const current = await headDigest();
const bad = async (kind: Transition['kind'], operational: string[], recovery: string[], signers: KeyPair[], overrides: Partial<Transition> = {}): Promise<IdentityLog> =>
  ({ ...clone(bare), entries: [...clone(bare.entries), { effective_at: T + 700_000, attestation: null, rehome: null, transition: await transition(kind, operational, recovery, signers, T + 700_000, overrides) }] });

// A move to a second resolver, then a recovery there. Heads 0-3 are attested by the first resolver, 4-5 by the second.
const resolverB = '5e5e5e5e-0000-4000-8000-00000000000b', audienceB = 'https://host-b.example', moveAt = T + 900_000;
const rehomeBody: Rehome = { identity_id: id, expected_digest: current.head_digest, sequence: current.head.sequence + 1, from: { resolver_id: resolverId, resolver_epoch: 0 },
  to: { resolver_id: resolverB, resolver_key: k['resolver-b'].keyId, audience: audienceB, resolver_epoch: 1 }, issued_at: moveAt - 1_000, expires_at: moveAt + 299_000 };
const signRehome = (body: Rehome, signers: KeyPair[] = [rec(1)]) => signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', body, signers);
const withMove = async (body: Rehome, signers?: KeyPair[], at = moveAt): Promise<IdentityLogParts> =>
  ({ ...parts, entries: [...clone(attested.entries), { effective_at: at, transition: null, rehome: await signRehome(body, signers), attestation: null }] });
const movedParts = await withMove(rehomeBody), movedHead = await verifyIdentityLog(await buildIdentityLog(movedParts, null), { require_attestation: false });
const afterMove = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: id, expected_digest: movedHead.head_digest, sequence: 5, kind: 'recover',
  operational: { keys: [k['operational-3'].keyId], threshold: 1 }, recovery: { keys: [rec(1).keyId], threshold: 1 }, issued_at: moveAt + 100, expires_at: moveAt + 300_000 }, [rec(1), k['operational-3']]);
// The second resolver never saw the first one's leases, so its first key change waits a full lease plus the margin after adoption.
movedParts.entries.push({ effective_at: moveAt + LEASE_MS + CLOCK_MARGIN_MS, transition: afterMove, rehome: null, attestation: null });
const moved = await buildIdentityLog(movedParts, k['resolver-b']), movedBare = await buildIdentityLog(movedParts, null);
const sameResolverNewKey = await buildIdentityLog(await withMove({ ...rehomeBody, to: { ...rehomeBody.to, resolver_id: resolverId, audience } }), k['resolver-b']);
const legacy = (log: IdentityLog): IdentityLog => ({ ...clone(log), format: LEGACY_IDENTITY_LOG_FORMAT, entries: log.entries.map(({ rehome: _, ...rest }) => rest as never) });
// A log whose move is signed material the rules refuse: assembled without verification, since building would refuse it.
const movedBad = async (body: Rehome, signers?: KeyPair[], at = moveAt): Promise<IdentityLog> =>
  ({ ...clone(movedBare), entries: [...clone(attested.entries), { effective_at: at, transition: null, rehome: await signRehome(body, signers), attestation: null }] });
// Forks of one identity, for epoch precedence.
const thiefRotate = async (operational: KeyPair): Promise<IdentityLog> => ({ ...clone(bare), entries: [...clone(bare.entries), { effective_at: T + 950_000, attestation: null, rehome: null, transition: await transition('rotate', [operational.keyId], [rec(1).keyId], [op(2), operational], T + 950_000) }] });
const thiefBranch = await thiefRotate(k.stranger), rivalBranch = await thiefRotate(k['operational-3']);

type Accept = [string, IdentityLog, boolean];
const accept: Accept[] = [
  ['a genesis-only log, attested', genesisOnly, true],
  ['rotation, recovery and a recovery-policy change, every head attested; heads 1 and 3 took effect at the lease barrier, after acceptance', attested, true],
  ['the same history with no attestations, for a verifier that accepts unattested heads', bare, false],
  ['the same history with its FINAL instant moved one millisecond and no attestation: the log alone cannot detect this, the head digest differs, and only an attestation or a pinned checkpoint exposes it', shifted, false],
  ['a move to a second resolver, signed by the recovery quorum alone, then a recovery there; heads before the move are attested by the first resolver, the move and what follows by the second', moved, true],
  ['the same move with no attestations', movedBare, false],
  ['a resolver key rotation: a move to the same resolver id under a new key', sameResolverNewKey, true],
  ['the format 1 encoding of a history without moves', legacy(attested), true],
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
  ['an unknown format', await damaged(bare, l => { (l as { format: string }).format = 'dtp-identity-log-3'; }), false],
  ['an extra top-level member', await damaged(bare, l => { (l as unknown as Record<string, unknown>).note = 'x'; }), false],
  ['an extra entry member', await damaged(bare, l => { (l.entries[1] as unknown as Record<string, unknown>).accepted_at = T; }), false],
  ['a transition on the genesis entry', await damaged(bare, l => { l.entries[0].transition = clone(l.entries[1].transition); }), false],
  ['no entries', await damaged(bare, l => { l.entries = []; }), false],
  ['a move signed by the operational quorum', await movedBad(rehomeBody, [op(2)]), false],
  ['a move signed by a retired recovery key', await movedBad(rehomeBody, [rec(0)]), false],
  ['a move whose epoch does not advance', await movedBad({ ...rehomeBody, to: { ...rehomeBody.to, resolver_epoch: 0 } }), false],
  ['a move whose epoch skips', await movedBad({ ...rehomeBody, to: { ...rehomeBody.to, resolver_epoch: 2 } }), false],
  ['a move that does not leave the current resolver', await movedBad({ ...rehomeBody, from: { resolver_id: resolverB, resolver_epoch: 0 } }), false],
  ['a move from a head that is not the current head', await movedBad({ ...rehomeBody, expected_digest: current.heads[1].head_digest, sequence: 2 }), false],
  ['a move naming a current control key as the resolver key', await movedBad({ ...rehomeBody, to: { ...rehomeBody.to, resolver_key: op(2).keyId } }), false],
  ['a move naming a retired control key as the resolver key', await movedBad({ ...rehomeBody, to: { ...rehomeBody.to, resolver_key: op(0).keyId } }), false],
  ['a move whose audience is not an exact origin', await movedBad({ ...rehomeBody, to: { ...rehomeBody.to, audience: audienceB + '/path' } }), false],
  ['a move taking effect before its signed window', await movedBad(rehomeBody, undefined, rehomeBody.issued_at - 1), false],
  ['a move taking effect at the end of its signed window: a move has no lease barrier to reproduce', await movedBad(rehomeBody, undefined, rehomeBody.expires_at), false],
  ['the move attested by the first resolver, which it leaves', await damaged(moved, async l => { l.entries[4].attestation = await attestHead(movedHead.head, { id: resolverId, epoch: 0 }, k.resolver); }), false],
  ['a head after the move attested by the first resolver', await damaged(moved, async l => { l.entries[5].attestation = await attestHead((await verifyIdentityLog(clone(moved), { require_attestation: true })).heads[5].head, { id: resolverB, epoch: 1 }, k.resolver); }), false],
  ['an entry carrying both a transition and a move', await damaged(moved, l => { l.entries[4].transition = clone(l.entries[5].transition); }), false],
  ['a format 1 log carrying a move', await damaged(moved, l => { (l as { format: string }).format = LEGACY_IDENTITY_LOG_FORMAT; }), false],
  ['after a move, a rotation signed with keys retired before it', await damaged(movedBare, async l => { l.entries.push({ effective_at: moveAt + 400_000, rehome: null, attestation: null, transition: await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: id, expected_digest: (await verifyIdentityLog(clone(movedBare), { require_attestation: false })).head_digest, sequence: 6, kind: 'rotate', operational: { keys: [k.stranger.keyId], threshold: 1 }, recovery: { keys: [rec(1).keyId], threshold: 1 }, issued_at: moveAt + 400_000, expires_at: moveAt + 700_000 }, [op(1), k.stranger]) }); }), false],
];
type Pair = [string, IdentityLog, IdentityLog, ReturnType<typeof precedence>];
const pairs: Pair[] = [
  ['the owner moved to a second resolver; a thief with the old operational key forked at the first resolver: the higher epoch supersedes wherever the fork is', movedBare, thiefBranch, 'a-supersedes-b'],
  ['the same pair the other way round', thiefBranch, movedBare, 'b-supersedes-a'],
  ['two forks at one epoch: a conflict, never resolved by choosing', thiefBranch, rivalBranch, 'conflict'],
  ['one history is a prefix of the other', bare, movedBare, 'b-extends-a'],
  ['identical histories', bare, bare, 'equal'],
];

// Relying-party admission: a durable pin (the binding a party enrolled with and its last verified head) and a log.
const lenient = { require_attestation: false };
const bareHeads = (await verifyIdentityLog(clone(bare), lenient)).heads, movedV = await verifyIdentityLog(clone(moved), lenient), rivalV = await verifyIdentityLog(clone(rivalBranch), lenient);
const pinA = (minimum_sequence: number, minimum_digest: string | null, extra: Partial<ResolverPin> = {}): ResolverPin =>
  ({ identity_id: id, resolver_id: resolverId, resolver_key: k.resolver.keyId, resolver_epoch: 0, minimum_sequence, minimum_digest, ...extra });
const pinB: ResolverPin = { identity_id: id, resolver_id: resolverB, resolver_key: k['resolver-b'].keyId, resolver_epoch: 1, minimum_sequence: movedV.head.sequence, minimum_digest: movedV.head_digest };
type Admission = [string, ResolverPin, IdentityLog, boolean];
const admission: Admission[] = [
  ['a pin at head 0 admits the attested history: advanced', pinA(0, bareHeads[0].head_digest), attested, true],
  ['the same pin admits the move, whose heads are attested by the resolver of each epoch: advanced', pinA(0, bareHeads[0].head_digest), moved, true],
  ['a pin already at the log\'s head: unchanged', pinA(3, bareHeads[3].head_digest), bare, false],
  ['a move whose rehome entry no resolver attested is not admitted under ANY attestation policy: the owner consented, but no destination adopted (unadopted-move)', pinA(0, bareHeads[0].head_digest), movedBare, false],
  ['a pin that already followed the move, shown the same log again: unchanged', pinB, moved, true],
  ['a pin that verified a resolution at head 4, shown a history that stops at head 3: behind, which is not evidence either way', pinA(4, rivalV.heads[4].head_digest), bare, false],
  ['a pin whose checkpoint sits on a rival branch at the same epoch: conflict, never resolved by choosing', pinA(4, rivalV.heads[4].head_digest), thiefBranch, false],
  ['the same rival checkpoint against the owner\'s move: the higher epoch supersedes, and the superseded checkpoint is reported', pinA(4, rivalV.heads[4].head_digest), moved, true],
  ['a pin enrolled with a resolver key the log never names: foreign-lineage', pinA(0, null, { resolver_key: k.stranger.keyId }), bare, false],
  ['a pin at epoch 1 shown a history that never left epoch 0: foreign-lineage', pinB, attested, true],
  ['a pin for another identity: another-identity', pinA(0, null, { identity_id: '00000000-0000-4000-8000-000000000000' }), bare, false],
  ['a log that fails verification: invalid-log', pinA(0, null), reject[1][1], false],
  ['unattested heads under a strict policy: invalid-log', pinA(0, null), bare, true],
];
const pushMessage = (log: IdentityLog, format = IDENTITY_LOG_PUSH_FORMAT): IdentityLogPush => ({ format: format as typeof IDENTITY_LOG_PUSH_FORMAT, log });
type Push = [string, ResolverPin | null, IdentityLogPush, boolean];
const push: Push[] = [
  ['a relying party that enrolled the identity at the first resolver admits the pushed move', pinA(0, bareHeads[0].head_digest), pushMessage(moved), true],
  ['the same push again, against the pin the first one produced: unchanged, so a wallet may repeat it freely', pinB, pushMessage(moved), true],
  ['a relying party that never enrolled the identity: unknown-identity', null, pushMessage(moved), true],
  ['a message whose log does not verify: invalid-log, and no identity is named', pinA(0, null), pushMessage(reject[1][1]), false],
  ['a message in an unknown format: invalid-log', pinA(0, null), pushMessage(moved, 'dtp-identity-log-push-2'), true],
  ['a history that stops before the party checkpoint: behind', pinA(4, rivalV.heads[4].head_digest), pushMessage(bare), false],
  ['a move nobody attested: unadopted-move', pinA(0, null), pushMessage(movedBare), false],
];
// A destination's signed refusal of one rehome, and what it says next to a log.
const theRehome = movedParts.entries[4].rehome!, otherRehome = sameResolverNewKey.entries[4].rehome!;
const refusal = await refuseRehome(theRehome, k['resolver-b'], moveAt - 500);
const rawRefusal = async (body: RehomeRefusal, signer: KeyPair): Promise<Signed<RehomeRefusal>> =>
  ({ body, signatures: [{ key_id: signer.keyId, signature: encodeSignature(await signBytes(signer.secretKey, canonicalBytes({ domain: REHOME_REFUSAL_DOMAIN, body }))) }] });
type Refusal = [string, Signed<Rehome>, Signed<RehomeRefusal>];
const refusalAccept: Refusal[] = [['the destination the rehome names refuses it', theRehome, refusal]];
const refusalReject: Refusal[] = [
  ['a refusal signed by the former resolver, which the rehome does not name', theRehome, await rawRefusal(refusal.body, k.resolver)],
  ['a refusal signed by a stranger', theRehome, await rawRefusal(refusal.body, k.stranger)],
  ['a refusal naming another rehome digest', theRehome, await rawRefusal({ ...refusal.body, rehome_digest: 'f'.repeat(64) }, k['resolver-b'])],
  ['a refusal naming another epoch', theRehome, await rawRefusal({ ...refusal.body, resolver_epoch: 2 }, k['resolver-b'])],
  ['a refusal of a different rehome presented against this one', theRehome, await refuseRehome(otherRehome, k['resolver-b'], moveAt - 500)],
  ['a refusal body altered after signing', theRehome, { ...refusal, body: { ...refusal.body, refused_at: refusal.body.refused_at + 1 } }],
  ['a refusal with an extra member', theRehome, await rawRefusal({ ...refusal.body, note: 'x' } as unknown as RehomeRefusal, k['resolver-b'])],
  ['a refusal with two signatures', theRehome, { ...refusal, signatures: [refusal.signatures[0], (await rawRefusal(refusal.body, k.stranger)).signatures[0]] }],
];
type Contradiction = [string, Signed<RehomeRefusal>, IdentityLog, 'unrelated' | 'consistent' | 'equivocation'];
const contradictions: Contradiction[] = [
  ['the refused rehome produced a head the destination attested: the destination equivocated, and the pair proves it', refusal, moved, 'equivocation'],
  ['the refused rehome sits in a log but no one attested its head: a dangling consent, consistent with the refusal', refusal, movedBare, 'consistent'],
  ['a log that never contains the refused rehome', refusal, bare, 'unrelated'],
  ['a log whose move is a different rehome from the same head', refusal, sameResolverNewKey, 'unrelated'],
];

const out = {
  description: 'Portable identity log. A verifier MUST accept every log under "accept" under the stated attestation policy and derive exactly the expected values, and MUST refuse every log under "reject". A relying party holding the pin under "admission" MUST reach exactly the expected judgement, and MUST answer each "push" message with exactly the expected acknowledgment. A verifier MUST accept every refusal under "refusals.accept", refuse every one under "refusals.reject", and reach the expected comparison under "refusals.contradictions". Refusal reasons of the verifier are not normative; admission reasons are. All keys here are published test keys.',
  format: IDENTITY_LOG_FORMAT, legacy_format: LEGACY_IDENTITY_LOG_FORMAT, attestation_domain: HEAD_ATTESTATION_DOMAIN, rehome_domain: 'DTP-IDENTITY-REHOME-1', lease_ms: LEASE_MS, clock_margin_ms: CLOCK_MARGIN_MS,
  refusal_domain: REHOME_REFUSAL_DOMAIN, push_format: IDENTITY_LOG_PUSH_FORMAT, push_ack_format: IDENTITY_LOG_PUSH_ACK_FORMAT,
  keys: labels.map(label => ({ label, key_id: k[label].keyId, secret_key: k[label].secretKey })),
  accept: await Promise.all(accept.map(async ([why, log, require_attestation]) => {
    const v = await verifyIdentityLog(clone(log), { require_attestation });
    return { why, require_attestation, log, expect: { identity_id: v.identity_id, genesis_digest: v.genesis_digest, resolver: v.resolver, resolvers: v.resolvers,
      heads: v.heads.map(h => ({ sequence: h.head.sequence, head_digest: h.head_digest, effective_at: h.head.effective_at, epoch: h.epoch, attested: h.attested })),
      operational: v.head.operational, recovery: v.head.recovery, retired_keys: v.retired_keys, unattested: v.unattested } };
  })),
  reject: reject.map(([why, log, require_attestation]) => ({ why, require_attestation, log })),
  precedence: pairs.map(([why, a, b, expect]) => ({ why, a, b, expect })),
  admission: await Promise.all(admission.map(async ([why, pin, log, require_attestation]) => {
    const j = await judgeIdentityLog(pin, clone(log), { require_attestation });
    return { why, pin, log, require_attestation, expect: j.outcome === 'refused' ? { outcome: j.outcome, reason: j.reason } : { outcome: j.outcome, pin: j.pin, superseded: j.superseded } };
  })),
  push: await Promise.all(push.map(async ([why, pin, message, require_attestation]) => {
    const { ack } = await receiveIdentityLogPush(clone(message), async identity => pin !== null && pin.identity_id === identity ? pin : null, { require_attestation });
    return { why, pin, message, require_attestation, ack };
  })),
  refusals: {
    accept: await Promise.all(refusalAccept.map(async ([why, rehome, refusal]) => ({ why, rehome, refusal, expect: await verifyRehomeRefusal(refusal, rehome) }))),
    reject: refusalReject.map(([why, rehome, refusal]) => ({ why, rehome, refusal })),
    contradictions: contradictions.map(([why, refusal, log, expect]) => ({ why, refusal, log, expect })),
  },
};
for (const [why, rehome, bad] of refusalReject) {
  const refused = await verifyRehomeRefusal(clone(bad), clone(rehome)).then(() => false, () => true);
  if (!refused) throw new Error(`generator: the reference verifier accepted the refusal "${why}"`);
}
for (const [why, r, log, expect] of contradictions) {
  const got = await compareRehomeRefusal(clone(r), clone(log));
  if (got !== expect) throw new Error('generator: contradiction "' + why + '" gave ' + got);
}
const expectedReasons = ['advanced', 'advanced', 'unchanged', 'unadopted-move', 'unchanged', 'behind', 'conflict', 'superseded', 'foreign-lineage', 'foreign-lineage', 'another-identity', 'invalid-log', 'invalid-log'];
out.admission.forEach((a, i) => { const got = 'reason' in a.expect ? a.expect.reason : a.expect.outcome; if (got !== expectedReasons[i]) throw new Error(`generator: admission "${a.why}" gave ${got}`); });
const expectedAcks = ['advanced', 'unchanged', 'unknown-identity', 'invalid-log', 'invalid-log', 'behind', 'unadopted-move'];
out.push.forEach((p, i) => { const got = p.ack.reason ?? p.ack.outcome; if (got !== expectedAcks[i]) throw new Error(`generator: push "${p.why}" gave ${got}`); });
for (const [why, a, b, expect] of pairs) {
  const got = precedence(await verifyIdentityLog(clone(a), { require_attestation: false }), await verifyIdentityLog(clone(b), { require_attestation: false }));
  if (got !== expect) throw new Error('generator: precedence "' + why + '" gave ' + got);
}
for (const [why, log, require_attestation] of reject) {
  const refused = await verifyIdentityLog(clone(log), { require_attestation }).then(() => false, () => true);
  if (!refused) throw new Error(`generator: the reference verifier accepted "${why}"`);
}
const target = new URL('../../spec/vectors/identity-log.json', import.meta.url), text = JSON.stringify(out, null, 2) + '\n';
if (!process.argv.includes('--check')) writeFileSync(target, text);
// A checkout may have converted line endings; the content is what must not drift.
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/identity-log.json is stale; rerun this script without --check'); process.exit(1); }
console.log('vectors:', out.accept.length, 'accept,', out.reject.length, 'reject,', out.precedence.length, 'precedence pairs,', out.admission.length, 'admissions,', out.push.length, 'pushes,',
  out.refusals.accept.length + out.refusals.reject.length, 'refusals,', out.refusals.contradictions.length, 'contradictions');
