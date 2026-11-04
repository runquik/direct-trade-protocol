// Gap test for #144. Expected-observation test: a passing GAP case reproduces a deficiency; it does not certify the behaviour.
// spec/profiles/inventory/2.md, Semantics 5: "Per source the ledger keeps a high-water mark and the digests of accepted
// sequences within a window of 64 below it. ... A sequence below the window is refused as stale_observation ... A
// sequence above the mark, or inside the window and unseen, is new." Read literally, the window below a mark M is
// M-64 .. M-1, so an unseen M-64 is new. The reference keeps only M-63 .. M and refuses M-64 as stale_observation.
// The fixtures pin 30 (stale) and 40 (new) against a mark of 100, so neither reading is pinned at the boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInventoryFact, openInventoryLedger, OBSERVATION_WINDOW, type InventoryLedger } from '../../src/profiles/inventory2.ts';

const ORG = '00000000-0000-4000-8000-000000000001', PRODUCT = '00000000-0000-4000-8000-000000000002';
const unit = { system: 'ucum', code: '1', packaging_id: null, version: null, base_units_per_pack: null } as const;
const shelf = { lot_id: null, location_id: 'shelf', status: 'available' } as const;
const supplier = { lot_id: null, location_id: '~supplier', status: 'available' } as const;
const receipt = (ledger: InventoryLedger, sequence: number) => ({
  product_id: PRODUCT, observation: { source_id: 'scanner', sequence }, occurred_at: '2026-11-01T00:00:00Z', expected_revision: ledger.revision,
  moves: [{ from: supplier, to: shelf, quantity: { amount: '1', unit }, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null } }], reservations: [],
});

test('GAP: an unseen sequence exactly 64 below the mark is refused as stale, though the document puts it inside the window', () => {
  assert.equal(OBSERVATION_WINDOW, 64);
  const opened = openInventoryLedger(ORG, PRODUCT, { base_unit: { system: 'ucum', code: '1' }, tracking: 'none' } as any);
  const first = applyInventoryFact(opened, receipt(opened, 100) as any);
  assert.ok(first.ok && !first.duplicate);
  const ledger = first.state;

  // Control: 63 below the mark is inside the window under either reading, unseen, and therefore new stock.
  const inside = applyInventoryFact(ledger, receipt(ledger, 100 - 63) as any);
  assert.ok(inside.ok && !inside.duplicate, 'mark-63 is new under both readings');

  // GAP: 64 below the mark. Literal reading of the document: inside the window and unseen, so new.
  // Reference today: refused as stale_observation, and its window state never holds that sequence.
  const boundary = applyInventoryFact(ledger, receipt(ledger, 100 - 64) as any);
  assert.equal(boundary.ok, false);
  assert.equal(!boundary.ok && boundary.code, 'stale_observation');
  assert.deepEqual(Object.keys(inside.ok ? inside.state.sources.scanner.recent : {}).map(Number).sort((a, b) => a - b), [37, 100]);
});
