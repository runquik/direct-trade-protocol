import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {httpTransport,prepareIdentity,PassportClient,encryptWallet,decryptWallet} from '../../src/onboarding/client.ts';

test('real HTTP process restart retains resolver pin, portable identity, companies, notes and revocation',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'dtp-onboarding-process-'));
  const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as any).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`,api=httpTransport(origin);let child:ChildProcess|undefined;
  async function start(){
    child=fork(fileURLToPath(new URL('../../scripts/onboarding-server.ts',import.meta.url)),[],{execPath:process.execPath,stdio:['ignore','pipe','pipe','ipc'],env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DTP_ONBOARDING_PORT:String(port),DTP_ONBOARDING_DATA:temp}});
    await new Promise<void>((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error('Reference host startup timeout')),15000);child!.once('error',e=>{clearTimeout(timeout);reject(e);});child!.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Reference host exited before ready: ${code}`));});child!.stderr!.on('data',b=>{output+=b.toString();});child!.stdout!.on('data',b=>{output+=b.toString();if(output.includes('independent reference client:')){clearTimeout(timeout);resolve();}});});
  }
  async function stop(){if(!child||child.exitCode!==null)return;await new Promise<void>((resolve,reject)=>{child!.once('exit',()=>resolve());child!.once('error',reject);child!.send('shutdown');});child=undefined;}
  try{
    await start();const meta=await api('meta');
    const owner=await prepareIdentity(meta),viewer=await prepareIdentity(meta);
    await api('enroll',{genesis:owner.genesis,enrollment:owner.enrollment});await api('enroll',{genesis:viewer.genesis,enrollment:viewer.enrollment});
    const a=new PassportClient(owner.operational,api),b=new PassportClient(viewer.operational,api);
    const c=await a.run('company.create',null,{nonce:crypto.randomUUID(),name:'Persistent demo company'});
    await a.run('note.create',c.organization_id,{note_id:crypto.randomUUID(),body:'Persisted via the HTTP boundary'});
    await a.run('membership.invite',c.organization_id,{person_id:viewer.operational.person_id,role:'viewer'});
    const invite=(await b.run('invitations.list'))[0];await b.run('membership.accept',c.organization_id,{grant_id:invite.grant_id});
    await a.run('membership.revoke',c.organization_id,{person_id:viewer.operational.person_id});
    const encrypted=await encryptWallet(owner.operational,'fictional process test password');
    await stop();await start();assert.deepEqual(await api('meta'),meta);
    const independent=new PassportClient(await decryptWallet(encrypted,'fictional process test password'),api);
    assert.equal((await independent.run('company.read',c.organization_id)).notes[0].body,'Persisted via the HTTP boundary');
    await assert.rejects(b.run('company.read',c.organization_id),/Company unavailable/);
    assert.deepEqual(await b.run('companies.list'),[]);
    // Exercise the real-clock/network boundary (not the fixed-clock unit fixture).
    const delayedClient=new PassportClient(independent.wallet,async(path,body)=>{if(path==='resolve')await delay(25);return api(path,body);});
    const plan=await delayedClient.prepareTransition();
    assert.equal(plan.next.person_id,owner.operational.person_id);
    assert.equal(plan.command.body.kind,'rotate');
  }finally{await stop();await rm(temp,{recursive:true,force:true});}
});
