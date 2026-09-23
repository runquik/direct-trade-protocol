/** dtp/inventory@2: one company's stock ledger for one product, as positions keyed by lot, location and status,
 * changed only by atomic multi-leg moves against real or virtual locations, with reservations as claims beside the
 * positions and per-source high-water marks instead of an unbounded observation map. Portable, dependency-free,
 * synchronous: it runs inside a host transaction on any runtime. Profile document and fixtures:
 * spec/profiles/inventory/2.md, spec/profiles/inventory/2/. The v1 reducer (inventory.ts) is unchanged. */
import { canonicalize } from '../canonical.ts';
import { sha256HexSync } from '../sha256.ts';
import { formatDecimal, parseDecimal } from './decimal.ts';
import type { ProductBody, UnitReference } from './product.ts';

export const INVENTORY2_PROFILE = 'dtp.inventory/2';
export const INVENTORY2_KIND = 'dtp/inventory@2';
export const INVENTORY2_SEMANTICS = 'inventory-v2';
export const MAX_MOVE_LEGS = 16, MAX_RESERVATION_OPS = 16, OBSERVATION_WINDOW = 64, MAX_SERIALS_PER_LEG = 256;
export const POSITION_STATUSES = ['available', 'quarantine', 'damaged', 'expired', 'in_transit'] as const;
/** Counterparts outside the company's stock. A move from or to one of these is how stock enters and leaves. */
export const VIRTUAL_LOCATIONS = ['~supplier', '~customer', '~adjustment', '~production'] as const;
export type PositionStatus = typeof POSITION_STATUSES[number];
export type Position = { lot_id: string | null; location_id: string; status: PositionStatus };
/** The wire unit is one closed object for both systems: unused members are null. */
export type WireUnit = { system: 'ucum'; code: string; packaging_id: null; version: null; base_units_per_pack: null } | { system: 'packaging'; code: null; packaging_id: string; version: string; base_units_per_pack: string };
export type Quantity = { amount: string; unit: WireUnit };
export type MoveLeg = { from: Position; to: Position; quantity: Quantity; serial_ids: string[] | null; reason: string | null; links: { transformation_id: string | null; order_id: string | null } };
export type ReservationOp = { kind: 'reserve' | 'release' | 'fulfill'; reservation_id: string; position: Position; quantity: Quantity; party: string | null };
export type InventoryFact = { product_id: string; observation: { source_id: string; sequence: number }; occurred_at: string; expected_revision: number; moves: MoveLeg[]; reservations: ReservationOp[] };
export type PositionState = { position: Position; quantity: string; serials: string[] };
export type InventoryLedger = {
  profile: typeof INVENTORY2_PROFILE; organization_id: string; product_id: string; base_unit: UnitReference; tracking: ProductBody['tracking'];
  revision: number; positions: Record<string, PositionState>; reservations: Record<string, { position: string; quantity: string; party: string | null }>;
  sources: Record<string, { high_water: number; recent: Record<string, string> }>;
};
export type InventoryIssue = 'invalid' | 'wrong_scope' | 'observation_conflict' | 'stale_observation' | 'revision_conflict' | 'unit_mismatch' | 'tracking_mismatch' | 'insufficient_stock' | 'insufficient_reservation' | 'serial_conflict';
export type InventoryResult = { ok: true; duplicate: boolean; state: InventoryLedger } | { ok: false; code: InventoryIssue; message: string; state: InventoryLedger };
/** The payload schema in the bounded dtp.schema/1 dialect. Rules the dialect cannot express are the reducer's. */
const unit = { type: 'object', additionalProperties: false, required: ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'], properties: { system: { type: 'string', maxLength: 9, enum: ['ucum', 'packaging'] }, code: { type: 'string', maxLength: 32, nullable: true }, packaging_id: { type: 'string', maxLength: 80, nullable: true }, version: { type: 'string', maxLength: 40, nullable: true }, base_units_per_pack: { type: 'string', maxLength: 24, nullable: true } } };
const quantity = { type: 'object', additionalProperties: false, required: ['amount', 'unit'], properties: { amount: { type: 'string', maxLength: 24 }, unit } };
const position = { type: 'object', additionalProperties: false, required: ['lot_id', 'location_id', 'status'], properties: { lot_id: { type: 'string', maxLength: 120, nullable: true }, location_id: { type: 'string', maxLength: 120 }, status: { type: 'string', maxLength: 10, enum: [...POSITION_STATUSES] } } };
export const INVENTORY2_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['product_id', 'observation', 'occurred_at', 'expected_revision', 'moves', 'reservations'],
  properties: {
    product_id: { type: 'string', maxLength: 36 },
    observation: { type: 'object', additionalProperties: false, required: ['source_id', 'sequence'], properties: { source_id: { type: 'string', maxLength: 200 }, sequence: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } },
    occurred_at: { type: 'string', maxLength: 24 }, expected_revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    moves: { type: 'array', maxItems: MAX_MOVE_LEGS, items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'quantity', 'serial_ids', 'reason', 'links'], properties: { from: position, to: position, quantity, serial_ids: { type: 'array', maxItems: MAX_SERIALS_PER_LEG, items: { type: 'string', maxLength: 120 }, nullable: true }, reason: { type: 'string', maxLength: 200, nullable: true }, links: { type: 'object', additionalProperties: false, required: ['transformation_id', 'order_id'], properties: { transformation_id: { type: 'string', maxLength: 36, nullable: true }, order_id: { type: 'string', maxLength: 36, nullable: true } } } } } },
    reservations: { type: 'array', maxItems: MAX_RESERVATION_OPS, items: { type: 'object', additionalProperties: false, required: ['kind', 'reservation_id', 'position', 'quantity', 'party'], properties: { kind: { type: 'string', maxLength: 7, enum: ['reserve', 'release', 'fulfill'] }, reservation_id: { type: 'string', maxLength: 120 }, position, quantity, party: { type: 'string', maxLength: 36, nullable: true } } } },
  },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UCUM = /^[!-~]{1,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
/** Ids become member names of the ledger, so they must be member-name-safe: no quotation mark, no reverse solidus. */
const ident = (v: unknown, max: number) => text(v, max) && !/["\\]/.test(v as string);
/** Positions are keyed by a digest, so the key is member-name-safe whatever the ids are; the state carries the position. */
const positionKey = (p: Position) => sha256HexSync(canonicalize([p.lot_id, p.location_id, p.status]));
const isVirtual = (location: string) => location.startsWith('~');
class Refusal extends Error { code: InventoryIssue; constructor(code: InventoryIssue, message: string) { super(message); this.code = code; } }
const refuse = (code: InventoryIssue, message: string): never => { throw new Refusal(code, message); };

/** A ledger opened from the product it is for. The product's base unit and tracking are fixed for the product's life,
 *  so the ledger copies them; the host verifies pack conversions against the product's packaging revisions. */
export function openInventoryLedger(organization_id: string, product_id: string, product: Pick<ProductBody, 'base_unit' | 'tracking'>): InventoryLedger {
  if (!UUID.test(organization_id) || !UUID.test(product_id) || !isObject(product?.base_unit) || product.base_unit.system !== 'ucum' || !UCUM.test(product.base_unit.code) || !['none', 'lot', 'serial'].includes(product.tracking)) throw new Error('invalid ledger scope, unit or tracking');
  return { profile: INVENTORY2_PROFILE, organization_id, product_id, base_unit: { system: 'ucum', code: product.base_unit.code }, tracking: product.tracking, revision: 0, positions: {}, reservations: {}, sources: {} };
}
function toBase(ledger: InventoryLedger, q: Quantity, path: string): bigint {
  if (!isObject(q) || !exact(q, ['amount', 'unit']) || !isObject(q.unit)) refuse('invalid', `${path}: quantity with amount and unit required`);
  let amount: bigint; try { amount = parseDecimal(q.amount, 3); } catch { return refuse('invalid', `${path}: three-place decimal amount required`); }
  if (amount <= 0n) refuse('invalid', `${path}: positive quantity required`);
  const u = q.unit as Record<string, unknown>;
  if (!exact(u, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) refuse('invalid', `${path}: exact unit fields required`);
  if (u.system === 'ucum') {
    if (u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) refuse('invalid', `${path}: a ucum unit carries no packaging`);
    if (u.code !== ledger.base_unit.code) refuse('unit_mismatch', `${path}: quantities are expressed in the product base unit ${ledger.base_unit.code}; no unit is converted`);
    return amount;
  }
  if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) refuse('invalid', `${path}: packaging unit needs packaging_id and version`);
  let per: bigint; try { per = parseDecimal(u.base_units_per_pack, 3); } catch { return refuse('invalid', `${path}: three-place pack conversion required`); }
  if (per <= 0n) refuse('invalid', `${path}: positive pack conversion required`);
  const product = amount * per; if (product % 1000n !== 0n) refuse('invalid', `${path}: conversion exceeds base precision; stock is never rounded`);
  return product / 1000n;
}
function checkPosition(ledger: InventoryLedger, p: unknown, path: string): Position {
  if (!isObject(p) || !exact(p, ['lot_id', 'location_id', 'status'])) refuse('invalid', `${path}: lot_id, location_id and status required`);
  const pos = p as Position;
  if (!ident(pos.location_id, 120)) refuse('invalid', `${path}: bounded location required`);
  if (!(POSITION_STATUSES as readonly string[]).includes(pos.status)) refuse('invalid', `${path}: unknown status`);
  if (isVirtual(pos.location_id)) { if (!(VIRTUAL_LOCATIONS as readonly string[]).includes(pos.location_id)) refuse('invalid', `${path}: unknown virtual location`); return pos; }
  if (pos.lot_id !== null && !ident(pos.lot_id, 120)) refuse('invalid', `${path}: bounded lot or null required`);
  if (ledger.tracking === 'none' && pos.lot_id !== null) refuse('tracking_mismatch', `${path}: this product is not lot-tracked`);
  if (ledger.tracking !== 'none' && pos.lot_id === null) refuse('tracking_mismatch', `${path}: this product is lot-tracked; a lot is required`);
  return pos;
}
const reservedAt = (ledger: InventoryLedger, key: string) => Object.values(ledger.reservations).filter(r => r.position === key).reduce((n, r) => n + parseDecimal(r.quantity, 3), 0n);
function positionAt(ledger: InventoryLedger, pos: Position): PositionState { const key = positionKey(pos); return ledger.positions[key] ??= { position: { ...pos }, quantity: '0', serials: [] }; }
function compact(ledger: InventoryLedger) { for (const [k, p] of Object.entries(ledger.positions)) if (parseDecimal(p.quantity, 3) === 0n && p.serials.length === 0) delete ledger.positions[k]; }
/** Applies one fact atomically. Assumes an authenticated, schema-admitted fact and authoritative persisted state; the
 *  caller MUST compare revision, deduplicate and persist the returned state in one transaction. */
export function applyInventoryFact(state: InventoryLedger, fact: InventoryFact): InventoryResult {
  const fail = (code: InventoryIssue, message: string): InventoryResult => ({ ok: false, code, message, state });
  try {
    if (!isObject(fact) || !exact(fact, ['product_id', 'observation', 'occurred_at', 'expected_revision', 'moves', 'reservations'])) return fail('invalid', 'exact fact fields required');
    if (fact.product_id !== state.product_id) return fail('wrong_scope', 'fact belongs to another product ledger');
    if (!isObject(fact.observation) || !exact(fact.observation, ['source_id', 'sequence']) || !ident(fact.observation.source_id, 200) || !Number.isSafeInteger(fact.observation.sequence) || fact.observation.sequence < 1) return fail('invalid', 'observation source and positive sequence required');
    if (typeof fact.occurred_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(fact.occurred_at) || !Number.isFinite(Date.parse(fact.occurred_at)) || new Date(fact.occurred_at).toISOString().slice(0, 19) !== fact.occurred_at.slice(0, 19)) return fail('invalid', 'occurred_at must be a real UTC timestamp');
    if (!Number.isSafeInteger(fact.expected_revision) || fact.expected_revision < 0 || !Number.isSafeInteger(state.revision) || state.revision < 0) return fail('invalid', 'invalid revision');
    if (!Array.isArray(fact.moves) || fact.moves.length > MAX_MOVE_LEGS || !Array.isArray(fact.reservations) || fact.reservations.length > MAX_RESERVATION_OPS || fact.moves.length + fact.reservations.length === 0) return fail('invalid', 'a fact carries 1-16 move legs and 0-16 reservation operations');
    // Observation deduplication: a per-source high-water mark with a bounded window for late arrivals.
    const { source_id, sequence } = fact.observation, source = state.sources[source_id] ?? { high_water: 0, recent: {} }, factDigest = sha256HexSync(canonicalize(fact));
    if (sequence <= source.high_water) {
      const known = source.recent[String(sequence)];
      if (known !== undefined) return known === factDigest ? { ok: true, duplicate: true, state } : fail('observation_conflict', 'observation sequence already names a different fact');
      if (sequence <= source.high_water - OBSERVATION_WINDOW) return fail('stale_observation', `observation is older than the ${OBSERVATION_WINDOW}-sequence window and cannot be told from a duplicate`);
    }
    if (state.revision >= Number.MAX_SAFE_INTEGER) return fail('invalid', 'ledger revision capacity exhausted');
    if (fact.expected_revision !== state.revision) return fail('revision_conflict', 'ledger changed; reload before deciding a new action');
    const next: InventoryLedger = structuredClone(state);
    fact.moves.forEach((leg, i) => {
      const path = `moves[${i}]`;
      if (!isObject(leg) || !exact(leg, ['from', 'to', 'quantity', 'serial_ids', 'reason', 'links'])) refuse('invalid', `${path}: exact leg fields required`);
      const from = checkPosition(next, leg.from, `${path}.from`), to = checkPosition(next, leg.to, `${path}.to`), qty = toBase(next, leg.quantity, `${path}.quantity`);
      if (isVirtual(from.location_id) && isVirtual(to.location_id)) refuse('invalid', `${path}: a move needs at least one real position`);
      if (positionKey(from) === positionKey(to)) refuse('invalid', `${path}: from and to are the same position`);
      if (!isObject(leg.links) || !exact(leg.links, ['transformation_id', 'order_id']) || (leg.links.transformation_id !== null && !UUID.test(String(leg.links.transformation_id))) || (leg.links.order_id !== null && !UUID.test(String(leg.links.order_id)))) refuse('invalid', `${path}: links are roots or null`);
      if ((from.location_id === '~adjustment' || to.location_id === '~adjustment') && !text(leg.reason, 200)) refuse('invalid', `${path}: an adjustment requires a reason`);
      if (leg.reason !== null && !text(leg.reason, 200)) refuse('invalid', `${path}: bounded reason or null required`);
      if ((from.location_id === '~production' || to.location_id === '~production') && leg.links.transformation_id === null) refuse('invalid', `${path}: production legs name the transformation`);
      // Serials: exactly the units moved, each in one position at a time.
      if (next.tracking === 'serial') {
        if (leg.serial_ids === null) refuse('tracking_mismatch', `${path}: this product is serialized; the leg must name its serials`);
        if (!Array.isArray(leg.serial_ids) || leg.serial_ids.length === 0 || leg.serial_ids.length > MAX_SERIALS_PER_LEG || !leg.serial_ids.every(s => ident(s, 120)) || new Set(leg.serial_ids).size !== leg.serial_ids.length) refuse('serial_conflict', `${path}: serialized stock moves by distinct serial`);
        if (BigInt((leg.serial_ids ?? []).length) * 1000n !== qty) refuse('serial_conflict', `${path}: quantity must equal the number of serials`);
      } else if (leg.serial_ids !== null) refuse('tracking_mismatch', `${path}: this product is not serialized`);
      if (!isVirtual(from.location_id)) {
        const p = positionAt(next, from), have = parseDecimal(p.quantity, 3), reserved = reservedAt(next, positionKey(from));
        if (have - reserved < qty) refuse('insufficient_stock', `${path}: only ${formatDecimal(have - reserved, 3)} unreserved at the source position`);
        p.quantity = formatDecimal(have - qty, 3);
        if (next.tracking === 'serial') { for (const s of leg.serial_ids!) { const at = p.serials.indexOf(s); if (at < 0) refuse('serial_conflict', `${path}: serial ${s} is not at the source position`); p.serials.splice(at, 1); } }
      } else if (next.tracking === 'serial') {
        for (const s of leg.serial_ids ?? []) if (Object.values(next.positions).some(p => p.serials.includes(s))) refuse('serial_conflict', `${path}: serial ${s} already exists in stock`);
      }
      if (!isVirtual(to.location_id)) {
        const p = positionAt(next, to); p.quantity = formatDecimal(parseDecimal(p.quantity, 3) + qty, 3);
        if (next.tracking === 'serial') p.serials.push(...leg.serial_ids!);
      }
    });
    fact.reservations.forEach((op, i) => {
      const path = `reservations[${i}]`;
      if (!isObject(op) || !exact(op, ['kind', 'reservation_id', 'position', 'quantity', 'party'])) refuse('invalid', `${path}: exact reservation fields required`);
      if (!['reserve', 'release', 'fulfill'].includes(op.kind) || !ident(op.reservation_id, 120) || (op.party !== null && !UUID.test(String(op.party)))) refuse('invalid', `${path}: kind, reservation id and party or null required`);
      const pos = checkPosition(next, op.position, `${path}.position`), key = positionKey(pos), qty = toBase(next, op.quantity, `${path}.quantity`);
      if (isVirtual(pos.location_id)) refuse('invalid', `${path}: reservations claim real stock`);
      if (pos.status !== 'available') refuse('invalid', `${path}: only available stock is reserved`);
      const current = next.reservations[op.reservation_id];
      if (op.kind === 'reserve') {
        if (current && current.position !== key) refuse('invalid', `${path}: a reservation claims one position`);
        const have = parseDecimal(positionAt(next, pos).quantity, 3), reserved = reservedAt(next, key);
        if (have - reserved < qty) refuse('insufficient_stock', `${path}: reservation exceeds unreserved stock at the position`);
        next.reservations[op.reservation_id] = { position: key, quantity: formatDecimal((current ? parseDecimal(current.quantity, 3) : 0n) + qty, 3), party: current?.party ?? op.party };
        return;
      }
      if (!current || current.position !== key) refuse('insufficient_reservation', `${path}: no such reservation at that position`);
      const held = parseDecimal(current.quantity, 3); if (held < qty) refuse('insufficient_reservation', `${path}: release or fulfilment exceeds the reservation`);
      if (held === qty) delete next.reservations[op.reservation_id]; else next.reservations[op.reservation_id] = { ...current, quantity: formatDecimal(held - qty, 3) };
      if (op.kind === 'fulfill') {
        if (next.tracking === 'serial') refuse('tracking_mismatch', `${path}: serialized stock is fulfilled by a move to ~customer naming its serials, plus a release`);
        const p = positionAt(next, pos), have = parseDecimal(p.quantity, 3); if (have < qty) refuse('insufficient_stock', `${path}: fulfilment exceeds the position`);
        p.quantity = formatDecimal(have - qty, 3);
      }
    });
    compact(next);
    const src = next.sources[source_id] ??= { high_water: 0, recent: {} };
    src.recent[String(sequence)] = factDigest; src.high_water = Math.max(src.high_water, sequence);
    for (const k of Object.keys(src.recent)) if (Number(k) <= src.high_water - OBSERVATION_WINDOW) delete src.recent[k];
    next.revision = state.revision + 1;
    return { ok: true, duplicate: false, state: next };
  } catch (error) {
    if (error instanceof Refusal) return fail(error.code, error.message);
    return fail('invalid', error instanceof Error ? error.message : 'invalid profile data');
  }
}
/** The v1 view of one location: available stock and its reservations, as a v1 subscriber expects a pool. Derived,
 *  never a fact: a bridge module publishes it, and it cannot be turned back into a v2 ledger. */
export function projectInventoryV1(ledger: InventoryLedger, location_id: string): { profile: 'dtp.inventory/1'; derived: true; company_id: string; pool_id: string; product_id: string; base_unit: string; revision: number; on_hand: string; reservations: Record<string, string> } {
  const positions = Object.entries(ledger.positions).filter(([, p]) => p.position.location_id === location_id && p.position.status === 'available');
  const keys = new Set(positions.map(([k]) => k));
  const on_hand = positions.reduce((n, [, p]) => n + parseDecimal(p.quantity, 3), 0n);
  const reservations: Record<string, string> = {};
  for (const [id, r] of Object.entries(ledger.reservations)) if (keys.has(r.position)) reservations[id] = r.quantity;
  return { profile: 'dtp.inventory/1', derived: true, company_id: ledger.organization_id, pool_id: location_id, product_id: ledger.product_id, base_unit: ledger.base_unit.code, revision: ledger.revision, on_hand: formatDecimal(on_hand, 3), reservations };
}
