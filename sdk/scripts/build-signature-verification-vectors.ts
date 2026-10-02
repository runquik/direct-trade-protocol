// Builds spec/vectors/signature-verification.json: Ed25519 signatures a conforming v0.4 verifier MUST accept or
// MUST refuse (#44). Cases 0-11 are the edge cases of Chalkias, Garillot and Nikolaenko, "Taming the Many EdDSAs"
// (2020), copied from the ed25519-speccheck test set (Apache-2.0). The malleated case is derived from the fixed
// key's raw signature in spec/vectors/signatures.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeSignature, encodeKeyId, encodeSignature } from '../src/keys.ts';

const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const littleEndian = (b: Uint8Array) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
const le32 = (x: bigint) => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };

const signatures = JSON.parse(readFileSync(new URL('../../spec/vectors/signatures.json', import.meta.url), 'utf8'));
const raw = decodeSignature(signatures.raw.signature);
const message = toHex(new TextEncoder().encode(signatures.raw.message_utf8));
const keyHex: string = JSON.parse(readFileSync(new URL('../../spec/vectors/keys.json', import.meta.url), 'utf8')).public_key_hex;
const malleated = new Uint8Array([...raw.subarray(0, 32), ...le32(littleEndian(raw.subarray(32)) + L)]);

type Case = [name: string, expected: 'accept' | 'refuse', why: string, message: string, publicKey: string, signature: string];
const cases: Case[] = [
  ['fixed key, canonical', 'accept', 'the raw signature from signatures.json', message, keyHex, toHex(raw)],
  ['fixed key, S + L', 'refuse', 'the same signature with S replaced by S + L: S >= L is not canonical (RFC 8032 5.1.7 step 1)', message, keyHex, toHex(malleated)],
  ['identity A, canonical', 'accept', 'A and R are the identity point and S = 0, so the equation holds for any message: small order is not refused by itself', message, '01' + '00'.repeat(31), '01' + '00'.repeat(63)],
  ['identity A, y >= p', 'refuse', 'the same key encoded with y = p + 1: a non-canonical encoding of A (y >= p)', message, 'ee' + 'ff'.repeat(30) + '7f', '01' + '00'.repeat(63)],
  ['speccheck 0', 'accept', 'small-order A and small-order R, S = 0: small order is not refused by itself', '8c93255d71dcab10e8f379c26200f3c7bd5f09d9bc3068d3ef4edeb4853022b6', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a0000000000000000000000000000000000000000000000000000000000000000'],
  ['speccheck 1', 'accept', 'small-order A, mixed-order R', '9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43a5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
  ['speccheck 2', 'accept', 'mixed-order A, small-order R', 'aebf3f2601a0c8c5d39cc7d8911642f740b78168218da8471772b35f9d35b9ab', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa8c4bd45aecaca5b24fb97bc10ac27ac8751a7dfe1baff8b953ec9f5833ca260e'],
  ['speccheck 3', 'accept', 'mixed-order A and R; the cofactorless equation holds', '9bd9f44f4dcc75bd531b56b2cd280b0bb38fc1cd6d1230e14861d861de092e79', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d', '9046a64750444938de19f227bb80485e92b83fdb4b6506c160484c016cc1852f87909e14428a7a1d62e9f22f3d3ad7802db02eb2e688b6c52fcd6648a98bd009'],
  ['speccheck 4', 'refuse', 'holds only under the cofactored equation; verification is cofactorless', 'e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d', '160a1cb0dc9c0258cd0a7d23e94d8fa878bcb1925f2c64246b2dee1796bed5125ec6bc982a269b723e0668e540911a9a6a58921d6925e434ab10aa7940551a09'],
  ['speccheck 5', 'refuse', 'holds only under the cofactored equation; verification is cofactorless', 'e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec4011eaccd55b53f56c', 'cdb267ce40c5cd45306fa5d2f29731459387dbf9eb933b7bd5aed9a765b88d4d', '21122a84e0b5fca4052f5b1235c80a537878b38f3142356b2c2384ebad4668b7e40bc836dac0f71076f9abe3a53f9c03c1ceeeddb658d0030494ace586687405'],
  ['speccheck 6', 'refuse', 'S > L', '85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40', '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623', 'e96f66be976d82e60150baecff9906684aebb1ef181f67a7189ac78ea23b6c0e547f7690a0e2ddcd04d87dbc3490dc19b3b3052f7ff0538cb68afb369ba3a514'],
  ['speccheck 7', 'refuse', 'S much greater than L', '85e241a07d148b41e47d62c63f830dc7a6851a0b1f33ae4bb2f507fb6cffec40', '442aad9f089ad9e14647b1ef9099a1ff4798d78589e66f28eca69c11f582a623', '8ce5b96c8f26d0ab6c47958c9e68b937104cd36e13c33566acd2fe8d38aa19427e71f98a473474f2f13f06f97c20d58cc3f54b8bd0d272f42b695dd7e89a8c22'],
  ['speccheck 8', 'refuse', 'non-canonical R encoding (x = 0 with the sign bit set), reduced for the hash', '9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff03be9678ac102edcd92b0210bb34d7428d12ffc5df5f37e359941266a4e35f0f'],
  ['speccheck 9', 'refuse', 'non-canonical R encoding (x = 0 with the sign bit set), not reduced for the hash', '9bedc267423725d473888631ebf45988bad3db83851ee85c85e241a07d148b41', 'f7badec5b8abeaf699583992219b7b223f1df3fbbea919844e3f7c554a43dd43', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffca8c5b64cd208982aa38d4936621a4775aa233aa0505711d8fdcfdaa943d4908'],
  ['speccheck 10', 'refuse', 'non-canonical A encoding (x = 0 with the sign bit set), reduced for the hash', 'e96b7021eb39c1a163b6da4e3093dcd3f21387da4cc4572be588fafae23c155b', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
  ['speccheck 11', 'refuse', 'non-canonical A encoding (x = 0 with the sign bit set), not reduced for the hash', '39a591f5321bbe07fd5a23dc2f39d025d74526615746727ceefd6e82ae65c06f', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'a9d55260f765261eb9b84e106f665e00b867287a761990d7135963ee0a7d59dca5bb704786be79fc476f91d3f3f89b03984d8068dcf1bb7dfc6637b45450ac04'],
];

const out = {
  description: 'Ed25519 signatures a conforming verifier MUST accept or MUST refuse. Applies to every DTP signature: commands, tokens, records and foundation proofs. A verifier that accepts a case marked "refuse", or refuses one marked "accept", is non-conforming.',
  rule: 'RFC 8032 section 5.1.7, cofactorless ([S]B = R + [k]A). Refuse S >= L. Refuse a non-canonical encoding of A or R (RFC 8032 section 5.1.3: y >= p, or x = 0 with the sign bit set). Hash the R and A bytes exactly as received. Small-order or mixed-order A and R are not refused by themselves.',
  sources: 'speccheck cases: Chalkias, Garillot and Nikolaenko, "Taming the Many EdDSAs" (2020), ed25519-speccheck cases.json (Apache-2.0); fixed-key cases: spec/vectors/keys.json and spec/vectors/signatures.json',
  cases: cases.map(([name, expected, why, msg, pub, sig]) => ({
    name, expected, why, message_hex: msg, public_key_hex: pub, signature_hex: sig,
    key_id: encodeKeyId(hex(pub)), signature: encodeSignature(hex(sig)),
  })),
};
writeFileSync(new URL('../../spec/vectors/signature-verification.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
