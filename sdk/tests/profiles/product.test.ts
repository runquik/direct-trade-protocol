import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { PRODUCT_KIND, PRODUCT_PROFILE, PRODUCT_SCHEMA, PRODUCT_SEMANTICS, checkProductContinuity, isGtin, validateProduct } from '../../src/profiles/product.ts';
import type { ProductBody } from '../../src/profiles/product.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixtures = parseUntrustedJson(readFileSync(here('../../../spec/profiles/product/1/fixtures.json'), 'utf8')) as {
  kind: string; profile: string; semantics: string; contract_digest: string; accept: { why: string; body: unknown }[]; reject: { why: string; body: unknown }[];
  continuity: { accept: { why: string; previous: ProductBody; next: ProductBody }[]; reject: { why: string; previous: ProductBody; next: ProductBody }[] } };
const contract = parseUntrustedJson(readFileSync(here('../../../spec/profiles/product/1/profile.json'), 'utf8')) as Record<string, unknown>;

test('product@1 fixtures: every accepted body passes the dialect schema and the rules; every rejected body is refused; continuity pairs judged exactly', () => {
  assert.equal(fixtures.kind, PRODUCT_KIND); assert.equal(fixtures.profile, PRODUCT_PROFILE); assert.equal(fixtures.semantics, PRODUCT_SEMANTICS);
  assert.ok(fixtures.accept.length >= 6 && fixtures.reject.length >= 22 && fixtures.continuity.accept.length >= 3 && fixtures.continuity.reject.length >= 6);
  checkSchema(contract.schema);
  for (const v of fixtures.accept) { assert.ok(validateShape(contract.schema, v.body), v.why); assert.deepEqual(validateProduct(v.body), [], v.why); }
  for (const v of fixtures.reject) assert.ok(validateProduct(v.body).length > 0, v.why);
  for (const v of fixtures.continuity.accept) assert.deepEqual(checkProductContinuity(v.previous, v.next), [], v.why);
  for (const v of fixtures.continuity.reject) assert.ok(checkProductContinuity(v.previous, v.next).length > 0, v.why);
});

test('product@1 contract: the published contract is the reference schema, and its digest is recomputed with a second SHA-256', () => {
  assert.deepEqual(contract, { publisher_id: 'dtp', name: 'product', version: '1.0.0', schema: PRODUCT_SCHEMA, semantics: PRODUCT_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(contract), 'utf8').digest('hex'), fixtures.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-product-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('product@1 rules: GTIN check digits, identifier namespaces, units and packaging are judged by content', () => {
  for (const ok of ['96385074', '012345678905', '4006381333931', '00012345678905', '10012345678902']) assert.ok(isGtin(ok), ok);
  for (const bad of ['96385075', '0123456789', '4006381333932', 'ABCDEFGH', '', 12345678, '00012345678905 ']) assert.ok(!isGtin(bad as any), String(bad));
  const base = fixtures.accept[0].body as ProductBody;
  const issue = (edit: (b: ProductBody) => void) => { const b = structuredClone(base); edit(b); return validateProduct(b).map(i => i.path); };
  assert.deepEqual(issue(b => { b.identifiers[0].value = '00012345678904'; }), ['$.identifiers[0].value']);
  assert.deepEqual(issue(b => { b.base_unit.code = ''; }), ['$.base_unit']);
  assert.deepEqual(issue(b => { b.packaging[0].base_units_per_pack = '-1'; }), ['$.packaging[0].base_units_per_pack']);
  assert.deepEqual(issue(b => { b.names[0].name = ' padded'; b.shelf_life_days = 1e9; }), ['$.names[0].name', '$.shelf_life_days']);
  assert.deepEqual(validateProduct(null), [{ path: '$', message: 'exact product fields required' }]);
  assert.deepEqual(validateProduct([]), [{ path: '$', message: 'exact product fields required' }]);
});
