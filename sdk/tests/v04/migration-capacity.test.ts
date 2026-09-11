import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

test("v0.4 readiness reserves capacity and activation compacts atomically under intervening storage pressure",{timeout:90000},async()=>{
  const options={maxStateBytes:128*1024*1024};
  const source=await createDtpStore(),destination=await createDtpStore(options);
  try{
    source.pins[destination.audience]=destination.keyId;destination.pins[source.audience]=source.keyId;
    const a=new Client(source.audience),b=new Client(destination.audience),owner=await person(a);await person(b,owner);
    const org=await company(a,owner),schema=await profile(a,owner,org),pol=await policy(a,owner,org,[grant(owner)]);
    const r=record(org,pol,crypto.randomUUID(),schema,{note:"SYNTHETIC".repeat(6500)});await a.ok(owner,"record.append",org,r);
    const manifest=await a.ok(owner,"migration.prepare",org,{destination:{audience:destination.audience,key_id:destination.keyId}}),migration_id=manifest.body.manifest.migration_id;
    await b.ok(owner,"migration.stage",null,{manifest});
    for(let index=0;index<manifest.body.manifest.chunk_hashes.length;index++){
      const chunk=await a.ok(owner,"migration.chunk",org,{migration_id,index});await b.ok(owner,"migration.upload",null,{migration_id,index,data:chunk.data});
    }
    // Configure bounded reference-host capacity, not its business state. Failed
    // ready transactions must neither publish readiness nor freeze the source.
    let ready:any;let failures=0;
    for(options.maxStateBytes=16384;options.maxStateBytes<1024*1024;options.maxStateBytes+=16384){
      const attempt=await b.act(owner,"migration.ready",null,{migration_id});
      if(attempt.status===200){ready=attempt.result;break;}
      assert.equal(attempt.status,507);failures++;
    }
    assert.ok(failures>0&&ready,"must demonstrate capacity rejection before successful readiness");
    assert.equal((await a.act(owner,"workspace.view",org,{after:0,limit:1,profile_digests:[schema]})).status,200);
    // Fill the remaining unreserved capacity with unrelated, legitimate reads
    // (distinct request receipts) until another write is refused.
    let refused=false;
    for(let i=0;i<200;i++){
      const attempt=await b.act(owner,"organizations.list",null,{});
      if(attempt.status===507){refused=true;break;}assert.equal(attempt.status,200);
    }
    assert.ok(refused,"intervening writes must preserve the ready-stage margin");
    const commit=await a.ok(owner,"migration.commit",org,{migration_id,ready});
    const result=await b.ok(owner,"migration.finalize",null,{migration_id,commit});assert.equal(result.activated,true);
    assert.deepEqual(await b.ok(owner,"migration.finalize",null,{migration_id,commit}),result);
    assert.equal((await b.ok(owner,"record.get",org,{id:r.id,profile_digest:schema})).body.note,r.body.note);
  }finally{await source.close();await destination.close();}
});
