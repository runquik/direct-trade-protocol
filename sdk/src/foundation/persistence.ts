/** Transactional host library. All hooks are trusted local implementations, not request claims. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { canonicalize, sha256Hex } from '../canonical.ts';
import { parseEntityReference, parseRevisionReference, entityReferenceKey } from './datatypes.ts';
import type { EntityReference, RevisionReference } from './datatypes.ts';
import { authorizeAndCharge, createAuthorityState, issueGrant, revokeGrant } from './authority.ts';
import type { AuthorityState, CapabilityGrant, Governance, PrincipalConsent, Limit, ApprovalEvidence, ExecutionAuthority } from './authority.ts';
import type { SemanticRegistry, OperationIntent, OperationDescriptor, EvaluatedOperation, AuthorizedInput, ResourceSnapshot, JsonObject } from './semantics.ts';

export const FOUNDATION_STORE_SCHEMA = `
create schema if not exists dtp_foundation;
create table if not exists dtp_foundation.organization_authority (
 organization_id uuid primary key, revision bigint not null check(revision>=0),
 body jsonb not null, next_sequence bigint not null default 1 check(next_sequence>0)
);
create table if not exists dtp_foundation.entity_revisions (
 organization_id uuid not null references dtp_foundation.organization_authority,
 entity_kind text not null check(entity_kind in ('resource','record')), entity_id uuid not null,
 revision_id uuid not null, digest text not null, profile_digest text not null,
 exact_ref jsonb not null, body jsonb not null, attribution jsonb not null,
 primary key(organization_id,entity_kind,entity_id,revision_id)
);
create table if not exists dtp_foundation.resource_heads (
 organization_id uuid not null references dtp_foundation.organization_authority,
 resource_id uuid not null, revision_id uuid not null, digest text not null,
 profile_digest text not null, exact_ref jsonb not null,
 primary key(organization_id,resource_id)
);
create table if not exists dtp_foundation.business_receipts (
 organization_id uuid not null references dtp_foundation.organization_authority,
 operation_id uuid not null, intent_digest text not null, body jsonb not null,
 primary key(organization_id,operation_id)
);
create table if not exists dtp_foundation.transactional_outbox (
 organization_id uuid not null references dtp_foundation.organization_authority,
 sequence bigint not null check(sequence>0), event_id text not null, operation_id uuid,
 body jsonb not null, primary key(organization_id,sequence), unique(organization_id,event_id)
);
create table if not exists dtp_foundation.governance_history (
 organization_id uuid not null references dtp_foundation.organization_authority,
 revision bigint not null, body jsonb not null, primary key(organization_id,revision)
);
`;
export class PersistenceError extends Error {
  constructor(message: string) { super(message); this.name = 'PersistenceError'; }
}
export interface VerifiedOperation { intent: OperationIntent; actor: EntityReference; grant_id: string }
export interface AcceptedReceipt {
  organization_id: string; operation_id: string; intent_digest: string; plan_digest: string;
  actor: EntityReference; accepted_at: string; revisions: RevisionReference[];
}
export interface StoredRevision { revision: RevisionReference; profile_digest: string; body: JsonObject; original_signed_record: JsonObject }
interface HookBase { organization_id: string; now: number }
interface OperationHook extends HookBase { verified: VerifiedOperation }
export interface PersistenceHooks {
  /** Verify original signatures, current identity, audience, request lifetime and exact intent binding. */
  authenticateOperation(tx: Db, input: Readonly<HookBase & { request: JsonObject }>): Promise<VerifiedOperation>;
  /** Current identities, service sponsor, agency membership/mandate and module installation liveness. */
  authorizeLive(tx: Db, input: Readonly<OperationHook & { authority: AuthorityState; replay: boolean }>): Promise<void>;
  /** Must authorize every exact input, resource snapshot and old receipt before disclosure. */
  authorizeRead(tx: Db, input: Readonly<OperationHook & { revisions: RevisionReference[]; resources: EntityReference[]; receipt: AcceptedReceipt | null }>): Promise<void>;
  /** Exact profile publication/dependency visibility and installation/profile operation intersection. */
  authorizeProfiles(tx: Db, input: Readonly<OperationHook & { descriptor: OperationDescriptor; input_profiles: string[]; output_profiles: string[] }>): Promise<void>;
  /** Trusted accounting plus verified live signatures binding BOTH intent and evaluated-plan digest. */
  approveUsage(tx: Db, input: Readonly<OperationHook & { evaluation: EvaluatedOperation; plan_digest: string }>): Promise<{ usage: Limit[]; approvals: ApprovalEvidence[] }>;
  /** Verify action/proposal-bound controller/delegator signatures and resolve governance transactionally. */
  authenticateGovernance(tx: Db, input: Readonly<HookBase & { action: 'bootstrap' | 'grant' | 'revoke' | 'import'; request: JsonObject; proposal: unknown }>): Promise<{ consents: PrincipalConsent[]; governance: Governance[] }>;
  /** Verify original signed bytes/ref/profile/body, provider authority, import rights and output schema. */
  verifyImport(tx: Db, input: Readonly<HookBase & { revision: StoredRevision }>): Promise<void>;
  /** Final live authentication check and DB commit deadline. No default implementation.
   * Must bind this request and enforce min(valid_until, credential expiry) at SQL commit.
   * Source/read/profile authority must stay locked or otherwise serialized through commit.
   */
  beforeCommit(tx: Db, input: Readonly<OperationHook & { authority: AuthorityState; replay: boolean; request: JsonObject; valid_until: number }>): Promise<void>;
}
export interface FoundationStoreOptions { semantics: SemanticRegistry; now: () => number; hooks: PersistenceHooks }
interface AuthorityRow { revision: string | number; body: AuthorityState; next_sequence: string | number }
interface RevisionRow { exact_ref: RevisionReference; profile_digest: string; body: JsonObject }
interface StoredReceipt { receipt: AcceptedReceipt; verified: VerifiedOperation; execution: ExecutionAuthority; evaluation: EvaluatedOperation; original_signed_request: JsonObject; input_profiles: string[] }

function need(v: unknown, why: string): asserts v { if (!v) throw new PersistenceError(why); }
function uuid(v: unknown): asserts v is string { need(typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v), 'lowercase UUID required'); }
function hash(v: unknown): asserts v is string { need(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), 'exact digest required'); }
function same(a: unknown, b: unknown) { return canonicalize(a) === canonicalize(b); }
/** Refuse accessors before copying. Never invoke caller toJSON, strip fields, or freeze caller data. */
function detach<T>(value: T, maxBytes = 2 * 1024 * 1024): T {
  let nodes = 0;
  const visit = (v: unknown, depth: number): any => {
    need(++nodes <= 65536 && depth <= 20, 'bounded JSON required');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { need(v.length <= 262144, 'JSON string limit'); canonicalize(v); return v; }
    if (typeof v === 'number') { need(Number.isSafeInteger(v), 'safe integer JSON required'); return v; }
    need(v && typeof v === 'object', 'plain JSON required');
    const arr = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    need(arr ? proto === Array.prototype : proto === Object.prototype || proto === null, 'plain JSON required');
    need(keys.length <= 8193 && (!arr || keys.length === v.length + 1), 'bounded dense JSON required');
    const out: any = arr ? [] : {};
    for (const key of keys) {
      if (arr && key === 'length') continue;
      need(typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key), 'unsafe JSON property');
      if (arr) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (v as any[]).length, 'dense JSON required');
      const field = Object.getOwnPropertyDescriptor(v, key); need(field && 'value' in field && field.enumerable, 'JSON data fields required');
      out[key] = visit(field.value, depth + 1);
    }
    return out;
  };
  const out = visit(value, 0); need(new TextEncoder().encode(canonicalize(out)).length <= maxBytes, 'aggregate JSON byte limit'); return out;
}
function frozen<T>(value: T): T {
  const out = detach(value);
  const freeze = (v: any) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(out); return out;
}
function object(v: unknown): asserts v is JsonObject { need(v && typeof v === 'object' && !Array.isArray(v), 'JSON object required'); }
function exact(v: any, keys: string[]) { object(v); need(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), 'exact fields required'); }
function verifiedOperation(value: VerifiedOperation, org: string): VerifiedOperation {
  const v = detach(value, 262144); exact(v, ['intent', 'actor', 'grant_id']); uuid(v.grant_id);
  v.actor = parseEntityReference(v.actor); need(['person', 'service'].includes(v.actor.kind), 'executing principal required');
  const i = v.intent; exact(i, ['operation_id', 'organization_id', 'profile_digest', 'operation', 'descriptor_digest', 'handler_digest', 'resources', 'inputs', 'parameters']);
  uuid(i.operation_id); need(i.organization_id === org, 'represented organization mismatch');
  [i.profile_digest, i.descriptor_digest, i.handler_digest].forEach(hash);
  need(typeof i.operation === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(i.operation) && i.operation.length <= 96, 'operation required');
  need(Array.isArray(i.resources) && i.resources.length > 0 && i.resources.length <= 32 && Array.isArray(i.inputs) && i.inputs.length <= 32, 'bounded references required');
  i.resources = i.resources.map(parseEntityReference); i.inputs = i.inputs.map(parseRevisionReference); object(i.parameters);
  need(i.resources.every(r => r.kind === 'resource' && r.organization_id === org), 'resource scope mismatch');
  need(new Set(i.resources.map(entityReferenceKey)).size === i.resources.length, 'duplicate resources');
  need(new Set(i.inputs.map(r => canonicalize([r.entity, r.revision_id]))).size === i.inputs.length, 'duplicate input references');
  // Source-scoped evidence keeps its exact identity. Origin authorization remains mandatory.
  need(i.inputs.every(r => r.entity.organization_id !== null && ['record', 'resource'].includes(r.entity.kind)), 'input storage kind mismatch');
  return v;
}
function safeInt(v: string | number): number { const n = Number(v); need(Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER, 'storage counter exhausted'); return n; }
function scoped(state: AuthorityState, org: string): AuthorityState {
  need(state.grants.every(g => g.grant.scope.organization_id === org) && state.receipts.every(r => r.organization_id === org), 'authority storage scope mismatch');
  need(state.governance.some(g => g.organization_id === org), 'represented governance missing');
  return { ...state, governance: state.governance.filter(g => g.organization_id === org) };
}
/** This domain hashes host-produced effects, NOT a user's signature over generated bodies. */
export async function entityRevisionDigest(entity: EntityReference, revision_id: string, profile_digest: string, body: JsonObject): Promise<string> {
  const e = parseEntityReference(entity); uuid(revision_id); hash(profile_digest); const b = detach(body, 262144); object(b);
  need(['resource', 'record'].includes(e.kind), 'stored entity kind required');
  return sha256Hex(canonicalize({ domain: 'DTP-ENTITY-REVISION-1', entity: e, revision_id, profile_digest, body: b }));
}

export function createFoundationStore(db: Db, options: FoundationStoreOptions) {
  const hooks = options.hooks, registry = options.semantics;
  for (const name of ['authenticateOperation', 'authorizeLive', 'authorizeRead', 'authorizeProfiles', 'approveUsage', 'authenticateGovernance', 'verifyImport', 'beforeCommit'] as const)
    need(hooks && typeof hooks[name] === 'function', `required local hook: ${name}`);
  need(typeof options.now === 'function' && registry && typeof registry.evaluateAuthorized === 'function', 'local clock and registry required');
  const clock = () => { const n = options.now(); need(Number.isSafeInteger(n) && n >= 0 && n < 8640000000000000, 'valid host clock required'); return n; };
  const lock = async (tx: Db, org: string): Promise<AuthorityRow> => {
    const rows = await tx.query<AuthorityRow>('select revision, body, next_sequence from dtp_foundation.organization_authority where organization_id=$1 for update', [org]);
    need(rows.length === 1, 'organization unavailable'); const row = detach(rows[0]);
    need(row.body.revision === safeInt(row.revision), 'authority revision mismatch'); scoped(row.body, org); return row;
  };
  const save = async (tx: Db, org: string, old: AuthorityRow, state: AuthorityState, sequence: number) => {
    const rows = await tx.query('update dtp_foundation.organization_authority set revision=$2, body=$3::text::jsonb, next_sequence=$4 where organization_id=$1 and revision=$5 returning organization_id', [org, state.revision, JSON.stringify(scoped(state, org)), sequence, old.revision]);
    need(rows.length === 1, 'authority CAS conflict');
  };
  const insertRevision = async (tx: Db, revision: RevisionReference, profile: string, body: JsonObject, attribution: unknown) => {
    await tx.query('insert into dtp_foundation.entity_revisions (organization_id,entity_kind,entity_id,revision_id,digest,profile_digest,exact_ref,body,attribution) values ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8::text::jsonb,$9::text::jsonb)',
      [revision.entity.organization_id, revision.entity.kind, revision.entity.id, revision.revision_id, revision.digest, profile, JSON.stringify(revision), JSON.stringify(body), JSON.stringify(attribution)]);
  };
  const outbox = async (tx: Db, org: string, sequence: number, eventId: string, operationId: string | null, body: unknown) => {
    need(Number.isSafeInteger(sequence) && sequence > 0 && sequence < Number.MAX_SAFE_INTEGER, 'outbox sequence exhausted');
    await tx.query('insert into dtp_foundation.transactional_outbox (organization_id,sequence,event_id,operation_id,body) values ($1,$2,$3,$4,$5::text::jsonb)', [org, sequence, eventId, operationId, JSON.stringify(body)]);
  };
  const resolvedGovernance = async (tx: Db, org: string, action: 'bootstrap' | 'grant' | 'revoke' | 'import', request: JsonObject, proposal: unknown, now: number) => {
    const result = detach(await hooks.authenticateGovernance(tx, frozen({ organization_id: org, action, request, proposal, now })));
    exact(result, ['consents', 'governance']); const checked = createAuthorityState(result.governance);
    need(checked.governance.some(g => g.organization_id === org), 'current governance required');
    return { ...result, governance: checked.governance };
  };
  return Object.freeze({
    async bootstrap(organization_id: string, governance: Governance, originalRequest: JsonObject): Promise<void> {
      uuid(organization_id); const request = detach(originalRequest, 262144), proposed = detach(governance); object(request);
      need(proposed.organization_id === organization_id, 'bootstrap organization mismatch');
      await db.transaction(async tx => {
        const now = clock(), verified = await resolvedGovernance(tx, organization_id, 'bootstrap', request, proposed, now);
        need(same(verified.governance.find(g => g.organization_id === organization_id), proposed), 'bootstrap governance mismatch');
        const unique = new Set(verified.consents.map(c => entityReferenceKey(parseEntityReference(c.principal))));
        need(proposed.controllers.filter(c => unique.has(entityReferenceKey(c))).length >= proposed.threshold, 'bootstrap controller quorum required');
        const state = createAuthorityState([proposed]);
        await tx.query('insert into dtp_foundation.organization_authority (organization_id,revision,body) values ($1,0,$2::text::jsonb)', [organization_id, JSON.stringify(state)]);
        await tx.query('insert into dtp_foundation.governance_history (organization_id,revision,body) values ($1,0,$2::text::jsonb)', [organization_id, JSON.stringify({ action: 'bootstrap', original_signed_request: request, governance: proposed, accepted_at: now })]);
      });
    },
    async govern(organization_id: string, command: { action: 'grant'; grant: CapabilityGrant } | { action: 'revoke'; grant_id: string }, originalRequest: JsonObject): Promise<void> {
      uuid(organization_id); const request = detach(originalRequest, 262144), proposal = detach(command); object(request);
      need(proposal.action === 'grant' || proposal.action === 'revoke', 'unsupported governance action');
      exact(proposal, proposal.action === 'grant' ? ['action', 'grant'] : ['action', 'grant_id']);
      await db.transaction(async tx => {
        const row = await lock(tx, organization_id), now = clock();
        const verified = await resolvedGovernance(tx, organization_id, proposal.action, request, proposal, now);
        const current = { ...row.body, governance: verified.governance };
        if (proposal.action === 'grant') need(proposal.grant.scope.organization_id === organization_id, 'grant organization mismatch');
        const next = proposal.action === 'grant' ? issueGrant(current, proposal.grant, verified.consents, now) : revokeGrant(current, proposal.grant_id, verified.consents);
        if (next.revision === row.body.revision) return;
        await save(tx, organization_id, row, next, safeInt(row.next_sequence) + 1);
        await tx.query('insert into dtp_foundation.governance_history (organization_id,revision,body) values ($1,$2,$3::text::jsonb)', [organization_id, next.revision, JSON.stringify({ proposal, original_signed_request: request, accepted_at: now })]);
        await outbox(tx, organization_id, safeInt(row.next_sequence), `authority:${next.revision}`, null, { kind: 'authority.changed', revision: next.revision });
      });
    },
    /** Explicit verified create-only import; never an alternate way to overwrite a managed resource. */
    async importRevision(organization_id: string, value: StoredRevision, originalRequest: JsonObject): Promise<void> {
      uuid(organization_id); const input = detach(value, 262144), request = detach(originalRequest, 262144); object(request);
      exact(input, ['revision', 'profile_digest', 'body', 'original_signed_record']); input.revision = parseRevisionReference(input.revision); hash(input.profile_digest); object(input.body); object(input.original_signed_record);
      need(input.revision.entity.organization_id === organization_id && ['resource', 'record'].includes(input.revision.entity.kind), 'import organization/kind mismatch');
      await db.transaction(async tx => {
        const row = await lock(tx, organization_id), now = clock();
        const control = await resolvedGovernance(tx, organization_id, 'import', request, input, now);
        const own = control.governance.find(g => g.organization_id === organization_id)!;
        const principals = new Set(control.consents.map(c => entityReferenceKey(parseEntityReference(c.principal))));
        need(own.controllers.filter(c => principals.has(entityReferenceKey(c))).length >= own.threshold, 'import controller quorum required');
        await hooks.verifyImport(tx, frozen({ organization_id, now, revision: input }));
        const entity = input.revision.entity;
        const exists = await tx.query('select entity_id from dtp_foundation.entity_revisions where organization_id=$1 and entity_kind=$2 and entity_id=$3 limit 1', [organization_id, entity.kind, entity.id]);
        need(exists.length === 0, 'import cannot append to or overwrite an existing entity');
        await insertRevision(tx, input.revision, input.profile_digest, input.body, { kind: 'imported_original', original_signed_record: input.original_signed_record, original_signed_request: request });
        if (entity.kind === 'resource') await tx.query('insert into dtp_foundation.resource_heads (organization_id,resource_id,revision_id,digest,profile_digest,exact_ref) values ($1,$2,$3,$4,$5,$6::text::jsonb)', [organization_id, entity.id, input.revision.revision_id, input.revision.digest, input.profile_digest, JSON.stringify(input.revision)]);
        await outbox(tx, organization_id, safeInt(row.next_sequence), `import:${entity.kind}:${entity.id}`, null, { kind: 'revision.imported', revision: input.revision, profile_digest: input.profile_digest });
        await save(tx, organization_id, row, row.body, safeInt(row.next_sequence) + 1);
      });
    },
    async execute(organization_id: string, originalRequest: JsonObject): Promise<AcceptedReceipt> {
      uuid(organization_id); const request = detach(originalRequest, 262144); object(request);
      return db.transaction(async tx => {
        const row = await lock(tx, organization_id), now = clock();
        const verified = verifiedOperation(await hooks.authenticateOperation(tx, frozen({ organization_id, now, request })), organization_id);
        const intent = verified.intent, intentDigest = await sha256Hex(canonicalize(intent));
        const admission = registry.capabilities().find(c => c.descriptor.profile_digest === intent.profile_digest && c.descriptor.name === intent.operation);
        need(admission && admission.descriptor_digest === intent.descriptor_digest && admission.handler_digest === intent.handler_digest, 'unsupported semantic pins');
        const descriptor = detach(admission.descriptor);
        need(descriptor.required_grants.every(g => g === descriptor.name), 'additional prerequisite grants are not supported by this host');
        const previous = await tx.query<{ body: StoredReceipt }>('select body from dtp_foundation.business_receipts where organization_id=$1 and operation_id=$2', [organization_id, intent.operation_id]);
        const old = previous.length ? detach(previous[0].body) : null;
        const base = { organization_id, now, verified };
        const finish = async (execution: ExecutionAuthority, replay: boolean) => {
          const finalNow = clock(); need(finalNow >= now, 'host clock regressed before commit');
          // Recheck from the original locked row, not the just-charged state: approvals
          // must still be live, but no second budget mutation is persisted.
          const check = authorizeAndCharge(row.body, execution, finalNow);
          need(check.replayed === replay, 'final authority replay mismatch');
          const deadlines = check.chain.map(id => row.body.grants.find(g => g.grant.id === id)!.grant.expires_at);
          if (!replay) deadlines.push(...execution.approvals.map(a => a.expires_at));
          const valid_until = Math.min(...deadlines); need(finalNow < valid_until, 'operation authority expired before commit');
          await hooks.beforeCommit(tx, frozen({ ...base, now: finalNow, authority: row.body, replay, request, valid_until }));
        };
        await hooks.authorizeLive(tx, frozen({ ...base, authority: row.body, replay: !!old }));
        await hooks.authorizeRead(tx, frozen({ ...base, revisions: [...intent.inputs, ...(old?.receipt.revisions ?? [])], resources: intent.resources, receipt: old?.receipt ?? null }));
        if (old) {
          need(old.receipt.intent_digest === intentDigest && same(old.receipt.actor, verified.actor) && old.verified.grant_id === verified.grant_id, 'business operation ID conflict');
          await hooks.authorizeProfiles(tx, frozen({ ...base, descriptor, input_profiles: old.input_profiles, output_profiles: descriptor.output_profile_digests }));
          const retry = authorizeAndCharge(row.body, { ...old.execution, actor: verified.actor, grant_id: verified.grant_id, approvals: [] }, now);
          need(retry.replayed, 'receipt/authority invariant failure');
          await finish({ ...old.execution, actor: verified.actor, grant_id: verified.grant_id, approvals: [] }, true);
          return detach(old.receipt);
        }
        need(!row.body.receipts.some(r => r.operation_id === intent.operation_id), 'orphan authority receipt');
        const readRevision = async (ref: RevisionReference): Promise<AuthorizedInput> => {
          const rows = await tx.query<RevisionRow>('select exact_ref, profile_digest, body from dtp_foundation.entity_revisions where organization_id=$1 and entity_kind=$2 and entity_id=$3 and revision_id=$4 and digest=$5', [ref.entity.organization_id, ref.entity.kind, ref.entity.id, ref.revision_id, ref.digest]);
          need(rows.length === 1 && same(rows[0].exact_ref, ref), 'exact revision unavailable');
          return { revision: detach(ref), profile_digest: rows[0].profile_digest, body: detach(rows[0].body) };
        };
        const inputs: AuthorizedInput[] = [], snapshots: ResourceSnapshot[] = [];
        for (const ref of intent.inputs) inputs.push(await readRevision(ref));
        for (const resource of intent.resources) {
          const heads = await tx.query<{ exact_ref: RevisionReference; profile_digest: string }>('select exact_ref, profile_digest from dtp_foundation.resource_heads where organization_id=$1 and resource_id=$2', [organization_id, resource.id]);
          need(heads.length === 1, 'resource unavailable; verified create-only admission required');
          const record = await readRevision(heads[0].exact_ref);
          snapshots.push({ resource, profile_digest: record.profile_digest, current_revision: record.revision, body: record.body });
        }
        const inputProfiles = [...new Set([...inputs, ...snapshots].map(r => r.profile_digest))];
        await hooks.authorizeProfiles(tx, frozen({ ...base, descriptor, input_profiles: inputProfiles, output_profiles: descriptor.output_profile_digests }));
        const evaluation = detach(await registry.evaluateAuthorized(frozen({ intent, authorized_inputs: inputs, snapshots, accepted_at: new Date(now).toISOString() })));
        need(evaluation.intent_digest === intentDigest, 'evaluation intent binding mismatch');
        const planDigest = await sha256Hex(canonicalize(evaluation.plan));
        const accounting = detach(await hooks.approveUsage(tx, frozen({ ...base, evaluation, plan_digest: planDigest })));
        exact(accounting, ['usage', 'approvals']);
        const execution: ExecutionAuthority = { actor: verified.actor, grant_id: verified.grant_id, operation_id: intent.operation_id, intent_digest: intentDigest, plan_digest: planDigest,
          scope: { organization_id, operations: [intent.operation], profiles: [...new Set([intent.profile_digest, ...inputProfiles, ...evaluation.plan.effects.map(e => e.profile_digest)])], resource_ids: intent.resources.map(r => r.id) }, ...accounting };
        const authorized = authorizeAndCharge(row.body, execution, now); need(!authorized.replayed, 'orphan authority receipt');
        let sequence = safeInt(row.next_sequence); const refs: RevisionReference[] = [];
        for (const expected of evaluation.plan.expected_resources) {
          const heads = await tx.query<{ exact_ref: RevisionReference }>('select exact_ref from dtp_foundation.resource_heads where organization_id=$1 and resource_id=$2', [organization_id, expected.resource.id]);
          need(heads.length === 1 && same(heads[0].exact_ref, expected.revision), 'resource CAS conflict');
        }
        await save(tx, organization_id, row, authorized.state, sequence + evaluation.plan.effects.length);
        for (const effect of evaluation.plan.effects) {
          const entity: EntityReference = effect.kind === 'resource.update' ? effect.resource : { kind: 'record', id: effect.record_id, organization_id };
          if (effect.kind === 'record.append') {
            const existing = await tx.query('select entity_id from dtp_foundation.entity_revisions where organization_id=$1 and entity_kind=$2 and entity_id=$3 limit 1', [organization_id, 'record', entity.id]);
            need(existing.length === 0, 'record append must create a new entity');
          }
          const revisionId = effect.kind === 'resource.update' ? effect.next_revision_id : effect.record_id;
          const ref: RevisionReference = { entity, revision_id: revisionId, digest: await entityRevisionDigest(entity, revisionId, effect.profile_digest, effect.body) };
          await insertRevision(tx, ref, effect.profile_digest, effect.body, { kind: 'host_effect', original_signed_request: request, intent_digest: intentDigest, plan_digest: planDigest, actor: verified.actor });
          if (effect.kind === 'resource.update') {
            need(effect.expected_revision !== null, 'unadmitted resource creation');
            const rows = await tx.query('update dtp_foundation.resource_heads set revision_id=$3,digest=$4,exact_ref=$5::text::jsonb where organization_id=$1 and resource_id=$2 and revision_id=$6 and digest=$7 returning resource_id', [organization_id, entity.id, ref.revision_id, ref.digest, JSON.stringify(ref), effect.expected_revision.revision_id, effect.expected_revision.digest]);
            need(rows.length === 1, 'resource CAS conflict');
          }
          refs.push(ref);
          await outbox(tx, organization_id, sequence++, `${intent.operation_id}:${refs.length - 1}`, intent.operation_id, { kind: effect.kind, resource: effect.resource, revision: ref, profile_digest: effect.profile_digest });
        }
        const receipt: AcceptedReceipt = { organization_id, operation_id: intent.operation_id, intent_digest: intentDigest, plan_digest: planDigest, actor: verified.actor, accepted_at: new Date(now).toISOString(), revisions: refs };
        const stored: StoredReceipt = { receipt, verified, execution, evaluation, original_signed_request: request, input_profiles: inputProfiles };
        await tx.query('insert into dtp_foundation.business_receipts (organization_id,operation_id,intent_digest,body) values ($1,$2,$3,$4::text::jsonb)', [organization_id, intent.operation_id, intentDigest, JSON.stringify(stored)]);
        await finish(execution, false);
        return detach(receipt);
      });
    },
  });
}
