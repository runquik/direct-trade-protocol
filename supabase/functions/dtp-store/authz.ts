// Read visibility and grant lookups.
import { grantCovers, isGrantLive, type GrantLike, type Scope } from "../../../sdk/src/scopes.ts";
import type { Principal } from "./auth.ts";
import type { Db } from "./db.ts";

export interface GrantRow {
  grant_root_id: string;
  grantor_company_id: string;
  grantee_module_id: string;
  scopes: Scope[];
  status: "active" | "revoked";
  expires_at: string | null;
}

export async function grantsForModule(db: Db, moduleId: string): Promise<GrantRow[]> {
  return db.query<GrantRow>(
    "select grant_root_id, grantor_company_id, grantee_module_id, scopes, status, expires_at from protocol.grants where grantee_module_id = $1 and status = 'active'",
    [moduleId],
  );
}

export async function grantsByCompany(db: Db, companyId: string): Promise<GrantRow[]> {
  return db.query<GrantRow>(
    "select grant_root_id, grantor_company_id, grantee_module_id, scopes, status, expires_at from protocol.grants where grantor_company_id = $1 order by updated_at desc",
    [companyId],
  );
}

/** Does module hold a live grant from `companyId` covering (type, access)? */
export function hasGrant(grants: GrantRow[], companyId: string, type: string, access: "read" | "write", now = new Date()): boolean {
  return grants.some((g) => g.grantor_company_id === companyId && grantCovers(g as GrantLike, type, access, now));
}

export interface VisibilityInput {
  visibility: string;
  subject_company_id: string;
  counterparty_ids: string[];
  type: string;
  body?: Record<string, unknown> | null;
}

/**
 * Reader model:
 *   public         anyone
 *   counterparties subject + counterparties + modules granted read (for the type) by any of them
 *   granted        subject + modules granted read by the subject
 *   private        subject's own keys only
 * A module can always read core.grant records naming it as grantee.
 */
export function canRead(row: VisibilityInput, principal: Principal | null, grants: GrantRow[], now = new Date()): boolean {
  if (row.visibility === "public") return true;
  if (!principal) return false;
  if (principal.kind === "company") {
    if (row.subject_company_id === principal.id) return true;
    if (row.visibility === "counterparties" && row.counterparty_ids.includes(principal.id)) return true;
    return false;
  }
  // module
  if (row.type === "core.grant" && row.body && row.body.module_id === principal.id) return true;
  if (row.visibility === "private") return false;
  const grantors = [row.subject_company_id];
  if (row.visibility === "counterparties") grantors.push(...row.counterparty_ids);
  return grantors.some((c) => hasGrant(grants, c, row.type, "read", now));
}

/**
 * Exact SQL equivalent of canRead, applied BEFORE LIMIT/MAX. `bodyAlias` supplies
 * the record body when the routing fields come from the events table.
 * Returns [clause, params] with placeholders numbered from `startIndex`.
 */
export function readPrefilter(principal: Principal | null, grants: GrantRow[], alias: string, startIndex: number, now = new Date(), bodyAlias = alias): [string, unknown[]] {
  if (!principal) return [`${alias}.visibility = 'public'`, []];
  if (principal.kind === "company") {
    return [
      `(${alias}.visibility = 'public' or ${alias}.subject_company_id = $${startIndex} or (${alias}.visibility = 'counterparties' and $${startIndex} = any(${alias}.counterparty_ids)))`,
      [principal.id],
    ];
  }
  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `$${startIndex + params.length - 1}`; };
  const clauses = [`${alias}.visibility = 'public'`,
    `(${alias}.type = 'core.grant' and ${bodyAlias}.body->>'module_id' = ${bind(principal.id)})`];
  for (const g of grants) {
    if (!isGrantLive(g, now)) continue;
    const scopes = g.scopes.filter(s => s.access === "read" || s.access === "write").map(s => {
      if (s.type) return `${alias}.type = ${bind(s.type)}`;
      if (s.namespace === "*") return "true";
      if (s.namespace) return `${alias}.namespace = ${bind(s.namespace)}`;
      return "false";
    });
    if (!scopes.length) continue;
    const company = bind(g.grantor_company_id);
    clauses.push(`(${alias}.visibility <> 'private' and (${scopes.join(" or ")}) and
      (${alias}.subject_company_id = ${company} or (${alias}.visibility = 'counterparties' and ${company} = any(${alias}.counterparty_ids))))`);
  }
  return [`(${clauses.join(" or ")})`, params];
}
