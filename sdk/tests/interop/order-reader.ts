// Deliberately separate implementation of dtp/order@1, written from spec/profiles/order/1.md and its fixtures.
// Do not import the SDK validator, decimal helpers or canonicalizer here. Same author: separately coded agreement.
import { readerCanonical } from './product-reader.ts';

export type Issue = { path: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const uuidOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
const decimal = (v: unknown, places: number) => typeof v === 'string' && new RegExp(`^\\d{1,18}(\\.\\d{1,${places}})?$`).test(v);
export const dateValid = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000')) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
export const instantValid = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && new Date(v).toISOString() === v;
export function unitIssue(u: unknown): string | null {
  if (!plain(u) || !keysAre(u, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) return 'unit';
  if (u.system === 'ucum') return typeof u.code === 'string' && /^[!-~]{1,32}$/.test(u.code) && u.packaging_id === null && u.version === null && u.base_units_per_pack === null ? null : 'ucum';
  if (u.system !== 'packaging' || u.code !== null || !bounded(u.packaging_id, 80) || !bounded(u.version, 40) || !decimal(u.base_units_per_pack, 3) || Number(u.base_units_per_pack) <= 0) return 'packaging';
  return null;
}
const TRANSITIONS: Record<string, string[]> = { placed: ['acknowledged', 'rejected', 'cancelled'], acknowledged: ['partially_fulfilled', 'fulfilled', 'cancelled'], partially_fulfilled: ['partially_fulfilled', 'fulfilled', 'cancelled'], fulfilled: ['closed'], rejected: [], cancelled: [], closed: [] };
const STATUSES = Object.keys(TRANSITIONS);

export function readOrder(body: unknown): Issue[] {
  const out: Issue[] = [], bad = (path: string, message: string) => out.push({ path, message });
  if (!plain(body) || !keysAre(body, ['buyer', 'seller', 'placed_at', 'currency', 'external', 'lines', 'status', 'terms', 'replaces'])) return [{ path: '$', message: 'exact fields' }];
  const b = body;
  const role = (r: any, path: string): boolean => {
    if (!plain(r) || !keysAre(r, ['self', 'party_id', 'revision']) || typeof r.self !== 'boolean' || !uuidOrNull(r.party_id) || !uuidOrNull(r.revision)) { bad(path, 'role'); return false; }
    if (r.self && (r.party_id !== null || r.revision !== null)) bad(path, 'self has no party');
    if (!r.self && r.party_id === null) bad(path, 'counterparty needs party');
    return r.self;
  };
  const bs = role(b.buyer, '$.buyer'), ss = role(b.seller, '$.seller');
  if (bs === ss) bad('$', 'exactly one self');
  if (!instantValid(b.placed_at)) bad('$.placed_at', 'instant');
  if (!(typeof b.currency === 'string' && /^[A-Z]{3,8}$/.test(b.currency))) bad('$.currency', 'currency');
  if (!Array.isArray(b.external) || b.external.length > 16) bad('$.external', 'external');
  else {
    const seen = new Set<string>();
    b.external.forEach((e: any, i: number) => {
      if (!plain(e) || !keysAre(e, ['scheme', 'value'])) return bad(`$.external[${i}]`, 'identifier');
      if (!(typeof e.scheme === 'string' && e.scheme.length <= 64 && /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(e.scheme))) bad(`$.external[${i}].scheme`, 'scheme');
      if (!bounded(e.value, 128)) bad(`$.external[${i}].value`, 'value');
      const k = readerCanonical([e.scheme, e.value]); if (seen.has(k)) bad(`$.external[${i}]`, 'duplicate'); seen.add(k);
    });
  }
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 256) bad('$.lines', 'lines');
  else {
    const seen = new Set<string>();
    b.lines.forEach((l: any, i: number) => {
      const path = `$.lines[${i}]`;
      if (!plain(l) || !keysAre(l, ['line_id', 'product', 'quantity', 'price', 'requested', 'links'])) return bad(path, 'line');
      if (!bounded(l.line_id, 80)) bad(`${path}.line_id`, 'id');
      if (seen.has(l.line_id)) bad(path, 'duplicate'); seen.add(l.line_id);
      const p = l.product;
      if (!plain(p) || !keysAre(p, ['product_id', 'revision', 'description']) || !uuidOrNull(p.product_id) || !uuidOrNull(p.revision) || (p.description !== null && !bounded(p.description, 500))) bad(`${path}.product`, 'product');
      else { if (p.product_id === null && p.description === null) bad(`${path}.product`, 'root or description'); if (p.product_id === null && p.revision !== null) bad(`${path}.product.revision`, 'revision needs root'); }
      if (!plain(l.quantity) || !keysAre(l.quantity, ['amount', 'unit'])) bad(`${path}.quantity`, 'quantity');
      else { if (!decimal(l.quantity.amount, 3) || Number(l.quantity.amount) <= 0) bad(`${path}.quantity.amount`, 'amount'); if (unitIssue(l.quantity.unit)) bad(`${path}.quantity.unit`, 'unit'); }
      if (l.price !== null) {
        if (!plain(l.price) || !keysAre(l.price, ['amount', 'currency'])) bad(`${path}.price`, 'price');
        else { if (!decimal(l.price.amount, 6)) bad(`${path}.price.amount`, 'money'); if (l.price.currency !== b.currency) bad(`${path}.price.currency`, 'currency'); }
      }
      if (l.requested !== null) {
        if (!plain(l.requested) || !keysAre(l.requested, ['start', 'end']) || !dateValid(l.requested.start) || !dateValid(l.requested.end)) bad(`${path}.requested`, 'window');
        else if (l.requested.start > l.requested.end) bad(`${path}.requested`, 'order of dates');
      }
      if (!plain(l.links) || !keysAre(l.links, ['contract_id']) || !uuidOrNull(l.links.contract_id)) bad(`${path}.links`, 'links');
    });
  }
  if (!STATUSES.includes(b.status)) bad('$.status', 'status');
  if (!plain(b.terms) || !keysAre(b.terms, ['payment_net_days', 'incoterm'])) bad('$.terms', 'terms');
  else {
    if (b.terms.payment_net_days !== null && !(Number.isSafeInteger(b.terms.payment_net_days) && b.terms.payment_net_days >= 0 && b.terms.payment_net_days <= 365)) bad('$.terms.payment_net_days', 'net days');
    if (b.terms.incoterm !== null && !(typeof b.terms.incoterm === 'string' && /^[A-Z]{3}$/.test(b.terms.incoterm))) bad('$.terms.incoterm', 'incoterm');
  }
  if (!uuidOrNull(b.replaces)) bad('$.replaces', 'replaces');
  return out;
}
export const readOrderGenesis = (body: any): Issue[] => body.status === 'placed' ? [] : [{ path: '$.status', message: 'born placed' }];
export function readOrderContinuity(previous: any, next: any): Issue[] {
  const out: Issue[] = [], same = (a: unknown, b: unknown) => readerCanonical(a) === readerCanonical(b);
  for (const k of ['buyer', 'seller', 'placed_at', 'currency', 'replaces']) if (!same(previous[k], next[k])) out.push({ path: `$.${k}`, message: 'immutable' });
  if (previous.status !== next.status && !(TRANSITIONS[previous.status] ?? []).includes(next.status)) out.push({ path: '$.status', message: 'transition' });
  if (previous.status !== 'placed') {
    if (!same(previous.lines, next.lines)) out.push({ path: '$.lines', message: 'frozen' });
    if (!same(previous.terms, next.terms)) out.push({ path: '$.terms', message: 'frozen' });
  }
  const kept = new Set(next.external.map((e: any) => readerCanonical([e.scheme, e.value])));
  previous.external.forEach((e: any, i: number) => { if (!kept.has(readerCanonical([e.scheme, e.value]))) out.push({ path: `$.external[${i}]`, message: 'removed' }); });
  return out;
}
