/** Portable identity log: what a host exports so that anyone can verify an identity's control
 * history without trusting the host. Replay runs the identity state machine itself under a
 * witness timeline, so the rules cannot drift from identity.ts. It proves one owner-authorized
 * history, NOT that the history is complete or current. Format and rules: docs/foundation/identity-log.md;
 * moving between resolvers: docs/foundation/identity-rehoming-proposal.md.
 */
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { sha256HexSync } from '../sha256.ts';
import { decodeSignature, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import type { KeyPair } from '../keys.ts';
import { CLOCK_MARGIN_MS, LEASE_MS, copyIdentityData, createIdentity, rehomeIdentity, transitionIdentity, verifyResolverEnrollment } from './identity.ts';
import type { Control, Genesis, IdentityState, Rehome, ResolverEnrollment, Signed, Transition } from './identity.ts';

export const IDENTITY_LOG_FORMAT = 'dtp-identity-log-2';
/** Format 1 had no rehome member. It remains valid and is verified by the same rules. */
export const LEGACY_IDENTITY_LOG_FORMAT = 'dtp-identity-log-1';
export const HEAD_ATTESTATION_DOMAIN = 'DTP-IDENTITY-LOG-HEAD-1';
export const MAX_LOG_ENTRIES = 4096;
/** The enrolled resolver's statement that this head, with this instant, is the one it accepted. */
export interface HeadAttestation {
  identity_id: string; resolver_id: string; resolver_epoch: number; sequence: number; head_digest: string; effective_at: number;
}
/** entries[n] describes head n. `effective_at` is the only host-asserted value in a control head.
 *  Exactly one of `transition` and `rehome` is set for n >= 1; both are null for n = 0. */
export interface IdentityLogEntry { effective_at: number; transition: Signed<Transition> | null; rehome: Signed<Rehome> | null; attestation: Signed<HeadAttestation> | null }
export interface IdentityLog { format: typeof IDENTITY_LOG_FORMAT | typeof LEGACY_IDENTITY_LOG_FORMAT; genesis: Signed<Genesis>; enrollment: Signed<ResolverEnrollment>; entries: IdentityLogEntry[] }
export interface ResolverBinding { epoch: number; id: string; key_id: string; audience: string }
export interface VerifiedHead { head: Control; head_digest: string; epoch: number; attested: boolean }
export interface VerifiedIdentityLog {
  identity_id: string; genesis_digest: string;
  /** The current binding, and every binding the log has passed through, by epoch. */
  resolver: ResolverBinding; resolvers: ResolverBinding[];
  heads: VerifiedHead[]; head: Control; head_digest: string; retired_keys: string[]; unattested: number[];
  /** The state a host adopting this identity continues from. Lease fields are witness values, not history. */
  state: IdentityState;
}
export interface IdentityLogParts { genesis: Signed<Genesis>; enrollment: Signed<ResolverEnrollment>; entries: IdentityLogEntry[] }
/** What a relying party durably keeps for an identity: the resolver it trusts and its last verified head. */
export interface ResolverPin { resolver_id: string; resolver_key: string; resolver_epoch: number; minimum_sequence: number; minimum_digest: string | null }
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
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const attestationBytes = (body: HeadAttestation) => canonicalBytes({ domain: HEAD_ATTESTATION_DOMAIN, body });
const binding = (s: IdentityState, audience: string): ResolverBinding => ({ epoch: s.resolver_epoch, id: s.resolver_id, key_id: s.resolver_key, audience });

/** Signed by the resolver key the owner enrolled for that epoch. Two different attestations for one
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
function window(body: Record<string, any>, at: number, previous: number, what: string) {
  const { issued_at, expires_at } = body;
  need(instant(issued_at) && instant(expires_at), `invalid ${what} window`);
  need(at >= issued_at, 'effective instant precedes the signed window');
  need(at >= previous, 'effective instants must not decrease');
  need(previous < expires_at, `${what} expired before its predecessor took effect`);
  return { issued_at, expires_at };
}
/** Throws unless the log is one valid, owner-authorized control history. The caller must say
 *  whether unattested heads are acceptable; there is deliberately no default. */
export async function verifyIdentityLog(input: IdentityLog, policy: { require_attestation: boolean }): Promise<VerifiedIdentityLog> {
  fields(policy, ['require_attestation']); need(typeof policy.require_attestation === 'boolean', 'explicit attestation policy required');
  fields(input, ['format', 'genesis', 'enrollment', 'entries']);
  const legacy = input.format === LEGACY_IDENTITY_LOG_FORMAT; need(legacy || input.format === IDENTITY_LOG_FORMAT, 'unsupported identity log format');
  list(input.entries, 1, MAX_LOG_ENTRIES);
  // Detach every part before the first await; each part is bounded by copyIdentityData.
  const genesis = copyIdentityData(input.genesis), enrollment = copyIdentityData(input.enrollment);
  const entries: IdentityLogEntry[] = input.entries.map(raw => {
    const e = copyIdentityData(raw); fields(e, legacy ? ['effective_at', 'transition', 'attestation'] : ['effective_at', 'transition', 'rehome', 'attestation']);
    need(instant(e.effective_at), 'invalid effective instant');
    return { effective_at: e.effective_at, transition: e.transition, rehome: legacy ? null : e.rehome, attestation: e.attestation };
  });
  fields(enrollment, ['body', 'signatures']); need(enrollment.body && typeof enrollment.body === 'object', 'enrollment body required');
  const bound = enrollment.body, first = entries[0];
  need(first.transition === null && first.rehome === null, 'the first entry is the genesis head and carries no transition');
  // Head 0 takes effect when the resolver accepts enrollment, inside the owner-signed enrollment window.
  let state = await createIdentity(genesis, { id: bound.resolver_id, key_id: bound.resolver_key }, first.effective_at);
  await verifyResolverEnrollment(state, enrollment, bound.audience, first.effective_at);
  const resolvers: ResolverBinding[] = [binding(state, bound.audience)];
  const heads: VerifiedHead[] = [], unattested: number[] = [];
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n], at = entry.effective_at;
    if (n > 0) {
      const command = entry.transition, move = entry.rehome, previous = state.head.effective_at;
      need((command === null) !== (move === null), 'every later entry carries exactly one signed transition or rehome');
      if (command !== null) {
        fields(command, ['body', 'signatures']); need(command.body && typeof command.body === 'object', 'transition body required');
        const { expires_at } = window(command.body, at, previous, 'transition');
        need(at <= expires_at - 1 + LEASE_MS + CLOCK_MARGIN_MS, 'effective instant beyond the lease barrier bound');
        // Witness timeline: the latest acceptance instant the signed window allows, with exactly the
        // lease barrier that yields the logged instant. transitionIdentity then applies every rule.
        const witness = { ...state, last_update: previous, last_lease_expiry: at - CLOCK_MARGIN_MS };
        state = await transitionIdentity(witness, command, Math.min(expires_at - 1, at));
      } else {
        fields(move!, ['body', 'signatures']); need(move!.body && typeof move!.body === 'object', 'rehome body required');
        const { expires_at } = window(move!.body, at, previous, 'rehome');
        need(at < expires_at, 'rehome effective instant beyond the signed window');
        // A rehome takes effect when the new resolver adopts it; there is no barrier to reproduce.
        state = await rehomeIdentity({ ...state, last_update: previous }, move!, at);
        need(typeof move!.body.to?.audience === 'string', 'rehome audience required');
        resolvers.push(binding(state, move!.body.to.audience));
      }
      need(state.head.effective_at === at && state.head.sequence === n, 'effective instant not reproducible');
    }
    const current = resolvers[resolvers.length - 1];
    if (entry.attestation === null) { need(!policy.require_attestation, 'resolver head attestation required'); unattested.push(n); }
    else await checkAttestation(entry.attestation, { identity_id: state.head.identity_id, resolver_id: current.id, resolver_epoch: current.epoch, sequence: n, head_digest: state.head_digest, effective_at: at }, current.key_id);
    heads.push({ head: structuredClone(state.head), head_digest: state.head_digest, epoch: current.epoch, attested: entry.attestation !== null });
  }
  return { identity_id: state.head.identity_id, genesis_digest: state.genesis_digest, resolver: resolvers[resolvers.length - 1], resolvers, heads,
    head: structuredClone(state.head), head_digest: state.head_digest, retired_keys: [...state.retired_keys], unattested, state };
}
/** What a verified log says about a head digest obtained elsewhere (a pinned checkpoint, a resolution).
 *  'log-behind' is not a failure of the log and not proof of the checkpoint: the log cannot speak to it.
 *  'conflict' means two histories exist for this identity; never resolve it by picking one silently. */
export function compareCheckpoint(log: VerifiedIdentityLog, checkpoint: { sequence: number; head_digest: string }): 'consistent' | 'log-behind' | 'conflict' {
  need(Number.isSafeInteger(checkpoint.sequence) && checkpoint.sequence >= 0 && hex64(checkpoint.head_digest), 'invalid checkpoint');
  if (checkpoint.sequence >= log.heads.length) return 'log-behind';
  return log.heads[checkpoint.sequence].head_digest === checkpoint.head_digest ? 'consistent' : 'conflict';
}
/** Epoch precedence between two verified histories of one identity. Only the recovery quorum can advance
 *  the epoch, so among forks the history reaching the higher epoch supersedes; forks at one epoch conflict. */
export function precedence(a: VerifiedIdentityLog, b: VerifiedIdentityLog): 'equal' | 'a-extends-b' | 'b-extends-a' | 'a-supersedes-b' | 'b-supersedes-a' | 'conflict' {
  need(a.identity_id === b.identity_id && a.genesis_digest === b.genesis_digest, 'histories of different identities');
  const shared = Math.min(a.heads.length, b.heads.length);
  for (let i = 0; i < shared; i++) if (a.heads[i].head_digest !== b.heads[i].head_digest) {
    if (a.resolver.epoch === b.resolver.epoch) return 'conflict';
    return a.resolver.epoch > b.resolver.epoch ? 'a-supersedes-b' : 'b-supersedes-a';
  }
  if (a.heads.length === b.heads.length) return 'equal';
  return a.heads.length > b.heads.length ? 'a-extends-b' : 'b-extends-a';
}
/** The relying-party procedure: admit a log against a durable pin and return the pin to store in its place.
 *  The log must continue the lineage the pin was enrolled with, at the pinned epoch. A conflict with the pinned
 *  checkpoint is admitted only when the log has reached a higher epoch; it is then reported, never hidden.
 *  The caller stores the returned pin atomically and refuses the former resolver from then on. */
export async function admitIdentityLog(pin: ResolverPin, log: IdentityLog, policy: { require_attestation: boolean }): Promise<{ outcome: 'unchanged' | 'advanced' | 'superseded'; pin: ResolverPin; superseded: { sequence: number; head_digest: string } | null }> {
  pin = copyIdentityData(pin); fields(pin, ['resolver_id', 'resolver_key', 'resolver_epoch', 'minimum_sequence', 'minimum_digest']);
  need(Number.isSafeInteger(pin.resolver_epoch) && pin.resolver_epoch >= 0 && Number.isSafeInteger(pin.minimum_sequence) && pin.minimum_sequence >= 0 && (pin.minimum_digest === null || hex64(pin.minimum_digest)), 'invalid resolver pin');
  const v = await verifyIdentityLog(log, policy);
  const known = v.resolvers.find(r => r.epoch === pin.resolver_epoch);
  need(known && known.id === pin.resolver_id && known.key_id === pin.resolver_key, 'log does not continue the pinned lineage');
  need(v.head.sequence >= pin.minimum_sequence, 'log is behind the pinned checkpoint');
  let outcome: 'unchanged' | 'advanced' | 'superseded' = v.head.sequence === pin.minimum_sequence && v.resolver.epoch === pin.resolver_epoch ? 'unchanged' : 'advanced', superseded = null;
  if (pin.minimum_digest !== null && compareCheckpoint(v, { sequence: pin.minimum_sequence, head_digest: pin.minimum_digest }) === 'conflict') {
    need(v.resolver.epoch > pin.resolver_epoch, 'conflicting control history at the same resolver epoch');
    outcome = 'superseded'; superseded = { sequence: pin.minimum_sequence, head_digest: pin.minimum_digest };
  }
  return { outcome, superseded, pin: { resolver_id: v.resolver.id, resolver_key: v.resolver.key_id, resolver_epoch: v.resolver.epoch, minimum_sequence: v.head.sequence, minimum_digest: v.head_digest } };
}
/** Host side: assemble a log from stored signed material and recorded instants, verify it, and attest
 *  every head of the resolver key's own epochs that lacks an attestation. Heads of other epochs keep
 *  whatever attestation was stored; a host cannot attest an epoch it did not serve. Never emits a log
 *  it cannot verify itself. */
export async function buildIdentityLog(parts: IdentityLogParts, resolverKey: KeyPair | null): Promise<IdentityLog> {
  const log: IdentityLog = copyLog({ format: IDENTITY_LOG_FORMAT, genesis: parts.genesis, enrollment: parts.enrollment, entries: parts.entries });
  const verified = await verifyIdentityLog(log, { require_attestation: false });
  if (resolverKey === null) return log;
  need(verified.resolvers.some(r => r.key_id === resolverKey.keyId), 'only an enrolled resolver key can attest this log');
  for (let n = 0; n < log.entries.length; n++) {
    const r = verified.resolvers[verified.heads[n].epoch];
    if (log.entries[n].attestation === null && r.key_id === resolverKey.keyId) log.entries[n].attestation = await attestHead(verified.heads[n].head, { id: r.id, epoch: r.epoch }, resolverKey);
  }
  const again = await verifyIdentityLog(log, { require_attestation: false });
  need(again.unattested.every(n => again.resolvers[again.heads[n].epoch].key_id !== resolverKey.keyId), 'attestation incomplete');
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
  need(hex64(expectedDigest), 'invalid digest');
  const state = await createIdentity(genesis, { id: b.resolver_id, key_id: b.resolver_key }, b.issued_at);
  // "effective_at" sorts first in a canonical control head, so only the leading integer varies.
  const text = canonicalize({ ...state.head, effective_at: 0 }), lead = '{"effective_at":'; need(text.startsWith(lead + '0,'), 'unexpected canonical head');
  const rest = text.slice(lead.length + 1);
  for (let at = b.issued_at; at < b.expires_at; at++) if (sha256HexSync(lead + at + rest) === expectedDigest) return at;
  return null;
}
