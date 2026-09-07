import { demand, instant } from "./wire.ts";
import type { Organization, State, Installation } from "./model.ts";
import { typeInfo } from "../registry.ts";
const MANAGEMENT = ["members.manage", "installations.manage", "modules.publish", "records.export", "finance.accept_offer", "finance.fund"];
export function permissions(input: unknown): string[] {
  demand(Array.isArray(input) && input.length <= 64 && new Set(input).size === input.length, "invalid", "expected unique permission list", 400);
  for (const p of input) {
    demand(typeof p === "string", "invalid", "invalid permission", 400);
    if (MANAGEMENT.includes(p)) continue;
    const match = /^records\.(read|write):(.+)$/.exec(p);
    demand(match && /^[a-z]+\.[a-z_]+$/.test(match[2]) && typeInfo(match[2]) && !match[2].startsWith("core."), "invalid", "unknown permission; record scopes must name a registered business type", 400);
  }
  return [...input].sort();
}
export function active(until: string, now: number) { return instant(until) > now; }
export function personPermissions(state: State, org: Organization, personId: string, now: number): Set<string> {
  demand(state.persons[personId], "forbidden", "no active company authority");
  if (org.controllers.includes(personId)) return new Set(["*"]);
  const m = org.members[personId];
  demand(m?.active && active(m.expires_at, now), "forbidden", "no active company membership");
  return new Set(m.permissions);
}
export const permits = (rights: Set<string>, right: string) => rights.has("*") || rights.has(right);
export function requireRight(rights: Set<string>, right: string) { demand(permits(rights, right), "forbidden", `missing capability: ${right}`); }
export function subset(rights: Set<string>, values: string[]) { for (const p of values) requireRight(rights, p); }
export function installationRights(installation: Installation, now: number): Set<string> {
  demand(installation.active && active(installation.expires_at, now), "forbidden", "installation is revoked or expired");
  return new Set(installation.permissions);
}
export function quorum(state: State, org: Organization, signed: Set<string>) {
  const controllers = org.controllers.filter(id => state.persons[id]?.keys.some(key => signed.has(key)));
  demand(controllers.length >= org.threshold, "approval_required", `requires ${org.threshold} distinct company controller approvals`);
}
