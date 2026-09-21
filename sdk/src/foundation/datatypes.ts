/** Bounded foundation vocabulary. Not wired into existing signed command formats. */
import { canonicalize } from '../canonical.ts';

export type EntityKind = 'person' | 'organization' | 'service' | 'resource' | 'record';
export interface EntityReference { kind: EntityKind; id: string; organization_id: string | null }
export interface RevisionReference { entity: EntityReference; revision_id: string; digest: string }
export interface ExternalIdentifier { issuer: EntityReference; type: string; value: string }
export type Knowledge<T> = { state: 'known'; value: T } | { state: 'absent' | 'unknown' | 'withheld' | 'not_applicable' };
export interface TemporalValues { observed_at: string | null; effective_at: string | null; accepted_at: string | null }
export interface DateInterval { start: string; end: string }
export interface InstantInterval { start: string; end: string }
export interface Provenance {
  kind: 'command' | 'observation' | 'commitment' | 'attestation' | 'assessment';
  issuer: EntityReference; inputs: RevisionReference[];
  completeness: 'complete' | 'partial' | 'unknown'; missing_inputs: Knowledge<RevisionReference>[];
  times: TemporalValues; causation: RevisionReference | null; correlation_id: string | null;
}
export class DatatypeError extends Error {
  readonly code: 'invalid_datatype' | 'unsupported_timezone';
  readonly path: string;
  constructor(path: string, reason: string, code: 'invalid_datatype' | 'unsupported_timezone' = 'invalid_datatype') {
    super(`${reason} at ${path}`); this.name = 'DatatypeError'; this.path = path; this.code = code;
  }
}
function requireValue(condition: unknown, path: string, reason: string): asserts condition {
  if (!condition) throw new DatatypeError(path, reason);
}
function fields(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'plain object required');
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, path, 'plain object required');
  const ownKeys = Reflect.ownKeys(value);
  requireValue(ownKeys.length === keys.length && ownKeys.every(key => typeof key === 'string' && keys.includes(key)), path, 'exact declared fields required');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, path, 'own enumerable data fields required');
    requireValue(descriptor.value !== undefined, `${path}.${key}`, 'undefined is not a wire value');
    result[key] = descriptor.value;
  }
  return result;
}
function list(value: unknown, max: number, path: string): unknown[] {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, path, 'plain array required');
  requireValue(value.length <= max, path, 'array limit exceeded');
  requireValue(Reflect.ownKeys(value).length === value.length + 1, path, 'dense array without extra fields required');
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable && descriptor.value !== undefined, path, 'array data elements required');
    result.push(descriptor.value);
  }
  return result;
}
function text(value: unknown, max: number, path: string): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value), path, 'bounded nonempty text required');
  try { canonicalize(value); } catch { throw new DatatypeError(path, 'well-formed Unicode required'); }
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  requireValue(typeof value === 'string' && (choices as readonly string[]).includes(value), path, 'unsupported value');
  return value as T;
}
function uuid(value: unknown, path: string): string {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value), path, 'lowercase UUID required');
  return value;
}
function entity(value: unknown, path: string): EntityReference {
  const o = fields(value, ['kind', 'id', 'organization_id'], path);
  const kind = choice(o.kind, ['person', 'organization', 'service', 'resource', 'record'] as const, `${path}.kind`);
  const global = kind === 'person' || kind === 'organization';
  if (global) requireValue(o.organization_id === null, `${path}.organization_id`, 'global identity requires null scope');
  return { kind, id: uuid(o.id, `${path}.id`), organization_id: global ? null : uuid(o.organization_id, `${path}.organization_id`) };
}
export function parseEntityReference(value: unknown): EntityReference { return entity(value, '$'); }
function revision(value: unknown, path: string): RevisionReference {
  const o = fields(value, ['entity', 'revision_id', 'digest'], path);
  requireValue(typeof o.digest === 'string' && /^[0-9a-f]{64}$/.test(o.digest), `${path}.digest`, 'SHA-256 hex digest required');
  return { entity: entity(o.entity, `${path}.entity`), revision_id: uuid(o.revision_id, `${path}.revision_id`), digest: o.digest };
}
export function parseRevisionReference(value: unknown): RevisionReference { return revision(value, '$'); }
function issuer(value: unknown, path: string): EntityReference {
  const parsed = entity(value, path);
  requireValue(['person', 'organization', 'service'].includes(parsed.kind), path, 'issuer must be a person, organization or service');
  return parsed;
}
export function parseExternalIdentifier(value: unknown): ExternalIdentifier {
  const o = fields(value, ['issuer', 'type', 'value'], '$');
  const type = text(o.type, 96, '$.type');
  requireValue(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(type), '$.type', 'namespaced identifier type required');
  return { issuer: issuer(o.issuer, '$.issuer'), type, value: text(o.value, 512, '$.value') };
}
export function externalIdentifierKey(value: unknown): string { return canonicalize(parseExternalIdentifier(value)); }
export function entityReferenceKey(value: unknown): string { return canonicalize(parseEntityReference(value)); }
function knowledge<T>(value: unknown, parseValue: (value: unknown) => T, path: string): Knowledge<T> {
  // Inspect the discriminator without invoking an accessor, then enforce exact shape.
  requireValue(value !== null && typeof value === 'object', path, 'knowledge object required');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'state');
  requireValue(descriptor && Object.hasOwn(descriptor, 'value'), path, 'knowledge state required');
  const state = choice(descriptor.value, ['known', 'absent', 'unknown', 'withheld', 'not_applicable'] as const, `${path}.state`);
  const o = fields(value, state === 'known' ? ['state', 'value'] : ['state'], path);
  return state === 'known' ? { state, value: parseValue(o.value) } : { state };
}
/** The value parser is local trusted application code, never a wire-supplied validator. */
export function parseKnowledge<T>(value: unknown, parseValue: (value: unknown) => T): Knowledge<T> {
  requireValue(typeof parseValue === 'function', '$', 'local value parser required');
  return knowledge(value, parseValue, '$');
}
function localDate(value: unknown, path: string): string {
  requireValue(typeof value === 'string' && /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value), path, 'YYYY-MM-DD date required');
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], path, 'invalid calendar date');
  return value;
}
export function parseLocalDate(value: unknown): string { return localDate(value, '$'); }
function instant(value: unknown, path: string): string {
  requireValue(typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value), path, 'UTC millisecond instant required');
  localDate(value.slice(0, 10), path);
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString() === value, path, 'invalid UTC instant');
  return value;
}
export function parseInstant(value: unknown): string { return instant(value, '$'); }
/** No tzdb is embedded. Caller explicitly pins supported names; no conversion occurs. */
export function parseTimeZone(value: unknown, supportedZones: readonly string[] = ['UTC']): string {
  const validSyntax = (input: unknown, path: string) => {
    const zone = text(input, 128, path);
    requireValue(zone === 'UTC' || /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*){1,3}$/.test(zone), path, 'timezone name required');
    return zone;
  };
  const zone = validSyntax(value, '$'), supported = list(supportedZones, 1024, '$supportedZones').map((v, i) => validSyntax(v, `$supportedZones[${i}]`));
  requireValue(new Set(supported).size === supported.length, '$supportedZones', 'duplicate timezone names');
  if (!supported.includes(zone)) throw new DatatypeError('$', 'timezone not explicitly supported', 'unsupported_timezone');
  return zone;
}
function interval(value: unknown, parse: (value: unknown, path: string) => string): DateInterval {
  const o = fields(value, ['start', 'end'], '$'), start = parse(o.start, '$.start'), end = parse(o.end, '$.end');
  requireValue(start < end, '$.end', 'interval must end after start'); return { start, end };
}
export function parseDateInterval(value: unknown): DateInterval { return interval(value, localDate); }
export function parseInstantInterval(value: unknown): InstantInterval { return interval(value, instant); }
function temporal(value: unknown, path: string): TemporalValues {
  const o = fields(value, ['observed_at', 'effective_at', 'accepted_at'], path);
  const nullable = (key: string) => o[key] === null ? null : instant(o[key], `${path}.${key}`);
  return { observed_at: nullable('observed_at'), effective_at: nullable('effective_at'), accepted_at: nullable('accepted_at') };
}
export function parseTemporalValues(value: unknown): TemporalValues { return temporal(value, '$'); }
export function parseProvenance(value: unknown): Provenance {
  const o = fields(value, ['kind', 'issuer', 'inputs', 'completeness', 'missing_inputs', 'times', 'causation', 'correlation_id'], '$');
  const kind = choice(o.kind, ['command', 'observation', 'commitment', 'attestation', 'assessment'] as const, '$.kind');
  const completeness = choice(o.completeness, ['complete', 'partial', 'unknown'] as const, '$.completeness');
  const inputs = list(o.inputs, 64, '$.inputs').map((v, i) => revision(v, `$.inputs[${i}]`));
  const missing_inputs = list(o.missing_inputs, 64, '$.missing_inputs').map((v, i) => knowledge(v, input => revision(input, `$.missing_inputs[${i}].value`), `$.missing_inputs[${i}]`));
  requireValue(completeness !== 'complete' || missing_inputs.length === 0, '$.missing_inputs', 'complete provenance cannot have missing inputs');
  requireValue(completeness !== 'partial' || missing_inputs.length > 0, '$.missing_inputs', 'partial provenance must declare missing input coverage');
  const seen = new Map<string, string>();
  const uniqueRevision = (ref: RevisionReference, path: string) => {
    // A revision identity cannot simultaneously have two hashes or be present and missing.
    const key = canonicalize({ entity: ref.entity, revision_id: ref.revision_id });
    requireValue(!seen.has(key), path, 'duplicate or conflicting revision identity'); seen.set(key, ref.digest);
  };
  inputs.forEach((ref, i) => uniqueRevision(ref, `$.inputs[${i}]`));
  missing_inputs.forEach((ref, i) => { if (ref.state === 'known') uniqueRevision(ref.value, `$.missing_inputs[${i}]`); });
  const causation = o.causation === null ? null : revision(o.causation, '$.causation');
  if (causation) {
    const priorDigest = seen.get(canonicalize({ entity: causation.entity, revision_id: causation.revision_id }));
    requireValue(priorDigest === undefined || priorDigest === causation.digest, '$.causation', 'conflicting revision identity');
  }
  return { kind, issuer: issuer(o.issuer, '$.issuer'), inputs, completeness, missing_inputs,
    times: temporal(o.times, '$.times'), causation,
    correlation_id: o.correlation_id === null ? null : uuid(o.correlation_id, '$.correlation_id') };
}
