// State machines and role continuity, read generically from each schema's x-dtp-* keywords.
//
// Security model (post red-team):
//  - Roles are resolved from the record the writer is superseding (the previous head), never from body fields
//    the writer just wrote. A writer cannot appoint itself to a role in the same write that uses it.
//  - Role-bearing fields (buyer_company_id, seller_company_id, ...) are immutable across a chain once set.
//    A null third-party role (e.g. arbitrator) may be set once, to a company that is neither the subject nor a
//    counterparty, by the subject or a counterparty.
//  - A same-status revision is allowed only via an explicitly listed from==to transition, or otherwise by the
//    subject alone. Types without a status field may be superseded by the subject alone.
import type { TypeInfo } from "../../../sdk/src/registry.ts";
import { StoreError } from "./errors.ts";

export interface PartyContext {
  issuerCompanyId: string;
  subjectCompanyId: string;
  counterpartyIds: string[];
}

/** Roles the issuer holds according to `body` (the previous head for supersedes) plus subject/counterparty/any. */
export function rolesOf(info: TypeInfo, body: Record<string, unknown>, party: PartyContext): Set<string> {
  const roles = new Set<string>(["any"]);
  if (party.issuerCompanyId === party.subjectCompanyId) roles.add("subject");
  if (party.counterpartyIds.includes(party.issuerCompanyId)) roles.add("counterparty");
  for (const [role, field] of Object.entries(info.roles)) {
    if (body[field] === party.issuerCompanyId) roles.add(role);
  }
  return roles;
}

function statusOf(info: TypeInfo, body: Record<string, unknown> | null): string | null {
  const field = info.transitions?.status_field;
  if (!field || !body) return null;
  const v = body[field];
  return typeof v === "string" ? v : null;
}

function thirdPartyRoles(info: TypeInfo): Set<string> {
  const raw = (info.schema as Record<string, unknown>)["x-dtp-third-party-roles"];
  return new Set(Array.isArray(raw) ? (raw as string[]) : []);
}

/**
 * Role fields must name the same companies across a chain. Third-party roles may go from null to a value once,
 * and that value must be a company that is not a party to the record.
 */
export function checkRoleContinuity(
  info: TypeInfo,
  prevBody: Record<string, unknown> | null,
  newBody: Record<string, unknown>,
  party: PartyContext,
): void {
  const third = thirdPartyRoles(info);
  const parties = new Set([party.subjectCompanyId, ...party.counterpartyIds]);
  for (const [role, field] of Object.entries(info.roles)) {
    const next = newBody[field] ?? null;
    if (third.has(role) && next !== null && parties.has(next as string)) {
      throw new StoreError("transition_forbidden", `${role} must be a third party, not the subject or a counterparty`, { role, field });
    }
    if (!prevBody) continue;
    const prev = prevBody[field] ?? null;
    if (prev === next) continue;
    if (prev === null && third.has(role)) continue; // appointing a third party once is allowed
    throw new StoreError("transition_forbidden", `${field} cannot change across a supersede (${String(prev)} -> ${String(next)})`, { role, field });
  }
}

/**
 * Enforce the state machine for a write. `prevBody` is the head being superseded (null for genesis).
 * `roles` MUST have been computed from `prevBody` when superseding.
 */
export function checkTransition(
  info: TypeInfo,
  prevBody: Record<string, unknown> | null,
  newBody: Record<string, unknown>,
  roles: Set<string>,
): void {
  const t = info.transitions;
  if (!t) {
    if (prevBody && !roles.has("subject")) throw new StoreError("transition_forbidden", "only the subject may supersede this record");
    return;
  }
  const allowed = (by: string[]) => by.some((r) => roles.has(r));
  const next = statusOf(info, newBody);

  if (!prevBody) {
    if (!allowed(t.initial.by)) {
      throw new StoreError("transition_forbidden", `${info.type} may only be created by: ${t.initial.by.join(", ")}`, { roles: [...roles] });
    }
    if (t.status_field && t.initial.status.length && (next === null || !t.initial.status.includes(next))) {
      throw new StoreError("transition_forbidden", `${info.type} must start in one of: ${t.initial.status.join(", ")}`, { status: next });
    }
    return;
  }

  if (!t.status_field) {
    if (!roles.has("subject")) throw new StoreError("transition_forbidden", "only the subject may supersede a record without a status machine");
    return;
  }

  const prev = statusOf(info, prevBody);
  const match = t.transitions.filter((tr) => tr.from === prev && tr.to === next);
  if (match.length > 0) {
    if (!match.some((tr) => allowed(tr.by))) {
      const who = [...new Set(match.flatMap((tr) => tr.by))];
      throw new StoreError("transition_forbidden", `${prev} -> ${next} on ${info.type} may only be done by: ${who.join(", ")}`, { from: prev, to: next, roles: [...roles] });
    }
    return;
  }
  if (prev === next) {
    // unlisted same-status revision: subject only
    if (!roles.has("subject")) {
      throw new StoreError("transition_forbidden", `only the subject may revise a ${info.type} without changing its status`, { status: prev, roles: [...roles] });
    }
    return;
  }
  throw new StoreError("transition_forbidden", `no transition ${prev} -> ${next} for ${info.type}`, { from: prev, to: next });
}
