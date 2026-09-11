// Deliberately separate consumer implementation. Do not import the SDK reducer,
// canonicalizer, decimal helpers or permission engine here.
import { createHash, createPublicKey, verify } from 'node:crypto';

const SCHEMA = '6c793c7ad4ee80938f1924af9e767121111db6633a0f313faf16b174b2dd501f';
const UNITS = ['lb', 'kg', 'oz', 'ton', 'case', 'pallet', 'unit'];
const identifier = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= 200;
export type SignedEvent = { envelope: { version: '0.4'; organization_id: string; resource_id: string; profile_digest: string; body: Record<string, any> }; public_key_der: string; signature: string };
export type InventoryStream = {
  profile: string; semantics: string; schema_digest: string; schema: unknown;
  scope: { company_id: string; pool_id: string; product_id: string; base_unit: string };
  opening_balance: { status: 'known'; amount: string } | { status: 'unknown' }; complete: boolean;
  events: SignedEvent[];
};
export type ReaderAuthority = { company_id: string; resource_id: string; allowed_public_keys: string[] };

// This fixture domain admits only ordinary JSON with bounded safe integers.
export function readerCanonical(value: any): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(readerCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + readerCanonical(value[k])).join(',') + '}';
  throw new Error('invalid_json');
}
export const readerDigest = (value: unknown): string => createHash('sha256').update(readerCanonical(value)).digest('hex');

function decimal(value: unknown, negative = false): bigint {
  if (typeof value !== 'string' || value.length > 23 || !/^-?\d{1,18}(?:\.\d{1,3})?$/.test(value) || (!negative && value.startsWith('-'))) throw new Error('invalid_decimal');
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, part = ''] = (sign < 0 ? value.substring(1) : value).split('.');
  return sign * (BigInt(whole) * 1000n + BigInt((part + '000').substring(0, 3)));
}
function display(value: bigint): string {
  if (value < 0n || value / 1000n >= 10n ** 18n) throw new Error('invalid_balance');
  return (value / 1000n).toString() + ((value % 1000n) ? '.' + (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '') : '');
}
function matches(schema: any, value: any): boolean {
  if (schema.type === 'string') return typeof value === 'string' && value.length <= schema.maxLength && (!schema.enum || schema.enum.includes(value));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'object') return value && typeof value === 'object' && !Array.isArray(value) && schema.required.every((k: string) => Object.hasOwn(value, k)) && Object.keys(value).every(k => Object.hasOwn(schema.properties, k) && matches(schema.properties[k], value[k]));
  return false;
}

/** Authorized-read reconstruction, not admission, key discovery or signature certification.
 * The application supplies independently established authority and stream completeness. */
export function readInventory(stream: InventoryStream, authority: ReaderAuthority) {
  if (stream.profile !== 'dtp.inventory/1' || stream.semantics !== 'inventory-v1' || stream.schema_digest !== SCHEMA || readerDigest(stream.schema) !== SCHEMA) throw new Error('incompatible_profile');
  const scope = stream.scope;
  if (scope.company_id !== authority.company_id || scope.pool_id !== authority.resource_id) throw new Error('unauthorized_scope');
  // A filtered or truncated ledger is not evidence of zero inventory.
  if (!stream.complete || stream.opening_balance.status === 'unknown') return { status: 'unknown' as const, reason: 'incomplete_opening_or_history' };
  let balance = decimal(stream.opening_balance.amount);
  let revision = 0;
  let duplicates = 0;
  const observations = new Map<string, string>();
  const packaging = new Map<string, any>();
  const reservations = new Map<string, bigint>();
  const reserved = () => [...reservations.values()].reduce((a, b) => a + b, 0n);
  for (const signed of stream.events) {
    if (!authority.allowed_public_keys.includes(signed.public_key_der)) throw new Error('untrusted_signer');
    const publicKey = createPublicKey({ format: 'der', type: 'spki', key: Buffer.from(signed.public_key_der, 'base64') });
    if (!verify(null, Buffer.from(readerCanonical({ domain: 'DTP-INVENTORY-INTEROP-FIXTURE-1', envelope: signed.envelope })), publicKey, Buffer.from(signed.signature, 'base64'))) throw new Error('invalid_signature');
    const { envelope } = signed;
    if (envelope.version !== '0.4' || envelope.organization_id !== scope.company_id || envelope.resource_id !== scope.pool_id || envelope.profile_digest !== SCHEMA) throw new Error('envelope_scope_mismatch');
    const event = envelope.body;
    if (!matches(stream.schema, event)) throw new Error('invalid_shape');
    if (![event.company_id, event.pool_id, event.source_id, event.observation_id].every(identifier)) throw new Error('invalid_identity');
    const common = ['company_id', 'pool_id', 'source_id', 'observation_id', 'expected_revision', 'occurred_at', 'kind'];
    const variant = event.kind === 'packaging' ? ['packaging'] :
      (event.kind === 'receive' || event.kind === 'adjust' ? ['quantity', 'unit', 'packaging_pin', 'reason'] : ['quantity', 'unit', 'packaging_pin', 'reservation_id']);
    if (Object.keys(event).some(k => !common.includes(k) && !variant.includes(k))) throw new Error('incompatible_event_fields');
    if (event.company_id !== scope.company_id || event.pool_id !== scope.pool_id) throw new Error('event_scope_mismatch');
    const observation = JSON.stringify([event.company_id, event.source_id, event.observation_id]);
    const eventDigest = readerDigest(event);
    if (observations.has(observation)) {
      if (observations.get(observation) !== eventDigest) throw new Error('observation_conflict');
      duplicates++; continue;
    }
    if (event.expected_revision !== revision) throw new Error('revision_conflict');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(event.occurred_at) ||
        !Number.isFinite(Date.parse(event.occurred_at)) || new Date(event.occurred_at).toISOString().substring(0, 19) !== event.occurred_at.substring(0, 19)) throw new Error('invalid_event_time');
    if (event.kind === 'packaging') {
      const pack = event.packaging;
      if (!pack || !identifier(pack.version) || !identifier(pack.packaging_id) || pack.company_id !== scope.company_id || pack.product_id !== scope.product_id || pack.base_unit !== scope.base_unit ||
          !UNITS.includes(pack.pack_unit) || pack.pack_unit === scope.base_unit || decimal(pack.base_units_per_pack) <= 0n) throw new Error('invalid_packaging');
      const identity = JSON.stringify([pack.packaging_id, pack.version]);
      if (packaging.has(identity) && readerDigest(packaging.get(identity)) !== readerDigest(pack)) throw new Error('packaging_conflict');
      packaging.set(identity, pack);
    } else {
      let quantity = decimal(event.quantity, event.kind === 'adjust');
      if (quantity === 0n) throw new Error('zero_effect');
      if (!UNITS.includes(event.unit)) throw new Error('unsupported_unit');
      if (event.reason !== undefined && !identifier(event.reason)) throw new Error('invalid_reason');
      if (event.unit !== scope.base_unit) {
        const pin = event.packaging_pin;
        const pack = pin && packaging.get(JSON.stringify([pin.packaging_id, pin.version]));
        if (!pack || pin.digest !== readerDigest({ profile: 'dtp.packaging/1', packaging: pack }) || pack.pack_unit !== event.unit) throw new Error('incompatible_packaging');
        const numerator = quantity * decimal(pack.base_units_per_pack);
        if (numerator % 1000n !== 0n) throw new Error('inexact_conversion');
        quantity = numerator / 1000n;
      } else if (event.packaging_pin) throw new Error('unused_packaging_pin');
      display(quantity < 0n ? -quantity : quantity);
      if (event.kind === 'receive' || event.kind === 'adjust') {
        if (event.kind === 'adjust' && (typeof event.reason !== 'string' || !event.reason.length)) throw new Error('missing_correction_reason');
        balance += quantity;
      } else {
        if (typeof event.reservation_id !== 'string' || !event.reservation_id.length) throw new Error('missing_reservation');
        const current = reservations.get(event.reservation_id) ?? 0n;
        if (event.kind === 'reserve') {
          if (quantity > balance - reserved()) throw new Error('insufficient_stock');
          reservations.set(event.reservation_id, current + quantity);
        } else {
          if (quantity > current) throw new Error('insufficient_reservation');
          if (quantity === current) reservations.delete(event.reservation_id); else reservations.set(event.reservation_id, current - quantity);
          if (event.kind === 'fulfill') balance -= quantity;
          else if (event.kind !== 'release') throw new Error('incompatible_event');
        }
      }
      if (balance < reserved()) throw new Error('invalid_balance');
      display(balance);
    }
    observations.set(observation, eventDigest);
    revision++;
  }
  return { status: 'known' as const, on_hand: display(balance), reserved: display(reserved()), available: display(balance - reserved()),
    revision, unique_observations: observations.size, duplicate_observations: duplicates,
    reservations: Object.fromEntries([...reservations].map(([id, value]) => [id, display(value)])), pack_versions: packaging.size };
}
