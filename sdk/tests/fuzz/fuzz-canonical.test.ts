// Property-based fuzz of sdk/src/canonical.ts against two independent RFC 8785 (JCS) implementations.
// Run: node fuzz-canonical.test.ts            (FUZZ_SEED=<n> FUZZ_ITER=<n> to change; defaults 20260903 / 5000)
// Reproduce one failing case: FUZZ_SEED=<reported seed> FUZZ_ITER=1 node fuzz-canonical.test.ts
// Divergences are collected, minimized to the smallest diverging sub-value, and reported in one summary per test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import refCanonicalize from "canonicalize"; // reference implementation by the RFC author (cyberphone)
import { canonicalize as jsonCanonicalize } from "json-canonicalize"; // second, independent implementation
import { assertNoFloats, canonicalize, FloatNotAllowedError } from "../../src/canonical.ts";
import { BAD_NUMBERS, cu, INTERESTING_INTS, INTERESTING_STRINGS, injectAtRandomPath, KEY_FAMILIES, LONE_SURROGATES, randomJson, Rng, shuffleKeys, u, type Json } from "./rng.ts";

const SEED = Number(process.env.FUZZ_SEED ?? 20260903);
const ITER = Number(process.env.FUZZ_ITER ?? 5000);
const BACKSLASH = cu(0x5c);

function caseSeed(i: number): number {
  return (SEED + i * 2654435761) >>> 0;
}

/** The naive "sorted-keys JSON.stringify replacer" that SPEC.md 3.2 implies is sufficient. (It is not: see numeric keys.) */
function naiveSorted(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) o[k] = (val as Record<string, unknown>)[k];
      return o;
    }
    return val;
  });
}

function hasKeyNamed(v: Json, name: string): boolean {
  if (Array.isArray(v)) return v.some((c) => hasKeyNamed(c, name));
  if (v && typeof v === "object") return Object.keys(v).some((k) => k === name || hasKeyNamed(v[k], name));
  return false;
}

function diverges(v: Json): boolean {
  try {
    return canonicalize(v) !== refCanonicalize(v);
  } catch {
    return false;
  }
}

/** Shrink a diverging value to a minimal diverging sub-value (descend into children, then drop keys/elements). */
function minimize(v: Json): Json {
  if (!diverges(v)) return v;
  if (Array.isArray(v)) {
    for (const c of v) if (diverges(c)) return minimize(c);
    let cur = v.slice();
    for (let i = cur.length - 1; i >= 0; i--) {
      const t = cur.slice(0, i).concat(cur.slice(i + 1));
      if (diverges(t)) cur = t;
    }
    return cur.map((c) => (c && typeof c === "object" ? shrinkLeafish(c) : c));
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) if (diverges(v[k])) return minimize(v[k]);
    let cur: { [k: string]: Json } = { ...v };
    for (const k of Object.keys(cur)) {
      const t = { ...cur };
      delete t[k];
      if (diverges(t)) cur = t;
    }
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(cur)) out[k] = cur[k] && typeof cur[k] === "object" ? shrinkLeafish(cur[k]) : shortenLeaf(cur[k]);
    return diverges(out) ? out : cur;
  }
  return v;
}
function shrinkLeafish(c: Json): Json {
  return Array.isArray(c) ? [] : {};
}
function shortenLeaf(c: Json): Json {
  return typeof c === "string" && c.length > 3 ? "s" : c;
}

interface Divergence {
  seed: number;
  oracle: string;
  minimal: string;
  ours: string;
  ref: string;
}
function summarize(title: string, divs: Divergence[], total: number): void {
  if (divs.length === 0) {
    console.log(`  ${title}: ${total} cases, 0 divergences`);
    return;
  }
  const uniq = new Map<string, Divergence>();
  for (const d of divs) if (!uniq.has(d.minimal)) uniq.set(d.minimal, d);
  console.log(`  ${title}: ${divs.length}/${total} cases diverge from ${[...new Set(divs.map((d) => d.oracle))].join(" and ")}. ${uniq.size} distinct minimal reproducers, first 6:`);
  for (const d of [...uniq.values()].slice(0, 6)) {
    console.log(`    input ${d.minimal}`);
    console.log(`      sdk ${d.ours}`);
    console.log(`      ref ${d.ref}   (FUZZ_SEED=${d.seed} FUZZ_ITER=1)`);
  }
}

test(`integer-only JSON: canonicalize() vs RFC 8785 reference implementations (${ITER} cases, seed ${SEED})`, () => {
  const divs: Divergence[] = [];
  let naiveAgreesWithSdk = 0;
  let toJsonKeyed = 0;
  const runtimeParseFaults: number[] = [];
  const oracleDisagreements: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const s = caseSeed(i);
    const r = new Rng(s);
    const v = randomJson(r, { loneSurrogates: false });
    const ours = canonicalize(v);
    const ref = refCanonicalize(v);
    // json-canonicalize has its own bug: an object with a key literally named "toJSON" (any non-null value) is passed to
    // JSON.stringify unsorted (it tests `object.toJSON != null`, not typeof function). Use it as a secondary oracle only.
    if (!hasKeyNamed(v, "toJSON")) {
      const ref2 = jsonCanonicalize(v);
      if (ref !== ref2) oracleDisagreements.push(s); // cyberphone/canonicalize is authoritative; json-canonicalize has bugs
    } else {
      toJsonKeyed++;
    }
    if (ours !== ref) {
      const m = minimize(v);
      divs.push({ seed: s, oracle: "cyberphone/canonicalize + json-canonicalize", minimal: JSON.stringify(m), ours: canonicalize(m), ref: refCanonicalize(m) });
    }
    if (naiveSorted(v) === ours) naiveAgreesWithSdk++;
    // internal properties that must hold regardless of the oracle
    assert.equal(canonicalize(shuffleKeys(r, v)), ours, `seed ${s}: key insertion order changed the output`);
    // Fixed point under parse. If plain JSON.parse itself does not round-trip, the *runtime* mis-parsed the text
    // (V8 JSON.parse key fault, see repro-v8-*.mjs and FINDINGS); record it separately instead of blaming the SDK.
    if (JSON.stringify(JSON.parse(ours)) !== ours) {
      runtimeParseFaults.push(s);
    } else {
      assert.equal(canonicalize(JSON.parse(ours)), ours, `seed ${s}: not a fixed point under parse/canonicalize`);
    }
  }
  console.log(`  naive sorted-keys JSON.stringify replacer agrees with the SDK on ${naiveAgreesWithSdk}/${ITER} (both share the numeric-key bug); ${toJsonKeyed} inputs had a "toJSON" key and skipped the json-canonicalize oracle`);
  console.log(`  runtime JSON.parse round-trip faults (V8 bug, not SDK): ${runtimeParseFaults.length}${runtimeParseFaults.length ? " at seeds " + runtimeParseFaults.slice(0, 5).join(", ") : ""}`);
  console.log(`  json-canonicalize disagreed with cyberphone/canonicalize on ${oracleDisagreements.length} inputs${oracleDisagreements.length ? " (seeds " + oracleDisagreements.slice(0, 5).join(", ") + ")" : ""}`);
  summarize("integer-only fuzz", divs, ITER);
  assert.equal(divs.length, 0, `${divs.length} divergences from RFC 8785 (see summary above)`);
});

test(`non-integer / unsafe / non-finite numbers throw FloatNotAllowedError with the right path (${ITER} cases)`, () => {
  for (let i = 0; i < ITER; i++) {
    const s = caseSeed(i) ^ 0x5eed;
    const r = new Rng(s);
    let v = randomJson(r, { loneSurrogates: false });
    const bad = r.pick(BAD_NUMBERS);
    const ctx = `case ${i} (seed ${s}, injecting ${bad.v} [${bad.why}])`;
    assert.doesNotThrow(() => assertNoFloats(v), `${ctx}: clean value rejected`);
    let path = injectAtRandomPath(r, v, bad.v);
    if (path === null) {
      v = r.bool() ? [bad.v] : { k: bad.v };
      path = Array.isArray(v) ? "$[0]" : "$.k";
    }
    for (const fn of [canonicalize, assertNoFloats]) {
      let err: unknown = null;
      try {
        fn(v);
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof FloatNotAllowedError, `${ctx}: ${fn.name} did not throw FloatNotAllowedError (got ${String(err)})`);
      assert.equal((err as FloatNotAllowedError).path, path, `${ctx}: ${fn.name} reported the wrong path`);
    }
  }
});

test("number table: every BAD_NUMBERS entry is rejected at top level and nested; every INTERESTING_INTS entry is accepted and matches the reference", () => {
  for (const { v, why } of BAD_NUMBERS) {
    assert.throws(() => canonicalize(v), FloatNotAllowedError, `top-level ${v} (${why})`);
    assert.throws(() => canonicalize({ a: [1, { b: v }] }), FloatNotAllowedError, `nested ${v} (${why})`);
    assert.throws(() => assertNoFloats({ a: [1, { b: v }] }), FloatNotAllowedError, `assertNoFloats nested ${v} (${why})`);
  }
  for (const n of INTERESTING_INTS) {
    const ours = canonicalize({ n });
    assert.equal(ours, refCanonicalize({ n }), `int ${n}`);
    assert.equal(ours, jsonCanonicalize({ n }), `int ${n} (json-canonicalize)`);
  }
});

test("negative zero: accepted as an integer and serialized as 0 (matches JCS Appendix B and JSON.stringify)", () => {
  assert.equal(canonicalize(-0), "0");
  assert.equal(canonicalize({ a: -0 }), '{"a":0}');
  assert.equal(canonicalize([-0]), refCanonicalize([-0]));
  assert.equal(canonicalize([-0]), jsonCanonicalize([-0]));
  assert.equal(Object.is(JSON.parse(canonicalize(-0)), 0), true, "the sign is lost after a round trip, but unambiguously");
  assert.equal(canonicalize(JSON.parse("-0")), "0", "JSON text -0 parses to -0 and canonicalizes to 0 on every side");
});

test("float that is integral in JS (1.0, 100.0, 1e2) is indistinguishable from an integer and is accepted", () => {
  assert.equal(canonicalize({ a: 1.0, b: 100.0 }), '{"a":1,"b":100}');
  assert.equal(canonicalize(JSON.parse('{"a":1.0,"b":1e2}')), '{"a":1,"b":100}');
});

test("MAX_SAFE_INTEGER boundary: 2^53-1 accepted, 2^53 rejected, 2^53+1 (== 2^53 as a double) rejected, 1e16 and 1e21 rejected", () => {
  assert.equal(canonicalize(Number.MAX_SAFE_INTEGER), "9007199254740991");
  assert.equal(canonicalize(-Number.MAX_SAFE_INTEGER), "-9007199254740991");
  assert.throws(() => canonicalize(2 ** 53), FloatNotAllowedError);
  assert.throws(() => canonicalize(2 ** 53 + 1), FloatNotAllowedError);
  assert.throws(() => canonicalize(-(2 ** 53)), FloatNotAllowedError);
  assert.throws(() => canonicalize(1e16), FloatNotAllowedError);
  assert.throws(() => canonicalize(1e21), FloatNotAllowedError);
  assert.equal(refCanonicalize(1e21), "1e+21", "the reference (any double) prints 1e21 with an exponent: exactly why DTP forbids it");
  assert.throws(() => canonicalize(JSON.parse("9007199254740993")), FloatNotAllowedError, "big literal parses to an unsafe double and is rejected: no silent precision loss");
});

test("key sorting: UTF-16 code-unit order (not code point, not locale, not NFC-equivalence, not case-fold)", () => {
  // U+FFFF (one code unit) must sort AFTER U+10000 (surrogate pair D800 DC00): code-unit order, not code-point order
  const o1: Record<string, number> = {};
  o1[u(0xffff)] = 1;
  o1[u(0x10000)] = 2;
  assert.equal(canonicalize(o1), refCanonicalize(o1));
  assert.ok(canonicalize(o1).indexOf(u(0x10000)) < canonicalize(o1).indexOf(u(0xffff)), "surrogate pair must sort before U+FFFF");
  for (const fam of KEY_FAMILIES) {
    if (fam.some((k) => /^(0|[1-9][0-9]*)$/.test(k))) continue; // numeric keys: covered by the dedicated test below
    const o: Record<string, number> = {};
    fam.forEach((k, i) => (o[k] = i));
    assert.equal(Object.keys(o).length, fam.length, "variants must be distinct keys");
    assert.equal(canonicalize(o), refCanonicalize(o), JSON.stringify(fam));
    assert.equal(canonicalize(o), jsonCanonicalize(o), JSON.stringify(fam));
  }
});

test("DIVERGENCE: keys that are canonical array indices ('0', '9', '10', ... up to 2^32-2) are emitted first in numeric order, not in code-unit order", () => {
  // Minimal reproducers. ECMAScript orders integer-like own keys first, ascending numerically, regardless of insertion order;
  // sortDeep() builds a plain object and then JSON.stringify() serializes in that property order, undoing the sort.
  const cases: [string, string][] = [
    ['{"10":1,"9":2}', '{"10":1,"9":2}'],
    ['{"b":1,"1":2}', '{"1":2,"b":1}'], // happens to agree ("1" < "b")
    ['{"-1":1,"1":2}', '{"-1":1,"1":2}'],
    ['{"1":0,"01":1}', '{"01":1,"1":0}'],
    ['{"a":1," ":2,"0":3}', '{" ":2,"0":3,"a":1}'],
    ['{"4294967294":1,"4294967295":2,"A":3}', '{"4294967294":1,"4294967295":2,"A":3}'], // 2^32-2 is an index, 2^32-1 is not
  ];
  const rows: string[] = [];
  let bad = 0;
  for (const [input, expected] of cases) {
    const v = JSON.parse(input);
    const ref = refCanonicalize(v);
    assert.equal(ref, expected, `oracle check for ${input}`);
    assert.equal(jsonCanonicalize(v), expected);
    const ours = canonicalize(v);
    const ok = ours === expected;
    if (!ok) bad++;
    rows.push(`    ${input}  ->  sdk ${ours}  ref ${expected}  ${ok ? "ok" : "DIVERGES"}`);
  }
  console.log(rows.join("\n"));
  // The order is stable (it is a property of the object, not of the sort), so the SDK is self-consistent but non-conformant.
  assert.equal(bad, 0, `${bad} numeric-key inputs diverge from RFC 8785`);
});

test("string escaping: exactly JSON.stringify (short escapes, lowercase u00XX for other controls, U+2028/2029 and DEL literal)", () => {
  for (const s of INTERESTING_STRINGS) {
    assert.equal(canonicalize(s), refCanonicalize(s), JSON.stringify(s));
    assert.equal(canonicalize(s), jsonCanonicalize(s), JSON.stringify(s));
  }
  assert.equal(canonicalize(u(0x08, 0x0c, 0x0a, 0x0d, 0x09)), '"' + BACKSLASH + "b" + BACKSLASH + "f" + BACKSLASH + "n" + BACKSLASH + "r" + BACKSLASH + "t" + '"');
  assert.equal(canonicalize(u(0x1f)), '"' + BACKSLASH + 'u001f"');
  assert.equal(canonicalize(u(0x7f)), '"' + u(0x7f) + '"');
  assert.equal(canonicalize(u(0x2028)), '"' + u(0x2028) + '"');
});

test("DIVERGENCE: RFC 8785 3.2.2.2 says lone surrogates MUST be rejected; the SDK escapes them (backslash-u dXXX) instead", () => {
  const rows: string[] = [];
  for (const s of LONE_SURROGATES) {
    assert.throws(() => refCanonicalize(s), /Lone surrogate/, "reference rejects");
    let ours: string;
    try {
      ours = canonicalize(s);
    } catch (e) {
      ours = `threw ${(e as Error).name}`;
    }
    rows.push(`    ${JSON.stringify(s)} -> sdk ${ours}`);
  }
  console.log(rows.join("\n"));
  assert.throws(() => canonicalize(cu(0xd800)), "SDK should reject a lone surrogate per RFC 8785 3.2.2.2");
});

test("lone-surrogate fuzz: the SDK accepts every input the reference rejects; well-formed inputs agree (modulo the numeric-key divergence)", () => {
  const n = Math.max(200, Math.floor(ITER / 5));
  let refRejected = 0;
  let sdkAccepted = 0;
  let sdkSurrogateEscapes = 0;
  let wellFormed = 0;
  let wellFormedDiverging = 0;
  const escapeRe = new RegExp(BACKSLASH + BACKSLASH + "ud[89ab][0-9a-f]{2}", "i");
  for (let i = 0; i < n; i++) {
    const r = new Rng(caseSeed(i) ^ 0x10ce);
    const v = randomJson(r, { loneSurrogates: true });
    let ref: string | null = null;
    try {
      ref = refCanonicalize(v);
    } catch {
      refRejected++;
    }
    const ours = canonicalize(v);
    if (ref === null) {
      sdkAccepted++;
      if (escapeRe.test(ours)) sdkSurrogateEscapes++;
    } else {
      wellFormed++;
      if (ours !== ref) wellFormedDiverging++;
    }
  }
  console.log(`  ${n} cases: reference rejected ${refRejected} (lone surrogates), SDK accepted all ${sdkAccepted} of them (${sdkSurrogateEscapes} emit a lone-surrogate escape); ${wellFormed} well-formed, ${wellFormedDiverging} of those diverge (numeric keys)`);
  assert.equal(sdkAccepted, refRejected);
});

test("DIVERGENCE: a JSON key named __proto__ is silently dropped from the canonical form", () => {
  const v = JSON.parse('{"__proto__":1,"a":2}');
  assert.equal(refCanonicalize(v), '{"__proto__":1,"a":2}');
  assert.equal(jsonCanonicalize(v), '{"__proto__":1,"a":2}');
  const ours = canonicalize(v);
  console.log(`    {"__proto__":1,"a":2} -> sdk ${ours}  ref {"__proto__":1,"a":2}`);
  const withProto = JSON.parse('{"a":2,"__proto__":{"x":1}}');
  console.log(`    {"a":2,"__proto__":{"x":1}} -> sdk ${canonicalize(withProto)} (same bytes as {"a":2}: ${canonicalize(withProto) === canonicalize({ a: 2 })})`);
  // the float check still walks the key, so a float hidden under __proto__ cannot smuggle through
  assert.throws(() => canonicalize(JSON.parse('{"__proto__":0.5}')), FloatNotAllowedError);
  assert.throws(() => assertNoFloats(JSON.parse('{"__proto__":0.5}')), FloatNotAllowedError);
  // the global Object.prototype is not polluted (only the throw-away intermediate object gets its prototype swapped)
  assert.equal(({} as Record<string, unknown>).x, undefined, "Object.prototype must not be polluted");
  assert.equal(ours, '{"__proto__":1,"a":2}', "SDK drops the __proto__ key");
});

test("non-JSON inputs (informational): toJSON objects, Map/Set, bigint, undefined, functions", () => {
  const d = new Date(0);
  console.log(`  Date: sdk ${canonicalize(d)}  ref ${refCanonicalize(d)}  (SDK ignores toJSON; only matters for non-JSON input)`);
  console.log(`  Map:  sdk ${canonicalize(new Map([["a", 1]]))}  ref ${refCanonicalize(new Map([["a", 1]]))}`);
  console.log(`  top-level undefined: sdk ${String(canonicalize(undefined))}  ref ${String(refCanonicalize(undefined))}`);
  assert.throws(() => canonicalize(10n), TypeError, "bigint rejected");
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalize([undefined, 1]), "[null,1]");
  assert.equal(canonicalize({ f: () => 1, b: 1 }), '{"b":1}', "functions dropped like JSON.stringify");
  console.log(`  function-valued key: sdk ${canonicalize({ f: () => 1, b: 1 })}  ref ${refCanonicalize({ f: () => 1, b: 1 })}  (reference emits invalid JSON for non-JSON input; not a DTP concern)`);
});

test("deep nesting (informational): recursion limits", () => {
  for (const depth of [1000, 5000, 20000]) {
    let v: Json = 1;
    for (let i = 0; i < depth; i++) v = [v];
    let sdk = "ok";
    let ref = "ok";
    try {
      canonicalize(v);
    } catch (e) {
      sdk = (e as Error).constructor.name;
    }
    try {
      refCanonicalize(v);
    } catch (e) {
      ref = (e as Error).constructor.name;
    }
    console.log(`  depth ${depth}: sdk ${sdk}, ref ${ref}`);
  }
});

test("reference implementations reproduce the spec vectors (sanity check on the oracle); vectors contain no numeric-string keys", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../../spec/vectors/canonicalization.json", import.meta.url), "utf8"));
  let numericKeys = 0;
  const walk = (v: Json) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) {
      if (/^(0|[1-9][0-9]*)$/.test(k)) numericKeys++;
      walk(v[k]);
    }
  };
  for (const c of vectors.cases) {
    assert.equal(refCanonicalize(c.input), c.canonical, `reference: ${c.name}`);
    assert.equal(jsonCanonicalize(c.input), c.canonical, `json-canonicalize: ${c.name}`);
    assert.equal(canonicalize(c.input), c.canonical, `sdk: ${c.name}`);
    walk(c.input);
  }
  console.log(`  numeric-string keys in the fixed vectors: ${numericKeys} (so the vectors cannot catch the numeric-key divergence)`);
});
