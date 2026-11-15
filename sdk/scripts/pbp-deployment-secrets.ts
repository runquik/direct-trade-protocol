// One-time local secret provisioning. Never prints secret values or overwrites a file.
// The deployment's own values come from the environment, never from this repository:
//   PBP_AUDIENCE        the hosted functions base the store signs for (https://<host>/functions/v1)
//   PBP_DB_POOLER_HOST  the database pooler host of that deployment
import { writeFileSync } from "node:fs";
import { generateKeyPair } from "../src/keys.ts";
const audience = process.env.PBP_AUDIENCE, poolerHost = process.env.PBP_DB_POOLER_HOST;
if (!audience || !/^https:\/\/[^/]+\/functions\/v1$/.test(audience)) throw new Error("set PBP_AUDIENCE to the deployment's https://<host>/functions/v1 base");
if (!poolerHost || /[\s/:]/.test(poolerHost)) throw new Error("set PBP_DB_POOLER_HOST to the deployment's database pooler host name");
const key = await generateKeyPair();
const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const values = { PBP_STORE_SECRET: key.secretKey, PBP_DEV_ACCESS_TOKEN: token,
  PBP_AUDIENCE: audience,
  PBP_DB_POOLER_HOST: poolerHost,
  PBP_ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173" };
writeFileSync(new URL("../../supabase/.env.local", import.meta.url), Object.entries(values).map(([k,v]) => `${k}=${v}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Created ignored supabase/.env.local. Keep private; upload only to the deployment PBP_AUDIENCE names. Store public key:", key.keyId);
