import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { ACT_SCHEMA, CLASS_REGISTRY_FORMAT, OBJECT_CLASSES, checkActOwner, isClassName, isProtocolClass, validateAct, validateObjectRef } from '../../src/profiles/act.ts';
import { OBJECT_KIND, OBJECT_PROFILE, OBJECT_SCHEMA, OBJECT_SEMANTICS, checkObjectContinuity, checkObjectGenesis, checkObjectOwner, isSscc, validateObject } from '../../src/profiles/object.ts';
import type { ObjectBody } from '../../src/profiles/object.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const load = (p: string) => parseUntrustedJson(readFileSync(here(p), 'utf8')) as any;
const vectors = load('../../../spec/vectors/verb-datatypes.json'), classes = load('../../../spec/profiles/classes.json');
const object = load('../../../spec/profiles/object/1/fixtures.json'), objectContract = load('../../../spec/profiles/object/1/profile.json');

test('verb-layer datatypes: vectors judged exactly, the class registry is the reference list, and the generator is reproducible', () => {
  checkSchema(ACT_SCHEMA as any);
  for (const v of vectors.refs.accept) assert.deepEqual(validateObjectRef(v.value, '$'), [], v.why);
  for (const v of vectors.refs.reject) assert.ok(validateObjectRef(v.value, '$').length > 0, v.why);
  for (const v of vectors.acts.accept) { assert.ok(validateShape(ACT_SCHEMA as any, v.value), v.why); assert.deepEqual(validateAct(v.value), [], v.why); }
  for (const v of vectors.acts.reject) assert.ok(validateAct(v.value).length > 0, v.why);
  for (const v of vectors.ownership) assert.equal(checkActOwner(v.act, v.organization_id).length === 0, v.outcome === 'accept', v.why);
  for (const v of vectors.classes) assert.equal(isClassName(v.name) && (!v.name.startsWith('dtp/') || isProtocolClass(v.name)), v.valid, v.name);
  assert.equal(classes.format, CLASS_REGISTRY_FORMAT); assert.deepEqual(classes.classes, [...OBJECT_CLASSES]);
  assert.deepEqual([...OBJECT_CLASSES].sort(), [...OBJECT_CLASSES], 'the class list is kept sorted');
  const run = spawnSync(process.execPath, [here('../../scripts/build-verb-datatypes.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 }); assert.equal(run.status, 0, run.stderr);
});

test('object@1 fixtures: bodies, genesis and continuity are judged exactly; the contract and generator are reproducible', () => {
  assert.equal(object.kind, OBJECT_KIND); assert.equal(object.profile, OBJECT_PROFILE); assert.equal(object.semantics, OBJECT_SEMANTICS);
  assert.ok(object.accept.length >= 5 && object.reject.length >= 12 && object.continuity.accept.length >= 3 && object.continuity.reject.length >= 4);
  checkSchema(objectContract.schema);
  for (const v of object.accept) { assert.ok(validateShape(objectContract.schema, v.body), v.why); assert.deepEqual(validateObject(v.body), [], v.why); }
  for (const v of object.reject) assert.ok(validateObject(v.body).length > 0, v.why);
  for (const v of object.genesis.accept) assert.deepEqual(checkObjectGenesis(v.body), [], v.why);
  for (const v of object.genesis.reject) assert.ok(checkObjectGenesis(v.body).length > 0, v.why);
  for (const v of object.continuity.accept) assert.deepEqual(checkObjectContinuity(v.previous, v.next), [], v.why);
  for (const v of object.continuity.reject) assert.ok(checkObjectContinuity(v.previous, v.next).length > 0, v.why);
  assert.deepEqual(objectContract, { publisher_id: 'dtp', name: 'object', version: '1.0.0', schema: OBJECT_SCHEMA, semantics: OBJECT_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(objectContract), 'utf8').digest('hex'), object.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-object-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 }); assert.equal(run.status, 0, run.stderr);
});

test('object@1 rules beyond the fixtures: SSCC check digits, every protocol class, own references and a retirement that is never a sale', () => {
  assert.ok(isSscc('106141411234567897') && !isSscc('106141411234567890') && !isSscc('10614141123456789') && !isSscc('1061414112345678970'));
  const base = object.accept[0].body as ObjectBody, org = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
  for (const c of OBJECT_CLASSES) assert.deepEqual(validateObject({ ...base, class: c }), [], c);
  const ownSpelledForeign = { ...base, evidence: [{ minted_by: org, root: '11111111-1111-4111-8111-111111111111', record_id: null }] };
  assert.deepEqual(validateObject(ownSpelledForeign), [], 'the shape alone cannot tell');
  assert.deepEqual(checkObjectOwner(ownSpelledForeign, org).map(i => i.path), ['$.evidence[0].minted_by']);
  assert.deepEqual(checkObjectOwner(ownSpelledForeign, '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'), []);
  for (const reason of ['sold', 'transferred', 'deleted']) assert.ok(validateObject({ ...base, status: 'retired', retired: { reason, note: null } }).length > 0, reason);
});
