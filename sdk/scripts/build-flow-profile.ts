// Builds spec/profiles/flow/1/profile.json (the exact contract the kind registry pins) and spec/profiles/flow/1/fixtures.json:
// books opened with their ledgers, fact streams with the outcome the reducer MUST reach for every fact, the exact final
// book, and the inventory@2 projection of one product. Deterministic; `--check` compares without writing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { FLOW_KIND, FLOW_PROFILE, FLOW_SCHEMA, FLOW_SEMANTICS, OBSERVATION_WINDOW, applyFlowFact, goodsLedgerKey, moneyLedgerKey, openFlowBook, openGoodsLedger, openMoneyLedger, projectInventory2 } from '../src/profiles/flow.ts';
import type { Asset, FlowBook, FlowFact, FlowLeg, FlowPosition, FlowQuantity, FlowReservation, FlowUnit, Settlement, Transform } from '../src/profiles/flow.ts';
import type { ObjectRef } from '../src/profiles/act.ts';
import type { ProductBody } from '../src/profiles/product.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'flow', version: '1.0.0', schema: structuredClone(FLOW_SCHEMA) as Record<string, any>, semantics: FLOW_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', CARRIER = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', RETAILER = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
const BOOK = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e', TOOLS = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEPPERS = id(1), VINEGAR = id(2), JARS = id(3), SAUCE = id(4), FERMENTER = id(5);
const DOCK = id(11), SHELF = id(12), OPERATING = id(13), CREDIT_LINE = id(14), TRAILER = id(15), RETAILER_DC = id(16), RECIPE = id(17), KETTLE = id(18);
const INVOICE = id(21), SUPPLIER_BILL = id(22), PROMO_OWED = id(23), PROMO_DEDUCTION = id(24), RETAILER_PARTY = id(25), SUPPLIER_PARTY = id(26);
const own = (root: string): ObjectRef => ({ minted_by: null, root, record_id: null });
const theirs = (minted_by: string, root: string): ObjectRef => ({ minted_by, root, record_id: null });
const product = (code: string, tracking: ProductBody['tracking']): Pick<ProductBody, 'base_unit' | 'tracking'> => ({ base_unit: { system: 'ucum', code }, tracking });
const ucum = (code: string): FlowUnit => ({ system: 'ucum', code, packaging_id: null, version: null, base_units_per_pack: null });
const usd: FlowUnit = { system: 'currency', code: 'USD', packaging_id: null, version: null, base_units_per_pack: null };
const q = (amount: string, unit: FlowUnit): FlowQuantity => ({ amount, unit });
const goods = (root: string): Asset => ({ product: root, currency: null }), money: Asset = { product: null, currency: 'USD' };
const at = (location: ObjectRef, lot: string | null = null, owner: ObjectRef | null = null, status: FlowPosition['status'] = 'available'): FlowPosition => ({ lot_id: lot, location: { ref: location, virtual: null }, status, owner });
const outside = (virtual: string): FlowPosition => ({ lot_id: null, location: { ref: null, virtual }, status: 'available', owner: null });
const leg = (asset: Asset, from: FlowPosition, to: FlowPosition, quantity: FlowQuantity, extra: Partial<FlowLeg> = {}): FlowLeg => ({ asset, from, to, quantity, serial_ids: null, reason: null, ...extra });
const settle = (claim: ObjectRef, kind: Settlement['kind'], amount: string, reverses: string | null = null): Settlement => ({ claim, kind, amount, currency: 'USD', reverses });

/** Fact builder that reads the current book for the expected revision and digest of every ledger it names, unless told otherwise. */
type Draft = { verb: 'move' | 'transform' | 'transfer'; source: string; sequence: number; basis?: 'asserted' | 'measured' | 'inferred'; ledgers: string[]; legs?: FlowLeg[]; reservations?: FlowReservation[]; transform?: Transform | null; rights?: ('title' | 'custody')[] | null; settles?: Settlement[]; references?: ObjectRef[]; stale?: true };
let clock = Date.parse('2026-10-23T08:00:00.000Z');
function draft(book: FlowBook, d: Draft): FlowFact {
  return {
    act: { verb: d.verb, occurred_at: new Date(clock += 60_000).toISOString(), observation: { source_id: d.source, sequence: d.sequence }, basis: d.basis ?? 'measured', references: d.references ?? [], evidence: [] },
    ledgers: d.ledgers.map(key => ({ key, expected_revision: d.stale ? 0 : book.ledgers[key]?.revision ?? 0, expected_digest: d.stale ? null : book.ledgers[key]?.head ?? null })),
    legs: d.legs ?? [], reservations: d.reservations ?? [], transform: d.transform ?? null, rights: d.rights ?? null, settles: d.settles ?? [],
  };
}
type Step = { why: string; fact: FlowFact };
type Opening = { kind: 'goods'; product_id: string; product: Pick<ProductBody, 'base_unit' | 'tracking'> } | { kind: 'money'; currency: string; account: string; balance: 'nonnegative' | 'signed' };
type Flow = { why: string; book_id: string; openings: Opening[]; steps: (book: FlowBook) => Step[]; bridge: string | null };
function open(book_id: string, openings: Opening[]): FlowBook {
  let book = openFlowBook(ORG, book_id);
  for (const o of openings) book = o.kind === 'goods' ? openGoodsLedger(book, o.product_id, o.product) : openMoneyLedger(book, o.currency, o.account, o.balance);
  return book;
}
const G = (root: string) => goodsLedgerKey(root), M = (account: string) => moneyLedgerKey('USD', account);

/** A co-packer's book: raw materials in, one batch out, custody and title to the carrier and the retailer, cash in and out, an offset. */
const plant: Flow = {
  why: 'a co-packer book: receipts, an atomic multi-ledger transform with yield loss, custody and title transfers, money paid and received with settlements, a signed credit line, an offset, and refusals that leave no trace',
  book_id: BOOK, bridge: SAUCE,
  openings: [
    { kind: 'goods', product_id: PEPPERS, product: product('kg', 'lot') }, { kind: 'goods', product_id: VINEGAR, product: product('L', 'none') },
    { kind: 'goods', product_id: JARS, product: product('{jar}', 'none') }, { kind: 'goods', product_id: SAUCE, product: product('{jar}', 'lot') },
    { kind: 'money', currency: 'USD', account: OPERATING, balance: 'nonnegative' }, { kind: 'money', currency: 'USD', account: CREDIT_LINE, balance: 'signed' },
  ],
  steps: () => [],
};
const plantSteps: [string, (b: FlowBook) => FlowFact][] = [
  ['receive fifty kilograms of peppers, lot P1, at the dock', b => draft(b, { verb: 'move', source: 'dock', sequence: 1, ledgers: [G(PEPPERS)], legs: [leg(goods(PEPPERS), outside('~supplier'), at(own(DOCK), 'P1'), q('50', ucum('kg')))] })],
  ['receive vinegar and jars in one fact: two ledgers, one compare-and-set each', b => draft(b, { verb: 'move', source: 'dock', sequence: 2, ledgers: [G(VINEGAR), G(JARS)], legs: [leg(goods(VINEGAR), outside('~supplier'), at(own(DOCK)), q('100', ucum('L'))), leg(goods(JARS), outside('~supplier'), at(own(DOCK)), q('2000', ucum('{jar}')))] })],
  ['REFUSED invalid: a transform with no output', b => draft(b, { verb: 'transform', source: 'kettle', sequence: 1, ledgers: [G(PEPPERS)], legs: [leg(goods(PEPPERS), at(own(DOCK), 'P1'), outside('~production'), q('48', ucum('kg')))], transform: { recipe: own(RECIPE), yield_loss: [], equipment: [] } })],
  ['REFUSED wrong_scope: a transform that does not name every ledger it changes', b => draft(b, { verb: 'transform', source: 'kettle', sequence: 1, ledgers: [G(PEPPERS), G(VINEGAR), G(JARS)], legs: [leg(goods(PEPPERS), at(own(DOCK), 'P1'), outside('~production'), q('48', ucum('kg'))), leg(goods(SAUCE), outside('~production'), at(own(DOCK), 'S1'), q('2000', ucum('{jar}')))], transform: { recipe: own(RECIPE), yield_loss: [], equipment: [] } })],
  ['transform peppers, vinegar and jars into two thousand jars of sauce lot S1, atomically across four ledgers, with two kilograms of pepper lost', b => draft(b, { verb: 'transform', source: 'kettle', sequence: 1, ledgers: [G(PEPPERS), G(VINEGAR), G(JARS), G(SAUCE)], legs: [
    leg(goods(PEPPERS), at(own(DOCK), 'P1'), outside('~production'), q('50', ucum('kg'))), leg(goods(VINEGAR), at(own(DOCK)), outside('~production'), q('100', ucum('L'))),
    leg(goods(JARS), at(own(DOCK)), outside('~production'), q('2000', ucum('{jar}'))), leg(goods(SAUCE), outside('~production'), at(own(DOCK), 'S1'), q('2000', ucum('{jar}')))],
    transform: { recipe: own(RECIPE), yield_loss: [{ product: PEPPERS, quantity: q('2', ucum('kg')), reason: 'stems and trim' }], equipment: [own(KETTLE)] } })],
  ['REFUSED invalid: a yield loss of something that was not an input', b => draft(b, { verb: 'transform', source: 'kettle', sequence: 2, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), outside('~production'), q('1', ucum('{jar}'))), leg(goods(SAUCE), outside('~production'), at(own(DOCK), 'S2'), q('1', ucum('{jar}')))], transform: { recipe: null, yield_loss: [{ product: VINEGAR, quantity: q('1', ucum('L')), reason: 'spill' }], equipment: [] } })],
  ['REFUSED invalid: production legs outside a transform', b => draft(b, { verb: 'move', source: 'kettle', sequence: 2, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), outside('~production'), at(own(DOCK), 'S2'), q('1', ucum('{jar}')))] })],
  ['REFUSED revision_conflict: a fact that decided on the ledger before the transform', b => draft(b, { verb: 'move', source: 'wms', sequence: 1, ledgers: [G(SAUCE)], stale: true, legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(own(SHELF), 'S1'), q('10', ucum('{jar}')))] })],
  ['reserve three hundred jars on the dock for the retailer', b => draft(b, { verb: 'move', source: 'orders', sequence: 1, ledgers: [G(SAUCE)], reservations: [{ kind: 'reserve', reservation_id: 'po-5512', asset: goods(SAUCE), position: at(own(DOCK), 'S1'), quantity: q('300', ucum('{jar}')), party: own(RETAILER_PARTY) }] })],
  ['REFUSED insufficient_stock: a custody transfer of eighteen hundred jars when three hundred are reserved', b => draft(b, { verb: 'transfer', source: 'dock', sequence: 3, rights: ['custody'], ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(theirs(CARRIER, TRAILER), 'S1'), q('1800', ucum('{jar}')))] })],
  ['release the reservation: the order is shipped below', b => draft(b, { verb: 'move', source: 'orders', sequence: 2, ledgers: [G(SAUCE)], reservations: [{ kind: 'release', reservation_id: 'po-5512', asset: goods(SAUCE), position: at(own(DOCK), 'S1'), quantity: q('300', ucum('{jar}')), party: null }] })],
  ['transfer custody of twelve hundred jars to the carrier\'s trailer: the location changes, title does not', b => draft(b, { verb: 'transfer', source: 'dock', sequence: 3, rights: ['custody'], ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(theirs(CARRIER, TRAILER), 'S1'), q('1200', ucum('{jar}')))] })],
  ['REFUSED rights_mismatch: a transfer that says title but only moves the goods', b => draft(b, { verb: 'transfer', source: 'dock', sequence: 4, rights: ['title'], ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(theirs(CARRIER, TRAILER), 'S1'), q('1', ucum('{jar}')))] })],
  ['REFUSED rights_mismatch: a move that changes the owner', b => draft(b, { verb: 'move', source: 'dock', sequence: 4, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(theirs(CARRIER, TRAILER), 'S1'), at(theirs(CARRIER, TRAILER), 'S1', theirs(RETAILER, RETAILER_PARTY)), q('1', ucum('{jar}')))] })],
  ['transfer title and custody of one thousand jars to the retailer at its DC in one leg', b => draft(b, { verb: 'transfer', source: 'dock', sequence: 4, rights: ['title', 'custody'], ledgers: [G(SAUCE)], references: [own(INVOICE)], legs: [leg(goods(SAUCE), at(theirs(CARRIER, TRAILER), 'S1'), at(theirs(RETAILER, RETAILER_DC), 'S1', theirs(RETAILER, RETAILER_PARTY)), q('1000', ucum('{jar}')))] })],
  ['two hundred jars come back rejected: a status change at the carrier, still the company\'s', b => draft(b, { verb: 'move', source: 'dock', sequence: 5, basis: 'asserted', ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(theirs(CARRIER, TRAILER), 'S1'), at(theirs(CARRIER, TRAILER), 'S1', null, 'damaged'), q('200', ucum('{jar}')))] })],
  ['the retailer acknowledged receipt: the thousand jars leave the book to the customer', b => draft(b, { verb: 'move', source: 'dock', sequence: 6, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(theirs(RETAILER, RETAILER_DC), 'S1', theirs(RETAILER, RETAILER_PARTY)), outside('~customer'), q('1000', ucum('{jar}')))] })],
  ['receive a payment of 6,400 dollars into the operating account, settling part of the invoice', b => draft(b, { verb: 'transfer', source: 'bank', sequence: 1, rights: ['title'], ledgers: [M(OPERATING)], legs: [leg(money, outside('~counterparty'), at(own(OPERATING)), q('6400', usd))], settles: [settle(own(INVOICE), 'payment', '6400')] })],
  ['REFUSED rights_mismatch: money received recorded as a move', b => draft(b, { verb: 'move', source: 'bank', sequence: 2, ledgers: [M(OPERATING)], legs: [leg(money, outside('~counterparty'), at(own(OPERATING)), q('1', usd))] })],
  ['REFUSED insufficient_stock: paying ten thousand from an account that holds 6,400 and may not go negative', b => draft(b, { verb: 'transfer', source: 'bank', sequence: 2, rights: ['title'], ledgers: [M(OPERATING)], legs: [leg(money, at(own(OPERATING)), outside('~counterparty'), q('10000', usd))], settles: [settle(own(SUPPLIER_BILL), 'payment', '10000')] })],
  ['pay the supplier five thousand from the credit line, which may go negative', b => draft(b, { verb: 'transfer', source: 'bank', sequence: 2, rights: ['title'], ledgers: [M(CREDIT_LINE)], legs: [leg(money, at(own(CREDIT_LINE)), outside('~counterparty'), q('5000', usd))], settles: [settle(own(SUPPLIER_BILL), 'payment', '5000')] })],
  ['sweep four thousand from operating to the credit line: a move between the company\'s own accounts, two ledgers', b => draft(b, { verb: 'move', source: 'bank', sequence: 3, ledgers: [M(OPERATING), M(CREDIT_LINE)], legs: [leg(money, at(own(OPERATING)), at(own(CREDIT_LINE)), q('4000', usd))] })],
  ['REFUSED unit_mismatch: dollars counted in euros', b => draft(b, { verb: 'move', source: 'bank', sequence: 4, ledgers: [M(OPERATING), M(CREDIT_LINE)], legs: [leg(money, at(own(OPERATING)), at(own(CREDIT_LINE)), q('1', { ...usd, code: 'EUR' }))] })],
  ['an offset with no money: a promotion the company owes nets against the retailer\'s deduction', b => draft(b, { verb: 'transfer', source: 'ar', sequence: 1, rights: ['title'], ledgers: [], settles: [settle(own(PROMO_OWED), 'offset', '3000'), settle(own(PROMO_DEDUCTION), 'offset', '3000')] })],
  ['REFUSED invalid: an offset of a single claim', b => draft(b, { verb: 'transfer', source: 'ar', sequence: 2, rights: ['title'], ledgers: [], settles: [settle(own(PROMO_OWED), 'offset', '1')] })],
  ['REFUSED invalid: a payment settlement with no money in its currency', b => draft(b, { verb: 'transfer', source: 'ar', sequence: 2, rights: ['title'], ledgers: [], settles: [settle(own(INVOICE), 'payment', '1')] })],
  ['REFUSED ledger_unavailable: a product with no ledger in this book', b => draft(b, { verb: 'move', source: 'wms', sequence: 1, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), outside('~supplier'), at(own(DOCK)), q('1', ucum('{unit}')))] })],
  ['a count correction with a reason: two jars broken on the dock', b => draft(b, { verb: 'move', source: 'count', sequence: 1, basis: 'asserted', ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), outside('~adjustment'), q('2', ucum('{jar}')), { reason: 'cycle count: two jars broken' })] })],
  ['REFUSED stale_observation: sequence one from a source that has already reached one hundred', b => draft(b, { verb: 'move', source: 'audit', sequence: 1, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(own(SHELF), 'S1'), q('1', ucum('{jar}')))] })],
];
/** Serialized equipment in a second book: units move by serial; stock in another book is another ledger. */
const toolsSteps: [string, (b: FlowBook) => FlowFact][] = [
  ['receive two serialized fermenters', b => draft(b, { verb: 'move', source: 'wms', sequence: 1, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), outside('~supplier'), at(own(DOCK), "B1"), q('2', ucum('{unit}')), { serial_ids: ['FX-1', 'FX-2'] })] })],
  ['REFUSED serial_conflict: receiving a serial already in the ledger', b => draft(b, { verb: 'move', source: 'wms', sequence: 2, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), outside('~supplier'), at(own(DOCK), "B1"), q('1', ucum('{unit}')), { serial_ids: ['FX-2'] })] })],
  ['REFUSED tracking_mismatch: a serialized move without serials', b => draft(b, { verb: 'move', source: 'wms', sequence: 2, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), at(own(DOCK), "B1"), at(own(SHELF), "B1"), q('1', ucum('{unit}')))] })],
  ['consign one fermenter to a retailer: title passes, it stays on the company\'s shelf', b => draft(b, { verb: 'transfer', source: 'wms', sequence: 2, rights: ['title'], ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), at(own(DOCK), "B1"), at(own(DOCK), "B1", theirs(RETAILER, RETAILER_PARTY)), q('1', ucum('{unit}')), { serial_ids: ['FX-1'] })] })],
  ['move the consigned unit and the company\'s unit to the shelf by serial in one fact', b => draft(b, { verb: 'move', source: 'wms', sequence: 3, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), at(own(DOCK), "B1", theirs(RETAILER, RETAILER_PARTY)), at(own(SHELF), "B1", theirs(RETAILER, RETAILER_PARTY)), q('1', ucum('{unit}')), { serial_ids: ['FX-1'] }), leg(goods(FERMENTER), at(own(DOCK), "B1"), at(own(SHELF), "B1"), q('1', ucum('{unit}')), { serial_ids: ['FX-2'] })] })],
  ['reserve the company\'s own unit on the shelf: its position is now fully reserved', b => draft(b, { verb: 'move', source: 'orders', sequence: 1, ledgers: [G(FERMENTER)], reservations: [{ kind: 'reserve', reservation_id: 'so-77', asset: goods(FERMENTER), position: at(own(SHELF), 'B1'), quantity: q('1', ucum('{unit}')), party: own(RETAILER_PARTY) }] })],
  ['REFUSED insufficient_stock: shipping the reserved unit without settling its claim', b => draft(b, { verb: 'move', source: 'wms', sequence: 4, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), at(own(SHELF), 'B1'), outside('~customer'), q('1', ucum('{unit}')), { serial_ids: ['FX-2'] })] })],
  ['ship the fully reserved unit by serial and release its claim in one fact: the release settles before the leg (#85)', b => draft(b, { verb: 'move', source: 'orders', sequence: 2, ledgers: [G(FERMENTER)], legs: [leg(goods(FERMENTER), at(own(SHELF), 'B1'), outside('~customer'), q('1', ucum('{unit}')), { serial_ids: ['FX-2'] })], reservations: [{ kind: 'release', reservation_id: 'so-77', asset: goods(FERMENTER), position: at(own(SHELF), 'B1'), quantity: q('1', ucum('{unit}')), party: null }] })],
];
const tools: Flow = { why: 'a serialized product in a second book: units by serial, consignment as a title transfer that leaves the goods in place', book_id: TOOLS, bridge: FERMENTER, openings: [{ kind: 'goods', product_id: FERMENTER, product: product('{unit}', 'serial') }], steps: () => [] };

function run(flow: Flow, steps: [string, (b: FlowBook) => FlowFact][], extra: (b: FlowBook) => FlowFact[] = () => []) {
  let book = open(flow.book_id, flow.openings);
  const results: { why: string; fact: FlowFact; expect: { ok: true; duplicate: boolean } | { ok: false; code: string } }[] = [];
  const apply = (why: string, f: FlowFact) => {
    if (!validateShape(contract.schema, f)) throw new Error(`generator: fact fails the dialect schema: ${why}`);
    const r = applyFlowFact(book, structuredClone(f)), expect = r.ok ? { ok: true as const, duplicate: r.duplicate } : { ok: false as const, code: r.code };
    if (why.startsWith('REFUSED') === r.ok) throw new Error(`generator: "${why}" gave ${JSON.stringify(expect)}${r.ok ? '' : ': ' + r.message}`);
    if (why.startsWith('DUPLICATE') !== (r.ok && r.duplicate)) throw new Error(`generator: duplicate expectation failed for "${why}"`);
    if (!r.ok && !why.includes(r.code)) throw new Error(`generator: "${why}" refused with ${r.code}: ${r.message}`);
    if (r.ok) book = r.state;
    results.push({ why, fact: f, expect });
  };
  for (const [why, make] of steps) {
    if (why.startsWith('REFUSED stale_observation')) apply('a source that starts at sequence one hundred: a move to the shelf', draft(book, { verb: 'move', source: 'audit', sequence: 100, ledgers: [G(SAUCE)], legs: [leg(goods(SAUCE), at(own(DOCK), 'S1'), at(own(SHELF), 'S1'), q('10', ucum('{jar}')))] }));
    apply(why, make(book));
  }
  if (flow === plant) {
    apply('DUPLICATE: the first receipt presented again, byte for byte', results[0].fact);
    apply('REFUSED observation_conflict: the same source and sequence with a different fact', { ...results[0].fact, legs: [leg(goods(PEPPERS), outside('~supplier'), at(own(DOCK), 'P1'), q('49', ucum('kg')))] });
  }
  return { why: flow.why, book_id: flow.book_id, openings: flow.openings, facts: results, final: book, bridge: flow.bridge === null ? null : { product_id: flow.bridge, projection: projectInventory2(book, flow.bridge) } };
}
const out = {
  description: 'dtp/flow@1 fixtures. For each flow a conforming reducer, starting from an empty book for the organization with the listed ledgers opened in order, MUST reach exactly the expected outcome for every fact in order (an accepted fact advances every ledger it names by one revision and sets each one\'s head to the fact\'s digest; a refused or duplicate fact leaves the book unchanged; refusal codes are normative), MUST end at exactly the final book, and MUST project the stated inventory@2 view of the bridged product.',
  kind: FLOW_KIND, profile: FLOW_PROFILE, semantics: FLOW_SEMANTICS, observation_window: OBSERVATION_WINDOW, contract_digest: await digest(contract), organization_id: ORG,
  flows: [run(plant, plantSteps), run(tools, toolsSteps)],
};
const dir = new URL('../../spec/profiles/flow/1/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [target, text] of [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('flow@1:', out.contract_digest, out.flows.map(f => `${f.facts.length} facts`).join(', '));
