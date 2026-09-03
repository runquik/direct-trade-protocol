// Print a fresh Ed25519 key pair in DTP/NEAR encoding.
//   node scripts/keygen.ts          -> JSON { key_id, secret_key }
//   node scripts/keygen.ts --env    -> shell exports
import { generateKeyPair } from "../src/keys.ts";

const kp = await generateKeyPair();
if (process.argv.includes("--env")) {
  console.log(`export DTP_KEY_ID='${kp.keyId}'`);
  console.log(`export DTP_SECRET_KEY='${kp.secretKey}'`);
} else {
  console.log(JSON.stringify({ key_id: kp.keyId, secret_key: kp.secretKey }, null, 2));
}
