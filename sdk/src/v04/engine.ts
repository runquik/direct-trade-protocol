// Deterministic candidate kernel. MUST execute in one transaction; discard state
// on failure. Data policies are separate from organization administration.
import type { BusinessRecord, Command, Context, DataAction, Organization, Policy, Profile, Release, State } from "./model.ts";
import { demand, digest, exact, instant, organizationId, personId, same, uuid, validKey, validateCommand, verifyCommand, verifyAssessment, signToken, verifyToken } from "./wire.ts";
import { activeMember, checkPermissions, checkPolicy, controller, dataAllowed, management, quorum, steward } from "./permissions.ts";
import { profileContract, validateProfile, validateShape } from "./profiles.ts";
import { buildSnapshot, validateSnapshot, applySnapshot } from "./snapshot.ts";
import * as migration from "./migration.ts";
import { authorityAccept, authorityIssue, authorityRelocate, requireRemoteAuthority } from "./federation.ts";
import { applyInventoryEvent, createInventoryState } from "../profiles/inventory.ts";
import { validateInvoice } from "../profiles/invoice.ts";

function ids(values: any, min = 1, max = 8): asserts values is string[] {
  demand(Array.isArray(values) && values.length >= min && values.length <= max && new Set(values).size === values.length && values.every(uuid), "invalid", "invalid distinct IDs",400);
}
function id(value: unknown) { demand(uuid(value),"invalid","expected UUID",400); }
function text(value: unknown, max = 120): asserts value is string { demand(typeof value === "string" && value.length > 0 && value.length <= max,"invalid","invalid text",400); }
function isDigest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function future(value: unknown, ctx: Context) { const n = instant(value); demand(n > ctx.now && n <= ctx.now + 366*86400000,"invalid","expiry must be within one year",400); }
function keyFree(s: State, key: string) {
  validKey(key);
  demand(!migration.migrationKeyReserved(s,key),"migration_reserved","key reserved for validated migration",409);
  demand(!Object.values(s.persons).some(p => [...p.keys,...p.retired_keys].includes(key)) && !Object.values(s.organizations).some(o => Object.values(o.installations).some(i => i.key_id === key)),"conflict","key already bound",409);
}
function accessibleProfile(p: Profile, org: string) { return p.visibility === "community" || p.publisher_id === org || p.readers.includes(org); }
const reads = new Set(["organizations.list","workspace.view","records.list","records.export","record.get","profile.get","policy.get","evidence.inspect","migration.chunk","migration.receipt","migration.status"]);
const installationActions = new Set(["record.append","record.get","records.list","records.export","profile.get","inventory.get","evidence.inspect"]);
export async function execute(s: State, input: unknown, ctx: Context): Promise<any> {
  validateCommand(input,ctx.audience,ctx.now); const c = input, p = c.payload, signed = await verifyCommand(c), hash = await digest(c);
  let org = c.organization_id ? s.organizations[c.organization_id] : undefined;
  if (c.action !== "person.register") {
    if (c.actor.kind === "person") demand(s.persons[c.actor.id]?.keys.includes(c.actor.key_id) && c.requested_by === c.actor.id,"forbidden","inactive personal authority");
    else {
      const inst = org?.installations[c.actor.id];
      demand(inst?.active && inst.key_id === c.actor.key_id && instant(inst.expires_at) > ctx.now && installationActions.has(c.action),"forbidden","inactive or disallowed installation");
      const release=s.releases[inst.release_digest];demand(release?.assessment,"assessment_required","module has no live approved artifact assessment");
      const assessment=await verifyAssessment(release.assessment,ctx);demand(assessment.artifact_digest===release.artifact_digest&&assessment.outcome==="approved","invalid_assessment","assessment does not bind approved artifact");
      if (c.requested_by === null) demand(inst.mode === "automation" && activeMember(s,org!,inst.sponsor_id,ctx.now),"forbidden","automation sponsor unavailable");
      else demand(activeMember(s,org!,c.requested_by,ctx.now) && s.persons[c.requested_by].keys.some(k => signed.has(k)),"approval_required","current requesting human signature required");
    }
  }
  const previous = s.receipts[c.request_id];
  if (previous) demand(previous.hash === hash,"conflict","request ID reused with different content",409);
  const needOrg = () => { demand(org,"not_found","company unavailable",404); return org; };
  const currentOrg = () => { const o = needOrg();
    const person=c.actor.kind==="person"?c.actor.id:c.requested_by??o.installations[c.actor.id]?.sponsor_id;
    demand(c.action==="membership.accept"||activeMember(s,o,person,ctx.now),"not_found","company unavailable",404);
    demand(o.status === "active","migrated","company authority has moved",409); return o; };
  const asController = (o = currentOrg()) => { controller(s,o,c,signed); return o; };
  const policy = (policyId: any, o = currentOrg()) => { id(policyId); const result = s.policies[policyId]; demand(result?.organization_id === o.id,"not_found","policy unavailable",404); return result; };
  const can = (policyId: string, resource: string, action: "read"|"write"|"export") => dataAllowed(s,currentOrg(),policy(policyId),resource,action,c,ctx);
  const understands = (profileDigest:string) => c.actor.kind === "person" || s.releases[currentOrg().installations[c.actor.id].release_digest].profiles.includes(profileDigest);
  const viewRecord = (r:BusinessRecord) => {
    const view:any=structuredClone(r);
    if(s.profiles[r.profile_digest].semantics==="invoice-v1")view.live_validation=validateInvoice(r.body,{resolveReference:(referenceId,expectedType)=>{
      const ref=s.records[referenceId];
      // Live assessment is not persisted/signed record content. Revocation and
      // host changes can alter reference visibility without changing history.
      if(!ref||ref.organization_id!==currentOrg().id||!can(ref.policy_id,ref.resource_id,"read")||!understands(ref.profile_digest))return{status:"unknown"};
      // A publisher-chosen name is not a standardized business type. An operator
      // must pin the exact understood contract profile, including both parties.
      if(!ctx.referenceProfiles?.[expectedType]?.includes(ref.profile_digest)||!uuid(ref.body.seller_company_id)||!uuid(ref.body.buyer_company_id))return{status:"unknown"};
      return{status:"present",type:expectedType,seller_company_id:ref.body.seller_company_id,buyer_company_id:ref.body.buyer_company_id};
    }});
    return view;
  };
  const assertAllStewards = (o: Organization) => {
    for (const pol of Object.values(s.policies).filter(x => x.organization_id === o.id)) {
      quorum(s,pol.stewards.filter(person => activeMember(s,o,person,ctx.now)),pol.threshold,signed);
    }
  };
  let result: any; let history = false;
  switch(c.action) {
    case "person.register": {
      exact(p,["keys"]); demand(c.actor.kind === "person" && c.organization_id === null && c.requested_by === c.actor.id && c.actor.id === await personId(c.actor.key_id),"invalid","invalid personal enrollment",400);
      demand(Array.isArray(p.keys) && p.keys.length > 0 && p.keys.length <= 8 && new Set(p.keys).size === p.keys.length && p.keys.includes(c.actor.key_id),"invalid","invalid enrollment keys",400);
      if (previous) { demand(s.persons[c.actor.id]?.keys.includes(c.actor.key_id),"forbidden","enrollment key revoked"); result = previous.result; break; }
      demand(!s.persons[c.actor.id] && !migration.migrationResourceReserved(s,"persons",c.actor.id),"conflict","identity exists or reserved",409);
      for (const key of p.keys) { keyFree(s,key); demand(signed.has(key),"approval_required","new key possession proof required"); }
      s.persons[c.actor.id] = { id:c.actor.id,keys:[...p.keys],retired_keys:[],history:[c] }; result={person_id:c.actor.id}; break;
    }
    case "person.rotate": {
      exact(p,["add","revoke"]); demand(c.actor.kind === "person" && c.organization_id === null,"invalid","personal operation",400);
      demand(!migration.migrationResourceReserved(s,"persons",c.actor.id),"migration_reserved","identity reserved by validated migration",409);
      if(previous) {result=previous.result;break;}
      const person=s.persons[c.actor.id]; demand(Array.isArray(p.add)&&Array.isArray(p.revoke)&&p.add.length+p.revoke.length<=16&&new Set([...p.add,...p.revoke]).size===p.add.length+p.revoke.length,"invalid","invalid rotation",400);
      for(const key of p.add){keyFree(s,key);demand(signed.has(key),"approval_required","new key proof required");}
      demand(p.revoke.every((k:string)=>person.keys.includes(k)),"invalid","unknown revoked key",400);
      const next=[...person.keys.filter(k=>!p.revoke.includes(k)),...p.add];demand(next.length>0&&next.length<=8,"forbidden","retain active key");
      person.keys=next;person.retired_keys.push(...p.revoke);person.history.push(c);result={person_id:person.id,keys:next};break;
    }
    case "organization.create": {
      exact(p,["name","nonce","controllers","threshold"]);id(c.organization_id);id(p.nonce);ids(p.controllers);text(p.name);
      demand(c.actor.kind === "person" && c.organization_id === await organizationId(c.actor.id,p.nonce) && p.controllers.includes(c.actor.id),"invalid","invalid company genesis",400);
      demand(Number.isInteger(p.threshold)&&p.threshold>0&&p.threshold<=p.controllers.length,"invalid","invalid quorum",400);
      quorum(s,p.controllers,p.controllers.length,signed);
      if(previous){result=previous.result;break;}
      demand(!org&&!migration.migrationReserved(s,c.organization_id!),"conflict","company exists or reserved",409);
      org={id:c.organization_id!,name:p.name,controllers:[...p.controllers],threshold:p.threshold,generation:1,status:"active",members:{},invitations:{},installations:{},history:[]};
      s.organizations[org.id]=org;history=true;result={organization_id:org.id};break;
    }
    case "organization.policy": {
      const o=asController();exact(p,["controllers","threshold"]);ids(p.controllers);demand(Number.isInteger(p.threshold)&&p.threshold>0&&p.threshold<=p.controllers.length,"invalid","invalid quorum",400);
      quorum(s,p.controllers.filter((x:string)=>!o.controllers.includes(x)),p.controllers.filter((x:string)=>!o.controllers.includes(x)).length,signed);
      if(previous){result=previous.result;break;}o.controllers=[...p.controllers];o.threshold=p.threshold;history=true;result={changed:true};break;
    }
    case "organizations.list": {
      exact(p,[]);demand(c.actor.kind==="person"&&c.organization_id===null,"invalid","personal operation",400);
      result=Object.values(s.organizations).filter(o=>activeMember(s,o,c.actor.id,ctx.now)).map(o=>({id:o.id,name:o.name,status:o.status,generation:o.generation}));break;
    }
    case "membership.invite": {
      const o=currentOrg();management(s,o,c,"members.manage",ctx);exact(p,["invitation_id","person_id","permissions","expires_at"]);id(p.invitation_id);id(p.person_id);future(p.expires_at,ctx);
      const permissions=checkPermissions(p.permissions);demand(s.persons[p.person_id]&&!o.controllers.includes(p.person_id),"invalid","target must be registered non-controller",400);
      if(!o.controllers.includes(c.actor.id)) demand(permissions.every(x=>o.members[c.actor.id].permissions.includes(x))&&instant(p.expires_at)<=instant(o.members[c.actor.id].expires_at),"forbidden","delegation exceeds authority");
      if(previous){result=previous.result;break;}demand(!o.invitations[p.invitation_id],"conflict","invitation exists",409);
      for(const inv of Object.values(o.invitations))if(inv.person_id===p.person_id)inv.accepted=true;
      o.invitations[p.invitation_id]={id:p.invitation_id,person_id:p.person_id,permissions,expires_at:p.expires_at,active:true,accepted:false,authorized_by:c.actor.id};history=true;result={invitation_id:p.invitation_id};break;
    }
    case "membership.accept": {
      const o=currentOrg();exact(p,["invitation_id"]);id(p.invitation_id);const inv=o.invitations[p.invitation_id];
      demand(c.actor.kind==="person"&&inv?.person_id===c.actor.id&&inv.active&&instant(inv.expires_at)>ctx.now,"forbidden","invitation unavailable");
      demand(activeMember(s,o,inv.authorized_by,ctx.now)&&(o.controllers.includes(inv.authorized_by)||o.members[inv.authorized_by].permissions.includes("members.manage")),"forbidden","inviter authority revoked");
      if(!o.controllers.includes(inv.authorized_by))demand(inv.permissions.every(x=>o.members[inv.authorized_by].permissions.includes(x))&&instant(inv.expires_at)<=instant(o.members[inv.authorized_by].expires_at),"forbidden","invitation exceeds current inviter authority");
      if(previous){demand(o.members[c.actor.id]?.active,"forbidden","membership revoked");result=previous.result;break;}
      demand(!inv.accepted,"conflict","invitation already consumed",409);o.members[c.actor.id]={person_id:inv.person_id,permissions:[...inv.permissions],expires_at:inv.expires_at,active:true,authorized_by:inv.authorized_by};inv.accepted=true;history=true;result={joined:o.id};break;
    }
    case "membership.revoke": {
      const o=currentOrg();management(s,o,c,"members.manage",ctx);exact(p,["person_id"]);id(p.person_id);demand(!o.controllers.includes(p.person_id),"forbidden","use controller quorum policy");
      if(previous){result=previous.result;break;}const m=o.members[p.person_id];if(m)m.active=false;for(const i of Object.values(o.invitations))if(i.person_id===p.person_id)i.active=false;
      history=true;result={revoked:true};break;
    }
    case "policy.create":
    case "policy.update": {
      const o=currentOrg();exact(p,["policy_id","expected_revision","classification","stewards","threshold","grants"]);id(p.policy_id);
      const old=s.policies[p.policy_id];demand(!migration.migrationResourceReserved(s,"policies",p.policy_id),"migration_reserved","policy reserved",409);
      if(c.action==="policy.create"){management(s,o,c,"policies.create",ctx);demand(!old||!!previous,"conflict","policy exists",409);}else{demand(old?.organization_id===o.id,"not_found","policy unavailable",404);steward(s,o,old,c,signed,ctx);}
      const next:Policy={id:p.policy_id,organization_id:o.id,revision:(old?.revision??0)+1,classification:p.classification,stewards:p.stewards,threshold:p.threshold,grants:p.grants,history:[...(old?.history??[]),c]};
      checkPolicy(next,s,o,ctx);quorum(s,next.stewards.filter(x=>!old?.stewards.includes(x)),next.stewards.filter(x=>!old?.stewards.includes(x)).length,signed);
      if(previous){result=previous.result;break;}demand(p.expected_revision===(old?.revision??0),"conflict","policy revision changed",409);
      if(old)demand(old.classification===next.classification,"forbidden","classification cannot be downgraded");
      s.policies[next.id]=structuredClone(next);result={policy_id:next.id,revision:next.revision};break;
    }
    case "policy.get": {
      exact(p,["policy_id"]);const pol=policy(p.policy_id),o=currentOrg();demand(c.actor.kind==="person"&&activeMember(s,o,c.actor.id,ctx.now)&&pol.stewards.includes(c.actor.id),"not_found","policy unavailable",404);result=structuredClone(pol);break;
    }
    case "profile.publish": {
      const o=currentOrg();management(s,o,c,"profiles.publish",ctx);exact(p,["name","version","schema","semantics","dependencies","visibility","readers","digest"]);ids(p.readers,0,64);
      demand(["private","community"].includes(p.visibility),"invalid","invalid publication visibility",400);
      const profile:Profile={...p,publisher_id:o.id,id:`${o.id}/${p.name}@${p.version}`,command:c} as Profile;
      await validateProfile(profile,s);demand(profile.dependencies.every(d=>accessibleProfile(s.profiles[d],o.id)),"forbidden","private dependency unavailable");
      demand(!migration.migrationResourceReserved(s,"profiles",p.digest),"migration_reserved","profile reserved",409);
      demand(!migration.migrationProfileReserved(s,o.id,p.name,p.version),"migration_reserved","profile identity reserved",409);
      if(previous){result=previous.result;break;}
      demand(!Object.values(s.profiles).some(x=>x.id===profile.id),"conflict","profile version is immutable",409);s.profiles[profile.digest]=structuredClone(profile);result={id:profile.id,digest:profile.digest};break;
    }
    case "profile.get": {
      exact(p,["digest"]);const o=currentOrg();demand(activeMember(s,o,c.requested_by??o.installations[c.actor.id]?.sponsor_id,ctx.now),"forbidden","membership required");
      demand(isDigest(p.digest)&&Object.hasOwn(s.profiles,p.digest),"not_found","profile unavailable",404);const profile=s.profiles[p.digest];demand(accessibleProfile(profile,o.id)&&understands(p.digest),"not_found","profile unavailable",404);result=structuredClone(profile);break;
    }
    case "release.publish": {
      const o=currentOrg();management(s,o,c,"releases.publish",ctx);exact(p,["module_id","version","artifact_digest","profiles","actions","visibility","assessment"]);id(p.module_id);text(p.version);
      demand(/^\d+\.\d+\.\d+$/.test(p.version)&&/^[0-9a-f]{64}$/.test(p.artifact_digest)&&["private","community"].includes(p.visibility),"invalid","invalid release",400);
      demand(Array.isArray(p.profiles)&&p.profiles.length>0&&p.profiles.length<=16&&new Set(p.profiles).size===p.profiles.length&&p.profiles.every((d:string)=>isDigest(d)&&Object.hasOwn(s.profiles,d)&&accessibleProfile(s.profiles[d],o.id)),"unsupported_profile","release profile unavailable",422);
      demand(Array.isArray(p.actions)&&p.actions.length>0&&p.actions.length<=3&&new Set(p.actions).size===p.actions.length&&p.actions.every((a:string)=>["read","write","export"].includes(a)),"invalid","invalid data actions",400);
      if(p.assessment!==null){const a=await verifyAssessment(p.assessment,ctx);demand(a.artifact_digest===p.artifact_digest&&a.outcome==="approved","invalid_assessment","assessment does not approve exact artifact");}
      const rd=await digest({publisher_id:o.id,...p});demand(!migration.migrationResourceReserved(s,"releases",rd),"migration_reserved","release reserved",409);
      demand(!migration.migrationModuleReserved(s,p.module_id),"migration_reserved","module publisher namespace reserved",409);
      if(previous){result=previous.result;break;}demand(!Object.values(s.releases).some(r=>r.module_id===p.module_id&&r.version===p.version),"conflict","release version immutable",409);
      demand(Object.values(s.releases).filter(r=>r.module_id===p.module_id).every(r=>r.publisher_id===o.id),"forbidden","module belongs to another publisher");
      s.releases[rd]={...structuredClone(p),publisher_id:o.id,digest:rd,command:c} as Release;result={digest:rd};break;
    }
    case "installation.create": {
      const o=currentOrg();management(s,o,c,"installations.manage",ctx);exact(p,["installation_id","release_digest","key_id","policy_ids","actions","mode","expires_at"]);id(p.installation_id);ids(p.policy_ids,1,32);future(p.expires_at,ctx);
      demand(isDigest(p.release_digest)&&Object.hasOwn(s.releases,p.release_digest),"not_found","release unavailable",404);const release=s.releases[p.release_digest];demand(release.visibility==="community"||release.publisher_id===o.id,"not_found","release unavailable",404);
      demand(release.assessment,"assessment_required","exact artifact assessment required for installation");const assessment=await verifyAssessment(release.assessment,ctx);demand(assessment.artifact_digest===release.artifact_digest&&assessment.outcome==="approved","invalid_assessment","assessment does not bind approved artifact");
      demand(p.policy_ids.every((x:string)=>s.policies[x]?.organization_id===o.id)&&Array.isArray(p.actions)&&p.actions.length>0&&p.actions.length<=3&&new Set(p.actions).size===p.actions.length&&p.actions.every((x:DataAction)=>release.actions.includes(x)),"forbidden","installation exceeds release or policy scope");
      demand(["interactive","automation"].includes(p.mode),"invalid","invalid installation mode",400);
      if(previous){demand(o.installations[p.installation_id]?.active,"forbidden","installation revoked");result=previous.result;break;}
      demand(!migration.migrationInstallationReserved(s,p.installation_id),"migration_reserved","installation ID reserved",409);
      demand(!Object.values(s.organizations).some(x=>x.installations[p.installation_id]),"conflict","installation ID exists",409);keyFree(s,p.key_id);demand(signed.has(p.key_id),"approval_required","installation key possession required");
      if(!o.controllers.includes(c.actor.id))demand(instant(p.expires_at)<=instant(o.members[c.actor.id].expires_at),"forbidden","installation outlives sponsor");
      o.installations[p.installation_id]={id:p.installation_id,module_id:release.module_id,release_digest:p.release_digest,key_id:p.key_id,policy_ids:[...p.policy_ids],actions:[...p.actions],sponsor_id:c.actor.id,expires_at:p.expires_at,active:true,mode:p.mode};history=true;result={installation_id:p.installation_id};break;
    }
    case "installation.revoke": {
      const o=currentOrg();management(s,o,c,"installations.manage",ctx);exact(p,["installation_id"]);id(p.installation_id);demand(o.installations[p.installation_id],"not_found","installation unavailable",404);
      if(previous){result=previous.result;break;}o.installations[p.installation_id].active=false;history=true;result={revoked:true};break;
    }
    case "record.append": {
      const o=currentOrg();exact(p,["id","root_id","supersedes","organization_id","policy_id","resource_id","profile_digest","counterparty_ids","body"]);[p.id,p.root_id,p.organization_id,p.policy_id,p.resource_id].forEach(id);if(p.supersedes!==null)id(p.supersedes);ids(p.counterparty_ids,0,16);
      demand(p.organization_id===o.id&&!p.counterparty_ids.includes(o.id)&&can(p.policy_id,p.resource_id,"write"),"forbidden","record write permission required");
      demand(isDigest(p.profile_digest)&&Object.hasOwn(s.profiles,p.profile_digest),"unsupported_profile","pinned profile unavailable",422);const profile=s.profiles[p.profile_digest];demand(accessibleProfile(profile,o.id),"unsupported_profile","pinned profile unavailable",422);
      if(c.actor.kind==="installation")demand(s.releases[o.installations[c.actor.id].release_digest].profiles.includes(p.profile_digest),"forbidden","module does not declare this profile");
      if(previous){result=previous.result;break;}demand(!s.records[p.id]&&!migration.migrationResourceReserved(s,"records",p.id),"conflict","record ID exists or reserved",409);
      const before=p.supersedes?s.records[p.supersedes]:null;
      if(before)demand(before.is_head&&before.root_id===p.root_id&&before.organization_id===o.id&&before.policy_id===p.policy_id&&before.resource_id===p.resource_id&&before.profile_digest===p.profile_digest&&same(before.counterparty_ids,p.counterparty_ids)&&can(before.policy_id,before.resource_id,"read"),"conflict","record continuity failed",409);
      else demand(p.supersedes===null&&p.id===p.root_id,"conflict","predecessor missing or genesis invalid",409);
      for(const party of p.counterparty_ids)if(s.organizations[party]?.status!=="active")await requireRemoteAuthority(s,party,ctx);
      demand(validateShape(profile.schema,p.body),"invalid_body","record does not conform to pinned schema",422);
      let validation:any={profile:profile.digest,level:"structural",business_verified:false};
      if(profile.semantics==="invoice-v1"){
        demand(p.body.seller_company_id===o.id&&p.counterparty_ids.includes(p.body.buyer_company_id),"invalid_body","invoice parties differ from envelope",422);
        validation=validateInvoice(p.body,{resolveReference:()=>({status:"unknown"})});demand(validation.valid,"invalid_invoice","invoice arithmetic or declared fields are invalid",422);
      }
      if(profile.semantics==="inventory-v1"){
        demand(p.supersedes===null,"invalid_inventory","inventory corrections are new events",422);
        const company=s.inventory[o.id]??={pools:{},observations:{},creations:{}};const event=p.body;
        demand(event.company_id===o.id&&event.pool_id===p.resource_id,"forbidden","inventory pool must equal authorized resource");
        const pool=company.pools[event.pool_id];demand(pool,"pool_unavailable","create stock pool before writing events",422);
        demand(pool.policy_id===p.policy_id,"forbidden","stock pool belongs to another policy");
        const obs=JSON.stringify([event.source_id,event.observation_id]),eventHash=await digest(event),old=company.observations[obs];
        if(old){demand(old.hash===eventHash&&old.policy_id===p.policy_id&&old.profile_digest===p.profile_digest,"observation_conflict","observation already has a different meaning",409);result={id:old.record_id,seq:s.records[old.record_id].seq,duplicate:true};break;}
        const change=applyInventoryEvent(pool,event);demand(change.ok,change.ok?"invalid_inventory":change.code,change.ok?"invalid inventory":change.message,409);
        company.pools[event.pool_id]=change.state;company.observations[obs]={hash:eventHash,record_id:p.id,policy_id:p.policy_id,profile_digest:p.profile_digest};validation={profile:"dtp.inventory/1",revision:change.state.revision,physical_stock_verified:false};
      }
      if(before)before.is_head=false;
      s.records[p.id]={...structuredClone(p),command:structuredClone(c),seq:s.next_seq++,is_head:true,accepted_at:new Date(ctx.now).toISOString(),validation} as BusinessRecord;result={id:p.id,seq:s.records[p.id].seq,duplicate:false};break;
    }
    case "record.get": {
      exact(p,["id","profile_digest"]);id(p.id);const r=s.records[p.id];demand(r&&r.organization_id===currentOrg().id&&can(r.policy_id,r.resource_id,"read")&&understands(r.profile_digest),"not_found","record unavailable",404);
      demand(r.profile_digest===p.profile_digest,"unsupported_profile","consumer must accept the exact profile",422);result=viewRecord(r);break;
    }
    case "records.list":
    case "records.export":
    case "workspace.view": {
      exact(p,["after","limit","profile_digests"]);const o=currentOrg();demand(Number.isSafeInteger(p.after)&&p.after>=0&&Number.isInteger(p.limit)&&p.limit>0&&p.limit<=100&&Array.isArray(p.profile_digests)&&p.profile_digests.length<=32&&p.profile_digests.every((d:any)=>typeof d==="string"&&/^[0-9a-f]{64}$/.test(d)),"invalid","invalid scoped page",400);
      const rows=Object.values(s.records).filter(r=>r.organization_id===o.id&&r.seq>p.after&&p.profile_digests.includes(r.profile_digest)&&can(r.policy_id,r.resource_id,"read")&&(c.action!=="records.export"||can(r.policy_id,r.resource_id,"export"))&&understands(r.profile_digest)).sort((a,b)=>a.seq-b.seq).slice(0,p.limit+1);
      const page=rows.slice(0,p.limit);result={organization:{id:o.id,name:o.name,generation:o.generation},records:page.map(viewRecord),next_cursor:rows.length>p.limit?page.at(-1)!.seq:null};break;
    }
    case "inventory.create": {
      exact(p,["policy_id","pool_id","product_id","base_unit"]);id(p.pool_id);id(p.product_id);demand(can(p.policy_id,p.pool_id,"write"),"forbidden","stock pool write permission required");
      const company=s.inventory[currentOrg().id]??={pools:{},observations:{},creations:{}};if(previous){result=previous.result;break;}
      demand(!company.pools[p.pool_id],"conflict","pool exists",409);
      try{company.pools[p.pool_id]={...createInventoryState(currentOrg().id,p.pool_id,p.product_id,p.base_unit),policy_id:p.policy_id};}catch{demand(false,"invalid_inventory","invalid product or base unit",422);}
      company.creations[p.pool_id]=structuredClone(c);result={pool_id:p.pool_id};break;
    }
    case "inventory.get": {
      exact(p,["policy_id","pool_id"]);id(p.pool_id);const o=currentOrg();const pool=s.inventory[o.id]?.pools[p.pool_id];
      const inventoryConsumer=c.actor.kind==="person"||s.releases[o.installations[c.actor.id].release_digest].profiles.some(d=>s.profiles[d]?.semantics==="inventory-v1");
      demand(pool&&pool.policy_id===p.policy_id&&can(p.policy_id,p.pool_id,"read")&&inventoryConsumer,"not_found","pool unavailable",404);result=structuredClone(pool);break;
    }
    case "authority.export": {exact(p,[]);const o=currentOrg();management(s,o,c,"authority.manage",ctx);result=await authorityIssue(s,o.id,ctx);break;}
    case "authority.import": {exact(p,["token"]);management(s,currentOrg(),c,"authority.manage",ctx);result=await authorityAccept(s,p.token,ctx);break;}
    case "authority.relocate": {exact(p,["token","commit"]);management(s,currentOrg(),c,"authority.manage",ctx);result=await authorityRelocate(s,p.token,p.commit,ctx);break;}
    case "evidence.issue": {
      exact(p,["record_ids","recipient","purpose","expires_at"]);ids(p.record_ids,1,20);exact(p.recipient,["organization_id","audience","policy_id","resource_id"]);[p.recipient.organization_id,p.recipient.policy_id,p.recipient.resource_id].forEach(id);text(p.purpose,200);text(p.recipient.audience,300);
      const o=currentOrg();demand(c.actor.kind==="person"&&p.recipient.organization_id!==o.id&&p.recipient.audience!==ctx.audience&&Object.hasOwn(ctx.pins,p.recipient.audience),"forbidden","explicit remote recipient and pinned host required");
      demand(instant(p.expires_at)>ctx.now&&instant(p.expires_at)<=ctx.now+60000,"invalid","evidence disclosure lifetime is at most 60 seconds",400);
      const records=p.record_ids.map((recordId:string)=>{const r=s.records[recordId];demand(r?.organization_id===o.id&&can(r.policy_id,r.resource_id,"read")&&can(r.policy_id,r.resource_id,"export"),"not_found","exportable record unavailable",404);return structuredClone(r);});
      const needed=new Set<string>();
      const include=(d:string)=>{if(needed.has(d))return;needed.add(d);demand(needed.size<=32,"evidence_too_large","dependency closure exceeds 32 profiles",413);for(const dependency of s.profiles[d].dependencies)include(dependency);};
      for(const r of records)include(r.profile_digest);
      const profiles=[...needed].map(d=>s.profiles[d]);
      demand(profiles.every(pr=>pr.publisher_id===o.id||accessibleProfile(pr,p.recipient.organization_id)),"forbidden","private third-party profile cannot be redistributed to recipient");
      const body={kind:"business-evidence",issuer:ctx.audience,issued_at:new Date(ctx.now).toISOString(),expires_at:p.expires_at,source_organization:o.id,recipient:p.recipient,purpose:p.purpose,records,profiles};
      demand(new TextEncoder().encode(JSON.stringify(body)).length<=512*1024,"evidence_too_large","use a smaller exact evidence selection",413);
      result=await signToken(body,ctx);break;
    }
    case "evidence.inspect": {
      exact(p,["token","accepted_profiles"]);const o=currentOrg();const body=await verifyToken(p.token,ctx,"business-evidence");
      exact(body,["kind","issuer","issued_at","expires_at","source_organization","recipient","purpose","records","profiles"]);exact(body.recipient,["organization_id","audience","policy_id","resource_id"]);
      demand(new TextEncoder().encode(JSON.stringify(body)).length<=512*1024,"evidence_too_large","evidence exceeds 512 KiB",413);
      id(body.source_organization);text(body.purpose,200);[body.recipient.organization_id,body.recipient.policy_id,body.recipient.resource_id].forEach(id);
      demand(instant(body.expires_at)-instant(body.issued_at)<=60000&&body.recipient.organization_id===o.id&&body.recipient.audience===ctx.audience,"forbidden","evidence is bound to a different recipient or lifetime");
      demand(can(body.recipient.policy_id,body.recipient.resource_id,"read"),"forbidden","recipient compartment read permission required");
      demand(Array.isArray(body.records)&&body.records.length>0&&body.records.length<=20&&Array.isArray(body.profiles)&&body.profiles.length<=32&&Array.isArray(p.accepted_profiles)&&p.accepted_profiles.length<=32,"invalid_evidence","bounded evidence selection required",400);
      for(const pr of body.profiles){exact(pr,["id","publisher_id","name","version","digest","schema","semantics","dependencies","visibility","readers","command"]);demand(isDigest(pr.digest),"invalid_evidence","invalid profile digest",400);}
      demand(new Set(body.profiles.map((pr:Profile)=>pr.digest)).size===body.profiles.length,"invalid_evidence","duplicate profiles",400);
      const bundle={...s,profiles:{...s.profiles,...Object.fromEntries(body.profiles.map((pr:Profile)=>[pr.digest,pr]))}};
      for(const pr of body.profiles){
        await validateProfile(pr,bundle);
        demand(pr.id===`${pr.publisher_id}/${pr.name}@${pr.version}`,"invalid_evidence","profile identity label differs from pinned contract");
        validateCommand(pr.command,pr.command.audience,instant(pr.command.issued_at));await verifyCommand(pr.command);
        const{publisher_id:_,...contract}=profileContract(pr);
        demand(pr.command.action==="profile.publish"&&pr.command.organization_id===pr.publisher_id&&same(pr.command.payload,{...contract,digest:pr.digest,visibility:pr.visibility,readers:pr.readers}),"invalid_evidence","profile differs from signed publication");
      }
      const inspected=[];
      for(const r of body.records){
        exact(r,["id","root_id","supersedes","organization_id","policy_id","resource_id","profile_digest","counterparty_ids","body","command","seq","is_head","accepted_at","validation"]);
        demand(r.organization_id===body.source_organization&&p.accepted_profiles.includes(r.profile_digest)&&understands(r.profile_digest),"unsupported_profile","consumer does not accept disclosed profile",422);
        const{command,seq,is_head,accepted_at,validation,...payload}=r;validateCommand(command,command.audience,instant(command.issued_at));await verifyCommand(command);
        demand(command.action==="record.append"&&command.organization_id===body.source_organization&&same(command.payload,payload)&&bundle.profiles[r.profile_digest],"invalid_evidence","record differs from original signed payload");
        const profile=bundle.profiles[r.profile_digest];demand(validateShape(profile.schema,r.body),"invalid_evidence","record violates disclosed schema");
        let checked:any={profile:profile.digest,structural:true};
        if(profile.semantics==="invoice-v1"){checked=validateInvoice(r.body,{resolveReference:()=>({status:"unknown"})});demand(checked.valid,"invalid_evidence","invalid invoice arithmetic");}
        if(profile.semantics==="inventory-v1")checked={profile:"dtp.inventory/1",state_validation:"not replayed: selected evidence is not a complete inventory history",physical_stock_verified:false};
        // Host projections (head/sequence/reducer result) are assertions, not
        // original signer content. Never relabel them as recipient validation.
        inspected.push({...structuredClone(payload),command:structuredClone(command),validation:checked,issuer_projection:{seq,is_head,accepted_at,validation}});
      }
      result={source_organization:body.source_organization,purpose:body.purpose,expires_at:body.expires_at,records:inspected,profiles:structuredClone(body.profiles),freshness:"exact historical versions, not live state",source_revocation:"previously disclosed copies cannot be recalled"};break;
    }
    case "migration.prepare": {exact(p,["destination"]);const o=asController();assertAllStewards(o);result=await migration.migrationPrepare(s,c,ctx,buildSnapshot(s,o.id,ctx),p.destination);break;}
    case "migration.chunk": {exact(p,["migration_id","index"]);id(p.migration_id);const out=s.outgoing[p.migration_id];demand(out&&out.manifest.organization_id===needOrg().id,"not_found","migration unavailable",404);asController(needOrg());assertAllStewards(needOrg());result=migration.migrationChunk(s,p.migration_id,p.index);break;}
    case "migration.commit": {exact(p,["migration_id","ready"]);id(p.migration_id);const o=asController(needOrg());assertAllStewards(o);demand(s.outgoing[p.migration_id]?.manifest.organization_id===o.id,"not_found","migration unavailable",404);result=await migration.migrationCommit(s,p.migration_id,p.ready,ctx,buildSnapshot(s,o.id,ctx));break;}
    case "migration.receipt": {exact(p,["migration_id"]);id(p.migration_id);const o=asController(needOrg());demand(s.outgoing[p.migration_id]?.manifest.organization_id===o.id,"not_found","migration unavailable",404);result=migration.migrationReceipt(s,p.migration_id);break;}
    case "migration.status": {exact(p,["migration_id"]);id(p.migration_id);const stage=s.incoming[p.migration_id];demand(c.actor.kind==="person"&&c.organization_id===null&&stage?.manifest_token.body.actor_id===c.actor.id,"not_found","migration unavailable",404);result={migration_id:p.migration_id,uploaded:Object.keys(stage.chunks).map(Number).sort((a,b)=>a-b),total:stage.manifest.chunk_hashes.length,ready:!!stage.ready_token,activated:stage.activated,aborted:!!stage.aborted};break;}
    case "migration.cancel": {exact(p,["migration_id"]);id(p.migration_id);const o=asController(needOrg());demand(s.outgoing[p.migration_id]?.manifest.organization_id===o.id,"not_found","migration unavailable",404);result=await migration.migrationCancel(s,p.migration_id,ctx);break;}
    case "migration.abort": {exact(p,["migration_id","cancel"]);id(p.migration_id);demand(c.actor.kind==="person"&&c.organization_id===null&&s.incoming[p.migration_id]?.manifest_token.body.actor_id===c.actor.id,"forbidden","staging owner required");result=await migration.migrationAbort(s,p.migration_id,p.cancel,ctx);break;}
    case "migration.stage": {exact(p,["manifest"]);demand(c.actor.kind==="person"&&c.organization_id===null&&p.manifest?.body?.actor_id===c.actor.id,"forbidden","manifest-bound controller required");result=await migration.migrationStage(s,ctx,p.manifest);break;}
    case "migration.upload":
    case "migration.ready":
    case "migration.finalize": {
      exact(p,c.action==="migration.upload"?["migration_id","index","data"]:c.action==="migration.ready"?["migration_id"]:["migration_id","commit"]);id(p.migration_id);
      demand(c.actor.kind==="person"&&c.organization_id===null&&s.incoming[p.migration_id]?.manifest_token.body.actor_id===c.actor.id,"forbidden","staging owner required");
      if(c.action==="migration.upload")result=await migration.migrationUpload(s,p.migration_id,p.index,p.data,ctx);
      if(c.action==="migration.ready")result=await migration.migrationReady(s,p.migration_id,ctx,async snap=>{demand(snap.organization.controllers.includes(c.actor.id)&&snap.persons.find(x=>x.id===c.actor.id)?.keys.includes(c.actor.key_id),"forbidden","importer must match exported controller");await validateSnapshot(s,snap);});
      if(c.action==="migration.finalize")result=await migration.migrationFinalize(s,p.migration_id,p.commit,ctx,snap=>applySnapshot(s,snap));break;
    }
    default:demand(false,"unsupported_action","unsupported protocol action",400);
  }
  if(history&&org)org.history.push(structuredClone(c));
  // Responses are not an independent read endpoint. Every replay re-enters the
  // current authorization path above before an old mutation receipt is returned.
  for(const [key,r] of Object.entries(s.receipts))if(r.expires_at<=ctx.now)delete s.receipts[key];
  s.receipts[c.request_id]={hash,result:reads.has(c.action)?null:structuredClone(result),expires_at:instant(c.expires_at)};
  return result;
}
