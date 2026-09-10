import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { applyInventoryEvent, createInventoryState } from '../../src/profiles/inventory.ts';
import type { InventoryEvent } from '../../src/profiles/inventory.ts';
import { parseDecimal, formatDecimal } from '../../src/profiles/decimal.ts';
import { readInventory, readerCanonical, readerDigest } from './inventory-reader.ts';
import type { InventoryStream, SignedEvent } from './inventory-reader.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../spec/v0.4/fixtures/inventory-v1-flow.json', import.meta.url), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('../../../spec/v0.4/fixtures/inventory-v1.schema.json', import.meta.url), 'utf8'));
const pair = generateKeyPairSync('ed25519');
const key = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const authority = { company_id: fixture.scope.company_id, resource_id: fixture.scope.pool_id, allowed_public_keys: [key] };
const signEvent = (body: Record<string, any>): SignedEvent => {
  const envelope = { version: '0.4' as const, organization_id: fixture.scope.company_id, resource_id: fixture.scope.pool_id,
    profile_digest: fixture.schema_digest, body: structuredClone(body) };
  const signature = sign(null, Buffer.from(readerCanonical({ domain: 'DTP-INVENTORY-INTEROP-FIXTURE-1', envelope })), pair.privateKey).toString('base64');
  return { envelope, public_key_der: key, signature };
};
const stream = (events = fixture.events): InventoryStream => ({ profile: fixture.profile, semantics: fixture.semantics,
  schema_digest: fixture.schema_digest, schema, scope: fixture.scope, opening_balance: fixture.opening_balance,
  complete: fixture.complete, events: events.map(signEvent) });

const reducerResult = (events: InventoryEvent[]) => {
  let state = createInventoryState(fixture.scope.company_id, fixture.scope.pool_id, fixture.scope.product_id, fixture.scope.base_unit);
  let duplicates = 0;
  for (const event of events) {
    const result = applyInventoryEvent(state, event);
    if (!result.ok) throw new Error(result.code);
    if (result.duplicate) duplicates++;
    state = result.state;
  }
  const reserved = Object.values(state.reservations).reduce((sum, value) => sum + parseDecimal(value, 3), 0n);
  return { status: 'known', on_hand: state.on_hand, reserved: formatDecimal(reserved, 3),
    available: formatDecimal(parseDecimal(state.on_hand, 3) - reserved, 3), revision: state.revision,
    unique_observations: Object.keys(state.observations).length, duplicate_observations: duplicates,
    reservations: Object.fromEntries(Object.entries(state.reservations).map(([id, value]) => [JSON.parse(id)[0], value])),
    pack_versions: Object.keys(state.packaging).length };
};

test('pinned inventory schema and two separately coded consumers agree with explicit fixture result', () => {
  assert.equal(readerDigest(schema), fixture.schema_digest);
  assert.deepEqual(readInventory(stream(), authority), fixture.expected);
  assert.deepEqual(reducerResult(fixture.events), fixture.expected);
});

test('consumers agree after each accepted prefix, including partial fulfillment and late observations', () => {
  for (let length = 0; length <= fixture.events.length; length++) {
    const prefix = fixture.events.slice(0, length);
    assert.deepEqual(readInventory(stream(prefix), authority), reducerResult(prefix), `prefix ${length}`);
  }
  const partial = readInventory(stream(fixture.events.slice(0, 4)), authority);
  assert.deepEqual(partial.reservations, { 'order-a': '60' });
  assert.equal(partial.on_hand, '84');
});

test('consumer rejects unsupported semantics, unknown profile and mutation behind pinned schema digest', () => {
  assert.throws(() => readInventory({ ...stream(), semantics: 'inventory-v2' }, authority), /incompatible_profile/);
  assert.throws(() => readInventory({ ...stream(), profile: 'another.inventory/1' }, authority), /incompatible_profile/);
  const changed = structuredClone(schema); changed.properties.quantity.maxLength++;
  assert.throws(() => readInventory({ ...stream(), schema: changed }, authority), /incompatible_profile/);
});

test('unknown or incomplete inventory remains unknown, never default zero', () => {
  const empty = stream([]);
  const known = readInventory(empty, authority);
  assert.equal(known.status, 'known'); assert.equal(known.on_hand, '0');
  for (const input of [{ ...empty, opening_balance: { status: 'unknown' as const } }, { ...stream(), complete: false }]) {
    assert.deepEqual(readInventory(input, authority), { status: 'unknown', reason: 'incomplete_opening_or_history' });
  }
});

test('consumer verifies signed event binding and trusted key without SDK signing helpers', () => {
  const tampered = stream(); tampered.events[1].envelope.body.quantity = '10000';
  assert.throws(() => readInventory(tampered, authority), /invalid_signature/);
  assert.throws(() => readInventory(stream(), { ...authority, allowed_public_keys: [] }), /untrusted_signer/);
  assert.throws(() => readInventory(stream(), { ...authority, resource_id: 'another-resource' }), /unauthorized_scope/);
  const otherCompany = structuredClone(fixture.events); otherCompany[1].company_id = '33333333-3333-3333-3333-333333333333';
  assert.throws(() => readInventory(stream(otherCompany), authority), /event_scope_mismatch/);
});

test('both consumers reject conflicting observation reuse, stale allocation and unpinned conversions', () => {
  const conflicting = structuredClone(fixture.events); conflicting.at(-1).quantity = '11';
  const stale = structuredClone(fixture.events); stale[2].expected_revision = 1;
  const wrongPack = structuredClone(fixture.events); wrongPack[1].packaging_pin.digest = '0'.repeat(64);
  const oversell = structuredClone(fixture.events); oversell[2].quantity = '11';
  for (const events of [conflicting, stale, wrongPack, oversell]) {
    assert.throws(() => readInventory(stream(events), authority));
    assert.throws(() => reducerResult(events));
  }
});

test('a different packaging version cannot retroactively multiply a pinned historical fulfillment', () => {
  const events = structuredClone(fixture.events);
  events[6].packaging.version = '1';
  assert.throws(() => readInventory(stream(events), authority), /packaging_conflict/);
  assert.throws(() => reducerResult(events), /packaging_conflict/);
});

test('both consumers reject undeclared event fields, empty observation identity and unsupported units', () => {
  for (const mutation of [{ source_id: '' }, { reservation_id: 'hidden-meaning' }, { unit: 'liter' }]) {
    const events = structuredClone(fixture.events);
    Object.assign(events[1], mutation);
    assert.throws(() => readInventory(stream(events), authority));
    assert.throws(() => reducerResult(events));
  }
});
