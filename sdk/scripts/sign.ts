// Sign an envelope from a JSON file (or stdin) for use with curl.
//   node scripts/sign.ts envelope.json --key ed25519:...        -> signed envelope on stdout
//   cat envelope.json | node scripts/sign.ts --key $DTP_SECRET_KEY
//   node scripts/sign.ts envelope.json --key ... --fill          -> also fills record_id/root_id/created_at/issuer.key_id if missing
import { readFileSync } from "node:fs";
import { keyPairFromSecret } from "../src/keys.ts";
import { signRecord } from "../src/sign.ts";
import { namespaceOf, newRecordId, nowIso } from "../src/envelope.ts";

const args = process.argv.slice(2);
const keyIdx = args.indexOf("--key");
const secret = keyIdx >= 0 ? args[keyIdx + 1] : process.env.DTP_SECRET_KEY;
if (!secret) {
  console.error("usage: sign.ts [envelope.json] --key <secret key>  (or set DTP_SECRET_KEY)");
  process.exit(2);
}
const fill = args.includes("--fill");
const file = args.find((a) => !a.startsWith("--") && a !== secret);
const text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const env = JSON.parse(text);
const kp = await keyPairFromSecret(secret);

if (fill) {
  env.record_id ??= newRecordId();
  env.root_id ??= env.supersedes ? env.root_id : env.record_id;
  env.namespace ??= namespaceOf(env.type);
  env.schema_version ??= "0.2";
  env.counterparty_ids ??= [];
  env.created_at ??= nowIso();
  env.supersedes ??= null;
  env.issuer ??= {};
  env.issuer.key_id ??= kp.keyId;
  env.issuer.module_id ??= null;
}
delete env.signature;
const signed = await signRecord(env, secret);
console.log(JSON.stringify(signed, null, 2));
