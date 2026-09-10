import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassportWeb } from '../scripts/passport-web.ts';

test('Early Pay: distinct companies, scoped evidence and signed mock finance lifecycle',{timeout:120000},async t=>{
 const demo=await createPassportWeb(0);t.after(()=>demo.close());
 async function user(persona:string){
  const initial=await fetch(demo.origin+'/api/session'),cookie=initial.headers.get('set-cookie')!.split(';')[0],session=await initial.json();
  async function post(path:string,payload:any={},status=200){const response=await fetch(demo.origin+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-demo-csrf':session.csrf},body:JSON.stringify({demo_persona:persona,...payload})});const body=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(body)}`);assert.doesNotMatch(JSON.stringify(body),/"(?:secretKey|privateKey)"/);return body;}
  const home=await post('/api/login',{persona});return {post,home};
 }
 const alex=await user('alex'),riley=await user('riley'),jamie=await user('jamie'),sam=await user('sam');
 const seller=alex.home.companies.find((c:any)=>c.name==='Acme Sauce').id,lender=riley.home.companies[0].id;
 const call=(u:any,org:string,action:string,p:any={},status=200)=>u.post('/api/early/'+action,{organization_id:org,...p},status);
 assert.equal(riley.home.companies.length,1);assert.ok(!alex.home.companies.some((c:any)=>c.id===lender));
 await riley.post('/api/workspace',{organization_id:seller},403);
 await call(sam,seller,'state',{},403);
 assert.equal((await call(riley,lender,'state')).requests.length,0);
 const s=await call(alex,seller,'state'),invoice=s.invoices.find((i:any)=>i.eligible);
 assert.ok(invoice);
 await call(alex,seller,'request',{invoice_id:'wrong',share_cash:true,share_profile:true},400);
 const request=await call(alex,seller,'request',{invoice_id:invoice.id,share_cash:true,share_profile:true});
 assert.equal((await call(alex,seller,'request',{invoice_id:invoice.id,share_cash:true,share_profile:true})).id,request.id,'repeat request must not duplicate');
 await call(alex,seller,'request',{invoice_id:invoice.id,share_cash:false,share_profile:false},409);
 const shared=(await call(riley,lender,'state')).requests[0];
 assert.equal(shared.evidence.records.length,2);
 assert.ok(shared.evidence.records.every((r:any)=>r.subject_company_id===seller));
 assert.equal(shared.evidence.financial_profile.payload.simulation,true);
 assert.ok(shared.evidence.profile.some((p:any)=>p.status==='unknown'));
 assert.equal(shared.evidence.profile.some((p:any)=>p.label==='Credit score'&&typeof p.value==='number'),false);
 assert.equal((await riley.post('/api/workspace',{organization_id:lender})).records.length,0,'disclosure does not broaden ordinary record reads');
 await call(alex,seller,'offer',{request_id:request.id,option:'standard'},403);
 await call(riley,lender,'fund',{request_id:request.id},409);
 await call(riley,lender,'offer',{request_id:request.id,option:'standard'});
 await call(riley,lender,'offer',{request_id:request.id,option:'higher'},409);
 let item=(await call(alex,seller,'state')).requests[0];
 assert.equal(item.offer.body.status,'offered');
 await call(alex,seller,'accept',{request_id:request.id,offer_id:'wrong'},409);
 const acceptedId=item.offer.record_id;
 await call(alex,seller,'accept',{request_id:request.id,offer_id:acceptedId});
 await call(alex,seller,'accept',{request_id:request.id,offer_id:acceptedId});
 await call(alex,seller,'fund',{request_id:request.id},403);
 await call(riley,lender,'fund',{request_id:request.id});
 await call(riley,lender,'fund',{request_id:request.id});
 item=(await call(alex,seller,'state')).requests[0];
 assert.equal(item.advance.body.status,'funded');
 const fv=await riley.post('/api/workspace',{organization_id:lender});
 assert.equal(fv.records.filter((r:any)=>r.type==='finance.settlement_event').length,1);
 assert.equal(fv.records.find((r:any)=>r.type==='finance.settlement_event').body.rail,'mock');
 await jamie.post('/api/module/connect',{organization_id:seller,module:'books'});
 const books=await alex.post('/api/module/read',{organization_id:seller,module:'books'});
 assert.ok(books.records.some((r:any)=>r.type==='finance.advance'&&r.body.status==='funded'));
 await call(alex,seller,'revoke-sharing',{request_id:request.id});
 const revoked=(await call(riley,lender,'state')).requests[0];
 assert.equal(revoked.evidence,null);assert.equal(revoked.invoice_number,null);assert.equal(revoked.advance.body.status,'funded');
 const quote=await call(alex,seller,'payoff',{request_id:request.id,early:false});
 await call(alex,seller,'repay',{request_id:request.id,quote_id:quote.id});
 await call(alex,seller,'repay',{request_id:request.id,quote_id:quote.id});
 await call(riley,lender,'close',{request_id:request.id});
 item=(await call(alex,seller,'state')).requests[0];
 assert.equal(item.advance.body.status,'repaid');assert.equal(item.advance.body.outstanding.amount,'0.00');
 assert.equal(item.repayment.body.rail,'mock');
 const acme=await alex.post('/api/workspace',{organization_id:seller});
 assert.equal(acme.records.find((r:any)=>r.record_id===invoice.id).body.status,'issued','advance repayment is not buyer invoice payment');
});

test('Early Pay: withholding optional cash and withdrawing evidence',{timeout:120000},async t=>{
 const demo=await createPassportWeb(0);t.after(()=>demo.close());
 const response=await fetch(demo.origin+'/api/session'),session=await response.json(),cookie=response.headers.get('set-cookie')!.split(';')[0];let persona='alex';
 async function post(path:string,payload:any={},status=200){const r=await fetch(demo.origin+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-demo-csrf':session.csrf},body:JSON.stringify({demo_persona:persona,...payload})});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
 const home=await post('/api/login',{persona}),seller=home.companies.find((c:any)=>c.name==='Acme Sauce').id;
 const s=await post('/api/early/state',{organization_id:seller}),invoice=s.invoices.find((i:any)=>i.eligible);
 const req=await post('/api/early/request',{organization_id:seller,invoice_id:invoice.id,share_cash:false,share_profile:false});
 persona='riley';const rh=await post('/api/login',{persona}),lender=rh.companies[0].id;
 const shared=(await post('/api/early/state',{organization_id:lender})).requests[0];
 assert.equal(shared.evidence.financial_profile,null);assert.deepEqual(shared.evidence.profile,[]);
 persona='alex';await post('/api/login',{persona});await post('/api/early/withdraw',{organization_id:seller,request_id:req.id});
 persona='riley';await post('/api/login',{persona});await post('/api/early/offer',{organization_id:lender,request_id:req.id,option:'standard'},409);
 assert.equal((await post('/api/early/state',{organization_id:lender})).requests[0].evidence,null);
});
