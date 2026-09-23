// Deliberately separate implementation of dtp/party@1, written from spec/profiles/party/1.md and its fixtures.
// Do not import the SDK validator or canonicalizer here. Same author as the reference: separately coded agreement.
import { gtinValid, readerCanonical } from './product-reader.ts';

export type Issue = { path: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const ROLES = ['customer', 'supplier', 'carrier', 'financer', 'service_provider', 'manufacturer', 'broker', 'other'];

export function readParty(body: unknown): Issue[] {
  const out: Issue[] = [], bad = (path: string, message: string) => out.push({ path, message });
  if (!plain(body) || !keysAre(body, ['kind', 'names', 'identifiers', 'protocol_identity', 'roles', 'locations', 'parent', 'status'])) return [{ path: '$', message: 'exact fields' }];
  const b = body;
  if (!['organization', 'person', 'unit'].includes(b.kind)) bad('$.kind', 'kind');
  if (!Array.isArray(b.names) || b.names.length < 1 || b.names.length > 8) bad('$.names', 'names');
  else b.names.forEach((n: any, i: number) => {
    if (!plain(n) || !keysAre(n, ['name', 'language'])) return bad(`$.names[${i}]`, 'name');
    if (!bounded(n.name, 200)) bad(`$.names[${i}].name`, 'name');
    if (n.language !== null && !(typeof n.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(n.language))) bad(`$.names[${i}].language`, 'language');
  });
  if (!Array.isArray(b.identifiers) || b.identifiers.length > 32) bad('$.identifiers', 'identifiers');
  else {
    const seen = new Set<string>();
    b.identifiers.forEach((id: any, i: number) => {
      if (!plain(id) || !keysAre(id, ['scheme', 'value'])) return bad(`$.identifiers[${i}]`, 'identifier');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(id.scheme))) bad(`$.identifiers[${i}].scheme`, 'scheme');
      if (!bounded(id.value, 128)) bad(`$.identifiers[${i}].value`, 'value');
      const k = readerCanonical([id.scheme, id.value]); if (seen.has(k)) bad(`$.identifiers[${i}]`, 'duplicate'); seen.add(k);
      if (id.scheme === 'gs1.gln' && !(typeof id.value === 'string' && id.value.length === 13 && gtinValid(id.value))) bad(`$.identifiers[${i}].value`, 'gln');
      if (id.scheme === 'duns' && !/^[0-9]{9}$/.test(String(id.value))) bad(`$.identifiers[${i}].value`, 'duns');
    });
  }
  if (b.protocol_identity !== null && !(plain(b.protocol_identity) && keysAre(b.protocol_identity, ['organization_id']) && UUID.test(String(b.protocol_identity.organization_id)))) bad('$.protocol_identity', 'identity');
  if (!Array.isArray(b.roles) || b.roles.length > 8 || new Set(b.roles).size !== b.roles.length || !b.roles.every((r: unknown) => ROLES.includes(r as string))) bad('$.roles', 'roles');
  if (!Array.isArray(b.locations) || b.locations.length > 32) bad('$.locations', 'locations');
  else {
    const seen = new Set<string>();
    b.locations.forEach((l: any, i: number) => {
      if (!plain(l) || !keysAre(l, ['location_id', 'name', 'address', 'gln'])) return bad(`$.locations[${i}]`, 'location');
      if (!bounded(l.location_id, 120)) bad(`$.locations[${i}].location_id`, 'id');
      if (seen.has(l.location_id)) bad(`$.locations[${i}]`, 'duplicate'); seen.add(l.location_id);
      if (l.name !== null && !bounded(l.name, 200)) bad(`$.locations[${i}].name`, 'name');
      const a = l.address;
      if (!plain(a) || !keysAre(a, ['lines', 'locality', 'region', 'postal_code', 'country'])) bad(`$.locations[${i}].address`, 'address');
      else {
        if (!Array.isArray(a.lines) || a.lines.length > 4 || !a.lines.every((x: unknown) => bounded(x, 200))) bad(`$.locations[${i}].address.lines`, 'lines');
        if (!bounded(a.locality, 120)) bad(`$.locations[${i}].address.locality`, 'locality');
        if (a.region !== null && !bounded(a.region, 120)) bad(`$.locations[${i}].address.region`, 'region');
        if (a.postal_code !== null && !bounded(a.postal_code, 32)) bad(`$.locations[${i}].address.postal_code`, 'postal');
        if (!(typeof a.country === 'string' && /^[A-Z]{2}$/.test(a.country))) bad(`$.locations[${i}].address.country`, 'country');
      }
      if (l.gln !== null && !(typeof l.gln === 'string' && l.gln.length === 13 && gtinValid(l.gln))) bad(`$.locations[${i}].gln`, 'gln');
    });
  }
  if (b.parent !== null && !(typeof b.parent === 'string' && UUID.test(b.parent))) bad('$.parent', 'parent');
  if (b.kind === 'unit' && b.parent === null) bad('$.parent', 'unit needs parent');
  if (b.kind !== 'unit' && b.parent !== null) bad('$.parent', 'only units have parents');
  if (!['active', 'inactive'].includes(b.status)) bad('$.status', 'status');
  return out;
}
export function readPartyContinuity(previous: any, next: any): Issue[] {
  const out: Issue[] = [];
  if (previous.kind !== next.kind) out.push({ path: '$.kind', message: 'immutable' });
  if (previous.protocol_identity !== null && readerCanonical(previous.protocol_identity) !== readerCanonical(next.protocol_identity)) out.push({ path: '$.protocol_identity', message: 'immutable once claimed' });
  if (previous.parent !== next.parent) out.push({ path: '$.parent', message: 'immutable' });
  return out;
}
