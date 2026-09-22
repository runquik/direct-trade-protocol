/** Organization identity: a keyless derived identifier, controlled by people through governance.
 * Pure derivation, consent verification and governance replay. Authenticating a controller's current
 * control head is a HOST obligation; every function here takes those heads as input.
 * Decision record and normative rules: docs/foundation/organization-identity.md.
 */
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { decodeSignature, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import type { KeyPair } from '../keys.ts';
import { copyIdentityData } from './identity.ts';
import type { Control, Signed } from './identity.ts';
import type { VerifiedIdentityLog } from './identity-log.ts';
import type { Governance } from './authority.ts';

export const ORGANIZATION_GENESIS_DOMAIN = 'DTP-ORGANIZATION-GENESIS-1';
export const ORGANIZATION_CONSENT_DOMAIN = 'DTP-ORGANIZATION-CONSENT-1';
export const ORGANIZATION_TRANSITION_DOMAIN = 'DTP-ORGANIZATION-TRANSITION-1';
export const GOVERNANCE_LOG_FORMAT = 'dtp-governance-log-1';
/** A governance change is a ceremony among up to sixteen people, not a command executed at once. */
export const ORGANIZATION_WINDOW_MS = 86_400_000;
export const MAX_GOVERNANCE_ENTRIES = 4096;
export interface OrganizationGenesis { nonce: string; founder: string; controllers: string[]; threshold: number }
/** One person's consent, signed by their operational quorum, to exactly one genesis or one transition, under
 *  exactly one of their control heads. `digest` is the genesis digest or the transition digest; `head_digest` is
 *  the digest of the person's control head whose operational keys sign. */
export interface OrganizationConsent {
  organization_id: string; subject: 'genesis' | 'transition'; digest: string; person_id: string; head_digest: string;
  issued_at: number; expires_at: number;
}
/** Replaces the governance whose digest is `expected_digest` with the named controllers and threshold. Not itself
 *  signed: its digest is what the consents name. */
export interface GovernanceTransition {
  organization_id: string; expected_digest: string; sequence: number; controllers: string[]; threshold: number;
  issued_at: number; expires_at: number;
}
/** Governance head n. Every member comes from signed material; there is no host-asserted instant, so the digest
 *  is fully owner-determined. `previous_digest` is null at genesis and the transition digest afterwards. */
export interface GovernanceHead { organization_id: string; sequence: number; previous_digest: string | null; controllers: string[]; threshold: number }
export interface GovernanceEntry { transition: GovernanceTransition; consents: Signed<OrganizationConsent>[] }
export interface GovernanceLog { format: typeof GOVERNANCE_LOG_FORMAT; genesis: OrganizationGenesis; consents: Signed<OrganizationConsent>[]; entries: GovernanceEntry[] }
export interface VerifiedGovernance { head: GovernanceHead; head_digest: string }
export interface VerifiedGovernanceLog { organization_id: string; genesis_digest: string; heads: VerifiedGovernance[]; head: GovernanceHead; head_digest: string; governance: Governance }
/** The person control head a consent was signed under, or null when the caller cannot vouch for that head. A host
 *  answers from the resolution it just verified; a replaying verifier answers from the person's identity log. */
export type ControlLookup = (person_id: string, head_digest: string) => Control | null;
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const instant = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const digest = (v: unknown) => sha256Hex(canonicalBytes(v));
function exact(value: unknown, names: string[]): asserts value is Record<string, any> {
  need(value && typeof value === 'object' && !Array.isArray(value), 'plain organization object required');
  const keys = Object.keys(value);
  need(keys.length === names.length && names.every(k => Object.hasOwn(value, k)), 'exact organization fields required');
}
function controllers(value: unknown): asserts value is string[] {
  need(Array.isArray(value) && value.length >= 1 && value.length <= 16 && value.every(uuid), '1-16 person controllers required');
  // One controller set, one id: strictly ascending order also excludes duplicates.
  need(value.every((c, i) => i === 0 || value[i - 1] < c), 'controllers must be distinct and ascending');
}
function window(issued_at: unknown, expires_at: unknown, now: number | null, what: string) {
  need(instant(issued_at) && instant(expires_at) && expires_at > issued_at && expires_at - issued_at <= ORGANIZATION_WINDOW_MS, `invalid ${what} window`);
  if (now !== null) { need(instant(now), 'invalid clock'); need(issued_at <= now && expires_at > now, `${what} expired or not yet valid`); }
}
/** Returns a detached, validated copy. Rejects accessors, extra members and unordered controllers. */
export function parseOrganizationGenesis(value: OrganizationGenesis): OrganizationGenesis {
  const g = copyIdentityData(value); exact(g, ['nonce', 'founder', 'controllers', 'threshold']);
  need(uuid(g.nonce), 'invalid organization nonce'); need(uuid(g.founder), 'invalid founder');
  controllers(g.controllers);
  need(g.controllers.includes(g.founder), 'founder must be an initial controller');
  need(Number.isSafeInteger(g.threshold) && g.threshold >= 1 && g.threshold <= g.controllers.length, 'invalid controller quorum');
  return g;
}
export async function organizationGenesisDigest(genesis: OrganizationGenesis): Promise<string> {
  return sha256Hex(canonicalBytes({ domain: ORGANIZATION_GENESIS_DOMAIN, body: parseOrganizationGenesis(genesis) }));
}
/** First 128 bits of the genesis digest, UUID-formatted. Compare the FULL digest on any collision. */
export async function organizationId(genesis: OrganizationGenesis): Promise<string> {
  const h = await organizationGenesisDigest(genesis);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** The initial governance exactly as the genesis states it, for createAuthorityState. */
export async function organizationGovernance(genesis: OrganizationGenesis): Promise<Governance> {
  const g = parseOrganizationGenesis(genesis);
  return { organization_id: await organizationId(g), controllers: g.controllers.map(id => ({ kind: 'person' as const, id, organization_id: null })), threshold: g.threshold };
}
const governanceOf = (head: GovernanceHead): Governance => ({ organization_id: head.organization_id, controllers: head.controllers.map(id => ({ kind: 'person' as const, id, organization_id: null })), threshold: head.threshold });

// Consent
const consentBytes = (body: OrganizationConsent) => canonicalBytes({ domain: ORGANIZATION_CONSENT_DOMAIN, body });
/** Client side. `keys` are the person's operational keys for the head whose digest the body names. */
export async function signOrganizationConsent(body: OrganizationConsent, keys: KeyPair[]): Promise<Signed<OrganizationConsent>> {
  const b = parseConsentBody(body); need(Array.isArray(keys) && keys.length >= 1 && keys.length <= 8, '1-8 signing keys required');
  return { body: b, signatures: await Promise.all(keys.map(async k => ({ key_id: k.keyId, signature: encodeSignature(await signBytes(k.secretKey, consentBytes(b))) }))) };
}
function parseConsentBody(value: OrganizationConsent): OrganizationConsent {
  const b = copyIdentityData(value); exact(b, ['organization_id', 'subject', 'digest', 'person_id', 'head_digest', 'issued_at', 'expires_at']);
  need(uuid(b.organization_id) && ['genesis', 'transition'].includes(b.subject) && hex64(b.digest) && uuid(b.person_id) && hex64(b.head_digest), 'invalid organization consent');
  window(b.issued_at, b.expires_at, null, 'consent');
  return b;
}
/** Throws unless `signed` is `person_id`'s consent to exactly `expected`, signed by the operational quorum of
 *  `head`, which the caller has authenticated as that person's control head (its digest must be the one the
 *  consent names). `now` is the host's clock at acceptance, or null for a replaying verifier, which has no clock. */
export async function verifyOrganizationConsent(signed: Signed<OrganizationConsent>, expected: { organization_id: string; subject: 'genesis' | 'transition'; digest: string; person_id: string }, head: Control, now: number | null): Promise<OrganizationConsent> {
  const s = copyIdentityData(signed), h = copyIdentityData(head); exact(s, ['body', 'signatures']);
  const b = parseConsentBody(s.body);
  need(b.organization_id === expected.organization_id && b.subject === expected.subject && b.digest === expected.digest && b.person_id === expected.person_id, 'consent does not describe this act');
  need(h.identity_id === b.person_id && b.head_digest === await digest(h), 'consent was not signed under this control head');
  window(b.issued_at, b.expires_at, now, 'consent');
  need(Array.isArray(s.signatures) && s.signatures.length >= 1 && s.signatures.length <= 8, '1-8 consent signatures required');
  const signers = new Set<string>(), bytes = consentBytes(b);
  for (const sig of s.signatures) {
    exact(sig, ['key_id', 'signature']);
    need(typeof sig.key_id === 'string' && typeof sig.signature === 'string' && sig.signature.length <= 128 && !signers.has(sig.key_id), 'invalid or duplicate consent signature');
    need(h.operational.keys.includes(sig.key_id), 'consent must be signed by current operational keys');
    need(await verifyBytes(sig.key_id, bytes, decodeSignature(sig.signature)), 'invalid consent signature'); signers.add(sig.key_id);
  }
  need(signers.size >= h.operational.threshold, 'operational quorum required');
  return b;
}
/** Every consent of a set, one per required person, verified under the head the lookup vouches for. */
async function consentsFrom(consents: Signed<OrganizationConsent>[], required: string[], expected: { organization_id: string; subject: 'genesis' | 'transition'; digest: string }, heads: ControlLookup, now: number | null): Promise<Set<string>> {
  need(Array.isArray(consents) && consents.length <= 32, 'bounded consents required');
  const seen = new Set<string>();
  for (const raw of consents) {
    const c = copyIdentityData(raw); exact(c, ['body', 'signatures']); exact(c.body, ['organization_id', 'subject', 'digest', 'person_id', 'head_digest', 'issued_at', 'expires_at']);
    const person = c.body.person_id; need(uuid(person) && required.includes(person) && !seen.has(person), 'consent from a person who is not asked, or a duplicate');
    const head = heads(person, c.body.head_digest); need(head !== null, 'consenting person\'s control head is not established');
    await verifyOrganizationConsent(c, { ...expected, person_id: person }, head, now); seen.add(person);
  }
  return seen;
}
export async function governanceHeadDigest(head: GovernanceHead): Promise<string> { return digest(copyIdentityData(head)); }
export async function governanceTransitionDigest(transition: GovernanceTransition): Promise<string> {
  return sha256Hex(canonicalBytes({ domain: ORGANIZATION_TRANSITION_DOMAIN, body: parseTransition(transition) }));
}
function parseTransition(value: GovernanceTransition): GovernanceTransition {
  const t = copyIdentityData(value); exact(t, ['organization_id', 'expected_digest', 'sequence', 'controllers', 'threshold', 'issued_at', 'expires_at']);
  need(uuid(t.organization_id) && hex64(t.expected_digest) && Number.isSafeInteger(t.sequence) && t.sequence >= 1, 'invalid governance transition');
  controllers(t.controllers);
  need(Number.isSafeInteger(t.threshold) && t.threshold >= 1 && t.threshold <= t.controllers.length, 'invalid controller quorum');
  window(t.issued_at, t.expires_at, null, 'transition');
  return t;
}
/** Genesis: every initial controller consents to the exact genesis digest. A threshold is not enough at creation,
 *  since a controller carries duties as well as power. Returns governance head 0. */
export async function verifyOrganizationGenesis(genesis: OrganizationGenesis, consents: Signed<OrganizationConsent>[], heads: ControlLookup, now: number | null): Promise<VerifiedGovernance & { organization_id: string; genesis_digest: string }> {
  const g = parseOrganizationGenesis(genesis), genesis_digest = await organizationGenesisDigest(g), organization_id = await organizationId(g);
  const consented = await consentsFrom(consents, g.controllers, { organization_id, subject: 'genesis', digest: genesis_digest }, heads, now);
  need(g.controllers.every(c => consented.has(c)), 'every initial controller must consent to the genesis');
  const head: GovernanceHead = { organization_id, sequence: 0, previous_digest: null, controllers: g.controllers, threshold: g.threshold };
  return { organization_id, genesis_digest, head, head_digest: await digest(head) };
}
/** Succession: the transition names the governance it replaces and is consented to by the current controller
 *  quorum AND by every newly added controller. Removing the founder is an ordinary transition. */
export async function applyGovernanceTransition(current: VerifiedGovernance, entry: GovernanceEntry, heads: ControlLookup, now: number | null): Promise<VerifiedGovernance> {
  // The caller's own verified governance; only the head and its digest matter, and they must agree.
  const cur = { head: copyIdentityData(current.head), head_digest: current.head_digest }; exact(cur.head, ['organization_id', 'sequence', 'previous_digest', 'controllers', 'threshold']);
  need(hex64(cur.head_digest) && cur.head_digest === await digest(cur.head), 'current governance digest mismatch');
  const e = copyIdentityData(entry); exact(e, ['transition', 'consents']);
  const t = parseTransition(e.transition), transition_digest = await governanceTransitionDigest(t);
  need(t.organization_id === cur.head.organization_id && t.expected_digest === cur.head_digest && t.sequence === cur.head.sequence + 1, 'stale governance head');
  window(t.issued_at, t.expires_at, now, 'transition');
  need(canonicalize(t.controllers) !== canonicalize(cur.head.controllers) || t.threshold !== cur.head.threshold, 'transition changes nothing');
  const added = t.controllers.filter(c => !cur.head.controllers.includes(c)), asked = [...cur.head.controllers, ...added];
  const consented = await consentsFrom(e.consents, asked, { organization_id: t.organization_id, subject: 'transition', digest: transition_digest }, heads, now);
  need(cur.head.controllers.filter(c => consented.has(c)).length >= cur.head.threshold, 'controller quorum required');
  need(added.every(c => consented.has(c)), 'every added controller must consent');
  const head: GovernanceHead = { organization_id: t.organization_id, sequence: t.sequence, previous_digest: transition_digest, controllers: t.controllers, threshold: t.threshold };
  return { head, head_digest: await digest(head) };
}
/** A replayable governance history, mirroring the identity log: the genesis and its consents, then one transition
 *  with its consents per head. It needs no clock. It proves that each change was consented to by the people entitled
 *  to consent, under person control heads the caller vouches for; it proves neither completeness nor currency. */
export async function verifyGovernanceLog(log: GovernanceLog, heads: ControlLookup): Promise<VerifiedGovernanceLog> {
  const l = copyIdentityData(log); exact(l, ['format', 'genesis', 'consents', 'entries']);
  need(l.format === GOVERNANCE_LOG_FORMAT, 'unsupported governance log format');
  need(Array.isArray(l.entries) && l.entries.length <= MAX_GOVERNANCE_ENTRIES, 'bounded governance entries required');
  const first = await verifyOrganizationGenesis(l.genesis, l.consents, heads, null);
  let current: VerifiedGovernance = { head: first.head, head_digest: first.head_digest };
  const verified: VerifiedGovernance[] = [current];
  for (const entry of l.entries) { current = await applyGovernanceTransition(current, entry, heads, null); verified.push(current); }
  return { organization_id: first.organization_id, genesis_digest: first.genesis_digest, heads: verified, head: current.head, head_digest: current.head_digest, governance: governanceOf(current.head) };
}
/** A lookup over verified identity logs, for a replaying verifier: a head is vouched for when that person's log
 *  contains it. A person whose log is not supplied has no established head, and their consents fail. */
export function controlFromIdentityLogs(logs: VerifiedIdentityLog[]): ControlLookup {
  const byPerson = new Map<string, VerifiedIdentityLog>();
  for (const log of logs) { need(!byPerson.has(log.identity_id), 'one identity log per person'); byPerson.set(log.identity_id, log); }
  return (person_id, head_digest) => {
    const found = byPerson.get(person_id)?.heads.find(h => h.head_digest === head_digest);
    return found ? structuredClone(found.head) : null;
  };
}
/** A lookup for a host at acceptance: exactly the heads it just resolved, by digest, and nothing else. */
export function controlFromHeads(heads: { head: Control; head_digest: string }[]): ControlLookup {
  const copies = heads.map(h => copyIdentityData(h));
  return (person_id, head_digest) => { const found = copies.find(h => h.head.identity_id === person_id && h.head_digest === head_digest); return found ? structuredClone(found.head) : null; };
}
