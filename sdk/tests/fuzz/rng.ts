// Seeded PRNG + random JSON generator for the DTP fuzz suite. Deterministic: same seed => same sequence.
// All non-ASCII test data is built from code points (u(...)) so this file stays pure ASCII and unambiguous in source control.

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** mulberry32: uniform float in [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  range(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.int(256);
    return out;
  }
  /** Uniform safe integer in [-(2^53-1), 2^53-1] */
  safeInt(): number {
    const hi = this.int(1 << 21); // 21 bits
    const lo = this.int(1 << 30) * 4 + this.int(4); // 32 bits
    const mag = hi * 4294967296 + lo; // < 2^53
    const v = Math.min(mag, Number.MAX_SAFE_INTEGER);
    return this.bool() ? -v : v;
  }
  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** Build a string from code points (keeps this file pure ASCII). */
export const u = (...cps: number[]): string => String.fromCodePoint(...cps);

/** Strings that are interesting for canonicalization / sorting. All are well-formed UTF-16. */
export const INTERESTING_STRINGS: readonly string[] = [
  "",
  " ",
  "a",
  "A",
  "Z",
  "z",
  "aa",
  "ab",
  "b",
  u(0xa0), // nbsp
  u(0x00), // NUL
  u(0x01),
  u(0x1f),
  u(0x7f), // DEL (not escaped by JSON.stringify)
  u(0x85), // NEL
  u(0x08, 0x0c, 0x0a, 0x0d, 0x09), // backspace, formfeed, newline, CR, tab (all short-escaped by JSON.stringify)
  u(0x22), // double quote
  u(0x5c), // backslash
  "/",
  u(0x2028, 0x2029), // line/paragraph separators (must NOT be escaped by JSON.stringify)
  u(0xe9), // e-acute NFC
  u(0x65, 0x301), // e + combining acute (NFD)
  u(0x1e9b, 0x323), // long s with dot above + dot below (NFC/NFD/NFKC all differ)
  u(0xfb01), // fi ligature (NFKC -> fi)
  "fi",
  u(0xc5), // A-ring
  u(0x212b), // angstrom sign (NFC -> U+00C5)
  u(0x41, 0x30a), // A + combining ring
  u(0xdf), // sharp s (upper-cases to SS)
  u(0x130), // capital I with dot
  u(0x69, 0x307),
  u(0x1f600), // grinning face (surrogate pair)
  u(0x1f600, 0x1f601),
  u(0x10000), // smallest astral
  u(0x10ffff), // largest astral
  u(0xffff), // largest BMP unit: sorts AFTER any surrogate pair in UTF-16 but BEFORE it by code point
  u(0xfffe),
  u(0xe000), // private use, sorts after surrogates in UTF-16
  u(0xd7ff), // just below the surrogate range
  u(0x1f600, 0x61),
  u(0x1f600, 0x301),
  u(0x200b), // zero width space
  u(0xfeff), // BOM
  u(0x301), // bare combining mark
  "0",
  "1",
  "2",
  "10",
  "01",
  "-1",
  "-0",
  "0.5",
  "1e3",
  "9007199254740993",
  "true",
  "null",
  "undefined",
  "NaN",
  "__proto__",
  "constructor",
  "prototype",
  "toJSON",
  "hasOwnProperty",
  "length",
  "$",
  "$.a[0]",
  "a.b",
  "a[0]",
  "<script>",
  u(0x648, 0x644, 0x627), // RTL Arabic
  u(0xe01, 0xe49), // Thai with tone mark
];

/** Lone / mis-ordered UTF-16 surrogates (invalid Unicode). Built with fromCharCode so no code-point validation applies. */
export const cu = (...units: number[]): string => String.fromCharCode(...units);
export const LONE_SURROGATES: readonly string[] = [
  cu(0xd800),
  cu(0xdc00),
  cu(0xdfff),
  "a" + cu(0xd800),
  cu(0xdc00) + "b",
  cu(0xd83d),
  cu(0xde00, 0xd83d), // low then high (wrong order)
  cu(0xd800, 0xd800),
];


export interface StringOpts {
  loneSurrogates?: boolean;
  maxLen?: number;
}

export function randomCodePoint(r: Rng): number {
  const roll = r.next();
  if (roll < 0.3) return r.range(0x20, 0x7e); // ascii
  if (roll < 0.4) return r.range(0x00, 0x1f); // controls
  if (roll < 0.55) return r.range(0x80, 0x7ff);
  if (roll < 0.7) return r.range(0x800, 0xd7ff);
  if (roll < 0.8) return r.range(0xe000, 0xffff);
  return r.range(0x10000, 0x10ffff); // astral -> surrogate pair
}

export function randomString(r: Rng, opts: StringOpts = {}): string {
  const roll = r.next();
  if (roll < 0.4) return r.pick(INTERESTING_STRINGS);
  if (opts.loneSurrogates && roll < 0.5) return r.pick(LONE_SURROGATES) + (r.bool() ? r.pick(INTERESTING_STRINGS) : "");
  if (roll < 0.55) {
    // very long string
    const len = r.range(1000, opts.maxLen ?? 20000);
    const unit = r.pick(["a", u(0xe9), u(0x1f600), " ", u(0x22, 0x5c)]);
    return unit.repeat(len);
  }
  const len = r.int(24);
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCodePoint(randomCodePoint(r));
  if (opts.loneSurrogates && r.bool(0.2)) s += r.pick(LONE_SURROGATES);
  return s;
}

/** Key variants that differ only by case or unicode normalization; exercises UTF-16 code unit ordering. */
export const KEY_FAMILIES: readonly (readonly string[])[] = [
  ["a", "A", u(0xe1), u(0x61, 0x301), u(0xc1), u(0x41, 0x301)],
  ["e", "E", u(0xe9), u(0x65, 0x301), u(0xc9)],
  ["fi", u(0xfb01), "FI"],
  [u(0xc5), u(0x212b), u(0x41, 0x30a), u(0xe5)],
  ["ss", u(0xdf), "SS"],
  ["1", "01", "001", "1.0", "-1"],
  ["", " ", u(0xa0)],
  [u(0xffff), u(0x10000), u(0x10ffff), u(0xe000), u(0xd7ff)],
  [u(0x1f600), u(0xffff, 0x1f600), u(0x1f600, 0xffff)],
];

export function randomKey(r: Rng, opts: StringOpts = {}): string {
  const roll = r.next();
  if (roll < 0.35) return r.pick(r.pick(KEY_FAMILIES));
  if (roll < 0.45) return String(r.int(20)); // numeric-string keys (JS orders these first in Object.keys)
  return randomString(r, { ...opts, maxLen: 200 });
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const INTERESTING_INTS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  7,
  10,
  255,
  256,
  65535,
  65536,
  2147483647,
  -2147483648,
  2147483648,
  4294967295,
  4294967296,
  1e15,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER - 1,
  9007199254740990,
  1.0, // === 1 in JS
  100.0,
  -0.0,
];

/** Numbers that DTP must reject: non-integer, unsafe, or non-finite. */
export const BAD_NUMBERS: readonly { v: number; why: string }[] = [
  { v: 0.5, why: "fraction" },
  { v: -0.5, why: "negative fraction" },
  { v: 1.5, why: "fraction" },
  { v: 0.1 + 0.2, why: "fp artefact" },
  { v: 1e-7, why: "tiny (serializes as 1e-7)" },
  { v: 5e-324, why: "min subnormal" },
  { v: Number.EPSILON, why: "epsilon" },
  { v: 1e21, why: "1e21 (JSON.stringify emits exponent)" },
  { v: 1e300, why: "huge" },
  { v: 1e16, why: "1e16 > MAX_SAFE_INTEGER (integral but unsafe)" },
  { v: -1e21, why: "-1e21" },
  { v: 2 ** 53, why: "2^53 = MAX_SAFE+1" },
  { v: 2 ** 53 + 1, why: "2^53+1 (rounds to 2^53)" },
  { v: 2 ** 53 + 2, why: "2^53+2" },
  { v: -(2 ** 53), why: "-2^53" },
  { v: Number.MAX_SAFE_INTEGER + 2, why: "MAX_SAFE+2" },
  { v: Number.MAX_VALUE, why: "MAX_VALUE" },
  { v: NaN, why: "NaN" },
  { v: Infinity, why: "Infinity" },
  { v: -Infinity, why: "-Infinity" },
];

export function randomInt(r: Rng): number {
  return r.bool(0.4) ? r.pick(INTERESTING_INTS) : r.safeInt();
}

// ---------------------------------------------------------------------------
// JSON values
// ---------------------------------------------------------------------------

export interface GenOpts {
  loneSurrogates?: boolean;
  maxDepth?: number;
  maxWidth?: number;
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Create an OWN enumerable property, exactly like JSON.parse does (a plain `o[k] = v` with k === "__proto__" would set the prototype). */
export function setOwn(o: { [k: string]: Json }, k: string, v: Json): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

export function randomJson(r: Rng, opts: GenOpts = {}, depth = 0): Json {
  const maxDepth = opts.maxDepth ?? 6;
  const maxWidth = opts.maxWidth ?? 8;
  const roll = r.next();
  const leafOnly = depth >= maxDepth;
  if (leafOnly || roll < 0.45) {
    const t = r.next();
    if (t < 0.1) return null;
    if (t < 0.25) return r.bool();
    if (t < 0.55) return randomInt(r);
    return randomString(r, { loneSurrogates: opts.loneSurrogates });
  }
  if (roll < 0.65) {
    const n = r.int(maxWidth + 1);
    const arr: Json[] = [];
    for (let i = 0; i < n; i++) arr.push(randomJson(r, opts, depth + 1));
    return arr;
  }
  const n = r.int(maxWidth + 1);
  const obj: { [k: string]: Json } = {};
  for (let i = 0; i < n; i++) setOwn(obj, randomKey(r, { loneSurrogates: opts.loneSurrogates }), randomJson(r, opts, depth + 1));
  return obj;
}

/** Recursively shuffle object key insertion order (semantically identical JSON). */
export function shuffleKeys(r: Rng, v: Json): Json {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(r, x));
  if (v && typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of r.shuffle(Object.keys(v))) setOwn(out, k, shuffleKeys(r, v[k]));
    return out;
  }
  return v;
}

/**
 * Insert `leaf` at a random position inside `v` (mutating). Returns the JSONPath-style path in the same
 * format assertNoFloats reports ($.key[idx]...), or null if v is a leaf (caller should wrap it).
 */
export function injectAtRandomPath(r: Rng, v: Json, leaf: Json, path = "$"): string | null {
  if (Array.isArray(v)) {
    if (v.length === 0 || r.bool(0.3)) {
      v.push(leaf);
      return `${path}[${v.length - 1}]`;
    }
    const i = r.int(v.length);
    const child = v[i];
    if (child && typeof child === "object") {
      const p = injectAtRandomPath(r, child, leaf, `${path}[${i}]`);
      if (p) return p;
    }
    v[i] = leaf;
    return `${path}[${i}]`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0 || r.bool(0.3)) {
      const k = `injected_${r.int(1e6)}`;
      setOwn(v, k, leaf);
      return `${path}.${k}`;
    }
    const k = r.pick(keys);
    const child = v[k];
    if (child && typeof child === "object") {
      const p = injectAtRandomPath(r, child, leaf, `${path}.${k}`);
      if (p) return p;
    }
    setOwn(v, k, leaf);
    return `${path}.${k}`;
  }
  return null;
}
