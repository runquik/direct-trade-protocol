import type { Command, Context, DataAction, Organization, Policy, State } from "./model.ts";
import { demand, instant, uuid } from "./wire.ts";
export const MANAGEMENT = ["members.manage", "policies.create", "profiles.publish", "releases.publish", "installations.manage", "authority.manage"];
export function checkPermissions(input: any): string[] {
  demand(Array.isArray(input) && input.length <= MANAGEMENT.length && new Set(input).size === input.length && input.every(x => MANAGEMENT.includes(x)), "invalid", "unsupported administration permission", 400); return [...input].sort();
}
export function activeMember(s: State, org: Organization, id: string, now: number): boolean {
  return !!s.persons[id] && (org.controllers.includes(id) || !!(org.members[id]?.active && instant(org.members[id].expires_at) > now));
}
export function management(s: State, org: Organization, c: Command, action: string, ctx: Context) {
  demand(c.actor.kind === "person" && activeMember(s, org, c.actor.id, ctx.now) && (org.controllers.includes(c.actor.id) || org.members[c.actor.id]?.permissions.includes(action)), "forbidden", "administration permission required");
}
export function quorum(s: State, ids: string[], threshold: number, signed: Set<string>) {
  demand(ids.filter(id => s.persons[id]?.keys.some(key => signed.has(key))).length >= threshold, "approval_required", "distinct current steward/controller signatures required");
}
export function controller(s: State, org: Organization, c: Command, signed: Set<string>) {
  demand(c.actor.kind === "person" && org.controllers.includes(c.actor.id), "forbidden", "company controller required"); quorum(s, org.controllers, org.threshold, signed);
}
export function steward(s: State, org: Organization, policy: Policy, c: Command, signed: Set<string>, ctx: Context) {
  demand(c.actor.kind === "person" && policy.stewards.includes(c.actor.id) && activeMember(s,org,c.actor.id,ctx.now), "forbidden", "active compartment stewardship required");
  quorum(s, policy.stewards.filter(id => activeMember(s,org,id,ctx.now)), policy.threshold, signed);
}
export function dataAllowed(s: State, org: Organization, policy: Policy, resource: string, action: DataAction, c: Command, ctx: Context): boolean {
  if (policy.organization_id !== org.id || org.status !== "active") return false;
  const human = c.actor.kind === "person" ? c.actor.id : c.requested_by ?? org.installations[c.actor.id]?.sponsor_id;
  const grants = (id: string) => activeMember(s, org, id, ctx.now) && policy.grants.some(g => g.person_id === id && g.actions.includes(action) && instant(g.expires_at) > ctx.now && (g.resource_ids === "*" || g.resource_ids.includes(resource)));
  if (c.actor.kind === "person") return !!human && grants(human);
  const inst = org.installations[c.actor.id];
  if (!inst?.active || instant(inst.expires_at) <= ctx.now || !inst.policy_ids.includes(policy.id) || !inst.actions.includes(action)) return false;
  // Automation still needs an explicit sponsoring person, checked at execution.
  return !!human && grants(human);
}
export function checkPolicy(policy: Policy, s: State, org: Organization, ctx: Context) {
  demand(uuid(policy.id) && policy.organization_id === org.id && ["business", "personnel"].includes(policy.classification), "invalid", "invalid policy identity", 400);
  demand(Array.isArray(policy.stewards) && policy.stewards.length > 0 && policy.stewards.length <= 8 && new Set(policy.stewards).size === policy.stewards.length && policy.stewards.every(id => activeMember(s, org, id, ctx.now)), "invalid", "stewards must be distinct active members", 400);
  demand(Number.isInteger(policy.threshold) && policy.threshold >= 1 && policy.threshold <= policy.stewards.length, "invalid", "invalid steward quorum", 400);
  demand(Array.isArray(policy.grants) && policy.grants.length <= 256, "invalid", "too many grants", 400);
  for (const g of policy.grants) {
    demand(g && Object.keys(g).sort().join() === ["person_id", "actions", "resource_ids", "expires_at"].sort().join(), "invalid", "invalid grant fields", 400);
    demand(activeMember(s, org, g.person_id, ctx.now) && Array.isArray(g.actions) && g.actions.length > 0 && g.actions.length <= 3 && new Set(g.actions).size === g.actions.length && g.actions.every(a => ["read", "write", "export"].includes(a)), "invalid", "invalid policy grant", 400);
    demand(g.resource_ids === "*" || (Array.isArray(g.resource_ids) && g.resource_ids.length > 0 && g.resource_ids.length <= 128 && new Set(g.resource_ids).size === g.resource_ids.length && g.resource_ids.every(uuid)), "invalid", "invalid resource scope", 400);
    demand(instant(g.expires_at) > ctx.now && instant(g.expires_at) <= ctx.now + 366 * 86400000, "invalid", "invalid grant expiry", 400);
    if (!org.controllers.includes(g.person_id)) demand(instant(g.expires_at) <= instant(org.members[g.person_id].expires_at), "forbidden", "grant outlives membership");
  }
}
