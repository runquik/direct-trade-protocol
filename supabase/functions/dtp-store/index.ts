// Supabase Edge Function entry point for the DTP v0.2 protocol store.
// Deploy: npx supabase functions deploy dtp-store --no-verify-jwt
import postgres from "npm:postgres@3.4.5";
import { postgresJsDb } from "./db.ts";
import { handle } from "./router.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const db = postgresJsDb(sql);

Deno.serve((req: Request) => handle(req, { db }));
