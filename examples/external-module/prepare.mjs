// Step 1: create the synthetic assessor and write the host's operator configuration.
// This runs before the host starts, because trusting an assessor is host configuration, not something a caller can assert.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { keys } from "@dtp/sdk/preview/foundation";
import { ASSESSOR_ISSUER, credentialsFile, home } from "./common.mjs";

mkdirSync(home, { recursive: true });
const credentials = existsSync(credentialsFile) ? JSON.parse(readFileSync(credentialsFile, "utf8")) : {};
if (!credentials.assessor) {
  const key = await keys.generateKeyPair();
  credentials.assessor = { issuer: ASSESSOR_ISSUER, key_id: key.keyId, secret_key: key.secretKey };
}
writeFileSync(credentialsFile, JSON.stringify({ warning: "SYNTHETIC development secrets for a disposable host; never real, never reuse", ...credentials }, null, 2) + "\n");

const configFile = resolve(home, "dev-host.json");
writeFileSync(configFile, JSON.stringify({
  port: 8790,
  data_dir: resolve(home, "host-data"),
  assessment_pins: { [ASSESSOR_ISSUER]: credentials.assessor.key_id },
}, null, 2) + "\n");

console.error(`wrote ${credentialsFile}\nwrote ${configFile}`);
console.error(`start the disposable host from the protocol repository's sdk directory:\n  npm run dev:dtp-v04 -- ${configFile}\nthen run: node seed.mjs`);
