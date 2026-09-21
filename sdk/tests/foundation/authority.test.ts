import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityState, issueGrant, revokeGrant, authorizeAndCharge } from '../../src/foundation/authority.ts';
import type { CapabilityGrant, ExecutionAuthority, ApprovalEvidence } from '../../src/foundation/authority.ts';
import type { EntityReference } from '../../src/foundation/datatypes.ts';
const uuid=()=>crypto.randomUUID(),person=():EntityReference=>({kind:'person',id:uuid(),organization_id:null}),now=1800000000000;
function fixture() {
  const client=uuid(),agency=uuid(),owner=person(),manager=person(),worker=person(),second=person(),approver=person();
  const resource=uuid(),profile='a'.repeat(64),metric={issuer:{kind:'organization' as const,id:client,organization_id:null},type:'usd.minor-units',value:'USD'};
  const scope={organization_id:client,operations:['trade.quote'],profiles:[profile],resource_ids:[resource]};
  let state=createAuthorityState([{organization_id:client,controllers:[owner],threshold:1},{organization_id:agency,controllers:[manager],threshold:1}]);
  const parent:CapabilityGrant={id:uuid(),parent_id:null,subject:{kind:'organization',id:agency,organization_id:null},scope,not_before:now,expires_at:now+60000,delegation_depth:2,limits:[{metric,amount:'10000'}],approval:null};
  state=issueGrant(state,parent,[{principal:owner}],now);
  const child:CapabilityGrant={...parent,id:uuid(),parent_id:parent.id,subject:worker,delegation_depth:1};
  state=issueGrant(state,child,[{principal:manager}],now);
  const intent:ExecutionAuthority={actor:worker,grant_id:child.id,scope,operation_id:uuid(),intent_digest:'b'.repeat(64),plan_digest:'c'.repeat(64),usage:[{metric,amount:'6000'}],approvals:[]};
  return {client,agency,owner,manager,worker,second,approver,resource,profile,metric,scope,parent,child,state,intent};
}
test('client mandate and agency workforce authority intersect without fake client membership',()=>{
  const f=fixture(),result=authorizeAndCharge(f.state,f.intent,now);
  assert.equal(result.state.grants.find(g=>g.grant.id===f.parent.id)!.used[0].amount,'6000');
  assert.deepEqual(result.chain,[f.child.id,f.parent.id]);assert.equal(f.state.grants[0].used[0].amount,'0');
  assert.throws(()=>authorizeAndCharge(f.state,{...f.intent,actor:f.manager},now),/subject/);
  assert.throws(()=>authorizeAndCharge(f.state,{...f.intent,scope:{...f.scope,operations:['trade.accept']}},now),/scope/);
  assert.throws(()=>authorizeAndCharge(f.state,{...f.intent,scope:{...f.scope,organization_id:f.agency}},now),/scope/);
});
test('mandate and staff revocation independently block new work',()=>{
  const f=fixture();
  const parentRevoked=revokeGrant(f.state,f.parent.id,[{principal:f.owner}]);
  const childRevoked=revokeGrant(f.state,f.child.id,[{principal:f.manager}]);
  assert.throws(()=>authorizeAndCharge(parentRevoked,f.intent,now),/inactive/);
  assert.throws(()=>authorizeAndCharge(childRevoked,f.intent,now),/inactive/);
  assert.throws(()=>revokeGrant(f.state,f.parent.id,[{principal:f.manager}]),/quorum/);
});
test('sibling grants share parent cumulative budget and duplicate retry charges once',()=>{
  const f=fixture(),other={...f.child,id:uuid(),subject:f.second};
  let state=issueGrant(f.state,other,[{principal:f.manager}],now);
  state=authorizeAndCharge(state,f.intent,now).state;
  const retry=authorizeAndCharge(state,f.intent,now);assert.equal(retry.replayed,true);assert.deepEqual(retry.state,state);
  assert.throws(()=>authorizeAndCharge(state,{...f.intent,operation_id:uuid(),actor:f.second,grant_id:other.id},now),/cumulative/);
  assert.throws(()=>authorizeAndCharge(state,{...f.intent,plan_digest:'d'.repeat(64)},now),/conflict/);
});
test('delegation cannot widen operation resource profile duration depth or metrics',()=>{
  const f=fixture(),child={...f.child,id:uuid(),parent_id:f.child.id,subject:f.second,delegation_depth:0};
  assert.doesNotThrow(()=>issueGrant(f.state,child,[{principal:f.worker}],now));
  for(const change of [
    {scope:{...f.scope,operations:['trade.accept']}},
    {scope:{...f.scope,resource_ids:[uuid()]}},
    {scope:{...f.scope,profiles:['d'.repeat(64)]}},
    {expires_at:f.parent.expires_at+1},{delegation_depth:1},
    {limits:[{metric:f.metric,amount:'10001'}]},{limits:[]}
  ])assert.throws(()=>issueGrant(f.state,{...child,...change},[{principal:f.worker}],now));
});
test('parent and child approvals survive narrowing and bind exact plan and distinct people',()=>{
  const f=fixture();let state=createAuthorityState(f.state.governance);
  const parent={...f.parent,approval:{people:[f.worker,f.approver],threshold:1,exclude_actor:true}};
  state=issueGrant(state,parent,[{principal:f.owner}],now);state=issueGrant(state,f.child,[{principal:f.manager}],now);
  const approval:ApprovalEvidence={person:f.approver,organization_id:f.client,operation_id:f.intent.operation_id,intent_digest:f.intent.intent_digest,plan_digest:f.intent.plan_digest,grant_id:f.parent.id,expires_at:now+1000};
  assert.throws(()=>authorizeAndCharge(state,f.intent,now),/approval/);
  assert.throws(()=>authorizeAndCharge(state,{...f.intent,approvals:[{...approval,person:f.worker}]},now),/approval/);
  for(const bad of [{expires_at:now},{plan_digest:'e'.repeat(64)},{organization_id:f.agency},{grant_id:f.child.id},{intent_digest:'e'.repeat(64)}]){
    assert.throws(()=>authorizeAndCharge(state,{...f.intent,approvals:[{...approval,...bad}]},now),/approval/);
  }
  assert.doesNotThrow(()=>authorizeAndCharge(state,{...f.intent,approvals:[approval]},now));
  assert.throws(()=>authorizeAndCharge(state,{...f.intent,approvals:[approval,approval]},now),/unique/);
});
test('exact metrics cannot be omitted replaced or sent as floats negative or exponent strings',()=>{
  const f=fixture();
  for(const usage of [[],[{metric:f.metric,amount:'-1'}],[{metric:f.metric,amount:'1e3'}],[{metric:f.metric,amount:'1.2'}],[{metric:{...f.metric,value:'OTHER'},amount:'1'}]])
    assert.throws(()=>authorizeAndCharge(f.state,{...f.intent,usage},now));
  assert.throws(()=>authorizeAndCharge(f.state,f.intent,f.parent.expires_at),/inactive/);
});
test('controller quorums count distinct people and explicit service principals work',()=>{
  const f=fixture();const state=createAuthorityState([{organization_id:f.client,controllers:[f.owner,f.second],threshold:2}]);
  assert.throws(()=>issueGrant(state,f.parent,[{principal:f.owner}],now),/quorum/);
  assert.throws(()=>issueGrant(state,f.parent,[{principal:f.owner},{principal:f.owner}],now),/unique/);
  const service:EntityReference={kind:'service',id:uuid(),organization_id:f.client};
  const g={...f.parent,subject:service};const granted=issueGrant(state,g,[{principal:f.owner},{principal:f.second}],now);
  assert.doesNotThrow(()=>authorizeAndCharge(granted,{...f.intent,actor:service,grant_id:g.id},now));
});
test('authority object getters are rejected without execution and failures leave input intact',()=>{
  const f=fixture();let ran=0;const bad={...f.intent};Object.defineProperty(bad,'usage',{enumerable:true,get(){ran++;return [];}});
  assert.throws(()=>authorizeAndCharge(f.state,bad,now),/data fields/);assert.equal(ran,0);
  const before=JSON.stringify(f.state);assert.throws(()=>authorizeAndCharge(f.state,{...f.intent,usage:[{metric:f.metric,amount:'10001'}]},now));assert.equal(JSON.stringify(f.state),before);
});
