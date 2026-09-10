import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client,company,grant,member,person,policy,profile,record } from "./helpers.ts";
import { draftCommand,signCommand } from "../../src/v04/wire.ts";

test("v0.4 HTTP custom profile, scoped company access, head CAS and revoked replay",async()=>{
  const store=await createDtpStore();try{
    const client=new Client(store.audience),owner=await person(client),staff=await person(client),outsider=await person(client),org=await company(client,owner);
    await member(client,owner,org,staff);const schema=await profile(client,owner,org);const pol=await policy(client,owner,org,[grant(owner),grant(staff)]),resource=crypto.randomUUID();
    const original=record(org,pol,resource,schema,{note:"Synthetic exact bytes"});const receipt=await client.ok(staff,"record.append",org,original);assert.equal(receipt.id,original.id);
    const read=await signCommand(draftCommand(client.audience,staff,"record.get",org,{id:original.id,profile_digest:schema}),[staff.key]);
    assert.equal((await client.send(read)).result.body.note,"Synthetic exact bytes");
    const hidden=await client.act(outsider,"workspace.view",org,{after:0,limit:10,profile_digests:[schema]});assert.equal(hidden.status,404);assert.ok(!JSON.stringify(hidden).includes("Synthetic Test Co"));
    const correction=()=>({...original,id:crypto.randomUUID(),supersedes:original.id});
    const race=await Promise.all([client.act(staff,"record.append",org,correction()),client.act(staff,"record.append",org,correction())]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    await client.ok(owner,"membership.revoke",org,{person_id:staff.id});assert.notEqual((await client.send(read)).status,200);
    const list=await client.ok(owner,"records.list",org,{after:0,limit:1,profile_digests:[schema]});assert.equal(list.records.length,1);assert.ok(list.next_cursor>0);
    const wrong=await client.act(owner,"profile.get",org,{digest:"constructor"});assert.equal(wrong.status,400);
  }finally{await store.close();}
});

test("v0.4 controller governance alone cannot read personnel, export or migrate it",async()=>{
  const store=await createDtpStore();try{
    const client=new Client(store.audience),owner=await person(client),hr=await person(client),employee=await person(client),org=await company(client,owner);
    await member(client,owner,org,hr);await member(client,owner,org,employee);const schema=await profile(client,owner,org);
    const resource=crypto.randomUUID(),pol=await policy(client,owner,org,[grant(hr),grant(employee,[resource],["read"])],[hr],"personnel");
    const r=record(org,pol,resource,schema,{note:"SYNTHETIC-PERSONNEL-CANARY"});await client.ok(hr,"record.append",org,r);
    assert.equal((await client.act(owner,"record.get",org,{id:r.id,profile_digest:schema})).status,404);
    const workspace=await client.ok(owner,"workspace.view",org,{after:0,limit:100,profile_digests:[schema]});assert.equal(workspace.records.length,0);assert.ok(!JSON.stringify(workspace).includes("CANARY"));
    assert.equal((await client.ok(employee,"record.get",org,{id:r.id,profile_digest:schema})).body.note,"SYNTHETIC-PERSONNEL-CANARY");
    const other=record(org,pol,crypto.randomUUID(),schema,{note:"SYNTHETIC-OTHER"});await client.ok(hr,"record.append",org,other);
    assert.equal((await client.act(employee,"record.get",org,{id:other.id,profile_digest:schema})).status,404);
    const denied=await client.act(owner,"migration.prepare",org,{destination:{audience:"http://example.invalid",key_id:store.keyId}});assert.equal(denied.error.code,"approval_required");
  }finally{await store.close();}
});
