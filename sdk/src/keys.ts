// Ed25519 keys via WebCrypto (Node >=23.5, Deno, Supabase edge runtime).
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

export async function verifyBytes(keyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const key = await importPublic(decodeKeyId(keyId));
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature as BufferSource, message as BufferSource);
}
