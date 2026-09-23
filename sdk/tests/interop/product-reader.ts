// Deliberately separate implementation of dtp/product@1, written from spec/profiles/product/1.md and its fixtures.
// Do not import the SDK validator, decimal helpers or canonicalizer here. Same author as the reference: this is
// separately coded consumer agreement, not independent authorship.
import { createHash } from 'node:crypto';

export type Issue = { path: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);

/** Canonical JSON for this reader: sorted member names, ECMAScript string escaping, safe integers only. */
export function readerCanonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('float'); return String(value); }
  if (Array.isArray(value)) return '[' + value.map(readerCanonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + readerCanonical(value[k])).join(',') + '}';
  throw new Error('unsupported');
}
export const readerDigest = (value: unknown) => createHash('sha256').update(readerCanonical(value), 'utf8').digest('hex');

/** GS1 check digit, computed the GS1 way: multiply alternately by 3 and 1 starting from the right-most payload digit. */
export function gtinValid(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false;
  let sum = 0, weight = 3;
  for (let i = value.length - 2; i >= 0; i--) { sum += Number(value[i]) * weight; weight = weight === 3 ? 1 : 3; }
  return (10 - (sum % 10)) % 10 === Number(value[value.length - 1]);
}
/** A positive decimal with at most three places, as a count of thousandths. */
function thousandths(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d{1,18}(\.\d{1,3})?$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole) * 1000n + BigInt(frac.padEnd(3, '0'));
}
export function readProduct(body: unknown): Issue[] {
  const out: Issue[] = [], bad = (path: string, message: string) => out.push({ path, message });
  const fields = ['names', 'description', 'brand', 'category', 'identifiers', 'base_unit', 'packaging', 'tracking', 'shelf_life_days', 'replaces', 'status'];
  if (!plain(body) || !keysAre(body, fields)) return [{ path: '$', message: 'exact fields' }];
  const b: any = body;
  if (!Array.isArray(b.names) || b.names.length < 1 || b.names.length > 8) bad('$.names', 'names');
  else b.names.forEach((n: any, i: number) => {
    if (!plain(n) || !keysAre(n, ['name', 'language'])) return bad(`$.names[${i}]`, 'name');
    if (!bounded(n.name, 200)) bad(`$.names[${i}].name`, 'name');
    if (n.language !== null && !(typeof n.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(n.language))) bad(`$.names[${i}].language`, 'language');
  });
  if (b.description !== null && !bounded(b.description, 4000)) bad('$.description', 'text');
  if (b.brand !== null && !bounded(b.brand, 200)) bad('$.brand', 'text');
  if (b.category !== null && !bounded(b.category, 200)) bad('$.category', 'text');
  if (!Array.isArray(b.identifiers) || b.identifiers.length > 32) bad('$.identifiers', 'identifiers');
  else {
    const seen = new Set<string>(); let skus = 0;
    b.identifiers.forEach((id: any, i: number) => {
      if (!plain(id) || !keysAre(id, ['scheme', 'value'])) return bad(`$.identifiers[${i}]`, 'identifier');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(id.scheme))) bad(`$.identifiers[${i}].scheme`, 'scheme');
      if (!bounded(id.value, 128)) bad(`$.identifiers[${i}].value`, 'value');
      const k = id.scheme + '\u0000' + id.value; if (seen.has(k)) bad(`$.identifiers[${i}]`, 'duplicate'); seen.add(k);
      if (id.scheme === 'gs1.gtin' && !gtinValid(id.value)) bad(`$.identifiers[${i}].value`, 'gtin');
      if (id.scheme === 'sku' && ++skus > 1) bad(`$.identifiers[${i}]`, 'sku');
    });
  }
  if (!plain(b.base_unit) || !keysAre(b.base_unit, ['system', 'code']) || b.base_unit.system !== 'ucum' || !(typeof b.base_unit.code === 'string' && /^[!-~]{1,32}$/.test(b.base_unit.code))) bad('$.base_unit', 'unit');
  if (!Array.isArray(b.packaging) || b.packaging.length > 32) bad('$.packaging', 'packaging');
  else {
    const seen = new Set<string>();
    b.packaging.forEach((p: any, i: number) => {
      if (!plain(p) || !keysAre(p, ['packaging_id', 'version', 'name', 'base_units_per_pack', 'gtin'])) return bad(`$.packaging[${i}]`, 'packaging');
      if (!bounded(p.packaging_id, 80) || !bounded(p.version, 40) || !bounded(p.name, 120)) bad(`$.packaging[${i}]`, 'packaging text');
      const k = p.packaging_id + '\u0000' + p.version; if (seen.has(k)) bad(`$.packaging[${i}]`, 'duplicate'); seen.add(k);
      const per = thousandths(p.base_units_per_pack); if (per === null || per <= 0n) bad(`$.packaging[${i}].base_units_per_pack`, 'conversion');
      if (p.gtin !== null && !gtinValid(p.gtin)) bad(`$.packaging[${i}].gtin`, 'gtin');
    });
  }
  if (!['none', 'lot', 'serial'].includes(b.tracking)) bad('$.tracking', 'tracking');
  if (b.shelf_life_days !== null && !(Number.isSafeInteger(b.shelf_life_days) && b.shelf_life_days >= 1 && b.shelf_life_days <= 36500)) bad('$.shelf_life_days', 'shelf life');
  if (b.replaces !== null && !(typeof b.replaces === 'string' && UUID.test(b.replaces))) bad('$.replaces', 'replaces');
  if (!['active', 'discontinued'].includes(b.status)) bad('$.status', 'status');
  return out;
}
export function readContinuity(previous: any, next: any): Issue[] {
  const out: Issue[] = [];
  if (readerCanonical(previous.base_unit) !== readerCanonical(next.base_unit)) out.push({ path: '$.base_unit', message: 'immutable' });
  if (previous.tracking !== next.tracking) out.push({ path: '$.tracking', message: 'immutable' });
  if (previous.replaces !== next.replaces) out.push({ path: '$.replaces', message: 'immutable' });
  for (const [i, p] of (previous.packaging as any[]).entries()) {
    const later = (next.packaging as any[]).find(x => x.packaging_id === p.packaging_id && x.version === p.version);
    if (!later) out.push({ path: `$.packaging[${i}]`, message: 'removed' });
    else if (later.name !== p.name || later.base_units_per_pack !== p.base_units_per_pack || later.gtin !== p.gtin) out.push({ path: `$.packaging[${i}]`, message: 'altered' });
  }
  return out;
}
