import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { sha256HexSync } from '../../src/sha256.ts';
import { canonicalize, sha256Hex } from '../../src/canonical.ts';

const reference = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

test('synchronous SHA-256 matches the published FIPS 180-4 vectors', () => {
  assert.equal(sha256HexSync(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256HexSync('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('it agrees with the platform implementation at every padding boundary and on random input', async () => {
  for (let length = 0; length <= 300; length++) {
    const bytes = randomBytes(length);
    assert.equal(sha256HexSync(bytes), reference(bytes), `length ${length}`);
  }
  const samples = ['240 cases of rigatoni', String.fromCharCode(0), String.fromCodePoint(0x1f35d).repeat(40),
    String.fromCharCode(0x65e5, 0x672c, 0x8a9e), canonicalize({ b: [1, '2', null], a: { z: true } })];
  for (const text of samples) {
    assert.equal(sha256HexSync(text), reference(text));
    assert.equal(sha256HexSync(text), await sha256Hex(text), 'matches the asynchronous WebCrypto helper');
  }
});

test('code meant to run in any runtime imports nothing platform-specific', () => {
  // Profile reducers and the hashing/canonical core must load in browsers and edge runtimes.
  const portable = ['../../src/sha256.ts', '../../src/canonical.ts',
    ...readdirSync(new URL('../../src/profiles/', import.meta.url)).map(name => '../../src/profiles/' + name)];
  for (const file of portable) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:node:[a-z/_]+|fs|crypto|path|os|buffer)['"]|\brequire\(|\bprocess\.|\bBuffer\b|\bDeno\./, file);
  }
});
