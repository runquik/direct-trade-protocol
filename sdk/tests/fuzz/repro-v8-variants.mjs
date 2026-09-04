// Hand-written variants of the minimal V8 JSON.parse reproducer, each checked in a fresh process.
//   node repro-v8-variants.mjs
// A row reading "FAULT" means: after JSON.parse(polluter), JSON.parse(target) no longer round-trips through JSON.stringify.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BS = String.fromCharCode(0x5c);
const dir = mkdtempSync(join(tmpdir(), "v8-variants-"));
function run(polluter, target) {
  const P = join(dir, "p.json");
  const T = join(dir, "t.json");
  writeFileSync(P, polluter);
  writeFileSync(T, target);
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, "repro-v8-check.mjs"), P, T], { stdio: "ignore" });
    return "ok";
  } catch (e) {
    return e.status === 1 ? "FAULT" : `check-exit-${e.status}`;
  }
}
const q = (s) => '"' + s + '"';
const esc = (s) => BS + s; // backslash + s
const variants = [
  ["A  2 keys, same first key", `{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc("u0013"))}:2}`],
  ["B  1 key", `{${q(esc(BS))}:2}`, `{${q(esc("u0013"))}:2}`],
  ["C  first key a", `{"a":1,${q(esc(BS))}:2}`, `{"a":1,${q(esc("u0013"))}:2}`],
  ["D  different first keys", `{"a":1,${q(esc(BS))}:2}`, `{"b":1,${q(esc("u0013"))}:2}`],
  ["E  target key u0041 (A) vs expected backslash", `{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc("u0041"))}:2}`],
  ["F  target key u005c (escaped backslash)", `{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc("u005c"))}:2}`],
  ["G  polluter newline key, target tab key", `{"":1,${q(esc("n"))}:2}`, `{"":1,${q(esc("t"))}:2}`],
  ["H  polluter key ab, target key u0063b (cb)", `{"":1,"ab":2}`, `{"":1,${q(esc("u0063") + "b")}:2}`],
  ["I  polluter key b, target key u0063 (c)", `{"":1,"b":2}`, `{"":1,${q(esc("u0063"))}:2}`],
  ["J  polluter key u0013 itself, target backslash", `{"":1,${q(esc("u0013"))}:2}`, `{"":1,${q(esc(BS))}:2}`],
  ["K  polluter backslash-quote key, target u0013", `{"":1,${q(esc('"'))}:2}`, `{"":1,${q(esc("u0013"))}:2}`],
  ["L  values differ in type", `{"":"x",${q(esc(BS))}:[]}`, `{"":1,${q(esc("u0013"))}:true}`],
  ["M  same as A but in an array of two objects, one document", `[]`, `[{"":1,${q(esc(BS))}:2},{"":1,${q(esc("u0013"))}:2}]`],
  ["N  key at 3rd position", `{"":1,"a":1,${q(esc(BS))}:2}`, `{"":1,"a":1,${q(esc("u0013"))}:2}`],
  ["O  target u0013 first, polluter backslash first (1 key)", `{${q(esc(BS))}:1,"z":2}`, `{${q(esc("u0013"))}:1,"z":2}`],
  ["P  polluter key backslash-x, target u0013x", `{"":1,${q(esc(BS) + "x")}:2}`, `{"":1,${q(esc("u0013") + "x")}:2}`],
  // Theory under test: the parser compares the EXPECTED key (from the map transition of the previously parsed object)
  // against the RAW escaped source, char by char, for the expected key's length, and accepts on match.
  ["R  expected backslash, raw backslash-quote", `{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc('"'))}:2}`],
  ["S  expected 2-char key backslash+u, raw u0013u", `{"":1,${q(esc(BS) + "u")}:2}`, `{"":1,${q(esc("u0013") + "u")}:2}`],
  ["T  expected 3-char key backslash+u0, raw u00130", `{"":1,${q(esc(BS) + "u0")}:2}`, `{"":1,${q(esc("u0013") + "0")}:2}`],
  ["U  expected 6-char key backslash+u0013 (literal), raw u0013 u0013 ?", `{"":1,${q(esc(BS) + "u0013")}:2}`, `{"":1,${q(esc("u0013") + esc("u0013"))}:2}`],
  ["V  expected key a, raw u0061 (a) - benign", `{"":1,"a":2}`, `{"":1,${q(esc("u0061"))}:2}`],
  ["W  expected key a, raw u0062 (b)", `{"":1,"a":2}`, `{"":1,${q(esc("u0062"))}:2}`],
  ["X  expected key quote, raw u0022 (quote) - benign", `{"":1,${q(esc('"'))}:2}`, `{"":1,${q(esc("u0022"))}:2}`],
  ["Y  expected key quote, raw u0013", `{"":1,${q(esc('"'))}:2}`, `{"":1,${q(esc("u0013"))}:2}`],
  ["Z  expected key backslash, raw u00e9 (e-acute, two-byte)", `{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc("u00e9"))}:2}`],
];
for (const [name, p, t] of variants) console.log(`${run(p, t).padEnd(6)} ${name}\n         polluter ${p}\n         target   ${t}`);
console.log("\nSweep: polluter key is a single backslash; target key is each single-char escape. FAULT means the key decodes as a backslash.");
const sweep = [];
for (const e of ['"', "/", "b", "f", "n", "r", "t", "u0000", "u0001", "u0013", "u001f", "u0020", "u0041", "u005b", "u005c", "u005d", "u007f", "u00e9", "u4e2d", "ud83d" + esc("ude00")]) {
  sweep.push(`${esc(e)}:${run(`{"":1,${q(esc(BS))}:2}`, `{"":1,${q(esc(e))}:2}`)}`);
}
console.log(sweep.join("  "));
