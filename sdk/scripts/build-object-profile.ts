// Builds spec/profiles/object/1/profile.json and fixtures.json from the reference rules. Deterministic; `--check` compares.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { OBJECT_KIND, OBJECT_PROFILE, OBJECT_SCHEMA, OBJECT_SEMANTICS, checkObjectContinuity, checkObjectGenesis, validateObject } from '../src/profiles/object.ts';
import type { ObjectBody } from '../src/profiles/object.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'object', version: '1.0.0', schema: structuredClone(OBJECT_SCHEMA) as Record<string, any>, semantics: OBJECT_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const clone = <V>(v: V): V => structuredClone(v);
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', OTHER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const SIGHTING = { minted_by: OTHER, root: '66666666-6666-4666-8666-666666666666', record_id: '67676767-6767-4767-8767-676767676767' };
const trailer: ObjectBody = { class: 'dtp/vehicle', label: 'Reefer trailer 14', identifiers: [{ scheme: 'vin', value: '1JJV532D4KL123456' }], status: 'active', retired: null, evidence: [] };
const pallet: ObjectBody = { class: 'dtp/handling-unit', label: null, identifiers: [{ scheme: 'gs1.sscc', value: '106141411234567897' }], status: 'active', retired: null, evidence: [] };
const change = (edit: (b: ObjectBody) => void, from: ObjectBody = trailer): ObjectBody => { const b = clone(from); edit(b); return b; };
const lost = change(b => { b.status = 'lost' as any; }, pallet);
const retiredLost = change(b => { b.status = 'retired'; b.retired = { reason: 'lost', note: 'not received at the DC' }; }, pallet);
type Case = [string, unknown];
const accept: Case[] = [
  ['a vehicle with a VIN', trailer],
  ['a handling unit identified by a check-digit-valid SSCC', pallet],
  ['a private class with no identifiers and no label', { class: `${ORG}/gasket`, label: null, identifiers: [], status: 'active', retired: null, evidence: [] }],
  ['a location with a GLN', { class: 'dtp/location', label: 'Cross-dock, bay 3', identifiers: [{ scheme: 'gs1.gln', value: '0614141000005' }], status: 'active', retired: null, evidence: [] }],
  ['a retired pallet, lost, with a note', retiredLost],
  ['a retired machine, other reason with a note, citing a foreign record', change(b => { b.class = 'dtp/equipment'; b.status = 'retired'; b.retired = { reason: 'other', note: 'sold for parts' }; b.evidence = [SIGHTING]; })],
];
const reject: Case[] = [
  ['a protocol class that is not listed', change(b => { b.class = 'dtp/pallet'; })],
  ['a class without a namespace', change(b => { b.class = 'vehicle'; })],
  ['a class whose namespace is neither dtp nor an organization id', change(b => { b.class = 'acme/vehicle'; })],
  ['an SSCC with a wrong check digit', change(b => { b.identifiers = [{ scheme: 'gs1.sscc', value: '106141411234567890' }]; }, pallet)],
  ['a GLN with a wrong check digit', change(b => { b.identifiers = [{ scheme: 'gs1.gln', value: '0614141000006' }]; })],
  ['the same identifier twice', change(b => { b.identifiers = [b.identifiers[0], b.identifiers[0]]; })],
  ['an active object with a retirement', change(b => { b.retired = { reason: 'scrapped', note: null }; })],
  ['a retired object without a reason', change(b => { b.status = 'retired'; })],
  ['a sale is not a retirement', change(b => { b.status = 'retired'; b.retired = { reason: 'sold' as any, note: null }; })],
  ['reason other without a note', change(b => { b.status = 'retired'; b.retired = { reason: 'other', note: null }; })],
  ['an unknown status', lost],
  ['evidence that is not an object reference', change(b => { b.evidence = [{ minted_by: null, root: 'scan-14', record_id: null }]; })],
  ['the same evidence twice', change(b => { b.evidence = [SIGHTING, SIGHTING]; })],
  ['a member a component would carry: describing is a revision, not a subject', change(b => { (b as any).subject = SIGHTING; })],
  ['a missing member', (() => { const { label: _, ...rest } = clone(trailer); return rest; })()],
];
const genesisAccept: Case[] = [['created active', trailer]];
const genesisReject: Case[] = [['created already retired: retire it by a revision', retiredLost]];
type Pair = [string, ObjectBody, ObjectBody];
const found = change(b => { b.status = 'active'; b.retired = null; b.evidence = [SIGHTING]; }, retiredLost);
const continuityAccept: Pair[] = [
  ['retire: lost', pallet, retiredLost],
  ['found: active again, citing the sighting', retiredLost, found],
  ['relabel and add an identifier while active', trailer, change(b => { b.label = 'Reefer trailer 14 (leased)'; b.identifiers.push({ scheme: 'plate.us.tx', value: 'R14-882' }); })],
  ['retire with a different reason later in life', found, change(b => { b.status = 'retired'; b.retired = { reason: 'scrapped', note: null }; }, found)],
];
const continuityReject: Pair[] = [
  ['a changed class: a different object', trailer, change(b => { b.class = 'dtp/equipment'; })],
  ['a removed identifier', trailer, change(b => { b.identifiers = []; })],
  ['a retired object edited without being found', retiredLost, change(b => { b.retired = { reason: 'scrapped', note: null }; }, retiredLost)],
  ['found without new evidence', retiredLost, change(b => { b.status = 'active'; b.retired = null; }, retiredLost)],
  ['found and renamed in one revision', retiredLost, change(b => { b.label = 'Pallet 7'; }, found)],
];
for (const [why, body] of accept) { if (!validateShape(contract.schema, body)) throw new Error(`generator: dialect refuses "${why}"`); const i = validateObject(body); if (i.length) throw new Error(`generator: refused "${why}": ${i[0].message} at ${i[0].path}`); }
for (const [why, body] of reject) if (validateObject(body).length === 0) throw new Error(`generator: accepted "${why}"`);
for (const [why, body] of genesisAccept) if (checkObjectGenesis(body as ObjectBody).length) throw new Error(`generator: genesis refused "${why}"`);
for (const [why, body] of genesisReject) if (checkObjectGenesis(body as ObjectBody).length === 0) throw new Error(`generator: genesis accepted "${why}"`);
for (const [why, a, b] of continuityAccept) { if (validateObject(b).length) throw new Error(`generator: continuity next invalid "${why}"`); const i = checkObjectContinuity(a, b); if (i.length) throw new Error(`generator: continuity refused "${why}": ${i[0].message}`); }
for (const [why, a, b] of continuityReject) { if (validateObject(b).length) throw new Error(`generator: continuity next invalid "${why}"`); if (checkObjectContinuity(a, b).length === 0) throw new Error(`generator: continuity accepted "${why}"`); }
const out = {
  description: 'dtp/object@1 fixtures. A conforming validator MUST accept every body under "accept" and refuse every body under "reject" (protocol classes judged against spec/profiles/classes.json); it MUST accept a genesis only when "genesis.accept" says so; given a previous and a next revision of one object it MUST accept every pair under "continuity.accept" and refuse every pair under "continuity.reject". A retired object is never deleted; it changes only by being found.',
  kind: OBJECT_KIND, profile: OBJECT_PROFILE, semantics: OBJECT_SEMANTICS, contract_digest: await digest(contract),
  accept: accept.map(([why, body]) => ({ why, body })), reject: reject.map(([why, body]) => ({ why, body })),
  genesis: { accept: genesisAccept.map(([why, body]) => ({ why, body })), reject: genesisReject.map(([why, body]) => ({ why, body })) },
  continuity: { accept: continuityAccept.map(([why, previous, next]) => ({ why, previous, next })), reject: continuityReject.map(([why, previous, next]) => ({ why, previous, next })) },
};
const dir = new URL('../../spec/profiles/object/1/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [target, text] of [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('object@1:', out.contract_digest, accept.length, 'accept,', reject.length, 'reject,', continuityAccept.length + continuityReject.length, 'continuity cases');
