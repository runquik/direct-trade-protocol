// Step 2: plain-JS reproducer (no TypeScript, no SDK) for a V8 JSON.parse key-decoding fault observed on Node 25.4.0.
//   node repro-v8-save.mjs && node repro-v8-min.mjs [dir]
//   node --jitless repro-v8-min.mjs ; node --no-opt repro-v8-min.mjs ; node --no-maglev repro-v8-min.mjs
// Expected (correct) behaviour: target.json contains the text "\u0013":false and the parsed object must have a key
// whose single char is U+0013. Observed: after JSON.parse(polluter.json) in the same isolate, the key comes back as
// U+005C (a backslash), i.e. the escape sequence \u0013 is decoded as if it were \\ .
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2] ?? "v8-repro";
const polluter = readFileSync(join(dir, "polluter.json"), "utf8");
const target = readFileSync(join(dir, "target.json"), "utf8");
const BS = String.fromCharCode(0x5c);
const needle = '"' + BS + "u0013" + '":false';
const at = target.indexOf(needle);
console.log(`v8 ${process.versions.v8}, node ${process.version}, flags ${process.execArgv.join(" ") || "(none)"}`);
console.log(`target.json has ${needle} at index ${at}`);

function keysOfInterest(obj) {
  const found = [];
  const walk = (x, path) => {
    if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === "object")
      for (const k of Object.keys(x)) {
        if (k.length === 1 && (k.charCodeAt(0) === 0x13 || k.charCodeAt(0) === 0x5c)) found.push(`${path} key U+${k.charCodeAt(0).toString(16).padStart(4, "0")} = ${JSON.stringify(x[k])}`);
        walk(x[k], path + "." + (k.length > 6 ? k.slice(0, 6) + ".." : k).replace(/[^ -~]/g, "?"));
      }
  };
  walk(obj, "$");
  return found;
}
function check(label) {
  const parsed = JSON.parse(target);
  const re = JSON.stringify(parsed);
  const ok = re === target;
  console.log(`${label}: JSON.stringify(JSON.parse(target)) === target -> ${ok}`);
  if (!ok) {
    let j = 0;
    while (j < target.length && target[j] === re[j]) j++;
    console.log(`  first diff at ${j}: target ${JSON.stringify(target.slice(j - 4, j + 20))} vs re-serialized ${JSON.stringify(re.slice(j - 4, j + 20))}`);
    console.log("  " + keysOfInterest(parsed).join("\n  "));
  }
  return ok;
}
const before = check("fresh isolate");
JSON.parse(polluter);
const after = check("after JSON.parse(polluter)");
process.exitCode = before && after ? 0 : 1;
