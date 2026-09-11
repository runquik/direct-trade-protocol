import type { Context, Snapshot, State, Command, Membership, Invitation, Installation } from "./model.ts";
import { demand, digest, exact, instant, organizationId, personId, same, uuid, validKey, validateCommand, verifyCommand } from "./wire.ts";
import { validateProfile, validateShape } from "./profiles.ts";
import { checkPermissions } from "./permissions.ts";
import { applyInventoryEvent, createInventoryState } from "../profiles/inventory.ts";
import { validateInvoice } from "../profiles/invoice.ts";
import { canonicalBytes } from "../canonical.ts";
import { verifyBytes, decodeSignature } from "../keys.ts";

export function buildSnapshot(s: State, organizationId: string, ctx: Context): Snapshot {
  const organization = s.organizations[organizationId]; demand(organization, "not_found", "company unavailable", 404);
  const policies = Object.values(s.policies).filter(p => p.organization_id === organizationId);
  const records = Object.values(s.records).filter(r => r.organization_id === organizationId).sort((a,b) => a.seq-b.seq);
  const releases = [...new Set([...Object.values(organization.installations).map(i => i.release_digest), ...Object.values(s.releases).filter(r => r.publisher_id === organizationId).map(r => r.digest)])].sort().map(d => s.releases[d]);
  demand(releases.every(Boolean), "invalid_snapshot", "installed release is missing");
  const profileIds = new Set([...records.map(r => r.profile_digest), ...releases.flatMap(r => r.profiles), ...Object.values(s.profiles).filter(p => p.publisher_id === organizationId).map(p => p.digest)]);
  for (const id of profileIds) { demand(s.profiles[id], "invalid_snapshot", "required profile is missing"); for (const dependency of s.profiles[id].dependencies) profileIds.add(dependency); }
  const people = new Set([...organization.controllers, ...Object.keys(organization.members), ...Object.values(organization.invitations).map(i => i.person_id),
    ...policies.flatMap(p => [...p.stewards, ...p.grants.map(g => g.person_id)]), ...Object.values(organization.installations).map(i => i.sponsor_id)]);
  for (const c of [...organization.history, ...policies.flatMap(p => p.history), ...records.map(r => r.command), ...[...profileIds].map(d => s.profiles[d].command), ...releases.map(r => r.command), ...Object.values(s.inventory[organizationId]?.creations ?? {}) as Command[]]) {
    if (c.actor.kind === "person") people.add(c.actor.id); if (c.requested_by) people.add(c.requested_by);
    if (Array.isArray(c.payload.controllers)) c.payload.controllers.forEach((id: string) => people.add(id));
    if (Array.isArray(c.payload.stewards)) c.payload.stewards.forEach((id: string) => people.add(id));
  }
  demand([...people].every(id => s.persons[id]), "invalid_snapshot", "required personal history is missing");
  const counterparties = new Set(records.flatMap(r => r.counterparty_ids));
  return structuredClone({ version: "0.4", source: ctx.audience, organization, persons: [...people].sort().map(id => s.persons[id]), policies,
    profiles: [...profileIds].sort().map(d => s.profiles[d]), releases, records,
    remote_authorities: [...counterparties].flatMap(id => s.remote_authorities[id] ? [s.remote_authorities[id].token] : []),
    inventory: s.inventory[organizationId] ? { [organizationId]: s.inventory[organizationId] } : {} });
}
export async function validateSnapshot(s: State, snap: Snapshot) {
  exact(snap, ["version", "source", "organization", "persons", "policies", "profiles", "releases", "records", "remote_authorities", "inventory"]);
  demand(snap.version === "0.4" && typeof snap.source === "string" && snap.organization?.status === "active" && uuid(snap.organization.id) && Number.isSafeInteger(snap.organization.generation) && snap.organization.generation >= 1 && Array.isArray(snap.organization.history) && Array.isArray(snap.persons) && Array.isArray(snap.records) && Array.isArray(snap.policies) && Array.isArray(snap.profiles) && Array.isArray(snap.releases) && Array.isArray(snap.remote_authorities) && snap.inventory && typeof snap.inventory === "object" && !Array.isArray(snap.inventory), "invalid_snapshot", "invalid snapshot collections", 400);
  exact(snap.organization, ["id", "name", "controllers", "threshold", "generation", "status", "members", "invitations", "installations", "history"]);
  demand(Object.keys(snap.inventory).every(id => id === snap.organization.id), "invalid_snapshot", "foreign inventory state in snapshot");
  // Two independently staged companies can collide even while the destination's
  // live tables are still empty. Treat every other ready stage as reserved state
  // during validation, not only normal commands after readiness.
  const reserved = Object.values(s.incoming).filter(stage => !stage.activated && !stage.aborted && stage.ready_token && stage.snapshot && stage.manifest.organization_id !== snap.organization.id).map(stage => stage.snapshot!);
  if (reserved.length) {
    s = {...s,persons:{...s.persons},organizations:{...s.organizations},profiles:{...s.profiles},policies:{...s.policies},releases:{...s.releases},records:{...s.records}};
    for (const other of reserved) {
      s.organizations[other.organization.id] ??= other.organization;
      for (const p of other.persons) s.persons[p.id] ??= p;
      for (const p of other.profiles) s.profiles[p.digest] ??= p;
      for (const p of other.policies) s.policies[p.id] ??= p;
      for (const r of other.releases) s.releases[r.digest] ??= r;
      for (const r of other.records) s.records[r.id] ??= r;
    }
  }
  const seen = new Set<string>();
  const keyOwners = new Map<string, string>();
  for (const person of Object.values(s.persons)) for (const key of [...person.keys, ...person.retired_keys]) keyOwners.set(key, person.id);
  for (const org of Object.values(s.organizations)) for (const inst of Object.values(org.installations)) keyOwners.set(inst.key_id, `installation:${inst.id}`);
  for (const p of snap.persons) {
    demand(p && !seen.has(p.id) && Array.isArray(p.history) && p.history.length > 0, "invalid_snapshot", "invalid person history"); seen.add(p.id);
    exact(p, ["id", "keys", "retired_keys", "history"]); demand(uuid(p.id), "invalid_snapshot", "invalid person ID");
    let keys: string[] = [], retired: string[] = [];
    const commands = new Set<string>();
    for (const [i,c] of p.history.entries()) {
      validateCommand(c, c.audience, instant(c.issued_at)); const signed = await verifyCommand(c);
      demand(!commands.has(c.request_id), "invalid_snapshot", "repeated personal command"); commands.add(c.request_id);
      demand(c.actor.kind === "person" && c.actor.id === p.id && c.organization_id === null && c.requested_by === p.id, "invalid_snapshot", "invalid personal history context");
      if (i === 0) {
        exact(c.payload, ["keys"]); demand(Array.isArray(c.payload.keys), "invalid_snapshot", "invalid genesis keys");
        demand(c.action === "person.register" && p.id === await personId(c.actor.key_id) && c.payload.keys.includes(c.actor.key_id) && c.payload.keys.every((k: string) => signed.has(k)), "invalid_snapshot", "invalid personal genesis"); keys = [...c.payload.keys];
      } else {
        exact(c.payload, ["add", "revoke"]); demand(Array.isArray(c.payload.add) && Array.isArray(c.payload.revoke) && new Set([...c.payload.add, ...c.payload.revoke]).size === c.payload.add.length + c.payload.revoke.length, "invalid_snapshot", "duplicate or overlapping rotation keys");
        demand(c.action === "person.rotate" && keys.includes(c.actor.key_id) && c.payload.revoke.every((k: string) => keys.includes(k)) && c.payload.add.every((k: string) => signed.has(k) && !keys.includes(k) && !retired.includes(k)), "invalid_snapshot", "invalid key rotation");
        retired.push(...c.payload.revoke); keys = [...keys.filter(k => !c.payload.revoke.includes(k)), ...c.payload.add];
      }
      demand(keys.length > 0 && keys.length <= 8 && new Set(keys).size === keys.length, "invalid_snapshot", "invalid current keys");
    }
    demand(same(p.keys, keys) && same(p.retired_keys, retired), "invalid_snapshot", "key projection differs from signed history");
    for (const key of [...keys, ...retired]) { validKey(key); demand(!keyOwners.has(key) || keyOwners.get(key) === p.id, "conflict", "personal key aliases another identity", 409); keyOwners.set(key, p.id); }
    const existing = s.persons[p.id]; demand(!existing || (same(existing.keys, p.keys) && same(existing.retired_keys, p.retired_keys)), "conflict", "destination identity diverged", 409);
  }
  const people = Object.fromEntries(snap.persons.map(p => [p.id,p]));
  const signedBy = (id: string, proofs: Set<string>) => people[id] && [...people[id].keys,...people[id].retired_keys].some(k => proofs.has(k));
  const associated = new Set<string>([...snap.organization.controllers, ...Object.keys(snap.organization.members)]);
  for (const c of snap.organization.history) {
    if (["organization.create","organization.policy"].includes(c.action) && Array.isArray(c.payload.controllers)) for (const id of c.payload.controllers) associated.add(id);
    if (c.action === "membership.accept") associated.add(c.actor.id);
  }
  const historicalPerson = async (c: Command, orgId: string) => {
    validateCommand(c, c.audience, instant(c.issued_at)); const signed = await verifyCommand(c);
    demand(c.actor.kind === "person" && c.organization_id === orgId && c.requested_by === c.actor.id && signedBy(c.actor.id, signed), "invalid_snapshot", "signed personal company context differs"); return signed;
  };
  let controllers: string[] = [], threshold = 0;
  const members: Record<string,Membership> = {}, invitations: Record<string,Invitation> = {}, installations: Record<string,Installation> = {};
  const historyIds = new Set<string>();
  const memberActive = (id: string, at: number) => !!people[id] && (controllers.includes(id) || !!(members[id]?.active && instant(members[id].expires_at) > at));
  const manage = (c: Command, permission: string) => demand(memberActive(c.actor.id,instant(c.issued_at)) && (controllers.includes(c.actor.id) || members[c.actor.id]?.permissions.includes(permission)), "invalid_snapshot", "historical administration exceeded authority");
  for (const [i,c] of snap.organization.history.entries()) {
    const signed = await historicalPerson(c, snap.organization.id);
    demand(!historyIds.has(c.request_id), "invalid_snapshot", "duplicate organization history command"); historyIds.add(c.request_id);
    if (i === 0) {
      exact(c.payload,["name","nonce","controllers","threshold"]);
      demand(c.action === "organization.create" && snap.organization.id === await organizationId(c.actor.id,c.payload.nonce) && c.payload.controllers.includes(c.actor.id) && c.payload.controllers.every((id: string) => signedBy(id,signed)), "invalid_snapshot", "invalid organization genesis");
      controllers = c.payload.controllers; threshold = c.payload.threshold;
      demand(snap.organization.name === c.payload.name, "invalid_snapshot", "company name differs from signed genesis");
    } else if (c.action === "organization.policy") {
      exact(c.payload,["controllers","threshold"]);
      demand(controllers.includes(c.actor.id) && controllers.filter(id => signedBy(id,signed)).length >= threshold && c.payload.controllers.filter((id:string) => !controllers.includes(id)).every((id:string) => signedBy(id,signed)), "invalid_snapshot", "invalid controller transition");
      controllers = c.payload.controllers; threshold = c.payload.threshold;
    } else if (c.action === "membership.invite") {
      exact(c.payload,["invitation_id","person_id","permissions","expires_at"]); const p = c.payload; manage(c,"members.manage");
      demand(uuid(p.invitation_id) && people[p.person_id] && !controllers.includes(p.person_id) && !invitations[p.invitation_id], "invalid_snapshot", "invalid historical invitation");
      const permissions = checkPermissions(p.permissions); demand(instant(p.expires_at) > instant(c.issued_at) && instant(p.expires_at) <= instant(c.issued_at) + 366*86400000, "invalid_snapshot", "invalid historical invitation expiry");
      if (!controllers.includes(c.actor.id)) demand(permissions.every(x => members[c.actor.id].permissions.includes(x)) && instant(p.expires_at) <= instant(members[c.actor.id].expires_at), "invalid_snapshot", "historical invitation exceeds inviter");
      for (const inv of Object.values(invitations)) if (inv.person_id === p.person_id) inv.accepted = true;
      invitations[p.invitation_id] = {id:p.invitation_id,person_id:p.person_id,permissions,expires_at:p.expires_at,active:true,accepted:false,authorized_by:c.actor.id};
    } else if (c.action === "membership.accept") {
      exact(c.payload,["invitation_id"]); const inv = invitations[c.payload.invitation_id];
      demand(inv?.active && !inv.accepted && inv.person_id === c.actor.id && instant(inv.expires_at) > instant(c.issued_at) && memberActive(inv.authorized_by,instant(c.issued_at)), "invalid_snapshot", "invalid historical invitation acceptance");
      demand(controllers.includes(inv.authorized_by) || (members[inv.authorized_by].permissions.includes("members.manage") && inv.permissions.every(x => members[inv.authorized_by].permissions.includes(x)) && instant(inv.expires_at) <= instant(members[inv.authorized_by].expires_at)), "invalid_snapshot", "inviter authority no longer sufficient");
      members[c.actor.id] = {person_id:inv.person_id,permissions:[...inv.permissions],expires_at:inv.expires_at,active:true,authorized_by:inv.authorized_by}; inv.accepted = true;
    } else if (c.action === "membership.revoke") {
      exact(c.payload,["person_id"]); manage(c,"members.manage"); demand(!controllers.includes(c.payload.person_id), "invalid_snapshot", "historical revoke cannot remove controller");
      if (members[c.payload.person_id]) members[c.payload.person_id].active = false;
      for (const inv of Object.values(invitations)) if (inv.person_id === c.payload.person_id) inv.active = false;
    } else if (c.action === "installation.create") {
      exact(c.payload,["installation_id","release_digest","key_id","policy_ids","actions","mode","expires_at"]); manage(c,"installations.manage"); const p = c.payload;
      const release = snap.releases.find(r => r.digest === p.release_digest);
      demand(uuid(p.installation_id) && !installations[p.installation_id] && release && signed.has(p.key_id), "invalid_snapshot", "invalid signed installation genesis"); validKey(p.key_id);
      demand(!Object.values(s.organizations).some(org => Object.hasOwn(org.installations,p.installation_id)), "conflict", "installation ID already exists or is reserved",409);
      demand(!keyOwners.has(p.key_id), "conflict", "installation key aliases another identity",409); keyOwners.set(p.key_id,`installation:${p.installation_id}`);
      demand(Array.isArray(p.policy_ids) && p.policy_ids.length > 0 && p.policy_ids.every((id:string) => snap.policies.some(pol => pol.id === id)) && Array.isArray(p.actions) && p.actions.length > 0 && p.actions.every((a:any) => release.actions.includes(a)) && ["automation","interactive"].includes(p.mode), "invalid_snapshot", "invalid installation scopes"); instant(p.expires_at);
      installations[p.installation_id] = {id:p.installation_id,module_id:release.module_id,release_digest:p.release_digest,key_id:p.key_id,policy_ids:[...p.policy_ids],actions:[...p.actions],sponsor_id:c.actor.id,expires_at:p.expires_at,active:true,mode:p.mode};
    } else if (c.action === "installation.revoke") {
      exact(c.payload,["installation_id"]); manage(c,"installations.manage"); demand(installations[c.payload.installation_id], "invalid_snapshot", "revoked installation never existed"); installations[c.payload.installation_id].active = false;
    } else demand(false,"invalid_snapshot","unsupported organization history action");
    demand(Array.isArray(controllers) && controllers.length >= 1 && controllers.length <= 8 && new Set(controllers).size === controllers.length && controllers.every(uuid) && Number.isSafeInteger(threshold) && threshold > 0 && threshold <= controllers.length, "invalid_snapshot", "invalid historical control threshold");
  }
  demand(controllers.length > 0 && threshold > 0 && threshold <= controllers.length && same(controllers,snap.organization.controllers) && threshold === snap.organization.threshold, "invalid_snapshot", "controller projection mismatch");
  demand(same(members,snap.organization.members) && same(invitations,snap.organization.invitations), "invalid_snapshot", "membership projection differs from signed history");
  // A prior migration disables installations without manufacturing a user command.
  for (const [id,inst] of Object.entries(installations)) if (snap.organization.generation > 1 && snap.organization.installations[id]?.active === false) inst.active = false;
  demand(same(installations,snap.organization.installations), "invalid_snapshot", "installation projection differs from signed history");
  const candidate = { ...s, profiles: { ...s.profiles, ...Object.fromEntries(snap.profiles.map(p => [p.digest,p])) } };
  const profileDigests = new Set<string>(), profileNames = new Map<string,string>();
  for (const p of Object.values(s.profiles)) profileNames.set(JSON.stringify([p.publisher_id,p.name,p.version]),p.digest);
  for (const p of snap.profiles) {
    exact(p, ["id", "publisher_id", "name", "version", "digest", "schema", "semantics", "dependencies", "visibility", "readers", "command"]);
    demand(uuid(p.publisher_id) && !profileDigests.has(p.digest), "invalid_snapshot", "invalid or duplicate profile"); profileDigests.add(p.digest);
    await validateProfile(p,candidate); await historicalPerson(p.command, p.publisher_id);
    if (p.publisher_id === snap.organization.id) demand(associated.has(p.command.actor.id), "invalid_snapshot", "publisher actor was never associated with company");
    exact(p.command.payload,["name","version","schema","semantics","dependencies","visibility","readers","digest"]);
    demand(p.id === `${p.publisher_id}/${p.name}@${p.version}`, "invalid_snapshot", "profile ID differs from publisher namespace");
    demand(p.command.action === "profile.publish" && ["private", "community"].includes(p.visibility) && Array.isArray(p.readers) && new Set(p.readers).size === p.readers.length && p.readers.every(uuid), "invalid_snapshot", "invalid profile publication");
    for (const [field,value] of Object.entries(p.command.payload)) demand(field in p && same(value,(p as any)[field]), "invalid_snapshot", "profile publication differs from signed fields");
    for (const field of ["name", "version", "schema", "semantics", "dependencies", "visibility", "readers"]) demand(Object.hasOwn(p.command.payload, field), "invalid_snapshot", "profile signature omits required contract field");
    const name = JSON.stringify([p.publisher_id,p.name,p.version]); demand(!profileNames.has(name) || profileNames.get(name) === p.digest, "conflict", "profile namespace/version collision", 409); profileNames.set(name,p.digest);
    demand(!s.profiles[p.digest] || same(s.profiles[p.digest],p), "conflict", "profile differs at destination",409);
  }
  const visitedProfiles = new Set<string>(), visitingProfiles = new Set<string>();
  for (const p of snap.profiles) {
    const pending = [{id:p.digest,exit:false}];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.exit) { visitingProfiles.delete(node.id); visitedProfiles.add(node.id); continue; }
      demand(!visitingProfiles.has(node.id), "invalid_snapshot", "cyclic profile dependencies");
      if (visitedProfiles.has(node.id)) continue;
      demand(candidate.profiles[node.id],"invalid_snapshot","missing transitive profile dependency");
      visitingProfiles.add(node.id); pending.push({id:node.id,exit:true});
      for (const dependency of candidate.profiles[node.id].dependencies) pending.push({id:dependency,exit:false});
    }
  }
  const policyIds = new Set<string>();
    for (const p of snap.policies) {
    exact(p,["id","organization_id","revision","classification","stewards","threshold","grants","history"]);
    demand(uuid(p.id) && p.organization_id === snap.organization.id && !s.policies[p.id] && !policyIds.has(p.id), "conflict", "policy scope or destination collision",409); policyIds.add(p.id);
    demand(Array.isArray(p.history) && p.history.length > 0 && p.history.length === p.revision, "invalid_snapshot", "invalid policy revision history");
    let prior: any = null; const seenPolicyCommands = new Set<string>();
    for (const [index,c] of p.history.entries()) {
      const proofs = await historicalPerson(c,p.organization_id); exact(c.payload,["policy_id","expected_revision","classification","stewards","threshold","grants"]); const value = c.payload;
      demand(associated.has(c.actor.id), "invalid_snapshot", "policy actor was never associated with company");
      demand(!seenPolicyCommands.has(c.request_id) && value.policy_id === p.id && value.expected_revision === index && c.action === (index === 0 ? "policy.create" : "policy.update"), "invalid_snapshot", "invalid policy command sequence"); seenPolicyCommands.add(c.request_id);
      demand(["business","personnel"].includes(value.classification) && Array.isArray(value.stewards) && value.stewards.length > 0 && value.stewards.length <= 8 && new Set(value.stewards).size === value.stewards.length && value.stewards.every((id:string) => people[id] && associated.has(id)) && Number.isSafeInteger(value.threshold) && value.threshold > 0 && value.threshold <= value.stewards.length, "invalid_snapshot", "invalid policy stewardship");
      if (prior) demand(prior.classification === value.classification && prior.stewards.includes(c.actor.id) && prior.stewards.filter((id:string) => signedBy(id,proofs)).length >= prior.threshold, "invalid_snapshot", "policy update lacks prior stewardship quorum");
      demand(value.stewards.filter((id:string) => !prior?.stewards.includes(id)).every((id:string) => signedBy(id,proofs)), "invalid_snapshot", "new steward consent missing");
      demand(Array.isArray(value.grants) && value.grants.length <= 256, "invalid_snapshot", "invalid policy grants");
      for (const g of value.grants) {
        exact(g,["person_id","actions","resource_ids","expires_at"]);
        demand(people[g.person_id] && associated.has(g.person_id) && Array.isArray(g.actions) && g.actions.length > 0 && g.actions.length <= 3 && new Set(g.actions).size === g.actions.length && g.actions.every((a:string) => ["read","write","export"].includes(a)) && (g.resource_ids === "*" || (Array.isArray(g.resource_ids) && g.resource_ids.length > 0 && g.resource_ids.length <= 128 && new Set(g.resource_ids).size === g.resource_ids.length && g.resource_ids.every(uuid))), "invalid_snapshot", "invalid grant scope");
        demand(instant(g.expires_at) > instant(c.issued_at) && instant(g.expires_at) <= instant(c.issued_at)+366*86400000, "invalid_snapshot", "invalid historical grant lifetime");
      }
      prior = value;
    }
    demand(same({classification:p.classification,stewards:p.stewards,threshold:p.threshold,grants:p.grants},{classification:prior.classification,stewards:prior.stewards,threshold:prior.threshold,grants:prior.grants}), "invalid_snapshot", "policy projection differs from signed history");
  }
  const sourceInventory = snap.inventory[snap.organization.id];
  const rebuiltInventory: any = {pools:{},observations:{},creations:{}};
  if (sourceInventory) {
    exact(sourceInventory,["pools","observations","creations"]);
    for (const [poolId,creation] of Object.entries(sourceInventory.creations) as [string,Command][]) {
      await historicalPerson(creation,snap.organization.id); exact(creation.payload,["policy_id","pool_id","product_id","base_unit"]); const p = creation.payload;
      demand(associated.has(creation.actor.id) && creation.action === "inventory.create" && p.pool_id === poolId && uuid(poolId) && uuid(p.product_id) && policyIds.has(p.policy_id), "invalid_snapshot", "invalid signed stock pool creation");
      try { rebuiltInventory.pools[poolId] = {...createInventoryState(snap.organization.id,poolId,p.product_id,p.base_unit),policy_id:p.policy_id}; } catch { demand(false,"invalid_snapshot","invalid stock pool scope or unit"); }
      rebuiltInventory.creations[poolId] = structuredClone(creation);
    }
  }
  const recordIds = new Set<string>(), roots = new Set<string>(), predecessors = new Set<string>(); let priorSeq = 0;
  const records = new Map(snap.records.map(r => [r.id,r]));
  for (const r of snap.records) {
    demand(r.organization_id === snap.organization.id && !s.records[r.id] && !recordIds.has(r.id) && candidate.profiles[r.profile_digest] && snap.policies.some(p => p.id === r.policy_id), "invalid_snapshot", "record collision or dependency missing"); recordIds.add(r.id);
    validateCommand(r.command,r.command.audience,instant(r.command.issued_at)); const recordProofs = await verifyCommand(r.command);
    if (r.command.actor.kind === "person") demand(associated.has(r.command.actor.id) && signedBy(r.command.actor.id,recordProofs) && r.command.requested_by === r.command.actor.id, "invalid_snapshot", "record actor identity unavailable");
    else { const inst = installations[r.command.actor.id], release = inst && snap.releases.find(x => x.digest === inst.release_digest); demand(inst && inst.key_id === r.command.actor.key_id && inst.actions.includes("write") && inst.policy_ids.includes(r.policy_id) && release?.profiles.includes(r.profile_digest) && (r.command.requested_by === null ? inst.mode === "automation" : associated.has(r.command.requested_by) && signedBy(r.command.requested_by,recordProofs)), "invalid_snapshot", "record installation attribution differs"); }
    demand(uuid(r.id) && uuid(r.root_id) && uuid(r.policy_id) && uuid(r.resource_id) && Number.isSafeInteger(r.seq) && r.seq > priorSeq && typeof r.is_head === "boolean" && r.command.organization_id === r.organization_id, "invalid_snapshot", "invalid record metadata/order"); priorSeq = r.seq; instant(r.accepted_at);
    demand(Array.isArray(r.counterparty_ids) && r.counterparty_ids.length <= 16 && new Set(r.counterparty_ids).size === r.counterparty_ids.length && r.counterparty_ids.every(id => uuid(id) && id !== r.organization_id), "invalid_snapshot", "invalid record counterparties");
    demand(validateShape(candidate.profiles[r.profile_digest].schema,r.body), "invalid_snapshot", "record does not satisfy pinned profile");
    const { command: _, seq: _seq, is_head: _head, accepted_at: _at, validation: _v, ...payload } = r;
    demand(r.command.action === "record.append" && same(payload,r.command.payload), "invalid_snapshot", "signed record payload differs");
    const semantics = candidate.profiles[r.profile_digest].semantics;
    let expectedValidation: any = {profile:r.profile_digest,level:"structural",business_verified:false};
    if (semantics === "invoice-v1") {
      demand(r.body.seller_company_id === r.organization_id && r.counterparty_ids.includes(r.body.buyer_company_id), "invalid_snapshot", "invoice parties differ");
      expectedValidation = validateInvoice(r.body,{resolveReference:()=>({status:"unknown"})}); demand(expectedValidation.valid, "invalid_snapshot", "invalid invoice arithmetic");
    }
    if (semantics === "inventory-v1") {
      const event = r.body, pool = rebuiltInventory.pools[event.pool_id];
      demand(r.supersedes === null && event.company_id === r.organization_id && event.pool_id === r.resource_id && pool?.policy_id === r.policy_id, "invalid_snapshot", "inventory event scope differs");
      const observation = JSON.stringify([event.source_id,event.observation_id]); demand(!rebuiltInventory.observations[observation], "invalid_snapshot", "duplicate inventory effect");
      const changed = applyInventoryEvent(pool,event as any); demand(changed.ok && !changed.duplicate, "invalid_snapshot", "inventory sequence violates profile");
      rebuiltInventory.pools[event.pool_id] = changed.state; rebuiltInventory.observations[observation] = {hash:await digest(event),record_id:r.id,policy_id:r.policy_id,profile_digest:r.profile_digest};
      expectedValidation = {profile:"dtp.inventory/1",revision:changed.state.revision,physical_stock_verified:false};
    }
    demand(same(r.validation,expectedValidation), "invalid_snapshot", "record validation projection differs from deterministic profile");
    if (r.is_head) { demand(!roots.has(r.root_id), "invalid_snapshot", "multiple current heads"); roots.add(r.root_id); }
    if (r.supersedes) {
      const before = records.get(r.supersedes);
      demand(before && before.id !== r.id && recordIds.has(before.id) && !predecessors.has(before.id) && !before.is_head && before.root_id === r.root_id && before.organization_id === r.organization_id && before.policy_id === r.policy_id && before.resource_id === r.resource_id && before.profile_digest === r.profile_digest && same(before.counterparty_ids,r.counterparty_ids), "invalid_snapshot", "invalid supersession continuity"); predecessors.add(before.id);
    } else demand(r.root_id === r.id, "invalid_snapshot", "genesis root must equal record ID");
  }
  for (const r of snap.records) demand(r.is_head === !predecessors.has(r.id), "invalid_snapshot", "head flag differs from signed chain");
  if (sourceInventory) demand(same(sourceInventory,rebuiltInventory), "invalid_snapshot", "inventory projection differs from signed events");
  const releaseDigests = new Set<string>(), releaseNames = new Map<string,string>();
  for (const r of Object.values(s.releases)) releaseNames.set(JSON.stringify([r.publisher_id,r.module_id,r.version]),r.digest);
  for (const r of snap.releases) {
    exact(r,["module_id", "publisher_id", "version", "digest", "artifact_digest", "profiles", "actions", "visibility", "assessment", "command"]);
    demand(uuid(r.publisher_id) && uuid(r.module_id) && !releaseDigests.has(r.digest), "invalid_snapshot", "invalid or duplicate release"); releaseDigests.add(r.digest);
    await historicalPerson(r.command,r.publisher_id); demand(r.command.action === "release.publish", "invalid_snapshot", "invalid release publication");
    if (r.publisher_id === snap.organization.id) demand(associated.has(r.command.actor.id), "invalid_snapshot", "release actor was never associated with company");
    exact(r.command.payload,["module_id","version","artifact_digest","profiles","actions","visibility","assessment"]);
    demand(r.digest === await digest({publisher_id:r.publisher_id,...r.command.payload}) && /^\d+\.\d+\.\d+$/.test(r.version) && /^[0-9a-f]{64}$/.test(r.artifact_digest), "invalid_snapshot", "release digest/version differs");
    demand(["private","community"].includes(r.visibility) && Array.isArray(r.actions) && r.actions.length > 0 && r.actions.length <= 3 && new Set(r.actions).size === r.actions.length && r.actions.every(a => ["read","write","export"].includes(a)), "invalid_snapshot", "invalid release visibility or actions");
    if (r.assessment !== null) {
      exact(r.assessment,["body","key_id","signature"]); const a = r.assessment.body;
      demand(a?.kind === "module-assessment" && a.artifact_digest === r.artifact_digest && a.outcome === "approved" && typeof a.issuer === "string" && instant(a.expires_at) > instant(a.issued_at), "invalid_snapshot", "assessment does not bind artifact");
      let valid = false; try { valid = await verifyBytes(r.assessment.key_id,canonicalBytes({domain:"DTP-TOKEN-0.4",body:a}),decodeSignature(r.assessment.signature)); } catch { /* malformed proof */ }
      demand(valid,"invalid_snapshot","artifact assessment signature differs");
      // Cryptographic preservation does not transfer issuer trust or renew an
      // expired approval. Destination installations are disabled and re-screened.
    }
    demand(!Object.values(s.releases).some(other => other.module_id === r.module_id && other.publisher_id !== r.publisher_id) && !snap.releases.some(other => other.module_id === r.module_id && other.publisher_id !== r.publisher_id), "conflict", "module publisher namespace collision",409);
    for (const [field,value] of Object.entries(r.command.payload)) demand(field in r && same(value,(r as any)[field]), "invalid_snapshot", "release differs from signed publication");
    for (const field of ["module_id", "version", "artifact_digest", "profiles", "actions", "visibility", "assessment"]) demand(Object.hasOwn(r.command.payload,field), "invalid_snapshot", "release signature omits required contract field");
    const name = JSON.stringify([r.publisher_id,r.module_id,r.version]); demand(!releaseNames.has(name) || releaseNames.get(name) === r.digest, "conflict", "release namespace/version collision",409); releaseNames.set(name,r.digest);
    demand(Array.isArray(r.profiles) && r.profiles.length > 0 && r.profiles.length <= 16 && new Set(r.profiles).size === r.profiles.length && r.profiles.every(p => candidate.profiles[p]), "invalid_snapshot", "release profile dependency missing");
    demand(!s.releases[r.digest] || same(s.releases[r.digest],r), "conflict", "release differs at destination",409);
  }
  demand(!s.organizations[snap.organization.id], "conflict", "company already exists",409);
}
export async function applySnapshot(s: State, snap: Snapshot) {
  await validateSnapshot(s,snap);
  for (const p of snap.persons) s.persons[p.id] ??= structuredClone(p);
  for (const p of snap.profiles) s.profiles[p.digest] = structuredClone(p);
  for (const p of snap.policies) s.policies[p.id] = structuredClone(p);
  for (const r of snap.releases) s.releases[r.digest] = structuredClone(r);
  for (const r of snap.records) s.records[r.id] = { ...structuredClone(r), seq: s.next_seq++ };
  const org = structuredClone(snap.organization); org.status = "active"; org.generation++;
  for (const installation of Object.values(org.installations)) installation.active = false;
  s.organizations[org.id] = org;
  if (snap.inventory[org.id]) s.inventory[org.id] = structuredClone(snap.inventory[org.id]);
  // Remote tokens remain explicit, fresh authority imports; expired export-time
  // observations never become renewed rights merely because a company moved.
}
