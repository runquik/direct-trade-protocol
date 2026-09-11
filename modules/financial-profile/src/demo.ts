// Independent, read-only Financial Profile module. Local fixtures are never bank verification.
import { Passport, type PassportIdentity } from '../../passport/src/index.ts';
import { generateKeyPair, signBytes, verifyBytes, encodeSignature, decodeSignature, type KeyPair } from '../../../sdk/src/keys.ts';
import { canonicalBytes } from '../../../sdk/src/canonical.ts';
import { demand, draftCommand, signCommand } from '../../../sdk/src/v03/wire.ts';

export const PROFILE_RIGHTS = ['records.read:finance.invoice','records.read:finance.advance'];
export type FinancialProfile = Awaited<ReturnType<typeof createFinancialProfileDemo>>;
export async function createFinancialProfileDemo(passport:Passport, publisher:PassportIdentity, owners:{id:string;name?:string;person:PassportIdentity}[], cashCompany:string) {
 const moduleId=crypto.randomUUID(), installs=new Map<string,{id:string;key:KeyPair}>(), issuer=await generateKeyPair();
 await passport.client.act(publisher,'module.publish',cashCompany,{module_id:moduleId,manifest:{version:'0.2.0',name:'Financial Profile',permissions:PROFILE_RIGHTS}});
 async function connect(person:PassportIdentity,org:string){
  const view=await passport.enter(person,org),old=installs.get(org);
  demand(!old||!view.installations.some((i:any)=>i.id===old.id&&i.active),'conflict','Financial Profile is already connected',409);
  const key=await generateKeyPair(),id=crypto.randomUUID();
  await passport.client.act(person,'installation.create',org,{installation_id:id,module_id:moduleId,manifest_version:'0.2.0',key_id:key.keyId,permissions:PROFILE_RIGHTS,mode:'interactive',expires_at:new Date(Date.now()+7*86400000).toISOString()},[key]);
  installs.set(org,{id,key});
 }
 for(const owner of owners)await connect(owner.person,owner.id);
 async function active(person:PassportIdentity,org:string){
  const view=await passport.enter(person,org),i=installs.get(org);
  return !!i&&view.installations.some((x:any)=>x.id===i.id&&x.active);
 }
 async function read(person:PassportIdentity,org:string){
  const i=installs.get(org);demand(i,'not_found','Financial Profile is not connected',404);
  const view=await passport.enter(person,org);
  for(const cap of PROFILE_RIGHTS)demand(view.permissions.includes('*')||view.permissions.includes(cap),'forbidden','Financial Profile requires company finance-read permission');
  const records:any[]=[];let after=0;
  for(;;){
   const c=draftCommand(passport.client.audience,person,'records.list',org,{after,limit:100});c.actor={kind:'installation',id:i.id,key_id:i.key.keyId};
   const page=await passport.client.send(await signCommand(c,[i.key,person.key]));records.push(...page.records);
   if(page.records.length<100)break;
   const next=Math.max(...page.records.map((r:any)=>r.seq));demand(next>after,'invalid','Record pagination did not advance',500);after=next;
  }
  return records.filter(r=>r.is_head);
 }
 async function state(person:PassportIdentity,org:string){
  const records=await read(person,org),advances=records.filter(r=>r.type==='finance.advance'&&r.body.seller_company_id===org);
  const invoices=records.filter(r=>r.type==='finance.invoice'&&r.body.seller_company_id===org);
  const money=(s:string)=>{const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
  const fmt=(v:bigint)=>`${v/100n}.${String(v%100n).padStart(2,'0')}`;
  const supported=advances.filter(r=>r.body.outstanding.currency==='USD'&&/^\d+(\.\d{1,2})?$/.test(r.body.outstanding.amount));
  const excluded=advances.length-supported.length;
  const outstanding=supported.reduce((sum,r)=>sum+money(r.body.outstanding.amount),0n);
  const fields=[
   {label:'Time in business',value:'Unknown',status:'unknown',source:'No company-age evidence connected'},
   {label:'D&B credit score',value:'Unknown',status:'unknown',source:'No licensed credit report connected. D-U-N-S is an identifier, not a score.'},
   {label:'Average daily bank balance',value:org===cashCompany?'Above $25,000 over 30 days':'Unknown',status:org===cashCompany?'demo attestation':'unknown',source:org===cashCompany?'Demo Bank Connector; one fictional account; synthetic 30-day aggregate':'No bank source connected'},
   {label:'Recorded financing obligations',value:`$${fmt(outstanding)} supported USD outstanding${excluded?' · INCOMPLETE: '+excluded+' unsupported balances excluded':''}`,status:excluded?'incomplete':'protocol-reported',source:'Current visible PBP heads, one per advance root. Includes repayment pending reconciliation. USD with at most two decimal places only; negative balances and other currencies need reconciliation, not netting.'},
   {label:'Recorded repayment history',value:`${advances.filter(r=>r.body.status==='repaid').length} repaid / ${advances.length} recorded advances`,status:advances.length?'protocol-reported':'unknown',source:'Attributed module records, not independently verified bank settlement or a universal reputation score.'},
   {label:'External debt and commercial liens',value:'Unknown — not searched',status:'unknown',source:'No lien search, priority review or external debt source connected. This is not a clear-lien statement.'},
   {label:'Reputation',value:'Not connected',status:'unknown',source:'Reputation remains a future, separate module. No score inferred.'},
  ];
  return {organization_id:org,module_id:moduleId,installation_id:installs.get(org)!.id,as_of:new Date().toISOString(),fields,obligations:advances.map(r=>({record_id:r.record_id,root_id:r.root_id,lender:r.body.financer_company_id,lender_name:owners.find(o=>o.id===r.body.financer_company_id)?.name||'External lender',principal:r.body.principal,outstanding:r.body.outstanding,maturity_at:r.body.maturity_at,status:r.body.status})),invoice_count:invoices.length,source_record_ids:records.map(r=>r.record_id),coverage:'Visible PBP financial records only. External accounts, debt and liens are not covered.',simulation:true};
 }
 async function snapshot(person:PassportIdentity,org:string,shareCash:boolean){
  const current=await state(person,org);
  const payload={...current,fields:current.fields.map(f=>f.label==='Average daily bank balance'&&!shareCash?{...f,value:'Not shared',status:'not shared',source:'Owner withheld the optional bank aggregate'}:f),expires_at:new Date(Date.now()+86400000).toISOString(),domain:'PBP-FINANCIAL-PROFILE-DEMO-1'};
  return {payload,key_id:issuer.keyId,signature:encodeSignature(await signBytes(issuer.secretKey,canonicalBytes(payload)))};
 }
 async function verify(snapshot:any,org:string){
  demand(snapshot?.key_id===issuer.keyId&&snapshot.payload?.organization_id===org&&Date.parse(snapshot.payload.expires_at)>Date.now()&&await verifyBytes(issuer.keyId,canonicalBytes(snapshot.payload),decodeSignature(snapshot.signature)),'invalid_evidence','Financial Profile snapshot is invalid or expired');
  return snapshot.payload;
 }
 async function action(person:PassportIdentity,org:string,path:string){
  if(path==='connect'){await connect(person,org);return {message:'Financial Profile connected with its own read-only credential.'};}
  if(path==='disconnect'){const i=installs.get(org);demand(i,'not_found','Module not installed',404);await passport.client.act(person,'installation.revoke',org,{installation_id:i.id});return {message:'Fresh profile reads stopped. Previously authorized snapshots retain their own disclosure expiry; revoke those in Early Pay.'};}
  demand(path==='state','not_found','Unknown Financial Profile action',404);return state(person,org);
 }
 return {state,snapshot,verify,active,action,moduleId};
}
