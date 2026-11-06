// Core-1 part 1 nesting limit (#149; replaces gap test #150). A signed body nests at most 48 levels (the body is level
// 0, each array or object adds one). signEnvelope and verifyEnvelope check this before canonicalizing and without
// recursion, so a deeply nested envelope is refused as invalid_envelope whatever the stack size, never as a RangeError.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EnvelopeError, MAX_DEPTH, signEnvelope, verifyEnvelope } from '../src/core1/envelope.ts';

const DOMAIN = 'DTP-RECORD-1';
const keys = JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8'));
const nested = (depth: number): unknown => { let v: unknown = 0; for (let i = 0; i < depth; i++) v = [v]; return v; };
const deepObject = (depth: number): unknown => { let v: unknown = 'leaf'; for (let i = 0; i < depth; i++) v = { a: v }; return v; };
const invalidEnvelope = (e: unknown) => e instanceof EnvelopeError && e.code === 'invalid_envelope' && /nests deeper than 48/.test(e.message);

test('the Core-1 limit is 48, the v0.4 transport bound', () => { assert.equal(MAX_DEPTH, 48); });

test('a body nested exactly 48 levels signs and verifies; 49 is refused on both sides', async () => {
  for (const make of [nested, deepObject]) {
    const env = await signEnvelope(DOMAIN, make(48), [keys.secret_key]);
    assert.deepEqual([...(await verifyEnvelope(DOMAIN, env)).signers], [keys.key_id]);
    await assert.rejects(signEnvelope(DOMAIN, make(49), [keys.secret_key]), invalidEnvelope);
    await assert.rejects(verifyEnvelope(DOMAIN, { body: make(49), signatures: env.signatures }), invalidEnvelope);
  }
});

test('a ~20 KB envelope nested 10,000 levels is invalid_envelope, not a stack overflow', async () => {
  const body = nested(10_000);
  assert.ok(2 * 10_000 + 1 < 65_536, 'the body is [[[...0...]]], 2 bytes per level plus the 0: inside the default signing-input ceiling');
  await assert.rejects(verifyEnvelope(DOMAIN, { body, signatures: [{ key_id: keys.key_id, signature: 'ed25519:1' }] }), invalidEnvelope);
  await assert.rejects(signEnvelope(DOMAIN, body, [keys.secret_key]), invalidEnvelope);
});

test('the depth is checked before the signature: a deep body with a malformed signature is still invalid_envelope', async () => {
  await assert.rejects(verifyEnvelope(DOMAIN, { body: nested(49), signatures: [{ key_id: keys.key_id, signature: 'ed25519:1' }] }), invalidEnvelope);
});
