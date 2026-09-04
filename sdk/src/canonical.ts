// DTP canonical JSON: RFC 8785 (JCS) restricted to integer-only numbers.
//
// Serialized directly from the input in sorted-key order — never via an intermediate object — because
// ECMAScript objects reorder array-index-like keys ("10" before "9") and swallow "__proto__", both of which
// would silently diverge from JCS (and from any conforming second implementation).

export class FloatNotAllowedError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`non-integer number at ${path}; DTP records must encode decimals as strings`);
    this.name = "FloatNotAllowedError";
    this.path = path;
  }
}

export class CanonicalizationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${message} at ${path}`);
    this.name = "CanonicalizationError";
    this.path = path;
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
// A high surrogate not followed by a low one, or a low surrogate not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function checkNumber(n: number, path: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > MAX_SAFE) {
    throw new FloatNotAllowedError(path);
  }
}

function checkString(s: string, path: string): void {
  if (LONE_SURROGATE.test(s)) throw new CanonicalizationError(path, "lone surrogate in string (RFC 8785 requires well-formed Unicode)");
}

/** Throws FloatNotAllowedError if any number in `value` is not a safe integer. */
export function assertNoFloats(value: unknown, path = "$"): void {
  if (typeof value === "number") return checkNumber(value, path);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFloats(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as object)) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) assertNoFloats(v, `${path}.${k}`);
    }
  }
}

/** JCS key order: by UTF-16 code units, which is the default JS string comparison. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serialize(value: unknown, path: string): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      checkNumber(value, path);
      return value === 0 ? "0" : String(value); // -0 -> "0" (JCS Appendix B)
    case "string":
      checkString(value, path);
      return JSON.stringify(value); // ECMAScript escaping == JCS escaping for well-formed strings
    case "bigint":
      throw new CanonicalizationError(path, "bigint not allowed");
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",") + "]";
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort(compareKeys);
      const parts: string[] = [];
      for (const k of keys) {
        checkString(k, `${path}.${k}`);
        parts.push(JSON.stringify(k) + ":" + serialize(obj[k], `${path}.${k}`));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new CanonicalizationError(path, `unsupported value type ${typeof value}`);
  }
}

/** Canonical JSON text for `value` (JCS with integer-only numbers). */
export function canonicalize(value: unknown): string {
  return serialize(value, "$");
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
