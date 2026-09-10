import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import type { Context } from "../../src/v04/model.ts";
import { emptyState } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { draftCommand, signCommand, personId, organizationId, digest } from "../../src/v04/wire.ts";
import { buildSnapshot, validateSnapshot, applySnapshot } from "../../src/v04/snapshot.ts";
import { migrationStage, migrationChunk, migrationUpload, migrationReady, migrationCommit, migrationFinalize } from "../../src/v04/migration.ts";

async function fixture() {
  const key = await generateKeyPair(), employeeKey = await generateKeyPair(), storeKey = await generateKeyPair();
  const owner = {id:await personId(key.keyId),key}, employee = {id:await personId(employeeKey.keyId),key:employeeKey};
  const ctx: Context = {audience:"https://source.test",storeKey,pins:{},now:Date.parse("2026-09-10T12:00:00.000Z")};
  const s = emptyState();
  async function call(action:string, org:string|null, payload:any, who=owner) { ctx.now += 1; return execute(s,await signCommand(draftCommand(ctx.audience,who,action,org,payload,ctx.now),[who.key]),ctx); }
  await call("person.register",null,{keys:[key.keyId]}); await call("person.register",null,{keys:[employeeKey.keyId]},employee);
  const nonce=crypto.randomUUID(), org=await organizationId(owner.id,nonce); await call("organization.create",org,{name:"Synthetic IP company",nonce,controllers:[owner.id],threshold:1});
  const invitation=crypto.randomUUID(), expiry=new Date(ctx.now+3600000).toISOString();
  await call("membership.invite",org,{invitation_id:invitation,person_id:employee.id,permissions:[],expires_at:expiry}); await call("membership.accept",org,{invitation_id:invitation},employee);
  const policy=crypto.randomUUID(), resource=crypto.randomUUID();
  const grants=[{person_id:owner.id,actions:["read","write","export"],resource_ids:"*",expires_at:expiry},{person_id:employee.id,actions:["read"],resource_ids:[resource],expires_at:expiry}];
  await call("policy.create",org,{policy_id:policy,expected_revision:0,classification:"personnel",stewards:[owner.id],threshold:1,grants});
  async function publish(name:string,schema:any,semantics="structural") {
    const contract={publisher_id:org,name,version:"1.0.0",schema,semantics,dependencies:[]}; const hash=await digest(contract);
    await call("profile.publish",org,{name,version:"1.0.0",schema,semantics,dependencies:[],visibility:"private",readers:[],digest:hash}); return hash;
  }
  const schema={type:"object",properties:{salary:{type:"integer",minimum:0,maximum:1000000}},required:["salary"],additionalProperties:false};
  const profile=await publish("compensation",schema), unused=await publish("uninstalled-private-recipe",schema);
  const release=await call("release.publish",org,{module_id:crypto.randomUUID(),version:"1.0.0",artifact_digest:"a".repeat(64),profiles:[unused],actions:["read"],visibility:"private",assessment:null});
  const record=crypto.randomUUID(); await call("record.append",org,{id:record,root_id:record,supersedes:null,organization_id:org,policy_id:policy,resource_id:resource,profile_digest:profile,counterparty_ids:[],body:{salary:123456}});
  return {s,ctx,owner,employee,org,policy,resource,profile,unused,release,record,call,publish,expiry};
}
const rejectsSnapshot = (snap:any) => assert.rejects(validateSnapshot(emptyState(),snap));

test("snapshot: private uninstalled developer IP, signed authority and expired grants survive migration",async()=>{
  const f=await fixture(), snap=buildSnapshot(f.s,f.org,f.ctx);
  assert.ok(snap.profiles.some(p=>p.digest===f.unused)); assert.ok(snap.releases.some(r=>r.digest===f.release.digest));
  await validateSnapshot(emptyState(),snap);
  f.ctx.now+=86400000; const dest=emptyState(); await applySnapshot(dest,snap);
  assert.equal(dest.organizations[f.org].generation,2); assert.equal(dest.policies[f.policy].grants[1].expires_at,f.expiry);
  assert.equal(dest.organizations[f.org].members[f.employee.id].expires_at,f.expiry);
  assert.deepEqual(dest.records[f.record].command,f.s.records[f.record].command);
});

test("snapshot: unsigned policy, membership, profile visibility and head edits are rejected",async()=>{
  const f=await fixture(), snap=buildSnapshot(f.s,f.org,f.ctx);
  const policy=structuredClone(snap);policy.policies[0].grants[1].resource_ids="*";await rejectsSnapshot(policy);
  const member=structuredClone(snap);member.organization.members[f.employee.id].permissions=["members.manage"];await rejectsSnapshot(member);
  const profile=structuredClone(snap);profile.profiles[0].visibility="community";await rejectsSnapshot(profile);
  const head=structuredClone(snap);head.records[0].is_head=false;await rejectsSnapshot(head);
  const validation=structuredClone(snap);validation.records[0].validation.business_verified=true;await rejectsSnapshot(validation);
});

test("snapshot: policy update replay and stale supersession chains are checked",async()=>{
  const f=await fixture(); const old=f.s.policies[f.policy];
  await f.call("policy.update",f.org,{policy_id:f.policy,expected_revision:1,classification:"personnel",stewards:[f.owner.id],threshold:1,grants:old.grants.slice(0,1)});
  const next=crypto.randomUUID();await f.call("record.append",f.org,{id:next,root_id:f.record,supersedes:f.record,organization_id:f.org,policy_id:f.policy,resource_id:f.resource,profile_digest:f.profile,counterparty_ids:[],body:{salary:123457}});
  const snap=buildSnapshot(f.s,f.org,f.ctx);await validateSnapshot(emptyState(),snap);
  const revised=structuredClone(snap);revised.policies[0].revision=1;await rejectsSnapshot(revised);
  const roots=structuredClone(snap);roots.records[1].root_id=crypto.randomUUID();await rejectsSnapshot(roots);
});

test("snapshot: personal aliases and immutable publisher versions cannot collide at destination",async()=>{
  const f=await fixture(), snap=buildSnapshot(f.s,f.org,f.ctx), dest=emptyState();
  dest.persons[crypto.randomUUID()]={...structuredClone(snap.persons[0]),id:crypto.randomUUID()};
  await assert.rejects(validateSnapshot(dest,snap),(e:any)=>e.code==="conflict");
  const namespace=emptyState(),profile=structuredClone(snap.profiles[0]);profile.digest="f".repeat(64);namespace.profiles[profile.digest]=profile;
  await assert.rejects(validateSnapshot(namespace,snap),(e:any)=>e.code==="conflict");
});

test("snapshot: another ready migration reserves IDs before either company is activated",async()=>{
  const [one,two]=await Promise.all([fixture(),fixture()]);
  await two.call("record.append",two.org,{id:one.record,root_id:one.record,supersedes:null,organization_id:two.org,policy_id:two.policy,resource_id:two.resource,profile_digest:two.profile,counterparty_ids:[],body:{salary:1}});
  const first=buildSnapshot(one.s,one.org,one.ctx),second=buildSnapshot(two.s,two.org,two.ctx),destination=emptyState();
  await validateSnapshot(destination,first); await validateSnapshot(destination,second);
  // Fixture is an already validated stage. Signature staging is covered by the
  // migration tests; this checks the cross-stage dependency reservation boundary.
  destination.incoming[crypto.randomUUID()]={manifest:{organization_id:one.org} as any,manifest_token:{} as any,chunks:{},ready_token:{} as any,snapshot:first,activated:false};
  await assert.rejects(validateSnapshot(destination,second));
  assert.equal(Object.keys(destination.records).length,0);
});

test("snapshot: signed stock initialization and event replay reject inflated projected inventory",async()=>{
  const f=await fixture(), pool=crypto.randomUUID(), product=crypto.randomUUID();
  const str={type:"string",maxLength:200};
  const schema={type:"object",properties:{company_id:str,pool_id:str,source_id:str,observation_id:str,expected_revision:{type:"integer",minimum:0,maximum:1000000},occurred_at:str,kind:{type:"string",maxLength:20,enum:["receive"]},quantity:str,unit:str},required:["company_id","pool_id","source_id","observation_id","expected_revision","occurred_at","kind","quantity","unit"],additionalProperties:false};
  const profile=await f.publish("inventory",schema,"inventory-v1");
  await f.call("inventory.create",f.org,{policy_id:f.policy,pool_id:pool,product_id:product,base_unit:"unit"});
  const record=crypto.randomUUID();await f.call("record.append",f.org,{id:record,root_id:record,supersedes:null,organization_id:f.org,policy_id:f.policy,resource_id:pool,profile_digest:profile,counterparty_ids:[],body:{company_id:f.org,pool_id:pool,source_id:"scanner",observation_id:"one",expected_revision:0,occurred_at:new Date(f.ctx.now).toISOString(),kind:"receive",quantity:"10",unit:"unit"}});
  const snap=buildSnapshot(f.s,f.org,f.ctx);await validateSnapshot(emptyState(),snap);
  assert.equal(snap.inventory[f.org].pools[pool].on_hand,"10");
  const inflated=structuredClone(snap);inflated.inventory[f.org].pools[pool].on_hand="1000";await rejectsSnapshot(inflated);
  const unsigned=structuredClone(snap);delete unsigned.inventory[f.org].creations[pool];await rejectsSnapshot(unsigned);
});

test("migration capacity: finalize replaces staged payload rather than retaining a second company copy",async()=>{
  const f=await fixture(),key=await generateKeyPair(),destination=emptyState();
  const ctx:Context={audience:"https://destination.test",storeKey:key,pins:{[f.ctx.audience]:f.ctx.storeKey.keyId},now:f.ctx.now+1};
  f.ctx.pins[ctx.audience]=key.keyId;
  const token:any=await f.call("migration.prepare",f.org,{destination:{audience:ctx.audience,key_id:key.keyId}}),mid=token.body.manifest.migration_id;
  await migrationStage(destination,ctx,token);
  for(let i=0;i<token.body.manifest.chunk_hashes.length;i++)await migrationUpload(destination,mid,i,migrationChunk(f.s,mid,i).data,ctx);
  const ready=await migrationReady(destination,mid,ctx,snap=>validateSnapshot(destination,snap));
  const before=JSON.stringify(destination).length,capacity=before+16384;
  f.ctx.now=ctx.now;const commit=await migrationCommit(f.s,mid,ready,f.ctx,buildSnapshot(f.s,f.org,f.ctx));
  await migrationFinalize(destination,mid,commit,ctx,snap=>applySnapshot(destination,snap));
  assert.ok(JSON.stringify(destination).length<before);assert.ok(JSON.stringify(destination).length<capacity);
  assert.equal(destination.records[f.record].body.salary,123456);assert.equal(destination.incoming[mid].snapshot,undefined);assert.deepEqual(destination.incoming[mid].chunks,{});
  const snapshotOfActive=structuredClone(destination.records);
  await migrationFinalize(destination,mid,commit,{...ctx,now:ctx.now+7200000},()=>{throw Error("cannot apply twice");});
  assert.deepEqual(destination.records,snapshotOfActive);
});
