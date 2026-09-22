import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {pgliteDb} from '../../../supabase/functions/dtp-store/db.ts';
import {IDENTITY_REGISTRY_SCHEMA} from '../../src/foundation/identity-registry.ts';
import {createOnboardingHost,ONBOARDING_SCHEMA} from '../../src/onboarding/host.ts';
import {PassportClient,prepareIdentity,encryptWallet,decryptWallet,signCommand,rehomeWallet} from '../../src/onboarding/client.ts';
import type {Transport} from '../../src/onboarding/client.ts';
import {generateKeyPair,keyPairFromSecret} from '../../src/keys.ts';
import {LEASE_MS,CLOCK_MARGIN_MS} from '../../src/foundation/identity.ts';
import {onboardingServer} from '../../src/onboarding/http.ts';

async function fixture(directory?:string){
  let pg=new PGlite(directory);await pg.exec(IDENTITY_REGISTRY_SCHEMA);await pg.exec(ONBOARDING_SCHEMA);
  const key=await generateKeyPair();let now=Date.now();
  const config={id:crypto.randomUUID(),key,audience:'http://127.0.0.1:8790',now:()=>now};
  let host=createOnboardingHost(pgliteDb(pg),config);
  const transport:Transport=async(path,value)=>{
    const input=value as any;
    if(path==='challenge')return host.challenge(input.person_id,input.command);
    if(path==='execute')return host.execute(input);
    if(path==='resolve')return host.registry.resolve(input);
    if(path==='transition')return host.registry.transition(input.person_id,input.command);
    if(path==='enroll')return host.registry.enroll(input.genesis,input.enrollment);
    if(path==='log')return host.registry.exportLog(input.person_id);
    if(path==='adopt')return host.registry.adopt(input.log,input.rehome);
    if(path==='transfer')return host.registry.transfer(input.log);
    throw new Error('Unexpected test route');
  };
  async function enroll(){const bundle=await prepareIdentity(host.metadata(),now),client=new PassportClient(bundle.operational,transport),{log}=await client.enroll(bundle.genesis,bundle.enrollment);return {...bundle,client,log};}
  const alice=await enroll(),bob=await enroll(),eve=await enroll();
  const company=async(name='Juniper Foods')=>alice.client.run('company.create',null,{nonce:crypto.randomUUID(),name});
  return {get pg(){return pg;},get host(){return host;},get now(){return now;},alice,bob,eve,company,transport,advance:(ms:number)=>now+=ms,
    async restart(){await pg.close();pg=new PGlite(directory);host=createOnboardingHost(pgliteDb(pg),config);},close:()=>pg.close()};
}
async function accept(client:PassportClient,org:string){const invitation=(await client.run('invitations.list')).find((i:any)=>i.organization_id===org);assert.ok(invitation);return client.run('membership.accept',org,{grant_id:invitation.grant_id});}
test('two companies, accepted limited membership, data isolation, revocation and no controller data bypass',async()=>{
  const f=await fixture();try{
    const a=await f.company(),b=await f.company('Bluebird Supply');
    await f.alice.client.run('note.create',a.organization_id,{note_id:crypto.randomUUID(),body:'Juniper only'});
    await f.alice.client.run('note.create',b.organization_id,{note_id:crypto.randomUUID(),body:'Bluebird only'});
    assert.equal((await f.alice.client.run('companies.list')).length,2);
    await f.alice.client.run('membership.invite',a.organization_id,{person_id:f.bob.operational.person_id,role:'viewer'});
    assert.equal((await f.bob.client.run('invitations.list')).length,1);
    assert.deepEqual(await f.bob.client.run('companies.list'),[]);
    await assert.rejects(f.bob.client.run('company.read',a.organization_id),/Company unavailable/);
    await accept(f.bob.client,a.organization_id);
    const visible=await f.bob.client.run('company.read',a.organization_id);assert.equal(visible.notes[0].body,'Juniper only');assert.deepEqual(visible.members,[]);
    assert.equal((await f.bob.client.run('companies.list')).length,1);
    await assert.rejects(f.bob.client.run('company.read',b.organization_id),/Company unavailable/);
    await assert.rejects(f.eve.client.run('company.read',a.organization_id),/Company unavailable/);
    await assert.rejects(f.bob.client.run('note.create',a.organization_id,{note_id:crypto.randomUUID(),body:'Forbidden'}),/scope widens/);
    await assert.rejects(f.bob.client.run('membership.invite',a.organization_id,{person_id:f.eve.operational.person_id,role:'editor'}),/Controller required/);
    await assert.rejects(f.bob.client.run('audit.read',a.organization_id),/Controller required/);
    await f.alice.client.run('membership.revoke',a.organization_id,{person_id:f.bob.operational.person_id});
    await assert.rejects(f.bob.client.run('company.read',a.organization_id),/Company unavailable/);assert.deepEqual(await f.bob.client.run('companies.list'),[]);
    await assert.rejects(f.alice.client.run('membership.revoke',a.organization_id,{person_id:f.alice.operational.person_id}),/sole controller/);
  }finally{await f.close();}
});
test('an invitation revoked before acceptance stays inaccessible; re-invitation requires fresh acceptance',async()=>{
  const f=await fixture();try{
    const a=await f.company();
    await f.alice.client.run('membership.invite',a.organization_id,{person_id:f.bob.operational.person_id,role:'editor'});
    const oldInvitation=(await f.bob.client.run('invitations.list'))[0];
    await f.alice.client.run('membership.revoke',a.organization_id,{person_id:f.bob.operational.person_id});
    await assert.rejects(f.bob.client.run('membership.accept',a.organization_id,{grant_id:oldInvitation.grant_id}),/Invitation unavailable/);
    await f.alice.client.run('membership.invite',a.organization_id,{person_id:f.bob.operational.person_id,role:'editor'});
    await assert.rejects(f.bob.client.run('membership.accept',a.organization_id,{grant_id:oldInvitation.grant_id}),/Invitation unavailable/);
    await accept(f.bob.client,a.organization_id);
    await f.bob.client.run('note.create',a.organization_id,{note_id:crypto.randomUUID(),body:'Allowed editor note'});
    assert.equal((await f.alice.client.run('company.read',a.organization_id)).notes.length,1);
  }finally{await f.close();}
});
test('exact retries are idempotent but tampering, replay, cross-person signatures and revocation fail closed',async()=>{
  const f=await fixture();try{
    const a=await f.company();
    const c={request_id:crypto.randomUUID(),action:'note.create',organization_id:a.organization_id,parameters:{note_id:crypto.randomUUID(),body:'Only once'}};
    const request=await f.alice.client.request(c),tampered=structuredClone(request);tampered.command.parameters.body='Changed';
    await assert.rejects(f.host.execute(tampered),/Challenge unavailable/);
    const fake=await signCommand(c,request.challenge,[await keyPairFromSecret(f.eve.operational.secret_key)]);
    await assert.rejects(f.host.execute(fake),/current operational/);
    const first=await f.host.execute(request);await assert.rejects(f.host.execute(request),/Challenge unavailable/);
    assert.deepEqual(await f.host.execute(await f.alice.client.request(c)),first);
    assert.equal((await f.alice.client.run('company.read',a.organization_id)).notes.length,1);
    await assert.rejects(f.host.execute(await f.alice.client.request({...c,parameters:{...c.parameters,body:'different'}})),/operation ID conflict|Request ID conflict/);
    await f.alice.client.run('membership.invite',a.organization_id,{person_id:f.bob.operational.person_id,role:'editor'});await accept(f.bob.client,a.organization_id);
    const bobCommand={...c,request_id:crypto.randomUUID(),parameters:{note_id:crypto.randomUUID(),body:'Before revocation'}};
    await f.host.execute(await f.bob.client.request(bobCommand));const stale=await f.bob.client.request(bobCommand);
    await f.alice.client.run('membership.revoke',a.organization_id,{person_id:f.bob.operational.person_id});
    await assert.rejects(f.host.execute(stale),/Company unavailable/);
    await assert.rejects(f.host.execute(await f.bob.client.request(bobCommand)),/Company unavailable/);
  }finally{await f.close();}
});
test('rotation and offline recovery preserve identity and membership, reject old credentials and honor the safety barrier',async()=>{
  const {identityLog}=await import('../../src/preview.ts');
  const f=await fixture();try{
    const a=await f.company(),c={request_id:crypto.randomUUID(),action:'company.read',organization_id:a.organization_id,parameters:{}};
    const oldRequest=await f.alice.client.request(c),rotation=await f.alice.client.prepareTransition(f.now);
    const {ack:accepted,log:afterRotation}=await f.alice.client.applyTransition(rotation.command);
    assert.equal((await identityLog.verifyIdentityLog(afterRotation,{require_attestation:true})).head_digest,accepted.head_digest,'the change comes back with its verified history');
    await assert.rejects(f.host.execute(oldRequest),/transition pending/);
    const newer=new PassportClient(rotation.next,f.transport);
    await assert.rejects(newer.run('companies.list'),/transition pending/);
    f.advance(accepted.effective_at-f.now);
    await assert.rejects(f.alice.client.run('companies.list'),/current operational/);
    assert.equal((await newer.run('companies.list'))[0].organization_id,a.organization_id);
    const recovery=new PassportClient(f.alice.recovery,f.transport);
    await assert.rejects(recovery.run('companies.list'),/Recovery keys cannot/);
    const plan=await recovery.prepareTransition(f.now),result=await recovery.applyTransition(plan.command);
    f.advance(result.ack.effective_at-f.now);
    const recovered=new PassportClient(plan.next,f.transport);assert.equal(recovered.wallet.person_id,f.alice.operational.person_id);
    assert.equal((await recovered.run('company.read',a.organization_id)).role,'controller');
    await assert.rejects(newer.run('companies.list'),/current operational/);
    assert.deepEqual(await recovery.applyTransition(plan.command),result,'an exact retry returns the same acknowledgment and history');
  }finally{await f.close();}
});
test('encrypted bundle crosses clients, rejects wrong passwords and corruption; host stores no person secret',async()=>{
  const f=await fixture();try{
    const a=await f.company(),pass='synthetic passphrase only 2026';
    const encrypted=await encryptWallet(f.alice.operational,pass);
    assert.ok(!JSON.stringify(encrypted).includes(f.alice.operational.secret_key));
    const wallet=await decryptWallet(encrypted,pass),otherClient=new PassportClient(wallet,f.transport);
    assert.equal((await otherClient.run('companies.list'))[0].organization_id,a.organization_id);
    await assert.rejects(decryptWallet(encrypted,'wrong password long enough'),/Wrong passphrase/);
    await assert.rejects(decryptWallet({...encrypted,ciphertext:'00'+encrypted.ciphertext.slice(2)},pass),/damaged|Wrong/);
    await assert.rejects(decryptWallet({...encrypted,iterations:1} as any,pass),/Unsupported/);
    await assert.rejects(encryptWallet(wallet,'short'),/14 characters/);
    const persisted=JSON.stringify((await f.pg.query('select body from dtp_foundation.identities')).rows);
    assert.ok(!persisted.includes(f.alice.operational.secret_key));assert.ok(!persisted.includes(f.alice.recovery.secret_key));
  }finally{await f.close();}
});
test('disk reopen preserves companies, notes, authority, revoked membership and spent challenges',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dtp-onboarding-test-'));const f=await fixture(join(dir,'database'));try{
    const a=await f.company();await f.alice.client.run('note.create',a.organization_id,{note_id:crypto.randomUUID(),body:'Survives restart'});
    await f.alice.client.run('membership.invite',a.organization_id,{person_id:f.bob.operational.person_id,role:'viewer'});await accept(f.bob.client,a.organization_id);
    await f.alice.client.run('membership.revoke',a.organization_id,{person_id:f.bob.operational.person_id});
    const request=await f.alice.client.request({request_id:crypto.randomUUID(),action:'companies.list',organization_id:null,parameters:{}});await f.host.execute(request);
    await f.restart();assert.equal((await f.alice.client.run('company.read',a.organization_id)).notes[0].body,'Survives restart');
    await assert.rejects(f.bob.client.run('company.read',a.organization_id),/Company unavailable/);await assert.rejects(f.host.execute(request),/Challenge unavailable/);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
test('expired challenges, malformed commands and failed writes cannot consume authority or bypass validation',async()=>{
  const f=await fixture();try{
    const a=await f.company(),c={request_id:crypto.randomUUID(),action:'company.read',organization_id:a.organization_id,parameters:{}};
    const request=await f.alice.client.request(c);f.advance(60001);await assert.rejects(f.host.execute(request),/expired/);
    await assert.rejects(f.alice.client.request({...c,parameters:{unexpected:true}}),/Exact/);
    await assert.rejects(f.alice.client.request({...c,organization_id:'not-an-id'}),/UUID/);
    await assert.rejects(f.host.execute(JSON.parse('{"__proto__":1}')),/invalid identity field/);
    const body={note_id:crypto.randomUUID(),body:'Original'};await f.alice.client.run('note.create',a.organization_id,body);
    const duplicate=await f.alice.client.request({...c,request_id:crypto.randomUUID(),action:'note.create',parameters:body});
    await assert.rejects(f.host.execute(duplicate),/duplicate key/);
    const row=(await f.pg.query<{consumed:boolean}>('select consumed from dtp_onboarding.challenges where nonce=$1',[duplicate.challenge.nonce])).rows[0];assert.equal(row.consumed,false);
  }finally{await f.close();}
});
test('HTTP denies foreign origins, DNS rebinding, non-JSON and unknown paths without leaking internals',async()=>{
  const f=await fixture();const server=onboardingServer(f.host,{origin:'http://127.0.0.1:8790',allowedOrigins:['http://127.0.0.1:8791']});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port,url=`http://127.0.0.1:${port}`;
  const headers={Host:'127.0.0.1:8790'};
  async function raw(path:string,extra:Record<string,string>={}){return new Promise<{status:number;headers:any;body:string}>((resolve,reject)=>{const req=httpRequest(url,{path,headers:{...headers,...extra}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body}));});req.on('error',reject);req.end();});}
  try{
    assert.equal((await fetch(url+'/api/meta')).status,403);
    assert.equal((await raw('/api/meta',{Origin:'https://evil.example'})).status,403);
    const meta=await raw('/api/meta',{Origin:'http://127.0.0.1:8791'});assert.equal(meta.status,200);assert.equal(meta.headers['access-control-allow-origin'],'http://127.0.0.1:8791');
    assert.equal((await raw('/missing')).status,404);
    const malformed=await raw('//[');assert.equal(malformed.status,400);
    assert.deepEqual(JSON.parse(malformed.body),{error:'Request rejected; check identity, permission, and input'});
    assert.equal((await raw('/api/meta')).status,200,'malformed target must not stop the server');
    async function post(type:string){return new Promise<{status:number;body:string}>(resolve=>{const req=httpRequest(url+'/api/execute',{method:'POST',headers:{...headers,'Content-Type':type}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.end('{}');});}
    assert.equal((await post('text/plain')).status,415);
    const bad=await post('application/json');assert.equal(bad.status,400);assert.deepEqual(JSON.parse(bad.body),{error:'Request rejected; check identity, permission, and input'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.close();}
});
test('a company id is the portable foundation derivation, computable by a client before it asks, and its genesis is retained',async()=>{
  const {organization}=await import('../../src/preview.ts');
  const f=await fixture();try{
    const nonce=crypto.randomUUID(),founder=f.alice.operational.person_id,genesis={nonce,founder,controllers:[founder],threshold:1};
    const created=await f.alice.client.run('company.create',null,{nonce,name:'Juniper Foods'});
    assert.equal(created.organization_id,await organization.organizationId(genesis));
    const row=(await f.pg.query<{genesis:unknown;genesis_digest:string}>('select genesis,genesis_digest from dtp_onboarding.companies where organization_id=$1',[created.organization_id])).rows[0];
    assert.deepEqual(row.genesis,genesis);assert.equal(row.genesis_digest,await organization.organizationGenesisDigest(genesis));
    // The same nonce from another founder is another organization, never a claim on this one.
    const other=await f.bob.client.run('company.create',null,{nonce,name:'Juniper Foods'});
    assert.notEqual(other.organization_id,created.organization_id);
    assert.equal('organizationId' in await import('../../src/onboarding/host.ts'),false,'the host defines no derivation of its own');
  }finally{await f.close();}
});
test('a wallet exports its verified control history after rotation and recovery, and refuses one bound elsewhere',async()=>{
  const {identityLog}=await import('../../src/preview.ts');
  const f=await fixture();try{
    const rotation=await f.alice.client.prepareTransition(f.now),{ack:accepted}=await f.alice.client.applyTransition(rotation.command);f.advance(accepted.effective_at-f.now);
    const recovery=new PassportClient(f.alice.recovery,f.transport),plan=await recovery.prepareTransition(f.now),{ack:result}=await recovery.applyTransition(plan.command);f.advance(result.effective_at-f.now);
    const log=await new PassportClient(plan.next,f.transport).exportLog(),verified=await identityLog.verifyIdentityLog(log,{require_attestation:true});
    assert.equal(verified.identity_id,f.alice.operational.person_id);assert.equal(verified.head_digest,result.head_digest);assert.equal(verified.heads.length,3);
    assert.deepEqual(verified.head.operational.keys,[(await keyPairFromSecret(plan.next.secret_key)).keyId]);
    assert.equal((await identityLog.verifyIdentityLog(f.alice.log,{require_attestation:true})).heads.length,1,'enrollment already returned a genesis-only history to keep');
    // A recovery-only wallet, the one most likely to need the log, can fetch it too.
    assert.deepEqual(await recovery.exportLog(),log);
    const repinned=new PassportClient({...plan.next,resolver:{...plan.next.resolver,resolver_key:(await generateKeyPair()).keyId}},f.transport);
    await assert.rejects(repinned.exportLog(),/binding mismatch/);
    const swapped=new PassportClient(plan.next,async(path,body)=>f.transport(path,path==='log'?{person_id:f.bob.operational.person_id}:body));
    await assert.rejects(swapped.exportLog(),/binding mismatch/);
  }finally{await f.close();}
});
test('a person moves their identity to a second host with the recovery file and the exported log; the first host learns of it only if told',async()=>{
  const {identityLog}=await import('../../src/preview.ts');
  const a=await fixture();const b=await fixture();try{
    b.advance(a.now-b.now+1000);
    const company=await a.company(),rotation=await a.alice.client.prepareTransition(a.now),{ack:accepted,log}=await a.alice.client.applyTransition(rotation.command);a.advance(accepted.effective_at-a.now);b.advance(a.now-b.now);
    const atA=new PassportClient(rotation.next,a.transport);assert.deepEqual(await atA.exportLog(),log,'the log returned with the change is the one the host serves');
    // Only the recovery file and the log. Host A is not consulted.
    const recovery=new PassportClient(a.alice.recovery,a.transport),{rehome,next}=await recovery.prepareRehome(log,b.host.metadata(),b.now);
    assert.equal(next.resolver.resolver_epoch,1);
    const {ack:adopted,log:afterMove}=await new PassportClient(next,b.transport).adopt(log,rehome);assert.deepEqual([adopted.sequence,adopted.resolver_epoch],[2,1]);
    assert.equal((await identityLog.verifyIdentityLog(afterMove,{require_attestation:true})).resolver.id,b.host.metadata().resolver_id,'the move comes back with the history the new host now serves');
    const atB=new PassportClient(rehomeWallet(rotation.next,b.host.metadata()),b.transport);
    const moved=await identityLog.verifyIdentityLog(await atB.exportLog(),{require_attestation:true});
    assert.equal(moved.resolver.id,b.host.metadata().resolver_id);assert.equal(moved.identity_id,a.alice.operational.person_id);
    // Ordinary life continues at B, including key rotation under B's conservative barrier; A still serves the stale identity until told.
    assert.deepEqual(await atB.run('companies.list'),[],'companies stay where they were created');
    const again=await atB.prepareTransition(b.now),{ack:second}=await atB.applyTransition(again.command);assert.equal(second.effective_at,adopted.effective_at+LEASE_MS+CLOCK_MARGIN_MS);
    assert.equal((await atA.run('companies.list'))[0].organization_id,company.organization_id,'host A, not yet told, still vouches for the old binding');
    // Cooperative release: A stops serving the identity and answers with the forwarding log.
    await recovery.release(await atB.exportLog());
    await assert.rejects(atA.run('companies.list'),/Identity unavailable/);
    const forwarded=await identityLog.verifyIdentityLog(await a.host.registry.exportLog(a.alice.operational.person_id),{require_attestation:true});
    assert.equal(forwarded.resolver.id,b.host.metadata().resolver_id);
    // The operational file cannot move the identity; a wallet pinned to the wrong epoch cannot read the log.
    await assert.rejects(atB.prepareRehome(log,a.host.metadata()),/recovery authority/);
    await assert.rejects(new PassportClient(rotation.next,b.transport).exportLog(),/binding mismatch/);
  }finally{await a.close();await b.close();}
});
