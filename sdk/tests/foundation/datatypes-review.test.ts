import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatatypeError, parseEntityReference, entityReferenceKey, externalIdentifierKey,
  parseKnowledge, parseLocalDate, parseInstant, parseInstantInterval, parseTimeZone,
  parseProvenance } from '../../src/foundation/datatypes.ts';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
const org = { kind: 'organization', id: a, organization_id: null };
const reference = () => ({ entity: { kind: 'record', id: b, organization_id: a }, revision_id: c, digest: 'a'.repeat(64) });
const provenance = () => ({ kind: 'assessment', issuer: org, inputs: [reference()], completeness: 'complete',
  missing_inputs: [], times: { observed_at: null, effective_at: null, accepted_at: null }, causation: null, correlation_id: null });
const denied = (error: unknown) => error instanceof DatatypeError;

test('independent datatype review: nested accessors, array accessors and hostile prototypes never run', () => {
  let calls = 0;
  const poison = () => { calls++; throw new Error('SYNTHETIC-SECRET'); };
  const nested = reference(); Object.defineProperty(nested.entity, 'id', { enumerable: true, get: poison });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: [nested] }), denied);
  const array = [reference()]; Object.defineProperty(array, '0', { enumerable: true, get: poison });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: array }), denied);
  const inherited = Object.create({ toJSON: poison }); Object.assign(inherited, org);
  assert.throws(() => parseEntityReference(inherited), denied);
  const knowledge = {}; Object.defineProperty(knowledge, 'state', { enumerable: true, get: poison });
  assert.throws(() => parseKnowledge(knowledge, poison), denied);
  assert.equal(calls, 0);
});

test('independent datatype review: dense collection bounds apply before child validation', () => {
  let calls = 0;
  const values = Array.from({ length: 65 }, () => reference());
  Object.defineProperty(values, '0', { enumerable: true, get() { calls++; return reference(); } });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: values }), denied);
  const hidden = [reference()]; Object.defineProperty(hidden, 'metadata', { value: 'secret' });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: hidden }), denied);
  const symbols = [reference()]; Object.defineProperty(symbols, Symbol('metadata'), { value: 'secret' });
  assert.throws(() => parseProvenance({ ...provenance(), inputs: symbols }), denied);
  assert.throws(() => parseTimeZone('UTC', Array(1025).fill('UTC')), denied);
  assert.equal(calls, 0);
});

test('independent datatype review: typed company-local identifiers cannot collide with global IDs', () => {
  const identifiers = [org, { ...org, kind: 'person' },
    { kind: 'service', id: a, organization_id: a }, { kind: 'service', id: a, organization_id: b },
    { kind: 'resource', id: a, organization_id: a }, { kind: 'record', id: a, organization_id: a }];
  assert.equal(new Set(identifiers.map(entityReferenceKey)).size, identifiers.length);
  const identifier = { issuer: org, type: 'sku', value: 'café' };
  assert.notEqual(externalIdentifierKey(identifier), externalIdentifierKey({ ...identifier, value: 'cafe\u0301' }), 'exact claims do not silently normalize Unicode aliases');
  assert.notEqual(externalIdentifierKey(identifier), externalIdentifierKey({ ...identifier, issuer: identifiers[2] }));
});

test('independent datatype review: century rules and smallest supported instant intervals are explicit', () => {
  for (const year of ['0400', '1600', '2000', '2400', '9600']) assert.equal(parseLocalDate(`${year}-02-29`), `${year}-02-29`);
  for (const year of ['0100', '1700', '1800', '1900', '2100', '9900']) assert.throws(() => parseLocalDate(`${year}-02-29`), denied);
  const start = '9999-12-31T23:59:59.998Z', end = '9999-12-31T23:59:59.999Z';
  assert.deepEqual(parseInstantInterval({ start, end }), { start, end });
  for (const value of ['0000-01-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z', '2024-01-01T00:60:00.000Z']) assert.throws(() => parseInstant(value), denied);
});

test('independent datatype review: unsupported knowledge never invokes the trusted value parser', () => {
  let calls = 0; const parse = (v: unknown) => { calls++; return v; };
  for (const state of ['absent', 'unknown', 'withheld', 'not_applicable']) assert.deepEqual(parseKnowledge({ state }, parse), { state });
  assert.throws(() => parseKnowledge({ state: 'withheld', value: 'SYNTHETIC-SECRET' }, parse), denied);
  assert.equal(calls, 0);
});

test('independent datatype review: causation may share an exact input revision but not contradict its digest', () => {
  const valid = { ...provenance(), causation: reference() };
  assert.deepEqual(parseProvenance(valid).causation, reference(), 'causal input can also be an explicit data input');
  assert.throws(() => parseProvenance({ ...valid, causation: { ...reference(), digest: 'b'.repeat(64) } }), denied,
    'one revision identity cannot denote different bytes in inputs and causation');
});

test('independent datatype review: unavailable causal input retains a consistent exact digest', () => {
  const valid = { ...provenance(), inputs: [], completeness: 'partial', missing_inputs: [{ state: 'known', value: reference() }], causation: reference() };
  assert.deepEqual(parseProvenance(valid).causation, reference(), 'knowing a causal reference does not claim its content is available');
  assert.throws(() => parseProvenance({ ...valid, causation: { ...reference(), digest: 'b'.repeat(64) } }), denied,
    'known missing revision cannot have different bytes in causation');
});

test('independent datatype review: parsed provenance does not retain mutable nested caller objects', () => {
  const original = provenance(), parsed = parseProvenance(original);
  original.inputs[0].digest = 'b'.repeat(64); original.inputs[0].entity.organization_id = b;
  assert.equal(parsed.inputs[0].digest, 'a'.repeat(64)); assert.equal(parsed.inputs[0].entity.organization_id, a);
});
