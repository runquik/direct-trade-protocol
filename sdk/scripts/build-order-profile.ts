// Builds spec/profiles/order/1/profile.json and fixtures.json from the reference rules. Deterministic; `--check` compares.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { ORDER_KIND, ORDER_PROFILE, ORDER_SCHEMA, ORDER_SEMANTICS, checkOrderContinuity, checkOrderGenesis, validateOrder } from '../src/profiles/order.ts';
import type { OrderBody, OrderLine } from '../src/profiles/order.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'order', version: '1.0.0', schema: structuredClone(ORDER_SCHEMA) as Record<string, any>, semantics: ORDER_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const clone = <V>(v: V): V => structuredClone(v);
const SUPPLIER = '77777777-7777-4777-8777-777777777777', PRODUCT = '22222222-2222-4222-8222-222222222222', REVISION = '99999999-9999-4999-8999-999999999999', CONTRACT = '55555555-5555-4555-8555-555555555555', OLD = '66666666-6666-4666-8666-666666666666';
const jar = { system: 'ucum' as const, code: '{jar}', packaging_id: null, version: null, base_units_per_pack: null };
const cases = { system: 'packaging' as const, code: null, packaging_id: 'case-12', version: '1', base_units_per_pack: '12' };
const line = (line_id: string, extra: Partial<OrderLine> = {}): OrderLine => ({ line_id, product: { product_id: PRODUCT, revision: REVISION, description: null }, quantity: { amount: '10', unit: cases }, price: { amount: '48.500000', currency: 'USD' }, requested: { start: '2026-10-01', end: '2026-10-07' }, links: { contract_id: null }, ...extra });
const base: OrderBody = {
  buyer: { self: true, party_id: null, revision: null }, seller: { self: false, party_id: SUPPLIER, revision: null },
  placed_at: '2026-09-23T09:15:00.000Z', currency: 'USD', external: [{ scheme: 'buyer.po', value: 'PO-4471' }],
  lines: [line('1'), line('2', { product: { product_id: null, revision: null, description: 'Pallet wrap, 500 mm' }, quantity: { amount: '3', unit: { system: 'ucum', code: '{roll}', packaging_id: null, version: null, base_units_per_pack: null } }, price: null, requested: null })],
  status: 'placed', terms: { payment_net_days: 30, incoterm: 'FOB' }, replaces: null,
};
const change = (edit: (b: OrderBody) => void, from: OrderBody = base): OrderBody => { const b = clone(from); edit(b); return b; };
type Case = [string, unknown];
const accept: Case[] = [
  ['a purchase order the company placed with a supplier: two lines, one by product revision in cases, one by description', base],
  ['a sales order a customer placed with the company, recorded by the company as seller', change(b => { b.buyer = { self: false, party_id: SUPPLIER, revision: null }; b.seller = { self: true, party_id: null, revision: null }; b.external = []; })],
  ['the minimum: one line by description, no price, no window, no terms', { buyer: { self: true, party_id: null, revision: null }, seller: { self: false, party_id: SUPPLIER, revision: null }, placed_at: '2026-09-23T09:15:00.000Z', currency: 'EUR', external: [], lines: [line('only', { product: { product_id: null, revision: null, description: 'Consulting day' }, quantity: { amount: '1', unit: { system: 'ucum', code: '{day}', packaging_id: null, version: null, base_units_per_pack: null } }, price: null, requested: null })], status: 'placed', terms: { payment_net_days: null, incoterm: null }, replaces: null }],
  ['an order that replaces an earlier one and cites a contract', change(b => { b.replaces = OLD; b.lines[0].links.contract_id = CONTRACT; })],
  ['an acknowledged order, as a later revision would carry it', change(b => { b.status = 'acknowledged'; })],
];
const reject: Case[] = [
  ['both parties the company itself', change(b => { b.seller = { self: true, party_id: null, revision: null }; })],
  ['neither party the company itself', change(b => { b.buyer = { self: false, party_id: OLD, revision: null }; })],
  ['the company itself with a party record', change(b => { b.buyer.party_id = SUPPLIER; })],
  ['a counterparty without a party record', change(b => { b.seller.party_id = null; })],
  ['a placing time that is not a UTC instant', change(b => { b.placed_at = '2026-09-23'; })],
  ['a lowercase currency', change(b => { b.currency = 'usd'; })],
  ['no lines', change(b => { b.lines = []; })],
  ['two lines with one id', change(b => { b.lines[1].line_id = '1'; })],
  ['a line with neither product nor description', change(b => { b.lines[1].product = { product_id: null, revision: null, description: null }; })],
  ['a product revision without its root', change(b => { b.lines[1].product = { product_id: null, revision: REVISION, description: 'x' }; })],
  ['a zero quantity', change(b => { b.lines[0].quantity.amount = '0'; })],
  ['a quantity with four places', change(b => { b.lines[0].quantity.amount = '1.0001'; })],
  ['a price in another currency', change(b => { b.lines[0].price = { amount: '1', currency: 'EUR' }; })],
  ['a price with seven places', change(b => { b.lines[0].price = { amount: '1.0000001', currency: 'USD' }; })],
  ['a window that ends before it starts', change(b => { b.lines[0].requested = { start: '2026-10-07', end: '2026-10-01' }; })],
  ['a window with an impossible date', change(b => { b.lines[0].requested = { start: '2026-02-30', end: '2026-03-01' }; })],
  ['an unknown status', change(b => { (b as any).status = 'draft'; })],
  ['a payment term beyond a year', change(b => { b.terms.payment_net_days = 400; })],
  ['an incoterm that is not three letters', change(b => { b.terms.incoterm = 'Free on board'; })],
  ['a duplicate external identifier', change(b => { b.external.push({ scheme: 'buyer.po', value: 'PO-4471' }); })],
  ['an extra member', change(b => { (b as any).forecast = true; })],
  ['a missing member', (() => { const { terms: _, ...rest } = clone(base); return rest; })()],
];
type Pair = [string, OrderBody, OrderBody];
const acknowledged = change(b => { b.status = 'acknowledged'; });
const genesisAccept: [string, OrderBody][] = [['an order is born placed', base]];
const genesisReject: [string, OrderBody][] = [['an order cannot be born acknowledged', acknowledged], ['nor closed', change(b => { b.status = 'closed'; })]];
const continuityAccept: Pair[] = [
  ['edited while placed: a line added and a term changed', base, change(b => { b.lines.push(line('3')); b.terms.payment_net_days = 45; })],
  ['acknowledged by the seller', base, acknowledged],
  ['rejected', base, change(b => { b.status = 'rejected'; })],
  ['cancelled while placed', base, change(b => { b.status = 'cancelled'; })],
  ['partially fulfilled, then again, then fulfilled, then closed: the seller\'s own identifier learned on the way', acknowledged, change(b => { b.status = 'partially_fulfilled'; b.external.push({ scheme: 'seller.so', value: 'SO-9' }); }, acknowledged)],
  ['fulfilled from partially fulfilled', change(b => { b.status = 'partially_fulfilled'; }), change(b => { b.status = 'fulfilled'; })],
  ['fulfilled straight from acknowledged', acknowledged, change(b => { b.status = 'fulfilled'; })],
  ['cancelled after acknowledgment', acknowledged, change(b => { b.status = 'cancelled'; })],
  ['cancelled after partial fulfilment', change(b => { b.status = 'partially_fulfilled'; }), change(b => { b.status = 'cancelled'; })],
  ['a second partial fulfilment', change(b => { b.status = 'partially_fulfilled'; }), change(b => { b.status = 'partially_fulfilled'; b.external.push({ scheme: 'seller.so', value: 'SO-9' }); })],
  ['closed from fulfilled', change(b => { b.status = 'fulfilled'; }), change(b => { b.status = 'closed'; })],
];
const continuityReject: Pair[] = [
  ['a changed buyer', base, change(b => { b.buyer = { self: false, party_id: OLD, revision: null }; b.seller = { self: true, party_id: null, revision: null }; })],
  ['a changed placing time', base, change(b => { b.placed_at = '2026-09-23T09:16:00.000Z'; })],
  ['a changed currency', base, change(b => { b.currency = 'EUR'; b.lines[0].price = { amount: '48.500000', currency: 'EUR' }; })],
  ['a changed replaced order', base, change(b => { b.replaces = OLD; })],
  ['lines changed after acknowledgment: a change is a new order', acknowledged, change(b => { b.lines[0].quantity.amount = '11'; }, acknowledged)],
  ['terms changed after acknowledgment', acknowledged, change(b => { b.terms.payment_net_days = 60; }, acknowledged)],
  ['an external identifier removed', base, change(b => { b.external = []; })],
  ['placed straight to fulfilled', base, change(b => { b.status = 'fulfilled'; })],
  ['acknowledged back to placed', acknowledged, base],
  ['closed reopened', change(b => { b.status = 'closed'; }), change(b => { b.status = 'acknowledged'; })],
  ['rejected then acknowledged', change(b => { b.status = 'rejected'; }), acknowledged],
];
for (const [why, body] of accept) { if (!validateShape(contract.schema, body)) throw new Error(`generator: dialect refuses "${why}"`); const i = validateOrder(body); if (i.length) throw new Error(`generator: refused "${why}": ${i[0].message} at ${i[0].path}`); }
for (const [why, body] of reject) if (validateOrder(body).length === 0) throw new Error(`generator: accepted "${why}"`);
for (const [why, body] of genesisAccept) if (checkOrderGenesis(body).length) throw new Error(`generator: genesis refused "${why}"`);
for (const [why, body] of genesisReject) if (checkOrderGenesis(body).length === 0) throw new Error(`generator: genesis accepted "${why}"`);
for (const [why, a, b] of continuityAccept) { const i = checkOrderContinuity(a, b); if (i.length) throw new Error(`generator: continuity refused "${why}": ${i[0].message}`); }
for (const [why, a, b] of continuityReject) if (checkOrderContinuity(a, b).length === 0) throw new Error(`generator: continuity accepted "${why}"`);
const out = {
  description: 'dtp/order@1 fixtures. A conforming validator MUST accept every body under "accept" and refuse every body under "reject"; it MUST accept a genesis only when "genesis.accept" says so; given a previous and a next revision of one order it MUST accept every pair under "continuity.accept" and refuse every pair under "continuity.reject". Refusal reasons are not normative. An order is a binding commercial commitment: a forecast or a plan is never an order.',
  kind: ORDER_KIND, profile: ORDER_PROFILE, semantics: ORDER_SEMANTICS, contract_digest: await digest(contract),
  accept: accept.map(([why, body]) => ({ why, body })), reject: reject.map(([why, body]) => ({ why, body })),
  genesis: { accept: genesisAccept.map(([why, body]) => ({ why, body })), reject: genesisReject.map(([why, body]) => ({ why, body })) },
  continuity: { accept: continuityAccept.map(([why, previous, next]) => ({ why, previous, next })), reject: continuityReject.map(([why, previous, next]) => ({ why, previous, next })) },
};
const dir = new URL('../../spec/profiles/order/1/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [target, text] of [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('order@1:', out.contract_digest, accept.length, 'accept,', reject.length, 'reject,', continuityAccept.length + continuityReject.length, 'continuity cases');
