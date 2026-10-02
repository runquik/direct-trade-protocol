// Ed25519 keys via WebCrypto (qualified Node version in /.node-version; also used by Deno).
// Encodings are NEAR-compatible:
//   key id     = "ed25519:" + base58(32-byte public key)
//   secret key = "ed25519:" + base58(32-byte seed || 32-byte public key)   (64 bytes, like NEAR)
//   signature  = "ed25519:" + base58(64-byte signature)
import { base58Decode, base58Encode } from "./base58.ts";

const PREFIX = "ed25519:";
// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface KeyPair {
  /** "ed25519:<base58 pubkey>" — the DTP key id */
  keyId: string;
  /** "ed25519:<base58 seed||pubkey>" — keep private */
  secretKey: string;
  publicKey: Uint8Array;
  seed: Uint8Array;
}

function stripPrefix(s: string, what: string): string {
  if (!s.startsWith(PREFIX)) throw new Error(`${what} must start with "${PREFIX}"`);
  return s.slice(PREFIX.length);
}

export function encodeKeyId(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("public key must be 32 bytes");
  return PREFIX + base58Encode(publicKey);
}

export function decodeKeyId(keyId: string): Uint8Array {
  const bytes = base58Decode(stripPrefix(keyId, "key id"));
  if (bytes.length !== 32) throw new Error(`key id decodes to ${bytes.length} bytes, expected 32`);
  return bytes;
}

export function encodeSignature(sig: Uint8Array): string {
  if (sig.length !== 64) throw new Error("signature must be 64 bytes");
  return PREFIX + base58Encode(sig);
}

export function decodeSignature(sig: string): Uint8Array {
  const bytes = base58Decode(stripPrefix(sig, "signature"));
  if (bytes.length !== 64) throw new Error(`signature decodes to ${bytes.length} bytes, expected 64`);
  return bytes;
}

export function encodeSecretKey(seed: Uint8Array, publicKey: Uint8Array): string {
  const both = new Uint8Array(64);
  both.set(seed, 0);
  both.set(publicKey, 32);
  return PREFIX + base58Encode(both);
}

export function decodeSecretKey(secretKey: string): { seed: Uint8Array; publicKey: Uint8Array } {
  const bytes = base58Decode(stripPrefix(secretKey, "secret key"));
  if (bytes.length !== 64) throw new Error(`secret key decodes to ${bytes.length} bytes, expected 64 (seed || public key)`);
  return { seed: bytes.slice(0, 32), publicKey: bytes.slice(32) };
}

async function importPrivate(seed: Uint8Array): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX, 0);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  return crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "Ed25519" }, false, ["sign"]);
}

async function importPublic(publicKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", publicKey as BufferSource, { name: "Ed25519" }, false, ["verify"]);
}

export async function generateKeyPair(): Promise<KeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}

/** Rebuild a KeyPair from an encoded secret key. */
export async function keyPairFromSecret(secretKey: string): Promise<KeyPair> {
  const { seed, publicKey } = decodeSecretKey(secretKey);
  return { keyId: encodeKeyId(publicKey), secretKey, publicKey, seed };
}

export async function signBytes(secretKey: string, message: Uint8Array): Promise<Uint8Array> {
  const { seed } = decodeSecretKey(secretKey);
  const key = await importPrivate(seed);
  return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message as BufferSource));
}

// Verification rule (spec/v0.4/SPEC.md, spec/vectors/signature-verification.json): RFC 8032 section 5.1.7,
// cofactorless, with the canonical-S check and canonical point encodings (section 5.1.3) for A and R. Small-order points are
// not refused by themselves. The encoding checks are explicit so strictness does not depend on the runtime.
const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

function littleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/** RFC 8032 section 5.1.3: y (bit 255 cleared) is below p, and x = 0 (y = 1 or y = p - 1) has a clear sign bit. */
function canonicalPoint(bytes: Uint8Array): boolean {
  const encoded = bytes.slice();
  const sign = encoded[31] >> 7;
  encoded[31] &= 0x7f;
  const y = littleEndian(encoded);
  return y < P && !(sign === 1 && (y === 1n || y === P - 1n));
}

export async function verifyBytes(keyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const publicKey = decodeKeyId(keyId);
  if (signature.length !== 64 || !canonicalPoint(publicKey) || !canonicalPoint(signature.subarray(0, 32))) return false;
  if (littleEndian(signature.subarray(32, 64)) >= L) return false;
  const key = await importPublic(publicKey);
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature as BufferSource, message as BufferSource);
}

// Key registration rule (spec/v0.4/SPEC.md section 2, spec/vectors/key-registration.json, #47): a key may enter an
// identity or authority record only if its canonical encoding decodes to a point of prime order L. That refuses the
// eight small-order points (order dividing 8, the identity included), mixed-order points (a prime-order point plus a
// small-order component), off-curve encodings and non-canonical encodings. RFC 8032 key generation (A = [s]B) never
// produces any of them. Verification is unaffected: verifyBytes still decides existing signatures by its own rule.
const D = mod(-121665n * modPow(121666n, P - 2n));
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);
type Point = [x: bigint, y: bigint, z: bigint, t: bigint];
const IDENTITY: Point = [0n, 1n, 1n, 0n];

function mod(n: bigint): bigint { const r = n % P; return r < 0n ? r + P : r; }
function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n; base %= P;
  for (; exp > 0n; exp >>= 1n) { if (exp & 1n) result = (result * base) % P; base = (base * base) % P; }
  return result;
}
/** RFC 8032 section 5.1.3 point decoding; null when the encoding is non-canonical or not on the curve. */
function decodePoint(bytes: Uint8Array): Point | null {
  if (bytes.length !== 32 || !canonicalPoint(bytes)) return null;
  const encoded = bytes.slice(), sign = BigInt(encoded[31] >> 7);
  encoded[31] &= 0x7f;
  const y = littleEndian(encoded), u = mod(y * y - 1n), v = mod(D * y * y + 1n);
  const x2 = mod(u * modPow(v, P - 2n));
  let x = modPow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return null;
  if ((x & 1n) !== sign) x = mod(-x);
  return [x, y, 1n, mod(x * y)];
}
/** RFC 8032 section 5.1.4 addition in extended coordinates (complete, so it also doubles). */
function add([x1, y1, z1, t1]: Point, [x2, y2, z2, t2]: Point): Point {
  const a = mod((y1 - x1) * (y2 - x2)), b = mod((y1 + x1) * (y2 + x2)), c = mod(t1 * 2n * D * t2), d = mod(z1 * 2n * z2);
  const e = b - a, f = d - c, g = d + c, h = b + a;
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}
function multiply(point: Point, scalar: bigint): Point {
  let result = IDENTITY;
  for (let addend = point; scalar > 0n; scalar >>= 1n, addend = add(addend, addend)) if (scalar & 1n) result = add(result, addend);
  return result;
}
const isIdentity = ([x, y, z]: Point) => x === 0n && y === z;

/** The order class of an encoded public key: "prime" is the only class a key may be registered with. */
export function keyOrder(publicKey: Uint8Array): "invalid" | "small" | "mixed" | "prime" {
  const point = decodePoint(publicKey);
  if (!point) return "invalid";
  if (isIdentity(multiply(point, 8n))) return "small";
  return isIdentity(multiply(point, L)) ? "prime" : "mixed";
}

/** True when the key may enter an identity or authority record (founding, rotation, recovery, installations). */
export function registrableKey(keyId: string): boolean {
  try { return keyOrder(decodeKeyId(keyId)) === "prime"; } catch { return false; }
}
