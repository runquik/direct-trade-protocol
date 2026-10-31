// GAP test (red team, surface 4 — business-fact profiles). Records a current defect so CI stays green; the GAP:
// assertions flip when the defect is closed. No fix here — only an executable observation, per teams/red-team.md.
//
// dtp/flow@1 Relations: "a flow goods ledger restricted to the company's own positions is an inventory@2 ledger.
// projectInventory2(book, product) is the bridge." A flow goods position keys on the full canonical tuple
// [lot_id, location, status, owner], where `location.ref` is an object reference carrying an optional `record_id`
// (an exact revision). The projection, however, spells a position's location with `minted_by`/`root` only and DROPS
// `record_id` (flow.ts projectInventory2 `spell`), then writes each projected position into a map keyed by
// (lot_id, location_id, status). Two of the company's own positions that differ ONLY by `location.ref.record_id`
// (the same physical location referenced once as the entity and once at an exact revision, or at two revisions) are
// distinct, conserved holdings in the flow ledger, but collide on one projection key — and the projection OVERWRITES
// rather than sums, so the stock of every colliding position but the last is silently dropped from the inventory@2
// view. `projectInventory2` is part of the packaged @dtp/sdk public API (exported as `flow` from both preview entries)
// and is the documented bridge an outside builder uses, so the view it hands an inventory@2 consumer understates stock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFlowFact, goodsLedgerKey, openFlowBook, openGoodsLedger, projectInventory2 } from '../../src/profiles/flow.ts';
import type { FlowBook, FlowFact } from '../../src/profiles/flow.ts';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const BOOK = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
const PRODUCT = '00000002-0000-4000-8000-000000000002'; // untracked product, base unit litre
const LOCATION = '000000aa-0000-4000-8000-0000000000aa'; // one physical dtp/location object root
const LOCATION_REV = '000000bb-0000-4000-8000-0000000000bb'; // an exact revision id of that location object

const unit = { system: 'ucum' as const, code: 'L', packaging_id: null, version: null, base_units_per_pack: null };
// A move that receives `amount` litres from ~supplier into the company's own position at LOCATION, referenced by
// `recordId` (null = the location entity, a UUID = an exact revision of the same location object).
const receive = (recordId: string | null, sequence: number, amount: string, expected_digest: string | null): FlowFact => ({
  act: { verb: 'move', occurred_at: '2026-10-23T08:24:00.000Z', observation: { source_id: 's', sequence }, basis: 'measured', references: [], evidence: [] },
  ledgers: [{ key: goodsLedgerKey(PRODUCT), expected_revision: sequence - 1, expected_digest }],
  legs: [{
    asset: { product: PRODUCT, currency: null },
    from: { lot_id: null, location: { ref: null, virtual: '~supplier' }, status: 'available', owner: null },
    to: { lot_id: null, location: { ref: { minted_by: null, root: LOCATION, record_id: recordId }, virtual: null }, status: 'available', owner: null },
    quantity: { amount, unit }, serial_ids: null, reason: null,
  }],
  reservations: [], transform: null, rights: null, settles: [],
});

test('GAP: flow@1 projectInventory2 silently drops a position whose location differs only by record_id (overwrite, not sum)', () => {
  let book: FlowBook = openGoodsLedger(openFlowBook(ORG, BOOK), PRODUCT, { base_unit: { system: 'ucum', code: 'L' }, tracking: 'none' });

  const first = applyFlowFact(book, receive(null, 1, '10', null));
  assert.ok(first.ok, 'receive 10 L at the location entity');
  book = first.state;

  const head = book.ledgers[goodsLedgerKey(PRODUCT)].head;
  const second = applyFlowFact(book, receive(LOCATION_REV, 2, '5', head));
  assert.ok(second.ok, 'receive 5 L at an exact revision of the same location');
  book = second.state;

  // The flow ledger correctly holds both as distinct, conserved positions: 10 + 5 = 15 litres on hand.
  const ledger = book.ledgers[goodsLedgerKey(PRODUCT)];
  const quantities = Object.values(ledger.positions).map(p => p.quantity).sort();
  assert.deepEqual(quantities, ['10', '5'], 'flow ledger holds two distinct positions totalling 15 L');

  const projection = projectInventory2(book, PRODUCT);
  const projected = Object.values(projection.positions);

  // GAP: the two positions collapse to one in the inventory@2 projection, and the projection reports only the last
  // position's quantity ('5'); the 10 L received at the location entity is silently dropped — neither kept as a
  // separate position nor summed into the surviving one. A faithful bridge would show 15 L on hand at the location.
  assert.equal(projected.length, 1, 'GAP: two distinct holdings collapse to one projected position');
  assert.equal(projected[0].quantity, '5', 'GAP: projection reports only the last position; 10 L is dropped, not summed to 15');
});
