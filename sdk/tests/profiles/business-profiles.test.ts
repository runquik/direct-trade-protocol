import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDecimal, multiplyRounded, parseDecimal } from '../../src/profiles/decimal.ts';
import { validateInvoice } from '../../src/profiles/invoice.ts';
import { applyInventoryEvent, createInventoryState, packagingDigest } from '../../src/profiles/inventory.ts';
import type { InventoryEvent, InventoryState, PackagingRevision } from '../../src/profiles/inventory.ts';

const money = (amount: string, currency = 'USD') => ({ amount, currency });
const invoice = () => ({
  contract_id: '11111111-1111-1111-1111-111111111111', seller_company_id: 'seller', buyer_company_id: 'buyer',
  line_items: [{ quantity: { amount: '2', unit: 'case' }, unit_price: money('100'), amount: money('200') }],
  subtotal: money('200'), deductions: [{ reason: 'discount', amount: money('20') }], total: money('180'),
  paid_amount: money('0'), status: 'issued', settlement_event_ids: [] as string[],
  issued_at: '2026-09-10T00:00:00.000Z', due_at: '2026-10-10T00:00:00.000Z',
});
const present = () => ({ status: 'present' as const, type: 'trade.contract', seller_company_id: 'seller', buyer_company_id: 'buyer' });

test('exact decimal arithmetic does not lose values beyond Number.MAX_SAFE_INTEGER', () => {
  const value = '9007199254740993.123456';
  assert.equal(formatDecimal(parseDecimal(value, 6), 6), value);
  assert.equal(formatDecimal(multiplyRounded(1001n, 3, 500n, 6, 6), 6), '0.000501');
  assert.equal(formatDecimal(multiplyRounded(-1001n, 3, 500n, 6, 6), 6), '-0.000501');
  assert.equal(formatDecimal(parseDecimal('0002.100', 3), 3), '2.1');
});

test('decimal parser bounds precision, length, signs and non-decimal encodings', () => {
  for (const value of ['1e2', ' 1', '+1', 'NaN', '1.0000001', '1'.repeat(10000), '1000000000000000000', '-1', '1.', '.1', 1.2]) {
    assert.throws(() => parseDecimal(value, 6), { name: 'DecimalError' }, String(value));
  }
  assert.throws(() => formatDecimal(10n ** 30n, 6));
});

test('invoice distinguishes valid arithmetic from unresolved, inaccessible and missing references', () => {
  const body = invoice();
  for (const status of ['unknown', 'missing', 'inaccessible'] as const) {
    const result = validateInvoice(body, { resolveReference: () => ({ status }) });
    assert.equal(result.valid, true);
    assert.equal(result.complete, false);
    assert.equal(result.issues[0].code, `reference_${status}`);
  }
  assert.equal(validateInvoice(body).complete, false);
  assert.equal(validateInvoice(body, { resolveReference: present }).complete, true);
  assert.equal(validateInvoice(body, { resolveReference: () => { throw new Error('unavailable'); } }).issues[0].code, 'reference_unknown');
});

test('invoice rejects the stress-test inconsistent arithmetic and cross-party evidence', () => {
  const body = invoice();
  body.line_items[0].amount = money('999'); body.subtotal = money('1'); body.total = money('700');
  const result = validateInvoice(body, { resolveReference: present });
  assert.equal(result.valid, false);
  assert.ok(result.issues.filter(i => i.code === 'arithmetic_mismatch').length >= 3);
  const mismatch = validateInvoice(invoice(), { resolveReference: () => ({ ...present(), buyer_company_id: 'another-buyer' }) });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.issues.some(i => i.code === 'reference_mismatch'));
});

test('invoice rounds each line to six places before summing and detects overflow', () => {
  const body = invoice();
  body.line_items = [1, 2].map(() => ({ quantity: { amount: '1.001', unit: 'case' }, unit_price: money('0.0005'), amount: money('0.000501') }));
  body.subtotal = money('0.001002'); body.deductions = []; body.total = money('0.001002');
  assert.equal(validateInvoice(body, { resolveReference: present }).complete, true);
  body.subtotal = money('0.001001');
  assert.equal(validateInvoice(body).valid, false);
  body.line_items[0].quantity.amount = '999999999999999999';
  body.line_items[0].unit_price.amount = '999999999999999999';
  assert.ok(validateInvoice(body).issues.some(i => i.code === 'invalid_decimal'));
});

test('invoice fails closed on unsupported currency/unit, negative amounts and excessive arrays', () => {
  const mutations = [
    (b: ReturnType<typeof invoice>) => { b.total.currency = 'EUR'; },
    (b: ReturnType<typeof invoice>) => { b.line_items[0].unit_price.currency = 'USDC'; },
    (b: ReturnType<typeof invoice>) => { b.line_items[0].quantity.unit = 'liter'; },
    (b: ReturnType<typeof invoice>) => { b.paid_amount.amount = '-1'; },
    (b: ReturnType<typeof invoice>) => { b.line_items = Array(1001).fill(b.line_items[0]); },
  ];
  for (const mutate of mutations) { const body = invoice(); mutate(body); assert.equal(validateInvoice(body).valid, false); }
  assert.equal(validateInvoice(null).valid, false);
});

test('invoice rejects impossible payment states, duplicate references and invalid calendar dates', () => {
  const body = invoice();
  body.status = 'paid'; assert.equal(validateInvoice(body).valid, false);
  body.paid_amount.amount = '180'; assert.equal(validateInvoice(body, { resolveReference: present }).valid, true);
  body.status = 'partially_paid'; assert.equal(validateInvoice(body).valid, false);
  body.status = 'issued'; body.paid_amount.amount = '0';
  body.issued_at = '2026-02-30T00:00:00Z'; assert.equal(validateInvoice(body).valid, false);
  body.issued_at = '2026-10-10T00:00:00.000002Z'; body.due_at = '2026-10-10T00:00:00.000001Z';
  assert.ok(validateInvoice(body).issues.some(i => i.code === 'invalid_date'));
  body.settlement_event_ids = [body.contract_id, body.contract_id];
  assert.ok(validateInvoice(body).issues.some(i => i.code === 'reference_mismatch'));
});

const start = () => createInventoryState('acme', 'warehouse-a/lot-a', 'jerky-a', 'unit');
const pack: PackagingRevision = { company_id: 'acme', product_id: 'jerky-a', packaging_id: 'case', version: '1',
  base_unit: 'unit', pack_unit: 'case', base_units_per_pack: '12' };
const base = (state: InventoryState, observation_id: string) => ({ company_id: state.company_id, pool_id: state.pool_id,
  source_id: 'scanner-a', observation_id, expected_revision: state.revision, occurred_at: '2026-09-10T00:00:00.000Z' });
const accepted = (state: InventoryState, event: InventoryEvent): InventoryState => {
  const result = applyInventoryEvent(state, event);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
};

test('inventory pins immutable packaging versions without reinterpreting existing stock', () => {
  let state = start();
  state = accepted(state, { ...base(state, 'pack-v1'), kind: 'packaging', packaging: pack });
  const receive: InventoryEvent = { ...base(state, 'scan-1'), kind: 'receive', quantity: '10', unit: 'case',
    packaging_pin: { packaging_id: 'case', version: '1', digest: packagingDigest(pack) } };
  state = accepted(state, receive);
  assert.equal(state.on_hand, '120');
  const changed = { ...pack, base_units_per_pack: '24' };
  const conflict = applyInventoryEvent(state, { ...base(state, 'pack-conflict'), kind: 'packaging', packaging: changed });
  assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.code, 'packaging_conflict');
  state = accepted(state, { ...base(state, 'pack-v2'), kind: 'packaging', packaging: { ...changed, version: '2' } });
  assert.equal(state.on_hand, '120');
  state = accepted(state, { ...receive, ...base(state, 'scan-2') });
  assert.equal(state.on_hand, '240', 'old pin still means 12 units per case');
});

test('inventory exact observation retry is a no-op, conflicting identity fails and namespaces stay distinct', () => {
  let state = start();
  const receive: InventoryEvent = { ...base(state, 'same-id'), kind: 'receive', quantity: '10', unit: 'unit' };
  state = accepted(state, receive);
  const retry = applyInventoryEvent(state, receive);
  assert.equal(retry.ok && retry.duplicate, true); assert.strictEqual(retry.state, state);
  const conflict = applyInventoryEvent(state, { ...receive, quantity: '11' });
  assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.code, 'observation_conflict');
  state = accepted(state, { ...receive, expected_revision: state.revision, source_id: 'scanner-b' });
  assert.equal(state.on_hand, '20');
});

test('inventory serial CAS prevents stale reservations and cumulative reservations cannot oversell', () => {
  let state = start();
  state = accepted(state, { ...base(state, 'receive'), kind: 'receive', quantity: '10', unit: 'unit' });
  const reserve: InventoryEvent = { ...base(state, 'reserve-a'), kind: 'reserve', reservation_id: 'order-a', quantity: '8', unit: 'unit' };
  state = accepted(state, reserve);
  const stale = applyInventoryEvent(state, { ...reserve, observation_id: 'reserve-b', reservation_id: 'order-b' });
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.code, 'revision_conflict');
  const oversell = applyInventoryEvent(state, { ...reserve, ...base(state, 'reserve-b'), reservation_id: 'order-b' });
  assert.equal(oversell.ok, false); if (!oversell.ok) assert.equal(oversell.code, 'insufficient_stock');
  state = accepted(state, { ...reserve, ...base(state, 'reserve-a-more'), quantity: '2' });
  assert.deepEqual(Object.values(state.reservations), ['10']);
});

test('inventory partial fulfillment, release and correction preserve both balances', () => {
  let state = start();
  state = accepted(state, { ...base(state, 'receive'), kind: 'receive', quantity: '10', unit: 'unit' });
  state = accepted(state, { ...base(state, 'reserve'), kind: 'reserve', reservation_id: '__proto__', quantity: '8', unit: 'unit' });
  state = accepted(state, { ...base(state, 'partial'), kind: 'fulfill', reservation_id: '__proto__', quantity: '3', unit: 'unit' });
  assert.equal(state.on_hand, '7'); assert.deepEqual(Object.values(state.reservations), ['5']);
  const adjustment: InventoryEvent = { ...base(state, 'adjustment'), kind: 'adjust', quantity: '-3', unit: 'unit', reason: 'damaged' };
  assert.equal(applyInventoryEvent(state, adjustment).ok, false);
  state = accepted(state, { ...base(state, 'release'), kind: 'release', reservation_id: '__proto__', quantity: '2', unit: 'unit' });
  state = accepted(state, { ...adjustment, expected_revision: state.revision });
  assert.equal(state.on_hand, '4'); assert.deepEqual(Object.values(state.reservations), ['3']);
  const tooMuch = applyInventoryEvent(state, { ...base(state, 'fulfill-too-much'), kind: 'fulfill', reservation_id: '__proto__', quantity: '4', unit: 'unit' });
  assert.equal(tooMuch.ok, false); if (!tooMuch.ok) assert.equal(tooMuch.code, 'insufficient_reservation');
});

test('inventory late occurrence does not rewind authority; scope, dates, semantics and conversions fail closed', () => {
  let state = start();
  const event: InventoryEvent = { ...base(state, 'receive'), kind: 'receive', quantity: '1', unit: 'unit' };
  state = accepted(state, event);
  state = accepted(state, { ...event, ...base(state, 'late'), occurred_at: '2020-01-01T00:00:00Z' });
  assert.equal(state.on_hand, '2');
  for (const change of [{ company_id: 'other' }, { unit: 'liter' }, { occurred_at: '2026-02-30T00:00:00Z' },
    { unit: 'case' }, { quantity: '0' }, { hidden_multiplier: '2' }]) {
    const result = applyInventoryEvent(state, { ...event, ...base(state, 'bad'), ...change });
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.strictEqual(result.state, state);
  }
  const fractional = { ...pack, base_units_per_pack: '0.001' };
  state = accepted(state, { ...base(state, 'fractional-pack'), kind: 'packaging', packaging: fractional });
  assert.equal(applyInventoryEvent(state, { ...base(state, 'small'), kind: 'receive', quantity: '0.001', unit: 'case',
    packaging_pin: { packaging_id: 'case', version: '1', digest: packagingDigest(fractional) } }).ok, false);
});

test('inventory reducers do not mutate their input on acceptance or denial', () => {
  const state = start();
  const original = structuredClone(state);
  const event: InventoryEvent = { ...base(state, 'receive'), kind: 'receive', quantity: '5', unit: 'unit' };
  assert.equal(applyInventoryEvent(state, event).ok, true);
  assert.deepEqual(state, original);
  assert.equal(applyInventoryEvent(state, { ...event, kind: 'adjust', quantity: '-5', reason: 'correction' }).ok, false);
  assert.deepEqual(state, original);
});

test('inventory deterministic mixed-event stress preserves invariants across 1000 attempts', () => {
  let state = start();
  let seed = 741;
  const random = (max: number) => { seed = (seed * 48271) % 2147483647; return seed % max; };
  const seen = new Map<string, InventoryEvent>();
  for (let step = 0; step < 1000; step++) {
    const kind = (['receive', 'reserve', 'release', 'fulfill', 'adjust'] as const)[random(5)];
    const shared = { ...base(state, `observation-${step}`), unit: 'unit', quantity: String(1 + random(5)) };
    const event: InventoryEvent = kind === 'receive' ? { ...shared, kind }
      : kind === 'adjust' ? { ...shared, kind, quantity: `-${shared.quantity}`, reason: 'cycle-count correction' }
      : { ...shared, kind, reservation_id: `order-${random(10)}` };
    const before = structuredClone(state);
    const result = applyInventoryEvent(state, event);
    assert.deepEqual(state, before, 'pure reducer mutated caller snapshot');
    if (result.ok) {
      state = result.state;
      seen.set(event.observation_id, event);
      const replay = applyInventoryEvent(state, event);
      assert.equal(replay.ok && replay.duplicate, true);
      assert.strictEqual(replay.state, state);
    } else assert.strictEqual(result.state, state);
    const reserved = Object.values(state.reservations).reduce((sum, value) => sum + parseDecimal(value, 3), 0n);
    assert.ok(reserved >= 0n && reserved <= parseDecimal(state.on_hand, 3));
    assert.equal(state.revision, seen.size);
  }
  assert.ok(seen.size > 100, 'fixture must exercise a substantial accepted event history');
});
