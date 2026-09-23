// Deliberately separate implementation of dtp/inventory@2, written from spec/profiles/inventory/2.md and its fixtures.
// Do not import the SDK reducer, decimal helpers or canonicalizer here. Same author as the reference: this is
// separately coded consumer agreement, not independent authorship. It must reach the same outcome for every fact
// and the same final ledger, including position keys and observation digests, from the document alone.
import { readerCanonical, readerDigest } from './product-reader.ts';

export type Outcome = { ok: true; duplicate: boolean } | { ok: false; code: string };
type Pos = { lot_id: string | null; location_id: string; status: string };
type Ledger = { profile: string; organization_id: string; product_id: string; base_unit: { system: string; code: string }; tracking: string; revision: number;
  positions: Record<string, { position: Pos; quantity: string; serials: string[] }>; reservations: Record<string, { position: string; quantity: string; party: string | null }>;
  sources: Record<string, { high_water: number; recent: Record<string, string> }> };
const WINDOW = 64, STATUSES = ['available', 'quarantine', 'damaged', 'expired', 'in_transit'], VIRTUAL = ['~supplier', '~customer', '~adjustment', '~production'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const ident = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f"\\]/.test(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
class Stop extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const stop = (code: string, message = code): never => { throw new Stop(code, message); };
const th = (v: unknown): bigint => { if (typeof v !== 'string' || !/^\d{1,18}(\.\d{1,3})?$/.test(v)) stop('invalid', 'decimal'); const [w, f = ''] = (v as string).split('.'); return BigInt(w) * 1000n + BigInt(f.padEnd(3, '0')); };
const show = (n: bigint) => { const f = (n % 1000n).toString().padStart(3, '0').replace(/0+$/, ''); return (n / 1000n).toString() + (f ? '.' + f : ''); };
const key = (p: Pos) => readerDigest([p.lot_id, p.location_id, p.status]);
const virtual = (l: string) => l.startsWith('~');

export function openLedger(organization_id: string, product_id: string, product: { base_unit: { system: string; code: string }; tracking: string }): Ledger {
  return { profile: 'dtp.inventory/2', organization_id, product_id, base_unit: { system: 'ucum', code: product.base_unit.code }, tracking: product.tracking, revision: 0, positions: {}, reservations: {}, sources: {} };
}
function toBase(l: Ledger, q: any, path: string): bigint {
  if (!plain(q) || !keysAre(q, ['amount', 'unit']) || !plain(q.unit) || !keysAre(q.unit, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) stop('invalid', `${path} quantity`);
  const amount = th(q.amount); if (amount <= 0n) stop('invalid', `${path} positive`);
  const u = q.unit;
  if (u.system === 'ucum') { if (u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) stop('invalid'); if (u.code !== l.base_unit.code) stop('unit_mismatch'); return amount; }
  if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) stop('invalid', `${path} packaging`);
  const per = th(u.base_units_per_pack); if (per <= 0n) stop('invalid');
  const product = amount * per; if (product % 1000n !== 0n) stop('invalid', 'precision');
  return product / 1000n;
}
function pos(l: Ledger, p: any, path: string): Pos {
  if (!plain(p) || !keysAre(p, ['lot_id', 'location_id', 'status'])) stop('invalid', `${path} position`);
  if (!ident(p.location_id, 120) || !STATUSES.includes(p.status)) stop('invalid', `${path} location/status`);
  if (virtual(p.location_id)) { if (!VIRTUAL.includes(p.location_id)) stop('invalid', 'virtual'); return p; }
  if (p.lot_id !== null && !ident(p.lot_id, 120)) stop('invalid', 'lot');
  if (l.tracking === 'none' && p.lot_id !== null) stop('tracking_mismatch');
  if (l.tracking !== 'none' && p.lot_id === null) stop('tracking_mismatch');
  return p;
}
const reserved = (l: Ledger, k: string) => Object.values(l.reservations).filter(r => r.position === k).reduce((n, r) => n + th(r.quantity), 0n);
const at = (l: Ledger, p: Pos) => (l.positions[key(p)] ??= { position: { lot_id: p.lot_id, location_id: p.location_id, status: p.status }, quantity: '0', serials: [] });

export function readFact(ledger: Ledger, fact: any): { outcome: Outcome; ledger: Ledger } {
  const same = (outcome: Outcome) => ({ outcome, ledger });
  try {
    if (!plain(fact) || !keysAre(fact, ['product_id', 'observation', 'occurred_at', 'expected_revision', 'moves', 'reservations'])) stop('invalid', 'fields');
    if (fact.product_id !== ledger.product_id) stop('wrong_scope');
    if (!plain(fact.observation) || !keysAre(fact.observation, ['source_id', 'sequence']) || !ident(fact.observation.source_id, 200) || !Number.isSafeInteger(fact.observation.sequence) || fact.observation.sequence < 1) stop('invalid', 'observation');
    if (typeof fact.occurred_at !== 'string' || Number.isNaN(Date.parse(fact.occurred_at)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(fact.occurred_at)) stop('invalid', 'occurred_at');
    if (!Number.isSafeInteger(fact.expected_revision) || fact.expected_revision < 0) stop('invalid', 'revision');
    if (!Array.isArray(fact.moves) || !Array.isArray(fact.reservations) || fact.moves.length > 16 || fact.reservations.length > 16 || fact.moves.length + fact.reservations.length === 0) stop('invalid', 'legs');
    const { source_id, sequence } = fact.observation, src = ledger.sources[source_id] ?? { high_water: 0, recent: {} }, d = readerDigest(fact);
    if (sequence <= src.high_water) {
      if (Object.hasOwn(src.recent, String(sequence))) return src.recent[String(sequence)] === d ? same({ ok: true, duplicate: true }) : stop('observation_conflict');
      if (sequence <= src.high_water - WINDOW) stop('stale_observation');
    }
    if (fact.expected_revision !== ledger.revision) stop('revision_conflict');
    const next: Ledger = JSON.parse(JSON.stringify(ledger));
    fact.moves.forEach((leg: any, i: number) => {
      const path = `moves[${i}]`;
      if (!plain(leg) || !keysAre(leg, ['from', 'to', 'quantity', 'serial_ids', 'reason', 'links'])) stop('invalid', path);
      const from = pos(next, leg.from, path), to = pos(next, leg.to, path), qty = toBase(next, leg.quantity, path);
      if (virtual(from.location_id) && virtual(to.location_id)) stop('invalid', 'both virtual');
      if (key(from) === key(to)) stop('invalid', 'same position');
      if (!plain(leg.links) || !keysAre(leg.links, ['transformation_id', 'order_id']) || (leg.links.transformation_id !== null && !UUID.test(leg.links.transformation_id)) || (leg.links.order_id !== null && !UUID.test(leg.links.order_id))) stop('invalid', 'links');
      if ((from.location_id === '~adjustment' || to.location_id === '~adjustment') && !text(leg.reason, 200)) stop('invalid', 'reason');
      if (leg.reason !== null && !text(leg.reason, 200)) stop('invalid', 'reason text');
      if ((from.location_id === '~production' || to.location_id === '~production') && leg.links.transformation_id === null) stop('invalid', 'transformation');
      let serials: string[] | null = null;
      if (next.tracking === 'serial') {
        if (leg.serial_ids === null) stop('tracking_mismatch');
        if (!Array.isArray(leg.serial_ids) || leg.serial_ids.length < 1 || leg.serial_ids.length > 256 || !leg.serial_ids.every((s: unknown) => ident(s, 120)) || new Set(leg.serial_ids).size !== leg.serial_ids.length) stop('serial_conflict', 'list');
        if (BigInt(leg.serial_ids.length) * 1000n !== qty) stop('serial_conflict', 'count');
        serials = leg.serial_ids;
      } else if (leg.serial_ids !== null) stop('tracking_mismatch');
      if (!virtual(from.location_id)) {
        const p = at(next, from), have = th(p.quantity);
        if (have - reserved(next, key(from)) < qty) stop('insufficient_stock');
        p.quantity = show(have - qty);
        for (const s of serials ?? []) { const i = p.serials.indexOf(s); if (i < 0) stop('serial_conflict', 'absent'); p.serials.splice(i, 1); }
      } else for (const s of serials ?? []) if (Object.values(next.positions).some(p => p.serials.includes(s))) stop('serial_conflict', 'exists');
      if (!virtual(to.location_id)) { const p = at(next, to); p.quantity = show(th(p.quantity) + qty); p.serials.push(...(serials ?? [])); }
    });
    fact.reservations.forEach((op: any, i: number) => {
      const path = `reservations[${i}]`;
      if (!plain(op) || !keysAre(op, ['kind', 'reservation_id', 'position', 'quantity', 'party'])) stop('invalid', path);
      if (!['reserve', 'release', 'fulfill'].includes(op.kind) || !ident(op.reservation_id, 120) || (op.party !== null && !UUID.test(op.party))) stop('invalid', 'op');
      const p = pos(next, op.position, path), k = key(p), qty = toBase(next, op.quantity, path);
      if (virtual(p.location_id) || p.status !== 'available') stop('invalid', 'reservation position');
      const cur = next.reservations[op.reservation_id];
      if (op.kind === 'reserve') {
        if (cur && cur.position !== k) stop('invalid', 'one position');
        if (th(at(next, p).quantity) - reserved(next, k) < qty) stop('insufficient_stock');
        next.reservations[op.reservation_id] = { position: k, quantity: show((cur ? th(cur.quantity) : 0n) + qty), party: cur ? cur.party : op.party };
        return;
      }
      if (!cur || cur.position !== k) stop('insufficient_reservation');
      const held = th(cur.quantity); if (held < qty) stop('insufficient_reservation');
      if (held === qty) delete next.reservations[op.reservation_id]; else next.reservations[op.reservation_id] = { ...cur, quantity: show(held - qty) };
      if (op.kind === 'fulfill') {
        if (next.tracking === 'serial') stop('tracking_mismatch');
        const s = at(next, p), have = th(s.quantity); if (have < qty) stop('insufficient_stock'); s.quantity = show(have - qty);
      }
    });
    for (const [k, p] of Object.entries(next.positions)) if (th(p.quantity) === 0n && p.serials.length === 0) delete next.positions[k];
    const s = next.sources[source_id] ??= { high_water: 0, recent: {} };
    s.recent[String(sequence)] = d; s.high_water = Math.max(s.high_water, sequence);
    for (const k of Object.keys(s.recent)) if (Number(k) <= s.high_water - WINDOW) delete s.recent[k];
    next.revision = ledger.revision + 1;
    return { outcome: { ok: true, duplicate: false }, ledger: next };
  } catch (e) {
    if (e instanceof Stop) return same({ ok: false, code: e.code });
    return same({ ok: false, code: 'invalid' });
  }
}
/** The v1 projection of one location, written from the document's description of the bridge. */
export function projectV1(ledger: Ledger, location_id: string) {
  const entries = Object.entries(ledger.positions).filter(([, p]) => p.position.location_id === location_id && p.position.status === 'available');
  const keys = new Set(entries.map(([k]) => k)), reservations: Record<string, string> = {};
  for (const [id, r] of Object.entries(ledger.reservations)) if (keys.has(r.position)) reservations[id] = r.quantity;
  return { profile: 'dtp.inventory/1', derived: true, company_id: ledger.organization_id, pool_id: location_id, product_id: ledger.product_id, base_unit: ledger.base_unit.code, revision: ledger.revision, on_hand: show(entries.reduce((n, [, p]) => n + th(p.quantity), 0n)), reservations };
}
export { readerCanonical, readerDigest };
