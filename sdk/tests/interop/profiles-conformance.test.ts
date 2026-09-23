import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkProductContinuity, validateProduct } from '../../src/profiles/product.ts';
import { applyInventoryFact, openInventoryLedger, projectInventoryV1 } from '../../src/profiles/inventory2.ts';
import type { InventoryLedger } from '../../src/profiles/inventory2.ts';
import { readContinuity, readProduct, readerDigest } from './product-reader.ts';
import { openLedger, projectV1, readFact } from './inventory2-reader.ts';

const load = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const product = load('../../../spec/profiles/product/1/fixtures.json'), productContract = load('../../../spec/profiles/product/1/profile.json');
const inventory = load('../../../spec/profiles/inventory/2/fixtures.json'), inventoryContract = load('../../../spec/profiles/inventory/2/profile.json');

test('second implementation of product@1: the reader judges every fixture body and continuity pair exactly as required, and agrees with the reference on which paths fail', () => {
  assert.equal(readerDigest(productContract), product.contract_digest, 'the reader recomputes the registered contract digest');
  for (const v of product.accept) assert.deepEqual(readProduct(v.body), [], v.why);
  for (const v of product.reject) {
    const mine = readProduct(v.body), reference = validateProduct(v.body);
    assert.ok(mine.length > 0, v.why);
    assert.deepEqual(new Set(mine.map(i => i.path)), new Set(reference.map(i => i.path)), `${v.why}: both implementations blame the same fields`);
  }
  for (const v of product.continuity.accept) assert.deepEqual(readContinuity(v.previous, v.next), [], v.why);
  for (const v of product.continuity.reject) {
    const mine = readContinuity(v.previous, v.next), reference = checkProductContinuity(v.previous, v.next);
    assert.ok(mine.length > 0, v.why); assert.deepEqual(mine.map(i => i.path), reference.map(i => i.path), v.why);
  }
});

test('second implementation of inventory@2: the reader reaches every expected outcome, ends at the exact final ledger, agrees with the reference after every fact, and projects the same v1 view', () => {
  assert.equal(readerDigest(inventoryContract), inventory.contract_digest);
  for (const flow of inventory.flows) {
    let mine = openLedger(inventory.organization_id, flow.product_id, flow.product), reference: InventoryLedger = openInventoryLedger(inventory.organization_id, flow.product_id, flow.product);
    assert.deepEqual(mine, reference, `${flow.why}: the opened ledger`);
    for (const step of flow.facts) {
      const r = readFact(mine, structuredClone(step.fact)), ref = applyInventoryFact(reference, structuredClone(step.fact));
      assert.deepEqual(r.outcome, step.expect, step.why);
      assert.deepEqual(r.outcome, ref.ok ? { ok: true, duplicate: ref.duplicate } : { ok: false, code: ref.code }, `${step.why}: same outcome as the reference`);
      mine = r.ledger; if (ref.ok) reference = ref.state;
      assert.deepEqual(mine, reference, `${step.why}: same ledger as the reference after the fact`);
    }
    assert.deepEqual(mine, flow.final, flow.why);
    if (flow.bridge) { assert.deepEqual(projectV1(mine, flow.bridge.location_id), flow.bridge.projection, flow.why); assert.deepEqual(projectV1(mine, flow.bridge.location_id), projectInventoryV1(reference, flow.bridge.location_id)); }
  }
});
