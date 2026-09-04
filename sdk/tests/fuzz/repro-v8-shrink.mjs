// Delta-debug the V8 JSON.parse reproducer down to small documents. Every candidate is checked in a fresh process
// (repro-v8-check.mjs) because the fault is isolate-state dependent.
//   node repro-v8-save.mjs && node repro-v8-shrink.mjs [dir]
// Writes <dir>/polluter.min.json and <dir>/target.min.json and prints them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2] ?? "v8-repro";
const P = join(dir, "cand-polluter.json");
const T = join(dir, "cand-target.json");
let runs = 0;
function triggers(pol, tgt) {
  writeFileSync(P, JSON.stringify(pol));
  writeFileSync(T, JSON.stringify(tgt));
  runs++;
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, "repro-v8-check.mjs"), P, T], { stdio: "ignore" });
    return false;
  } catch (e) {
    if (e.status === 2) throw new Error("candidate target does not round-trip even in a fresh isolate");
    return e.status === 1;
  }
}
const children = (x) => (Array.isArray(x) ? x.map((v, i) => [i, v]) : Object.entries(x));
const without = (x, k) => {
  if (Array.isArray(x)) return x.filter((_, i) => i !== k);
  const o = { ...x };
  delete o[k];
  return o;
};
const size = (x) => JSON.stringify(x).length;

/** Smallest sub-document of `doc` for which pred(sub) holds: descend into children first, then drop siblings greedily. */
function shrink(doc, pred, label) {
  let cur = doc;
  for (;;) {
    let descended = false;
    if (cur && typeof cur === "object") {
      for (const [, child] of children(cur)) {
        if (child && typeof child === "object" && pred(child)) {
          cur = child;
          descended = true;
          break;
        }
      }
    }
    if (!descended) break;
  }
  // greedy deletion of children, repeated until stable
  let changed = true;
  while (changed && cur && typeof cur === "object") {
    changed = false;
    for (const [k] of children(cur)) {
      const t = without(cur, k);
      if (pred(t)) {
        cur = t;
        changed = true;
        break;
      }
    }
  }
  // then try to simplify each remaining child to a scalar or empty container
  if (cur && typeof cur === "object") {
    for (const [k, v] of children(cur)) {
      if (v && typeof v === "object") {
        for (const repl of [0, Array.isArray(v) ? [] : {}]) {
          const t = Array.isArray(cur) ? cur.map((x, i) => (i === k ? repl : x)) : { ...cur, [k]: repl };
          if (pred(t)) {
            cur = t;
            break;
          }
        }
      } else if (typeof v === "string" && v.length > 1) {
        const t = Array.isArray(cur) ? cur.map((x, i) => (i === k ? "" : x)) : { ...cur, [k]: "" };
        if (pred(t)) cur = t;
      }
    }
  }
  console.log(`${label}: ${size(doc)} -> ${size(cur)} chars after ${runs} fresh-process checks`);
  return cur;
}

// Parse the target BEFORE the polluter: this process is itself subject to the fault, and a target parsed after the
// polluter would already carry the wrong key. Verify both round-trip so the candidates start byte-identical.
const targetText = readFileSync(join(dir, "target.json"), "utf8");
const target0 = JSON.parse(targetText);
if (JSON.stringify(target0) !== targetText) throw new Error("target.json did not round-trip in this process");
const polluterText = readFileSync(join(dir, "polluter.json"), "utf8");
const polluter0 = JSON.parse(polluterText);
if (JSON.stringify(polluter0) !== polluterText) throw new Error("polluter.json did not round-trip in this process");
if (!triggers(polluter0, target0)) throw new Error("full documents do not trigger the fault on this runtime");

const target1 = shrink(target0, (t) => triggers(polluter0, t), "target");
const polluter1 = shrink(polluter0, (p) => triggers(p, target1), "polluter");
// one more pass on the target against the small polluter
const target2 = shrink(target1, (t) => triggers(polluter1, t), "target (2nd pass)");

writeFileSync(join(dir, "polluter.min.json"), JSON.stringify(polluter1));
writeFileSync(join(dir, "target.min.json"), JSON.stringify(target2));
const show = (x) => JSON.stringify(JSON.stringify(x)).slice(1, -1);
console.log("\npolluter.min.json:\n" + show(polluter1));
console.log("\ntarget.min.json:\n" + show(target2));
console.log(`\nverify: node repro-v8-check.mjs ${dir}/polluter.min.json ${dir}/target.min.json ; echo exit $?   (1 = fault)`);
