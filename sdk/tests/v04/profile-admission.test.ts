import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { digest } from "../../src/v04/wire.ts";
import { Client, company, person, object, string } from "./helpers.ts";

test("v0.4 profile admission rejects unbounded, executable, remote and excessive schemas",async()=>{
  const store=await createDtpStore();try{
    const c=new Client(store.audience),owner=await person(c),org=await company(c,owner);
    const tooDeep=Array.from({length:10}).reduce((node:any)=>object({nested:node}),string());
    for(const schema of [{$ref:"https://example.invalid/private-schema"},{type:"string",maxLength:10,pattern:".*"},{type:"object",properties:{},required:[],additionalProperties:true},{type:"array",items:string(),maxItems:257},tooDeep,object({constructor:string()}),{type:"string",maxLength:65537}]){
      const contract={publisher_id:org,name:"invalid.schema",version:"1.0.0",schema,semantics:"structural",dependencies:[]};
      const {publisher_id:_,...payload}=contract;
      const result=await c.act(owner,"profile.publish",org,{...payload,digest:await digest(contract),visibility:"private",readers:[]});assert.equal(result.status,400,JSON.stringify(result));
    }
  }finally{await store.close();}
});

test("v0.4 profile versions bind exact meaning and private publication is not community consent",async()=>{
  const store=await createDtpStore();try{
    const c=new Client(store.audience),owner=await person(c),org=await company(c,owner),other=await company(c,owner);
    const contract={publisher_id:org,name:"private.custom",version:"1.0.0",schema:object({note:string()}),semantics:"structural",dependencies:[]};
    const {publisher_id:_,...payload}=contract,hash=await digest(contract),publication={...payload,digest:hash,visibility:"private",readers:[]};
    await c.ok(owner,"profile.publish",org,publication);
    assert.equal((await c.ok(owner,"profile.get",org,{digest:hash})).digest,hash);
    assert.equal((await c.act(owner,"profile.get",other,{digest:hash})).status,404);
    assert.equal((await c.act(owner,"profile.publish",org,{...publication,visibility:"community"})).status,409);
    const changed={...contract,schema:object({note:string(50)})};
    assert.equal((await c.act(owner,"profile.publish",org,{...publication,schema:changed.schema,digest:await digest(changed)})).status,409);
    assert.equal((await c.act(owner,"profile.publish",org,{...publication,name:"tampered",digest:hash})).status,422);
    const dependency={...contract,name:"missing.dep",dependencies:["f".repeat(64)]};
    assert.equal((await c.act(owner,"profile.publish",org,{...publication,name:dependency.name,dependencies:dependency.dependencies,digest:await digest(dependency)})).status,422);
  }finally{await store.close();}
});
