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
export interface ResolverPin { identity_id: string; resolver_id: string; resolver_key: string; resolver_epoch: number; minimum_sequence: number; minimum_digest: string | null }
export const REHOME_REFUSAL_DOMAIN = 'DTP-IDENTITY-REHOME-REFUSAL-1';
/** A destination's signed statement that it did not adopt one rehome and never will. Signed by the key the
 *  rehome names as `to.resolver_key`. A refusal and an attestation of the head that rehome produces, from one
 *  key, are portable proof that the destination equivocated. */
export interface RehomeRefusal { identity_id: string; rehome_digest: string; resolver_id: string; resolver_epoch: number; refused_at: number }
/** Why a relying party refused a log. `invalid-log` carries the verifier's error; the rest are admission rules. */
export type AdmissionRefusal = 'invalid-log' | 'another-identity' | 'unknown-identity' | 'foreign-lineage' | 'behind' | 'conflict' | 'unadopted-move';
export interface IdentityLogAdmission { outcome: 'unchanged' | 'advanced' | 'superseded'; pin: ResolverPin; superseded: { sequence: number; head_digest: string } | null }
export type IdentityLogJudgement = IdentityLogAdmission | { outcome: 'refused'; reason: AdmissionRefusal; error: Error | null };
export const IDENTITY_LOG_PUSH_FORMAT = 'dtp-identity-log-push-1';
export const IDENTITY_LOG_PUSH_ACK_FORMAT = 'dtp-identity-log-push-ack-1';
/** What a wallet sends a relying party after a move: the log, and nothing else. */
export interface IdentityLogPush { format: typeof IDENTITY_LOG_PUSH_FORMAT; log: IdentityLog }
/** The relying party's answer. `binding` is the pin it now holds, or null when it refused. Unsigned. */
export interface IdentityLogPushAck {
  format: typeof IDENTITY_LOG_PUSH_ACK_FORMAT; identity_id: string | null;
  outcome: 'unchanged' | 'advanced' | 'superseded' | 'refused'; reason: AdmissionRefusal | null;
  binding: { resolver_id: string; resolver_epoch: number; sequence: number; head_digest: string } | null;
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
function checkPin(pin: ResolverPin): ResolverPin {
  pin = copyIdentityData(pin); fields(pin, ['identity_id', 'resolver_id', 'resolver_key', 'resolver_epoch', 'minimum_sequence', 'minimum_digest']);
  need(typeof pin.identity_id === 'string' && Number.isSafeInteger(pin.resolver_epoch) && pin.resolver_epoch >= 0 && Number.isSafeInteger(pin.minimum_sequence) && pin.minimum_sequence >= 0 && (pin.minimum_digest === null || hex64(pin.minimum_digest)), 'invalid resolver pin');
  return pin;
}
/** The relying-party procedure over an already verified log; see judgeIdentityLog. */
function judgeVerified(pin: ResolverPin, v: VerifiedIdentityLog): IdentityLogJudgement {
  // Two identities enrolled at one resolver share its binding; the pin is for exactly one of them.
  if (v.identity_id !== pin.identity_id) return { outcome: 'refused', reason: 'another-identity', error: null };
  const known = v.resolvers.find(r => r.epoch === pin.resolver_epoch);
  if (!known || known.id !== pin.resolver_id || known.key_id !== pin.resolver_key) return { outcome: 'refused', reason: 'foreign-lineage', error: null };
  if (v.head.sequence < pin.minimum_sequence) return { outcome: 'refused', reason: 'behind', error: null };
  // Adoption evidence: a move past the pinned epoch counts only when the destination attested the head it created.
  // The former resolver may be gone or hostile, so its attestations cannot be required; the destination adopted, so
  // its attestation always can be. A rehome without one proves the owner's consent, not that the move happened.
  for (let n = 1; n < v.heads.length; n++) {
    const moved = v.heads[n].epoch !== v.heads[n - 1].epoch;
    if (moved && v.heads[n].epoch > pin.resolver_epoch && !v.heads[n].attested) return { outcome: 'refused', reason: 'unadopted-move', error: null };
  }
  let outcome: 'unchanged' | 'advanced' | 'superseded' = v.head.sequence === pin.minimum_sequence && v.resolver.epoch === pin.resolver_epoch ? 'unchanged' : 'advanced', superseded = null;
  if (pin.minimum_digest !== null && compareCheckpoint(v, { sequence: pin.minimum_sequence, head_digest: pin.minimum_digest }) === 'conflict') {
    if (v.resolver.epoch <= pin.resolver_epoch) return { outcome: 'refused', reason: 'conflict', error: null };
    outcome = 'superseded'; superseded = { sequence: pin.minimum_sequence, head_digest: pin.minimum_digest };
  }
  return { outcome, superseded, pin: { identity_id: v.identity_id, resolver_id: v.resolver.id, resolver_key: v.resolver.key_id, resolver_epoch: v.resolver.epoch, minimum_sequence: v.head.sequence, minimum_digest: v.head_digest } };
}
/** The relying-party procedure as a judgement that never throws for an expected refusal: verify the log; require
 *  that it continues the lineage the pin was enrolled with, at the pinned epoch; require adoption evidence for every
 *  move past the pinned epoch; admit a conflict with the pinned checkpoint only when the log has reached a higher
 *  epoch, and then report it, never hide it. An invalid pin is the caller's bug and still throws. */
export async function judgeIdentityLog(pin: ResolverPin, log: IdentityLog, policy: { require_attestation: boolean }): Promise<IdentityLogJudgement> {
  pin = checkPin(pin);
  let v: VerifiedIdentityLog;
  try { v = await verifyIdentityLog(log, policy); } catch (error) { return { outcome: 'refused', reason: 'invalid-log', error: error instanceof Error ? error : new Error(String(error)) }; }
  return judgeVerified(pin, v);
}
const REFUSAL_MESSAGES: Record<Exclude<AdmissionRefusal, 'invalid-log'>, string> = {
  'another-identity': 'log is for another identity', 'unknown-identity': 'identity is not enrolled here',
  'foreign-lineage': 'log does not continue the pinned lineage', 'behind': 'log is behind the pinned checkpoint',
  'conflict': 'conflicting control history at the same resolver epoch', 'unadopted-move': 'move without the destination\'s attestation',
};
/** The relying-party procedure: admit a log against a durable pin and return the pin to store in its place, or throw.
 *  The caller stores the returned pin atomically and refuses the former resolver from then on. */
export async function admitIdentityLog(pin: ResolverPin, log: IdentityLog, policy: { require_attestation: boolean }): Promise<IdentityLogAdmission> {
  const judged = await judgeIdentityLog(pin, log, policy);
  if (judged.outcome !== 'refused') return judged;
  if (judged.reason === 'invalid-log') throw judged.error;
  throw new Error(REFUSAL_MESSAGES[judged.reason]);
}
/** Owner push, relying-party side. The message carries the log and nothing else; the answer is a function of the
 *  message and the pin the relying party holds, so a repeated push is answered identically once admitted
 *  (`unchanged`). `lookup` returns the durable pin for an identity, or null when this relying party never enrolled
 *  it; the caller stores the returned admission's pin atomically with whatever transaction it looked the pin up in. */
export async function receiveIdentityLogPush(message: IdentityLogPush, lookup: (identity_id: string) => Promise<ResolverPin | null>, policy: { require_attestation: boolean }): Promise<{ ack: IdentityLogPushAck; admission: IdentityLogAdmission | null }> {
  const refused = (identity_id: string | null, reason: AdmissionRefusal): { ack: IdentityLogPushAck; admission: null } => ({ ack: { format: IDENTITY_LOG_PUSH_ACK_FORMAT, identity_id, outcome: 'refused', reason, binding: null }, admission: null });
  let v: VerifiedIdentityLog;
  try {
    const m = copyIdentityData(message); fields(m, ['format', 'log']); need(m.format === IDENTITY_LOG_PUSH_FORMAT, 'unsupported identity log push format');
    v = await verifyIdentityLog(m.log, policy);
  } catch { return refused(null, 'invalid-log'); }
  const pin = await lookup(v.identity_id);
  if (pin === null) return refused(v.identity_id, 'unknown-identity');
  const judged = judgeVerified(checkPin(pin), v);
  if (judged.outcome === 'refused') return refused(v.identity_id, judged.reason);
  const p = judged.pin;
  return { ack: { format: IDENTITY_LOG_PUSH_ACK_FORMAT, identity_id: v.identity_id, outcome: judged.outcome, reason: null,
    binding: { resolver_id: p.resolver_id, resolver_epoch: p.resolver_epoch, sequence: p.minimum_sequence, head_digest: p.minimum_digest! } }, admission: judged };
}
/** Wallet side: checks the shape of what a relying party answered. The ack is unsigned; transport authenticates the party. */
export function parseIdentityLogPushAck(value: unknown): IdentityLogPushAck {
  const a = copyIdentityData(value as IdentityLogPushAck); fields(a, ['format', 'identity_id', 'outcome', 'reason', 'binding']);
  need(a.format === IDENTITY_LOG_PUSH_ACK_FORMAT, 'unsupported identity log push ack format');
  need(a.identity_id === null || typeof a.identity_id === 'string', 'invalid push ack identity');
  need(['unchanged', 'advanced', 'superseded', 'refused'].includes(a.outcome), 'invalid push ack outcome');
  need(a.reason === null || ['invalid-log', 'another-identity', 'unknown-identity', 'foreign-lineage', 'behind', 'conflict', 'unadopted-move'].includes(a.reason), 'invalid push ack reason');
  need((a.outcome === 'refused') === (a.reason !== null) && (a.outcome === 'refused') === (a.binding === null), 'push ack outcome, reason and binding disagree');
  if (a.binding !== null) { fields(a.binding, ['resolver_id', 'resolver_epoch', 'sequence', 'head_digest']); need(typeof a.binding.resolver_id === 'string' && instant(a.binding.resolver_epoch) && instant(a.binding.sequence) && hex64(a.binding.head_digest), 'invalid push ack binding'); }
  return a;
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
/** The digest a head commits to when a rehome produces it: `previous_digest` of that head. */
export async function rehomeDigest(rehome: Signed<Rehome>): Promise<string> {
  const r = copyIdentityData(rehome); fields(r, ['body', 'signatures']); fields(r.body, ['identity_id', 'expected_digest', 'sequence', 'from', 'to', 'issued_at', 'expires_at']);
  return sha256Hex(canonicalBytes({ domain: 'DTP-IDENTITY-REHOME-1', body: r.body }));
}
const refusalBytes = (body: RehomeRefusal) => canonicalBytes({ domain: REHOME_REFUSAL_DOMAIN, body });
function rehomeTarget(rehome: Signed<Rehome>) {
  const to = rehome.body.to; fields(to, ['resolver_id', 'resolver_key', 'audience', 'resolver_epoch']);
  need(typeof to.resolver_id === 'string' && typeof to.resolver_key === 'string' && instant(to.resolver_epoch) && typeof rehome.body.identity_id === 'string', 'invalid rehome target');
  return to as { resolver_id: string; resolver_key: string; audience: string; resolver_epoch: number };
}
/** Destination side: a signed statement that this rehome was not adopted here and never will be. The signer must
 *  hold the key the rehome names. Whether the rehome itself is valid is not this function's concern; a refusal of a
 *  rehome that could never have been adopted is harmless. A destination MUST persist what it refused, so that it
 *  never adopts it later: a refusal and an attestation for one rehome from one key is proof of equivocation. */
export async function refuseRehome(rehome: Signed<Rehome>, key: KeyPair, now: number): Promise<Signed<RehomeRefusal>> {
  const r = copyIdentityData(rehome), digest = await rehomeDigest(r), to = rehomeTarget(r);
  need(instant(now), 'invalid refusal instant'); need(key.keyId === to.resolver_key, 'only the destination the rehome names can refuse it');
  const body: RehomeRefusal = { identity_id: r.body.identity_id, rehome_digest: digest, resolver_id: to.resolver_id, resolver_epoch: to.resolver_epoch, refused_at: now };
  return { body, signatures: [{ key_id: key.keyId, signature: encodeSignature(await signBytes(key.secretKey, refusalBytes(body))) }] };
}
/** Throws unless the refusal is the named destination's statement about exactly this rehome. */
export async function verifyRehomeRefusal(refusal: Signed<RehomeRefusal>, rehome: Signed<Rehome>): Promise<RehomeRefusal> {
  const s = copyIdentityData(refusal), r = copyIdentityData(rehome), to = rehomeTarget(r);
  fields(s, ['body', 'signatures']); list(s.signatures, 1, 1); const b = s.body; fields(b, ['identity_id', 'rehome_digest', 'resolver_id', 'resolver_epoch', 'refused_at']);
  need(b.identity_id === r.body.identity_id && b.rehome_digest === await rehomeDigest(r) && b.resolver_id === to.resolver_id && b.resolver_epoch === to.resolver_epoch && instant(b.refused_at), 'refusal does not describe this rehome');
  const sig = s.signatures[0]; fields(sig, ['key_id', 'signature']);
  need(sig.key_id === to.resolver_key && typeof sig.signature === 'string' && sig.signature.length <= 128, 'refusal must be signed by the destination the rehome names');
  need(await verifyBytes(to.resolver_key, refusalBytes(b), decodeSignature(sig.signature)), 'invalid refusal signature');
  return b;
}
/** What a refusal says about a log. `unrelated`: the log contains no head produced by that rehome. `consistent`: it
 *  does, but nobody attested that head, so the log is a dangling consent and the refusal stands. `equivocation`: the
 *  destination attested the head it said it never created; keep both artifacts, they prove it. */
export async function compareRehomeRefusal(refusal: Signed<RehomeRefusal>, log: IdentityLog): Promise<'unrelated' | 'consistent' | 'equivocation'> {
  const v = await verifyIdentityLog(log, { require_attestation: false }), copy = copyLog(log);
  for (let n = 1; n < copy.entries.length; n++) {
    const move = copy.entries[n].rehome; if (move === null) continue;
    let body: RehomeRefusal; try { body = await verifyRehomeRefusal(refusal, move); } catch { continue; }
    need(v.heads[n].head.previous_digest === body.rehome_digest, 'verified head does not commit to its rehome');
    return v.heads[n].attested ? 'equivocation' : 'consistent';
  }
  return 'unrelated';
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
