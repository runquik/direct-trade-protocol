// #85 and #99 for both stock kinds. Replaces the gap test of #86: a fully reserved serialized unit now ships in one fact,
// and a pack conversion is matched by value, not spelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInventoryFact, openInventoryLedger, samePackConversion, unpublishedPackaging } from '../../src/profiles/inventory2.ts';
import type { InventoryFact, InventoryLedger, MoveLeg, ReservationOp } from '../../src/profiles/inventory2.ts';
import { flowUnpublishedPackaging } from '../../src/profiles/flow.ts';

const ORG = '11111111-1111-4111-8111-111111111111', PID = '33333333-3333-4333-8333-333333333333';
const unit = { system: 'ucum', code: '{unit}', packaging_id: null, version: null, base_units_per_pack: null } as const;
const qty = (amount: string) => ({ amount, unit });
const at = (location_id: string, lot_id: string | null = 'B1') => ({ lot_id, location_id, status: 'available' as const });
const links = { transformation_id: null, order_id: null };
function ledgerWith(tracking: 'serial' | 'lot') {
  let ledger: InventoryLedger = openInventoryLedger(ORG, PID, { base_unit: { system: 'ucum', code: '{unit}' }, tracking }), seq = 0;
  const apply = (moves: MoveLeg[], reservations: ReservationOp[]) => {
    const fact: InventoryFact = { product_id: PID, observation: { source_id: 'wms', sequence: ++seq }, occurred_at: '2026-10-22T00:00:00.000Z', expected_revision: ledger.revision, moves, reservations };
    const r = applyInventoryFact(ledger, fact); if (r.ok) ledger = r.state; return r;
  };
  return { apply, ledger: () => ledger };
}

test('#85: fully reserved stock ships in one fact with its release, in either array order, and the claim protects it until then', () => {
  for (const tracking of ['serial', 'lot'] as const) {
    const { apply, ledger } = ledgerWith(tracking), serials = tracking === 'serial' ? ['SN-1'] : null;
    assert.ok(apply([{ from: at('~supplier', null), to: at('floor'), quantity: qty('1'), serial_ids: serials, reason: null, links }], []).ok);
    assert.ok(apply([], [{ kind: 'reserve', reservation_id: 'r-1', position: at('floor'), quantity: qty('1'), party: null }]).ok);
    const ship: MoveLeg = { from: at('floor'), to: at('~customer', null), quantity: qty('1'), serial_ids: serials, reason: null, links };
    const release: ReservationOp = { kind: 'release', reservation_id: 'r-1', position: at('floor'), quantity: qty('1'), party: null };
    const blocked = apply([ship], []); assert.equal(blocked.ok === false && blocked.code, 'insufficient_stock', `${tracking}: the claim still protects the unit`);
    const shipped = apply([ship], [release]); assert.ok(shipped.ok, `${tracking}: ${shipped.ok ? '' : shipped.message}`);
    assert.deepEqual(ledger().positions, {}); assert.deepEqual(ledger().reservations, {});
  }
});

test('#85: a fact can still receive stock and reserve it, because reserves claim after the legs', () => {
  const { apply, ledger } = ledgerWith('lot');
  const r = apply([{ from: at('~supplier', null), to: at('floor'), quantity: qty('5'), serial_ids: null, reason: null, links }], [{ kind: 'reserve', reservation_id: 'r-1', position: at('floor'), quantity: qty('5'), party: null }]);
  assert.ok(r.ok); assert.equal(Object.values(ledger().reservations)[0].quantity, '5');
});

test('#99: pack conversions match by value in both stock kinds, and a different value is still unknown', () => {
  assert.ok(samePackConversion('12', '12.000') && samePackConversion('2.5', '2.50') && samePackConversion('0.125', '0.125'));
  assert.ok(!samePackConversion('12', '12.001') && !samePackConversion('12', 'twelve') && !samePackConversion('12', '12.0001'));
  const product = { packaging: [{ packaging_id: 'case-12', version: '1', name: 'Case', base_units_per_pack: '12', gtin: null }] };
  const pack = (base_units_per_pack: string) => ({ system: 'packaging', code: null, packaging_id: 'case-12', version: '1', base_units_per_pack });
  for (const spelled of ['12', '12.0', '12.000']) {
    assert.equal(unpublishedPackaging({ moves: [{ quantity: { amount: '1', unit: pack(spelled) } }], reservations: [] }, product as any), false, spelled);
    assert.equal(flowUnpublishedPackaging({ legs: [{ asset: { product: PID, currency: null }, quantity: { amount: '1', unit: pack(spelled) } }], reservations: [] }, () => product as any), false, spelled);
  }
  assert.equal(unpublishedPackaging({ moves: [{ quantity: { amount: '1', unit: pack('12.5') } }], reservations: [] }, product as any), true);
  assert.equal(flowUnpublishedPackaging({ legs: [{ asset: { product: PID, currency: null }, quantity: { amount: '1', unit: pack('12.5') } }], reservations: [] }, () => product as any), true);
});
