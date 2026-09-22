/** Synthetic identity control primitives. Callers must persist CAS and lease issuance atomically. */
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { decodeKeyId, decodeSignature, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import type { KeyPair } from '../keys.ts';

export interface KeySet { keys: string[]; threshold: number }
export interface Genesis { nonce: string; operational: KeySet; recovery: KeySet }
export interface Signature { key_id: string; signature: string }
export interface Signed<T> { body: T; signatures: Signature[] }
export interface Control {
  identity_id: string; sequence: number; previous_digest: string | null;
  operational: KeySet; recovery: KeySet; effective_at: number;
}
export interface IdentityState {
  genesis_digest: string; head: Control; head_digest: string; retired_keys: string[];
  resolver_id: string; resolver_key: string; resolver_epoch: number;
  last_lease_expiry: number; last_update: number;
}
export interface Transition {
  identity_id: string; expected_digest: string; sequence: number; kind: 'rotate' | 'recover' | 'recovery-policy';
  operational: KeySet; recovery: KeySet; issued_at: number; expires_at: number;
}
/** Owner consent to a new resolver, or a new resolver key, signed by the recovery quorum alone. */
export interface Rehome {
  identity_id: string; expected_digest: string; sequence: number;
  from: { resolver_id: string; resolver_epoch: number };
  to: { resolver_id: string; resolver_key: string; audience: string; resolver_epoch: number };
  issued_at: number; expires_at: number;
}
export interface ResolutionRequest { identity_id: string; audience: string; challenge: string }
export interface Resolution extends ResolutionRequest {
  resolver_id: string; resolver_epoch: number; head: Control; head_digest: string; issued_at: number; expires_at: number;
}
export interface ResolverEnrollment {
  identity_id: string; genesis_digest: string; resolver_id: string; resolver_key: string;
  audience: string; nonce: string; issued_at: number; expires_at: number;
}
export const LEASE_MS = 30_000;
export const CLOCK_MARGIN_MS = 5_000;
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const digest = (v: unknown) => sha256Hex(canonicalBytes(v));
/** Detach ordinary data before async verification; rejects getters without invoking them. */
export function copyIdentityData<T>(value:T):T {
  let nodes=0;
  function visit(v:unknown,depth:number):any {
    need(++nodes<=16384 && depth<=16,'identity data complexity exceeded');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'){need(Number.isSafeInteger(v),'identity integer required');return v;}
    if(typeof v==='string'){need(v.length<=4096,'identity string too long');canonicalize(v);return v;}
    need(v&&typeof v==='object','identity data required');
    if(Array.isArray(v)){array(v,0,4096);return v.map(x=>visit(x,depth+1));}
    need([Object.prototype,null].includes(Object.getPrototypeOf(v)),'plain identity object required');
    const result:Record<string,unknown>={};const keys=Reflect.ownKeys(v);need(keys.length<=32,'identity object too large');
    for(const k of keys){need(typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k),'invalid identity field');const d=Object.getOwnPropertyDescriptor(v,k);need(d&&'value'in d&&d.enumerable,'identity data fields required');result[k]=visit(d.value,depth+1);}
    return result;
  }
  const output=visit(value,0);need(canonicalBytes(output).length<=1024*1024,'identity data too large');return output;
}
function object(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  need(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'plain closed object required');
  const keys = Reflect.ownKeys(value);
  need(keys.length === fields.length && keys.every(k => typeof k === 'string' && fields.includes(k)), 'exact identity fields required');
  for (const key of fields) { const d = Object.getOwnPropertyDescriptor(value, key); need(d && 'value' in d && d.enumerable, 'data fields required'); }
}
function timestamp(now: number) { need(Number.isSafeInteger(now) && now >= 0, 'invalid timestamp'); }
function clock(now: number) { timestamp(now); need(now <= Number.MAX_SAFE_INTEGER - 300_000, 'invalid clock'); }
function array(value: unknown, min: number, max: number): asserts value is unknown[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'plain array required');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  need(length && 'value' in length && length.value >= min && length.value <= max, 'bounded array required');
  need(Reflect.ownKeys(value).length === length.value + 1, 'closed dense array required');
  for (let i = 0; i < length.value; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    need(field && 'value' in field && field.enumerable, 'array data fields required');
  }
}
function key(key: string) { need(typeof key === 'string' && key.length <= 64, 'invalid key'); decodeKeyId(key); }
function keySet(value: KeySet) {
  object(value, ['keys', 'threshold']);
  array(value.keys, 1, 8);
  need(value.keys.every(k => typeof k === 'string'), '1-8 keys required');
  need(Object.keys(value.keys).length === value.keys.length && new Set(value.keys).size === value.keys.length, 'unique dense keys required');
  value.keys.forEach(key); need(Number.isSafeInteger(value.threshold) && value.threshold >= 1 && value.threshold <= value.keys.length, 'invalid quorum');
}
function sets(operational: KeySet, recovery: KeySet) { keySet(operational); keySet(recovery); need(!operational.keys.some(k => recovery.keys.includes(k)), 'operational and recovery keys must be separate'); }
async function verified<T>(signed: Signed<T>, domain: string) {
  object(signed, ['body', 'signatures']);
  array(signed.signatures, 1, 24);
  const bytes = canonicalBytes({domain, body:signed.body}); need(bytes.length <= 16_384, 'identity payload too large');
  const result = new Set<string>();
  for (const signature of signed.signatures) {
    object(signature, ['key_id', 'signature']); key(signature.key_id);
    need(typeof signature.signature === 'string' && signature.signature.length <= 128 && !result.has(signature.key_id), 'invalid duplicate signature');
    need(await verifyBytes(signature.key_id, bytes, decodeSignature(signature.signature)), 'invalid signature'); result.add(signature.key_id);
  }
  return result;
}
function quorum(keys: KeySet, signers: Set<string>) { need(keys.keys.filter(k => signers.has(k)).length >= keys.threshold, 'quorum required'); }
export async function signIdentity<T>(domain: 'DTP-PERSON-GENESIS-1' | 'DTP-IDENTITY-TRANSITION-1' | 'DTP-IDENTITY-RESOLUTION-1' | 'DTP-IDENTITY-ENROLLMENT-1' | 'DTP-IDENTITY-REHOME-1', body: T, keys: KeyPair[]): Promise<Signed<T>> {
  const copied = structuredClone(body), bytes = canonicalBytes({domain, body:copied});
  return {body:copied, signatures:await Promise.all(keys.map(async k => ({key_id:k.keyId,signature:encodeSignature(await signBytes(k.secretKey,bytes))})))};
}
/** Owner consent to a specific resolver, separate from host-independent genesis. */
export async function verifyResolverEnrollment(state: IdentityState, signed: Signed<ResolverEnrollment>, audience: string, now: number): Promise<void> {
  state=copyIdentityData(state);signed=copyIdentityData(signed);
  timestamp(now); object(signed,['body','signatures']);
  const b=signed.body;object(b,['identity_id','genesis_digest','resolver_id','resolver_key','audience','nonce','issued_at','expires_at']);
  need(state.head.sequence===0 && state.resolver_epoch===0,'initial enrollment requires genesis state');
  need(b.identity_id===state.head.identity_id && b.genesis_digest===state.genesis_digest && b.resolver_id===state.resolver_id && b.resolver_key===state.resolver_key && b.audience===audience,'enrollment resolver binding mismatch');
  request({identity_id:b.identity_id,audience:b.audience,challenge:b.nonce});timestamp(b.issued_at);timestamp(b.expires_at);
  need(b.issued_at<=now && b.expires_at>now && b.expires_at-b.issued_at<=300_000,'enrollment expired');
  const signers=await verified(signed,'DTP-IDENTITY-ENROLLMENT-1');quorum(state.head.operational,signers);quorum(state.head.recovery,signers);
}
export async function createIdentity(signed: Signed<Genesis>, resolver: {id:string; key_id:string}, now: number): Promise<IdentityState> {
  signed=copyIdentityData(signed);resolver=copyIdentityData(resolver);
  clock(now); object(signed, ['body','signatures']); object(signed.body, ['nonce','operational','recovery']); need(uuid(signed.body.nonce), 'invalid genesis nonce');
  object(resolver,['id','key_id']); need(uuid(resolver.id), 'invalid resolver id'); key(resolver.key_id);
  sets(signed.body.operational,signed.body.recovery);
  need(![...signed.body.operational.keys,...signed.body.recovery.keys].includes(resolver.key_id),'resolver key cannot control the person');
  const signers=await verified(signed,'DTP-PERSON-GENESIS-1');
  need([...signed.body.operational.keys,...signed.body.recovery.keys].every(k=>signers.has(k)), 'all genesis keys must prove possession');
  const genesis_digest=await digest({domain:'DTP-PERSON-GENESIS-1',body:signed.body});
  const identity_id=`${genesis_digest.slice(0,8)}-${genesis_digest.slice(8,12)}-${genesis_digest.slice(12,16)}-${genesis_digest.slice(16,20)}-${genesis_digest.slice(20,32)}`;
  const head:Control={identity_id,sequence:0,previous_digest:null,operational:structuredClone(signed.body.operational),recovery:structuredClone(signed.body.recovery),effective_at:now};
  return {genesis_digest,head,head_digest:await digest(head),retired_keys:[],resolver_id:resolver.id,resolver_key:resolver.key_id,resolver_epoch:0,last_lease_expiry:now,last_update:now};
}
export async function transitionIdentity(current: IdentityState, signed: Signed<Transition>, now:number): Promise<IdentityState> {
  current=copyIdentityData(current);signed=copyIdentityData(signed);
  clock(now); need(now>=current.last_update && now>=current.head.effective_at,'control transition barrier pending or clock regressed');
  object(signed, ['body','signatures']);
  const p=signed.body; object(p,['identity_id','expected_digest','sequence','kind','operational','recovery','issued_at','expires_at']);
  need(p.identity_id===current.head.identity_id && p.expected_digest===current.head_digest && p.sequence===current.head.sequence+1 && Number.isSafeInteger(p.sequence),'stale control head');
  need(['rotate','recover','recovery-policy'].includes(p.kind),'unsupported control transition');
  timestamp(p.issued_at); timestamp(p.expires_at);
  need(p.issued_at<=now && p.expires_at>now && p.expires_at>p.issued_at && p.expires_at-p.issued_at<=300_000,'transition expired or outside window');
  sets(p.operational,p.recovery);
  const signers=await verified(signed,'DTP-IDENTITY-TRANSITION-1');
  quorum(p.kind==='rotate'?current.head.operational:current.head.recovery,signers);
  if(p.kind==='rotate'||p.kind==='recover')need(canonicalize(p.recovery)===canonicalize(current.head.recovery),'ordinary transition cannot change recovery authority');
  else need(canonicalize(p.operational)===canonicalize(current.head.operational),'recovery-policy cannot change ordinary authority');
  const old=[...current.head.operational.keys,...current.head.recovery.keys], next=[...p.operational.keys,...p.recovery.keys];
  need(!next.includes(current.resolver_key),'resolver key cannot control the person');
  need(!next.some(k=>current.retired_keys.includes(k)),'retired key cannot be reinstated');
  need(next.filter(k=>!old.includes(k)).every(k=>signers.has(k)),'new key possession required');
  const retired=[...current.retired_keys,...old.filter(k=>!next.includes(k))]; need(retired.length<=4096,'identity key history capacity');
  const result=structuredClone(current);
  result.head={identity_id:p.identity_id,sequence:p.sequence,previous_digest:p.expected_digest,operational:structuredClone(p.operational),recovery:structuredClone(p.recovery),effective_at:Math.max(now,current.last_lease_expiry+CLOCK_MARGIN_MS)};
  result.head_digest=await digest(result.head);result.retired_keys=retired;result.last_update=now;return result;
}
function origin(audience:unknown) {
  need(typeof audience==='string' && audience.length<=2048,'invalid audience');
  const url=new URL(audience); need(url.origin===audience && ['http:','https:'].includes(url.protocol),'exact audience origin required');
}
function request(value:ResolutionRequest) {
  need(uuid(value.identity_id),'invalid identity');
  need(typeof value.challenge==='string' && /^[0-9a-f]{64}$/.test(value.challenge),'256-bit verifier challenge required');
  origin(value.audience);
}
/** Moves the identity to another resolver, or rotates the resolver key, without changing control. Recovery quorum only.
 * No lease drain: the key sets are unchanged, so old and new resolver vouch for identical control. The former resolver
 * may hold a lease this one never saw, so the state starts as if one were issued now; the first KEY change here waits
 * a full lease plus the margin. The head commits to the rehome document through previous_digest. */
export async function rehomeIdentity(current: IdentityState, signed: Signed<Rehome>, now: number): Promise<IdentityState> {
  current=copyIdentityData(current);signed=copyIdentityData(signed);
  clock(now); need(now>=current.last_update && now>=current.head.effective_at,'control transition barrier pending or clock regressed');
  object(signed, ['body','signatures']);
  const p=signed.body; object(p,['identity_id','expected_digest','sequence','from','to','issued_at','expires_at']);
  object(p.from,['resolver_id','resolver_epoch']); object(p.to,['resolver_id','resolver_key','audience','resolver_epoch']);
  need(p.identity_id===current.head.identity_id && p.expected_digest===current.head_digest && p.sequence===current.head.sequence+1 && Number.isSafeInteger(p.sequence),'stale control head');
  need(p.from.resolver_id===current.resolver_id && p.from.resolver_epoch===current.resolver_epoch,'rehome does not leave the current resolver');
  need(uuid(p.to.resolver_id) && Number.isSafeInteger(p.to.resolver_epoch) && p.to.resolver_epoch===current.resolver_epoch+1,'resolver epoch must advance by one');
  key(p.to.resolver_key); origin(p.to.audience);
  timestamp(p.issued_at); timestamp(p.expires_at);
  need(p.issued_at<=now && p.expires_at>now && p.expires_at>p.issued_at && p.expires_at-p.issued_at<=300_000,'rehome expired or outside window');
  need(![...current.head.operational.keys,...current.head.recovery.keys,...current.retired_keys].includes(p.to.resolver_key),'a key that controls the person cannot resolve it');
  const signers=await verified(signed,'DTP-IDENTITY-REHOME-1'); quorum(current.head.recovery,signers);
  const result=structuredClone(current);
  result.head={identity_id:p.identity_id,sequence:p.sequence,previous_digest:await digest({domain:'DTP-IDENTITY-REHOME-1',body:p}),operational:structuredClone(current.head.operational),recovery:structuredClone(current.head.recovery),effective_at:now};
  result.head_digest=await digest(result.head);
  result.resolver_id=p.to.resolver_id;result.resolver_key=p.to.resolver_key;result.resolver_epoch=p.to.resolver_epoch;
  result.last_lease_expiry=now+LEASE_MS;result.last_update=now;return result;
}
export async function issueResolution(current:IdentityState, input:ResolutionRequest, resolverKey:KeyPair, now:number):Promise<{state:IdentityState;proof:Signed<Resolution>}> {
  current=copyIdentityData(current);input=copyIdentityData(input);
  clock(now);object(input,['identity_id','audience','challenge']);request(input);
  need(input.identity_id===current.head.identity_id && resolverKey.keyId===current.resolver_key,'wrong identity or resolver');
  need(now>=current.last_update && now>=current.head.effective_at,'identity control barrier pending or clock regressed');
  const body:Resolution={...input,resolver_id:current.resolver_id,resolver_epoch:current.resolver_epoch,head:structuredClone(current.head),head_digest:current.head_digest,issued_at:now,expires_at:now+LEASE_MS};
  const state=structuredClone(current);state.last_lease_expiry=Math.max(state.last_lease_expiry,body.expires_at);state.last_update=now;
  return {state,proof:await signIdentity('DTP-IDENTITY-RESOLUTION-1',body,[resolverKey])};
}
/** Verifies one lease. Caller consumes challenge and checks expiry atomically with execution. */
export async function verifyResolution(proof:Signed<Resolution>, expected:ResolutionRequest & {resolver_id:string;resolver_key:string;resolver_epoch:number;minimum_sequence:number;minimum_digest:string|null}, now:number) {
  proof=copyIdentityData(proof);expected=copyIdentityData(expected);
  timestamp(now);request(expected);
  object(proof, ['body','signatures']);
  const b=proof.body;object(b,['identity_id','audience','challenge','resolver_id','resolver_epoch','head','head_digest','issued_at','expires_at']);
  need(b.identity_id===expected.identity_id && b.audience===expected.audience && b.challenge===expected.challenge,'resolution context mismatch');
  need(b.resolver_id===expected.resolver_id && b.resolver_epoch===expected.resolver_epoch,'resolver authority mismatch');
  timestamp(b.issued_at);timestamp(b.expires_at);
  need(b.issued_at<=now && b.expires_at>now && b.expires_at>b.issued_at && b.expires_at-b.issued_at<=LEASE_MS,'resolution lease expired');
  object(b.head,['identity_id','sequence','previous_digest','operational','recovery','effective_at']);
  sets(b.head.operational,b.head.recovery);timestamp(b.head.effective_at);
  need(b.head.identity_id===b.identity_id && Number.isSafeInteger(b.head.sequence) && b.head.sequence>=0 && b.head.effective_at<=b.issued_at,'invalid control head');
  need(b.head.sequence===0 ? b.head.previous_digest===null : typeof b.head.previous_digest==='string' && /^[0-9a-f]{64}$/.test(b.head.previous_digest), 'invalid predecessor');
  need(typeof b.head_digest==='string' && /^[0-9a-f]{64}$/.test(b.head_digest),'invalid control digest');
  const signers=await verified(proof,'DTP-IDENTITY-RESOLUTION-1');need(signers.size===1 && signers.has(expected.resolver_key),'untrusted resolver signature');
  need(await digest(b.head)===b.head_digest,'control digest mismatch');
  need(Number.isSafeInteger(expected.minimum_sequence) && expected.minimum_sequence>=0 && b.head.sequence>=expected.minimum_sequence,'control rollback');
  if(b.head.sequence===expected.minimum_sequence && expected.minimum_digest!==null)need(b.head_digest===expected.minimum_digest,'conflicting control checkpoint');
  return structuredClone(b.head);
}
