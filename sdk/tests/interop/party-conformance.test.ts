import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPartyContinuity, validateParty } from '../../src/profiles/party.ts';
import { readerDigest } from './product-reader.ts';
import { readParty, readPartyContinuity } from './party-reader.ts';

const load = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const party = load('../../../spec/profiles/party/1/fixtures.json'), contract = load('../../../spec/profiles/party/1/profile.json');

test('second implementation of party@1: the reader judges every fixture body and continuity pair exactly as required, and agrees with the reference on which paths fail', () => {
  assert.equal(readerDigest(contract), party.contract_digest);
  for (const v of party.accept) assert.deepEqual(readParty(v.body), [], v.why);
  for (const v of party.reject) {
    const mine = readParty(v.body), reference = validateParty(v.body);
    assert.ok(mine.length > 0, v.why);
    assert.deepEqual(new Set(mine.map(i => i.path)), new Set(reference.map(i => i.path)), `${v.why}: both implementations blame the same fields`);
  }
  for (const v of party.continuity.accept) assert.deepEqual(readPartyContinuity(v.previous, v.next), [], v.why);
  for (const v of party.continuity.reject) {
    const mine = readPartyContinuity(v.previous, v.next), reference = checkPartyContinuity(v.previous, v.next);
    assert.ok(mine.length > 0, v.why); assert.deepEqual(mine.map(i => i.path), reference.map(i => i.path), v.why);
  }
});
