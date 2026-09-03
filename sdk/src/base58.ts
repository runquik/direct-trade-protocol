// Bitcoin-alphabet base58, dependency-free. Matches NEAR's key/signature encoding.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;
const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i]] = i;

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    const rem = Number(n % BASE);
    n = n / BASE;
    out = ALPHABET[rem] + out;
  }
  // leading zero bytes become leading "1" characters
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base58Decode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0);
  let n = 0n;
  for (const ch of s) {
    const v = INDEX[ch];
    if (v === undefined) throw new Error(`invalid base58 character: ${JSON.stringify(ch)}`);
    n = n * BASE + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}
