// Builds spec/vectors/organization-governance.json from fixed seeds. Ed25519 signatures are deterministic,
// so rerunning this must leave the file unchanged; `--check` compares without writing. The keys are
// published on purpose: never use them for anything real. Rules: docs/foundation/organization-identity.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Sync } from '../src/sha256.ts';
import { canonicalBytes, sha256Hex } from '../src/canonical.ts';
import { encodeKeyId, encodeSecretKey, encodeSignature, signBytes } from '../src/keys.ts';
import type { KeyPair } from '../src/keys.ts';
import { createIdentity, signIdentity } from '../src/foundation/identity.ts';
import type { Control, Signed, Transition } from '../src/foundation/identity.ts';
import { buildIdentityLog, verifyIdentityLog } from '../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogParts } from '../src/foundation/identity-log.ts';
import { applyGovernanceTransition, controlFromIdentityLogs, governanceTransitionDigest, organizationGenesisDigest, organizationId, signOrganizationConsent, verifyGovernanceLog, verifyOrganizationConsent, verifyOrganizationGenesis,
  GOVERNANCE_LOG_FORMAT, ORGANIZATION_CONSENT_DOMAIN, ORGANIZATION_GENESIS_DOMAIN, ORGANIZATION_TRANSITION_DOMAIN, ORGANIZATION_WINDOW_MS } from '../src/foundation/organization.ts';
import type { GovernanceEntry, GovernanceLog, GovernanceTransition, OrganizationConsent, OrganizationGenesis } from '../src/foundation/organization.ts';

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-organization-governance-vector:${label}`);
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, true, ['sign']);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey('jwk', key)).x!, 'base64url'));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const labels = ['alice-op', 'alice-rec', 'alice-op-2', 'bob-op', 'bob-rec', 'carol-op', 'carol-rec', 'resolver', 'stranger'] as const;
const k = Object.fromEntries(await Promise.all(labels.map(async l => [l, await fixedKey(l)]))) as Record<typeof labels[number], KeyPair>;
const T = 1_800_000_000_000, resolverId = '5e5e5e5e-0000-4000-8000-00000000000c', audience = 'https://resolver.example';
const clone = <V>(v: V): V => structuredClone(v);

/** A person with a fixed genesis, enrolled at the fixed resolver, and optionally one rotation. */
async function person(op: KeyPair, rec: KeyPair, nonce: string, rotateTo: KeyPair | null) {
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce, operational: { keys: [op.keyId], threshold: 1 }, recovery: { keys: [rec.keyId], threshold: 1 } }, [op, rec]);
  const state = await createIdentity(genesis, { id: resolverId, key_id: k.resolver.keyId }, T + 1_000), id = state.head.identity_id;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: id, genesis_digest: state.genesis_digest, resolver_id: resolverId, resolver_key: k.resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: T, expires_at: T + 300_000 }, [op, rec]);
  const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: T + 1_000, transition: null, rehome: null, attestation: null }] };
  if (rotateTo !== null) {
    const command = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: id, expected_digest: state.head_digest, sequence: 1, kind: 'rotate', operational: { keys: [rotateTo.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: T + 50_000, expires_at: T + 350_000 }, [op, rotateTo]);
    parts.entries.push({ effective_at: T + 50_500, transition: command, rehome: null, attestation: null });
  }
  const log = await buildIdentityLog(parts, k.resolver), verified = await verifyIdentityLog(log, { require_attestation: true });
  return { id, log, verified, heads: verified.heads, current: verified.heads[verified.heads.length - 1], keys: rotateTo === null ? [op] : [rotateTo], oldKeys: [op], recovery: rec };
}
const alice = await person(k['alice-op'], k['alice-rec'], '0f0e0d0c-0b0a-4908-8706-050403020100', k['alice-op-2']);
const bob = await person(k['bob-op'], k['bob-rec'], '0f0e0d0c-0b0a-4908-8706-050403020101', null);
const carol = await person(k['carol-op'], k['carol-rec'], '0f0e0d0c-0b0a-4908-8706-050403020102', null);
const people = [alice, bob, carol], lookup = controlFromIdentityLogs(people.map(p => p.verified));
const sorted = (ids: string[]) => [...ids].sort();

const genesis: OrganizationGenesis = { nonce: '00010203-0405-4607-8809-0a0b0c0d0e0f', founder: alice.id, controllers: sorted([alice.id, bob.id]), threshold: 1 };
const genesisDigest = await organizationGenesisDigest(genesis), orgId = await organizationId(genesis);
type Person = typeof alice;
const consent = (p: Person, subject: 'genesis' | 'transition', digest: string, at: number, head = p.current, keys = p.keys, overrides: Partial<OrganizationConsent> = {}) =>
  signOrganizationConsent({ organization_id: orgId, subject, digest, person_id: p.id, head_digest: head.head_digest, issued_at: at, expires_at: at + 3_600_000, ...overrides }, keys);
const genesisConsents = [await consent(alice, 'genesis', genesisDigest, T + 100_000), await consent(bob, 'genesis', genesisDigest, T + 100_500)];
const head0 = await verifyOrganizationGenesis(genesis, genesisConsents, lookup, null);

// Entry 1: Carol joins and the threshold rises to two. The current quorum (one of Alice, Bob) plus every added controller.
const t1: GovernanceTransition = { organization_id: orgId, expected_digest: head0.head_digest, sequence: 1, controllers: sorted([alice.id, bob.id, carol.id]), threshold: 2, issued_at: T + 200_000, expires_at: T + 200_000 + ORGANIZATION_WINDOW_MS };
const d1 = await governanceTransitionDigest(t1);
const e1: GovernanceEntry = { transition: t1, consents: [await consent(alice, 'transition', d1, T + 201_000), await consent(carol, 'transition', d1, T + 202_000)] };
const head1 = await applyGovernanceTransition(head0, e1, lookup, null);
// Entry 2: the founder leaves. Two of three current controllers consent; nobody is added.
const t2: GovernanceTransition = { organization_id: orgId, expected_digest: head1.head_digest, sequence: 2, controllers: sorted([bob.id, carol.id]), threshold: 1, issued_at: T + 300_000, expires_at: T + 300_000 + ORGANIZATION_WINDOW_MS };
const d2 = await governanceTransitionDigest(t2);
const e2: GovernanceEntry = { transition: t2, consents: [await consent(bob, 'transition', d2, T + 301_000), await consent(carol, 'transition', d2, T + 302_000)] };
const log: GovernanceLog = { format: GOVERNANCE_LOG_FORMAT, genesis, consents: genesisConsents, entries: [e1, e2] };
const genesisOnly: GovernanceLog = { ...log, entries: [] };
function damaged(base: GovernanceLog, change: (l: GovernanceLog) => void | Promise<void>) { const l = clone(base); return Promise.resolve(change(l)).then(() => l); }

// Consent vectors: one consent against the act and the head it must be verified under.
const rawConsent = async (body: OrganizationConsent, signers: KeyPair[], domain = ORGANIZATION_CONSENT_DOMAIN): Promise<Signed<OrganizationConsent>> =>
  ({ body, signatures: await Promise.all(signers.map(async s => ({ key_id: s.keyId, signature: encodeSignature(await signBytes(s.secretKey, canonicalBytes({ domain, body }))) }))) });
const expectedGenesis = (p: Person) => ({ organization_id: orgId, subject: 'genesis' as const, digest: genesisDigest, person_id: p.id });
type ConsentCase = [string, Signed<OrganizationConsent>, ReturnType<typeof expectedGenesis>, Control];
const consentAccept: ConsentCase[] = [
  ['a controller consents to the genesis under their current head, signed by their operational key', genesisConsents[1], expectedGenesis(bob), bob.current.head],
  ['a consent signed under an earlier head of a person who has since rotated: valid under that head, which a replay verifier finds in the person\'s log', await consent(alice, 'genesis', genesisDigest, T + 100_000, alice.heads[0], alice.oldKeys), expectedGenesis(alice), alice.heads[0].head],
];
const consentReject: ConsentCase[] = [
  ['signed by the person\'s recovery key: recovery keys are not business signers', await consent(bob, 'genesis', genesisDigest, T + 100_500, bob.current, [bob.recovery]), expectedGenesis(bob), bob.current.head],
  ['signed by a stranger', await consent(bob, 'genesis', genesisDigest, T + 100_500, bob.current, [k.stranger]), expectedGenesis(bob), bob.current.head],
  ['signed by a retired operational key, checked under the current head', await consent(alice, 'genesis', genesisDigest, T + 100_000, alice.current, alice.oldKeys), expectedGenesis(alice), alice.current.head],
  ['the head digest names a head the person never had', await consent(bob, 'genesis', genesisDigest, T + 100_500, { ...bob.current, head_digest: 'f'.repeat(64) }), expectedGenesis(bob), bob.current.head],
  ['verified under another person\'s head', genesisConsents[1], expectedGenesis(bob), alice.current.head],
  ['consent to a different digest', await consent(bob, 'genesis', 'a'.repeat(64), T + 100_500), expectedGenesis(bob), bob.current.head],
  ['consent to a transition presented as consent to the genesis', await consent(bob, 'transition', genesisDigest, T + 100_500), expectedGenesis(bob), bob.current.head],
  ['consent for another organization', await consent(bob, 'genesis', genesisDigest, T + 100_500, bob.current, bob.keys, { organization_id: '00000000-0000-4000-8000-000000000000' }), expectedGenesis(bob), bob.current.head],
  ['a body altered after signing', { ...genesisConsents[1], body: { ...genesisConsents[1].body, issued_at: genesisConsents[1].body.issued_at + 1 } }, expectedGenesis(bob), bob.current.head],
  ['a window longer than the organization ceremony bound', await rawConsent({ ...genesisConsents[1].body, expires_at: genesisConsents[1].body.issued_at + ORGANIZATION_WINDOW_MS + 1 }, bob.keys), expectedGenesis(bob), bob.current.head],
  ['a consent signed under the transition domain', await rawConsent(genesisConsents[1].body, bob.keys, ORGANIZATION_TRANSITION_DOMAIN), expectedGenesis(bob), bob.current.head],
  ['an extra member', await rawConsent({ ...genesisConsents[1].body, note: 'x' } as unknown as OrganizationConsent, bob.keys), expectedGenesis(bob), bob.current.head],
  ['the same key signing twice', { ...genesisConsents[1], signatures: [genesisConsents[1].signatures[0], genesisConsents[1].signatures[0]] }, expectedGenesis(bob), bob.current.head],
  ['no signatures', { ...genesisConsents[1], signatures: [] }, expectedGenesis(bob), bob.current.head],
];
// Governance log vectors, each with the identity logs a replaying verifier needs.
type LogCase = [string, GovernanceLog, IdentityLog[]];
const everyone = people.map(p => p.log);
const logAccept: LogCase[] = [
  ['a genesis with two controllers, each consenting under their current head', genesisOnly, everyone],
  ['a controller joins with a raised threshold, then the founder leaves: every head replays from the consents alone', log, everyone],
  ['the same history verified with only the logs of the people who ever consented', log, everyone],
];
const logReject: LogCase[] = [
  ['a genesis consent missing: every initial controller must consent', await damaged(genesisOnly, l => { l.consents = [l.consents[0]]; }), everyone],
  ['a genesis consent from a person who is not an initial controller', await damaged(genesisOnly, async l => { l.consents.push(await consent(carol, 'genesis', genesisDigest, T + 100_000)); }), everyone],
  ['a person\'s identity log withheld: their head cannot be established, so their consent fails', log, [alice.log, bob.log]],
  ['a transition consented to only by the added controller: the current quorum is missing', await damaged(log, l => { l.entries[0].consents = [l.entries[0].consents[1]]; }), everyone],
  ['a transition adding a controller who did not consent', await damaged(log, l => { l.entries[0].consents = [l.entries[0].consents[0]]; }), everyone],
  ['a transition consented to by one of three where the threshold is two', await damaged(log, l => { l.entries[1].consents = [l.entries[1].consents[0]]; }), everyone],
  ['a transition naming a governance digest that is not the current head', await damaged(log, async l => { const t = { ...t2, expected_digest: head0.head_digest }; l.entries[1] = { transition: t, consents: [await consent(bob, 'transition', await governanceTransitionDigest(t), T + 301_000), await consent(carol, 'transition', await governanceTransitionDigest(t), T + 302_000)] }; }), everyone],
  ['a skipped sequence', await damaged(log, async l => { const t = { ...t2, sequence: 3 }; l.entries[1] = { transition: t, consents: [await consent(bob, 'transition', await governanceTransitionDigest(t), T + 301_000), await consent(carol, 'transition', await governanceTransitionDigest(t), T + 302_000)] }; }), everyone],
  ['entries reordered', await damaged(log, l => { [l.entries[0], l.entries[1]] = [l.entries[1], l.entries[0]]; }), everyone],
  ['a transition body altered after the consents were signed', await damaged(log, l => { l.entries[0].transition.threshold = 1; }), everyone],
  ['a consent under a fabricated person head', await damaged(log, l => { l.entries[0].consents[0].body.head_digest = 'f'.repeat(64); }), everyone],
  ['a transition whose controllers are not in ascending order', await damaged(log, async l => { const t = { ...t1, controllers: [...t1.controllers].reverse() }, d = await sha256Hex(canonicalBytes({ domain: ORGANIZATION_TRANSITION_DOMAIN, body: t })); l.entries = [{ transition: t, consents: [await consent(alice, 'transition', d, T + 201_000), await consent(carol, 'transition', d, T + 202_000)] }]; }), everyone],
  ['a transition that changes nothing', await damaged(log, async l => { const t = { ...t1, controllers: genesis.controllers, threshold: genesis.threshold }; l.entries = [{ transition: t, consents: [await consent(alice, 'transition', await governanceTransitionDigest(t), T + 201_000)] }]; }), everyone],
  ['a genesis consent reused as consent to a transition', await damaged(log, l => { l.entries[0].consents[0] = clone(l.consents[0]); }), everyone],
  ['an unknown format', await damaged(log, l => { (l as { format: string }).format = 'dtp-governance-log-2'; }), everyone],
  ['an extra top-level member', await damaged(log, l => { (l as unknown as Record<string, unknown>).name = 'Example Foods'; }), everyone],
];

const out = {
  description: 'Organization consent and governance history. For every "consents.accept" entry an implementation MUST accept the consent against the stated act and person control head and derive exactly the expected body; it MUST refuse every "consents.reject" entry. For every "governance.accept" entry it MUST replay the governance log, using only the supplied identity logs to establish person control heads, and derive exactly the expected heads; it MUST refuse every "governance.reject" entry. All keys and identities here are published test material.',
  genesis_domain: ORGANIZATION_GENESIS_DOMAIN, consent_domain: ORGANIZATION_CONSENT_DOMAIN, transition_domain: ORGANIZATION_TRANSITION_DOMAIN, format: GOVERNANCE_LOG_FORMAT, window_ms: ORGANIZATION_WINDOW_MS,
  rules: {
    transition_digest: 'SHA-256(UTF-8(canonical JSON of {"domain":transition_domain,"body":transition})) as lowercase hex; it is what consents name and what the next head\'s previous_digest is.',
    head_digest: 'SHA-256(UTF-8(canonical JSON of the governance head)) as lowercase hex, with no domain, like a person control head.',
    consent_head: 'A consent\'s head_digest is the digest of the person control head whose operational quorum signs it; the verifier establishes that head from the person\'s identity log or, at acceptance, from a fresh resolution.',
  },
  keys: labels.map(label => ({ label, key_id: k[label].keyId, secret_key: k[label].secretKey })),
  people: people.map(p => ({ person_id: p.id, log: p.log })),
  consents: {
    accept: await Promise.all(consentAccept.map(async ([why, consent, expected, head]) => ({ why, consent, expected, head, expect: await verifyOrganizationConsent(clone(consent), expected, head, null) }))),
    reject: consentReject.map(([why, consent, expected, head]) => ({ why, consent, expected, head })),
  },
  governance: {
    accept: await Promise.all(logAccept.map(async ([why, log, logs]) => {
      const v = await verifyGovernanceLog(clone(log), controlFromIdentityLogs(await Promise.all(logs.map(l => verifyIdentityLog(clone(l), { require_attestation: true })))));
      return { why, log, people: logs.map(l => (people.find(p => p.log === l) as Person).id), expect: { organization_id: v.organization_id, genesis_digest: v.genesis_digest, heads: v.heads, governance: v.governance } };
    })),
    reject: logReject.map(([why, log, logs]) => ({ why, log, people: logs.map(l => (people.find(p => p.log === l) as Person).id) })),
  },
};
for (const [why, consent, expected, head] of consentReject) {
  const refused = await verifyOrganizationConsent(clone(consent), expected, head, null).then(() => false, () => true);
  if (!refused) throw new Error(`generator: the reference verifier accepted the consent "${why}"`);
}
for (const [why, log, logs] of logReject) {
  const refused = verifyGovernanceLog(clone(log), controlFromIdentityLogs(await Promise.all(logs.map(l => verifyIdentityLog(clone(l), { require_attestation: true }))))).then(() => false, () => true);
  if (!await refused) throw new Error(`generator: the reference verifier accepted the governance log "${why}"`);
}
const target = new URL('../../spec/vectors/organization-governance.json', import.meta.url), text = JSON.stringify(out, null, 2) + '\n';
if (!process.argv.includes('--check')) writeFileSync(target, text);
// A checkout may have converted line endings; the content is what must not drift.
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/organization-governance.json is stale; rerun this script without --check'); process.exit(1); }
console.log('vectors:', out.consents.accept.length, 'consents accepted,', out.consents.reject.length, 'refused;', out.governance.accept.length, 'governance logs accepted,', out.governance.reject.length, 'refused');
