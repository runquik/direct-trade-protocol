// Deterministic authorization and state transitions. The HTTP store runs this
// inside one serialized transaction; callers must discard state on any failure.
import { canonicalBytes } from "../canonical.ts";
import { decodeKeyId, encodeSignature, signBytes, verifyBytes, decodeSignature, type KeyPair } from "../keys.ts";
import { typeInfo, validateBody } from "../registry.ts";
import { checkTransition, checkRoleContinuity, rolesOf } from "../../../supabase/functions/dtp-store/transitions.ts";
import { checkIntegrity } from "../../../supabase/functions/dtp-store/integrity.ts";
import type { Envelope } from "../envelope.ts";
import { demand, exact, uuid, instant, digest, same, personId, organizationId, signaturesOf, validateCommand, type Command } from "./wire.ts";
import { active, permissions, permits, personPermissions, installationRights, requireRight, subset, quorum } from "./permissions.ts";
import type { State, Organization, BusinessRecord, Snapshot, Transfer, Person } from "./model.ts";

export interface EngineOptions { audience: string; storeKey: KeyPair; trustedSources: string[]; now: number }
const READ_ACTIONS = new Set(["organizations.list", "workspace.view", "records.list", "records.export", "organization.export", "migration.preview", "migration.receipt"]);
function validId(id: unknown) { demand(uuid(id), "invalid", "expected UUID", 400); }
function text(value: unknown, max = 120): asserts value is string {
  demand(typeof value === "string" && value.trim().length > 0 && value.length <= max, "invalid", "invalid text", 400);
}
function future(value: unknown, now: number) { const end = instant(value); demand(end > now && end <= now + 366 * 86400000, "invalid", "expiry must be within one year", 400); }
function uniqueIds(values: unknown): asserts values is string[] {
  demand(Array.isArray(values) && values.length > 0 && values.length <= 8 && new Set(values).size === values.length, "invalid", "expected 1-8 distinct IDs", 400);
  values.forEach(validId);
}
function keyFree(s: State, key: string) {
  try { decodeKeyId(key); } catch { demand(false, "invalid", "invalid public key", 400); }
  demand(!Object.values(s.persons).some(p => [...p.keys, ...p.retired_keys].includes(key)) &&
    !Object.values(s.organizations).some(o => Object.values(o.installations).some(i => i.key_id === key)), "conflict", "key already bound to an identity", 409);
}
function personSigned(s: State, id: string, signed: Set<string>) {
  demand(s.persons[id]?.keys.some(key => signed.has(key)), "approval_required", "current person signature required");
}
function readVisible(record: BusinessRecord, org: Organization, kind: string, rights: Set<string>): boolean {
  if (!permits(rights, `records.read:${record.type}`)) return false;
  if (record.subject_company_id === org.id) return kind === "person" || record.visibility !== "private";
  return record.counterparty_ids.includes(org.id) && ["public", "counterparties"].includes(record.visibility);
}
function snapshot(s: State, org: Organization, source: string): Snapshot {
  // Full-company export contains private membership/installation policy. Only controller quorum can access it.
  const ids = new Set([...org.controllers, ...Object.keys(org.members), ...Object.values(org.invitations).map(i => i.person_id)]);
  for (const a of org.audit) {
    if (a.command.requested_by) ids.add(a.command.requested_by);
    if (["organization.create", "organization.policy"].includes(a.command.action)) for (const id of a.command.payload.controllers) ids.add(id);
  }
  return { version: "0.3", source, organization: structuredClone(org),
    persons: [...ids].sort().map(id => structuredClone(s.persons[id])),
    modules: [...new Set(Object.values(org.installations).map(i => i.module_id))].sort().map(id => structuredClone(s.modules[id])),
    // Only records owned by this company; counterparties' records require a separate authorized source/export.
    records: Object.values(s.records).filter(r => r.subject_company_id === org.id).map(r => structuredClone(r)).sort((a, b) => a.seq - b.seq) };
}
function transferBytes(transfer: Omit<Transfer, "signature"> | Transfer): Uint8Array {
  return canonicalBytes({ domain: "PBP-TRANSFER-0.3", snapshot: transfer.snapshot, handoff: transfer.handoff, source_key_id: transfer.source_key_id });
}
/** Check portable personal key history without consulting a private workspace user database. */
export async function verifyPerson(person: Person): Promise<void> {
  demand(person && uuid(person.id) && Array.isArray(person.history) && person.history.length > 0, "invalid_transfer", "invalid personal history");
  let keys: string[] = [], retired: string[] = [];
  const seen = new Set<string>();
  for (const [index, command] of person.history.entries()) {
    validateCommand(command, command.audience, instant(command.issued_at));
    const signed = await signaturesOf(command), p = command.payload;
    demand(command.actor.kind === "person" && command.actor.id === person.id && command.requested_by === person.id && command.organization_id === null && !seen.has(command.request_id), "invalid_transfer", "personal history continuity failed");
    seen.add(command.request_id);
    if (index === 0) {
      demand(command.action === "person.register" && person.id === await personId(command.actor.key_id) && p.keys.includes(command.actor.key_id), "invalid_transfer", "personal genesis does not match identity");
      demand(p.keys.every((key: string) => signed.has(key)), "invalid_transfer", "genesis keys lack possession proof"); keys = [...p.keys];
    } else {
      demand(command.action === "person.rotate" && keys.includes(command.actor.key_id) && p.revoke.every((key: string) => keys.includes(key)) &&
        p.add.every((key: string) => !keys.includes(key) && !retired.includes(key) && signed.has(key)) && new Set([...p.add, ...p.revoke]).size === p.add.length + p.revoke.length,
        "invalid_transfer", "personal rotation continuity failed");
      keys = [...keys.filter(key => !p.revoke.includes(key)), ...p.add]; retired.push(...p.revoke);
      demand(keys.length >= 1 && keys.length <= 8, "invalid_transfer", "invalid active key count");
    }
  }
  demand(same(keys, person.keys) && same(retired, person.retired_keys), "invalid_transfer", "personal projection differs from signed history");
}
export async function verifyTransfer(transfer: Transfer, destination: { audience: string; key_id: string }, trustedSources: string[]): Promise<void> {
  exact(transfer, ["snapshot", "handoff", "source_key_id", "signature"]);
  demand(trustedSources.includes(transfer.source_key_id), "untrusted_source", "source store key is not explicitly trusted");
  let verified = false;
  try { verified = await verifyBytes(transfer.source_key_id, transferBytes(transfer), decodeSignature(transfer.signature)); } catch { /* invalid */ }
  demand(verified, "signature_invalid", "transfer receipt signature invalid", 401);
  const { snapshot: snap, handoff } = transfer;
  demand(snap && Array.isArray(snap.persons) && Array.isArray(snap.modules) && Array.isArray(snap.records) && snap.organization && Array.isArray(snap.organization.audit), "invalid_transfer", "invalid snapshot structure");
  for (const person of snap.persons) await verifyPerson(person);
  const people = Object.fromEntries(snap.persons.map(p => [p.id, p]));
  const signedByPerson = (id: string, signed: Set<string>) => people[id] && [...people[id].keys, ...people[id].retired_keys].some(key => signed.has(key));
  // Anchor organization control to signed genesis and quorum-approved policy changes.
  // Pinned source trust is still required for current-head completeness and acceptance order.
  let controllers: string[] = [], threshold = 0;
  for (const [index, entry] of snap.organization.audit.entries()) {
    const command = entry.command;
    validateCommand(command, command.audience, instant(command.issued_at));
    const signed = await signaturesOf(command);
    if (index === 0) {
      demand(command.action === "organization.create" && command.organization_id === snap.organization.id && command.actor.kind === "person" &&
        snap.organization.id === await organizationId(command.actor.id, command.payload.nonce) && signedByPerson(command.actor.id, signed), "invalid_transfer", "company genesis does not match identity");
      controllers = command.payload.controllers; threshold = command.payload.threshold;
      demand(controllers.includes(command.actor.id) && controllers.every(id => signedByPerson(id, signed)), "invalid_transfer", "company genesis lacks controller consent");
    } else if (command.action === "organization.policy") {
      demand(command.organization_id === snap.organization.id && controllers.includes(command.actor.id) && controllers.filter(id => signedByPerson(id, signed)).length >= threshold,
        "invalid_transfer", "company policy change lacks prior controller quorum");
      for (const id of command.payload.controllers) if (!controllers.includes(id)) demand(signedByPerson(id, signed), "invalid_transfer", "new controller did not consent");
      controllers = command.payload.controllers; threshold = command.payload.threshold;
    }
    demand(threshold >= 1 && threshold <= controllers.length, "invalid_transfer", "invalid controller threshold");
  }
  demand(same(controllers, snap.organization.controllers) && threshold === snap.organization.threshold, "invalid_transfer", "controller projection differs from signed history");
  for (const record of snap.records) {
    demand(record.subject_company_id === snap.organization.id && record.command.action === "record.append", "invalid_transfer", "export includes a foreign or invalid record");
    validateCommand(record.command, record.command.audience, instant(record.command.issued_at));
    await signaturesOf(record.command);
    const { command: _, seq: _seq, is_head: _head, accepted_at: _at, ...fields } = record;
    demand(same(fields, record.command.payload), "invalid_transfer", "record content differs from its signed command");
  }
  demand(snap.version === "0.3" && snap.organization.status === "active" && handoff.version === "0.3" && handoff.audience === snap.source &&
    handoff.organization_id === snap.organization.id && handoff.action === "migration.commit" && handoff.actor.kind === "person" &&
    snap.organization.controllers.includes(handoff.actor.id) && handoff.requested_by === handoff.actor.id,
    "invalid_transfer", "invalid handoff identity or action");
  exact(handoff.payload, ["destination", "snapshot_hash"]);
  demand(same(handoff.payload.destination, destination) && handoff.payload.snapshot_hash === await digest(snap), "invalid_transfer", "handoff target or snapshot differs");
  // Migration approvals are durable signed evidence; their original command expiry is not an import deadline.
  const signed = await signaturesOf(handoff);
  demand(people[handoff.actor.id]?.keys.includes(handoff.actor.key_id), "invalid_transfer", "handoff actor key is not current in snapshot");
  demand(snap.organization.controllers.filter(id => people[id]?.keys.some(k => signed.has(k))).length >= snap.organization.threshold,
    "approval_required", "handoff lacks controller quorum");
}

export async function execute(s: State, input: unknown, options: EngineOptions): Promise<unknown> {
  const { audience, now } = options;
  validateCommand(input, audience, now);
  const c = input, p = c.payload, signed = await signaturesOf(c);
  const requestHash = await digest(c);
  let org = c.organization_id ? s.organizations[c.organization_id] : undefined;
  let rights = new Set<string>();
  if (c.action === "person.register") {
    demand(c.actor.kind === "person" && c.organization_id === null && c.requested_by === c.actor.id, "invalid", "invalid person enrollment", 400);
  } else {
    if (c.actor.kind === "person") {
      demand(s.persons[c.actor.id]?.keys.includes(c.actor.key_id) && c.requested_by === c.actor.id, "forbidden", "inactive person credential");
    } else {
      const installed = org?.installations[c.actor.id];
      demand(installed && installed.key_id === c.actor.key_id, "forbidden", "installation does not belong to selected company");
      rights = installationRights(installed, now);
      demand(["record.append", "records.list"].includes(c.action), "forbidden", "installation cannot administer company authority");
      if (c.requested_by !== null) {
        personSigned(s, c.requested_by, signed);
        const userRights = personPermissions(s, org!, c.requested_by, now);
        rights = new Set([...rights].filter(right => permits(userRights, right)));
      } else demand(installed.mode === "automation", "approval_required", "interactive module needs the requesting person's signature");
    }
    if (org && c.actor.kind === "person" && c.action !== "membership.accept") rights = personPermissions(s, org, c.actor.id, now);
  }
  // Replays never bypass credential/membership/installation revocation.
  const previous = s.receipts[c.request_id];
  if (previous) {
    demand(previous.hash === requestHash, "conflict", "request ID reused with different content", 409);
    // Reads are recomputed with current scopes, not served from a stale authorization cache.
    if (!READ_ACTIONS.has(c.action)) {
      if (c.action.startsWith("membership.") && c.action !== "membership.accept") requireRight(rights, "members.manage");
      if (c.action === "membership.invite") subset(rights, permissions(p.permissions));
      if (c.action === "membership.accept") personPermissions(s, org!, c.actor.id, now);
      if (c.action.startsWith("installation.")) requireRight(rights, "installations.manage");
      if (c.action === "installation.create") subset(rights, permissions(p.permissions));
      if (c.action === "module.publish") requireRight(rights, "modules.publish");
      if (["organization.create", "organization.policy", "migration.commit"].includes(c.action)) {
        demand(org?.controllers.includes(c.actor.id), "forbidden", "controller required"); quorum(s, org!, signed);
      }
      if (c.action === "record.append") {
        requireRight(rights, `records.write:${p.type}`);
        const record = s.records[p.record_id]; demand(org && record && readVisible(record, org, c.actor.kind, rights), "not_found", "record not found", 404);
        if (p.type === "finance.advance_offer" && p.body.status === "accepted") requireRight(rights, "finance.accept_offer");
        if (p.type === "finance.advance" || (p.type === "finance.settlement_event" && p.body.kind === "advance_funding")) requireRight(rights, "finance.fund");
      }
      return previous.result;
    }
  }
  if (org?.status === "migrated") demand(["workspace.view", "migration.receipt"].includes(c.action), "migrated", "company authority has moved", 409);
  let result: unknown;
  let audit = false;
  const needOrg = () => { demand(org, "not_found", "company not found", 404); return org; };
  const controller = () => {
    const o = needOrg();
    demand(c.actor.kind === "person" && o.controllers.includes(c.actor.id), "forbidden", "company controller required");
    quorum(s, o, signed); return o;
  };
  switch (c.action) {
    case "person.register": {
      exact(p, ["keys"]);
      demand(c.actor.id === await personId(c.actor.key_id), "invalid", "person ID must derive from genesis signing key", 400);
      demand(Array.isArray(p.keys) && p.keys.length >= 1 && p.keys.length <= 8 && new Set(p.keys).size === p.keys.length && p.keys.includes(c.actor.key_id), "invalid", "invalid person keys", 400);
      demand(!s.persons[c.actor.id], "conflict", "person already registered", 409);
      for (const key of p.keys) { keyFree(s, key); demand(signed.has(key), "approval_required", "every new key must prove possession"); }
      s.persons[c.actor.id] = { id: c.actor.id, keys: [...p.keys], retired_keys: [], history: [c] };
      result = { person_id: c.actor.id }; break;
    }
    case "person.rotate": {
      demand(c.organization_id === null && c.actor.kind === "person", "invalid", "personal operation", 400);
      exact(p, ["add", "revoke"]);
      demand(Array.isArray(p.add) && Array.isArray(p.revoke) && p.add.length + p.revoke.length <= 16 && new Set([...p.add, ...p.revoke]).size === p.add.length + p.revoke.length, "invalid", "invalid rotation", 400);
      const person = s.persons[c.actor.id];
      for (const key of p.add) { keyFree(s, key); demand(signed.has(key), "approval_required", "new key must prove possession"); }
      demand(p.revoke.every((key: string) => person.keys.includes(key)), "invalid", "unknown revoked key", 400);
      const next = [...person.keys.filter(key => !p.revoke.includes(key)), ...p.add];
      demand(next.length >= 1 && next.length <= 8, "forbidden", "retain 1-8 active keys");
      person.keys = next; person.retired_keys.push(...p.revoke); person.history.push(c);
      result = { person_id: person.id, keys: next }; break;
    }
    case "organization.create": {
      exact(p, ["name", "nonce", "controllers", "threshold"]); validId(c.organization_id); validId(p.nonce); text(p.name); uniqueIds(p.controllers);
      demand(c.organization_id === await organizationId(c.actor.id, p.nonce), "invalid", "company ID must derive from founder and nonce", 400);
      demand(c.actor.kind === "person" && !org && p.controllers.includes(c.actor.id), "conflict", "invalid company bootstrap or company already exists", 409);
      demand(Number.isInteger(p.threshold) && p.threshold >= 1 && p.threshold <= p.controllers.length, "invalid", "invalid approval threshold", 400);
      p.controllers.forEach((id: string) => personSigned(s, id, signed));
      org = { id: c.organization_id!, name: p.name, controllers: [...p.controllers], threshold: p.threshold, generation: 0,
        status: "active", members: {}, invitations: {}, installations: {}, audit: [], imported_from: null };
      s.organizations[org.id] = org; audit = true; result = { organization_id: org.id }; break;
    }
    case "organization.policy": {
      const o = controller(); exact(p, ["controllers", "threshold"]); uniqueIds(p.controllers);
      demand(Number.isInteger(p.threshold) && p.threshold >= 1 && p.threshold <= p.controllers.length, "invalid", "invalid threshold", 400);
      for (const id of p.controllers) if (!o.controllers.includes(id)) personSigned(s, id, signed);
      o.controllers = [...p.controllers]; o.threshold = p.threshold; audit = true; result = { changed: true }; break;
    }
    case "organizations.list": {
      exact(p, []); demand(c.organization_id === null && c.actor.kind === "person", "invalid", "personal operation", 400);
      result = Object.values(s.organizations).filter(o => o.controllers.includes(c.actor.id) ||
        (o.members[c.actor.id]?.active && active(o.members[c.actor.id].expires_at, now)))
        .map(o => ({ id: o.id, name: o.name, status: o.status, controller: o.controllers.includes(c.actor.id) })); break;
    }
    case "membership.invite": {
      const o = needOrg(); requireRight(rights, "members.manage"); exact(p, ["invitation_id", "person_id", "permissions", "expires_at"]);
      validId(p.invitation_id); validId(p.person_id); future(p.expires_at, now);
      demand(s.persons[p.person_id] && !o.controllers.includes(p.person_id), "invalid", "target must be a registered non-controller", 400);
      const grants = permissions(p.permissions); subset(rights, grants);
      if (!o.controllers.includes(c.actor.id)) demand(instant(p.expires_at) <= instant(o.members[c.actor.id].expires_at), "forbidden", "delegation outlives delegator");
      demand(!o.invitations[p.invitation_id], "conflict", "invitation ID already used", 409);
      for (const invite of Object.values(o.invitations)) if (invite.person_id === p.person_id) invite.accepted = true;
      o.invitations[p.invitation_id] = { id: p.invitation_id, person_id: p.person_id, permissions: grants, expires_at: p.expires_at, active: true, accepted: false, authorized_by: c.actor.id };
      audit = true; result = { invitation_id: p.invitation_id }; break;
    }
    case "membership.accept": {
      // Invited people are intentionally authorized by the invitation, not an existing membership.
      const o = needOrg(); exact(p, ["invitation_id"]); validId(p.invitation_id);
      const invite = o.invitations[p.invitation_id];
      demand(invite && invite.person_id === c.actor.id && !invite.accepted && active(invite.expires_at, now), "forbidden", "no live invitation");
      const authorizer = personPermissions(s, o, invite.authorized_by, now);
      requireRight(authorizer, "members.manage"); subset(authorizer, invite.permissions);
      if (!o.controllers.includes(invite.authorized_by)) demand(instant(invite.expires_at) <= instant(o.members[invite.authorized_by].expires_at), "forbidden", "delegator expiry changed");
      o.members[c.actor.id] = { person_id: c.actor.id, permissions: [...invite.permissions], expires_at: invite.expires_at, active: true, authorized_by: invite.authorized_by };
      invite.accepted = true; audit = true; result = { joined: o.id }; break;
    }
    case "membership.revoke": {
      const o = needOrg(); exact(p, ["person_id"]); validId(p.person_id); requireRight(rights, "members.manage");
      demand(!o.controllers.includes(p.person_id), "forbidden", "change controllers through quorum policy");
      const member = o.members[p.person_id]; if (member) { subset(rights, member.permissions); member.active = false; }
      for (const invite of Object.values(o.invitations)) if (invite.person_id === p.person_id) { subset(rights, invite.permissions); invite.accepted = true; }
      audit = true; result = { revoked: true }; break;
    }
    case "module.publish": {
      const o = needOrg(); exact(p, ["module_id", "manifest"]); validId(p.module_id); requireRight(rights, "modules.publish");
      exact(p.manifest, ["version", "name", "permissions"]); text(p.manifest.name);
      demand(typeof p.manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(p.manifest.version), "invalid", "expected semantic manifest version", 400);
      const grants = permissions(p.manifest.permissions);
      demand(grants.every(g => g.startsWith("records.read:") || g.startsWith("records.write:") || ["finance.accept_offer", "finance.fund"].includes(g)), "invalid", "modules may not request administration", 400);
      const m = s.modules[p.module_id] ?? { id: p.module_id, publisher_id: o.id, manifests: {} };
      demand(m.publisher_id === o.id && !m.manifests[p.manifest.version], "conflict", "publisher mismatch or immutable manifest version", 409);
      m.manifests[p.manifest.version] = { version: p.manifest.version, name: p.manifest.name, permissions: grants }; s.modules[m.id] = m;
      audit = true; result = { module_id: m.id, version: p.manifest.version }; break;
    }
    case "installation.create": {
      const o = needOrg(); requireRight(rights, "installations.manage"); exact(p, ["installation_id", "module_id", "manifest_version", "key_id", "permissions", "mode", "expires_at"]);
      validId(p.installation_id); validId(p.module_id); future(p.expires_at, now);
      const manifest = s.modules[p.module_id]?.manifests[p.manifest_version]; demand(manifest, "not_found", "manifest not found", 404);
      const grants = permissions(p.permissions); subset(rights, grants); subset(new Set(manifest.permissions), grants);
      demand(["interactive", "automation"].includes(p.mode), "invalid", "invalid installation mode", 400);
      demand(!Object.values(s.organizations).some(x => x.installations[p.installation_id]), "conflict", "installation ID already used", 409);
      keyFree(s, p.key_id); demand(signed.has(p.key_id), "approval_required", "installation key must prove possession");
      if (!o.controllers.includes(c.actor.id)) demand(instant(p.expires_at) <= instant(o.members[c.actor.id].expires_at), "forbidden", "installation outlives delegator");
      o.installations[p.installation_id] = { id: p.installation_id, organization_id: o.id, module_id: p.module_id, manifest_version: p.manifest_version,
        key_id: p.key_id, permissions: grants, mode: p.mode, expires_at: p.expires_at, active: true };
      audit = true; result = { installation_id: p.installation_id }; break;
    }
    case "installation.revoke": {
      const o = needOrg(); requireRight(rights, "installations.manage"); exact(p, ["installation_id"]); validId(p.installation_id);
      const installed = o.installations[p.installation_id]; demand(installed, "not_found", "installation not found", 404);
      subset(rights, installed.permissions); installed.active = false; audit = true; result = { revoked: true }; break;
    }
    case "workspace.view": {
      const o = needOrg(); exact(p, []);
      if (o.status === "migrated") { result = { organization: { id: o.id, name: o.name, status: o.status }, permissions: [], installations: [], records: [] }; break; }
      result = { organization: { id: o.id, name: o.name, status: o.status }, person_id: c.actor.id, permissions: [...rights],
        installations: Object.values(o.installations).map(i => ({ id: i.id, module_id: i.module_id, manifest: s.modules[i.module_id].manifests[i.manifest_version], active: i.active && active(i.expires_at, now) })),
        // No private membership directory or other organizations' activity is returned here.
        records: Object.values(s.records).filter(r => r.is_head && readVisible(r, o, c.actor.kind, rights)).slice(-50).map(recordView) }; break;
    }
    case "record.append": {
      const o = needOrg(); exact(p, ["record_id", "root_id", "supersedes", "type", "subject_company_id", "counterparty_ids", "visibility", "body"]);
      [p.record_id, p.root_id, p.subject_company_id].forEach(validId); if (p.supersedes !== null) validId(p.supersedes);
      demand(Array.isArray(p.counterparty_ids) && p.counterparty_ids.length <= 16 && new Set(p.counterparty_ids).size === p.counterparty_ids.length, "invalid", "invalid counterparties", 400);
      p.counterparty_ids.forEach(validId);
      demand(!p.counterparty_ids.includes(p.subject_company_id) && ["public", "counterparties", "granted", "private"].includes(p.visibility), "invalid", "invalid visibility or parties", 400);
      demand(p.visibility !== "counterparties" || p.counterparty_ids.length > 0, "invalid", "counterparties visibility requires parties", 400);
      const info = typeInfo(p.type); demand(info && info.namespace !== "core", "invalid", "only registered business types are accepted here", 400);
      requireRight(rights, `records.write:${p.type}`);
      const before = p.supersedes ? s.records[p.supersedes] : null;
      if (p.supersedes) demand(before && readVisible(before, o, c.actor.kind, rights), "not_found", "predecessor not found", 404);
      const parties = before ? [before.subject_company_id, ...before.counterparty_ids] : [p.subject_company_id, ...p.counterparty_ids];
      demand(parties.includes(o.id), "forbidden", "selected company is not a party");
      demand(!s.records[p.record_id], "conflict", "record ID already used", 409);
      if (before) {
        demand(before.is_head && before.type === p.type && before.root_id === p.root_id && before.subject_company_id === p.subject_company_id &&
          same([...before.counterparty_ids].sort(), [...p.counterparty_ids].sort()) && before.visibility === p.visibility, "conflict", "supersession continuity failed", 409);
      } else demand(p.root_id === p.record_id, "invalid", "genesis root must equal record ID", 400);
      demand([p.subject_company_id, ...p.counterparty_ids].every(id => s.organizations[id]?.status === "active"), "forbidden", "all parties must have active local company authority");
      demand(validateBody(p.type, p.body).ok && (info.subject === "self" || p.body[info.subject] === p.subject_company_id), "invalid", "business body schema or subject binding failed", 422);
      if (p.type === "finance.advance_offer" && p.body.status === "accepted") requireRight(rights, "finance.accept_offer");
      if (p.type === "finance.advance" || (p.type === "finance.settlement_event" && p.body.kind === "advance_funding")) requireRight(rights, "finance.fund");
      if ((p.type === "finance.advance_offer" && p.body.status === "accepted") || p.type === "finance.advance" || (p.type === "finance.settlement_event" && p.body.kind === "advance_funding")) {
        demand(c.requested_by !== null, "approval_required", "financial commitment requires an exact human-signed command");
      }
      const party = { issuerCompanyId: o.id, subjectCompanyId: p.subject_company_id, counterpartyIds: p.counterparty_ids };
      checkRoleContinuity(info, before?.body ?? null, p.body, party);
      checkTransition(info, before?.body ?? null, p.body, rolesOf(info, before?.body ?? p.body, party));
      checkIntegrity({ ...p, issuer: { company_id: o.id } } as Envelope<Record<string, unknown>>, before?.body ?? null);
      if (before) before.is_head = false;
      const record: BusinessRecord = { ...p as any, command: c, seq: s.next_seq, is_head: true, accepted_at: new Date(now).toISOString() };
      s.records[p.record_id] = record; audit = true; result = recordView(record); break;
    }
    case "records.list":
    case "records.export": {
      const o = needOrg(); exact(p, ["after", "limit"]);
      demand(Number.isSafeInteger(p.after) && p.after >= 0 && Number.isInteger(p.limit) && p.limit > 0 && p.limit <= 100, "invalid", "invalid pagination", 400);
      if (c.action === "records.export") requireRight(rights, "records.export");
      const rows = Object.values(s.records).filter(r => r.seq > p.after && readVisible(r, o, c.actor.kind, rights)).sort((a, b) => a.seq - b.seq).slice(0, p.limit + 1);
      const page = rows.slice(0, p.limit); result = { records: page.map(recordView), next_cursor: rows.length > p.limit ? page.at(-1)!.seq : null }; break;
    }
    case "organization.export":
    case "migration.preview": {
      const o = controller(); exact(p, []); const snap = snapshot(s, o, audience);
      result = { snapshot: snap, snapshot_hash: await digest(snap) }; break;
    }
    case "migration.commit": {
      const o = controller(); exact(p, ["destination", "snapshot_hash"]); exact(p.destination, ["audience", "key_id"]);
      text(p.destination.audience, 300);
      try { decodeKeyId(p.destination.key_id); } catch { demand(false, "invalid", "invalid destination public key", 400); }
      demand(p.destination.audience !== audience && p.destination.key_id !== options.storeKey.keyId, "invalid", "destination must be another store", 400);
      const snap = snapshot(s, o, audience);
      demand(p.snapshot_hash === await digest(snap), "conflict", "company changed since migration preview", 409);
      const transfer: Transfer = { snapshot: snap, handoff: c, source_key_id: options.storeKey.keyId, signature: "" };
      transfer.signature = encodeSignature(await signBytes(options.storeKey.secretKey, transferBytes(transfer)));
      s.transfers[o.id] = transfer;
      o.status = "migrated"; audit = true; result = transfer; break;
    }
    case "migration.receipt": {
      const o = controller(); exact(p, []);
      const handoff = [...o.audit].reverse().find(a => a.command.action === "migration.commit");
      demand(handoff && o.status === "migrated", "not_found", "no committed handoff", 404);
      result = s.transfers[o.id]; break;
    }
    case "migration.import": {
      exact(p, ["transfer"]); demand(c.actor.kind === "person" && c.organization_id === null, "invalid", "import is a personal operation", 400);
      const transfer = p.transfer as Transfer;
      await verifyTransfer(transfer, { audience, key_id: options.storeKey.keyId }, options.trustedSources);
      const snap = transfer.snapshot;
      demand(snap.organization.controllers.includes(c.actor.id), "forbidden", "import requires a company controller");
      const personal = snap.persons.find(person => person.id === c.actor.id);
      demand(personal?.keys.includes(c.actor.key_id), "forbidden", "importer differs from exported controller identity");
      demand(!s.organizations[snap.organization.id], "conflict", "company already exists at destination", 409);
      for (const person of snap.persons) {
        const existing = s.persons[person.id];
        // Independent self-certifying enrollment can have another request/audience,
        // but active and retired key sets must match; never silently overwrite rotation.
        demand(!existing || (same([...existing.keys].sort(), [...person.keys].sort()) && same([...existing.retired_keys].sort(), [...person.retired_keys].sort())),
          "conflict", "person key authority differs at destination; reconcile explicitly", 409);
        if (!existing) { for (const key of [...person.keys, ...person.retired_keys]) keyFree(s, key); s.persons[person.id] = structuredClone(person); }
      }
      for (const module of snap.modules) {
        demand(!s.modules[module.id] || same(s.modules[module.id], module), "conflict", "module differs at destination", 409);
        s.modules[module.id] = structuredClone(module);
      }
      org = structuredClone(snap.organization); org.status = "active"; org.generation++; org.imported_from = await digest(transfer);
      // Vendor credentials are not transferred. Old installations remain inspectable but disabled.
      for (const i of Object.values(org.installations)) i.active = false;
      s.organizations[org.id] = org;
      for (const record of snap.records) {
        demand(!s.records[record.record_id], "conflict", "record already exists at destination", 409);
        s.records[record.record_id] = { ...structuredClone(record), seq: s.next_seq++ };
      }
      audit = true; result = { organization_id: org.id, generation: org.generation, installations_require_reauthorization: true }; break;
    }
    default: demand(false, "not_found", "unknown action", 404);
  }
  if (audit && org) org.audit.push({ seq: s.next_seq++, command: c, accepted_at: new Date(now).toISOString() });
  for (const [id, receipt] of Object.entries(s.receipts)) if (receipt.expires_at <= now) delete s.receipts[id];
  s.receipts[c.request_id] = { hash: requestHash, result, expires_at: instant(c.expires_at) };
  return result;
}
// Public record views include signed attribution, not the company's private directory.
export function recordView(record: BusinessRecord) { return structuredClone(record); }
