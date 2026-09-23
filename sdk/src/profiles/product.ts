/** dtp/product@1: a product as one company defines it. Portable, dependency-free, synchronous, so the same rules
 * run inside a host transaction on any runtime. The reducer of dtp/inventory@2 keys its ledgers by this entity.
 * Profile document and fixtures: spec/profiles/product/1.md, spec/profiles/product/1/. */
import { canonicalize } from '../canonical.ts';
import { parseDecimal } from './decimal.ts';

export const PRODUCT_PROFILE = 'dtp.product/1';
export const PRODUCT_KIND = 'dtp/product@1';
export const PRODUCT_SEMANTICS = 'product-v1';
export const MAX_PRODUCT_NAMES = 8, MAX_PRODUCT_IDENTIFIERS = 32, MAX_PRODUCT_PACKAGING = 32, MAX_SHELF_LIFE_DAYS = 36_500;
/** Identifier schemes the profile interprets. Any other scheme is opaque, namespaced by the writer's choice. */
export const GTIN_SCHEME = 'gs1.gtin', SKU_SCHEME = 'sku';
export type UnitReference = { system: 'ucum'; code: string };
export type ProductName = { name: string; language: string | null };
export type ProductIdentifier = { scheme: string; value: string };
export type ProductPackaging = { packaging_id: string; version: string; name: string; base_units_per_pack: string; gtin: string | null };
export type ProductBody = {
  names: ProductName[]; description: string | null; brand: string | null; category: string | null;
  identifiers: ProductIdentifier[]; base_unit: UnitReference; packaging: ProductPackaging[];
  tracking: 'none' | 'lot' | 'serial'; shelf_life_days: number | null; replaces: string | null; status: 'active' | 'discontinued';
};
export type ProductIssue = { path: string; message: string };
/** The payload schema in the bounded dtp.schema/1 dialect (with `nullable`). Patterns the dialect cannot express are
 *  enforced by validateProduct; a publisher's schema may never be looser than this one in effect. */
export const PRODUCT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['names', 'description', 'brand', 'category', 'identifiers', 'base_unit', 'packaging', 'tracking', 'shelf_life_days', 'replaces', 'status'],
  properties: {
    names: { type: 'array', maxItems: MAX_PRODUCT_NAMES, items: { type: 'object', additionalProperties: false, required: ['name', 'language'], properties: { name: { type: 'string', maxLength: 200 }, language: { type: 'string', maxLength: 35, nullable: true } } } },
    description: { type: 'string', maxLength: 4000, nullable: true }, brand: { type: 'string', maxLength: 200, nullable: true }, category: { type: 'string', maxLength: 200, nullable: true },
    identifiers: { type: 'array', maxItems: MAX_PRODUCT_IDENTIFIERS, items: { type: 'object', additionalProperties: false, required: ['scheme', 'value'], properties: { scheme: { type: 'string', maxLength: 64 }, value: { type: 'string', maxLength: 128 } } } },
    base_unit: { type: 'object', additionalProperties: false, required: ['system', 'code'], properties: { system: { type: 'string', maxLength: 4, enum: ['ucum'] }, code: { type: 'string', maxLength: 32 } } },
    packaging: { type: 'array', maxItems: MAX_PRODUCT_PACKAGING, items: { type: 'object', additionalProperties: false, required: ['packaging_id', 'version', 'name', 'base_units_per_pack', 'gtin'],
      properties: { packaging_id: { type: 'string', maxLength: 80 }, version: { type: 'string', maxLength: 40 }, name: { type: 'string', maxLength: 120 }, base_units_per_pack: { type: 'string', maxLength: 24 }, gtin: { type: 'string', maxLength: 14, nullable: true } } } },
    tracking: { type: 'string', maxLength: 6, enum: ['none', 'lot', 'serial'] },
    shelf_life_days: { type: 'integer', minimum: 1, maximum: MAX_SHELF_LIFE_DAYS, nullable: true },
    replaces: { type: 'string', maxLength: 36, nullable: true },
    status: { type: 'string', maxLength: 12, enum: ['active', 'discontinued'] },
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCHEME = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** UCUM code syntax only: printable ASCII without space, so `kg`, `[lb_av]`, `{case}` and `mL` pass and nothing is converted. */
const UCUM = /^[!-~]{1,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
/** GS1 check digit: weights 3,1,3,... from the right over the payload digits. GTIN-8, -12, -13 and -14 are accepted. */
export function isGtin(value: unknown): boolean {
  if (typeof value !== 'string' || ![8, 12, 13, 14].includes(value.length) || !/^[0-9]+$/.test(value)) return false;
  const digits = value.split('').map(Number), check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
/** Every rule of the profile beyond shape. Returns an empty list for a conforming product body. */
export function validateProduct(body: unknown): ProductIssue[] {
  const issues: ProductIssue[] = [], fail = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(body) || !exact(body, [...PRODUCT_SCHEMA.required])) return [{ path: '$', message: 'exact product fields required' }];
  const b = body as unknown as ProductBody;
  if (!Array.isArray(b.names) || b.names.length < 1 || b.names.length > MAX_PRODUCT_NAMES) fail('$.names', `1-${MAX_PRODUCT_NAMES} names required`);
  else b.names.forEach((n, i) => {
    if (!isObject(n) || !exact(n, ['name', 'language'])) return fail(`$.names[${i}]`, 'name and language required');
    if (!text(n.name, 200)) fail(`$.names[${i}].name`, 'bounded nonempty name required');
    if (n.language !== null && !(typeof n.language === 'string' && LANGUAGE.test(n.language))) fail(`$.names[${i}].language`, 'language tag or null required');
  });
  for (const [key, max] of [['description', 4000], ['brand', 200], ['category', 200]] as const) { const v = (b as any)[key]; if (v !== null && !text(v, max)) fail(`$.${key}`, 'bounded nonempty text or null required'); }
  if (!Array.isArray(b.identifiers) || b.identifiers.length > MAX_PRODUCT_IDENTIFIERS) fail('$.identifiers', `at most ${MAX_PRODUCT_IDENTIFIERS} identifiers`);
  else {
    const seen = new Set<string>(); let skus = 0;
    b.identifiers.forEach((id, i) => {
      if (!isObject(id) || !exact(id, ['scheme', 'value'])) return fail(`$.identifiers[${i}]`, 'scheme and value required');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && SCHEME.test(id.scheme))) fail(`$.identifiers[${i}].scheme`, 'namespaced identifier scheme required');
      if (!text(id.value, 128)) fail(`$.identifiers[${i}].value`, 'bounded nonempty value required');
      const key = JSON.stringify([id.scheme, id.value]); if (seen.has(key)) fail(`$.identifiers[${i}]`, 'duplicate identifier'); seen.add(key);
      if (id.scheme === GTIN_SCHEME && !isGtin(id.value)) fail(`$.identifiers[${i}].value`, 'GTIN check digit or length invalid');
      if (id.scheme === SKU_SCHEME && ++skus > 1) fail(`$.identifiers[${i}]`, 'at most one sku: the company\'s own');
    });
  }
  if (!isObject(b.base_unit) || !exact(b.base_unit, ['system', 'code']) || b.base_unit.system !== 'ucum' || !(typeof b.base_unit.code === 'string' && UCUM.test(b.base_unit.code))) fail('$.base_unit', 'UCUM base unit required');
  if (!Array.isArray(b.packaging) || b.packaging.length > MAX_PRODUCT_PACKAGING) fail('$.packaging', `at most ${MAX_PRODUCT_PACKAGING} packaging revisions`);
  else {
    const seen = new Set<string>();
    b.packaging.forEach((p, i) => {
      if (!isObject(p) || !exact(p, ['packaging_id', 'version', 'name', 'base_units_per_pack', 'gtin'])) return fail(`$.packaging[${i}]`, 'exact packaging fields required');
      if (!text(p.packaging_id, 80) || !text(p.version, 40) || !text(p.name, 120)) fail(`$.packaging[${i}]`, 'bounded packaging id, version and name required');
      const key = JSON.stringify([p.packaging_id, p.version]); if (seen.has(key)) fail(`$.packaging[${i}]`, 'duplicate packaging version'); seen.add(key);
      try { if (parseDecimal(p.base_units_per_pack, 3) <= 0n) fail(`$.packaging[${i}].base_units_per_pack`, 'positive pack conversion required'); } catch { fail(`$.packaging[${i}].base_units_per_pack`, 'three-place decimal required'); }
      if (p.gtin !== null && !isGtin(p.gtin)) fail(`$.packaging[${i}].gtin`, 'GTIN or null required');
    });
  }
  if (!['none', 'lot', 'serial'].includes(b.tracking)) fail('$.tracking', 'none, lot or serial required');
  if (b.shelf_life_days !== null && !(Number.isSafeInteger(b.shelf_life_days) && b.shelf_life_days >= 1 && b.shelf_life_days <= MAX_SHELF_LIFE_DAYS)) fail('$.shelf_life_days', 'positive day count or null required');
  if (b.replaces !== null && !(typeof b.replaces === 'string' && UUID.test(b.replaces))) fail('$.replaces', 'replaced product root or null required');
  if (!['active', 'discontinued'].includes(b.status)) fail('$.status', 'active or discontinued required');
  return issues;
}
/** Rules across a supersession: the inventory ledger keys on base_unit and tracking, so neither may change (a change
 *  is a new product with `replaces`); a packaging version, once published, is immutable and never removed, since a
 *  pack conversion pinned by an earlier stock event must stay reproducible. Both bodies are assumed valid. */
export function checkProductContinuity(previous: ProductBody, next: ProductBody): ProductIssue[] {
  const issues: ProductIssue[] = [];
  // Canonical comparison: a stored body may come back with its members reordered.
  if (canonicalize(previous.base_unit) !== canonicalize(next.base_unit)) issues.push({ path: '$.base_unit', message: 'base unit is immutable; a change is a new product' });
  if (previous.tracking !== next.tracking) issues.push({ path: '$.tracking', message: 'tracking is immutable; a change is a new product' });
  if (previous.replaces !== next.replaces) issues.push({ path: '$.replaces', message: 'the replaced product is immutable' });
  const later = new Map(next.packaging.map(p => [JSON.stringify([p.packaging_id, p.version]), p]));
  previous.packaging.forEach((p, i) => {
    const same = later.get(JSON.stringify([p.packaging_id, p.version]));
    if (!same) issues.push({ path: `$.packaging[${i}]`, message: 'a published packaging version cannot be removed' });
    else if (canonicalize([same.name, same.base_units_per_pack, same.gtin]) !== canonicalize([p.name, p.base_units_per_pack, p.gtin])) issues.push({ path: `$.packaging[${i}]`, message: 'a published packaging version is immutable; publish a new version' });
  });
  return issues;
}
