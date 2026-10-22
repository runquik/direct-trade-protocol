/** Verb-layer datatypes shared by every verb kind: object references, the act header and protocol object classes.
 * Decisions V3, V5 and V18 of docs/foundation/verb-layer-proposal.md. Portable, dependency-free, synchronous.
 * Document and vectors: spec/profiles/verbs.md, spec/vectors/verb-datatypes.json, spec/profiles/classes.json. */
import { canonicalize } from '../canonical.ts';
import { isInstant } from './order.ts';

/** The verbs carried by event kinds. `create`, `retire` and `claim` are revisions of state kinds and have no act. */
export const ACT_VERBS = ['move', 'transform', 'transfer', 'assign', 'observe', 'value'] as const;
/** How the writer knows: an instrument read it, a person said so, or a model predicted it. Never "verified". */
export const ACT_BASES = ['asserted', 'measured', 'inferred'] as const;
export const MAX_ACT_LINKS = 16;
/** Protocol object classes. Adding one is a reviewed change to these rules and to spec/profiles/classes.json, which is
 *  generated from this list; a private class is namespaced by its publisher's organization id and needs no change here. */
export const OBJECT_CLASSES = ['dtp/account', 'dtp/document', 'dtp/equipment', 'dtp/handling-unit', 'dtp/instrument', 'dtp/location', 'dtp/position', 'dtp/vehicle'] as const;
export const CLASS_REGISTRY_FORMAT = 'dtp-object-classes-1';

/** A reference to an object: its minting organization (null for the writer's own), its root, and optionally an exact revision. */
export type ObjectRef = { minted_by: string | null; root: string; record_id: string | null };
export type EvidenceItem = { ref: ObjectRef | null; document: { digest: string; media_type: string; description: string | null } | null };
export type Act = {
  verb: typeof ACT_VERBS[number]; occurred_at: string; observation: { source_id: string; sequence: number };
  basis: typeof ACT_BASES[number]; references: ObjectRef[]; evidence: EvidenceItem[];
};
export type ActIssue = { path: string; message: string };

export const OBJECT_REF_SCHEMA = { type: 'object', additionalProperties: false, required: ['minted_by', 'root', 'record_id'], properties: { minted_by: { type: 'string', maxLength: 36, nullable: true }, root: { type: 'string', maxLength: 36 }, record_id: { type: 'string', maxLength: 36, nullable: true } } } as const;
const DOCUMENT_SCHEMA = { type: 'object', additionalProperties: false, required: ['digest', 'media_type', 'description'], nullable: true, properties: { digest: { type: 'string', maxLength: 64 }, media_type: { type: 'string', maxLength: 100 }, description: { type: 'string', maxLength: 200, nullable: true } } } as const;
export const ACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verb', 'occurred_at', 'observation', 'basis', 'references', 'evidence'],
  properties: {
    verb: { type: 'string', maxLength: 9, enum: [...ACT_VERBS] }, occurred_at: { type: 'string', maxLength: 24 },
    observation: { type: 'object', additionalProperties: false, required: ['source_id', 'sequence'], properties: { source_id: { type: 'string', maxLength: 200 }, sequence: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } },
    basis: { type: 'string', maxLength: 8, enum: [...ACT_BASES] },
    references: { type: 'array', maxItems: MAX_ACT_LINKS, items: OBJECT_REF_SCHEMA },
    evidence: { type: 'array', maxItems: MAX_ACT_LINKS, items: { type: 'object', additionalProperties: false, required: ['ref', 'document'], properties: { ref: { ...OBJECT_REF_SCHEMA, nullable: true }, document: DOCUMENT_SCHEMA } } },
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASS = /^(dtp|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[a-z][a-z0-9._-]{0,79}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** A class name is `<namespace>/<name>`; a protocol class (namespace `dtp`) must be one this version lists. */
export const isClassName = (v: unknown): v is string => typeof v === 'string' && CLASS.test(v);
export const isProtocolClass = (v: unknown): boolean => (OBJECT_CLASSES as readonly string[]).includes(v as string);

/** Shape and identifier rules of one object reference. Ownership needs the writer's organization: see checkRefOwner. */
export function validateObjectRef(ref: unknown, path: string): ActIssue[] {
  if (!isObject(ref) || !exact(ref, ['minted_by', 'root', 'record_id'])) return [{ path, message: 'minted_by, root and record_id required' }];
  const issues: ActIssue[] = [];
  if (ref.minted_by !== null && !(typeof ref.minted_by === 'string' && UUID.test(ref.minted_by))) issues.push({ path: `${path}.minted_by`, message: 'organization id or null required' });
  if (!(typeof ref.root === 'string' && UUID.test(ref.root))) issues.push({ path: `${path}.root`, message: 'object root required' });
  if (ref.record_id !== null && !(typeof ref.record_id === 'string' && UUID.test(ref.record_id))) issues.push({ path: `${path}.record_id`, message: 'exact revision id or null required' });
  return issues;
}
/** One spelling per object: a reference to the writer's own object leaves `minted_by` null, so a reference that names
 *  the writing organization is refused. A foreign `minted_by` is an attributable claim, never checked against the minter. */
export function checkRefOwner(ref: ObjectRef, path: string, organizationId: string): ActIssue[] {
  return ref.minted_by === organizationId ? [{ path: `${path}.minted_by`, message: 'a reference to the writer\'s own object leaves minted_by null' }] : [];
}
/** References are distinct: the same object reference twice in one list says nothing more. */
export function validateRefList(list: unknown, path: string, max: number): ActIssue[] {
  if (!Array.isArray(list) || list.length > max) return [{ path, message: `at most ${max} references` }];
  const issues: ActIssue[] = [], seen = new Set<string>();
  list.forEach((ref, i) => {
    const own = validateObjectRef(ref, `${path}[${i}]`); issues.push(...own);
    if (own.length === 0) { const key = canonicalize(ref); if (seen.has(key)) issues.push({ path: `${path}[${i}]`, message: 'duplicate reference' }); seen.add(key); }
  });
  return issues;
}

/** Every rule of the act header beyond shape. Returns an empty list for a conforming header. */
export function validateAct(act: unknown, path = '$.act'): ActIssue[] {
  if (!isObject(act) || !exact(act, [...ACT_SCHEMA.required])) return [{ path, message: 'exact act fields required' }];
  const issues: ActIssue[] = [], fail = (p: string, message: string) => { issues.push({ path: p, message }); }, a = act as unknown as Act;
  if (!(ACT_VERBS as readonly string[]).includes(a.verb)) fail(`${path}.verb`, 'an event verb required');
  if (!isInstant(a.occurred_at)) fail(`${path}.occurred_at`, 'UTC millisecond instant required');
  const o = a.observation as unknown;
  if (!isObject(o) || !exact(o, ['source_id', 'sequence']) || !text(o.source_id, 200) || !(Number.isSafeInteger(o.sequence) && (o.sequence as number) >= 1)) fail(`${path}.observation`, 'source id and positive sequence required');
  if (!(ACT_BASES as readonly string[]).includes(a.basis)) fail(`${path}.basis`, 'asserted, measured or inferred required');
  issues.push(...validateRefList(a.references, `${path}.references`, MAX_ACT_LINKS));
  if (!Array.isArray(a.evidence) || a.evidence.length > MAX_ACT_LINKS) fail(`${path}.evidence`, `at most ${MAX_ACT_LINKS} evidence items`);
  else {
    const seen = new Set<string>();
    a.evidence.forEach((e, i) => {
      const at = `${path}.evidence[${i}]`;
      if (!isObject(e) || !exact(e, ['ref', 'document'])) return fail(at, 'ref and document required');
      if ((e.ref === null) === (e.document === null)) return fail(at, 'exactly one of ref and document');
      if (e.ref !== null) { const own = validateObjectRef(e.ref, `${at}.ref`); issues.push(...own); if (own.length) return; }
      else {
        const d = e.document as unknown;
        if (!isObject(d) || !exact(d, ['digest', 'media_type', 'description'])) return fail(`${at}.document`, 'digest, media_type and description required');
        if (!(typeof d.digest === 'string' && /^[0-9a-f]{64}$/.test(d.digest))) fail(`${at}.document.digest`, 'lower-case hex SHA-256 required');
        if (!(typeof d.media_type === 'string' && MEDIA_TYPE.test(d.media_type))) fail(`${at}.document.media_type`, 'lower-case type/subtype required');
        if (d.description !== null && !text(d.description, 200)) fail(`${at}.document.description`, 'bounded description or null required');
      }
      const key = canonicalize(e); if (seen.has(key)) fail(at, 'duplicate evidence'); seen.add(key);
    });
  }
  return issues;
}
/** The act's references and evidence refs, checked against the writing organization (checkRefOwner). */
export function checkActOwner(act: Act, organizationId: string, path = '$.act'): ActIssue[] {
  return [...act.references.flatMap((r, i) => checkRefOwner(r, `${path}.references[${i}]`, organizationId)),
    ...act.evidence.flatMap((e, i) => e.ref ? checkRefOwner(e.ref, `${path}.evidence[${i}].ref`, organizationId) : [])];
}
/** spec/profiles/classes.json, generated from OBJECT_CLASSES. */
export const classRegistry = () => ({
  format: CLASS_REGISTRY_FORMAT,
  description: 'Protocol object classes (decision V18). A class is <namespace>/<name>; the namespace dtp is reserved for the classes listed here, which are part of the object-v1 rules and change only by a reviewed pull request that changes both. Every other namespace is a publisher organization id, whose classes need no registration. Generated from OBJECT_CLASSES in sdk/src/profiles/act.ts by sdk/scripts/build-verb-datatypes.ts.',
  classes: [...OBJECT_CLASSES],
});
