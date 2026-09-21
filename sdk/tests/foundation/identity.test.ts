import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, signIdentity, transitionIdentity, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { Transition, IdentityState } from '../../src/foundation/identity.ts';
const now=1_800_000_000_000;
async function fixture(){
  const [ordinary,recovery,resolver,next]=await Promise.all(Array.from({length:4},()=>generateKeyPair()));
  const genesis={nonce:crypto.randomUUID(),operational:{keys:[ordinary.keyId],threshold:1},recovery:{keys:[recovery.keyId],threshold:1}};
  const signed=await signIdentity('DTP-PERSON-GENESIS-1',genesis,[ordinary,recovery]);
  const locator={id:crypto.randomUUID(),key_id:resolver.keyId};
  const state=await createIdentity(signed,locator,now);
  const request={identity_id:state.head.identity_id,audience:'https://business.example',challenge:'a'.repeat(64)};
  const expected={...request,resolver_id:locator.id,resolver_key:resolver.keyId,resolver_epoch:0,minimum_sequence:0,minimum_digest:state.head_digest};
  return{ordinary,recovery,resolver,next,genesis,signed,locator,state,request,expected};
}
function change(state:IdentityState, nextKey:string, kind:Transition['kind']='rotate'):Transition{
  return{identity_id:state.head.identity_id,expected_digest:state.head_digest,sequence:state.head.sequence+1,kind,operational:{keys:[nextKey],threshold:1},recovery:state.head.recovery,issued_at:now,expires_at:now+300_000};
}
test('identity derives stable ID independent of resolver and release labels',async()=>{
  const f=await fixture();const other=await generateKeyPair();
  const restored=await createIdentity(f.signed,{id:crypto.randomUUID(),key_id:other.keyId},now);
  assert.equal(restored.head.identity_id,f.state.head.identity_id);assert.equal(restored.genesis_digest,f.state.genesis_digest);
  await assert.rejects(createIdentity({...f.signed,signatures:f.signed.signatures.slice(0,1)},f.locator,now),/possession/);
});
test('ordinary rotation preserves recovery and requires possession and old quorum',async()=>{
  const f=await fixture(),p=change(f.state,f.next.keyId);
  await assert.rejects(transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.ordinary]),now),/possession/);
  await assert.rejects(transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.next]),now),/quorum/);
  const next=await transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.ordinary,f.next]),now);
  assert.equal(next.head.identity_id,f.state.head.identity_id);assert.deepEqual(next.head.recovery,f.state.head.recovery);
  assert.deepEqual(next.retired_keys,[f.ordinary.keyId]);assert.equal(f.state.head.sequence,0);
});
test('recovery succeeds without ordinary keys and ordinary keys cannot replace recovery',async()=>{
  const f=await fixture();const p=change(f.state,f.next.keyId,'recover');
  const recovered=await transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.recovery,f.next]),now);
  assert.equal(recovered.head.sequence,1);
  const extra=await generateKeyPair(),tampered={...change(f.state,f.next.keyId),recovery:{keys:[extra.keyId],threshold:1}};
  await assert.rejects(transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',tampered,[f.ordinary,f.next,extra]),now),/cannot change recovery/);
});
test('resolution binds audience challenge resolver and expiry',async()=>{
  const f=await fixture(),{proof}=await issueResolution(f.state,f.request,f.resolver,now);
  assert.equal((await verifyResolution(proof,f.expected,now)).identity_id,f.state.head.identity_id);
  await assert.rejects(verifyResolution(proof,{...f.expected,audience:'https://other.example'},now),/context/);
  await assert.rejects(verifyResolution(proof,{...f.expected,challenge:'b'.repeat(64)},now),/context/);
  await assert.rejects(verifyResolution(proof,{...f.expected,resolver_key:f.next.keyId},now),/untrusted/);
  await assert.rejects(verifyResolution(proof,f.expected,now+LEASE_MS),/expired/);
});
test('rotation drains old leases before new authority can issue proofs',async()=>{
  const f=await fixture(),lease=await issueResolution(f.state,f.request,f.resolver,now);
  const p=change(lease.state,f.next.keyId);
  const moved=await transitionIdentity(lease.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.ordinary,f.next]),now+1);
  assert.equal(moved.head.effective_at,now+LEASE_MS+CLOCK_MARGIN_MS);
  await assert.rejects(issueResolution(moved,f.request,f.resolver,now+2),/barrier/);
  assert.equal((await verifyResolution(lease.proof,f.expected,now+2)).sequence,0,'old lease deliberately valid before effective barrier');
  const fresh=await issueResolution(moved,f.request,f.resolver,moved.head.effective_at);
  assert.equal((await verifyResolution(fresh.proof,{...f.expected,minimum_sequence:1,minimum_digest:moved.head_digest},moved.head.effective_at)).sequence,1);
});
test('stale transition, rollback proof and retired-key reinstatement rejected',async()=>{
  const f=await fixture(),lease=await issueResolution(f.state,f.request,f.resolver,now),p=change(f.state,f.next.keyId);
  const signed=await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.ordinary,f.next]);
  const moved=await transitionIdentity(f.state,signed,now);
  await assert.rejects(transitionIdentity(moved,signed,moved.head.effective_at),/stale/);
  await assert.rejects(verifyResolution(lease.proof,{...f.expected,minimum_sequence:1,minimum_digest:moved.head_digest},now),/rollback/);
  const restore=change(moved,f.ordinary.keyId);
  await assert.rejects(transitionIdentity(moved,await signIdentity('DTP-IDENTITY-TRANSITION-1',restore,[f.next,f.ordinary]),moved.head.effective_at),/retired/);
});
test('resolver keys cannot become personal recovery or operational authority',async()=>{
  const f=await fixture();
  await assert.rejects(createIdentity(f.signed,{...f.locator,key_id:f.ordinary.keyId},now),/cannot control/);
  const p=change(f.state,f.resolver.keyId);
  await assert.rejects(transitionIdentity(f.state,await signIdentity('DTP-IDENTITY-TRANSITION-1',p,[f.ordinary,f.resolver]),now),/cannot control/);
});
