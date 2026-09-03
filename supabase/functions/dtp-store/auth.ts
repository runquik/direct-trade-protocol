// Bearer tokens identify the caller; record signatures prove authorship. Tokens are `dtps_<48 hex>`,
// stored as SHA-256 hex (same pattern as the MVP's dtp-mcp function).
import { bytesToHex, sha256Hex } from "../../../sdk/src/canonical.ts";
import type { Db } from "./db.ts";
import { StoreError } from "./errors.ts";

export interface Principal {
  kind: "company" | "module";
  id: string;
  key_id: string;
  role: "root" | "delegate";
}

export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "dtps_" + bytesToHex(bytes);
}

export async function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

export function bearerFrom(headers: Headers): string | null {
  const h = headers.get("authorization") ?? headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

interface KeyRow {
  key_id: string;
  owner_kind: "company" | "module";
  owner_id: string;
  role: "root" | "delegate";
  status: "active" | "revoked";
}

/** Resolve a bearer token to a principal, or null when no token was sent. Throws on bad/revoked tokens. */
export async function resolvePrincipal(db: Db, headers: Headers): Promise<Principal | null> {
  const token = bearerFrom(headers);
  if (!token) return null;
  if (!token.startsWith("dtps_")) throw new StoreError("auth_invalid", "malformed bearer token");
  const hash = await tokenHash(token);
  const rows = await db.query<KeyRow>(
    "select key_id, owner_kind, owner_id, role, status from protocol.keys where token_hash = $1",
    [hash],
  );
  if (rows.length === 0) throw new StoreError("auth_invalid", "unknown bearer token");
  const k = rows[0];
  if (k.status !== "active") throw new StoreError("key_inactive", `key ${k.key_id} is revoked`);
  return { kind: k.owner_kind, id: k.owner_id, key_id: k.key_id, role: k.role };
}

export function requirePrincipal(p: Principal | null): Principal {
  if (!p) throw new StoreError("auth_required", "this endpoint requires an Authorization: Bearer dtps_... token");
  return p;
}
