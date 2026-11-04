// Gap test for #149. Expected-observation test: a passing GAP case reproduces a deficiency; it does not certify the behaviour.
// spec/core-1/README.md part 1 defines signable JSON as I-JSON with three further rules, and sets no nesting limit.
// Part 3, as amended by #125, says a verifier refuses an envelope with `invalid_signature` or `invalid_envelope`
// "for anything else". The reference canonicalizer recurses once per nesting level with no bound, so a small, deeply
// nested body overflows the stack. Its answer then depends on the process's stack size, not on the bytes, and
// the refusal is a RangeError, not an EnvelopeError.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EnvelopeError, signEnvelope, verifyEnvelope } from '../src/core1/envelope.ts';
import { canonicalize } from '../src/canonical.ts';

const DOMAIN = 'DTP-RECORD-1';
const secret = JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8')).secret_key as string;
const nested = (depth: number): unknown => { let v: unknown = 0; for (let i = 0; i < depth; i++) v = [v]; return v; };
// 10,000 levels is about 20 KB of JSON: far inside verifyEnvelope's default 65,536-byte signing-input ceiling, and
// several times past the depth (about 1,875 on Node v22.23.2) where the default stack overflows.
const DEEP = 10_000;

test('control: a moderately nested body signs and verifies', async () => {
  const env = await signEnvelope(DOMAIN, nested(500), [secret]);
  const { signers } = await verifyEnvelope(DOMAIN, env);
  assert.equal(signers.size, 1);
});

test('GAP: canonicalization of a ~20 KB nested body throws a stack overflow, though Core-1 sets no depth limit', () => {
  assert.ok(2 * DEEP + 1 < 65_536, 'the body is [[[...0...]]]: 2 bytes per level, plus the 0');
  assert.throws(() => canonicalize(nested(DEEP)), RangeError);
});

test('GAP: verifyEnvelope answers a ~20 KB nested envelope with a RangeError, not an EnvelopeError', async () => {
  // A signature cannot be made with the reference here (signing overflows too), so any signature will do: the
  // body is canonicalized before any signature is checked.
  const envelope = { body: nested(DEEP), signatures: [{ key_id: JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8')).key_id, signature: 'ed25519:1' }] };
  await assert.rejects(verifyEnvelope(DOMAIN, envelope), (e: unknown) => e instanceof RangeError && !(e instanceof EnvelopeError));
});
