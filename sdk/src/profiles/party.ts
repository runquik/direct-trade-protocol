/** dtp/party@1: a counterparty as one company knows it. Portable, dependency-free, synchronous.
 * Profile document and fixtures: spec/profiles/party/1.md, spec/profiles/party/1/. */
import { canonicalize } from '../canonical.ts';
import { isGtin } from './product.ts';

export const PARTY_PROFILE = 'dtp.party/1';
export const PARTY_KIND = 'dtp/party@1';
export const PARTY_SEMANTICS = 'party-v1';
export const PARTY_KINDS = ['organization', 'person', 'unit'] as const;
/** Descriptive only. No module may derive authority from a role (SPEC.md §2.2 says the same of business_types). */
export const PARTY_ROLES = ['customer', 'supplier', 'carrier', 'financer', 'service_provider', 'manufacturer', 'broker', 'other'] as const;
export const GLN_SCHEME = 'gs1.gln', DUNS_SCHEME = 'duns';
export type PartyName = { name: string; language: string | null };
export type PartyIdentifier = { scheme: string; value: string };
export type PartyAddress = { lines: string[]; locality: string; region: string | null; postal_code: string | null; country: string };
export type PartyLocation = { location_id: string; name: string | null; address: PartyAddress; gln: string | null };
export type PartyBody = {
  kind: typeof PARTY_KINDS[number]; names: PartyName[]; identifiers: PartyIdentifier[];
  protocol_identity: { organization_id: string } | null; roles: typeof PARTY_ROLES[number][];
  locations: PartyLocation[]; parent: string | null; status: 'active' | 'inactive';
};
export type PartyIssue = { path: string; message: string };
export const PARTY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind', 'names', 'identifiers', 'protocol_identity', 'roles', 'locations', 'parent', 'status'],
  properties: {
    kind: { type: 'string', maxLength: 12, enum: [...PARTY_KINDS] },
    names: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['name', 'language'], properties: { name: { type: 'string', maxLength: 200 }, language: { type: 'string', maxLength: 35, nullable: true } } } },
    identifiers: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['scheme', 'value'], properties: { scheme: { type: 'string', maxLength: 64 }, value: { type: 'string', maxLength: 128 } } } },
    protocol_identity: { type: 'object', additionalProperties: false, required: ['organization_id'], properties: { organization_id: { type: 'string', maxLength: 36 } }, nullable: true },
    roles: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 16, enum: [...PARTY_ROLES] } },
    locations: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['location_id', 'name', 'address', 'gln'], properties: {
      location_id: { type: 'string', maxLength: 120 }, name: { type: 'string', maxLength: 200, nullable: true },
      address: { type: 'object', additionalProperties: false, required: ['lines', 'locality', 'region', 'postal_code', 'country'], properties: { lines: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 200 } }, locality: { type: 'string', maxLength: 120 }, region: { type: 'string', maxLength: 120, nullable: true }, postal_code: { type: 'string', maxLength: 32, nullable: true }, country: { type: 'string', maxLength: 2 } } },
      gln: { type: 'string', maxLength: 13, nullable: true } } } },
    parent: { type: 'string', maxLength: 36, nullable: true },
    status: { type: 'string', maxLength: 8, enum: ['active', 'inactive'] },
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCHEME = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/, LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, COUNTRY = /^[A-Z]{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const isGln = (v: unknown): boolean => typeof v === 'string' && v.length === 13 && isGtin(v);
export const isDuns = (v: unknown): boolean => typeof v === 'string' && /^[0-9]{9}$/.test(v);

/** Every rule of the profile beyond shape. Returns an empty list for a conforming party body. */
export function validateParty(body: unknown): PartyIssue[] {
  const issues: PartyIssue[] = [], fail = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(body) || !exact(body, [...PARTY_SCHEMA.required])) return [{ path: '$', message: 'exact party fields required' }];
  const b = body as unknown as PartyBody;
  if (!(PARTY_KINDS as readonly string[]).includes(b.kind)) fail('$.kind', 'organization, person or unit required');
  if (!Array.isArray(b.names) || b.names.length < 1 || b.names.length > 8) fail('$.names', '1-8 names required');
  else b.names.forEach((n, i) => {
    if (!isObject(n) || !exact(n, ['name', 'language'])) return fail(`$.names[${i}]`, 'name and language required');
    if (!text(n.name, 200)) fail(`$.names[${i}].name`, 'bounded nonempty name required');
    if (n.language !== null && !(typeof n.language === 'string' && LANGUAGE.test(n.language))) fail(`$.names[${i}].language`, 'language tag or null required');
  });
  if (!Array.isArray(b.identifiers) || b.identifiers.length > 32) fail('$.identifiers', 'at most 32 identifiers');
  else {
    const seen = new Set<string>();
    b.identifiers.forEach((id, i) => {
      if (!isObject(id) || !exact(id, ['scheme', 'value'])) return fail(`$.identifiers[${i}]`, 'scheme and value required');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && SCHEME.test(id.scheme))) fail(`$.identifiers[${i}].scheme`, 'namespaced identifier scheme required');
      if (!text(id.value, 128)) fail(`$.identifiers[${i}].value`, 'bounded nonempty value required');
      const key = canonicalize([id.scheme, id.value]); if (seen.has(key)) fail(`$.identifiers[${i}]`, 'duplicate identifier'); seen.add(key);
      if (id.scheme === GLN_SCHEME && !isGln(id.value)) fail(`$.identifiers[${i}].value`, 'GLN check digit or length invalid');
      if (id.scheme === DUNS_SCHEME && !isDuns(id.value)) fail(`$.identifiers[${i}].value`, 'nine-digit DUNS required');
    });
  }
  if (b.protocol_identity !== null && !(isObject(b.protocol_identity) && exact(b.protocol_identity, ['organization_id']) && UUID.test(String(b.protocol_identity.organization_id)))) fail('$.protocol_identity', 'organization id or null required');
  if (!Array.isArray(b.roles) || b.roles.length > 8 || new Set(b.roles).size !== b.roles.length || !b.roles.every(r => (PARTY_ROLES as readonly string[]).includes(r))) fail('$.roles', 'distinct roles from the closed set required');
  if (!Array.isArray(b.locations) || b.locations.length > 32) fail('$.locations', 'at most 32 locations');
  else {
    const seen = new Set<string>();
    b.locations.forEach((l, i) => {
      if (!isObject(l) || !exact(l, ['location_id', 'name', 'address', 'gln'])) return fail(`$.locations[${i}]`, 'exact location fields required');
      if (!text(l.location_id, 120)) fail(`$.locations[${i}].location_id`, 'bounded location id required');
      if (seen.has(l.location_id)) fail(`$.locations[${i}]`, 'duplicate location id'); seen.add(l.location_id);
      if (l.name !== null && !text(l.name, 200)) fail(`$.locations[${i}].name`, 'bounded name or null required');
      const a = l.address;
      if (!isObject(a) || !exact(a, ['lines', 'locality', 'region', 'postal_code', 'country'])) fail(`$.locations[${i}].address`, 'exact address fields required');
      else {
        if (!Array.isArray(a.lines) || a.lines.length > 4 || !a.lines.every(x => text(x, 200))) fail(`$.locations[${i}].address.lines`, 'up to four bounded lines required');
        if (!text(a.locality, 120)) fail(`$.locations[${i}].address.locality`, 'locality required');
        if (a.region !== null && !text(a.region, 120)) fail(`$.locations[${i}].address.region`, 'bounded region or null required');
        if (a.postal_code !== null && !text(a.postal_code, 32)) fail(`$.locations[${i}].address.postal_code`, 'bounded postal code or null required');
        if (!(typeof a.country === 'string' && COUNTRY.test(a.country))) fail(`$.locations[${i}].address.country`, 'ISO 3166-1 alpha-2 country required');
      }
      if (l.gln !== null && !isGln(l.gln)) fail(`$.locations[${i}].gln`, 'GLN or null required');
    });
  }
  if (b.parent !== null && !(typeof b.parent === 'string' && UUID.test(b.parent))) fail('$.parent', 'parent party root or null required');
  if (b.kind === 'unit' && b.parent === null) fail('$.parent', 'a unit names its parent party');
  if (b.kind !== 'unit' && b.parent !== null) fail('$.parent', 'only a unit has a parent');
  if (!['active', 'inactive'].includes(b.status)) fail('$.status', 'active or inactive required');
  return issues;
}
/** Across a supersession: what the party is, who it claims to be in the protocol and whom it belongs to never change.
 *  A party that turns out to be someone else is a new party. Both bodies are assumed valid. */
export function checkPartyContinuity(previous: PartyBody, next: PartyBody): PartyIssue[] {
  const issues: PartyIssue[] = [];
  if (previous.kind !== next.kind) issues.push({ path: '$.kind', message: 'kind is immutable; a different kind of party is a new party' });
  if (previous.protocol_identity !== null && canonicalize(previous.protocol_identity) !== canonicalize(next.protocol_identity)) issues.push({ path: '$.protocol_identity', message: 'a protocol identity claim, once made, cannot be changed or withdrawn; a different identity is a new party' });
  if (previous.parent !== next.parent) issues.push({ path: '$.parent', message: 'the parent party is immutable' });
  return issues;
}
