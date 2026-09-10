import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual dependency-free presenter without a browser or DOM harness.
const source = readFileSync(new URL('../../modules/passport/demo/app.js',import.meta.url),'utf8');
const pure = source.split('// BEGIN BUSINESS RECORD PRESENTER:')[1].split('\n').slice(1).join('\n').split('// END BUSINESS RECORD PRESENTER')[0];
const present = runInNewContext(pure+'; businessRecord;') as (record:any, companies?:any[])=>{title:string;html:string};
const usd = (amount:string) => ({amount,currency:'USD'});
const companies = [{id:'acme',name:'Acme Sauce'},{id:'blue',name:'Bluestem Foods'}];
const order = {type:'trade.contract',record_id:'order-1',body:{buyer_po_number:'PO-1042',buyer_company_id:'acme',seller_company_id:'blue',status:'active',goods:{product_name:'Habanero sauce · 12-pack',quantity:{amount:'240',unit:'case'},packaging:'12x5oz glass',branded_details:{sku:'HAB-5'}},price_per_unit:usd('42'),total_value:usd('10080'),delivery:{destination:{line1:'400 Demo Dock',city:'Austin',region:'TX',postal_code:'78701',country:'US'},window:{earliest:'2026-09-08T12:00:00Z',latest:'2026-09-09T12:00:00Z'},method:'delivered',temperature_requirements:'ambient'},finance:{net_days:30,payment_timing:'delivery_attestation',financing_mode:'open_account'}}};

test('purchase order is a business document with folded raw source',()=>{
 const before = JSON.stringify(order), result = present(order,companies);
 assert.equal(result.title,'Purchase order · PO-1042');
 for(const value of ['Acme Sauce','Bluestem Foods','240 cases','$42.00','$10,080.00','400 Demo Dock','Net 30 days','Delivery attestation','Open account','HAB-5'])assert.ok(result.html.includes(value),value);
 assert.match(result.html,/<table/); assert.match(result.html,/<details class="document-source"><summary>/);
 assert.doesNotMatch(result.html,/<details[^>]*\bopen[\s>]/);
 assert.ok(result.html.indexOf('<table')<result.html.indexOf('<pre>'));
 assert.equal(JSON.stringify(order),before,'presenter cannot mutate signed data');
});
test('invoice shows cents, parties, dates, payment terms and partial payment',()=>{
 const invoice={type:'finance.invoice',body:{invoice_number:'INV-1021',seller_company_id:'acme',buyer_company_id:'blue',status:'partially_paid',issued_at:'2026-09-08T12:00:00Z',due_at:'2026-10-08T12:00:00Z',line_items:[{description:'Demo shipment',quantity:{amount:'1',unit:'unit'},unit_price:usd('123.45'),amount:usd('123.45')}],subtotal:usd('123.45'),total:usd('123.45'),paid_amount:usd('23.45'),payment_terms:{net_days:30}}};
 const result=present(invoice,companies);
 assert.equal(result.title,'Invoice · INV-1021');
 for(const value of ['Partially paid','$123.45','$23.45','Paid to date','Bill to','Sep 8, 2026','Oct 8, 2026','1 unit'])assert.ok(result.html.includes(value),value);
});
test('all external text and raw source are escaped; absent amounts are not zero',()=>{
 const hostile=structuredClone(order); hostile.body.goods.product_name='<img src=x onerror=alert(1)>'; hostile.body.delivery.destination.line1='</dd><script>bad()</script>';
 const result=present(hostile,[{id:'acme',name:'<script>company()</script>'}]);
 assert.doesNotMatch(result.html,/<script>|<img/); assert.match(result.html,/&lt;img/); assert.match(result.html,/&lt;script&gt;/);
 const sparse=present({type:'trade.contract',body:{buyer_company_id:'unknown',finance:{net_days:0}}});
 assert.match(sparse.html,/Company ID: unknown/); assert.match(sparse.html,/Not provided/); assert.match(sparse.html,/Due on receipt/);
 assert.doesNotMatch(sparse.html,/\$0\.00|NaN|Invalid Date|undefined/);
});
