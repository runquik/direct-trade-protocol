/** Portable identity log: what a host exports so that anyone can verify an identity's control
 * history without trusting the host. Replay runs the identity state machine itself under a
 * witness timeline, so the rules cannot drift from identity.ts. It proves one owner-authorized
 * history, NOT that the history is complete or current. Format and rules: docs/foundation/identity-log.md.
 */
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { sha256HexSync } from '../sha256.ts';
import { decodeSignature, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import type { KeyPair } from '../keys.ts';
import { CLOCK_MARGIN_MS, LEASE_MS, copyIdentityData, createIdentity, transitionIdentity, verifyResolverEnrollment } from './identity.ts';
import type { Control, Genesis, ResolverEnrollment, Signed, Transition } from './identity.ts';

export const IDENTITY_LOG_FORMAT = 'dtp-identity-log-1';
export const HEAD_ATTESTATION_DOMAIN = 'DTP-IDENTITY-LOG-HEAD-1';
export const MAX_LOG_ENTRIES = 4096;
/** The enrolled resolver's statement that this head, with this instant, is the one it accepted. */
export interface HeadAttestation {
  identity_id: string; resolver_id: string; resolver_epoch: number; sequence: number; head_digest: string; effective_at: number;
}
/** entries[n] describes head n. `effective_at` is the only host-asserted value in a control head. */
export interface IdentityLogEntry { effective_at: number; transition: Signed<Transition> | null; attestation: Signed<HeadAttestation> | null }
export interface IdentityLog { format: typeof IDENTITY_LOG_FORMAT; genesis: Signed<Genesis>; enrollment: Signed<ResolverEnrollment>; entries: IdentityLogEntry[] }
export interface VerifiedHead { head: Control; head_digest: string; attested: boolean }
export interface VerifiedIdentityLog {
  identity_id: string; genesis_digest: string;
  resolver: { id: string; key_id: string; audience: string; epoch: number };
  heads: VerifiedHead[]; head: Control; head_digest: string; retired_keys: string[]; unattested: number[];
}
export interface IdentityLogParts {
  genesis: Signed<Genesis>; enrollment: Signed<ResolverEnrollment>; genesis_effective_at: number;
  transitions: { command: Signed<Transition>; effective_at: number }[];
}
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
function fields(value: unknown, names: string[]): asserts value is Record<string, any> {
  need(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'plain closed log object required');
  const keys = Reflect.ownKeys(value);
  need(keys.length === names.length && keys.every(k => typeof k === 'string' && names.includes(k)), 'exact identity log fields required');
  for (const name of names) { const d = Object.getOwnPropertyDescriptor(value, name); need(d && 'value' in d && d.enumerable, 'log data fields required'); }
}
function list(value: unknown, min: number, max: number): asserts value is unknown[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'plain log array required');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  need(length && 'value' in length && length.value >= min && length.value <= max && Reflect.ownKeys(value).length === length.value + 1, 'bounded dense log array required');
  for (let i = 0; i < length.value; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); need(d && 'value' in d && d.enumerable, 'log array data fields required'); }
}
const instant = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const attestationBytes = (body: HeadAttestation) => canonicalBytes({ domain: HEAD_ATTESTATION_DOMAIN, body });

/** Signed by the resolver key the owner enrolled. Two different attestations for one
 *  (identity, resolver, epoch, sequence) are portable proof that the resolver equivocated. */
export async function attestHead(head: Control, resolver: { id: string; epoch: number }, key: KeyPair): Promise<Signed<HeadAttestation>> {
  const h = copyIdentityData(head), body: HeadAttestation = { identity_id: h.identity_id, resolver_id: resolver.id, resolver_epoch: resolver.epoch,
    sequence: h.sequence, head_digest: await sha256Hex(canonicalBytes(h)), effective_at: h.effective_at };
  return { body, signatures: [{ key_id: key.keyId, signature: encodeSignature(await signBytes(key.secretKey, attestationBytes(body))) }] };
}
async function checkAttestation(signed: Signed<HeadAttestation>, expected: HeadAttestation, resolverKey: string) {
  fields(signed, ['body', 'signatures']); list(signed.signatures, 1, 1);
  need(canonicalize(signed.body) === canonicalize(expected), 'head attestation does not describe this head');
  const s = signed.signatures[0]; fields(s, ['key_id', 'signature']);
  need(s.key_id === resolverKey && typeof s.signature === 'string' && s.signature.length <= 128, 'head attestation must be signed by the enrolled resolver key');
  need(await verifyBytes(resolverKey, attestationBytes(expected), decodeSignature(s.signature)), 'invalid head attestation signature');
}
/** Throws unless the log is one valid, owner-authorized control history. The caller must say
 *  whether unattested heads are acceptable; there is deliberately no default. */
export async function verifyIdentityLog(input: IdentityLog, policy: { require_attestation: boolean }): Promise<VerifiedIdentityLog> {
  fields(policy, ['require_attestation']); need(typeof policy.require_attestation === 'boolean', 'explicit attestation policy required');
  fields(input, ['format', 'genesis', 'enrollment', 'entries']); need(input.format === IDENTITY_LOG_FORMAT, 'unsupported identity log format');
  list(input.entries, 1, MAX_LOG_ENTRIES);
  // Detach every part before the first await; each part is bounded by copyIdentityData.
  const genesis = copyIdentityData(input.genesis), enrollment = copyIdentityData(input.enrollment), entries = input.entries.map(e => copyIdentityData(e)) as IdentityLogEntry[];
  for (const e of entries) { fields(e, ['effective_at', 'transition', 'attestation']); need(instant(e.effective_at), 'invalid effective instant'); }
  fields(enrollment, ['body', 'signatures']); need(enrollment.body && typeof enrollment.body === 'object', 'enrollment body required');
  const bound = enrollment.body, first = entries[0];
  need(first.transition === null, 'the first entry is the genesis head and carries no transition');
  // Head 0 takes effect when the resolver accepts enrollment, inside the owner-signed enrollment window.
  let state = await createIdentity(genesis, { id: bound.resolver_id, key_id: bound.resolver_key }, first.effective_at);
  await verifyResolverEnrollment(state, enrollment, bound.audience, first.effective_at);
  const resolver = { id: state.resolver_id, key_id: state.resolver_key, audience: bound.audience, epoch: state.resolver_epoch };
  const heads: VerifiedHead[] = [], unattested: number[] = [];
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n], at = entry.effective_at;
    if (n > 0) {
      const command = entry.transition; need(command !== null && typeof command === 'object', 'every later entry carries its signed transition');
      fields(command, ['body', 'signatures']); need(command.body && typeof command.body === 'object', 'transition body required');
      const { issued_at, expires_at } = command.body, previous = state.head.effective_at;
      need(instant(issued_at) && instant(expires_at), 'invalid transition window');
      need(at >= issued_at, 'effective instant precedes the signed window');
      need(at >= previous, 'effective instants must not decrease');
      need(previous < expires_at, 'transition expired before its predecessor took effect');
      need(at <= expires_at - 1 + LEASE_MS + CLOCK_MARGIN_MS, 'effective instant beyond the lease barrier bound');
      // Witness timeline: the latest acceptance instant the signed window allows, with exactly the
      // lease barrier that yields the logged instant. transitionIdentity then applies every rule.
      const witness = { ...state, last_update: previous, last_lease_expiry: at - CLOCK_MARGIN_MS };
      state = await transitionIdentity(witness, command, Math.min(expires_at - 1, at));
      need(state.head.effective_at === at && state.head.sequence === n, 'effective instant not reproducible');
    }
    if (entry.attestation === null) { need(!policy.require_attestation, 'resolver head attestation required'); unattested.push(n); }
    else await checkAttestation(entry.attestation, { identity_id: state.head.identity_id, resolver_id: resolver.id, resolver_epoch: resolver.epoch, sequence: n, head_digest: state.head_digest, effective_at: at }, resolver.key_id);
    heads.push({ head: structuredClone(state.head), head_digest: state.head_digest, attested: entry.attestation !== null });
  }
  return { identity_id: state.head.identity_id, genesis_digest: state.genesis_digest, resolver, heads, head: structuredClone(state.head),
    head_digest: state.head_digest, retired_keys: [...state.retired_keys], unattested };
}
/** What a verified log says about a head digest obtained elsewhere (a pinned checkpoint, a resolution).
 *  'log-behind' is not a failure of the log and not proof of the checkpoint: the log cannot speak to it.
 *  'conflict' means two histories exist for this identity; never resolve it by picking one silently. */
export function compareCheckpoint(log: VerifiedIdentityLog, checkpoint: { sequence: number; head_digest: string }): 'consistent' | 'log-behind' | 'conflict' {
  need(Number.isSafeInteger(checkpoint.sequence) && checkpoint.sequence >= 0 && typeof checkpoint.head_digest === 'string' && /^[0-9a-f]{64}$/.test(checkpoint.head_digest), 'invalid checkpoint');
  if (checkpoint.sequence >= log.heads.length) return 'log-behind';
  return log.heads[checkpoint.sequence].head_digest === checkpoint.head_digest ? 'consistent' : 'conflict';
}
/** Host side: assemble a log from stored signed material and recorded instants, verify it, and
 *  attest every head when the resolver key is supplied. Never emits a log it cannot verify itself. */
export async function buildIdentityLog(parts: IdentityLogParts, resolverKey: KeyPair | null): Promise<IdentityLog> {
  const entries: IdentityLogEntry[] = [{ effective_at: parts.genesis_effective_at, transition: null, attestation: null },
    ...parts.transitions.map(t => ({ effective_at: t.effective_at, transition: t.command, attestation: null }))];
  const log: IdentityLog = copyLog({ format: IDENTITY_LOG_FORMAT, genesis: parts.genesis, enrollment: parts.enrollment, entries });
  const verified = await verifyIdentityLog(log, { require_attestation: false });
  if (resolverKey === null) return log;
  need(resolverKey.keyId === verified.resolver.key_id, 'only the enrolled resolver key can attest this log');
  for (let n = 0; n < log.entries.length; n++) log.entries[n].attestation = await attestHead(verified.heads[n].head, verified.resolver, resolverKey);
  await verifyIdentityLog(log, { require_attestation: true });
  return log;
}
function copyLog(log: IdentityLog): IdentityLog {
  return { format: log.format, genesis: copyIdentityData(log.genesis), enrollment: copyIdentityData(log.enrollment), entries: log.entries.map(e => copyIdentityData(e)) };
}
/** For a host that did not record when head 0 took effect. The instant lies in the enrollment
 *  window (at most 300,000 candidates) and the first transition's owner-signed expected_digest
 *  identifies it. Returns null when no instant in the window reproduces the digest. */
export async function recoverGenesisInstant(genesis: Signed<Genesis>, enrollment: Signed<ResolverEnrollment>, expectedDigest: string): Promise<number | null> {
  genesis = copyIdentityData(genesis); enrollment = copyIdentityData(enrollment);
  fields(enrollment, ['body', 'signatures']); const b = enrollment.body; need(b && instant(b.issued_at) && instant(b.expires_at) && b.expires_at - b.issued_at <= 300_000, 'invalid enrollment window');
  need(typeof expectedDigest === 'string' && /^[0-9a-f]{64}$/.test(expectedDigest), 'invalid digest');
  const state = await createIdentity(genesis, { id: b.resolver_id, key_id: b.resolver_key }, b.issued_at);
  // "effective_at" sorts first in a canonical control head, so only the leading integer varies.
  const text = canonicalize({ ...state.head, effective_at: 0 }), lead = '{"effective_at":'; need(text.startsWith(lead + '0,'), 'unexpected canonical head');
  const rest = text.slice(lead.length + 1);
  for (let at = b.issued_at; at < b.expires_at; at++) if (sha256HexSync(lead + at + rest) === expectedDigest) return at;
  return null;
}
