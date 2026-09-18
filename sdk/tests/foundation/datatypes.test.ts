import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntityReference, parseRevisionReference, parseExternalIdentifier, externalIdentifierKey,
  entityReferenceKey, parseKnowledge, parseLocalDate, parseInstant, parseTimeZone,
  parseDateInterval, parseInstantInterval, parseTemporalValues, parseProvenance, DatatypeError } from '../../src/foundation/datatypes.ts';

const company = '11111111-1111-4111-8111-111111111111';
const another = '22222222-2222-4222-8222-222222222222';
const recordId = '33333333-3333-4333-8333-333333333333';
const revisionId = '44444444-4444-4444-8444-444444444444';
const org = { kind: 'organization', id: company, organization_id: null };
const resource = { kind: 'resource', id: recordId, organization_id: company };
const revision = { entity: resource, revision_id: revisionId, digest: 'a'.repeat(64) };
const times = { observed_at: '2024-02-29T00:00:00.000Z', effective_at: null, accepted_at: '2024-03-02T00:00:00.000Z' };
const provenance = () => ({ kind: 'assessment', issuer: org, inputs: [revision], completeness: 'partial', missing_inputs: [{ state: 'withheld' }], times, causation: null, correlation_id: null });
const denied = (error: unknown) => error instanceof DatatypeError;

test('foundation references: company-local resources differ across organizations and core kinds', () => {
  assert.deepEqual(parseEntityReference(org), org);
  assert.notEqual(entityReferenceKey(resource), entityReferenceKey({ ...resource, organization_id: another }));
  assert.notEqual(entityReferenceKey(resource), entityReferenceKey({ ...resource, kind: 'record' }));
  const parsed = parseRevisionReference(revision); assert.deepEqual(parsed, revision); assert.notEqual(parsed.entity, resource);
  assert.throws(() => parseEntityReference({ ...org, organization_id: company }), denied);
  assert.throws(() => parseEntityReference({ ...resource, organization_id: null }), denied);
  assert.throws(() => parseEntityReference({ ...resource, kind: 'facility' }), denied);
});

test('foundation references: exact revision and lowercase identity bytes are mandatory', () => {
  for (const value of [{ ...revision, revision_id: 'latest' }, { ...revision, digest: 'A'.repeat(64) }, { ...revision, digest: 'a'.repeat(63) }, { ...revision, url: 'https://example.test' }]) assert.throws(() => parseRevisionReference(value), denied);
  assert.throws(() => parseEntityReference({ ...org, id: 'ABCDEFAB-1111-4111-8111-111111111111' }), denied);
  assert.throws(() => parseEntityReference({ ...org, id: ' 11111111-1111-4111-8111-111111111111' }), denied);
});

test('foundation identifiers: issuer and type are essential, values are preserved without alias claims', () => {
  const identifier = { issuer: org, type: 'product.sku', value: 'HAB-5' };
  const parsed = parseExternalIdentifier(identifier); assert.deepEqual(parsed, identifier); assert.notEqual(parsed.issuer, org);
  assert.notEqual(externalIdentifierKey(identifier), externalIdentifierKey({ ...identifier, issuer: { ...org, id: another } }));
  assert.notEqual(externalIdentifierKey(identifier), externalIdentifierKey({ ...identifier, type: 'invoice.number' }));
  assert.notEqual(externalIdentifierKey(identifier), externalIdentifierKey({ ...identifier, value: 'hab-5' }));
  assert.notEqual(externalIdentifierKey({ ...identifier, type: 'a', value: 'b:c' }), externalIdentifierKey({ ...identifier, type: 'a.b', value: 'c' }));
  assert.throws(() => parseExternalIdentifier({ ...identifier, issuer: resource }), denied);
  for (const value of ['', ' secret ', 'x\n', '\ud800', 'x'.repeat(513)]) assert.throws(() => parseExternalIdentifier({ ...identifier, value }), denied);
});

test('foundation knowledge: known zero differs from every non-value state', () => {
  let parses = 0;
  const valueParser = (value: unknown) => { parses++; assert.equal(value, '0'); return value as string; };
  assert.deepEqual(parseKnowledge({ state: 'known', value: '0' }, valueParser), { state: 'known', value: '0' });
  for (const state of ['absent', 'unknown', 'withheld', 'not_applicable']) {
    assert.deepEqual(parseKnowledge({ state }, valueParser), { state });
    assert.throws(() => parseKnowledge({ state, value: '0' }, valueParser), denied);
  }
  assert.equal(parses, 1);
  for (const value of [{}, null, { state: 'known' }, { state: 'known', value: undefined }, { state: 'verified' }]) assert.throws(() => parseKnowledge(value, valueParser), denied);
});

test('foundation dates: real Gregorian dates include leap centuries and the early-year edge', () => {
  for (const date of ['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31']) assert.equal(parseLocalDate(date), date);
  for (const date of ['0000-01-01', '1900-02-29', '2023-02-29', '2024-04-31', '2024-1-01', '2024-00-01', '2024-01-00', '2024-01-32', '2024-01-01T00:00:00Z']) assert.throws(() => parseLocalDate(date), denied);
});

test('foundation instants: explicit UTC precision rejects offsets, rollover and precision loss', () => {
  for (const time of ['0001-01-01T00:00:00.000Z', '2024-02-29T23:59:59.999Z']) assert.equal(parseInstant(time), time);
  for (const time of ['2024-02-30T00:00:00.000Z', '2024-02-29T24:00:00.000Z', '2024-02-29T23:59:60.000Z', '2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000001Z', '2024-02-29T00:00:00.000-06:00', '2024-02-29T00:00:00.000z']) assert.throws(() => parseInstant(time), denied);
});

test('foundation timezones: support is explicit and local, never inferred from plausible spelling', () => {
  assert.equal(parseTimeZone('UTC'), 'UTC');
  assert.equal(parseTimeZone('America/Chicago', ['UTC', 'America/Chicago']), 'America/Chicago');
  assert.throws(() => parseTimeZone('America/Chicago'), denied);
  assert.throws(() => parseTimeZone('America/Imaginary', ['America/Chicago']), denied);
  for (const zone of ['https://example.test', '../UTC', 'UTC ', 'EST']) assert.throws(() => parseTimeZone(zone, [zone]), denied);
  assert.throws(() => parseTimeZone('UTC', ['UTC', 'UTC']), denied);
});

test('foundation temporal fields remain separate; intervals are nonempty and half-open', () => {
  assert.deepEqual(parseTemporalValues(times), times);
  // Business effect may be scheduled after acceptance; do not invent a causal ordering.
  assert.equal(parseTemporalValues({ ...times, effective_at: '2025-01-01T00:00:00.000Z' }).effective_at, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(parseDateInterval({ start: '2024-02-29', end: '2024-03-01' }), { start: '2024-02-29', end: '2024-03-01' });
  assert.deepEqual(parseInstantInterval({ start: times.observed_at, end: times.accepted_at }), { start: times.observed_at, end: times.accepted_at });
  for (const end of ['2024-02-29', '2024-02-28']) assert.throws(() => parseDateInterval({ start: '2024-02-29', end }), denied);
  assert.throws(() => parseInstantInterval({ start: times.accepted_at, end: times.observed_at }), denied);
  assert.throws(() => parseTemporalValues({ ...times, effective_at: { state: 'unknown' } }), denied);
});

test('foundation provenance: claims distinguish business observations, commitments and assessments', () => {
  for (const kind of ['command', 'observation', 'commitment', 'attestation', 'assessment']) {
    const input = { ...provenance(), kind }, parsed = parseProvenance(input);
    assert.deepEqual(parsed, input); assert.notEqual(parsed.inputs, input.inputs); assert.notEqual(parsed.inputs[0].entity, resource);
  }
  const complete = { ...provenance(), completeness: 'complete', missing_inputs: [] };
  assert.equal(parseProvenance(complete).completeness, 'complete');
  assert.equal(parseProvenance({ ...complete, completeness: 'unknown' }).completeness, 'unknown');
  assert.throws(() => parseProvenance({ ...provenance(), completeness: 'complete' }), denied);
  assert.throws(() => parseProvenance({ ...complete, completeness: 'partial' }), denied);
});

test('foundation provenance: duplicate, conflicting and simultaneously missing inputs are rejected', () => {
  assert.throws(() => parseProvenance({ ...provenance(), inputs: [revision, revision] }), denied);
  assert.throws(() => parseProvenance({ ...provenance(), inputs: [revision, { ...revision, digest: 'b'.repeat(64) }] }), denied);
  assert.throws(() => parseProvenance({ ...provenance(), missing_inputs: [{ state: 'known', value: revision }] }), denied);
  const missing = { ...revision, revision_id: another };
  assert.deepEqual(parseProvenance({ ...provenance(), missing_inputs: [{ state: 'known', value: missing }] }).missing_inputs, [{ state: 'known', value: missing }]);
  assert.throws(() => parseProvenance({ ...provenance(), inputs: Array(65).fill(revision) }), denied);
  assert.throws(() => parseProvenance({ ...provenance(), missing_inputs: Array(65).fill({ state: 'unknown' }) }), denied);
});

test('foundation validators: hostile object shapes reject without invoking getters or stripping keys', () => {
  let calls = 0;
  const getter = { ...org }; Object.defineProperty(getter, 'id', { get() { calls++; return company; }, enumerable: true });
  for (const value of [getter, Object.create(org), new Date(), [], null,
    JSON.parse('{"kind":"organization","id":"' + company + '","organization_id":null,"__proto__":{}}'),
    { ...org, constructor: 'trap' }, { ...org, [Symbol('hidden')]: true }]) assert.throws(() => parseEntityReference(value), denied);
  assert.equal(calls, 0);
  const hidden = { ...org }; Object.defineProperty(hidden, 'undeclared', { value: true, enumerable: false });
  assert.throws(() => parseEntityReference(hidden), denied);
  const nullProto = Object.assign(Object.create(null), org); assert.deepEqual(parseEntityReference(nullProto), org);
  for (const array of [Array(1), Object.assign([revision], { unrelated: true }), Object.assign(Object.create(Array.prototype), { 0: revision, length: 1 })]) assert.throws(() => parseProvenance({ ...provenance(), inputs: array }), denied);
  const accessorArray = [revision]; Object.defineProperty(accessorArray, '0', { get() { calls++; return revision; }, enumerable: true });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: accessorArray }), denied); assert.equal(calls, 0);
});

test('foundation validation errors identify paths without disclosing rejected values', () => {
  const secret = 'SYNTHETIC-PRIVATE-EMPLOYEE-IDENTIFIER';
  try { parseRevisionReference({ ...revision, entity: { ...resource, id: secret } }); assert.fail('invalid value accepted'); }
  catch (error) { assert.ok(error instanceof DatatypeError); assert.equal(error.path, '$.entity.id'); assert.ok(!error.message.includes(secret)); }
});
