// Local-only, disposable Early Pay orchestration. All data and banking claims are fictional.
// Authority, disclosures and finance records use the public signed PBP API.
import { Passport, type PassportIdentity } from '../../passport/src/index.ts';
import { generateKeyPair, type KeyPair } from '../../../sdk/src/keys.ts';
import { cents, dollars, price, payoff } from './economics.ts';
import type { FinancialProfile } from '../../financial-profile/src/demo.ts';
import { demand, digest, draftCommand, signCommand, signaturesOf, type Command } from '../../../sdk/src/v03/wire.ts';

const end = () => new Date(Date.now()+86400000).toISOString();
const usd = (amount:string) => ({amount,currency:'USD'});
export const EARLY_RIGHTS = ['records.read:finance.invoice','records.read:trade.fulfillment','records.read:finance.advance_offer','records.write:finance.advance_offer','records.read:finance.advance','records.write:finance.advance','records.read:finance.settlement_event','records.write:finance.settlement_event','finance.accept_offer','finance.fund'];
type RequestState = { id:string; lender:string; invoice:any; fulfillment:any; status:string; cash:boolean; profileShared:boolean; expires_at:string; seen:Record<string,string>; assignee?:string; quote?:any; offerQuote?:any; payment?:any;
  steps:Record<string,{command:Command; result?:any}>; offer?:any; advance?:any; repayment?:any; option?:string; history:{event:string;at:string;person:string}[] };

export async function createEarlyPayDemo(passport:Passport, seller:string, primaryLender:string, founder:PassportIdentity, lenderController:PassportIdentity, buyer:PassportIdentity, profile:FinancialProfile, additionalLenders:{id:string;name:string;person:PassportIdentity}[] = [], hooks:{beforeReconcile?:()=>void;beforeAppendSend?:(step:string)=>void;afterAppendSend?:(step:string)=>void}={}) {
 const requests=new Map<string,RequestState>();
 const lenders=[{id:primaryLender,name:'Harbor Finance',person:lenderController},...additionalLenders];
 const lenderName=(id:string)=>lenders.find(l=>l.id===id)?.name||'Lender';
 const commitment=(root:string)=>[...requests.values()].find(r=>r.invoice.root_id===root&&['accepted','funded','repayment_sent','repaid'].includes(r.status));
 const moduleId=crypto.randomUUID(), installs=new Map<string,{id:string;key:KeyPair}>();
 await passport.client.act(founder,'module.publish',seller,{module_id:moduleId,manifest:{version:'0.1.0',name:'Early Pay',permissions:EARLY_RIGHTS}});
 for(const [org,owner] of [[seller,founder],...lenders.map(l=>[l.id,l.person] as const)] as const){
  const id=crypto.randomUUID(),key=await generateKeyPair();
  await passport.client.act(owner,'installation.create',org,{installation_id:id,module_id:moduleId,manifest_version:'0.1.0',key_id:key.keyId,permissions:EARLY_RIGHTS,mode:'interactive',expires_at:end()},[key]);
  installs.set(org,{id,key});
 }
 const initial=await passport.enter(founder,seller), first=initial.records.find((r:any)=>r.type==='finance.invoice'&&r.body.invoice_number==='INV-1021');
 const buyerOrg=first.body.buyer_company_id;
 const buyerLabel=(await passport.enter(founder,buyerOrg)).organization.name;
 const invite=await passport.invite(founder,buyerOrg,buyer.id,['records.read:trade.fulfillment','records.write:trade.fulfillment'],end());
 await passport.accept(buyer,buyerOrg,invite);
 const fid=crypto.randomUUID(), bid=crypto.randomUUID(), at=new Date().toISOString();
 const original={record_id:fid,root_id:fid,supersedes:null,type:'trade.fulfillment',subject_company_id:seller,counterparty_ids:[buyerOrg],visibility:'counterparties',body:{contract_id:first.body.contract_id,seller_company_id:seller,buyer_company_id:buyerOrg,delivered_at:at,quantity_delivered:{amount:'480',unit:'case'},seller_attestation:{company_id:seller,record_id:fid,attested_at:at},buyer_attestation:null,status:'seller_attested'}};
 await passport.client.act(founder,'record.append',seller,original);
 await passport.client.act(buyer,'record.append',buyerOrg,{...original,record_id:bid,supersedes:fid,body:{...original.body,buyer_attestation:{company_id:buyerOrg,record_id:bid,attested_at:at},status:'buyer_attested'}});

 async function authority(person:PassportIdentity,org:string,capability?:string){
  demand(org===seller||lenders.some(l=>l.id===org),'forbidden','Early Pay is not installed for this company');
  const view=await passport.enter(person,org);
  if(capability)demand(view.permissions.includes('*')||view.permissions.includes(capability),'forbidden',`Missing permission: ${capability}`);
  return view;
 }
 async function moduleRead(person:PassportIdentity,org:string,all=false){
  const i=installs.get(org)!;const records:any[]=[];let after=0;
  for(;;){const command=draftCommand(passport.client.audience,person,'records.list',org,{after,limit:100});command.actor={kind:'installation',id:i.id,key_id:i.key.keyId};
   const page=await passport.client.send(await signCommand(command,[i.key,person.key]));records.push(...page.records);if(page.next_cursor===null)break;after=page.next_cursor;}
  return all?records:records.filter((r:any)=>r.is_head);
 }
 async function append(r:RequestState,step:string,person:PassportIdentity,org:string,type:string,subject:string,counterparties:string[],body:any,previous?:any){
  const i=installs.get(org)!;
  if(!r.steps[step]){
   const id=crypto.randomUUID(),command=draftCommand(passport.client.audience,person,'record.append',org,{record_id:id,root_id:previous?.root_id||id,supersedes:previous?.record_id||null,type,subject_company_id:subject,counterparty_ids:counterparties,visibility:'counterparties',body});
   command.actor={kind:'installation',id:i.id,key_id:i.key.keyId};
   r.steps[step]={command:await signCommand(command,[i.key,person.key])};
  }
  const stepState=r.steps[step];
  // Retry the exact signed action. A new actor must not reuse someone else's pending approval.
  demand(stepState.command.requested_by===person.id,'conflict','Resume this action as its original approver',409);
  if(!stepState.result&&Date.parse(stepState.command.expires_at)<=Date.now()){
   const existing=(await moduleRead(person,org,true)).find((x:any)=>x.record_id===stepState.command.payload.record_id);
   if(existing){const {command,seq,is_head,accepted_at,...fields}=existing;demand(await digest(fields)===await digest(stepState.command.payload),'conflict','Persisted record differs from the authorized retry',409);stepState.result=existing;}
   else {
    // The current original approver explicitly retried this action. Reauthorize only the identical payload.
    const fresh=draftCommand(passport.client.audience,person,'record.append',org,stepState.command.payload);
    fresh.actor={kind:'installation',id:i.id,key_id:i.key.keyId};stepState.command=await signCommand(fresh,[i.key,person.key]);
   }
  }
  if(!stepState.result){hooks.beforeAppendSend?.(step);const result=await passport.client.send(stepState.command);hooks.afterAppendSend?.(step);stepState.result=result;}
  return stepState.result;
 }
 const history=(r:RequestState,event:string,person:PassportIdentity)=>r.history.push({event,at:new Date().toISOString(),person:person.id});
 async function packageFor(person:PassportIdentity,org:string,r:RequestState){
  const installed=installs.get(org)!,command=draftCommand(passport.client.audience,person,'disclosure.read',org,{source:seller,disclosure_id:r.id});
  command.actor={kind:'installation',id:installed.id,key_id:installed.key.keyId};
  const pack=await passport.client.send(await signCommand(command,[installed.key,person.key]));
  demand(!pack.stale,'stale_evidence','A shared record changed. Withdraw this request and create a fresh one.',409);
  for(const record of pack.records){
   await signaturesOf(record.command);
   const {command,seq,is_head,accepted_at,...fields}=record;
   demand(await digest(fields)===await digest(command.payload),'invalid_evidence','Record content differs from its signed source');
  }
  const f=pack.records.find((x:any)=>x.record_id===r.fulfillment.record_id),invoice=pack.records.find((x:any)=>x.record_id===r.invoice.record_id);
  demand(f&&invoice&&f.body.status==='buyer_attested'&&f.command.organization_id===invoice.body.buyer_company_id&&f.command.requested_by===buyer.id&&f.body.buyer_attestation?.record_id===f.record_id,'invalid_evidence','Buyer confirmation does not match the selected invoice');
  demand(invoice.body.contract_id===f.body.contract_id&&invoice.body.seller_company_id===seller&&invoice.body.buyer_company_id===f.body.buyer_company_id,'invalid_evidence','Evidence refers to different parties or trade');
  demand(invoice.body.currency===undefined&&invoice.body.total.currency==='USD'&&invoice.body.paid_amount.currency==='USD','invalid_evidence','Demo requires USD evidence');
  demand(['issued','acknowledged'].includes(invoice.body.status)&&cents(invoice.body.paid_amount.amount)===0n&&!invoice.body.assigned_to_company_id,'ineligible','Invoice is paid, disputed or already assigned');
  demand(Date.parse(invoice.body.due_at)>Date.now(),'ineligible','Invoice is past due');
  const summary=JSON.parse(pack.summary);
  const snapshot=summary.financial_profile?await profile.verify(summary.financial_profile,seller):null;
  return {...pack,profile:snapshot?.fields||[],financial_profile:summary.financial_profile,party_names:summary.party_names};
 }
 function options(invoice:any){
  return [{id:'standard',label:'Standard advance',advanceBps:8000,feeBps:100},{id:'higher',label:'Higher advance',advanceBps:9000,feeBps:150}].map(plan=>{
   const principal=cents(invoice.body.total.amount)*BigInt(plan.advanceBps)/10000n,fee=principal*BigInt(plan.feeBps)/10000n;
   return {...plan,principal:dollars(principal),fee:dollars(fee),repayment:dollars(principal+fee),term_days:30};
  });
 }
 async function state(person:PassportIdentity,org:string){
  const view=await authority(person,org,'records.read:finance.invoice'),records=await moduleRead(person,org), lenderView=org!==seller;
  for(const cap of EARLY_RIGHTS.filter(r=>r.startsWith('records.read:')))demand(view.permissions.includes('*')||view.permissions.includes(cap),'forbidden','Early Pay requires access to the complete financing view');
  const rows=[];
  for(const r of requests.values()){
   if(lenderView&&r.lender!==org)continue;
   let evidence:any=null,error='';
   try{evidence=await packageFor(person,org,r);}catch(e){error=(e as Error).message;}
   const eventId=r.status+':'+r.history.length;
   rows.push({id:r.id,invoice_id:r.invoice.record_id,lender:r.lender,lender_name:lenderName(r.lender),status:r.status,event_id:eventId,unread:r.seen[person.id]!==eventId,assignee:r.assignee===person.id?'me':r.assignee?'teammate':null,expires_at:r.expires_at,evidence_error:error,evidence,blocked_by_commitment:!!commitment(r.invoice.root_id)&&commitment(r.invoice.root_id)!.id!==r.id,payment:r.payment||null,
    invoice_number:evidence||!lenderView?r.invoice.body.invoice_number:null,
    amount:evidence||!lenderView?r.invoice.body.total.amount:null,options:evidence?options(r.invoice):[],offer:records.find((x:any)=>x.record_id===r.offer?.record_id)||null,advance:records.find((x:any)=>x.record_id===r.advance?.record_id)||null,repayment:records.find((x:any)=>x.record_id===r.repayment?.record_id)||null,history:evidence||r.advance?r.history:[],economics:r.offer?{...price(r.invoice.body.total.amount,r.offer.body.advance_bps,r.offer.body.x_terms.feeBps,r.offer.body.x_terms.days),annualized_percent:Number(r.offer.body.fee.fixed_fee.amount)/Number(r.offer.body.advance_amount.amount)*365*86400000/(Date.parse(r.offer.body.repayment.due_at)-Date.parse(r.advance?.body.funded_at||r.offer.body.x_terms.issued_at)) *100}:null});
  }
  return {role:lenderView?'lender':'seller',organization_id:org,seller,lender:lenderView?org:primaryLender,lenders:lenders.map(l=>({id:l.id,name:l.name,kind:'Published demo criteria',criteria:'USD invoice with buyer-confirmed delivery; manual decision. No approval odds or automated funding.',advance_range:'50–90%',fee_range:'0.25–3% of principal',days_range:'7–60 days'})),permissions:view.permissions,requests:rows,
   invoices:lenderView?[]:records.filter((r:any)=>r.type==='finance.invoice').map((r:any)=>({id:r.record_id,number:r.body.invoice_number,amount:r.body.total.amount,due_at:r.body.due_at,
    eligible:r.record_id===first.record_id&&!commitment(r.root_id),reason:r.record_id===first.record_id?'Buyer-confirmed delivery; incomplete company profile':'Additional trade evidence not packaged in this demo'})),profile_available:!lenderView?await profile.active(person,org):false,module_id:moduleId,installation_id:installs.get(org)!.id};
 }
 async function action(person:PassportIdentity,org:string,path:string,p:any){
  await authority(person,org); await moduleRead(person,org); // Check current human AND installation authority on every action, including retries.
  if(path==='state')return state(person,org);
  let lender=primaryLender;
  if(path==='request'){
   demand(org===seller,'forbidden','Only Acme can request financing'); await authority(person,org,'records.share');
   lender=p.lender_id||primaryLender;demand(lenders.some(l=>l.id===lender),'invalid','Select a listed lender',400);
   demand(typeof p.share_profile==='boolean','invalid','Choose whether to share Financial Profile',400);
   demand(!p.share_cash||p.share_profile,'invalid','Bank aggregate sharing requires Financial Profile consent',400);
   demand(p.invoice_id===first.record_id&&typeof p.share_cash==='boolean','invalid','Select the supported invoice and explicit sharing choice',400);
   const existing=[...requests.values()].find(r=>r.invoice.record_id===p.invoice_id&&r.lender===lender&&!['withdrawn','repaid'].includes(r.status));
   if(existing){demand(existing.cash===p.share_cash&&existing.profileShared===p.share_profile,'conflict','Existing request has a different sharing choice',409);return {id:existing.id};}
   demand(!commitment(first.root_id),'conflict','This invoice already has a financing commitment in Early Pay',409);
   const visible=await moduleRead(person,org),invoice=visible.find((r:any)=>r.record_id===p.invoice_id),fulfillment=visible.find((r:any)=>r.record_id===bid);
   demand(invoice&&fulfillment,'forbidden','Required invoice or delivery evidence is unavailable');
   const id=crypto.randomUUID(),expiry=end();
   const financialProfile=p.share_profile?await profile.snapshot(person,org,p.share_cash):null;
   const summary=JSON.stringify({kind:'early-pay-demo-request',party_names:{[seller]:'Acme Sauce',[lender]:lenderName(lender),[buyerOrg]:buyerLabel},financial_profile:financialProfile,
    limitations:['Fictional data','No external lien or duplicate-financing verification','Snapshot is separately consented; disconnecting its source module does not erase this copy']});
   await passport.client.act(person,'disclosure.create',org,{disclosure_id:id,recipient:lender,record_ids:[invoice.record_id,fulfillment.record_id],purpose:'Evaluate one fictional invoice advance',summary,expires_at:expiry});
   const r:RequestState={id,lender,invoice,fulfillment,status:'requested',cash:p.share_cash,profileShared:p.share_profile,expires_at:expiry,steps:{},history:[],seen:{}};requests.set(id,r);history(r,'Evidence shared with '+lenderName(lender)+' for 24 hours',person);
   return {id};
  }
  const r=requests.get(p.request_id); demand(r&&(org===seller||r.lender===org),'not_found','Financing request not found',404);lender=r.lender;
  if(path==='seen'){await state(person,org);if(p.event_id===r.status+':'+r.history.length)r.seen[person.id]=p.event_id;return {status:r.status};}
  if(path==='assign'){demand(org===lender,'forbidden','Lender assignment only');await packageFor(person,org,r);r.assignee=person.id;return {status:r.status};}
  if(path==='withdraw'){
   demand(org===seller&&['requested','offered','withdrawn'].includes(r.status),'conflict','Only an unaccepted request can be withdrawn',409);
   if(r.status==='offered'&&r.offer)r.offer=await append(r,'decline',person,org,'finance.advance_offer',seller,[lender],{...r.offer.body,status:'declined'},r.offer);
   await passport.client.act(person,'disclosure.revoke',org,{disclosure_id:r.id});
   if(r.status!=='withdrawn')history(r,'Request withdrawn; evidence access revoked',person);r.status='withdrawn';return {status:r.status};
  }
  if(path==='revoke-sharing'){
   demand(org===seller,'forbidden','Only Acme controls this disclosure');
   await passport.client.act(person,'disclosure.revoke',org,{disclosure_id:r.id});history(r,'Future evidence access revoked; financial commitments unchanged',person);return {status:r.status};
  }
  if(path==='quote-offer'){
   demand(org===lender&&r.status==='requested','conflict','Only an awaiting request can be priced',409);await authority(person,org,'records.write:finance.advance_offer');await packageFor(person,org,r);
   const quote=price(r.invoice.body.total.amount,p.terms?.advanceBps,p.terms?.feeBps,p.terms?.days);
   r.offerQuote={id:crypto.randomUUID(),...quote,issued_at:new Date().toISOString(),due_at:new Date(Date.now()+quote.term_days*86400000).toISOString(),expires_at:new Date(Math.min(Date.now()+300000,Date.parse(r.expires_at))).toISOString()};return r.offerQuote;
  }
  if(path==='offer'){
   demand(org===lender,'forbidden','Only Harbor can issue an offer'); await authority(person,org,'records.write:finance.advance_offer');
   demand(['requested','offered'].includes(r.status),'conflict','Request is not awaiting an offer',409);await packageFor(person,org,r);
   if(p.quote_id)demand(r.offerQuote?.id===p.quote_id&&Date.parse(r.offerQuote.expires_at)>Date.now(),'conflict','Offer quote expired or changed',409);
   const choice=p.quote_id?r.offerQuote:options(r.invoice).find(x=>x.id===p.option);demand(choice,'invalid','Request an exact offer quote first',400);
   demand(!commitment(r.invoice.root_id),'conflict','Invoice already committed to a financing offer',409);
   demand(!r.option||r.option===choice.id,'conflict','Offer terms are already fixed',409);r.option=choice.id;
   r.offer=await append(r,'offer',person,org,'finance.advance_offer',seller,[lender],{invoice_id:r.invoice.root_id,seller_company_id:seller,financer_company_id:lender,advance_amount:usd(choice.principal),advance_bps:choice.advanceBps,
    fee:{fee_bps:0,apr_bps:Math.round(choice.feeBps*365/choice.term_days),fixed_fee:usd(choice.fee)},repayment:{source:'seller',due_at:choice.due_at||new Date(Date.now()+choice.term_days*86400000).toISOString()},recourse:'full',pricing_basis:[{record_id:r.invoice.record_id,type:'finance.invoice',note:'Exact disclosed invoice version'},{record_id:r.fulfillment.record_id,type:'trade.fulfillment',note:'Independent fictional buyer confirmation'}],expires_at:r.expires_at,status:'offered',x_terms:{feeBps:choice.feeBps,days:choice.term_days,issued_at:choice.issued_at||new Date().toISOString(),early_payoff:'proportional_fee_one_day_minimum',rounding:'advance and original fee floored to cents; early fee rounded up',annualized_basis:'Simple gross equivalent; assumed immediate funding, not regulatory APR'}});
   if(r.status!=='offered')history(r,lenderName(lender)+' issued a simulated offer',person);r.status='offered';return {status:r.status};
  }
  if(path==='accept'){
   demand(org===seller,'forbidden','Only Acme can accept');await authority(person,org,'finance.accept_offer');
   demand(!commitment(r.invoice.root_id)||commitment(r.invoice.root_id)!.id===r.id,'conflict','Invoice is already committed to another offer',409);
   demand(['offered','accepted'].includes(r.status)&&r.offer,'conflict','No offer is awaiting acceptance',409);await packageFor(person,org,r);
   demand(p.offer_id===r.offer.record_id||p.offer_id===r.steps.accept?.command.payload.supersedes,'conflict','Review the exact current offer before accepting',409);
   demand(Date.parse(r.offer.body.expires_at)>Date.now(),'expired','Offer expired',409);
   r.offer=await append(r,'accept',person,org,'finance.advance_offer',seller,[lender],{...r.offer.body,status:'accepted'},r.offer);
   if(r.status!=='accepted')history(r,'Acme accepted the exact offer',person);r.status='accepted';return {status:r.status};
  }
  if(path==='fund'){
   demand(org===lender,'forbidden','Only Harbor can fund');await authority(person,org,'finance.fund');
   demand(['accepted','funded'].includes(r.status)&&r.offer,'conflict','Seller acceptance is required first',409);
   if(r.status==='funded')return {status:r.status};await packageFor(person,org,r);
   demand(Date.parse(r.offer.body.expires_at)>Date.now(),'expired','Offer expired before funding',409);
   const offer=r.offer.body,occurred=new Date().toISOString();
   demand(Date.parse(offer.repayment.due_at)>Date.now(),'expired','Offer maturity has passed',409);
   const event=await append(r,'fund-event',person,org,'finance.settlement_event',lender,[seller],{kind:'advance_funding',from_company_id:lender,to_company_id:seller,amount:offer.advance_amount,occurred_at:occurred,rail:'mock',references:{invoice_id:r.invoice.root_id},reverses:null,memo:'Simulation only: no money moved'});
   r.advance=await append(r,'advance',person,org,'finance.advance',seller,[lender],{advance_offer_id:r.offer.root_id,invoice_id:r.invoice.root_id,seller_company_id:seller,financer_company_id:lender,principal:offer.advance_amount,fee:offer.fee,funded_at:event.body.occurred_at,funding_event_id:event.root_id,maturity_at:offer.repayment.due_at,repaid_amount:usd('0.00'),outstanding:usd(dollars(cents(offer.advance_amount.amount)+cents(offer.fee.fixed_fee.amount))),status:'funded'});
   r.status='funded';history(r,'Harbor simulated funding (mock rail)',person);return {status:r.status};
  }
  if(path==='payoff'){
   if(org===seller&&r.status==='repayment_sent'&&r.payment&&!r.payment.settlement_started&&Date.parse(r.payment.authorization_expires_at)<=Date.now()){
    r.payment.status='expired';r.status='funded';history(r,'Mock payment authorization expired; borrower must authorize a fresh attempt',person);
   }
   demand(org===seller&&r.status==='funded'&&r.advance,'conflict','A funded advance is required',409);
   await authority(person,org,'records.write:finance.settlement_event');
   demand(typeof p.early==='boolean','invalid','Choose a payoff type',400);
   r.quote={id:crypto.randomUUID(),advance_id:r.advance.record_id,...payoff(r.advance.body.principal.amount,r.advance.body.fee.fixed_fee.amount,r.advance.body.funded_at,r.advance.body.maturity_at,new Date().toISOString(),p.early),expires_at:new Date(Date.now()+5*60000).toISOString()};
   return r.quote;
  }
  if(path==='repay'){
   demand(org===seller,'forbidden','Only Acme can authorize repayment');await authority(person,org,'records.write:finance.settlement_event');
   if(r.payment?.quote_id===p.quote_id&&['pending','settled'].includes(r.payment.status))return {status:r.status};
   demand(r.status==='funded'&&r.advance,'conflict','No funded advance available for repayment',409);
   demand(r.quote&&p.quote_id===r.quote.id&&r.quote.advance_id===r.advance.record_id&&Date.parse(r.quote.expires_at)>Date.now(),'conflict','Payoff quote changed or expired. Request a fresh quote.',409);
   r.payment={id:crypto.randomUUID(),quote_id:r.quote.id,amount:r.quote.amount,waived_fee:r.quote.waived_fee,requested_at:new Date().toISOString(),status:'pending'};
   const i=installs.get(org)!,id=crypto.randomUUID(),command=draftCommand(passport.client.audience,person,'record.append',org,{record_id:id,root_id:id,supersedes:null,type:'finance.settlement_event',subject_company_id:seller,counterparty_ids:[lender],visibility:'counterparties',body:{kind:'advance_repayment',from_company_id:seller,to_company_id:lender,amount:usd(r.payment.amount),occurred_at:r.payment.requested_at,rail:'mock',references:{invoice_id:r.invoice.root_id,advance_id:r.advance.root_id},reverses:null,memo:'Preauthorized mock transfer timestamp; published only after simulated lender receipt. No money moved.',x_payment_attempt:r.payment.id}});
   command.actor={kind:'installation',id:i.id,key_id:i.key.keyId};
   r.payment.authorization_expires_at=command.expires_at;
   r.steps['settled-'+r.payment.id]={command:await signCommand(command,[i.key,person.key])};
   r.status='repayment_sent';history(r,'Repayment initiated (simulation); awaiting settlement, debt remains outstanding',person);return {status:r.status};
  }
  if(path==='fail-payment'){
   demand(org===lender&&r.status==='repayment_sent','conflict','No pending payment',409);await authority(person,org,'finance.fund');
   demand(!r.payment.settlement_started,'conflict','Settlement publication already began. Retry reconciliation; do not initiate another repayment.',409);
   r.payment.status='failed';r.status='funded';r.quote=null;history(r,'Simulated payment failed; repayment still due',person);return {status:r.status};
  }
  if(path==='close'){
   demand(org===lender,'forbidden','Only the lender can reconcile');await authority(person,org,'finance.fund');
   await authority(person,org,'records.write:finance.advance');
   demand(['repayment_sent','repaid'].includes(r.status)&&r.payment&&r.advance,'conflict','A pending payment is required',409);
   const payment=r.payment;
   const authorization=r.steps['settled-'+payment.id];
   demand(payment.settlement_started||Date.parse(payment.authorization_expires_at)>Date.now(),'expired','Mock payment authorization expired. Acme must renew repayment authorization.',409);
   payment.settlement_started=true;
   if(!authorization.result){
    try{authorization.result=await passport.client.send(authorization.command);}
    catch(e){const found=(await moduleRead(person,org)).find((x:any)=>x.record_id===authorization.command.payload.record_id);if(found)authorization.result=found;else {if(Date.parse(authorization.command.expires_at)<=Date.now())payment.settlement_started=false;throw e;}}
   }
   r.repayment=authorization.result;
   demand(cents(payment.amount)+cents(payment.waived_fee)===cents(r.advance.body.principal.amount)+cents(r.advance.body.fee.fixed_fee.amount),'invalid','Repayment and fee waiver do not balance',409);
   hooks.beforeReconcile?.();
   r.advance=await append(r,'close-'+payment.id,person,org,'finance.advance',seller,[lender],{...r.advance.body,repaid_amount:usd(payment.amount),outstanding:usd('0.00'),repayment_event_ids:[r.repayment.root_id],status:'repaid',x_simulated_receipt_at:new Date().toISOString(),x_fee_waiver:{amount:usd(payment.waived_fee),quote_id:payment.quote_id,policy:'proportional_fee_one_day_minimum'}},r.advance);
   payment.status='settled';if(r.status!=='repaid')history(r,'Lender confirmed simulated settlement and fee waiver; advance closed',person);r.status='repaid';return {status:r.status};
  }
  demand(false,'not_found','Unknown Early Pay action',404);
 }
 async function notifications(person:PassportIdentity,org:string){
  const view=await state(person,org);
  return view.requests.filter(r=>r.evidence||r.advance).filter(r=>!r.blocked_by_commitment&&r.status!=='withdrawn').map(r=>{
   const lenderView=org!==seller;
   const labels:Record<string,string>={requested:lenderView?'New financing request':'Awaiting lender review',offered:lenderView?'Offer awaiting Acme acceptance':'Offer received from '+r.lender_name,accepted:lenderView?'Funding approval needed':'Awaiting '+r.lender_name+' funding',funded:r.payment?.status==='failed'?'Payment failed — repayment still due':Date.parse(r.advance?.body.maturity_at)<Date.now()?'Repayment overdue':Date.parse(r.advance?.body.maturity_at)<Date.now()+3*86400000?'Repayment due soon':'Advance active — repayment due '+new Date(r.advance?.body.maturity_at).toLocaleDateString('en-US'),repayment_sent:lenderView?'Confirm simulated payment settlement':'Repayment pending settlement',repaid:'Advance repaid'};
   return {id:r.id+':'+r.event_id,request_id:r.id,module:'Early Pay',label:labels[r.status]||r.status,invoice:r.invoice_number||'Financing agreement',unread:r.unread,href:'/early-pay?org='+org+'&request='+r.id};
  });
 }
 return {action,notifications,installation:(org:string)=>installs.get(org),moduleId};
}
