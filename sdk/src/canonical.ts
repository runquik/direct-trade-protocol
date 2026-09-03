// DTP canonical JSON: RFC 8785 (JCS) restricted to integer-only numbers.
// With that restriction JCS reduces to: recursively sort object keys by UTF-16 code units,
// no whitespace, JSON.stringify string escaping, integers as plain digits.

export class FloatNotAllowedError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`non-integer number at ${path}; DTP records must encode decimals as strings`);
    this.name = "FloatNotAllowedError";
    this.path = path;
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function checkNumber(n: number, path: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > MAX_SAFE) {
    throw new FloatNotAllowedError(path);
  }
}

/** Throws FloatNotAllowedError if any number in `value` is not a safe integer. */
export function assertNoFloats(value: unknown, path = "$"): void {
  if (typeof value === "number") return checkNumber(value, path);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFloats(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) assertNoFloats(v, `${path}.${k}`);
    }
  }
}

function sortDeep(value: unknown, path: string): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    checkNumber(value, path);
    return value;
  }
  if (typeof value === "bigint") throw new TypeError(`bigint not allowed at ${path}`);
  if (Array.isArray(value)) {
    return value.map((v, i) => sortDeep(v === undefined ? null : v, `${path}[${i}]`));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sortDeep(obj[k], `${path}.${k}`);
    return out;
  }
  return value; // string | boolean
}

/** Canonical JSON text for `value` (JCS with integer-only numbers). */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value, "$"));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
