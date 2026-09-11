import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execute} from '../src/v03/engine.ts';
import {emptyState} from '../src/v03/model.ts';
import {draftCommand,signCommand,personId,organizationId,type Command} from '../src/v03/wire.ts';
import {generateKeyPair} from '../src/keys.ts';

test('PBP disclosures: ownership, scope, exact versions, expiry, revocation and module intersection',async()=>{
 let state=emptyState(),now=Date.now();const storeKey=await generateKeyPair(),audience='http://localhost/disclosure-test';
 const expiry=(ms=60000)=>new Date(now+ms).toISOString();
 async function send(command:Command){const next=structuredClone(state);const result:any=await execute(next,command,{audience,now,storeKey,trustedSources:[]});state=next;return result;}
 async function act(person:any,org:string|null,action:string,payload:any,extra:any[]=[]){return send(await signCommand(draftCommand(audience,person,action,org,payload,now),[person.key,...extra]));}
 async function person(){const key=await generateKeyPair(),who={id:await personId(key.keyId),key};await act(who,null,'person.register',{keys:[key.keyId]});return who;}
 const owner=await person(),lenderPerson=await person(),stranger=await person(),employee=await person();
 async function company(who:any,name:string){const nonce=crypto.randomUUID(),id=await organizationId(who.id,nonce);await act(who,id,'organization.create',{name,nonce,controllers:[who.id],threshold:1});return id;}
 const seller=await company(owner,'Seller'),lender=await company(lenderPerson,'Lender'),other=await company(stranger,'Other');
 async function member(rights:string[]){const id=crypto.randomUUID();await act(lenderPerson,lender,'membership.invite',{invitation_id:id,person_id:employee.id,permissions:rights,expires_at:expiry()});await act(employee,lender,'membership.accept',{invitation_id:id});}
 const id=crypto.randomUUID(),usd=(amount:string)=>({amount,currency:'USD'});
 const record={record_id:id,root_id:id,supersedes:null,type:'finance.invoice',subject_company_id:seller,counterparty_ids:[other],visibility:'private',body:{invoice_number:'TEST-1',seller_company_id:seller,buyer_company_id:other,contract_id:crypto.randomUUID(),line_items:[{description:'Fixture',quantity:{amount:'1',unit:'unit'},unit_price:usd('10'),amount:usd('10')}],subtotal:usd('10'),deductions:[],total:usd('10'),issued_at:new Date(now).toISOString(),due_at:expiry(),payment_terms:{net_days:0,paca_covered:false},status:'issued',paid_amount:usd('0'),settlement_event_ids:[],assigned_to_company_id:null}};
 await act(owner,seller,'record.append',record);
 const disclosure=crypto.randomUUID(),payload={disclosure_id:disclosure,recipient:lender,record_ids:[id],purpose:'One test transaction',summary:'{"coverage":"one invoice; other data unknown"}',expires_at:expiry()};
 await assert.rejects(act(stranger,other,'disclosure.create',payload),/company-owned/);
 await act(owner,seller,'disclosure.create',payload);
 const read={source:seller,disclosure_id:disclosure};
 await assert.rejects(act(stranger,other,'disclosure.read',read),/no live disclosure/);
 await member([]);await assert.rejects(act(employee,lender,'disclosure.read',read),/missing capability/);
 await member(['records.read:finance.invoice']);
 const seen=await act(employee,lender,'disclosure.read',read);assert.equal(seen.records.length,1);assert.equal(seen.stale,false);
 assert.equal((await act(employee,lender,'records.list',{after:0,limit:100})).records.length,0,'disclosure does not broaden normal reads');
 const mod=crypto.randomUUID(),inst=crypto.randomUUID(),key=await generateKeyPair();
 await act(lenderPerson,lender,'module.publish',{module_id:mod,manifest:{version:'1.0.0',name:'Reader',permissions:['records.read:finance.invoice']}});
 await act(lenderPerson,lender,'installation.create',{installation_id:inst,module_id:mod,manifest_version:'1.0.0',key_id:key.keyId,permissions:['records.read:finance.invoice'],mode:'interactive',expires_at:expiry()},[key]);
 const command=draftCommand(audience,employee,'disclosure.read',lender,read,now);command.actor={kind:'installation',id:inst,key_id:key.keyId};
 const signed=await signCommand(command,[key,employee.key]);assert.equal((await send(signed)).records.length,1);
 await member([]);await assert.rejects(send(signed),/missing capability/);
 await member(['records.read:finance.invoice']);
 const changed={...record,record_id:crypto.randomUUID(),supersedes:id,body:{...record.body,assigned_to_company_id:lender}};
 await act(owner,seller,'record.append',changed);
 const old=await act(employee,lender,'disclosure.read',read);assert.equal(old.stale,true);assert.equal(old.records[0].record_id,id);
 await act(owner,seller,'disclosure.revoke',{disclosure_id:disclosure});await assert.rejects(send(signed),/no live disclosure/);
 const second=crypto.randomUUID();await act(owner,seller,'disclosure.create',{...payload,disclosure_id:second,record_ids:[changed.record_id],expires_at:expiry(1000)});
 now+=1500;await assert.rejects(act(lenderPerson,lender,'disclosure.read',{source:seller,disclosure_id:second}),/no live disclosure/);
 const third=crypto.randomUUID();await act(owner,seller,'disclosure.create',{...payload,disclosure_id:third,record_ids:[changed.record_id],expires_at:expiry()});
 const thirdCommand=draftCommand(audience,employee,'disclosure.read',lender,{source:seller,disclosure_id:third},now);thirdCommand.actor={kind:'installation',id:inst,key_id:key.keyId};
 await act(lenderPerson,lender,'installation.revoke',{installation_id:inst});await assert.rejects(send(await signCommand(thirdCommand,[key,employee.key])),/revoked/);
 const snap=await act(owner,seller,'migration.preview',{}),destKey=await generateKeyPair();
 await act(owner,seller,'migration.commit',{destination:{audience:'http://destination',key_id:destKey.keyId},snapshot_hash:snap.snapshot_hash});
 await assert.rejects(act(lenderPerson,lender,'disclosure.read',{source:seller,disclosure_id:third}),/no live disclosure/);
});
