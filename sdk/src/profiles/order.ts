/** dtp/order@1: an order as one company records it, a binding commercial commitment by the party that placed it.
 * A forecast or a plan is never an order; those are dtp/forecast@1. Portable, dependency-free, synchronous.
 * Profile document and fixtures: spec/profiles/order/1.md, spec/profiles/order/1/. */
import { canonicalize } from '../canonical.ts';
import { parseDecimal } from './decimal.ts';
import type { WireUnit } from './inventory2.ts';

export const ORDER_PROFILE = 'dtp.order/1';
export const ORDER_KIND = 'dtp/order@1';
export const ORDER_SEMANTICS = 'order-v1';
export const ORDER_STATUSES = ['placed', 'acknowledged', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled', 'closed'] as const;
/** Who may move an order where. Every writer is the owning company; the roles say which party's act the revision records. */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  placed: ['acknowledged', 'rejected', 'cancelled'], acknowledged: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['partially_fulfilled', 'fulfilled', 'cancelled'], fulfilled: ['closed'], rejected: [], cancelled: [], closed: [],
};
export const MAX_ORDER_LINES = 256;
export type OrderStatus = typeof ORDER_STATUSES[number];
/** One of buyer and seller is the owning company itself; the other is a party the company recorded. */
export type PartyRole = { self: boolean; party_id: string | null; revision: string | null };
export type Money = { amount: string; currency: string };
export type OrderLine = {
  line_id: string; product: { product_id: string | null; revision: string | null; description: string | null };
  quantity: { amount: string; unit: WireUnit }; price: Money | null; requested: { start: string; end: string } | null; links: { contract_id: string | null };
};
export type OrderBody = {
  buyer: PartyRole; seller: PartyRole; placed_at: string; currency: string; external: { scheme: string; value: string }[];
  lines: OrderLine[]; status: OrderStatus; terms: { payment_net_days: number | null; incoterm: string | null }; replaces: string | null;
};
export type OrderIssue = { path: string; message: string };
const role = { type: 'object', additionalProperties: false, required: ['self', 'party_id', 'revision'], properties: { self: { type: 'boolean' }, party_id: { type: 'string', maxLength: 36, nullable: true }, revision: { type: 'string', maxLength: 36, nullable: true } } };
const unit = { type: 'object', additionalProperties: false, required: ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'], properties: { system: { type: 'string', maxLength: 9, enum: ['ucum', 'packaging'] }, code: { type: 'string', maxLength: 32, nullable: true }, packaging_id: { type: 'string', maxLength: 80, nullable: true }, version: { type: 'string', maxLength: 40, nullable: true }, base_units_per_pack: { type: 'string', maxLength: 24, nullable: true } } };
export const ORDER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['buyer', 'seller', 'placed_at', 'currency', 'external', 'lines', 'status', 'terms', 'replaces'],
  properties: {
    buyer: role, seller: role, placed_at: { type: 'string', maxLength: 24 }, currency: { type: 'string', maxLength: 8 },
    external: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['scheme', 'value'], properties: { scheme: { type: 'string', maxLength: 64 }, value: { type: 'string', maxLength: 128 } } } },
    lines: { type: 'array', maxItems: MAX_ORDER_LINES, items: { type: 'object', additionalProperties: false, required: ['line_id', 'product', 'quantity', 'price', 'requested', 'links'], properties: {
      line_id: { type: 'string', maxLength: 80 },
      product: { type: 'object', additionalProperties: false, required: ['product_id', 'revision', 'description'], properties: { product_id: { type: 'string', maxLength: 36, nullable: true }, revision: { type: 'string', maxLength: 36, nullable: true }, description: { type: 'string', maxLength: 500, nullable: true } } },
      quantity: { type: 'object', additionalProperties: false, required: ['amount', 'unit'], properties: { amount: { type: 'string', maxLength: 24 }, unit } },
      price: { type: 'object', additionalProperties: false, required: ['amount', 'currency'], properties: { amount: { type: 'string', maxLength: 28 }, currency: { type: 'string', maxLength: 8 } }, nullable: true },
      requested: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'string', maxLength: 10 }, end: { type: 'string', maxLength: 10 } }, nullable: true },
      links: { type: 'object', additionalProperties: false, required: ['contract_id'], properties: { contract_id: { type: 'string', maxLength: 36, nullable: true } } } } } },
    status: { type: 'string', maxLength: 20, enum: [...ORDER_STATUSES] },
    terms: { type: 'object', additionalProperties: false, required: ['payment_net_days', 'incoterm'], properties: { payment_net_days: { type: 'integer', minimum: 0, maximum: 365, nullable: true }, incoterm: { type: 'string', maxLength: 3, nullable: true } } },
    replaces: { type: 'string', maxLength: 36, nullable: true },
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCHEME = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/, CURRENCY = /^[A-Z]{3,8}$/, INCOTERM = /^[A-Z]{3}$/, UCUM = /^[!-~]{1,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuidOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
export function isLocalDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10)), leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
export const isInstant = (v: unknown): boolean => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(v) && isLocalDate(v.slice(0, 10)) && new Date(v).toISOString() === v;
function checkUnit(u: unknown, path: string, fail: (p: string, m: string) => void) {
  if (!isObject(u) || !exact(u, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) return fail(path, 'exact unit fields required');
  if (u.system === 'ucum') { if (!(typeof u.code === 'string' && UCUM.test(u.code)) || u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) fail(path, 'ucum unit carries a code and no packaging'); return; }
  if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) return fail(path, 'packaging unit needs packaging_id and version');
  try { if (parseDecimal(u.base_units_per_pack, 3) <= 0n) fail(path, 'positive pack conversion required'); } catch { fail(path, 'three-place pack conversion required'); }
}
function checkRole(r: unknown, path: string, fail: (p: string, m: string) => void): boolean {
  if (!isObject(r) || !exact(r, ['self', 'party_id', 'revision']) || typeof r.self !== 'boolean' || !uuidOrNull(r.party_id) || !uuidOrNull(r.revision)) { fail(path, 'self flag, party root or null, revision or null required'); return false; }
  if (r.self && (r.party_id !== null || r.revision !== null)) fail(path, 'the company itself has no party record');
  if (!r.self && r.party_id === null) fail(path, 'a counterparty names its party record');
  return r.self as boolean;
}
/** Every rule of the profile beyond shape. Returns an empty list for a conforming order body. */
export function validateOrder(body: unknown): OrderIssue[] {
  const issues: OrderIssue[] = [], fail = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(body) || !exact(body, [...ORDER_SCHEMA.required])) return [{ path: '$', message: 'exact order fields required' }];
  const b = body as unknown as OrderBody;
  const buyerSelf = checkRole(b.buyer, '$.buyer', fail), sellerSelf = checkRole(b.seller, '$.seller', fail);
  if (buyerSelf === sellerSelf) fail('$', 'exactly one of buyer and seller is the company itself');
  if (!isInstant(b.placed_at)) fail('$.placed_at', 'UTC millisecond instant required');
  if (!(typeof b.currency === 'string' && CURRENCY.test(b.currency))) fail('$.currency', 'currency code required');
  if (!Array.isArray(b.external) || b.external.length > 16) fail('$.external', 'at most 16 external identifiers');
  else {
    const seen = new Set<string>();
    b.external.forEach((id, i) => {
      if (!isObject(id) || !exact(id, ['scheme', 'value'])) return fail(`$.external[${i}]`, 'scheme and value required');
      if (!(typeof id.scheme === 'string' && id.scheme.length <= 64 && SCHEME.test(id.scheme))) fail(`$.external[${i}].scheme`, 'namespaced scheme required');
      if (!text(id.value, 128)) fail(`$.external[${i}].value`, 'bounded nonempty value required');
      const key = canonicalize([id.scheme, id.value]); if (seen.has(key)) fail(`$.external[${i}]`, 'duplicate identifier'); seen.add(key);
    });
  }
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > MAX_ORDER_LINES) fail('$.lines', `1-${MAX_ORDER_LINES} lines required`);
  else {
    const seen = new Set<string>();
    b.lines.forEach((l, i) => {
      const path = `$.lines[${i}]`;
      if (!isObject(l) || !exact(l, ['line_id', 'product', 'quantity', 'price', 'requested', 'links'])) return fail(path, 'exact line fields required');
      if (!text(l.line_id, 80)) fail(`${path}.line_id`, 'bounded line id required');
      if (seen.has(l.line_id)) fail(path, 'duplicate line id'); seen.add(l.line_id);
      const p = l.product;
      if (!isObject(p) || !exact(p, ['product_id', 'revision', 'description']) || !uuidOrNull(p.product_id) || !uuidOrNull(p.revision) || (p.description !== null && !text(p.description, 500))) fail(`${path}.product`, 'product root, revision and description, each or null, required');
      else { if (p.product_id === null && p.description === null) fail(`${path}.product`, 'a product root or a description is required'); if (p.product_id === null && p.revision !== null) fail(`${path}.product.revision`, 'a revision needs its product root'); }
      if (!isObject(l.quantity) || !exact(l.quantity, ['amount', 'unit'])) fail(`${path}.quantity`, 'amount and unit required');
      else { try { if (parseDecimal(l.quantity.amount, 3) <= 0n) fail(`${path}.quantity.amount`, 'positive quantity required'); } catch { fail(`${path}.quantity.amount`, 'three-place decimal required'); } checkUnit(l.quantity.unit, `${path}.quantity.unit`, fail); }
      if (l.price !== null) {
        if (!isObject(l.price) || !exact(l.price, ['amount', 'currency'])) fail(`${path}.price`, 'amount and currency required');
        else { try { parseDecimal(l.price.amount, 6); } catch { fail(`${path}.price.amount`, 'six-place decimal required'); } if (l.price.currency !== b.currency) fail(`${path}.price.currency`, 'line currency must be the order currency'); }
      }
      if (l.requested !== null) {
        if (!isObject(l.requested) || !exact(l.requested, ['start', 'end']) || !isLocalDate(l.requested.start) || !isLocalDate(l.requested.end)) fail(`${path}.requested`, 'start and end dates required');
        else if (l.requested.start > l.requested.end) fail(`${path}.requested`, 'window ends before it starts');
      }
      if (!isObject(l.links) || !exact(l.links, ['contract_id']) || !uuidOrNull(l.links.contract_id)) fail(`${path}.links`, 'contract root or null required');
    });
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(b.status)) fail('$.status', 'unknown status');
  if (!isObject(b.terms) || !exact(b.terms, ['payment_net_days', 'incoterm'])) fail('$.terms', 'payment_net_days and incoterm required');
  else {
    if (b.terms.payment_net_days !== null && !(Number.isSafeInteger(b.terms.payment_net_days) && b.terms.payment_net_days >= 0 && b.terms.payment_net_days <= 365)) fail('$.terms.payment_net_days', '0-365 or null required');
    if (b.terms.incoterm !== null && !(typeof b.terms.incoterm === 'string' && INCOTERM.test(b.terms.incoterm))) fail('$.terms.incoterm', 'three-letter incoterm or null required');
  }
  if (!uuidOrNull(b.replaces)) fail('$.replaces', 'replaced order root or null required');
  return issues;
}
/** Genesis: an order is born placed. Revisions: parties, placing time, currency and the replaced order never change;
 *  the status follows the transition table; once acknowledged, lines and terms are frozen (a change is a new order
 *  that replaces this one); external identifiers may be added, never removed. Both bodies are assumed valid. */
export function checkOrderGenesis(body: OrderBody): OrderIssue[] { return body.status === 'placed' ? [] : [{ path: '$.status', message: 'an order is born placed' }]; }
export function checkOrderContinuity(previous: OrderBody, next: OrderBody): OrderIssue[] {
  const issues: OrderIssue[] = [], same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
  for (const key of ['buyer', 'seller', 'placed_at', 'currency', 'replaces'] as const) if (!same(previous[key], next[key])) issues.push({ path: `$.${key}`, message: `${key} is immutable` });
  if (previous.status !== next.status && !(ORDER_TRANSITIONS[previous.status] ?? []).includes(next.status)) issues.push({ path: '$.status', message: `no transition from ${previous.status} to ${next.status}` });
  if (previous.status !== 'placed') {
    if (!same(previous.lines, next.lines)) issues.push({ path: '$.lines', message: 'lines are frozen once acknowledged; a change is a new order that replaces this one' });
    if (!same(previous.terms, next.terms)) issues.push({ path: '$.terms', message: 'terms are frozen once acknowledged' });
  }
  const kept = new Set(next.external.map(e => canonicalize([e.scheme, e.value])));
  previous.external.forEach((e, i) => { if (!kept.has(canonicalize([e.scheme, e.value]))) issues.push({ path: `$.external[${i}]`, message: 'an external identifier is never removed' }); });
  return issues;
}
