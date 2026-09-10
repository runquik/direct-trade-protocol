import { createHash } from 'node:crypto';
import { canonicalize } from '../canonical.ts';
import { formatDecimal, parseDecimal } from './decimal.ts';

export type PackagingRevision = {
  company_id: string; product_id: string; packaging_id: string; version: string;
  base_unit: string; pack_unit: string; base_units_per_pack: string;
};
export type PackagingPin = { packaging_id: string; version: string; digest: string };
export type InventoryState = {
  profile: 'dtp.inventory/1'; company_id: string; pool_id: string; product_id: string; base_unit: string;
  revision: number; on_hand: string; reservations: Record<string, string>;
  packaging: Record<string, PackagingRevision>; observations: Record<string, string>;
};
type EventBase = {
  company_id: string; pool_id: string; source_id: string; observation_id: string;
  expected_revision: number; occurred_at: string;
};
export type InventoryEvent = EventBase & (
  | { kind: 'packaging'; packaging: PackagingRevision }
  | { kind: 'receive' | 'adjust'; quantity: string; unit: string; packaging_pin?: PackagingPin; reason?: string }
  | { kind: 'reserve' | 'release' | 'fulfill'; reservation_id: string; quantity: string; unit: string; packaging_pin?: PackagingPin }
);
export type InventoryIssue = 'invalid' | 'wrong_scope' | 'observation_conflict' | 'revision_conflict' |
  'packaging_conflict' | 'unknown_packaging' | 'unit_mismatch' | 'insufficient_stock' | 'insufficient_reservation';
export type InventoryResult =
  | { ok: true; duplicate: boolean; state: InventoryState }
  | { ok: false; code: InventoryIssue; message: string; state: InventoryState };

const UNITS = new Set(['lb', 'kg', 'oz', 'ton', 'case', 'pallet', 'unit']);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const key = (...parts: string[]) => JSON.stringify(parts);
const hash = (value: unknown) => createHash('sha256').update(canonicalize(value)).digest('hex');
export const packagingDigest = (packaging: PackagingRevision): string => hash({ profile: 'dtp.packaging/1', packaging });

export function createInventoryState(company_id: string, pool_id: string, product_id: string, base_unit: string): InventoryState {
  if (![company_id, pool_id, product_id].every(identity) || !UNITS.has(base_unit)) throw new Error('invalid inventory scope or unit');
  return { profile: 'dtp.inventory/1', company_id, pool_id, product_id, base_unit, revision: 0,
    on_hand: '0', reservations: {}, packaging: {}, observations: {} };
}

/** This reducer assumes an authenticated, schema-admitted event and authoritative persisted state.
 * The caller MUST atomically compare revision, deduplicate and persist the returned state. */
export function applyInventoryEvent(state: InventoryState, event: InventoryEvent): InventoryResult {
  const fail = (code: InventoryIssue, message: string): InventoryResult => ({ ok: false, code, message, state });
  try {
    if (!event || !identity(event.company_id) || !identity(event.pool_id) || !identity(event.source_id) ||
        !identity(event.observation_id) || !Number.isSafeInteger(event.expected_revision) || event.expected_revision < 0 ||
        !Number.isSafeInteger(state.revision) || state.revision < 0) return fail('invalid', 'invalid event identity or revision');
    if (event.company_id !== state.company_id || event.pool_id !== state.pool_id) return fail('wrong_scope', 'event belongs to another company or stock pool');
    if (typeof event.occurred_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(event.occurred_at) ||
        !Number.isFinite(Date.parse(event.occurred_at)) || new Date(event.occurred_at).toISOString().slice(0, 19) !== event.occurred_at.slice(0, 19)) return fail('invalid', 'occurred_at must be a real UTC timestamp');
    // Reject undeclared semantics instead of silently ignoring fields in a supposedly shared profile.
    const allowed = new Set(['company_id', 'pool_id', 'source_id', 'observation_id', 'expected_revision', 'occurred_at', 'kind',
      ...(event.kind === 'packaging' ? ['packaging'] : ['quantity', 'unit', 'packaging_pin',
        ...(event.kind === 'receive' || event.kind === 'adjust' ? ['reason'] : ['reservation_id'])])]);
    if (Object.keys(event).some(k => !allowed.has(k))) return fail('invalid', 'unknown required inventory semantics');
    const eventHash = hash(event);
    const observationKey = key(event.company_id, event.source_id, event.observation_id);
    if (Object.hasOwn(state.observations, observationKey)) {
      return state.observations[observationKey] === eventHash ? { ok: true, duplicate: true, state }
        : fail('observation_conflict', 'observation identity already names a different event');
    }
    if (state.revision >= Number.MAX_SAFE_INTEGER) return fail('invalid', 'inventory revision capacity exhausted');
    if (event.expected_revision !== state.revision) return fail('revision_conflict', 'stock pool changed; reload before deciding a new action');
    const next: InventoryState = { ...state, revision: state.revision + 1,
      reservations: { ...state.reservations }, packaging: { ...state.packaging },
      observations: { ...state.observations, [observationKey]: eventHash } };
    if (event.kind === 'packaging') {
      const pack = event.packaging;
      if (!pack || Object.keys(pack).sort().join(',') !== 'base_unit,base_units_per_pack,company_id,pack_unit,packaging_id,product_id,version' ||
          ![pack.packaging_id, pack.version].every(identity)) return fail('invalid', 'invalid packaging revision');
      if (pack.company_id !== state.company_id || pack.product_id !== state.product_id || pack.base_unit !== state.base_unit) return fail('wrong_scope', 'packaging revision belongs to another company, product or base unit');
      if (!UNITS.has(pack.pack_unit) || pack.pack_unit === pack.base_unit) return fail('unit_mismatch', 'pack unit must be supported and differ from base unit');
      if (parseDecimal(pack.base_units_per_pack, 3) <= 0n) return fail('invalid', 'pack conversion must be positive');
      const packKey = key(pack.packaging_id, pack.version);
      if (Object.hasOwn(next.packaging, packKey) && packagingDigest(next.packaging[packKey]) !== packagingDigest(pack)) return fail('packaging_conflict', 'packaging version is immutable; publish a new version');
      next.packaging[packKey] = { ...pack };
      return { ok: true, duplicate: false, state: next };
    }
    if (!['receive', 'adjust', 'reserve', 'release', 'fulfill'].includes(event.kind)) return fail('invalid', 'unsupported inventory event kind');
    if ('reason' in event && event.reason !== undefined && !identity(event.reason)) return fail('invalid', 'reason must be bounded text');
    if (event.kind === 'adjust' && !identity(event.reason)) return fail('invalid', 'correction requires an explicit reason');
    let quantity = parseDecimal(event.quantity, 3, event.kind === 'adjust');
    if (quantity === 0n) return fail('invalid', 'zero quantity has no inventory effect');
    if (!UNITS.has(event.unit)) return fail('unit_mismatch', 'unsupported unit; no implicit conversion');
    if (event.unit === state.base_unit) {
      if (event.packaging_pin) return fail('unit_mismatch', 'base-unit event must not carry an unused packaging conversion');
    } else {
      const pin = event.packaging_pin;
      if (!pin || Object.keys(pin).sort().join(',') !== 'digest,packaging_id,version' ||
          ![pin.packaging_id, pin.version].every(identity) || !/^[0-9a-f]{64}$/.test(pin.digest)) return fail('unknown_packaging', 'conversion requires exact packaging version and digest');
      const packKey = key(pin.packaging_id, pin.version);
      if (!Object.hasOwn(state.packaging, packKey)) return fail('unknown_packaging', 'packaging revision is not registered');
      const pack = state.packaging[packKey];
      if (pin.digest !== packagingDigest(pack)) return fail('packaging_conflict', 'packaging digest does not match pinned revision');
      if (pack.pack_unit !== event.unit || pack.base_unit !== state.base_unit) return fail('unit_mismatch', 'packaging does not define this conversion');
      const product = quantity * parseDecimal(pack.base_units_per_pack, 3);
      if (product % 1000n !== 0n) return fail('invalid', 'conversion exceeds base quantity precision; rounding stock is forbidden');
      quantity = product / 1000n;
    }
    formatDecimal(quantity, 3); // Bound converted quantity before aggregating.
    let onHand = parseDecimal(state.on_hand, 3);
    let reserved = 0n;
    for (const value of Object.values(state.reservations)) reserved += parseDecimal(value, 3);
    if (reserved > onHand) return fail('invalid', 'persisted state violates reservation invariant');
    if (event.kind === 'receive' || event.kind === 'adjust') {
      onHand += quantity;
      if (onHand < reserved) return fail('insufficient_stock', 'correction would consume reserved stock or make stock negative');
    } else {
      if (!('reservation_id' in event) || !identity(event.reservation_id)) return fail('invalid', 'reservation requires an explicit identity');
      const reservationKey = key(event.reservation_id);
      const current = Object.hasOwn(state.reservations, reservationKey) ? parseDecimal(state.reservations[reservationKey], 3) : 0n;
      if (event.kind === 'reserve') {
        if (quantity > onHand - reserved) return fail('insufficient_stock', 'reservation exceeds currently available stock');
        next.reservations[reservationKey] = formatDecimal(current + quantity, 3);
      } else {
        if (quantity > current) return fail('insufficient_reservation', 'release or fulfillment exceeds this reservation');
        const remainder = current - quantity;
        if (remainder === 0n) delete next.reservations[reservationKey];
        else next.reservations[reservationKey] = formatDecimal(remainder, 3);
        if (event.kind === 'fulfill') onHand -= quantity;
      }
    }
    next.on_hand = formatDecimal(onHand, 3);
    return { ok: true, duplicate: false, state: next };
  } catch (error) { return fail('invalid', error instanceof Error ? error.message : 'invalid profile data'); }
}
