// Builds spec/vectors/verb-datatypes.json and spec/profiles/classes.json from the reference rules in src/profiles/act.ts.
// Deterministic; `--check` compares.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkSchema, validateShape } from '../src/v04/profiles.ts';
import { ACT_SCHEMA, OBJECT_REF_SCHEMA, checkActOwner, checkRefOwner, classRegistry, isClassName, isProtocolClass, validateAct, validateObjectRef } from '../src/profiles/act.ts';
import type { Act, ObjectRef } from '../src/profiles/act.ts';

checkSchema(ACT_SCHEMA as unknown as Record<string, any>); checkSchema(OBJECT_REF_SCHEMA as unknown as Record<string, any>);
const clone = <V>(v: V): V => structuredClone(v);
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', OTHER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const ROOT = '11111111-1111-4111-8111-111111111111', REV = '12121212-1212-4212-8212-121212121212', DOC = 'a'.repeat(64);
const own: ObjectRef = { minted_by: null, root: ROOT, record_id: null };
const foreign: ObjectRef = { minted_by: OTHER, root: '33333333-3333-4333-8333-333333333333', record_id: REV };
const refAccept: [string, unknown][] = [
  ['the writer\'s own object, by entity', own],
  ['the writer\'s own object, at an exact revision', { ...own, record_id: REV }],
  ['another organization\'s object, at an exact revision', foreign],
];
const refReject: [string, unknown][] = [
  ['a root that is not a UUID', { ...own, root: 'pallet-14' }],
  ['a minting organization that is not an id', { ...own, minted_by: 'Carrier C' }],
  ['an upper-case root', { ...own, root: 'ABCDEF12-1111-4111-8111-111111111111' }],
  ['a missing record_id member', { minted_by: null, root: ROOT }],
  ['an extra member', { ...own, kind: 'pallet' }],
];
const act: Act = {
  verb: 'move', occurred_at: '2026-10-23T14:14:00.000Z', observation: { source_id: 'dock-scanner-2', sequence: 41 }, basis: 'measured',
  references: [{ minted_by: null, root: '44444444-4444-4444-8444-444444444444', record_id: null }],
  evidence: [{ ref: foreign, document: null }, { ref: null, document: { digest: DOC, media_type: 'image/jpeg', description: 'signed receipt' } }],
};
const change = (edit: (a: Act) => void): Act => { const a = clone(act); edit(a); return a; };
const actAccept: [string, unknown][] = [
  ['a measured move citing a claim, with a foreign record and a document as evidence', act],
  ['an inferred observation with nothing cited', change(a => { a.verb = 'observe'; a.basis = 'inferred'; a.references = []; a.evidence = []; })],
  ['an asserted transfer', change(a => { a.verb = 'transfer'; a.basis = 'asserted'; })],
];
const actReject: [string, unknown][] = [
  ['create is a revision of object@1, not an event verb', change(a => { (a as any).verb = 'create'; })],
  ['claim is a state kind, not an event verb', change(a => { (a as any).verb = 'claim'; })],
  ['a writer cannot assert that its own fact is verified', change(a => { (a as any).basis = 'verified'; })],
  ['business time that is not a UTC millisecond instant', change(a => { a.occurred_at = '2026-10-23'; })],
  ['a zero sequence', change(a => { a.observation.sequence = 0; })],
  ['an empty source', change(a => { a.observation.source_id = ''; })],
  ['the same reference twice', change(a => { a.references = [a.references[0], a.references[0]]; })],
  ['seventeen references', change(a => { a.references = Array.from({ length: 17 }, (_, i) => ({ minted_by: null, root: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`, record_id: null })); })],
  ['evidence with both a ref and a document', change(a => { a.evidence = [{ ref: own, document: { digest: DOC, media_type: 'image/jpeg', description: null } }]; })],
  ['evidence with neither', change(a => { a.evidence = [{ ref: null, document: null }]; })],
  ['a document digest that is not SHA-256 hex', change(a => { a.evidence[1].document!.digest = 'abc'; })],
  ['a media type that is not type/subtype', change(a => { a.evidence[1].document!.media_type = 'jpeg'; })],
  ['a reference that is not one', change(a => { (a.references[0] as any).root = 'H-E-B'; })],
  ['the recorded time as a body member: the host sets it', change(a => { (a as any).recorded_at = '2026-10-23T14:15:00.000Z'; })],
];
const ownership: { why: string; organization_id: string; act: Act; outcome: 'accept' | 'reject' }[] = [
  { why: 'own objects spelled with minted_by null, foreign ones with their minter', organization_id: ORG, act, outcome: 'accept' },
  { why: 'a reference naming the writer itself as minter', organization_id: ORG, act: change(a => { a.references[0].minted_by = ORG; }), outcome: 'reject' },
  { why: 'evidence naming the writer itself as minter', organization_id: OTHER, act, outcome: 'reject' },
];
const classes: [string, boolean][] = [
  ['dtp/location', true], ['dtp/account', true], [`${ORG}/gasket`, true], [`${ORG}/reefer-unit.v2`, true],
  ['dtp/pallet', false], ['dtp/Location', false], ['location', false], ['acme/gasket', false], [`${ORG}/`, false], ['dtp/location/bay', false],
];
const classOk = (c: string) => isClassName(c) && (!c.startsWith('dtp/') || isProtocolClass(c));
for (const [why, v] of refAccept) { if (!validateShape(OBJECT_REF_SCHEMA as any, v) || validateObjectRef(v, '$').length) throw new Error(`generator: refused ref "${why}"`); }
for (const [why, v] of refReject) if (validateObjectRef(v, '$').length === 0) throw new Error(`generator: accepted ref "${why}"`);
for (const [why, v] of actAccept) { const i = validateAct(v); if (!validateShape(ACT_SCHEMA as any, v) || i.length) throw new Error(`generator: refused act "${why}": ${i[0]?.message}`); }
for (const [why, v] of actReject) if (validateAct(v).length === 0) throw new Error(`generator: accepted act "${why}"`);
for (const o of ownership) if ((checkActOwner(o.act, o.organization_id).length === 0) !== (o.outcome === 'accept')) throw new Error(`generator: ownership "${o.why}"`);
for (const [c, ok] of classes) if (classOk(c) !== ok) throw new Error(`generator: class ${c}`);
if (checkRefOwner(own, '$', ORG).length) throw new Error('generator: own ref');
const vectors = {
  description: 'Verb-layer datatypes (spec/profiles/verbs.md). A conforming reader MUST accept every "refs.accept" object reference and refuse every "refs.reject"; accept every "acts.accept" act header and refuse every "acts.reject"; give the stated outcome for every "ownership" case, where the writing organization is organization_id and a reference to the writer\'s own object must leave minted_by null; and judge every "classes" name as stated against spec/profiles/classes.json.',
  refs: { accept: refAccept.map(([why, value]) => ({ why, value })), reject: refReject.map(([why, value]) => ({ why, value })) },
  acts: { accept: actAccept.map(([why, value]) => ({ why, value })), reject: actReject.map(([why, value]) => ({ why, value })) },
  ownership,
  classes: classes.map(([name, valid]) => ({ name, valid })),
};
for (const [target, text] of [[new URL('../../spec/vectors/verb-datatypes.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n'], [new URL('../../spec/profiles/classes.json', import.meta.url), JSON.stringify(classRegistry(), null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('verb datatypes:', refAccept.length + refReject.length, 'refs,', actAccept.length + actReject.length, 'acts,', ownership.length, 'ownership,', classes.length, 'classes');
