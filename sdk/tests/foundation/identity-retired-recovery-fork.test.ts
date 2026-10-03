// Regression test for red-team finding #50 (surface 2, identity and re-homing). It replaces the expected-observation
// (GAP) test that reproduced the takeover: that test now fails, and this one asserts the refusal.
//
// Fork-point rule (docs/foundation/identity-log.md, Epoch precedence): a branch outranks another on epoch only if the
// recovery quorum it forked under is still the current recovery quorum at the other history's head. A recovery key the
// owner retired with `recovery-policy` keeps the power to sign a valid branch from an older head, but that branch is a
// conflict, never superseding, and a relying party that cannot rule this out (it holds only a pin) fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, rehomeIdentity, signIdentity, transitionIdentity } from '../../src/foundation/identity.ts';
import type { IdentityState, Rehome, Transition } from '../../src/foundation/identity.ts';
import { attestHead, judgeIdentityLog, precedence, receiveIdentityLogPush, verifyIdentityLog, IDENTITY_LOG_FORMAT, IDENTITY_LOG_PUSH_FORMAT } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogEntry, ResolverPin } from '../../src/foundation/identity-log.ts';

const strict = { require_attestation: true };
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
interface Host { id: string; key: KeyPair; audience: string }
const host = async (name: string): Promise<Host> => ({ id: crypto.randomUUID(), key: await generateKeyPair(), audience: `https://${name}.example` });

/** A log under construction: the signed history plus the state it produces, each head attested by its epoch's resolver. */
async function append(entries: IdentityLogEntry[], state: IdentityState, resolver: Host, signed: Pick<IdentityLogEntry, 'transition' | 'rehome'>) {
  const attestation = await attestHead(state.head, { id: resolver.id, epoch: state.resolver_epoch }, resolver.key);
  return [...entries, { effective_at: state.head.effective_at, ...signed, attestation }];
}
async function transition(state: IdentityState, kind: Transition['kind'], operational: KeyPair, recovery: KeyPair, signers: KeyPair[], now: number) {
  const signed = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: state.head.sequence + 1, kind,
    operational: { keys: [operational.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 }, issued_at: now, expires_at: now + 300_000 }, signers);
  return { signed, next: await transitionIdentity(state, signed, now) };
}
async function rehome(state: IdentityState, to: Host, signers: KeyPair[], now: number) {
  const signed = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: state.head.sequence + 1,
    from: { resolver_id: state.resolver_id, resolver_epoch: state.resolver_epoch }, to: { resolver_id: to.id, resolver_key: to.key.keyId, audience: to.audience, resolver_epoch: state.resolver_epoch + 1 },
    issued_at: now, expires_at: now + 300_000 }, signers);
  return { signed, next: await rehomeIdentity(state, signed, now) };
}

test('a recovery key retired by recovery-policy forks from an older head and rehomes: conflict everywhere, never superseded', async () => {
  let now = 1_800_000_000_000;
  const [a, b, evil, evil2] = await Promise.all([host('host-a'), host('host-b'), host('thief-c'), host('thief-d')]);
  const [op0, rec0, rec1, thiefOp] = await Promise.all(Array.from({ length: 4 }, () => generateKeyPair()));

  // The owner enrolls at host A with operational op0 and recovery rec0.
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op0.keyId], threshold: 1 }, recovery: { keys: [rec0.keyId], threshold: 1 } }, [op0, rec0]);
  const s0 = await createIdentity(genesis, { id: a.id, key_id: a.key.keyId }, now), identity = s0.head.identity_id;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: identity, genesis_digest: s0.genesis_digest, resolver_id: a.id, resolver_key: a.key.keyId,
    audience: a.audience, nonce: hex(), issued_at: now, expires_at: now + 300_000 }, [op0, rec0]);
  const head0 = await append([], s0, a, { transition: null, rehome: null });
  const log = (entries: IdentityLogEntry[]): IdentityLog => ({ format: IDENTITY_LOG_FORMAT, genesis, enrollment, entries });
  const pinOf = (v: Awaited<ReturnType<typeof verifyIdentityLog>>): ResolverPin =>
    ({ identity_id: identity, resolver_id: v.resolver.id, resolver_key: v.resolver.key_id, resolver_epoch: v.resolver.epoch, minimum_sequence: v.head.sequence, minimum_digest: v.head_digest });

  // rec0 is exposed. recovery-policy, signed by the old recovery quorum, retires rec0 in favour of rec1.
  now += 60_000;
  const policy = await transition(s0, 'recovery-policy', op0, rec1, [rec0, rec1], now);
  assert.ok(policy.next.retired_keys.includes(rec0.keyId), 'rec0 is retired on the owner\'s history');
  let ownerEntries = await append(head0, policy.next, a, { transition: policy.signed, rehome: null });
  const ownerAtA = log(ownerEntries), owner = await verifyIdentityLog(ownerAtA, strict);
  const pinBefore = pinOf(await verifyIdentityLog(log(head0), strict)), pinAfter = pinOf(owner);

  // The owner moves to host B, signed by the current recovery quorum.
  now += 60_000;
  const ownerMove = await rehome(policy.next, b, [rec1], now);
  ownerEntries = await append(ownerEntries, ownerMove.next, b, { transition: null, rehome: ownerMove.signed });
  const ownerAtBLog = log(ownerEntries), ownerAtB = await verifyIdentityLog(ownerAtBLog, strict);
  assert.equal(ownerAtB.resolver.epoch, 1);
  // The fork-point rule leaves the owner's own move alone.
  assert.equal(precedence(ownerAtB, owner), 'a-extends-b');
  assert.equal((await judgeIdentityLog(pinAfter, ownerAtBLog, strict, ownerAtA)).outcome, 'advanced');

  // The thief holds only rec0. From head 0 it rehomes to a host it runs, rotates that host's key, and recovers.
  now += 60_000;
  const t1 = await rehome(s0, evil, [rec0], now);
  let thiefEntries = await append(head0, t1.next, evil, { transition: null, rehome: t1.signed });
  now += 1_000;
  const t2 = await rehome(t1.next, evil2, [rec0], now);
  thiefEntries = await append(thiefEntries, t2.next, evil2, { transition: null, rehome: t2.signed });
  now += 60_000;
  const t3 = await transition(t2.next, 'recover', thiefOp, rec0, [rec0, thiefOp], now);
  thiefEntries = await append(thiefEntries, t3.next, evil2, { transition: t3.signed, rehome: null });
  const thiefLog = log(thiefEntries), thief = await verifyIdentityLog(thiefLog, strict);

  // The branch is still a valid, owner-key-signed history on its own: the log verifier cannot know about the retirement.
  assert.equal(thief.identity_id, identity); assert.equal(thief.resolver.epoch, 2);

  // 1. Precedence: the retired quorum's branch is a conflict against both owner histories, in either order.
  assert.equal(precedence(thief, owner), 'conflict'); assert.equal(precedence(owner, thief), 'conflict');
  assert.equal(precedence(thief, ownerAtB), 'conflict'); assert.equal(precedence(ownerAtB, thief), 'conflict');

  // 2. A pin taken after the retirement: an unauthenticated push of the fork is refused as a conflict, whether the
  //    party holds its pinned history or only the pin, and the pin it holds is not replaced.
  for (const found of [pinAfter, { pin: pinAfter, log: ownerAtA }]) {
    const pushed = await receiveIdentityLogPush({ format: IDENTITY_LOG_PUSH_FORMAT, log: thiefLog }, async () => found, strict);
    assert.deepEqual([pushed.ack.outcome, pushed.ack.reason, pushed.ack.binding, pushed.admission], ['refused', 'conflict', null, null]);
  }
  assert.deepEqual(await judgeIdentityLog(pinAfter, thiefLog, strict, ownerAtA), { outcome: 'refused', reason: 'conflict', error: null });
  // A party that already followed the owner to B and holds that history refuses the fork the same way.
  assert.deepEqual(await judgeIdentityLog(pinOf(ownerAtB), thiefLog, strict, ownerAtBLog), { outcome: 'refused', reason: 'conflict', error: null });

  // 3. A pin taken before the retirement cannot see it: the fork extends what it holds, so it is admitted.
  const early = await judgeIdentityLog(pinBefore, thiefLog, strict);
  assert.equal(early.outcome, 'advanced');
  // When the owner's real history then arrives, the party holding the fork it admitted sees a conflict instead of
  // staying silently on the fork, by push and by admission alike.
  const onFork = pinOf(thief);
  assert.deepEqual(await judgeIdentityLog(onFork, ownerAtBLog, strict, thiefLog), { outcome: 'refused', reason: 'conflict', error: null });
  const ownerPush = await receiveIdentityLogPush({ format: IDENTITY_LOG_PUSH_FORMAT, log: ownerAtBLog }, async () => ({ pin: onFork, log: thiefLog }), strict);
  assert.deepEqual([ownerPush.ack.outcome, ownerPush.ack.reason], ['refused', 'conflict']);

  // 4. A pinned history that does not end at the pin is the caller's bug.
  await assert.rejects(judgeIdentityLog(pinAfter, thiefLog, strict, ownerAtBLog), /pinned history does not end at the pinned head/);
});
