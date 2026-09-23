// Builds spec/profiles/product/1/profile.json (the exact contract whose digest the kind registry will pin) and
// spec/profiles/product/1/fixtures.json from the reference rules. Deterministic: rerunning must leave both files
// unchanged; `--check` compares without writing. Profile document: spec/profiles/product/1.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { PRODUCT_KIND, PRODUCT_PROFILE, PRODUCT_SCHEMA, PRODUCT_SEMANTICS, checkProductContinuity, validateProduct } from '../src/profiles/product.ts';
import type { ProductBody } from '../src/profiles/product.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'product', version: '1.0.0', schema: structuredClone(PRODUCT_SCHEMA) as Record<string, any>, semantics: PRODUCT_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const clone = <V>(v: V): V => structuredClone(v);
const base: ProductBody = {
  names: [{ name: 'Heritage Tomato Sauce 680 g', language: 'en' }, { name: 'Salsa de tomate 680 g', language: 'es' }],
  description: 'Slow-cooked tomato sauce in a glass jar.', brand: 'Example Foods', category: 'sauces',
  identifiers: [{ scheme: 'gs1.gtin', value: '00012345678905' }, { scheme: 'sku', value: 'HTS-680' }, { scheme: 'supplier.code', value: 'A-77' }],
  base_unit: { system: 'ucum', code: '{jar}' },
  packaging: [{ packaging_id: 'case-12', version: '1', name: 'Case of 12 jars', base_units_per_pack: '12', gtin: '10012345678902' }],
  tracking: 'lot', shelf_life_days: 540, replaces: null, status: 'active',
};
const change = (edit: (b: ProductBody) => void): ProductBody => { const b = clone(base); edit(b); return b; };
type Case = [string, unknown];
const accept: Case[] = [
  ['a lot-tracked product with a GTIN, a company sku, a private identifier and one packaging revision', base],
  ['the minimum: one name, no identifiers, no packaging, everything optional null', { names: [{ name: 'Bulk flour', language: null }], description: null, brand: null, category: null, identifiers: [], base_unit: { system: 'ucum', code: 'kg' }, packaging: [], tracking: 'none', shelf_life_days: null, replaces: null, status: 'active' }],
  ['a serialized product replacing an earlier one', change(b => { b.tracking = 'serial'; b.replaces = '11111111-1111-4111-8111-111111111111'; b.identifiers = [{ scheme: 'gs1.gtin', value: '4006381333931' }]; })],
  ['a discontinued product with a GTIN-8 and a mass base unit in UCUM bracket syntax', change(b => { b.status = 'discontinued'; b.base_unit = { system: 'ucum', code: '[lb_av]' }; b.identifiers = [{ scheme: 'gs1.gtin', value: '96385074' }]; b.packaging = []; })],
  ['two packaging revisions of one packaging id, both kept', change(b => { b.packaging.push({ packaging_id: 'case-12', version: '2', name: 'Case of 12 jars, new tray', base_units_per_pack: '12', gtin: null }); })],
  ['a fractional pack conversion at three places', change(b => { b.packaging = [{ packaging_id: 'sack', version: '1', name: 'Sack', base_units_per_pack: '22.680', gtin: null }]; b.base_unit = { system: 'ucum', code: 'kg' }; })],
];
const reject: Case[] = [
  ['no names', change(b => { b.names = []; })],
  ['an empty name', change(b => { b.names = [{ name: '', language: null }]; })],
  ['a language that is not a tag', change(b => { b.names[0].language = 'English'; })],
  ['a GTIN with a wrong check digit', change(b => { b.identifiers[0].value = '00012345678904'; })],
  ['a GTIN of the wrong length', change(b => { b.identifiers[0].value = '0001234567890'; })],
  ['two company skus', change(b => { b.identifiers.push({ scheme: 'sku', value: 'HTS-680-B' }); })],
  ['a duplicate identifier', change(b => { b.identifiers.push({ scheme: 'sku', value: 'HTS-680' }); })],
  ['an identifier scheme that is not namespaced lowercase', change(b => { b.identifiers[2].scheme = 'Supplier Code'; })],
  ['a base unit outside UCUM', change(b => { b.base_unit = { system: 'iso', code: 'kg' } as any; })],
  ['a base unit code with whitespace', change(b => { b.base_unit.code = 'k g'; })],
  ['a pack conversion of zero', change(b => { b.packaging[0].base_units_per_pack = '0'; })],
  ['a pack conversion beyond three places', change(b => { b.packaging[0].base_units_per_pack = '12.0001'; })],
  ['a pack conversion as a JSON number', change(b => { (b.packaging[0] as any).base_units_per_pack = 12; })],
  ['a packaging GTIN with a wrong check digit', change(b => { b.packaging[0].gtin = '10012345678903'; })],
  ['a duplicate packaging version', change(b => { b.packaging.push(clone(b.packaging[0])); })],
  ['an unknown tracking mode', change(b => { (b as any).tracking = 'batch'; })],
  ['a zero shelf life', change(b => { b.shelf_life_days = 0; })],
  ['a replaced product that is not a root id', change(b => { b.replaces = 'HTS-600'; })],
  ['an unknown status', change(b => { (b as any).status = 'draft'; })],
  ['an extra member', change(b => { (b as any).color = 'red'; })],
  ['a missing member', (() => { const { status: _, ...rest } = clone(base); return rest; })()],
  ['names as a string', change(b => { (b as any).names = 'Sauce'; })],
];
type Continuity = [string, ProductBody, ProductBody];
const continuityAccept: Continuity[] = [
  ['a status change', base, change(b => { b.status = 'discontinued'; })],
  ['a new packaging revision beside the old one', base, change(b => { b.packaging.push({ packaging_id: 'case-12', version: '2', name: 'Case of 12 jars, new tray', base_units_per_pack: '12', gtin: null }); })],
  ['new names, identifiers and description', base, change(b => { b.names.push({ name: 'Sauce tomate 680 g', language: 'fr' }); b.identifiers.push({ scheme: 'retailer.plu', value: '4099' }); b.description = null; })],
];
const continuityReject: Continuity[] = [
  ['a changed base unit: the stock ledger keys on it', base, change(b => { b.base_unit = { system: 'ucum', code: 'kg' }; })],
  ['a changed tracking mode', base, change(b => { b.tracking = 'serial'; })],
  ['a changed replaced product', base, change(b => { b.replaces = '11111111-1111-4111-8111-111111111111'; })],
  ['a packaging version removed', base, change(b => { b.packaging = []; })],
  ['a packaging version altered in place', base, change(b => { b.packaging[0].base_units_per_pack = '6'; })],
  ['a packaging GTIN altered in place', base, change(b => { b.packaging[0].gtin = null; })],
];
for (const [why, body] of accept) {
  if (!validateShape(contract.schema, body)) throw new Error(`generator: accepted body fails the dialect schema: ${why}`);
  const issues = validateProduct(body); if (issues.length) throw new Error(`generator: reference validator refused "${why}": ${issues[0].message} at ${issues[0].path}`);
}
for (const [why, body] of reject) if (validateProduct(body).length === 0) throw new Error(`generator: reference validator accepted "${why}"`);
for (const [why, a, b] of continuityAccept) if (checkProductContinuity(a, b).length) throw new Error(`generator: continuity refused "${why}"`);
for (const [why, a, b] of continuityReject) if (checkProductContinuity(a, b).length === 0) throw new Error(`generator: continuity accepted "${why}"`);
const out = {
  description: 'dtp/product@1 fixtures. A conforming validator MUST accept every body under "accept" and refuse every body under "reject"; given a previous and a next revision of one product it MUST accept every pair under "continuity.accept" and refuse every pair under "continuity.reject". Refusal reasons are not normative. The contract is the exact profile whose digest the kind registry pins once the kind is registered.',
  kind: PRODUCT_KIND, profile: PRODUCT_PROFILE, semantics: PRODUCT_SEMANTICS, contract_digest: await digest(contract),
  accept: accept.map(([why, body]) => ({ why, body })), reject: reject.map(([why, body]) => ({ why, body })),
  continuity: { accept: continuityAccept.map(([why, previous, next]) => ({ why, previous, next })), reject: continuityReject.map(([why, previous, next]) => ({ why, previous, next })) },
};
const dir = new URL('../../spec/profiles/product/1/', import.meta.url); mkdirSync(dir, { recursive: true });
const files: [URL, string][] = [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']];
for (const [target, text] of files) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  // A checkout may have converted line endings; the content is what must not drift.
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('product@1:', out.contract_digest, accept.length, 'accept,', reject.length, 'reject,', continuityAccept.length + continuityReject.length, 'continuity cases');
