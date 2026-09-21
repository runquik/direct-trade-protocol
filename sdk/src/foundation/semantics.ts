/** Local operator-admitted planning only. No runtime grants, persistence or code loading. */
import { canonicalize, sha256Hex } from '../canonical.ts';
import { parseEntityReference, parseRevisionReference, parseInstant, entityReferenceKey } from './datatypes.ts';
import type { EntityReference, RevisionReference } from './datatypes.ts';

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject { [key: string]: Json }
export type EffectKind = 'resource.update' | 'record.append';
export interface OperationDescriptor {
  profile_digest: string; name: string; input_profile_digests: string[]; output_profile_digests: string[];
  required_grants: string[]; allowed_effects: EffectKind[];
  max_inputs: number; max_resources: number; max_effects: number;
  concurrency: 'exact-revision'; retry: 'business-operation-id';
}
export interface OperationIntent {
  operation_id: string; organization_id: string; profile_digest: string; operation: string;
  descriptor_digest: string; handler_digest: string; resources: EntityReference[];
  inputs: RevisionReference[]; parameters: JsonObject;
}
export interface AuthorizedInput { revision: RevisionReference; profile_digest: string; body: JsonObject }
export interface ResourceSnapshot { resource: EntityReference; profile_digest: string; current_revision: RevisionReference | null; body: JsonObject | null }
export interface AuthorizedOperationInput { intent: OperationIntent; authorized_inputs: AuthorizedInput[]; snapshots: ResourceSnapshot[]; accepted_at: string }
export interface ResourceExpectation { resource: EntityReference; revision: RevisionReference | null }
export interface ResourceUpdate {
  kind: 'resource.update'; resource: EntityReference; expected_revision: RevisionReference | null;
  next_revision_id: string; profile_digest: string; body: JsonObject;
}
export interface RecordAppend { kind: 'record.append'; record_id: string; resource: EntityReference; profile_digest: string; body: JsonObject }
export interface EffectPlan { expected_resources: ResourceExpectation[]; effects: (ResourceUpdate | RecordAppend)[] }
export interface EvaluatedOperation {
  operation_id: string; organization_id: string; intent_digest: string;
  descriptor_digest: string; handler_digest: string; plan: EffectPlan;
}
export interface HandlerAdmission {
  descriptor: OperationDescriptor; descriptor_digest: string; handler_digest: string;
  evaluate: (input: Readonly<AuthorizedOperationInput>) => unknown;
}
export interface OutputValidator { profile_digest: string; validate: (body: Readonly<JsonObject>) => boolean }
export interface SemanticRegistry {
  capabilities(): { descriptor: OperationDescriptor; descriptor_digest: string; handler_digest: string }[];
  evaluateAuthorized(input: unknown): Promise<EvaluatedOperation>;
}
export const MAX_SEMANTIC_BYTES = 256 * 1024;
export class SemanticError extends Error {
  readonly code: 'invalid_semantics' | 'unsupported_semantics' | 'handler_failed';
  constructor(reason: string, code: 'invalid_semantics' | 'unsupported_semantics' | 'handler_failed' = 'invalid_semantics') {
    super(reason); this.name = 'SemanticError'; this.code = code;
  }
}
function demand(value: unknown, reason: string): asserts value { if (!value) throw new SemanticError(reason); }
function boundedCopy(value: unknown): Json {
  let nodes = 0, bytes = 0;
  const encoder = new TextEncoder();
  const countString = (value: string) => {
    demand(value.length <= 65536, 'JSON string limit exceeded');
    let encoded: string;
    try { encoded = canonicalize(value); } catch { throw new SemanticError('invalid JSON string'); }
    bytes += encoder.encode(encoded).length; demand(bytes <= MAX_SEMANTIC_BYTES, 'aggregate JSON byte limit exceeded');
  };
  const visit = (input: unknown, depth: number): Json => {
    demand(++nodes <= 8192 && depth <= 16, 'JSON complexity limit exceeded');
    if (input === null || typeof input === 'boolean') { bytes += 5; return input; }
    if (typeof input === 'string') { countString(input); return input; }
    if (typeof input === 'number') { demand(Number.isSafeInteger(input), 'JSON numbers must be safe integers'); bytes += 24; return input; }
    demand(input !== null && typeof input === 'object', 'plain JSON data required');
    const isArray = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    demand(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'plain JSON containers required');
    if (isArray) {
      demand(input.length <= 256 && Reflect.ownKeys(input).length === input.length + 1, 'bounded dense JSON array required');
      const output: Json[] = []; bytes += input.length + 2;
      for (let i = 0; i < input.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
        demand(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'JSON array getters/holes are forbidden');
        output.push(visit(descriptor.value, depth + 1));
      }
      return output;
    }
    const keys = Reflect.ownKeys(input); demand(keys.length <= 128, 'JSON object field limit exceeded');
    const output: JsonObject = {}; bytes += keys.length * 2 + 2;
    for (const key of keys) {
      demand(typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key), 'unsafe JSON field'); countString(key);
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      demand(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'JSON getters/hidden fields are forbidden');
      output[key] = visit(descriptor.value, depth + 1);
    }
    return output;
  };
  const result = visit(value, 0);
  demand(encoder.encode(canonicalize(result)).length <= MAX_SEMANTIC_BYTES, 'aggregate JSON byte limit exceeded');
  return result;
}
function object(value: unknown): Record<string, any> { demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required'); return value as Record<string, any>; }
function exact(value: unknown, keys: string[]): Record<string, any> {
  const o = object(value); demand(Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k)), 'exact declared fields required'); return o;
}
function array(value: unknown, max: number): any[] { demand(Array.isArray(value) && value.length <= max, 'bounded array required'); return value; }
function hash(value: unknown): string { demand(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'SHA-256 digest required'); return value; }
function uuid(value: unknown): string { demand(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value), 'lowercase UUID required'); return value; }
function name(value: unknown): string { demand(typeof value === 'string' && value.length <= 96 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value), 'bounded operation name required'); return value; }
function count(value: unknown, zero = false): number { demand(Number.isSafeInteger(value) && (value as number) >= (zero ? 0 : 1) && (value as number) <= 32, 'descriptor count out of bounds'); return value as number; }
function unique<T>(values: T[], key: (v: T) => string, reason: string): T[] { demand(new Set(values.map(key)).size === values.length, reason); return values; }
function same(a: unknown, b: unknown): boolean { return canonicalize(a) === canonicalize(b); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function descriptor(value: unknown): OperationDescriptor {
  const o = exact(value, ['profile_digest', 'name', 'input_profile_digests', 'output_profile_digests', 'required_grants', 'allowed_effects', 'max_inputs', 'max_resources', 'max_effects', 'concurrency', 'retry']);
  demand(o.concurrency === 'exact-revision' && o.retry === 'business-operation-id', 'unsupported concurrency or retry contract');
  const allowed_effects = unique(array(o.allowed_effects, 2).map(v => { demand(v === 'resource.update' || v === 'record.append', 'unsupported effect kind'); return v as EffectKind; }), v => v, 'duplicate effect kind');
  demand(allowed_effects.length > 0, 'at least one effect kind required');
  const output_profile_digests = unique(array(o.output_profile_digests, 32).map(hash), v => v, 'duplicate output profile');
  demand(output_profile_digests.length > 0, 'output profile required');
  return { profile_digest: hash(o.profile_digest), name: name(o.name), input_profile_digests: unique(array(o.input_profile_digests, 32).map(hash), v => v, 'duplicate input profile'),
    output_profile_digests, required_grants: unique(array(o.required_grants, 16).map(name), v => v, 'duplicate grant declaration'), allowed_effects,
    max_inputs: count(o.max_inputs, true), max_resources: count(o.max_resources), max_effects: count(o.max_effects), concurrency: o.concurrency, retry: o.retry };
}
export function parseOperationDescriptor(value: unknown): OperationDescriptor { return descriptor(boundedCopy(value)); }
export async function operationDescriptorDigest(value: unknown): Promise<string> { return sha256Hex(canonicalize(parseOperationDescriptor(value))); }
function resource(value: unknown, organization: string): EntityReference {
  const ref = parseEntityReference(value); demand(ref.kind === 'resource' && ref.organization_id === organization, 'resource is outside represented organization'); return ref;
}
function refIdentity(ref: RevisionReference): string { return canonicalize({ entity: ref.entity, revision_id: ref.revision_id }); }
function parseInput(value: unknown): AuthorizedOperationInput {
  const o = exact(boundedCopy(value), ['intent', 'authorized_inputs', 'snapshots', 'accepted_at']);
  const p = exact(o.intent, ['operation_id', 'organization_id', 'profile_digest', 'operation', 'descriptor_digest', 'handler_digest', 'resources', 'inputs', 'parameters']);
  const organization_id = uuid(p.organization_id);
  const intent: OperationIntent = { operation_id: uuid(p.operation_id), organization_id, profile_digest: hash(p.profile_digest), operation: name(p.operation), descriptor_digest: hash(p.descriptor_digest), handler_digest: hash(p.handler_digest),
    resources: unique(array(p.resources, 32).map(v => resource(v, organization_id)), entityReferenceKey, 'duplicate intent resource'),
    inputs: unique(array(p.inputs, 32).map(parseRevisionReference), refIdentity, 'duplicate or conflicting intent input'), parameters: object(p.parameters) as JsonObject };
  const authorized_inputs: AuthorizedInput[] = array(o.authorized_inputs, 32).map(v => { const row = exact(v, ['revision', 'profile_digest', 'body']); return { revision: parseRevisionReference(row.revision), profile_digest: hash(row.profile_digest), body: object(row.body) as JsonObject }; });
  unique(authorized_inputs, v => refIdentity(v.revision), 'duplicate authorized input');
  demand(authorized_inputs.length === intent.inputs.length && intent.inputs.every(ref => authorized_inputs.some(input => same(input.revision, ref))), 'authorized inputs differ from exact intent');
  const snapshots: ResourceSnapshot[] = array(o.snapshots, 32).map(v => {
    const row = exact(v, ['resource', 'profile_digest', 'current_revision', 'body']), ref = resource(row.resource, organization_id);
    const current_revision = row.current_revision === null ? null : parseRevisionReference(row.current_revision);
    demand(current_revision === null || same(current_revision.entity, ref), 'snapshot revision belongs to another resource');
    demand(current_revision === null ? row.body === null : row.body !== null, 'snapshot existence and body differ');
    return { resource: ref, profile_digest: hash(row.profile_digest), current_revision, body: row.body === null ? null : object(row.body) as JsonObject };
  });
  unique(snapshots, v => entityReferenceKey(v.resource), 'duplicate resource snapshot');
  demand(snapshots.length === intent.resources.length && intent.resources.every(ref => snapshots.some(s => same(s.resource, ref))), 'snapshot closure differs from intent resources');
  for (const snap of snapshots) if (snap.current_revision) {
    const input = authorized_inputs.find(v => refIdentity(v.revision) === refIdentity(snap.current_revision!));
    if (input) demand(same(input.revision, snap.current_revision) && input.profile_digest === snap.profile_digest && same(input.body, snap.body), 'input and snapshot contradict exact revision');
  }
  return { intent, authorized_inputs, snapshots, accepted_at: parseInstant(o.accepted_at) };
}
function parsePlan(value: unknown, input: AuthorizedOperationInput, contract: OperationDescriptor, validators: Map<string, OutputValidator['validate']>): EffectPlan {
  const o = exact(boundedCopy(value), ['expected_resources', 'effects']);
  const expected_resources = array(o.expected_resources, contract.max_resources).map(v => {
    const row = exact(v, ['resource', 'revision']); return { resource: resource(row.resource, input.intent.organization_id), revision: row.revision === null ? null : parseRevisionReference(row.revision) };
  });
  unique(expected_resources, v => entityReferenceKey(v.resource), 'duplicate resource expectation');
  demand(expected_resources.length === input.snapshots.length && input.snapshots.every(s => expected_resources.some(e => same(e.resource, s.resource) && same(e.revision, s.current_revision))), 'plan omits or changes snapshot CAS closure');
  const updates = new Set<string>(), newIds = new Set<string>();
  const effects = array(o.effects, contract.max_effects).map((value): ResourceUpdate | RecordAppend => {
    const row = object(value), kind = row.kind;
    demand(contract.allowed_effects.includes(kind), 'effect kind is not admitted');
    exact(row, kind === 'resource.update' ? ['kind', 'resource', 'expected_revision', 'next_revision_id', 'profile_digest', 'body'] : ['kind', 'record_id', 'resource', 'profile_digest', 'body']);
    const ref = resource(row.resource, input.intent.organization_id), snapshot = input.snapshots.find(s => same(s.resource, ref));
    demand(snapshot, 'effect resource not declared in intent');
    const profile_digest = hash(row.profile_digest); demand(contract.output_profile_digests.includes(profile_digest), 'effect output profile is not declared');
    const body = object(row.body) as JsonObject, validator = validators.get(profile_digest); demand(validator, 'output profile validator not admitted');
    let accepted = false;
    try { accepted = validator(freeze(body)) === true; } catch { throw new SemanticError('output profile validation failed'); }
    demand(accepted, 'output profile validation failed');
    const newId = uuid(kind === 'resource.update' ? row.next_revision_id : row.record_id);
    demand(!newIds.has(newId), 'duplicate effect record/revision ID'); newIds.add(newId);
    if (kind === 'resource.update') {
      demand(profile_digest === snapshot.profile_digest, 'resource profile change requires a different admitted contract');
      const key = entityReferenceKey(ref); demand(!updates.has(key), 'duplicate resource update'); updates.add(key);
      const expected_revision = row.expected_revision === null ? null : parseRevisionReference(row.expected_revision);
      demand(same(expected_revision, snapshot.current_revision), 'resource update CAS differs from snapshot');
      demand(newId !== expected_revision?.revision_id, 'resource update must create a new revision');
      return { kind, resource: ref, expected_revision, next_revision_id: newId, profile_digest, body };
    }
    return { kind, record_id: newId, resource: ref, profile_digest, body };
  });
  return { expected_resources, effects };
}
/** Pins are operator assertions; this function cannot authenticate arbitrary local JS artifacts. */
export async function createSemanticRegistry(admissions: readonly HandlerAdmission[], outputValidators: readonly OutputValidator[]): Promise<SemanticRegistry> {
  demand(Array.isArray(admissions) && admissions.length <= 128 && Array.isArray(outputValidators) && outputValidators.length <= 128, 'registry admission limit exceeded');
  const validators = new Map<string, OutputValidator['validate']>();
  for (const validator of outputValidators) {
    demand(validator && typeof validator.validate === 'function', 'local output validator required');
    const pin = hash(validator.profile_digest); demand(!validators.has(pin), 'duplicate output validator'); validators.set(pin, validator.validate);
  }
  const handlers = new Map<string, HandlerAdmission>();
  for (const admission of admissions) {
    demand(admission && typeof admission.evaluate === 'function', 'local synchronous evaluator required');
    const contract = parseOperationDescriptor(admission.descriptor), descriptor_digest = hash(admission.descriptor_digest), handler_digest = hash(admission.handler_digest);
    demand(await sha256Hex(canonicalize(contract)) === descriptor_digest, 'descriptor digest does not match declaration');
    demand(contract.output_profile_digests.every(p => validators.has(p)), 'declared output profile lacks an admitted validator');
    const key = canonicalize([contract.profile_digest, contract.name]); demand(!handlers.has(key), 'duplicate operation admission');
    handlers.set(key, { descriptor: freeze(contract), descriptor_digest, handler_digest, evaluate: admission.evaluate });
  }
  return Object.freeze({
    capabilities: () => [...handlers.values()].map(v => ({ descriptor: structuredClone(v.descriptor), descriptor_digest: v.descriptor_digest, handler_digest: v.handler_digest })),
    async evaluateAuthorized(value: unknown): Promise<EvaluatedOperation> {
      const input = parseInput(value), intent = input.intent, admission = handlers.get(canonicalize([intent.profile_digest, intent.operation]));
      if (!admission) throw new SemanticError('operation profile or name is not admitted', 'unsupported_semantics');
      demand(intent.descriptor_digest === admission.descriptor_digest && intent.handler_digest === admission.handler_digest, 'intent admission pins differ');
      const contract = admission.descriptor;
      demand(intent.inputs.length <= contract.max_inputs && intent.resources.length <= contract.max_resources, 'intent exceeds descriptor bounds');
      demand(input.authorized_inputs.every(v => contract.input_profile_digests.includes(v.profile_digest)) && input.snapshots.every(v => contract.input_profile_digests.includes(v.profile_digest)), 'input or snapshot profile is not declared');
      const intent_digest = await sha256Hex(canonicalize(intent));
      let proposed: unknown;
      try { proposed = admission.evaluate(freeze(input)); } catch { throw new SemanticError('admitted handler failed', 'handler_failed'); }
      const plan = parsePlan(proposed, input, contract, validators);
      return { operation_id: intent.operation_id, organization_id: intent.organization_id, intent_digest, descriptor_digest: admission.descriptor_digest, handler_digest: admission.handler_digest, plan };
    },
  });
}
