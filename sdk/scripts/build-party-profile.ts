// Builds spec/profiles/party/1/profile.json and fixtures.json from the reference rules. Deterministic; `--check` compares.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { PARTY_KIND, PARTY_PROFILE, PARTY_SCHEMA, PARTY_SEMANTICS, checkPartyContinuity, validateParty } from '../src/profiles/party.ts';
import type { PartyBody } from '../src/profiles/party.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'party', version: '1.0.0', schema: structuredClone(PARTY_SCHEMA) as Record<string, any>, semantics: PARTY_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const clone = <V>(v: V): V => structuredClone(v);
const ORG = '77777777-7777-4777-8777-777777777777', PARENT = '88888888-8888-4888-8888-888888888888';
const base: PartyBody = {
  kind: 'organization', names: [{ name: 'Bluebird Supply Co.', language: 'en' }],
  identifiers: [{ scheme: 'gs1.gln', value: '0614141000005' }, { scheme: 'duns', value: '123456789' }, { scheme: 'tax.us.ein', value: '12-3456789' }],
  protocol_identity: { organization_id: ORG }, roles: ['supplier', 'carrier'],
  locations: [{ location_id: 'hq', name: 'Head office', address: { lines: ['1 Harbor Way'], locality: 'Portland', region: 'OR', postal_code: '97201', country: 'US' }, gln: '0614141000012' }],
  parent: null, status: 'active',
};
const change = (edit: (b: PartyBody) => void): PartyBody => { const b = clone(base); edit(b); return b; };
type Case = [string, unknown];
const accept: Case[] = [
  ['a supplier organization with a GLN, a DUNS number, a tax id, a protocol identity claim and one location', base],
  ['the minimum: a name and nothing else', { kind: 'organization', names: [{ name: 'Unknown carrier', language: null }], identifiers: [], protocol_identity: null, roles: [], locations: [], parent: null, status: 'active' }],
  ['a person party: a contact known to the company, under a personnel policy at the host', change(b => { b.kind = 'person'; b.names = [{ name: 'A. Buyer', language: null }]; b.identifiers = []; b.protocol_identity = null; b.roles = ['customer']; b.locations = []; })],
  ['a unit of a parent party: a site', change(b => { b.kind = 'unit'; b.parent = PARENT; b.identifiers = []; b.protocol_identity = null; b.locations[0].gln = null; })],
  ['an inactive party with no protocol identity', change(b => { b.status = 'inactive'; b.protocol_identity = null; })],
];
const reject: Case[] = [
  ['an unknown kind', change(b => { (b as any).kind = 'company'; })],
  ['no names', change(b => { b.names = []; })],
  ['a GLN with a wrong check digit', change(b => { b.identifiers[0].value = '0614141000006'; })],
  ['a DUNS that is not nine digits', change(b => { b.identifiers[1].value = '12345678'; })],
  ['a duplicate identifier', change(b => { b.identifiers.push({ scheme: 'duns', value: '123456789' }); })],
  ['a protocol identity that is not an organization id', change(b => { b.protocol_identity = { organization_id: 'bluebird' }; })],
  ['a role outside the closed set', change(b => { (b as any).roles = ['owner']; })],
  ['a repeated role', change(b => { b.roles = ['supplier', 'supplier']; })],
  ['a location without a country', change(b => { (b.locations[0].address as any).country = ''; })],
  ['a country that is not alpha-2', change(b => { b.locations[0].address.country = 'USA'; })],
  ['five address lines', change(b => { b.locations[0].address.lines = ['a', 'b', 'c', 'd', 'e']; })],
  ['a location GLN with a wrong check digit', change(b => { b.locations[0].gln = '0614141000013'; })],
  ['two locations with one id', change(b => { b.locations.push(clone(b.locations[0])); })],
  ['a unit without a parent', change(b => { b.kind = 'unit'; })],
  ['an organization with a parent', change(b => { b.parent = PARENT; })],
  ['an unknown status', change(b => { (b as any).status = 'archived'; })],
  ['an extra member', change(b => { (b as any).email = 'x@example.invalid'; })],
  ['a missing member', (() => { const { roles: _, ...rest } = clone(base); return rest; })()],
];
type Continuity = [string, PartyBody, PartyBody];
const continuityAccept: Continuity[] = [
  ['a new name, role and location', base, change(b => { b.names.push({ name: 'Bluebird', language: null }); b.roles = ['supplier']; b.locations.push({ location_id: 'dc-2', name: null, address: { lines: [], locality: 'Reno', region: 'NV', postal_code: null, country: 'US' }, gln: null }); })],
  ['a protocol identity claimed for the first time', change(b => { b.protocol_identity = null; }), base],
  ['deactivation', base, change(b => { b.status = 'inactive'; })],
];
const continuityReject: Continuity[] = [
  ['a changed kind', base, change(b => { b.kind = 'person'; b.parent = null; })],
  ['a protocol identity switched to another organization', base, change(b => { b.protocol_identity = { organization_id: PARENT }; })],
  ['a protocol identity withdrawn', base, change(b => { b.protocol_identity = null; })],
  ['a changed parent', change(b => { b.kind = 'unit'; b.parent = PARENT; }), change(b => { b.kind = 'unit'; b.parent = ORG; })],
];
for (const [why, body] of accept) { if (!validateShape(contract.schema, body)) throw new Error(`generator: dialect refuses "${why}"`); const i = validateParty(body); if (i.length) throw new Error(`generator: refused "${why}": ${i[0].message} at ${i[0].path}`); }
for (const [why, body] of reject) if (validateParty(body).length === 0) throw new Error(`generator: accepted "${why}"`);
for (const [why, a, b] of continuityAccept) if (checkPartyContinuity(a, b).length) throw new Error(`generator: continuity refused "${why}"`);
for (const [why, a, b] of continuityReject) if (checkPartyContinuity(a, b).length === 0) throw new Error(`generator: continuity accepted "${why}"`);
const out = {
  description: 'dtp/party@1 fixtures. A conforming validator MUST accept every body under "accept" and refuse every body under "reject"; given a previous and a next revision of one party it MUST accept every pair under "continuity.accept" and refuse every pair under "continuity.reject". Refusal reasons are not normative. The contract is the exact profile whose digest the kind registry pins.',
  kind: PARTY_KIND, profile: PARTY_PROFILE, semantics: PARTY_SEMANTICS, contract_digest: await digest(contract),
  accept: accept.map(([why, body]) => ({ why, body })), reject: reject.map(([why, body]) => ({ why, body })),
  continuity: { accept: continuityAccept.map(([why, previous, next]) => ({ why, previous, next })), reject: continuityReject.map(([why, previous, next]) => ({ why, previous, next })) },
};
const dir = new URL('../../spec/profiles/party/1/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [target, text] of [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('party@1:', out.contract_digest, accept.length, 'accept,', reject.length, 'reject,', continuityAccept.length + continuityReject.length, 'continuity cases');
