import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { DtpClient, DtpResponseError } from "../../src/v04/client.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { personId } from "../../src/v04/wire.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

test("v0.4 public client preserves exact retries, errors and audience isolation",async()=>{
  const store=await createDtpStore();try{
    const client=new DtpClient(store.audience),key=await generateKeyPair(),actor={id:await personId(key.keyId),key};
    const command=await client.prepare(actor,"person.register",null,{keys:[key.keyId]});
    assert.deepEqual(await client.send(command),await client.send(command));
    const invalid=await client.prepare(actor,"policy.get",crypto.randomUUID(),{policy_id:crypto.randomUUID()});
    await assert.rejects(client.send(invalid),e=>e instanceof DtpResponseError&&e.status===404&&e.code==="not_found");
    await assert.rejects(new DtpClient("https://other.example.test").send(command),/audience/);
    assert.throws(()=>new DtpClient(store.audience+"/path"),/origin/);
  }finally{await store.close();}
});

test("v0.4 HTTP rejects oversized, deep, malformed and float inputs without leaking internals",async()=>{
  const store=await createDtpStore();try{
    const send=(body:string|Uint8Array)=>fetch(store.audience+"/dtp/v0.4/commands",{method:"POST",body:body as BodyInit});
    for(const body of ["{",new Uint8Array([0xff,0xfe]),"[".repeat(60)+"0"+"]".repeat(60),JSON.stringify({amount:0.1})]){
      const response=await send(body);assert.equal(response.status,400);assert.ok(!JSON.stringify(await response.json()).includes("stack"));
    }
    const response=await send(" ".repeat(1024*1024+1));assert.equal(response.status,413);
    const health=await fetch(store.audience+"/dtp/v0.4/health");assert.equal(health.headers.get("cache-control"),"no-store");
    assert.equal((await health.json()).capabilities.max_request_bytes,1048576);
  }finally{await store.close();}
});

test("v0.4 storage capacity failure rolls back enrollment and preserves a controlled error",async()=>{
  const store=await createDtpStore({maxStateBytes:300});try{
    const client=new DtpClient(store.audience),key=await generateKeyPair(),actor={id:await personId(key.keyId),key};
    const command=await client.prepare(actor,"person.register",null,{keys:[key.keyId]});
    for(let i=0;i<2;i++)await assert.rejects(client.send(command),e=>e instanceof DtpResponseError&&e.status===507&&e.code==="capacity");
  }finally{await store.close();}
});

test("v0.4 filtered pagination advances over unauthorized compartments without losing records",async()=>{
  const store=await createDtpStore();try{
    const c=new Client(store.audience),owner=await person(c),org=await company(c,owner),p=await profile(c,owner,org);
    const readable=await policy(c,owner,org,[grant(owner)]),hidden=await policy(c,owner,org,[grant(owner,"*",["write"])]);
    const expected=[];
    for(let i=0;i<7;i++){const r=record(org,i%2?hidden:readable,crypto.randomUUID(),p,{note:`synthetic-${i}`});await c.ok(owner,"record.append",org,r);if(i%2===0)expected.push(r.id);}
    let cursor=0;const actual=[];
    for(let i=0;i<10;i++){const page=await c.ok(owner,"records.list",org,{after:cursor,limit:1,profile_digests:[p]});actual.push(...page.records.map((r:any)=>r.id));if(page.next_cursor===null)break;assert.ok(page.next_cursor>cursor);cursor=page.next_cursor;}
    assert.deepEqual(actual,expected);
  }finally{await store.close();}
});
