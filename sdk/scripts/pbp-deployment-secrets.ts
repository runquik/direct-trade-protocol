// One-time local secret provisioning. Never prints secret values or overwrites a file.
import { writeFileSync } from "node:fs";
import { generateKeyPair } from "../src/keys.ts";
const key = await generateKeyPair();
const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const values = { PBP_STORE_SECRET: key.secretKey, PBP_DEV_ACCESS_TOKEN: token,
  PBP_AUDIENCE: "https://vsuqtdofphppybkhnijg.supabase.co/functions/v1",
  PBP_DB_POOLER_HOST: "aws-0-us-east-1.pooler.supabase.com",
  PBP_ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173" };
writeFileSync(new URL("../../supabase/.env.local", import.meta.url), Object.entries(values).map(([k,v]) => `${k}=${v}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Created ignored supabase/.env.local. Keep private; upload only to the named Supabase project. Store public key:", key.keyId);
