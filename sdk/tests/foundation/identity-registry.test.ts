import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { Transition } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';
async function fixture(){
  const pg=new PGlite();await pg.exec(IDENTITY_REGISTRY_SCHEMA);const db=pgliteDb(pg);
  const [person,recovery,resolver,next]=await Promise.all(Array.from({length:4},()=>generateKeyPair()));
  let now=1800000000000;const config={id:crypto.randomUUID(),audience:'https://resolver.example',key:resolver,now:()=>now};
  const genesis=await signIdentity('DTP-PERSON-GENESIS-1',{nonce:crypto.randomUUID(),operational:{keys:[person.keyId],threshold:1},recovery:{keys:[recovery.keyId],threshold:1}},[person,recovery]);
  const initial=await createIdentity(genesis,{id:config.id,key_id:resolver.keyId},now);
  const enrollmentBody={identity_id:initial.head.identity_id,genesis_digest:initial.genesis_digest,resolver_id:config.id,resolver_key:resolver.keyId,audience:config.audience,nonce:'a'.repeat(64),issued_at:now,expires_at:now+300000};
  const enrollment=await signIdentity('DTP-IDENTITY-ENROLLMENT-1',enrollmentBody,[person,recovery]);
  const registry=createIdentityRegistry(db,config);
  const request={identity_id:initial.head.identity_id,audience:'https://company.example',challenge:'b'.repeat(64)};
  return{pg,db,person,recovery,resolver,next,config,genesis,initial,enrollmentBody,enrollment,registry,request,get now(){return now;},advance:(ms:number)=>now+=ms};
}
test('owner enrollment binds resolver and requires operational plus separately enrolled recovery consent',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.registry.enroll(f.genesis,await signIdentity('DTP-IDENTITY-ENROLLMENT-1',f.enrollmentBody,[f.person])),/quorum/);
    await assert.rejects(f.registry.enroll(f.genesis,await signIdentity('DTP-IDENTITY-ENROLLMENT-1',{...f.enrollmentBody,audience:'https://other.example'},[f.person,f.recovery])),/binding/);
    assert.equal((await f.db.query<{n:number}>('select count(*)::int as n from dtp_foundation.identities'))[0].n,0);
    const one=await f.registry.enroll(f.genesis,f.enrollment);const two=await f.registry.enroll(f.genesis,f.enrollment);assert.deepEqual(one,two);
    const other=await signIdentity('DTP-IDENTITY-ENROLLMENT-1',{...f.enrollmentBody,nonce:'c'.repeat(64)},[f.person,f.recovery]);
    await assert.rejects(f.registry.enroll(f.genesis,other),/conflict/);
    assert.equal((await f.db.query<{n:number}>('select count(*)::int as n from dtp_foundation.identity_history'))[0].n,1);
  }finally{await f.pg.close();}
});
test('resolver persists lease drain and recovery history across instance replacement',async()=>{
  const f=await fixture();try{
    await f.registry.enroll(f.genesis,f.enrollment);const proof=await f.registry.resolve(f.request);
    const command=await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1',{identity_id:f.initial.head.identity_id,expected_digest:f.initial.head_digest,sequence:1,kind:'recover',operational:{keys:[f.next.keyId],threshold:1},recovery:f.initial.head.recovery,issued_at:f.now,expires_at:f.now+300000},[f.recovery,f.next]);
    const accepted=await f.registry.transition(f.initial.head.identity_id,command);
    assert.equal(accepted.effective_at,f.now+LEASE_MS+CLOCK_MARGIN_MS);
    const restarted=createIdentityRegistry(f.db,f.config);
    await assert.rejects(restarted.resolve(f.request),/barrier/);
    f.advance(LEASE_MS+CLOCK_MARGIN_MS);const fresh=await restarted.resolve({...f.request,challenge:'d'.repeat(64)});
    const head=await verifyResolution(fresh,{...f.request,challenge:'d'.repeat(64),resolver_id:f.config.id,resolver_key:f.resolver.keyId,resolver_epoch:0,minimum_sequence:1,minimum_digest:accepted.head_digest},f.now);
    assert.deepEqual(head.operational.keys,[f.next.keyId]);
    assert.deepEqual(await restarted.transition(f.initial.head.identity_id,command),accepted);
    await assert.rejects(restarted.transition(f.initial.head.identity_id,{...command,signatures:command.signatures.slice(0,1)}),/envelope conflict/);
    await assert.rejects(verifyResolution(proof,{...f.request,resolver_id:f.config.id,resolver_key:f.resolver.keyId,resolver_epoch:0,minimum_sequence:0,minimum_digest:f.initial.head_digest},f.now),/expired/);
    assert.equal((await f.db.query<{n:number}>('select count(*)::int as n from dtp_foundation.identity_history'))[0].n,2);
  }finally{await f.pg.close();}
});
test('lost transition response can be acknowledged after its signing window without new control history',async()=>{
  const f=await fixture();try{
    await f.registry.enroll(f.genesis,f.enrollment);
    const command=await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1',{identity_id:f.initial.head.identity_id,expected_digest:f.initial.head_digest,sequence:1,kind:'rotate',operational:{keys:[f.next.keyId],threshold:1},recovery:f.initial.head.recovery,issued_at:f.now,expires_at:f.now+1000},[f.person,f.next]);
    const accepted=await f.registry.transition(f.initial.head.identity_id,command);f.advance(10000);
    const before=await f.db.query('select revision,body from dtp_foundation.identities');
    assert.deepEqual(await createIdentityRegistry(f.db,f.config).transition(f.initial.head.identity_id,command),accepted);
    assert.deepEqual(await f.db.query('select revision,body from dtp_foundation.identities'),before);
    assert.equal((await f.db.query<{n:number}>('select count(*)::int as n from dtp_foundation.identity_history'))[0].n,2);
  }finally{await f.pg.close();}
});
test('lease is never returned if persistence fails and transitions roll back with history failure',async()=>{
  const f=await fixture();try{
    await f.registry.enroll(f.genesis,f.enrollment);
    const before=(await f.db.query<{body:any}>('select body from dtp_foundation.identities'))[0].body;
    const failDb={...f.db,transaction:<T>(fn:any):Promise<T>=>f.db.transaction(tx=>fn({...tx,query:(sql:string,params:any[])=>{if(sql.startsWith('update dtp_foundation.identities'))throw new Error('synthetic write failure');return tx.query(sql,params);}}))};
    await assert.rejects(createIdentityRegistry(failDb,f.config).resolve(f.request),/write failure/);
    assert.deepEqual((await f.db.query<{body:any}>('select body from dtp_foundation.identities'))[0].body,before);
    const historyFail={...f.db,transaction:<T>(fn:any):Promise<T>=>f.db.transaction(tx=>fn({...tx,query:(sql:string,params:any[])=>{if(sql.startsWith('insert into dtp_foundation.identity_history'))throw new Error('synthetic history failure');return tx.query(sql,params);}}))};
    const command=await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1',{identity_id:f.initial.head.identity_id,expected_digest:f.initial.head_digest,sequence:1,kind:'rotate',operational:{keys:[f.next.keyId],threshold:1},recovery:f.initial.head.recovery,issued_at:f.now,expires_at:f.now+300000},[f.person,f.next]);
    await assert.rejects(createIdentityRegistry(historyFail,f.config).transition(f.initial.head.identity_id,command),/history failure/);
    assert.deepEqual((await f.db.query<{body:any}>('select body from dtp_foundation.identities'))[0].body,before);
  }finally{await f.pg.close();}
});
test('resolver config and frozen rows cannot silently create a second current authority',async()=>{
  const f=await fixture();try{
    await f.registry.enroll(f.genesis,f.enrollment);
    await assert.rejects(createIdentityRegistry(f.db,{...f.config,id:crypto.randomUUID()}).resolve(f.request),/another resolver/);
    await f.db.query("update dtp_foundation.identities set status='frozen'");
    await assert.rejects(f.registry.resolve(f.request),/frozen/);
    await assert.rejects(f.registry.enroll(f.genesis,f.enrollment),/frozen/);
  }finally{await f.pg.close();}
});
