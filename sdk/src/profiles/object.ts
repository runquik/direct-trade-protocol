/** dtp/object@1: the minimal defining component of a discrete object that has no other defining kind (a location, an
 * account, a vehicle, a sensor, a position in an org chart). Its genesis is `create` ("entered the ledger"); its
 * revision to retired is `retire`. Nothing is deleted. Portable, dependency-free, synchronous.
 * Profile document and fixtures: spec/profiles/object/1.md, spec/profiles/object/1/. */
import { canonicalize } from '../canonical.ts';
import { OBJECT_REF_SCHEMA, checkRefOwner, isClassName, isProtocolClass, validateRefList } from './act.ts';
import type { ObjectRef } from './act.ts';
import { GTIN_SCHEME, isGtin } from './product.ts';
import { GLN_SCHEME, isGln } from './party.ts';

export const OBJECT_PROFILE = 'dtp.object/1';
export const OBJECT_KIND = 'dtp/object@1';
export const OBJECT_SEMANTICS = 'object-v1';
export const OBJECT_STATUSES = ['active', 'retired'] as const;
export const RETIRE_REASONS = ['scrapped', 'lost', 'consumed', 'ended', 'other'] as const;
export const SSCC_SCHEME = 'gs1.sscc';
export const MAX_OBJECT_IDENTIFIERS = 16, MAX_OBJECT_EVIDENCE = 16;
export type ObjectIdentifier = { scheme: string; value: string };
export type ObjectBody = {
  class: string; label: string | null; identifiers: ObjectIdentifier[]; status: typeof OBJECT_STATUSES[number];
  retired: { reason: typeof RETIRE_REASONS[number]; note: string | null } | null; evidence: ObjectRef[];
};
export type ObjectIssue = { path: string; message: string };
export const OBJECT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['class', 'label', 'identifiers', 'status', 'retired', 'evidence'],
  properties: {
    class: { type: 'string', maxLength: 117 }, label: { type: 'string', maxLength: 200, nullable: true },
    identifiers: { type: 'array', maxItems: MAX_OBJECT_IDENTIFIERS, items: { type: 'object', additionalProperties: false, required: ['scheme', 'value'], properties: { scheme: { type: 'string', maxLength: 64 }, value: { type: 'string', maxLength: 128 } } } },
    status: { type: 'string', maxLength: 7, enum: [...OBJECT_STATUSES] },
    retired: { type: 'object', additionalProperties: false, required: ['reason', 'note'], nullable: true, properties: { reason: { type: 'string', maxLength: 8, enum: [...RETIRE_REASONS] }, note: { type: 'string', maxLength: 500, nullable: true } } },
    evidence: { type: 'array', maxItems: MAX_OBJECT_EVIDENCE, items: OBJECT_REF_SCHEMA },
  },
} as const;
const SCHEME = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
/** GS1 SSCC: eighteen digits with the GS1 check digit (weights 3,1,3,... from the right over the payload). */
export function isSscc(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[0-9]{18}$/.test(value)) return false;
  const digits = value.split('').map(Number), check = digits.pop()!;
  return (10 - (digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10 === check;
}

/** Every rule of the profile beyond shape. Returns an empty list for a conforming object body. */
export function validateObject(body: unknown): ObjectIssue[] {
  const issues: ObjectIssue[] = [], fail = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(body) || !exact(body, [...OBJECT_SCHEMA.required])) return [{ path: '$', message: 'exact object fields required' }];
  const b = body as unknown as ObjectBody;
  if (!isClassName(b.class)) fail('$.class', '<namespace>/<name> class required');
  else if (b.class.startsWith('dtp/') && !isProtocolClass(b.class)) fail('$.class', 'not a protocol class; see spec/profiles/classes.json');
  if (b.label !== null && !text(b.label, 200)) fail('$.label', 'bounded label or null required');
  if (!Array.isArray(b.identifiers) || b.identifiers.length > MAX_OBJECT_IDENTIFIERS) fail('$.identifiers', `at most ${MAX_OBJECT_IDENTIFIERS} identifiers`);
  else {
    const seen = new Set<string>();
    b.identifiers.forEach((id, i) => {
      if (!isObject(id) || !exact(id, ['scheme', 'value'])) return fail(`$.identifiers[${i}]`, 'scheme and value required');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && SCHEME.test(id.scheme))) fail(`$.identifiers[${i}].scheme`, 'namespaced identifier scheme required');
      if (!text(id.value, 128)) fail(`$.identifiers[${i}].value`, 'bounded nonempty value required');
      const key = canonicalize([id.scheme, id.value]); if (seen.has(key)) fail(`$.identifiers[${i}]`, 'duplicate identifier'); seen.add(key);
      if (id.scheme === SSCC_SCHEME && !isSscc(id.value)) fail(`$.identifiers[${i}].value`, 'SSCC check digit or length invalid');
      if (id.scheme === GTIN_SCHEME && !isGtin(id.value)) fail(`$.identifiers[${i}].value`, 'GTIN check digit or length invalid');
      if (id.scheme === GLN_SCHEME && !isGln(id.value)) fail(`$.identifiers[${i}].value`, 'GLN check digit or length invalid');
    });
  }
  if (!(OBJECT_STATUSES as readonly string[]).includes(b.status)) fail('$.status', 'active or retired required');
  else if (b.status === 'active' && b.retired !== null) fail('$.retired', 'an active object carries no retirement');
  else if (b.status === 'retired') {
    const r = b.retired as unknown;
    if (!isObject(r) || !exact(r, ['reason', 'note'])) fail('$.retired', 'a retired object states its reason');
    else {
      if (!(RETIRE_REASONS as readonly string[]).includes(r.reason as string)) fail('$.retired.reason', 'scrapped, lost, consumed, ended or other required');
      if (r.note !== null && !text(r.note, 500)) fail('$.retired.note', 'bounded note or null required');
      else if (r.reason === 'other' && r.note === null) fail('$.retired.note', 'reason other needs a note');
    }
  }
  issues.push(...validateRefList(b.evidence, '$.evidence', MAX_OBJECT_EVIDENCE));
  return issues;
}
/** `create`: an object enters the ledger active. */
export function checkObjectGenesis(body: ObjectBody): ObjectIssue[] {
  return body.status === 'active' ? [] : [{ path: '$.status', message: 'an object enters the ledger active; retire it by a revision' }];
}
/** Revisions: the class never changes and no identifier is ever removed. A retired object changes only by being found:
 *  its next revision is active, keeps its label, and cites at least one piece of evidence it did not cite before. */
export function checkObjectContinuity(previous: ObjectBody, next: ObjectBody): ObjectIssue[] {
  const issues: ObjectIssue[] = [];
  if (previous.class !== next.class) issues.push({ path: '$.class', message: 'class is immutable; a different class is a different object' });
  const kept = new Set(next.identifiers.map(id => canonicalize([id.scheme, id.value])));
  if (previous.identifiers.some(id => !kept.has(canonicalize([id.scheme, id.value])))) issues.push({ path: '$.identifiers', message: 'identifiers may be added, never removed' });
  if (previous.status === 'retired') {
    if (next.status !== 'active') issues.push({ path: '$.status', message: 'a retired object changes only by being found active again' });
    else {
      if (next.label !== previous.label) issues.push({ path: '$.label', message: 'finding an object does not rename it' });
      const before = new Set(previous.evidence.map(r => canonicalize(r)));
      if (!next.evidence.some(r => !before.has(canonicalize(r)))) issues.push({ path: '$.evidence', message: 'finding a retired object cites new evidence of it' });
    }
  }
  return issues;
}
/** Host rule: references to the writer's own objects leave minted_by null (checkRefOwner). */
export function checkObjectOwner(body: ObjectBody, organizationId: string): ObjectIssue[] {
  return body.evidence.flatMap((r, i) => checkRefOwner(r, `$.evidence[${i}]`, organizationId));
}
