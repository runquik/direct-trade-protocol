// Builds spec/vectors/key-registration.json: public keys a conforming host MUST accept or MUST refuse where a key
// enters an identity or authority record (#47). The small-order and mixed-order points reuse the ed25519-speccheck
// keys of Chalkias, Garillot and Nikolaenko, "Taming the Many EdDSAs" (2020), Apache-2.0, where they apply.
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeKeyId } from '../src/keys.ts';

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const fixedKey: string = JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8')).public_key_hex;

type Case = [name: string, expected: 'accept' | 'refuse', order: 'prime' | 'small' | 'mixed' | 'invalid', why: string, publicKey: string];
const cases: Case[] = [
  ['fixed key', 'accept', 'prime', 'the key of spec/vectors/keys.json, made by RFC 8032 key generation', fixedKey],
  ['speccheck prime-order key', 'accept', 'prime', 'the key of speccheck cases 6 and 7', '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623'],
  ['identity, canonical', 'refuse', 'small', 'the identity point (order 1): with R the identity and S = 0, every message verifies (signature-verification.json, "identity A, canonical")', '01' + '00'.repeat(31)],
  ['identity, y >= p', 'refuse', 'invalid', 'the identity point encoded with y = p + 1: non-canonical (RFC 8032 5.1.3)', 'ee' + 'ff'.repeat(30) + '7f'],
  ['identity, sign bit set', 'refuse', 'invalid', 'the identity point with x = 0 and the sign bit set: non-canonical (RFC 8032 5.1.3)', '01' + '00'.repeat(30) + '80'],
  ['order 2', 'refuse', 'small', 'the point (0, -1)', 'ec' + 'ff'.repeat(30) + '7f'],
  ['order 2, sign bit set', 'refuse', 'invalid', 'the point (0, -1) with the sign bit set: non-canonical; the A of speccheck cases 10 and 11', 'ec' + 'ff'.repeat(31)],
  ['order 4, x even', 'refuse', 'small', 'a point with y = 0', '00'.repeat(32)],
  ['order 4, x odd', 'refuse', 'small', 'a point with y = 0', '00'.repeat(31) + '80'],
  ['order 8, first', 'refuse', 'small', 'an order-8 point', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'],
  ['order 8, second', 'refuse', 'small', 'an order-8 point; the A of speccheck cases 0 and 1', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa'],
  ['order 8, third', 'refuse', 'small', 'an order-8 point', '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05'],
  ['order 8, fourth', 'refuse', 'small', 'an order-8 point', '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85'],
  ['mixed order, speccheck 2', 'refuse', 'mixed', 'a prime-order point plus a small-order component; the A of speccheck cases 2, 8 and 9', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43'],
  ['mixed order, speccheck 3', 'refuse', 'mixed', 'a prime-order point plus a small-order component; the A of speccheck cases 3, 4 and 5', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d'],
  ['not on the curve', 'refuse', 'invalid', 'y = 2 has no x on the curve', '02' + '00'.repeat(31)],
];

const out = {
  description: 'Ed25519 public keys a conforming host MUST accept or MUST refuse where a key enters an identity or authority record: person founding and key rotation, foundation identity genesis, rotation, recovery and recovery-policy changes, and installation keys. A host that accepts a case marked "refuse", or refuses one marked "accept", is non-conforming. Signature verification is not affected: see signature-verification.json.',
  rule: 'Accept a key only if its encoding is canonical (RFC 8032 section 5.1.3) and decodes to a curve point of prime order L: [8]A is not the identity and [L]A is the identity. This refuses the eight small-order points, mixed-order points, non-canonical encodings and encodings of no point.',
  sources: 'small-order and mixed-order keys: Chalkias, Garillot and Nikolaenko, "Taming the Many EdDSAs" (2020), ed25519-speccheck cases.json (Apache-2.0); fixed key: spec/vectors/keys.json',
  cases: cases.map(([name, expected, order, why, pub]) => ({ name, expected, order, why, public_key_hex: pub, key_id: encodeKeyId(hex(pub)) })),
};
writeFileSync(new URL('../../spec/vectors/key-registration.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
