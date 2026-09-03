// Grant scope matching, shared by the store and the SDK/tests.
import { namespaceOf } from "./envelope.ts";

export type Access = "read" | "write";

export interface Scope {
  namespace?: string;
  type?: string;
  access: Access;
}

export interface GrantLike {
  scopes: Scope[];
  status: "active" | "revoked";
  expires_at?: string | null;
}

/** Does one scope cover `type` at `access`? `write` implies `read`. */
export function scopeCovers(scope: Scope, type: string, access: Access): boolean {
  const accessOk = scope.access === "write" || scope.access === access;
  if (!accessOk) return false;
  if (scope.type) return scope.type === type;
  if (scope.namespace) return scope.namespace === "*" || scope.namespace === namespaceOf(type);
  return false;
}

export function isGrantLive(grant: GrantLike, now: Date = new Date()): boolean {
  if (grant.status !== "active") return false;
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

export function grantCovers(grant: GrantLike, type: string, access: Access, now: Date = new Date()): boolean {
  if (!isGrantLive(grant, now)) return false;
  return grant.scopes.some((s) => scopeCovers(s, type, access));
}

/** Union of scopes (as read scopes) across all live grants — used to build read predicates. */
export function readableScopes(grants: GrantLike[], now: Date = new Date()): Scope[] {
  const out: Scope[] = [];
  for (const g of grants) {
    if (!isGrantLive(g, now)) continue;
    for (const s of g.scopes) out.push({ ...s, access: "read" });
  }
  return out;
}
