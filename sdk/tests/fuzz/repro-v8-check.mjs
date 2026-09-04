// Fresh-isolate oracle used by repro-v8-shrink.mjs / repro-v8-variants.mjs:
//   node repro-v8-check.mjs <polluter.json> <target.json>
// Parses target in a fresh isolate, records JSON.stringify of the result, parses polluter, parses target again and
// compares. exit 1 = FAULT (the second parse of the identical text produced a different object), exit 0 = no fault.
// Pass a third argument "print" to show the two serializations.
import { readFileSync } from "node:fs";
const polluter = readFileSync(process.argv[2], "utf8");
const target = readFileSync(process.argv[3], "utf8");
const fresh = JSON.stringify(JSON.parse(target));
JSON.parse(polluter);
const again = JSON.stringify(JSON.parse(target));
if (process.argv[4] === "print") console.log(`fresh: ${fresh}\nagain: ${again}`);
process.exit(fresh === again ? 0 : 1);
