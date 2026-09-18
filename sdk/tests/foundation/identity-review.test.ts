import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import { canonicalBytes, sha256Hex } from '../../src/canonical.ts';
import { createIdentity, signIdentity, transitionIdentity, issueResolution, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { Transition, IdentityState } from '../../src/foundation/identity.ts';

const now = 1_800_000_000_000;
async function fixture(at = now) {
  const [ordinary, recovery, resolver, replacement] = await Promise.all(Array.from({ length: 4 }, generateKeyPair));
  const genesis = { nonce: crypto.randomUUID(), operational: { keys: [ordinary.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 } };
  const signed = await signIdentity('DTP-PERSON-GENESIS-1', genesis, [ordinary, recovery]);
  const locator = { id: crypto.randomUUID(), key_id: resolver.keyId };
  const state = await createIdentity(signed, locator, at);
  const request = { identity_id: state.head.identity_id, audience: 'https://independent.test', challenge: 'b'.repeat(64) };
  const expected = { ...request, resolver_id: locator.id, resolver_key: resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: state.head_digest };
  return { ordinary, recovery, resolver, replacement, genesis, signed, locator, state, request, expected };
}
function transition(state: IdentityState, operational: string, kind: Transition['kind'] = 'rotate'): Transition {
  return { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: state.head.sequence + 1, kind,
    operational: { keys: [operational], threshold: 1 }, recovery: structuredClone(state.head.recovery), issued_at: now, expires_at: now + 300_000 };
}

test('independent identity review: wrong genesis domain, missing recovery possession and reused control keys reject', async () => {
  const f = await fixture();
  await assert.rejects(createIdentity(await signIdentity('DTP-IDENTITY-TRANSITION-1', f.genesis, [f.ordinary, f.recovery]), f.locator, now));
  await assert.rejects(createIdentity(await signIdentity('DTP-PERSON-GENESIS-1', f.genesis, [f.ordinary]), f.locator, now));
  const overlapping = { ...f.genesis, recovery: f.genesis.operational };
  await assert.rejects(createIdentity(await signIdentity('DTP-PERSON-GENESIS-1', overlapping, [f.ordinary]), f.locator, now));
});

test('independent identity review: recovery quorum and new key possession are both mandatory', async () => {
  const f = await fixture(), extra = await generateKeyPair();
  const genesis = { ...f.genesis, recovery: { keys: [f.recovery.keyId, extra.keyId], threshold: 2 } };
  const state = await createIdentity(await signIdentity('DTP-PERSON-GENESIS-1', genesis, [f.ordinary, f.recovery, extra]), f.locator, now);
  const p = transition(state, f.replacement.keyId, 'recover');
  await assert.rejects(transitionIdentity(state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.recovery, f.replacement]), now), /quorum/);
  await assert.rejects(transitionIdentity(state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.recovery, extra]), now), /possession/);
  const accepted = await transitionIdentity(state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.recovery, extra, f.replacement]), now);
  assert.deepEqual(accepted.head.operational.keys, [f.replacement.keyId]);
});

test('independent identity review: ordinary keys cannot change recovery policy and retired recovery keys cannot return', async () => {
  const f = await fixture();
  const p: Transition = { ...transition(f.state, f.ordinary.keyId, 'recovery-policy'), recovery: { keys: [f.replacement.keyId], threshold: 1 } };
  await assert.rejects(transitionIdentity(f.state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.ordinary, f.replacement]), now), /quorum/);
  const changed = await transitionIdentity(f.state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.recovery, f.replacement]), now);
  const restore = { ...transition(changed, f.ordinary.keyId, 'recovery-policy'), recovery: f.state.head.recovery };
  await assert.rejects(transitionIdentity(changed, await signIdentity('DTP-IDENTITY-TRANSITION-1', restore, [f.replacement, f.recovery]), changed.head.effective_at), /retired/);
});

test('independent identity review: all issued leases drain before recovered control becomes effective', async () => {
  const f = await fixture(), first = await issueResolution(f.state, f.request, f.resolver, now);
  const second = await issueResolution(first.state, { ...f.request, challenge: 'c'.repeat(64) }, f.resolver, now + 1000);
  const p = transition(second.state, f.replacement.keyId, 'recover');
  const recovered = await transitionIdentity(second.state, await signIdentity('DTP-IDENTITY-TRANSITION-1', p, [f.recovery, f.replacement]), now + 1001);
  assert.equal(recovered.head.effective_at, now + 1000 + LEASE_MS + CLOCK_MARGIN_MS);
  await assert.rejects(issueResolution(recovered, f.request, f.resolver, recovered.head.effective_at - 1), /barrier/);
  await assert.rejects(verifyResolution(second.proof, { ...f.expected, challenge: 'c'.repeat(64) }, recovered.head.effective_at), /expired/);
  const fresh = await issueResolution(recovered, f.request, f.resolver, recovered.head.effective_at);
  assert.equal((await verifyResolution(fresh.proof, { ...f.expected, minimum_sequence: 1, minimum_digest: recovered.head_digest }, recovered.head.effective_at)).sequence, 1);
});

test('independent identity review: resolver pin, epoch and equal-sequence digest checkpoints cannot be substituted', async () => {
  const f = await fixture(), issued = await issueResolution(f.state, f.request, f.resolver, now);
  await assert.rejects(verifyResolution(issued.proof, { ...f.expected, resolver_epoch: 1 }, now), /authority/);
  await assert.rejects(verifyResolution(issued.proof, { ...f.expected, minimum_digest: 'f'.repeat(64) }, now), /checkpoint/);
  const forged = await signIdentity('DTP-IDENTITY-RESOLUTION-1', issued.proof.body, [f.replacement]);
  await assert.rejects(verifyResolution(forged, f.expected, now), /untrusted/);
  await assert.rejects(verifyResolution(issued.proof, { ...f.expected, identity_id: crypto.randomUUID() }, now), /context/);
});

test('independent identity review: an issued lease must verify at its own supported clock boundary', async () => {
  const at = Number.MAX_SAFE_INTEGER - 300_000, f = await fixture(at);
  const issued = await issueResolution(f.state, f.request, f.resolver, at);
  assert.equal((await verifyResolution(issued.proof, f.expected, at)).identity_id, f.state.head.identity_id);
  assert.equal((await verifyResolution(issued.proof, f.expected, at + LEASE_MS - 1)).identity_id, f.state.head.identity_id,
    'verification must remain valid throughout the issued lease without needing headroom for new issuance');
});

test('independent identity review: a resolution control head enforces genesis versus successor predecessor shape', async () => {
  const f = await fixture(), issued = await issueResolution(f.state, f.request, f.resolver, now);
  for (const mutation of [{ sequence: 0, previous_digest: 'a'.repeat(64) }, { sequence: 1, previous_digest: null }, { sequence: 1, previous_digest: 'not-a-digest' }]) {
    const head = { ...issued.proof.body.head, ...mutation };
    const proof = await signIdentity('DTP-IDENTITY-RESOLUTION-1', { ...issued.proof.body, head, head_digest: await sha256Hex(canonicalBytes(head)) }, [f.resolver]);
    await assert.rejects(verifyResolution(proof, { ...f.expected, minimum_digest: null }, now), 'signed resolver data still must conform to the control contract');
  }
});

test('independent identity review: malformed nested control accessors reject without running before signature verification', async () => {
  const f = await fixture(), issued = await issueResolution(f.state, f.request, f.resolver, now);
  let calls = 0; const original = issued.proof.body.head.sequence;
  Object.defineProperty(issued.proof.body.head, 'sequence', { enumerable: true, get() { calls++; return original; } });
  await assert.rejects(verifyResolution(issued.proof, f.expected, now));
  assert.equal(calls, 0, 'closed shape validation must precede canonical access to malformed nested objects');
  const invalidDigest = await issueResolution(f.state, f.request, f.resolver, now);
  const nestedDigest: any = {}; Object.defineProperty(nestedDigest, 'hidden', { enumerable: true, get() { calls++; return 'not-a-digest'; } });
  invalidDigest.proof.body.head_digest = nestedDigest;
  await assert.rejects(verifyResolution(invalidDigest.proof, f.expected, now));
  assert.equal(calls, 0, 'head_digest must be validated as a digest string before canonicalization');
});

test('independent identity review: key and signature arrays are closed data arrays without executing accessors', async () => {
  const f = await fixture();
  let calls = 0;
  const keyAccessor = structuredClone(f.signed);
  Object.defineProperty(keyAccessor.body.operational.keys, '0', { enumerable: true, get() { calls++; return f.ordinary.keyId; } });
  await assert.rejects(createIdentity(keyAccessor, f.locator, now));
  assert.equal(calls, 0, 'key validation must inspect element descriptors before reading values');

  const signatureAccessor = structuredClone(f.signed), signature = signatureAccessor.signatures[0];
  Object.defineProperty(signatureAccessor.signatures, '0', { enumerable: true, get() { calls++; return signature; } });
  await assert.rejects(createIdentity(signatureAccessor, f.locator, now));
  assert.equal(calls, 0, 'signature iteration must reject accessor elements without invoking them');
});
