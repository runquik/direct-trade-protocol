/** Finite operation authority. Authenticated principals and measured usage are HOST inputs.
 * The returned next state must commit atomically with business effects and their outbox.
 * This module is not an authentication endpoint or a persistent transaction manager.
 */
import { canonicalize } from '../canonical.ts';
import { entityReferenceKey, parseEntityReference, externalIdentifierKey, parseExternalIdentifier } from './datatypes.ts';
import type { EntityReference, ExternalIdentifier } from './datatypes.ts';

export interface Limit { metric: ExternalIdentifier; amount: string }
export interface ApprovalRule { people: EntityReference[]; threshold: number; exclude_actor: boolean }
export interface OperationScope { organization_id: string; operations: string[]; profiles: string[]; resource_ids: string[] }
export interface CapabilityGrant {
  id: string; parent_id: string | null; subject: EntityReference; scope: OperationScope;
  not_before: number; expires_at: number; delegation_depth: number; limits: Limit[];
  approval: ApprovalRule | null;
}
export interface Governance { organization_id: string; controllers: EntityReference[]; threshold: number }
export interface GrantEntry { grant: CapabilityGrant; revoked: boolean; used: Limit[] }
export interface AuthorityState {
  revision: number; governance: Governance[]; grants: GrantEntry[];
  receipts: { operation_id: string; organization_id: string; intent_digest: string; plan_digest: string; actor: EntityReference }[];
}
/** Verified in the same host transaction; never accept these from an unauthenticated request. */
export interface PrincipalConsent { principal: EntityReference }
export interface ApprovalEvidence {
  person: EntityReference; organization_id: string; operation_id: string;
  intent_digest: string; plan_digest: string; grant_id: string; expires_at: number;
}
export interface ExecutionAuthority {
  actor: EntityReference; grant_id: string; scope: OperationScope;
  operation_id: string; intent_digest: string; plan_digest: string;
  usage: Limit[]; approvals: ApprovalEvidence[];
}
export class AuthorityError extends Error { constructor(message: string) { super(message); this.name = 'AuthorityError'; } }
function need(value: unknown, why: string): asserts value { if (!value) throw new AuthorityError(why); }
// Copy before use, refusing accessors rather than invoking them via structuredClone or JSON.stringify.
function copy<T>(value: T): T {
  let nodes = 0;
  const walk = (v: unknown, depth: number): any => {
    need(++nodes <= 65536 && depth <= 16, 'authority input complexity exceeded');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { need(Number.isSafeInteger(v), 'safe integer required'); return v; }
    if (typeof v === 'string') { need(v.length <= 4096, 'authority string too long'); canonicalize(v); return v; }
    need(v && typeof v === 'object', 'plain authority data required');
    const arr = Array.isArray(v), proto = Object.getPrototypeOf(v);
    need(arr ? proto === Array.prototype : proto === Object.prototype || proto === null, 'plain authority container required');
    const keys = Reflect.ownKeys(v); need(keys.length <= 4097, 'authority container too large');
    const result: any = arr ? [] : {};
    if (arr) need(keys.length === v.length + 1, 'dense closed authority array required');
    for (const key of keys) {
      if (arr && key === 'length') continue;
      need(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'invalid authority property');
      if (arr) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (v as unknown[]).length, 'dense authority array required');
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      need(descriptor && 'value' in descriptor && descriptor.enumerable, 'authority data fields required');
      result[key] = walk(descriptor.value, depth + 1);
    }
    return result;
  };
  const result = walk(value, 0); need(new TextEncoder().encode(canonicalize(result)).length <= 2 * 1024 * 1024, 'authority input too large'); return result;
}
function exact(value: any, keys: string[]) { need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k)), 'exact authority fields required'); }
function id(v: unknown) { need(typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v), 'UUID required'); }
function hash(v: unknown) { need(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), 'digest required'); }
function time(v: unknown) { need(Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= Number.MAX_SAFE_INTEGER - 1, 'invalid authority time'); }
function values<T>(v: T[], max: number, key: (v:T)=>string) { need(Array.isArray(v) && v.length<=max && new Set(v.map(key)).size===v.length, 'bounded unique values required'); }
function same(a: unknown,b: unknown) { return canonicalize(a)===canonicalize(b); }
function principal(v: EntityReference, kinds: string[] = ['person','organization','service']) { const p=parseEntityReference(v); need(kinds.includes(p.kind),'invalid principal kind'); return p; }
function amount(v: unknown): bigint { need(typeof v==='string' && /^(0|[1-9][0-9]{0,77})$/.test(v),'nonnegative bounded integral metric required'); return BigInt(v); }
function limits(v: Limit[]) { values(v,16,l=>externalIdentifierKey(l.metric)); for(const l of v){exact(l,['metric','amount']);parseExternalIdentifier(l.metric);amount(l.amount);} }
function scope(v:OperationScope) {
  exact(v,['organization_id','operations','profiles','resource_ids']);id(v.organization_id);
  values(v.operations,32,x=>x);need(v.operations.length>0,'operation required');
  for(const op of v.operations)need(typeof op==='string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(op) && op.length<=96,'invalid operation');
  values(v.profiles,32,x=>x);need(v.profiles.length>0,'profile required');v.profiles.forEach(hash);
  values(v.resource_ids,64,x=>x);need(v.resource_ids.length>0,'resource required');v.resource_ids.forEach(id);
}
function narrower(child:OperationScope,parent:OperationScope) {
  need(child.organization_id===parent.organization_id && child.operations.every(x=>parent.operations.includes(x)) && child.profiles.every(x=>parent.profiles.includes(x)) && child.resource_ids.every(x=>parent.resource_ids.includes(x)), 'scope widens authority');
}
function rule(r:ApprovalRule|null) {
  if(r===null)return;exact(r,['people','threshold','exclude_actor']);values(r.people,16,entityReferenceKey);r.people.forEach(p=>principal(p,['person']));
  need(Number.isSafeInteger(r.threshold) && r.threshold>=1 && r.threshold<=r.people.length && typeof r.exclude_actor==='boolean','invalid approval rule');
}
function grant(g:CapabilityGrant) {
  exact(g,['id','parent_id','subject','scope','not_before','expires_at','delegation_depth','limits','approval']);
  id(g.id);if(g.parent_id!==null)id(g.parent_id);principal(g.subject);scope(g.scope);time(g.not_before);time(g.expires_at);
  need(g.expires_at>g.not_before && Number.isSafeInteger(g.delegation_depth) && g.delegation_depth>=0 && g.delegation_depth<=4,'invalid grant lifetime/delegation');limits(g.limits);rule(g.approval);
}
function governance(g:Governance) {
  exact(g,['organization_id','controllers','threshold']);id(g.organization_id);values(g.controllers,16,entityReferenceKey);g.controllers.forEach(p=>principal(p,['person']));
  need(Number.isSafeInteger(g.threshold) && g.threshold>=1 && g.threshold<=g.controllers.length,'invalid controller quorum');
}
function nextRevision(state:AuthorityState) { need(Number.isSafeInteger(state.revision) && state.revision>=0 && state.revision<Number.MAX_SAFE_INTEGER,'authority revision exhausted');state.revision++; }
function entry(state:AuthorityState,id:string) { const e=state.grants.find(e=>e.grant.id===id);need(e,'grant unavailable');return e; }
function chain(state:AuthorityState,leaf:string,now:number):GrantEntry[] {
  time(now);const seen=new Set<string>(),result:GrantEntry[]=[];let id:string|null=leaf;
  while(id!==null){need(!seen.has(id)&&seen.size<5,'authority cycle or depth exceeded');seen.add(id);const e=entry(state,id);need(!e.revoked&&e.grant.not_before<=now&&now<e.grant.expires_at,'grant inactive');result.push(e);id=e.grant.parent_id;}
  return result;
}
function control(state:AuthorityState,subject:EntityReference,consents:PrincipalConsent[]) {
  values(consents,16,c=>entityReferenceKey(c.principal));for(const c of consents){exact(c,['principal']);principal(c.principal,['person','service']);}
  if(subject.kind==='organization') {
    const g=state.governance.find(g=>g.organization_id===subject.id);need(g,'organization control unavailable');
    need(g.controllers.filter(p=>consents.some(c=>same(p,c.principal))).length>=g.threshold,'controller quorum required');
  } else need(consents.some(c=>same(c.principal,subject)),'grant subject consent required');
}
/** Enrollment governance must already be verified by the identity/organization host. */
export function createAuthorityState(organizations:Governance[]):AuthorityState {
  const gs=copy(organizations);values(gs,1024,g=>g.organization_id);gs.forEach(governance);
  return {revision:0,governance:gs,grants:[],receipts:[]};
}
export function issueGrant(current:AuthorityState,input:CapabilityGrant,authenticated:PrincipalConsent[],now:number):AuthorityState {
  const state=copy(current),g=copy(input),consents=copy(authenticated);grant(g);time(now);need(state.grants.length<4096,'grant capacity exceeded');need(!state.grants.some(e=>e.grant.id===g.id),'grant ID already used');
  need(g.expires_at>now,'grant already expired');
  if(g.parent_id===null) control(state,{kind:'organization',id:g.scope.organization_id,organization_id:null},consents);
  else {
    const ancestors=chain(state,g.parent_id,now),parent=ancestors[0].grant;control(state,parent.subject,consents);
    need(parent.delegation_depth>0 && g.delegation_depth<parent.delegation_depth,'delegation not permitted');narrower(g.scope,parent.scope);
    need(g.not_before>=parent.not_before && g.expires_at<=parent.expires_at,'delegation extends lifetime');
    need(g.limits.length===parent.limits.length && g.limits.every(c=>parent.limits.some(p=>same(p.metric,c.metric)&&amount(c.amount)<=amount(p.amount))),'delegation widens metrics or budget');
  }
  state.grants.push({grant:g,revoked:false,used:g.limits.map(l=>({...l,amount:'0'}))});nextRevision(state);return state;
}
export function revokeGrant(current:AuthorityState,grantId:string,authenticated:PrincipalConsent[]):AuthorityState {
  const state=copy(current),consents=copy(authenticated);id(grantId);const e=entry(state,grantId);
  const parent=e.grant.parent_id===null?{kind:'organization' as const,id:e.grant.scope.organization_id,organization_id:null}:entry(state,e.grant.parent_id).grant.subject;
  // The original grantor or its organization's current controllers revoke. Child expiry does not block revocation.
  control(state,parent,consents);if(e.revoked)return state;e.revoked=true;nextRevision(state);return state;
}
/** Exact-plan approvals prevent reusing consent after a resource/quote revision changes. */
export function authorizeAndCharge(current:AuthorityState,input:ExecutionAuthority,now:number):{state:AuthorityState;replayed:boolean;chain:string[]} {
  const state=copy(current),i=copy(input);time(now);
  exact(i,['actor','grant_id','scope','operation_id','intent_digest','plan_digest','usage','approvals']);principal(i.actor,['person','service']);id(i.grant_id);id(i.operation_id);hash(i.intent_digest);hash(i.plan_digest);scope(i.scope);limits(i.usage);
  need(i.scope.operations.length===1,'one business operation per authorization');
  const ancestors=chain(state,i.grant_id,now);need(same(ancestors[0].grant.subject,i.actor),'actor is not grant subject');
  for(const e of ancestors)narrower(i.scope,e.grant.scope);
  const prior=state.receipts.find(r=>r.operation_id===i.operation_id&&r.organization_id===i.scope.organization_id);
  if(prior){need(prior.intent_digest===i.intent_digest&&prior.plan_digest===i.plan_digest&&same(prior.actor,i.actor),'operation ID conflict');return {state,replayed:true,chain:ancestors.map(e=>e.grant.id)};}
  values(i.approvals,64,a=>`${a.grant_id}:${entityReferenceKey(a.person)}`);
  for(const a of i.approvals){exact(a,['person','organization_id','operation_id','intent_digest','plan_digest','grant_id','expires_at']);principal(a.person,['person']);id(a.grant_id);id(a.organization_id);id(a.operation_id);hash(a.intent_digest);hash(a.plan_digest);time(a.expires_at);}
  for(const e of ancestors){
    const g=e.grant;narrower(i.scope,g.scope);
    need(i.usage.length===g.limits.length && i.usage.every(u=>g.limits.some(l=>same(l.metric,u.metric))),'unaccounted usage metric');
    for(const u of i.usage){const l=g.limits.find(l=>same(l.metric,u.metric))!,used=e.used.find(l=>same(l.metric,u.metric));need(used,'missing usage counter');need(amount(used.amount)+amount(u.amount)<=amount(l.amount),'cumulative grant budget exceeded');used.amount=(amount(used.amount)+amount(u.amount)).toString();}
    if(g.approval){const r=g.approval;const approvals=i.approvals.filter(a=>a.grant_id===g.id&&a.organization_id===i.scope.organization_id&&a.operation_id===i.operation_id&&a.intent_digest===i.intent_digest&&a.plan_digest===i.plan_digest&&a.expires_at>now&&(!r.exclude_actor||!same(a.person,i.actor))&&r.people.some(p=>same(p,a.person)));need(approvals.length>=r.threshold,'exact live approval quorum required');}
  }
  need(state.receipts.length<4096,'authority receipt capacity exceeded');state.receipts.push({operation_id:i.operation_id,organization_id:i.scope.organization_id,intent_digest:i.intent_digest,plan_digest:i.plan_digest,actor:i.actor});nextRevision(state);
  return {state,replayed:false,chain:ancestors.map(e=>e.grant.id)};
}
