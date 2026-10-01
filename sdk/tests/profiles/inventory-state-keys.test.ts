import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { canonicalize } from '../../src/canonical.ts';
import { inventoryKey } from '../../src/profiles/inventory.ts';

const text = readFileSync(new URL('../../../spec/vectors/inventory-state-keys.json', import.meta.url), 'utf8');
const vectors = parseUntrustedJson(text) as { cases: { why: string; tuple: unknown[]; canonical: string; key: string }[]; refuse: { why: string; key: string }[] };
const DIGEST = /^[0-9a-f]{64}$/;

test('inventory state keys: each vector key is the SHA-256 of the canonical tuple, and the reducer derives the same key', () => {
  assert.ok(vectors.cases.length >= 5);
  for (const c of vectors.cases) {
    assert.equal(canonicalize(c.tuple), c.canonical, c.why);
    assert.equal(createHash('sha256').update(c.canonical, 'utf8').digest('hex'), c.key, c.why);
    assert.equal(inventoryKey(...c.tuple), c.key, c.why);
    assert.match(c.key, DIGEST, c.why);
  }
});

test('inventory state keys: every refused key falls outside the digest form, and the vector file itself crosses the safe parser', () => {
  assert.ok(vectors.refuse.length >= 3);
  for (const r of vectors.refuse) assert.doesNotMatch(r.key, DIGEST, r.why);
  // A keyed object built from the accepted keys is wire-safe whatever the ids contained.
  parseUntrustedJson(JSON.stringify(Object.fromEntries(vectors.cases.map(c => [c.key, c.why]))));
});
