import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let db: ReturnType<typeof drizzle> | null = null;
let pool: pg.Pool | null = null;

export function getDb() {
  if (db) return db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  pool = new Pool({ connectionString });
  db = drizzle(pool, { schema });
  return db;
}

export async function runMigrations() {
  const db = getDb();
  // For MVP, create tables directly if they don't exist
  const client = await pool!.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        near_account TEXT NOT NULL UNIQUE,
        near_private_key TEXT NOT NULL,
        business_type TEXT NOT NULL,
        jurisdiction TEXT NOT NULL DEFAULT 'US',
        per_trade_limit_cents INTEGER,
        daily_limit_cents INTEGER,
        kyb_status TEXT NOT NULL DEFAULT 'none',
        kyb_docs_url TEXT,
        kyb_legal_name TEXT,
        kyb_tax_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        oauth_sub TEXT NOT NULL UNIQUE,
        email TEXT,
        display_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        org_id UUID NOT NULL REFERENCES organizations(id),
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, org_id)
      );

      CREATE TABLE IF NOT EXISTS invite_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        code TEXT NOT NULL UNIQUE,
        created_by UUID NOT NULL REFERENCES users(id),
        used_by UUID REFERENCES users(id),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS trade_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        user_id UUID NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        near_tx_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS shipments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        contract_id TEXT NOT NULL,
        shippo_transaction_id TEXT NOT NULL,
        tracking_number TEXT,
        tracking_url TEXT,
        label_url TEXT,
        carrier TEXT NOT NULL,
        rate_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_info TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id),
        client_id TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } finally {
    client.release();
  }
}

export { pool };
