// Step 1 of the V8 JSON.parse reproducer: materialize the two fuzz documents as plain JSON files.
//   node repro-v8-save.mjs [outDir]      (default: ./v8-repro)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [m, c] = await Promise.all([import("./rng.ts"), import("../../src/canonical.ts")]);
const out = process.argv[2] ?? "v8-repro";
mkdirSync(out, { recursive: true });
const gen = (s) => m.randomJson(new m.Rng(s), { loneSurrogates: false });
const polluter = c.canonicalize(gen(493863616)); // fuzz case 361 of seed 20260903
const target = c.canonicalize(gen(3613660401)); // fuzz case 490 of seed 20260903
writeFileSync(join(out, "polluter.json"), polluter);
writeFileSync(join(out, "target.json"), target);
console.log(`wrote ${out}/polluter.json (${polluter.length} chars) and ${out}/target.json (${target.length} chars)`);
