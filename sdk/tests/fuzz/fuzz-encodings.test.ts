// Key / signature encodings: base58 vs bs58, NEAR-format compatibility vs tweetnacl, decode rejections, malleability.
// Run: node fuzz-encodings.test.ts   (FUZZ_SEED / FUZZ_ITER as in fuzz-canonical)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { base58Decode, base58Encode } from "../../src/base58.ts";
import {
  decodeKeyId,
  decodeSecretKey,
  decodeSignature,
  encodeKeyId,
  encodeSecretKey,
  encodeSignature,
  generateKeyPair,
  keyPairFromSecret,
  signBytes,
  verifyBytes,
} from "../../src/keys.ts";
import { Rng, u } from "./rng.ts";

const SEED = Number(process.env.FUZZ_SEED ?? 20260903);
const ITER = Number(process.env.FUZZ_ITER ?? 5000);
const PREFIX = "ed25519:";
const vectors = JSON.parse(readFileSync(new URL("../../../spec/vectors/keys.json", import.meta.url), "utf8"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
const eq = (a: Uint8Array, b: Uint8Array) => hex(a) === hex(b);

// Postgres check constraint on protocol.keys.key_id (from the migration)
const KEY_ID_DB_REGEX = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

test(`base58: byte-identical to bs58 and round-trips for random byte strings (${ITER} cases)`, () => {
  const r = new Rng(SEED);
  for (let i = 0; i < ITER; i++) {
    const len = r.bool(0.7) ? r.pick([0, 1, 2, 31, 32, 33, 63, 64, 65]) : r.int(90);
    const bytes = r.bytes(len);
    // sprinkle leading zeros
    const lead = r.bool(0.3) ? r.int(Math.min(6, len + 1)) : 0;
    for (let z = 0; z < lead; z++) bytes[z] = 0;
    const ours = base58Encode(bytes);
    assert.equal(ours, bs58.encode(bytes), `encode len=${len} lead0=${lead} hex=${hex(bytes)}`);
    assert.ok(eq(base58Decode(ours), bytes), `decode round trip hex=${hex(bytes)}`);
    assert.ok(eq(base58Decode(ours), bs58.decode(ours)), `decode agrees with bs58 for ${ours}`);
  }
});

test("base58: fixed patterns (empty, all 0x00, all 0xff, single bytes, leading zeros)", () => {
  assert.equal(base58Encode(new Uint8Array(0)), "");
  assert.ok(eq(base58Decode(""), new Uint8Array(0)));
  for (let n = 1; n <= 80; n++) {
    const zeros = new Uint8Array(n);
    assert.equal(base58Encode(zeros), "1".repeat(n), `all-zero length ${n}`);
    assert.ok(eq(base58Decode("1".repeat(n)), zeros));
    const ffs = new Uint8Array(n).fill(0xff);
    assert.equal(base58Encode(ffs), bs58.encode(ffs), `all-0xff length ${n}`);
    assert.ok(eq(base58Decode(base58Encode(ffs)), ffs));
  }
  for (let b = 0; b < 256; b++) {
    const one = new Uint8Array([b]);
    assert.equal(base58Encode(one), bs58.encode(one), `single byte ${b}`);
    assert.ok(eq(base58Decode(base58Encode(one)), one));
    const two = new Uint8Array([0, b]);
    assert.equal(base58Encode(two), bs58.encode(two), `[0, ${b}]`);
    assert.ok(eq(base58Decode(base58Encode(two)), two));
  }
});

test("base58 decode rejects every character outside the Bitcoin alphabet (0 O I l, whitespace, punctuation, unicode)", () => {
  const valid = base58Encode(new Uint8Array(32).fill(7));
  const bad = ["0", "O", "I", "l", " ", "-", "_", "+", "/", "=", ".", u(0xe9), u(0x1f600), u(0x00), u(0x200b), u(0xff11) /* fullwidth 1 */];
  for (const ch of bad) {
    assert.throws(() => base58Decode(valid + ch), /invalid base58 character/, `trailing ${JSON.stringify(ch)}`);
    assert.throws(() => base58Decode(ch + valid), /invalid base58 character/, `leading ${JSON.stringify(ch)}`);
    assert.throws(() => base58Decode(valid.slice(0, 10) + ch + valid.slice(10)), /invalid base58 character/, `middle ${JSON.stringify(ch)}`);
  }
});

test("base58 is a bijection on 32-byte keys: encode(decode(s)) == s for every valid encoding, no non-canonical forms", () => {
  const r = new Rng(SEED + 1);
  let len43 = 0;
  let len44 = 0;
  for (let i = 0; i < ITER; i++) {
    const pk = r.bytes(32);
    const id = encodeKeyId(pk);
    assert.equal(encodeKeyId(decodeKeyId(id)), id);
    const enc = id.slice(PREFIX.length);
    if (enc.length === 43) len43++;
    else if (enc.length === 44) len44++;
    else assert.fail(`unexpected key encoding length ${enc.length}`);
    assert.match(id, KEY_ID_DB_REGEX, `db check constraint must accept ${id}`);
  }
  console.log(`  random 32-byte keys: ${len44} encode to 44 chars, ${len43} to 43 chars`);
  // A non-canonical form (an extra leading "1") decodes to 33 bytes and is rejected by the length check
  const pk = r.bytes(32);
  pk[0] = 5;
  assert.throws(() => decodeKeyId(PREFIX + "1" + base58Encode(pk)), /expected 32/);
});

test("key ids with many leading zero bytes encode shorter than the DB check constraint allows (theoretical, p ~ 2^-40)", () => {
  // n leading zero bytes -> n leading "1"s + base58 of the remaining 32-n bytes
  const rows: string[] = [];
  let firstFail = -1;
  for (let n = 0; n <= 8; n++) {
    const pk = new Uint8Array(32).fill(0xff);
    for (let z = 0; z < n; z++) pk[z] = 0;
    const id = encodeKeyId(pk);
    const ok = KEY_ID_DB_REGEX.test(id);
    rows.push(`${n} leading zero bytes -> ${id.length - PREFIX.length} chars ${ok ? "ok" : "REJECTED by protocol.keys check"}`);
    if (!ok && firstFail < 0) firstFail = n;
  }
  console.log("  " + rows.join("\n  "));
  assert.ok(firstFail >= 5, `keys with ${firstFail} leading zero bytes already fail the DB constraint`);
});

test("decodeKeyId / decodeSignature / decodeSecretKey reject wrong prefix, wrong lengths, bad alphabet, empty", () => {
  const pk = new Uint8Array(32).fill(1);
  const sig = new Uint8Array(64).fill(2);
  // prefix
  assert.throws(() => decodeKeyId(base58Encode(pk)), /must start with/);
  assert.throws(() => decodeKeyId("ED25519:" + base58Encode(pk)), /must start with/);
  assert.throws(() => decodeKeyId("secp256k1:" + base58Encode(pk)), /must start with/);
  assert.throws(() => decodeKeyId(" ed25519:" + base58Encode(pk)), /must start with/);
  assert.throws(() => decodeKeyId(""), /must start with/);
  assert.throws(() => decodeKeyId(PREFIX), /decodes to 0 bytes/);
  // lengths
  for (const n of [0, 1, 31, 33, 64]) assert.throws(() => decodeKeyId(PREFIX + base58Encode(new Uint8Array(n).fill(9))), /expected 32/, `key ${n} bytes`);
  for (const n of [0, 32, 63, 65, 128]) assert.throws(() => decodeSignature(PREFIX + base58Encode(new Uint8Array(n).fill(9))), /expected 64/, `sig ${n} bytes`);
  for (const n of [32, 63, 65]) assert.throws(() => decodeSecretKey(PREFIX + base58Encode(new Uint8Array(n).fill(9))), /expected 64/, `secret ${n} bytes`);
  // alphabet
  assert.throws(() => decodeKeyId(PREFIX + base58Encode(pk).slice(0, -1) + "0"), /invalid base58 character/);
  assert.throws(() => decodeSignature(PREFIX + base58Encode(sig).slice(0, -1) + "l"), /invalid base58 character/);
  // encoders reject wrong sizes too
  assert.throws(() => encodeKeyId(new Uint8Array(31)), /32 bytes/);
  assert.throws(() => encodeSignature(new Uint8Array(63)), /64 bytes/);
  // encodeSecretKey does not validate its inputs: a short seed silently produces a 64-byte string with zero padding
  const short = encodeSecretKey(new Uint8Array(16).fill(3), pk);
  assert.equal(decodeSecretKey(short).seed.length, 32, "encodeSecretKey pads instead of rejecting a 16-byte seed (informational)");
  // a 40-byte "seed" also fits (bytes 32..39 are then overwritten by the public key); only > 64 bytes throws
  assert.equal(decodeSecretKey(encodeSecretKey(new Uint8Array(40).fill(3), pk)).seed.length, 32, "encodeSecretKey accepts a 40-byte seed silently (informational)");
  assert.throws(() => encodeSecretKey(new Uint8Array(65).fill(3), pk), RangeError, "a 65-byte seed overflows the 64-byte buffer");
});

test("encodeSecretKey / decodeSecretKey round-trip and keyPairFromSecret rebuilds the key id", async () => {
  const r = new Rng(SEED + 2);
  for (let i = 0; i < 200; i++) {
    const seed = r.bytes(32);
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const s = encodeSecretKey(seed, kp.publicKey);
    const d = decodeSecretKey(s);
    assert.ok(eq(d.seed, seed));
    assert.ok(eq(d.publicKey, kp.publicKey));
    const rebuilt = await keyPairFromSecret(s);
    assert.equal(rebuilt.keyId, encodeKeyId(kp.publicKey));
  }
});

test("NEAR compatibility: fixed vector matches tweetnacl + bs58 byte for byte", () => {
  const kp = nacl.sign.keyPair.fromSeed(fromHex(vectors.seed_hex));
  assert.equal(hex(kp.publicKey), vectors.public_key_hex);
  assert.equal(PREFIX + bs58.encode(kp.publicKey), vectors.key_id);
  // NEAR KeyPairEd25519.toString() = "ed25519:" + base58(64-byte secretKey) where secretKey = seed || publicKey
  assert.equal(PREFIX + bs58.encode(kp.secretKey), vectors.secret_key);
  assert.equal(encodeSecretKey(fromHex(vectors.seed_hex), kp.publicKey), vectors.secret_key);
});

test("NEAR compatibility: signatures interoperate both ways with tweetnacl (200 random keys)", async () => {
  const r = new Rng(SEED + 3);
  for (let i = 0; i < 200; i++) {
    const ours = await generateKeyPair();
    const theirs = nacl.sign.keyPair.fromSeed(ours.seed);
    assert.ok(eq(theirs.publicKey, ours.publicKey), "WebCrypto pkcs8 tail is the RFC 8032 seed");
    assert.equal(PREFIX + bs58.encode(theirs.secretKey), ours.secretKey, "secret key string is NEAR KeyPair format");
    const msg = r.bytes(r.int(300));
    const sigOurs = await signBytes(ours.secretKey, msg);
    const sigTheirs = nacl.sign.detached(msg, theirs.secretKey);
    assert.ok(eq(sigOurs, sigTheirs), "Ed25519 is deterministic: identical signatures");
    assert.ok(nacl.sign.detached.verify(msg, sigOurs, theirs.publicKey), "tweetnacl verifies ours");
    assert.ok(await verifyBytes(ours.keyId, msg, sigTheirs), "we verify tweetnacl's");
    // a NEAR-format secret string built by tweetnacl signs through our SDK
    const nearSecret = PREFIX + bs58.encode(theirs.secretKey);
    assert.ok(eq(await signBytes(nearSecret, msg), sigTheirs));
  }
});

test("signature malleability: non-canonical S (S + L) and bit flips are rejected by WebCrypto and tweetnacl", async () => {
  const kp = await keyPairFromSecret(vectors.secret_key);
  const msg = new TextEncoder().encode("dtp");
  const sig = await signBytes(kp.secretKey, msg);
  assert.ok(await verifyBytes(kp.keyId, msg, sig));
  // S is the last 32 bytes, little-endian. L = 2^252 + 27742317777372353535851937790883648493.
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  let S = 0n;
  for (let i = 63; i >= 32; i--) S = (S << 8n) | BigInt(sig[i]);
  assert.ok(S < L, "signer produced canonical S");
  const S2 = S + L;
  const mal = sig.slice();
  for (let i = 0; i < 32; i++) mal[32 + i] = Number((S2 >> BigInt(8 * i)) & 0xffn);
  let ok: boolean | string;
  try {
    ok = await verifyBytes(kp.keyId, msg, mal);
  } catch (e) {
    ok = `threw ${(e as Error).name}`;
  }
  assert.notEqual(ok, true, `S+L malleated signature must not verify (got ${ok})`);
  // tweetnacl (the verifier inside older near-api-js) lacks the RFC 8032 S < L check and ACCEPTS the malleated signature.
  const naclAccepts = nacl.sign.detached.verify(msg, mal, kp.publicKey);
  console.log(`  S+L malleated signature: WebCrypto (our SDK) -> ${ok}, tweetnacl -> ${naclAccepts} (tweetnacl does not enforce S < L; see FINDINGS)`);
  assert.equal(naclAccepts, true, "documenting tweetnacl behaviour; if this flips, update FINDINGS-fuzz.md");
  // bit flips
  for (const i of [0, 31, 32, 63]) {
    const f = sig.slice();
    f[i] ^= 1;
    assert.equal(await verifyBytes(kp.keyId, msg, f), false, `flip byte ${i}`);
  }
  // all-zero signature and all-zero key
  assert.equal(await verifyBytes(kp.keyId, msg, new Uint8Array(64)), false);
  let zeroKey: boolean | string;
  try {
    zeroKey = await verifyBytes(encodeKeyId(new Uint8Array(32)), msg, sig);
  } catch (e) {
    zeroKey = `threw ${(e as Error).name}`;
  }
  console.log(`  all-zero public key: verify -> ${zeroKey}`);
  assert.notEqual(zeroKey, true);
  // small-order / non-canonical public keys: informational (WebCrypto behaviour differs by runtime)
  const weird = [new Uint8Array(32).fill(0xff), (() => { const k = new Uint8Array(32); k[0] = 1; return k; })()];
  for (const k of weird) {
    let res: boolean | string;
    try {
      res = await verifyBytes(encodeKeyId(k), msg, sig);
    } catch (e) {
      res = `threw ${(e as Error).name}`;
    }
    console.log(`  public key ${hex(k).slice(0, 8)}...: verify -> ${res}`);
    assert.notEqual(res, true);
  }
});
