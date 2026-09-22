/** Person authentication only. Services, data policies and organization/agency authority are separate. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { canonicalBytes, canonicalize, sha256Hex, bytesToHex } from '../canonical.ts';
import { decodeKeyId, decodeSignature, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import type { KeyPair } from '../keys.ts';
import { copyIdentityData, verifyResolution } from './identity.ts';
import type { Signed, Resolution, Signature } from './identity.ts';
import { admitIdentityLog } from './identity-log.ts';
import type { IdentityLog, ResolverPin } from './identity-log.ts';
import { parseEntityReference, parseRevisionReference, entityReferenceKey } from './datatypes.ts';
import type { EntityReference } from './datatypes.ts';
import type { JsonObject, OperationIntent } from './semantics.ts';
import type { VerifiedOperation } from './persistence.ts';

export const PERSON_CHALLENGE_LIFETIME_MS = 60_000;
export const PERSON_MAX_CLOCK_SKEW_MS = 1_000;
export const PERSON_MAX_CLOCK_SAMPLE_MS = 1_000;
export const PERSON_COMMIT_RESERVE_MS = 5_000;
export const PERSON_AUTHENTICATION_SCHEMA = `
create schema if not exists dtp_foundation;
create table if not exists dtp_foundation.person_auth_issuers (
 host_id uuid primary key, audience text not null, issued_count integer not null check(issued_count>=0 and issued_count<=4096)
);
create table if not exists dtp_foundation.person_auth_checkpoints (
 host_id uuid not null, person_id uuid not null, resolver_id uuid not null, resolver_key text not null,
 resolver_epoch bigint not null, sequence bigint not null, digest text not null,
 primary key(host_id,person_id)
);
create table if not exists dtp_foundation.person_auth_challenges (
 host_id uuid not null references dtp_foundation.person_auth_issuers, nonce text not null,
 organization_id uuid not null, person_id uuid not null, grant_id uuid not null,
 intent_digest text not null, binding jsonb not null, issued_at bigint not null, expires_at bigint not null,
 consumed_at bigint, consumed_transaction text, consumed_request_digest text, deadline_ms bigint,
 primary key(host_id,nonce),
 check((consumed_at is null and consumed_transaction is null and consumed_request_digest is null and deadline_ms is null)
    or (consumed_at is not null and consumed_transaction is not null and consumed_request_digest is not null and deadline_ms is not null)),
 check(expires_at>issued_at and expires_at-issued_at<=60000)
);
create index if not exists person_auth_challenges_person on dtp_foundation.person_auth_challenges(host_id,person_id,expires_at);
create or replace function dtp_foundation.enforce_person_auth_deadline() returns trigger language plpgsql as $$
begin
 if NEW.consumed_at is not null and NEW.deadline_ms <= floor(extract(epoch from clock_timestamp())*1000)+5000 then
   raise exception 'person authorization deadline expired before commit';
 end if;
 return NEW;
end;
$$;
drop trigger if exists person_auth_deadline_at_commit on dtp_foundation.person_auth_challenges;
create constraint trigger person_auth_deadline_at_commit after insert or update on dtp_foundation.person_auth_challenges
 deferrable initially deferred for each row execute function dtp_foundation.enforce_person_auth_deadline();
`;
/** The binding the host ENROLLED the person with. The effective binding is the durable checkpoint, which only
 *  admitIdentityMove advances past this epoch; configuration alone can never move a person to another resolver. */
export interface PersonResolverPin {
  person_id: string; resolver_id: string; resolver_key: string; resolver_epoch: number;
  minimum_sequence: number; minimum_digest: string;
}
export interface PersonAuthenticationOptions { host_id: string; audience: string; identities: PersonResolverPin[] }
export interface PersonChallenge {
  host_id: string; nonce: string; organization_id: string; person_id: string; audience: string;
  intent_digest: string; grant_id: string; issued_at: number; expires_at: number;
}
export interface PersonOperationRequest {
  intent: OperationIntent; actor: EntityReference; grant_id: string;
  authentication: { challenge: PersonChallenge; resolution: Signed<Resolution>; signatures: Signature[] };
}
export class PersonAuthenticationError extends Error { constructor(message: string) { super(message); this.name = 'PersonAuthenticationError'; } }
function need(v: unknown, reason: string): asserts v { if (!v) throw new PersonAuthenticationError(reason); }
function uuid(v: unknown): asserts v is string { need(typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v), 'lowercase UUID required'); }
function hash(v: unknown): asserts v is string { need(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), 'exact digest required'); }
function integer(v: unknown): asserts v is number { need(Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < Number.MAX_SAFE_INTEGER - 300000, 'bounded timestamp/counter required'); }
function exact(v: any, fields: string[]) { need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k)), 'exact authentication fields required'); }
function same(a: unknown, b: unknown) { return canonicalize(a) === canonicalize(b); }
function bounded<T>(v: T): T { const copy = copyIdentityData(v); need(canonicalBytes(copy).length <= 262144, 'authentication envelope too large'); return copy; }
function intent(value: OperationIntent, org: string): OperationIntent {
  const i = bounded(value); exact(i, ['operation_id', 'organization_id', 'profile_digest', 'operation', 'descriptor_digest', 'handler_digest', 'resources', 'inputs', 'parameters']);
  uuid(i.operation_id); need(i.organization_id === org, 'intent organization mismatch');
  [i.profile_digest, i.descriptor_digest, i.handler_digest].forEach(hash);
  need(typeof i.operation === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(i.operation) && i.operation.length <= 96, 'operation required');
  need(Array.isArray(i.resources) && i.resources.length > 0 && i.resources.length <= 32 && Array.isArray(i.inputs) && i.inputs.length <= 32, 'bounded references required');
  i.resources = i.resources.map(parseEntityReference); i.inputs = i.inputs.map(parseRevisionReference);
  need(i.resources.every(r => r.kind === 'resource' && r.organization_id === org), 'resource scope mismatch');
  need(new Set(i.resources.map(entityReferenceKey)).size === i.resources.length && new Set(i.inputs.map(r => canonicalize([r.entity, r.revision_id]))).size === i.inputs.length, 'duplicate intent references');
  need(i.parameters && typeof i.parameters === 'object' && !Array.isArray(i.parameters), 'parameters object required');
  return i;
}
function parseChallenge(value: PersonChallenge): PersonChallenge {
  const c = bounded(value); exact(c, ['host_id', 'nonce', 'organization_id', 'person_id', 'audience', 'intent_digest', 'grant_id', 'issued_at', 'expires_at']);
  [c.host_id, c.organization_id, c.person_id, c.grant_id].forEach(uuid); hash(c.nonce); hash(c.intent_digest); integer(c.issued_at); integer(c.expires_at);
  need(typeof c.audience === 'string' && c.audience.length <= 2048, 'audience required');
  need(c.expires_at > c.issued_at && c.expires_at - c.issued_at <= PERSON_CHALLENGE_LIFETIME_MS, 'invalid challenge lifetime'); return c;
}
function parseRequest(value: JsonObject | PersonOperationRequest): PersonOperationRequest {
  const r = bounded(value) as unknown as PersonOperationRequest; exact(r, ['intent', 'actor', 'grant_id', 'authentication']);
  r.actor = parseEntityReference(r.actor); need(r.actor.kind === 'person' && r.actor.organization_id === null, 'only person authentication is supported'); uuid(r.grant_id);
  exact(r.authentication, ['challenge', 'resolution', 'signatures']);
  r.authentication.challenge = parseChallenge(r.authentication.challenge);
  r.intent = intent(r.intent, r.authentication.challenge.organization_id);
  need(Array.isArray(r.authentication.signatures) && r.authentication.signatures.length > 0 && r.authentication.signatures.length <= 8, 'bounded operational signatures required');
  return r;
}
async function signedBytes(r: PersonOperationRequest): Promise<Uint8Array> {
  return canonicalBytes({ domain: 'DTP-PERSON-OPERATION-1', body: { challenge: r.authentication.challenge, actor: r.actor,
    intent_digest: await sha256Hex(canonicalBytes(r.intent)), grant_id: r.grant_id, resolution_digest: await sha256Hex(canonicalBytes(r.authentication.resolution)) } });
}
/** Client helper; does not authenticate the host's challenge or establish its issuer trust. */
export async function signPersonOperation(value: Omit<PersonOperationRequest, 'authentication'> & { challenge: PersonChallenge; resolution: Signed<Resolution> }, keys: KeyPair[]): Promise<PersonOperationRequest> {
  const v = bounded(value); exact(v, ['intent', 'actor', 'grant_id', 'challenge', 'resolution']);
  need(Array.isArray(keys) && keys.length > 0 && keys.length <= 8, 'bounded signing keys required');
  const r: PersonOperationRequest = { intent: v.intent, actor: v.actor, grant_id: v.grant_id, authentication: { challenge: v.challenge, resolution: v.resolution, signatures: [] } };
  const bytes = await signedBytes(r);
  r.authentication.signatures = await Promise.all(keys.map(async k => ({ key_id: k.keyId, signature: encodeSignature(await signBytes(k.secretKey, bytes)) })));
  return parseRequest(r);
}
interface Checkpoint { resolver_id: string; resolver_key: string; resolver_epoch: number | string; sequence: number | string; digest: string }
interface ChallengeRow { binding: PersonChallenge; consumed_at: number | string | null; consumed_request_digest: string | null; consumed_transaction: string | null; deadline_ms: number | string | null }
async function dbNow(tx: Db, hostClock: () => number): Promise<number> {
  const before = hostClock(); integer(before);
  const rows = await tx.query<{ now_ms: string | number }>('select floor(extract(epoch from clock_timestamp())*1000)::bigint as now_ms');
  const after = hostClock(); integer(after); need(after >= before, 'host clock regressed during database sample');
  need(after - before <= PERSON_MAX_CLOCK_SAMPLE_MS, 'database clock sample roundtrip exceeded bound');
  const n = Number(rows[0].now_ms); integer(n);
  // The DB sample occurred somewhere inside this host interval, not at the old admission time.
  need(n >= before - PERSON_MAX_CLOCK_SKEW_MS && n <= after + PERSON_MAX_CLOCK_SKEW_MS, 'host/database clock skew exceeds bound');
  return n;
}

export function createPersonAuthentication(options: PersonAuthenticationOptions, runtime: { now: () => number } = { now: Date.now }) {
  // Local runtime dependency, deliberately separate from the serializable identity/pin configuration.
  const clock = runtime.now; need(typeof clock === 'function', 'trusted host clock required');
  const hostClock = () => { const value = clock(); integer(value); return value; };
  const admissionClock = (admittedAt: number) => {
    integer(admittedAt); const current = hostClock(); integer(current);
    need(admittedAt <= current, 'host admission time is in the future or clock skew exceeds bound');
    return current;
  };
  const config = bounded(options); exact(config, ['host_id', 'audience', 'identities']); uuid(config.host_id);
  need(typeof config.audience === 'string' && config.audience.length <= 2048, 'exact host audience required');
  const url = new URL(config.audience); need(url.origin === config.audience && ['http:', 'https:'].includes(url.protocol), 'exact host audience origin required');
  need(Array.isArray(config.identities) && config.identities.length > 0 && config.identities.length <= 1024, 'explicit person resolver pins required');
  const pins = new Map<string, PersonResolverPin>();
  for (const p of config.identities) {
    exact(p, ['person_id', 'resolver_id', 'resolver_key', 'resolver_epoch', 'minimum_sequence', 'minimum_digest']);
    uuid(p.person_id); uuid(p.resolver_id); decodeKeyId(p.resolver_key); integer(p.resolver_epoch); integer(p.minimum_sequence); hash(p.minimum_digest);
    need(!pins.has(p.person_id), 'duplicate person resolver pin'); pins.set(p.person_id, p);
  }
  const pinFor = (person: string) => { const p = pins.get(person); need(p, 'person resolver not enrolled'); return p; };
  const checkpoint = async (tx: Db, p: PersonResolverPin) => {
    await tx.query('insert into dtp_foundation.person_auth_checkpoints (host_id,person_id,resolver_id,resolver_key,resolver_epoch,sequence,digest) values ($1,$2,$3,$4,$5,$6,$7) on conflict (host_id,person_id) do nothing', [config.host_id, p.person_id, p.resolver_id, p.resolver_key, p.resolver_epoch, p.minimum_sequence, p.minimum_digest]);
    const row = (await tx.query<Checkpoint>('select resolver_id,resolver_key,resolver_epoch,sequence,digest from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2 for update', [config.host_id, p.person_id]))[0];
    integer(Number(row.resolver_epoch)); need(Number(row.resolver_epoch) >= p.resolver_epoch, 'durable resolver pin conflict');
    if (Number(row.resolver_epoch) === p.resolver_epoch) {
      need(row.resolver_id === p.resolver_id && row.resolver_key === p.resolver_key, 'durable resolver pin conflict');
      need(Number(row.sequence) >= p.minimum_sequence, 'configured checkpoint advance requires explicit admission');
      if (Number(row.sequence) === p.minimum_sequence) need(row.digest === p.minimum_digest, 'durable control pin conflict');
    } else { uuid(row.resolver_id); decodeKeyId(row.resolver_key); } // A later epoch was admitted from a verified log; the row is the binding now.
    integer(Number(row.sequence)); hash(row.digest); return row;
  };
  const lockedChallenge = async (tx: Db, c: PersonChallenge): Promise<ChallengeRow> => {
    const rows = await tx.query<ChallengeRow>('select binding,consumed_at,consumed_request_digest,consumed_transaction,deadline_ms from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2 for update', [config.host_id, c.nonce]);
    need(rows.length === 1 && same(rows[0].binding, c), 'challenge unavailable or binding mismatch'); return rows[0];
  };
  return Object.freeze({
    /** Caller MUST use one Db transaction. This is not a public issuance endpoint. */
    async issueChallenge(tx: Db, value: { organization_id: string; person_id: string; intent: OperationIntent; grant_id: string }): Promise<PersonChallenge> {
      const v = bounded(value); exact(v, ['organization_id', 'person_id', 'intent', 'grant_id']);
      [v.organization_id, v.person_id, v.grant_id].forEach(uuid); pinFor(v.person_id);
      const i = intent(v.intent, v.organization_id), intentDigest = await sha256Hex(canonicalBytes(i));
      await tx.query('insert into dtp_foundation.person_auth_issuers (host_id,audience,issued_count) values ($1,$2,0) on conflict (host_id) do nothing', [config.host_id, config.audience]);
      const issuer = (await tx.query<{ audience: string; issued_count: number }>('select audience,issued_count from dtp_foundation.person_auth_issuers where host_id=$1 for update', [config.host_id]))[0];
      need(issuer.audience === config.audience && issuer.issued_count < 4096, 'challenge issuer mismatch or capacity exhausted');
      const now = await dbNow(tx, hostClock);
      const outstanding = (await tx.query<{ n: number }>('select count(*)::int as n from dtp_foundation.person_auth_challenges where host_id=$1 and person_id=$2 and consumed_at is null and expires_at>$3', [config.host_id, v.person_id, now]))[0].n;
      need(outstanding < 16, 'person challenge capacity exhausted');
      const challenge: PersonChallenge = { host_id: config.host_id, nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), organization_id: v.organization_id, person_id: v.person_id,
        audience: config.audience, intent_digest: intentDigest, grant_id: v.grant_id, issued_at: now, expires_at: now + PERSON_CHALLENGE_LIFETIME_MS };
      await tx.query('insert into dtp_foundation.person_auth_challenges (host_id,nonce,organization_id,person_id,grant_id,intent_digest,binding,issued_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9)', [config.host_id, challenge.nonce, v.organization_id, v.person_id, v.grant_id, intentDigest, JSON.stringify(challenge), now, challenge.expires_at]);
      await tx.query('update dtp_foundation.person_auth_issuers set issued_count=issued_count+1 where host_id=$1', [config.host_id]);
      return bounded(challenge);
    },
    async authenticateOperation(tx: Db, input: { organization_id: string; now: number; request: JsonObject }): Promise<VerifiedOperation> {
      const context = bounded(input); exact(context, ['organization_id', 'now', 'request']); uuid(context.organization_id); integer(context.now);
      const enteredAt = admissionClock(context.now);
      const r = parseRequest(context.request), c = r.authentication.challenge, p = pinFor(r.actor.id);
      need(c.host_id === config.host_id && c.audience === config.audience && c.organization_id === context.organization_id && c.person_id === r.actor.id && c.grant_id === r.grant_id, 'authentication context mismatch');
      need(c.intent_digest === await sha256Hex(canonicalBytes(r.intent)), 'challenge intent binding mismatch');
      // One durable person checkpoint across all represented organizations, then its challenge row.
      const head = await checkpoint(tx, p), row = await lockedChallenge(tx, c);
      need(row.consumed_at === null, 'challenge already consumed');
      const now = await dbNow(tx, hostClock); need(hostClock() >= enteredAt, 'host clock regressed after authentication admission');
      need(c.issued_at <= now && c.expires_at > now + PERSON_COMMIT_RESERVE_MS, 'challenge expired');
      const control = await verifyResolution(r.authentication.resolution, { identity_id: r.actor.id, audience: config.audience, challenge: c.nonce,
        resolver_id: head.resolver_id, resolver_key: head.resolver_key, resolver_epoch: Number(head.resolver_epoch), minimum_sequence: Number(head.sequence), minimum_digest: head.digest }, now);
      const bytes = await signedBytes(r), signers = new Set<string>();
      for (const signature of r.authentication.signatures) {
        exact(signature, ['key_id', 'signature']);
        need(typeof signature.key_id === 'string' && typeof signature.signature === 'string' && signature.signature.length <= 128 && !signers.has(signature.key_id), 'invalid or duplicate operational signature');
        need(control.operational.keys.includes(signature.key_id), 'signature is not a current operational key');
        need(await verifyBytes(signature.key_id, bytes, decodeSignature(signature.signature)), 'invalid person operation signature'); signers.add(signature.key_id);
      }
      need(signers.size >= control.operational.threshold, 'operational quorum required');
      const proof = r.authentication.resolution.body, fresh = await dbNow(tx, hostClock), deadline = Math.min(c.expires_at, proof.expires_at);
      need(hostClock() >= enteredAt, 'host clock regressed after authentication admission');
      need(fresh >= now && deadline > fresh + PERSON_COMMIT_RESERVE_MS, 'person proof expired during authentication');
      await tx.query('update dtp_foundation.person_auth_checkpoints set sequence=$3,digest=$4 where host_id=$1 and person_id=$2', [config.host_id, p.person_id, control.sequence, proof.head_digest]);
      const digest = await sha256Hex(canonicalBytes(r));
      const rows = await tx.query('update dtp_foundation.person_auth_challenges set consumed_at=$3,consumed_transaction=txid_current()::text,consumed_request_digest=$4,deadline_ms=$5 where host_id=$1 and nonce=$2 and consumed_at is null returning nonce', [config.host_id, c.nonce, fresh, digest, deadline]);
      need(rows.length === 1, 'challenge consumption conflict');
      return { intent: bounded(r.intent), actor: bounded(r.actor), grant_id: r.grant_id };
    },
    /** Admits a person's move to another resolver from their portable identity log, inside the caller's transaction.
     *  The log must continue the lineage this host enrolled, at the epoch it currently holds; a conflict with the durable
     *  checkpoint is admitted only when the log has reached a higher epoch, and is reported. The durable row becomes the
     *  effective binding, so resolutions from the former resolver are refused from this commit on, across restarts and
     *  regardless of the static configuration. Whether unattested heads are acceptable is the caller's explicit policy. */
    async admitIdentityMove(tx: Db, input: { person_id: string; log: IdentityLog; require_attestation: boolean }) {
      const v = bounded(input); exact(v, ['person_id', 'log', 'require_attestation']); uuid(v.person_id); need(typeof v.require_attestation === 'boolean', 'explicit attestation policy required');
      const p = pinFor(v.person_id), head = await checkpoint(tx, p);
      const pin: ResolverPin = { identity_id: p.person_id, resolver_id: head.resolver_id, resolver_key: head.resolver_key, resolver_epoch: Number(head.resolver_epoch), minimum_sequence: Number(head.sequence), minimum_digest: head.digest };
      const admitted = await admitIdentityLog(pin, v.log, { require_attestation: v.require_attestation }), next = admitted.pin;
      if (admitted.outcome !== 'unchanged') {
        const rows = await tx.query('update dtp_foundation.person_auth_checkpoints set resolver_id=$3,resolver_key=$4,resolver_epoch=$5,sequence=$6,digest=$7 where host_id=$1 and person_id=$2 returning person_id',
          [config.host_id, p.person_id, next.resolver_id, next.resolver_key, next.resolver_epoch, next.minimum_sequence, next.minimum_digest]);
        need(rows.length === 1, 'checkpoint update conflict');
      }
      return { outcome: admitted.outcome, superseded: admitted.superseded, binding: { resolver_id: next.resolver_id, resolver_key: next.resolver_key, resolver_epoch: next.resolver_epoch, sequence: next.minimum_sequence, digest: next.minimum_digest } };
    },
    /** Must be the mandatory transaction-tail hook, including historical business retries. */
    async beforeCommit(tx: Db, input: { organization_id: string; now: number; verified: VerifiedOperation; request: JsonObject; valid_until: number }): Promise<void> {
      // Integration may supply additional trusted authority/replay metadata; select only this hook's explicit inputs.
      need(input && typeof input === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(input)), 'plain commit context required');
      const selected: Record<string, unknown> = {};
      for (const field of ['organization_id', 'now', 'verified', 'request', 'valid_until']) {
        const property = Object.getOwnPropertyDescriptor(input, field);
        need(property && 'value' in property && property.enumerable, 'commit context data fields required'); selected[field] = property.value;
      }
      const context = bounded(selected) as unknown as typeof input;
      uuid(context.organization_id); integer(context.now); integer(context.valid_until);
      const enteredAt = admissionClock(context.now);
      const r = parseRequest(context.request), c = r.authentication.challenge;
      need(c.host_id === config.host_id && c.audience === config.audience && c.organization_id === context.organization_id && c.person_id === r.actor.id && c.grant_id === r.grant_id, 'commit authentication context mismatch');
      need(same(context.verified, { intent: r.intent, actor: r.actor, grant_id: r.grant_id }), 'commit verified binding mismatch');
      const row = await lockedChallenge(tx, c), digest = await sha256Hex(canonicalBytes(r));
      const transaction = (await tx.query<{ id: string }>('select txid_current()::text as id'))[0].id;
      need(row.consumed_at !== null && row.consumed_transaction === transaction && row.consumed_request_digest === digest, 'commit requires this transaction consumed request');
      const now = await dbNow(tx, hostClock); need(hostClock() >= enteredAt && now >= Number(row.consumed_at), 'authentication clock regressed');
      const deadline = Math.min(Number(row.deadline_ms), context.valid_until);
      need(deadline > now + PERSON_COMMIT_RESERVE_MS, 'person authorization deadline expired');
      // Lower only. Deferred SQL trigger also checks the deadline at actual transaction commit.
      await tx.query('set constraints dtp_foundation.person_auth_deadline_at_commit deferred');
      const rows = await tx.query('update dtp_foundation.person_auth_challenges set deadline_ms=$3 where host_id=$1 and nonce=$2 and consumed_request_digest=$4 and deadline_ms>=$3 returning nonce', [config.host_id, c.nonce, deadline, digest]);
      need(rows.length === 1, 'authorization deadline update conflict');
    },
  });
}
