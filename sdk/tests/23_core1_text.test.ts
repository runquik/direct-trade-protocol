// Core-1 part 1, integer literals (#217). A received Core-1 text that writes a number with a fraction or an exponent is
// refused before parsing (non_integer_number), so whether it is valid depends on its bytes alone, not on how a parser
// converts numbers. Every reject vector is an accepted text with one integer re-spelled: it still verifies after a
// binary64 parse, which is what this file also checks, so the vectors catch a host that checks numbers after parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCore1Text, verifyEnvelope } from '../src/core1/envelope.ts';
import { verifyRecord } from '../src/core1/record.ts';
import { UnsafeJsonError } from '../src/safe-json.ts';

const vectors = JSON.parse(readFileSync(new URL('../../spec/core-1/vectors/text.json', import.meta.url), 'utf8'));
const unsafe = JSON.parse(readFileSync(new URL('../../spec/vectors/unsafe-json.json', import.meta.url), 'utf8'));

async function verify(v: any, value: unknown) {
  if (v.domain === 'DTP-RECORD-1') {
    const { digest, signers } = await verifyRecord(value, { profile: v.profile });
    return { digest, signers: [...signers] };
  }
  const { signers } = await verifyEnvelope(v.domain, value);
  return { digest: undefined, signers: [...signers] };
}

test('the vectors are what the generator writes, with accepts and rejects', () => {
  assert.equal(vectors.accept.length, 2);
  assert.equal(vectors.reject.length, 5);
});

test('every accept text parses and verifies, with its digest and signers', async () => {
  for (const v of vectors.accept) {
    const got = await verify(v, parseCore1Text(v.text));
    assert.deepEqual(got.signers, v.signers, v.why);
    if (v.digest) assert.equal(got.digest, v.digest, v.why);
    const bytes = await verify(v, parseCore1Text(new TextEncoder().encode(v.text)));
    assert.deepEqual(bytes.signers, v.signers, v.why);
  }
});

test('every reject text is refused before parsing with its code, as a string and as bytes', () => {
  for (const v of vectors.reject) {
    for (const input of [v.text, new TextEncoder().encode(v.text)]) {
      assert.throws(() => parseCore1Text(input), (e: unknown) => e instanceof UnsafeJsonError && e.code === v.code, v.why);
    }
  }
});

test('every reject text still verifies after a binary64 parse, so only the lexical check refuses it', async () => {
  for (const v of vectors.reject) {
    const accepted = vectors.accept.find((a: any) => a.domain === v.domain);
    const got = await verify(v, JSON.parse(v.text));
    assert.deepEqual(got.signers, accepted.signers, v.why);
    if (accepted.digest) assert.equal(got.digest, accepted.digest, v.why);
  }
});

test('a Core-1 receiver applies the numbers section of unsafe-json.json, and still the member-name rules', () => {
  for (const v of unsafe.numbers.reject) assert.throws(() => parseCore1Text(v.text), (e: unknown) => e instanceof UnsafeJsonError && e.code === v.code, v.why);
  for (const v of unsafe.numbers.accept) assert.doesNotThrow(() => parseCore1Text(v.text), v.why);
  for (const v of unsafe.reject) assert.throws(() => parseCore1Text(v.text), (e: unknown) => e instanceof UnsafeJsonError && e.code === v.code, v.why);
  for (const v of unsafe.accept) assert.doesNotThrow(() => parseCore1Text(v.text), v.why);
});
