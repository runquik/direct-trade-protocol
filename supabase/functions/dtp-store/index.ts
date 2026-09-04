// Supabase Edge Function entry point for the DTP v0.2 protocol store.
// Deploy: npx supabase functions deploy dtp-store --no-verify-jwt
//
// Connection strategy: edge functions run as many short-lived isolates, so connecting each one directly
// to Postgres (SUPABASE_DB_URL, port 5432) exhausts the database's connection slots under load. We route
// through Supavisor in transaction mode (port 6543) instead. The pooler URL is derived from the platform's
// SUPABASE_DB_URL secret so no credential is duplicated; set DTP_DB_URL to override entirely.
import postgres from "npm:postgres@3.4.5";
import { postgresJsDb } from "./db.ts";
import { handle } from "./router.ts";

function poolerUrl(): string {
  const override = Deno.env.get("DTP_DB_URL");
  if (override) return override;
  const direct = Deno.env.get("SUPABASE_DB_URL");
  if (!direct) throw new Error("SUPABASE_DB_URL is not set");
  const u = new URL(direct);
  // db.<ref>.supabase.co -> <ref>
  const ref = u.hostname.split(".")[0] === "db" ? u.hostname.split(".")[1] : Deno.env.get("SUPABASE_PROJECT_REF") ?? "";
  const poolerHost = Deno.env.get("DTP_DB_POOLER_HOST") ?? "aws-0-us-east-1.pooler.supabase.com";
  if (!ref || !poolerHost) return direct; // fall back to the direct connection if we cannot derive
  u.hostname = poolerHost;
  u.port = Deno.env.get("DTP_DB_POOLER_PORT") ?? "6543";
  u.username = `postgres.${ref}`;
  return u.toString();
}

// prepare:false is required for transaction-mode pooling; a small per-isolate pool is plenty behind Supavisor.
const sql = postgres(poolerUrl(), { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
const db = postgresJsDb(sql);

Deno.serve((req: Request) => handle(req, { db }));
