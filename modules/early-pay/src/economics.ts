import { demand } from '../../../sdk/src/v03/wire.ts';
export const cents=(v:string)=>{demand(typeof v==='string'&&/^\d+(\.\d{1,2})?$/.test(v),'invalid','Expected a nonnegative dollar amount',400);const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
export const dollars=(v:bigint)=>`${v/100n}.${String(v%100n).padStart(2,'0')}`;
export function price(total:string,advanceBps:number,feeBps:number,days:number){
 demand(Number.isInteger(advanceBps)&&advanceBps>=5000&&advanceBps<=9000&&Number.isInteger(feeBps)&&feeBps>=25&&feeBps<=300&&Number.isInteger(days)&&days>=7&&days<=60,'invalid','Terms must fit demo lender bounds: 50–90% advance, 0.25–3% fee, 7–60 days',400);
 const p=cents(total)*BigInt(advanceBps)/10000n,f=p*BigInt(feeBps)/10000n;
 demand(p>0n&&p<=100000000000n,'invalid','Advance must be positive and at most one billion USD in this demo',400);
 return {advanceBps,feeBps,term_days:days,principal:dollars(p),fee:dollars(f),repayment:dollars(p+f),annualized_percent:Number(f)/Number(p)*365/days*100};
}
export function payoff(principal:string,fee:string,funded:string,maturity:string,at:string,early:boolean){
 const start=Date.parse(funded),end=Date.parse(maturity),now=Date.parse(at);
 demand(Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(now)&&end>start&&now>=start,'invalid','Invalid financing dates',400);
 // Signed policy: proportional fee, one-day minimum, never more than original fee.
 const duration=end-start,elapsed=Math.min(duration,Math.max(86400000,now-start));
 const full=cents(fee),charged=early?(full*BigInt(Math.ceil(elapsed))+BigInt(duration)-1n)/BigInt(duration):full;
 const amount=cents(principal)+charged;
 return {amount:dollars(amount),fee:dollars(charged),waived_fee:dollars(full-charged),as_of:at,early,annualized_percent:now>start?Number(charged)/Number(cents(principal))*365*86400000/(now-start)*100:null};
}
