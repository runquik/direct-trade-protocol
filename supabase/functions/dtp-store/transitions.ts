// Generic reader of x-dtp-transitions: which roles may create a record type and move it between statuses.
import type { TypeInfo } from "../../../sdk/src/registry.ts";
import { StoreError } from "./errors.ts";

export interface PartyContext {
  issuerCompanyId: string;
  subjectCompanyId: string;
  counterpartyIds: string[];
}

/** Role names the issuer holds for this record: declared roles from x-dtp-roles plus subject/counterparty/any. */
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

/**
 * Enforce the state machine for a write. `prevBody` is the head being superseded (null for genesis).
 * Throws transition_forbidden. Types without transitions (or without a status field) are permitted.
 */
export function checkTransition(
  info: TypeInfo,
  prevBody: Record<string, unknown> | null,
  newBody: Record<string, unknown>,
  roles: Set<string>,
): void {
  const t = info.transitions;
  if (!t) return;
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
    // no state machine: any party may supersede
    if (!roles.has("subject") && !roles.has("counterparty")) {
      throw new StoreError("transition_forbidden", "only the subject or a counterparty may supersede this record");
    }
    return;
  }

  const prev = statusOf(info, prevBody);
  if (prev === next) {
    // same-status revision: any party to the record
    if (!roles.has("subject") && !roles.has("counterparty")) {
      throw new StoreError("transition_forbidden", "only the subject or a counterparty may revise this record");
    }
    return;
  }
  const match = t.transitions.filter((tr) => tr.from === prev && tr.to === next);
  if (match.length === 0) {
    throw new StoreError("transition_forbidden", `no transition ${prev} -> ${next} for ${info.type}`, { from: prev, to: next });
  }
  if (!match.some((tr) => allowed(tr.by))) {
    const who = [...new Set(match.flatMap((tr) => tr.by))];
    throw new StoreError("transition_forbidden", `${prev} -> ${next} on ${info.type} may only be done by: ${who.join(", ")}`, { from: prev, to: next, roles: [...roles] });
  }
}
