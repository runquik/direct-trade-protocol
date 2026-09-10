import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPassportWeb} from '../scripts/passport-web.ts';
import {price,payoff,cents} from '../../modules/early-pay/src/economics.ts';
import {createPbpStore} from '../scripts/pbp-dev-server.ts';
import {Passport} from '../../modules/passport/src/index.ts';
import {createFinancialProfileDemo} from '../../modules/financial-profile/src/demo.ts';

async function harness(t:any,hooks:any={}){
 const demo=await createPassportWeb(0,hooks);t.after(()=>demo.close());
 async function user(persona:string){const res=await fetch(demo.origin+'/api/session'),session=await res.json(),cookie=res.headers.get('set-cookie')!.split(';')[0];
  const post=async(path:string,p:any={},status=200)=>{const r=await fetch(demo.origin+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-demo-csrf':session.csrf},body:JSON.stringify({demo_persona:persona,...p})});const v=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(v)}`);return v;};
  return {post,home:await post('/api/login',{persona})};}
 const [alex,jamie,riley,taylor,sam]=await Promise.all(['alex','jamie','riley','taylor','sam'].map(user));
 const seller=alex.home.companies.find((c:any)=>c.name==='Acme Sauce').id,harbor=riley.home.companies[0].id,cedar=taylor.home.companies[0].id;
 const call=(u:any,org:string,path:string,p:any={},status=200)=>u.post('/api/early/'+path,{organization_id:org,...p},status);
 const invoice=(await call(alex,seller,'state')).invoices.find((i:any)=>i.eligible);
 return {demo,alex,jamie,riley,taylor,sam,seller,harbor,cedar,call,invoice};
}
test('Modular finance: independent profile, lender isolation, commitment guard and discounted settlement',{timeout:120000},async t=>{
 const {alex,jamie,riley,taylor,sam,seller,harbor,cedar,call,invoice}=await harness(t);
 const own=await alex.post('/api/profile/state',{organization_id:seller});assert.equal(own.obligations.length,0);assert.ok(own.fields.some((f:any)=>f.label.includes('liens')&&f.status==='unknown'));
 await sam.post('/api/profile/state',{organization_id:seller},403);await riley.post('/api/profile/state',{organization_id:seller},403);
 const blue=alex.home.companies.find((c:any)=>c.name==='Bluestem Foods').id;await alex.post('/api/profile/state',{organization_id:blue},403);
 const a=await call(alex,seller,'request',{invoice_id:invoice.id,lender_id:harbor,share_profile:true,share_cash:false});
 assert.equal((await call(taylor,cedar,'state')).requests.length,0);
 const b=await call(alex,seller,'request',{invoice_id:invoice.id,lender_id:cedar,share_profile:false,share_cash:false});
 await call(taylor,cedar,'offer',{request_id:a.id,option:'standard'},404);
 let lenderState=(await call(riley,harbor,'state')).requests[0];assert.equal(lenderState.unread,true);assert.equal(lenderState.evidence.financial_profile.payload.fields.find((f:any)=>f.label==='Average daily bank balance').status,'not shared');
 const notices=(await riley.post('/api/workspace',{organization_id:harbor})).notifications;assert.equal(notices.length,1);assert.ok(notices[0].href.includes(a.id));
 assert.deepEqual((await sam.post('/api/workspace',{organization_id:seller})).notifications,[]);
 await call(riley,harbor,'seen',{request_id:a.id,event_id:lenderState.event_id});lenderState=(await call(riley,harbor,'state')).requests[0];assert.equal(lenderState.unread,false);assert.equal(lenderState.status,'requested');
 await call(riley,harbor,'assign',{request_id:a.id});assert.equal((await call(riley,harbor,'state')).requests[0].assignee,'me');
 await jamie.post('/api/profile/disconnect',{organization_id:seller});await alex.post('/api/profile/state',{organization_id:seller},403);
 assert.equal((await call(alex,seller,'state')).profile_available,false);assert.ok((await call(riley,harbor,'state')).requests[0].evidence.financial_profile,'separately consented snapshot remains');
 await call(riley,harbor,'quote-offer',{request_id:a.id,terms:{advanceBps:9001,feeBps:100,days:30}},400);
 const q=await call(riley,harbor,'quote-offer',{request_id:a.id,terms:{advanceBps:8500,feeBps:125,days:30}});
 await call(riley,harbor,'offer',{request_id:a.id,quote_id:q.id});await call(taylor,cedar,'offer',{request_id:b.id,option:'standard'});
 const offers=(await call(alex,seller,'state')).requests;const oa=offers.find((r:any)=>r.id===a.id),ob=offers.find((r:any)=>r.id===b.id);
 assert.equal(oa.offer.body.repayment.due_at,q.due_at);assert.equal(oa.economics.principal,'8568.00');
 await call(alex,seller,'accept',{request_id:a.id,offer_id:oa.offer.record_id});await call(alex,seller,'accept',{request_id:b.id,offer_id:ob.offer.record_id},409);
 await call(taylor,cedar,'fund',{request_id:b.id},409);await call(riley,harbor,'fund',{request_id:a.id});
 await jamie.post('/api/profile/connect',{organization_id:seller});let current=await alex.post('/api/profile/state',{organization_id:seller});assert.equal(current.obligations.length,1);
 const quote=await call(alex,seller,'payoff',{request_id:a.id,early:true});assert.ok(cents(quote.waived_fee)>0n);
 await call(alex,seller,'repay',{request_id:a.id,quote_id:'wrong'},409);await call(alex,seller,'repay',{request_id:a.id,quote_id:quote.id});
 current=await alex.post('/api/profile/state',{organization_id:seller});assert.notEqual(current.obligations[0].outstanding.amount,'0.00');
 assert.equal((await call(alex,seller,'state')).requests.find((r:any)=>r.id===a.id).repayment,null,'initiation is not settlement');
 await call(riley,harbor,'fail-payment',{request_id:a.id});assert.equal((await call(alex,seller,'state')).requests.find((r:any)=>r.id===a.id).payment.status,'failed');
 const quote2=await call(alex,seller,'payoff',{request_id:a.id,early:true});await call(alex,seller,'repay',{request_id:a.id,quote_id:quote2.id});
 await call(riley,harbor,'close',{request_id:a.id});await call(riley,harbor,'close',{request_id:a.id});
 current=await alex.post('/api/profile/state',{organization_id:seller});assert.equal(current.obligations[0].outstanding.amount,'0.00');
 const closed=(await call(alex,seller,'state')).requests.find((r:any)=>r.id===a.id);
 assert.equal(cents(closed.advance.body.principal.amount)+cents(closed.advance.body.fee.fixed_fee.amount),cents(closed.advance.body.repaid_amount.amount)+cents(closed.advance.body.x_fee_waiver.amount.amount));
 assert.equal((await alex.post('/api/workspace',{organization_id:seller})).records.find((r:any)=>r.record_id===invoice.id).body.paid_amount.amount,'0');
 await call(alex,seller,'revoke-sharing',{request_id:a.id});assert.equal((await call(riley,harbor,'state')).requests[0].evidence,null);
});
test('Repayment expires safely and partial settlement cannot become another payment',{timeout:120000},async t=>{
 let fail=false;const h=await harness(t,{beforeAppendSend:(step:string)=>{if(fail&&step.startsWith('close-')){fail=false;throw new Error('Injected failure at closure send boundary');}}});const {alex,riley,seller,harbor,call,invoice}=h;
 const r=await call(alex,seller,'request',{invoice_id:invoice.id,share_profile:false,share_cash:false});await call(riley,harbor,'offer',{request_id:r.id,option:'standard'});const offer=(await call(alex,seller,'state')).requests[0].offer;await call(alex,seller,'accept',{request_id:r.id,offer_id:offer.record_id});await call(riley,harbor,'fund',{request_id:r.id});
 const q=await call(alex,seller,'payoff',{request_id:r.id,early:true});await call(alex,seller,'repay',{request_id:r.id,quote_id:q.id});
 const original=Date.now;let later=original()+180000;Date.now=()=>later;
 try{await call(riley,harbor,'close',{request_id:r.id},409);const fresh=await call(alex,seller,'payoff',{request_id:r.id,early:true});await call(alex,seller,'repay',{request_id:r.id,quote_id:fresh.id});fail=true;await call(riley,harbor,'close',{request_id:r.id},500);await call(riley,harbor,'fail-payment',{request_id:r.id},409);await call(alex,seller,'payoff',{request_id:r.id,early:true},409);later+=180000;await call(riley,harbor,'close',{request_id:r.id});assert.equal((await call(alex,seller,'state')).requests[0].status,'repaid');}finally{Date.now=original;}
});
test('Pricing and early payoff exact arithmetic and input boundaries',()=>{
 assert.equal(price('10080.00',8000,100,30).repayment,'8144.64');
 for(const terms of [[4999,100,30],[9001,100,30],[8000,0,30],[8000,100,0],[8000,NaN,30],[8000,100.5,30]])assert.throws(()=>price('10080.00',...terms as [number,number,number]));
 assert.throws(()=>price('0.01',5000,100,30));
 const p=payoff('8064.00','80.64','2026-01-01T00:00:00Z','2026-01-31T00:00:00Z','2026-01-16T00:00:00Z',true);assert.equal(p.fee,'40.32');assert.equal(p.waived_fee,'40.32');assert.equal(p.amount,'8104.32');
 assert.equal(payoff('8064.00','80.64','2026-01-01T00:00:00Z','2026-01-31T00:00:00Z','2026-02-01T00:00:00Z',true).fee,'80.64');
});
test('Lost closure response recovers the exact record after expiry without another settlement',{timeout:120000},async t=>{
 let drop=true;const {alex,riley,seller,harbor,call,invoice}=await harness(t,{afterAppendSend:(step:string)=>{if(drop&&step.startsWith('close-')){drop=false;throw new Error('Simulated lost closure response');}}});
 const r=await call(alex,seller,'request',{invoice_id:invoice.id,share_profile:false,share_cash:false});await call(riley,harbor,'offer',{request_id:r.id,option:'standard'});const o=(await call(alex,seller,'state')).requests[0].offer;await call(alex,seller,'accept',{request_id:r.id,offer_id:o.record_id});await call(riley,harbor,'fund',{request_id:r.id});
 const q=await call(alex,seller,'payoff',{request_id:r.id,early:false});await call(alex,seller,'repay',{request_id:r.id,quote_id:q.id});await call(riley,harbor,'close',{request_id:r.id},500);
 const before=(await riley.post('/api/workspace',{organization_id:harbor})).records.filter((x:any)=>x.type==='finance.settlement_event').length;
 const original=Date.now,later=original()+180000;Date.now=()=>later;try{await call(riley,harbor,'close',{request_id:r.id});const state=(await call(alex,seller,'state')).requests[0];assert.equal(state.status,'repaid');const after=(await riley.post('/api/workspace',{organization_id:harbor})).records.filter((x:any)=>x.type==='finance.settlement_event').length;assert.equal(before,after);}finally{Date.now=original;}
});
test('Pending repayment rechecks borrower revocation; new profile sharing requires active module',{timeout:120000},async t=>{
 const {alex,jamie,riley,seller,harbor,call,invoice}=await harness(t);
 await jamie.post('/api/profile/disconnect',{organization_id:seller});await call(alex,seller,'request',{invoice_id:invoice.id,share_profile:true,share_cash:true},403);
 const r=await call(alex,seller,'request',{invoice_id:invoice.id,share_profile:false,share_cash:false});await call(riley,harbor,'offer',{request_id:r.id,option:'standard'});const o=(await call(alex,seller,'state')).requests[0].offer;await call(alex,seller,'accept',{request_id:r.id,offer_id:o.record_id});await call(riley,harbor,'fund',{request_id:r.id});
 const q=await call(alex,seller,'payoff',{request_id:r.id,early:false});await call(alex,seller,'repay',{request_id:r.id,quote_id:q.id});await jamie.post('/api/member/revoke',{organization_id:seller});await call(riley,harbor,'close',{request_id:r.id},403);await alex.post('/api/workspace',{organization_id:seller},403);
 const state=(await call(riley,harbor,'state')).requests[0];assert.equal(state.repayment,null);assert.equal(state.advance.body.status,'funded');assert.equal(state.payment.settlement_started,true,'uncertain attempt is not represented as freely retryable money');
});
test('Financial Profile paginates and does not combine unsupported money with USD',{timeout:120000},async t=>{
 const store=await createPbpStore();t.after(()=>store.close());const passport=new Passport(store.audience),owner=await passport.createIdentity();const org=await passport.createCompany(owner,'Profile test'),lender=await passport.createCompany(owner,'Lender');
 const profile=await createFinancialProfileDemo(passport,owner,[{id:org,person:owner}],org);
 for(let n=0;n<104;n++){const id=crypto.randomUUID(),amount=n===101?'1.234':n===102?'-2.00':'1.00',currency=n===103?'USDC':'USD';await passport.client.act(owner,'record.append',lender,{record_id:id,root_id:id,supersedes:null,type:'finance.advance',subject_company_id:org,counterparty_ids:[lender],visibility:'counterparties',body:{advance_offer_id:crypto.randomUUID(),invoice_id:crypto.randomUUID(),seller_company_id:org,financer_company_id:lender,principal:{amount:'1.00',currency:'USD'},fee:{fee_bps:0,apr_bps:0,fixed_fee:{amount:'0.00',currency:'USD'}},funded_at:new Date().toISOString(),funding_event_id:crypto.randomUUID(),maturity_at:new Date(Date.now()+86400000).toISOString(),repaid_amount:{amount:'0.00',currency:'USD'},outstanding:{amount,currency},status:'funded'}});}
 const s=await profile.state(owner,org);assert.equal(s.obligations.length,104);const total=s.fields.find(f=>f.label==='Recorded financing obligations')!;assert.equal(total.status,'incomplete');assert.match(total.value,/\$101\.00 supported USD/);assert.match(total.value,/3 unsupported/);
});
