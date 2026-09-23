// Builds spec/profiles/inventory/2/profile.json (the exact contract whose digest the kind registry will pin) and
// spec/profiles/inventory/2/fixtures.json: fact streams with the outcome the reducer MUST reach for every fact and
// the exact final ledger, plus the v1 projection. Deterministic; `--check` compares without writing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { INVENTORY2_KIND, INVENTORY2_PROFILE, INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS, OBSERVATION_WINDOW, applyInventoryFact, openInventoryLedger, projectInventoryV1 } from '../src/profiles/inventory2.ts';
import type { InventoryFact, InventoryLedger, MoveLeg, Position, Quantity, ReservationOp, WireUnit } from '../src/profiles/inventory2.ts';
import type { ProductBody } from '../src/profiles/product.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'inventory', version: '2.0.0', schema: structuredClone(INVENTORY2_SCHEMA) as Record<string, any>, semantics: INVENTORY2_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const ORG = '11111111-1111-4111-8111-111111111111', PRODUCT = '22222222-2222-4222-8222-222222222222', SERIALIZED = '33333333-3333-4333-8333-333333333333';
const PARTY = '44444444-4444-4444-8444-444444444444', TRANSFORMATION = '55555555-5555-4555-8555-555555555555', ORDER = '66666666-6666-4666-8666-666666666666';
const product: ProductBody = { names: [{ name: 'Heritage Tomato Sauce 680 g', language: 'en' }], description: null, brand: null, category: null, identifiers: [], base_unit: { system: 'ucum', code: '{jar}' },
  packaging: [{ packaging_id: 'case-12', version: '1', name: 'Case of 12 jars', base_units_per_pack: '12', gtin: null }, { packaging_id: 'odd', version: '1', name: 'Odd pack', base_units_per_pack: '2.5', gtin: null }], tracking: 'lot', shelf_life_days: null, replaces: null, status: 'active' };
const serialized: ProductBody = { ...product, names: [{ name: 'Fermenter FX-2', language: 'en' }], base_unit: { system: 'ucum', code: '{unit}' }, packaging: [], tracking: 'serial' };
const jar: WireUnit = { system: 'ucum', code: '{jar}', packaging_id: null, version: null, base_units_per_pack: null };
const unitOf = (code: string): WireUnit => ({ system: 'ucum', code, packaging_id: null, version: null, base_units_per_pack: null });
const cases: WireUnit = { system: 'packaging', code: null, packaging_id: 'case-12', version: '1', base_units_per_pack: '12' };
const odd: WireUnit = { system: 'packaging', code: null, packaging_id: 'odd', version: '1', base_units_per_pack: '2.5' };
const q = (amount: string, unit: WireUnit = jar): Quantity => ({ amount, unit });
const at = (lot: string | null, location: string, status: Position['status'] = 'available'): Position => ({ lot_id: lot, location_id: location, status });
const leg = (from: Position, to: Position, quantity: Quantity, extra: Partial<MoveLeg> = {}): MoveLeg => ({ from, to, quantity, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null }, ...extra });
const res = (kind: ReservationOp['kind'], reservation_id: string, position: Position, quantity: Quantity, party: string | null = null): ReservationOp => ({ kind, reservation_id, position, quantity, party });
let clock = Date.parse('2026-09-23T08:00:00.000Z');
const fact = (product_id: string, source: string, sequence: number, revision: number, moves: MoveLeg[], reservations: ReservationOp[] = []): InventoryFact =>
  ({ product_id, observation: { source_id: source, sequence }, occurred_at: new Date(clock += 60_000).toISOString(), expected_revision: revision, moves, reservations });
type Step = [string, InventoryFact];
type Flow = { why: string; product_id: string; product: ProductBody; steps: Step[]; bridge_location: string | null };

/** Lot-tracked sauce: the whole vocabulary, in order, with refusals interleaved so each refusal is judged against the state it meets. */
const sauce: Step[] = [];
const S = (why: string, f: InventoryFact) => { sauce.push([why, f]); return f; };
S('receive ten cases of lot L1 at the dock: a pack conversion, from the supplier', fact(PRODUCT, 'wms', 1, 0, [leg(at(null, '~supplier'), at('L1', 'dock'), q('10', cases))]));
S('move one hundred jars from the dock to the shelf: an atomic two-leg transfer is one leg with two real positions', fact(PRODUCT, 'wms', 2, 1, [leg(at('L1', 'dock'), at('L1', 'shelf'), q('100'))]));
S('quarantine twenty jars at the dock: a status change is a move between positions that differ only in status', fact(PRODUCT, 'wms', 3, 2, [leg(at('L1', 'dock'), at('L1', 'dock', 'quarantine'), q('20'))]));
S('reserve thirty on the shelf for a party', fact(PRODUCT, 'orders', 1, 3, [], [res('reserve', 'res-1', at('L1', 'shelf'), q('30'), PARTY)]));
S('REFUSED insufficient_stock: move eighty from the shelf when only seventy are unreserved', fact(PRODUCT, 'wms', 4, 4, [leg(at('L1', 'shelf'), at('L1', 'dock'), q('80'))]));
S('fulfil ten of the reservation: the claim shrinks and the stock leaves', fact(PRODUCT, 'orders', 2, 4, [], [res('fulfill', 'res-1', at('L1', 'shelf'), q('10'))]));
S('release the remaining twenty', fact(PRODUCT, 'orders', 3, 5, [], [res('release', 'res-1', at('L1', 'shelf'), q('20'))]));
S('a count correction of minus five with a reason', fact(PRODUCT, 'count', 1, 6, [leg(at('L1', 'shelf'), at(null, '~adjustment'), q('5'), { reason: 'cycle count 2026-09-23: five jars broken' })]));
S('REFUSED invalid: an adjustment without a reason', fact(PRODUCT, 'count', 2, 7, [leg(at('L1', 'shelf'), at(null, '~adjustment'), q('1'))]));
S('ten jars consumed by a transformation, linked to it', fact(PRODUCT, 'mes', 1, 7, [leg(at('L1', 'shelf'), at(null, '~production'), q('10'), { links: { transformation_id: TRANSFORMATION, order_id: null } })]));
S('a shipment of twenty-four jars as two cases against an order, and a half odd pack: several legs, one fact', fact(PRODUCT, 'wms', 4, 8, [leg(at('L1', 'shelf'), at(null, '~customer'), q('2', cases), { links: { transformation_id: null, order_id: ORDER } }), leg(at('L1', 'shelf'), at(null, '~customer'), q('2', odd))]));
S('DUPLICATE: the shelf transfer presented again, byte for byte', sauce[1][1]);
S('REFUSED observation_conflict: the same source and sequence with a different fact', { ...sauce[1][1], moves: [leg(at('L1', 'dock'), at('L1', 'shelf'), q('99'))] });
S('the order source jumps to sequence five', fact(PRODUCT, 'orders', 5, 9, [], [res('reserve', 'res-2', at('L1', 'shelf'), q('5'))]));
S('a late arrival: sequence four from the order source after five: accepted, it is new and inside the window', fact(PRODUCT, 'orders', 4, 10, [], [res('reserve', 'res-3', at('L1', 'shelf'), q('2'))]));
S('REFUSED revision_conflict: a fact that expected an older ledger', fact(PRODUCT, 'wms', 5, 3, [leg(at('L1', 'dock'), at('L1', 'shelf'), q('1'))]));
S('a source that starts at sequence one hundred', fact(PRODUCT, 'audit', 100, 11, [leg(at(null, '~supplier'), at('L2', 'dock'), q('1'))]));
S('REFUSED stale_observation: sequence thirty from that source is beyond the window and cannot be told from a duplicate', fact(PRODUCT, 'audit', 30, 12, [leg(at(null, '~supplier'), at('L2', 'dock'), q('1'))]));
S('sequence forty from that source is inside the window and new: accepted', fact(PRODUCT, 'audit', 40, 12, [leg(at(null, '~supplier'), at('L2', 'dock'), q('1'))]));
S('REFUSED tracking_mismatch: a lot-tracked product cannot hold stock without a lot', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at(null, 'dock'), q('1'))]));
S('REFUSED unit_mismatch: a quantity in kilograms for a product counted in jars; nothing is converted', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L1', 'dock'), q('1', unitOf('kg')))]));
S('REFUSED invalid: a pack conversion that is not a whole number of thousandths', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L1', 'dock'), q('0.001', odd))]));
S('REFUSED invalid: both ends virtual', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at(null, '~customer'), q('1'))]));
S('REFUSED invalid: an unknown virtual location', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~void'), at('L1', 'dock'), q('1'))]));
S('REFUSED invalid: a production leg without its transformation', fact(PRODUCT, 'wms', 6, 13, [leg(at('L1', 'shelf'), at(null, '~production'), q('1'))]));
S('REFUSED invalid: a reservation on quarantined stock', fact(PRODUCT, 'orders', 6, 13, [], [res('reserve', 'res-3', at('L1', 'dock', 'quarantine'), q('1'))]));
S('REFUSED insufficient_reservation: releasing a reservation that does not exist', fact(PRODUCT, 'orders', 6, 13, [], [res('release', 'res-9', at('L1', 'shelf'), q('1'))]));
S('REFUSED tracking_mismatch: serials on a lot-tracked product', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L1', 'dock'), q('1'), { serial_ids: ['SN-1'] })]));
S('REFUSED wrong_scope: a fact for another product', fact(SERIALIZED, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L1', 'dock'), q('1'))]));
S('a whole fact is refused when one leg fails, so the good leg leaves no trace: invalid', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L3', 'dock'), q('7')), leg(at('L1', 'shelf'), at(null, '~adjustment'), q('1'))]));
S('the same good leg alone is accepted, at the same revision, proving the previous fact left nothing behind', fact(PRODUCT, 'wms', 6, 13, [leg(at(null, '~supplier'), at('L3', 'dock'), q('7'))]));

/** Serialized equipment: every unit moves by serial. */
const units: Step[] = [];
const U = (why: string, f: InventoryFact) => { units.push([why, f]); return f; };
const unit = unitOf('{unit}');
U('receive three serialized units', fact(SERIALIZED, 'wms', 1, 0, [leg(at(null, '~supplier'), at('B1', 'dock'), q('3', unit), { serial_ids: ['FX2-001', 'FX2-002', 'FX2-003'] })]));
U('REFUSED serial_conflict: a quantity that is not the number of serials', fact(SERIALIZED, 'wms', 2, 1, [leg(at('B1', 'dock'), at('B1', 'floor'), q('2', unit), { serial_ids: ['FX2-001'] })]));
U('REFUSED serial_conflict: a serial that is not at the source', fact(SERIALIZED, 'wms', 2, 1, [leg(at('B1', 'dock'), at('B1', 'floor'), q('1', unit), { serial_ids: ['FX2-009'] })]));
U('REFUSED serial_conflict: receiving a serial that already exists in stock', fact(SERIALIZED, 'wms', 2, 1, [leg(at(null, '~supplier'), at('B1', 'dock'), q('1', unit), { serial_ids: ['FX2-002'] })]));
U('move two units to the floor by serial', fact(SERIALIZED, 'wms', 2, 1, [leg(at('B1', 'dock'), at('B1', 'floor'), q('2', unit), { serial_ids: ['FX2-001', 'FX2-003'] })]));
U('reserve one on the floor', fact(SERIALIZED, 'orders', 1, 2, [], [res('reserve', 'r-1', at('B1', 'floor'), q('1', unit), PARTY)]));
U('REFUSED tracking_mismatch: fulfilment of serialized stock must name its serials, so it is a move plus a release', fact(SERIALIZED, 'orders', 2, 3, [], [res('fulfill', 'r-1', at('B1', 'floor'), q('1', unit))]));
U('ship one by serial and release the claim in one fact', fact(SERIALIZED, 'orders', 2, 3, [leg(at('B1', 'floor'), at(null, '~customer'), q('1', unit), { serial_ids: ['FX2-003'], links: { transformation_id: null, order_id: ORDER } })], [res('release', 'r-1', at('B1', 'floor'), q('1', unit))]));
U('REFUSED tracking_mismatch: a serialized move without serials', fact(SERIALIZED, 'wms', 3, 4, [leg(at('B1', 'floor'), at('B1', 'dock'), q('1', unit))]));

const flows: Flow[] = [
  { why: 'lot-tracked product: receipts, transfers, status changes, reservations, corrections, production, shipments, duplicates, late and stale observations, refusals that leave no trace', product_id: PRODUCT, product, steps: sauce, bridge_location: 'shelf' },
  { why: 'serialized product: units move by serial and fulfilment is a move plus a release', product_id: SERIALIZED, product: serialized, steps: units, bridge_location: null },
];
function run(flow: Flow) {
  let ledger: InventoryLedger = openInventoryLedger(ORG, flow.product_id, flow.product);
  const results = flow.steps.map(([why, f]) => {
    if (!validateShape(contract.schema, f)) throw new Error(`generator: fact fails the dialect schema: ${why}`);
    const r = applyInventoryFact(ledger, structuredClone(f));
    const expect = r.ok ? { ok: true, duplicate: r.duplicate } : { ok: false, code: r.code };
    const shouldFail = why.startsWith('REFUSED') || why.startsWith('a whole fact is refused');
    if (shouldFail === r.ok) throw new Error(`generator: "${why}" gave ${JSON.stringify(expect)}${r.ok ? '' : ': ' + r.message}`);
    if (why.startsWith('DUPLICATE') !== (r.ok && r.duplicate)) throw new Error(`generator: duplicate expectation failed for "${why}"`);
    if (!r.ok) { if (!why.includes(r.code)) throw new Error(`generator: "${why}" refused with ${r.code}: ${r.message}`); }
    else ledger = r.state;
    return { why, fact: f, expect };
  });
  return { why: flow.why, product_id: flow.product_id, product: flow.product, facts: results, final: ledger, bridge: flow.bridge_location === null ? null : { location_id: flow.bridge_location, projection: projectInventoryV1(ledger, flow.bridge_location) } };
}
const out = {
  description: 'dtp/inventory@2 fixtures. For each flow a conforming reducer, starting from the ledger opened for the product, MUST reach exactly the expected outcome for every fact in order (an accepted fact advances the ledger; a refused or duplicate one leaves it unchanged; refusal codes are normative) and MUST end at exactly the final ledger. The bridge is the v1 projection of one location. The contract is the exact profile whose digest the kind registry pins once the kind is registered.',
  kind: INVENTORY2_KIND, profile: INVENTORY2_PROFILE, semantics: INVENTORY2_SEMANTICS, observation_window: OBSERVATION_WINDOW, contract_digest: await digest(contract), organization_id: ORG,
  flows: flows.map(run),
};
const dir = new URL('../../spec/profiles/inventory/2/', import.meta.url); mkdirSync(dir, { recursive: true });
const files: [URL, string][] = [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']];
for (const [target, text] of files) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('inventory@2:', out.contract_digest, out.flows.map(f => `${f.facts.length} facts`).join(', '));
