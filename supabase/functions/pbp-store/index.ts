// Hosted PBP 0.3 development surface. Does not deploy or alter dtp-store.
import postgres from "npm:postgres@3.4.9";
import { postgresJsDb } from "../dtp-store/db.ts";
import { keyPairFromSecret, signBytes, verifyBytes } from "../../../sdk/src/keys.ts";
import { handleEdge } from "./edge.ts";

const required = (name: string) => { const v = Deno.env.get(name); if (!v) throw new Error(`${name} is required`); return v; };
const audience = required("PBP_AUDIENCE");
const expected = `${required("SUPABASE_URL")}/functions/v1`;
if (audience !== expected) throw new Error("PBP_AUDIENCE must match this development project");
const accessToken = required("PBP_DEV_ACCESS_TOKEN");
if (accessToken.length < 32) throw new Error("development access token is too short");
const storeKey = await keyPairFromSecret(required("PBP_STORE_SECRET"));
const probe = new TextEncoder().encode("PBP store key startup check");
if (!await verifyBytes(storeKey.keyId, probe, await signBytes(storeKey.secretKey, probe))) throw new Error("store secret/public key mismatch");
const connection = new URL(Deno.env.get("PBP_DB_URL") ?? required("SUPABASE_DB_URL"));
if (!Deno.env.get("PBP_DB_URL")) {
  const ref = new URL(required("SUPABASE_URL")).hostname.split(".")[0];
  connection.hostname = required("PBP_DB_POOLER_HOST"); connection.port = "6543"; connection.username = `postgres.${ref}`;
}
const sql = postgres(connection.toString(), { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10,
  connection: { statement_timeout: 10000, lock_timeout: 5000 } });
const deps = { db: postgresJsDb(sql), audience, storeKey, trustedSources: (Deno.env.get("PBP_TRUSTED_SOURCES") ?? "").split(",").filter(Boolean), maxStateBytes: 16 * 1024 * 1024 };
const options = { accessToken, allowedOrigins: (Deno.env.get("PBP_ALLOWED_ORIGINS") ?? "").split(",").filter(Boolean), revision: required("PBP_REVISION") };
Deno.serve((req: Request) => handleEdge(req, deps, options));
