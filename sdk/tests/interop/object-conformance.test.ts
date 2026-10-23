import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkObjectContinuity, checkObjectGenesis, validateObject } from '../../src/profiles/object.ts';
import { validateAct } from '../../src/profiles/act.ts';
import { readerDigest } from './product-reader.ts';
import { classValid, readAct, readOwnership, readRef } from './verb-datatypes-reader.ts';
import { readObject, readObjectContinuity, readObjectGenesis } from './object-reader.ts';

const load = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const vectors = load('../../../spec/vectors/verb-datatypes.json');
const object = load('../../../spec/profiles/object/1/fixtures.json'), objectContract = load('../../../spec/profiles/object/1/profile.json');
const paths = (issues: { path: string }[]) => issues.map(i => i.path);

test('second implementation of the verb-layer datatypes: references, act headers, ownership and classes judged as the vectors state', () => {
  for (const v of vectors.refs.accept) assert.deepEqual(readRef(v.value, '$'), [], v.why);
  for (const v of vectors.refs.reject) assert.ok(readRef(v.value, '$').length > 0, v.why);
  for (const v of vectors.acts.accept) assert.deepEqual(readAct(v.value), [], v.why);
  for (const v of vectors.acts.reject) { const mine = readAct(v.value); assert.ok(mine.length > 0, v.why); assert.deepEqual(new Set(paths(mine)), new Set(paths(validateAct(v.value))), v.why); }
  for (const v of vectors.ownership) assert.equal(readOwnership(v.act, v.organization_id), v.outcome === 'accept', v.why);
  for (const v of vectors.classes) assert.equal(classValid(v.name), v.valid, v.name);
});

test('second implementation of object@1: bodies, genesis and continuity judged exactly, blaming the same fields as the reference', () => {
  assert.equal(readerDigest(objectContract), object.contract_digest);
  for (const v of object.accept) assert.deepEqual(readObject(v.body), [], v.why);
  for (const v of object.reject) { const mine = readObject(v.body); assert.ok(mine.length > 0, v.why); assert.deepEqual(new Set(paths(mine)), new Set(paths(validateObject(v.body))), v.why); }
  for (const v of object.genesis.accept) assert.deepEqual(readObjectGenesis(v.body), [], v.why);
  for (const v of object.genesis.reject) assert.deepEqual(paths(readObjectGenesis(v.body)), paths(checkObjectGenesis(v.body)), v.why);
  for (const v of object.continuity.accept) assert.deepEqual(readObjectContinuity(v.previous, v.next), [], v.why);
  for (const v of object.continuity.reject) { const mine = readObjectContinuity(v.previous, v.next); assert.ok(mine.length > 0, v.why); assert.deepEqual(paths(mine), paths(checkObjectContinuity(v.previous, v.next)), v.why); }
});
