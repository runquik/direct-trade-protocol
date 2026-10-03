// Expected-observation (GAP) test: a passing test reproduces a deficiency; it does not endorse it.
// Red-team finding, surface 2 (identity and re-homing). When this gap is closed, this test must fail and be
// replaced by one asserting the refusal; it must not be weakened to stay green.
//
// GAP: a recovery key the owner retired with `recovery-policy` keeps the power to sign a rehome from any head
// at which it was still the recovery quorum. Epoch precedence ranks histories by epoch alone, wherever they fork,
// so that stale branch supersedes the owner's current history at a relying party, and the retired key can raise
// its branch's epoch without limit, so the owner cannot out-rehome it.
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

test('GAP: a recovery key retired by recovery-policy forks from an older head, rehomes, and supersedes the owner at a relying party', async () => {
  let now = 1_800_000_000_000;
  const [a, b, evil, evil2] = await Promise.all([host('host-a'), host('host-b'), host('thief-c'), host('thief-d')]);
  const [op0, rec0, rec1, thiefOp] = await Promise.all(Array.from({ length: 4 }, () => generateKeyPair()));

  // The owner enrolls at host A with operational op0 and recovery rec0.
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op0.keyId], threshold: 1 }, recovery: { keys: [rec0.keyId], threshold: 1 } }, [op0, rec0]);
  const s0 = await createIdentity(genesis, { id: a.id, key_id: a.key.keyId }, now), identity = s0.head.identity_id;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: identity, genesis_digest: s0.genesis_digest, resolver_id: a.id, resolver_key: a.key.keyId,
    audience: a.audience, nonce: hex(), issued_at: now, expires_at: now + 300_000 }, [op0, rec0]);
  const head0 = await append([], s0, a, { transition: null, rehome: null });

  // rec0 is exposed (a lost backup, a decommissioned device). The owner does what the contract offers:
  // recovery-policy, signed by the old recovery quorum, retires rec0 in favour of rec1.
  now += 60_000;
  const policy = await transition(s0, 'recovery-policy', op0, rec1, [rec0, rec1], now);
  assert.ok(policy.next.retired_keys.includes(rec0.keyId), 'rec0 is retired on the owner\'s history');
  let ownerEntries = await append(head0, policy.next, a, { transition: policy.signed, rehome: null });
  const ownerAtA: IdentityLog = { format: IDENTITY_LOG_FORMAT, genesis, enrollment, entries: ownerEntries };

  // A relying party has followed the owner to sequence 1 at A.
  const owner = await verifyIdentityLog(ownerAtA, strict);
  const pin: ResolverPin = { identity_id: identity, resolver_id: a.id, resolver_key: a.key.keyId, resolver_epoch: 0, minimum_sequence: 1, minimum_digest: owner.head_digest };

  // The owner even moves to host B, which is the documented remedy for a fork (identity-rehoming-proposal 4.6).
  now += 60_000;
  const ownerMove = await rehome(policy.next, b, [rec1], now);
  ownerEntries = await append(ownerEntries, ownerMove.next, b, { transition: null, rehome: ownerMove.signed });
  const ownerAtB = await verifyIdentityLog({ format: IDENTITY_LOG_FORMAT, genesis, enrollment, entries: ownerEntries }, strict);
  assert.equal(ownerAtB.resolver.epoch, 1);

  // The thief holds only rec0, retired at sequence 1. Head 0 and A's attestation of it are public (any exported log).
  // From head 0, where rec0 was still the recovery quorum, the thief rehomes to a host it runs, rotates that host's
  // key (a second rehome: the epoch is the thief's to raise), and recovers the operational keys to its own.
  now += 60_000;
  const t1 = await rehome(s0, evil, [rec0], now);
  let thiefEntries = await append(head0, t1.next, evil, { transition: null, rehome: t1.signed });
  now += 1_000;
  const t2 = await rehome(t1.next, evil2, [rec0], now);
  thiefEntries = await append(thiefEntries, t2.next, evil2, { transition: null, rehome: t2.signed });
  now += 60_000;
  const t3 = await transition(t2.next, 'recover', thiefOp, rec0, [rec0, thiefOp], now);
  thiefEntries = await append(thiefEntries, t3.next, evil2, { transition: t3.signed, rehome: null });
  const thiefLog: IdentityLog = { format: IDENTITY_LOG_FORMAT, genesis, enrollment, entries: thiefEntries };
  const thief = await verifyIdentityLog(thiefLog, strict);

  // Observation 1: the stale branch verifies under the strict policy and is the same identity.
  assert.equal(thief.identity_id, identity);
  assert.deepEqual(thief.head.operational.keys, [thiefOp.keyId]);
  assert.equal(thief.resolver.epoch, 2);

  // Observation 2: epoch precedence ranks the thief's branch above both owner histories.
  assert.equal(precedence(thief, owner), 'a-supersedes-b');
  assert.equal(precedence(thief, ownerAtB), 'a-supersedes-b');

  // Observation 3: an unauthenticated owner push of the thief's log moves the relying party's pin to the thief's host.
  const pushed = await receiveIdentityLogPush({ format: IDENTITY_LOG_PUSH_FORMAT, log: thiefLog }, async () => pin, strict);
  assert.equal(pushed.ack.outcome, 'superseded');
  assert.deepEqual(pushed.ack.binding, { resolver_id: evil2.id, resolver_epoch: 2, sequence: 3, head_digest: thief.head_digest });

  // Observation 4: having admitted that, the relying party refuses the owner's real move to B. The owner cannot recover.
  const after = pushed.admission!.pin;
  const ownerRetry = await judgeIdentityLog(after, { format: IDENTITY_LOG_FORMAT, genesis, enrollment, entries: ownerEntries }, strict);
  assert.equal(ownerRetry.outcome, 'refused');
});
