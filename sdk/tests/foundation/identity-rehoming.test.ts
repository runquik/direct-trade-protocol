import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, rehomeIdentity, signIdentity, transitionIdentity, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { IdentityState, Rehome, Signed, Transition } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';
import { admitIdentityLog, attestHead, buildIdentityLog, precedence, verifyIdentityLog } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, ResolverPin } from '../../src/foundation/identity-log.ts';

const strict = { require_attestation: true }, lenient = { require_attestation: false };
const hex = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
/** Two independent hosts sharing nothing but a test clock, and an owner who keeps their own copies of the log. */
async function world() {
  let now = 1_800_000_000_000; const clock = { now: () => now, advance: (ms: number) => { now += ms; return now; } };
  async function host(name: string) {
    const pg = new PGlite(); await pg.exec(IDENTITY_REGISTRY_SCHEMA); const db = pgliteDb(pg), key = await generateKeyPair();
    const config = { id: crypto.randomUUID(), audience: `https://${name}.example`, key, now: clock.now };
    return { pg, db, key, config, registry: createIdentityRegistry(db, config), meta: { resolver_id: config.id, resolver_key: key.keyId, audience: config.audience } };
  }
  const a = await host('host-a'), b = await host('host-b');
  const [op0, rec0, rec1, op1, thief] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPair()));
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op0.keyId], threshold: 1 }, recovery: { keys: [rec0.keyId], threshold: 1 } }, [op0, rec0]);
  const initial = await createIdentity(genesis, { id: a.config.id, key_id: a.key.keyId }, now), identity = initial.head.identity_id;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: identity, genesis_digest: initial.genesis_digest, resolver_id: a.config.id, resolver_key: a.key.keyId,
    audience: a.config.audience, nonce: hex(), issued_at: now, expires_at: now + 300_000 }, [op0, rec0]);
  clock.advance(1_500);
  await a.registry.enroll(genesis, enrollment);
  /** A client building a transition the way a real one must: from the resolver's own proof of the current head. */
  async function change(h: typeof a, kind: Transition['kind'], operational: KeyPair, recovery: KeyPair, signers: KeyPair[]) {
    const request = { identity_id: identity, audience: 'https://relying.example', challenge: hex() }, proof = await h.registry.resolve(request);
    const head = await verifyResolution(proof, { ...request, resolver_id: h.config.id, resolver_key: h.key.keyId, resolver_epoch: proof.body.resolver_epoch, minimum_sequence: 0, minimum_digest: null }, now);
    clock.advance(700);
    const body: Transition = { identity_id: identity, expected_digest: proof.body.head_digest, sequence: head.sequence + 1, kind, operational: { keys: [operational.keyId], threshold: 1 },
      recovery: { keys: [recovery.keyId], threshold: 1 }, issued_at: now, expires_at: now + 300_000 };
    const accepted = await h.registry.transition(identity, await signIdentity('DTP-IDENTITY-TRANSITION-1', body, signers));
    now = Math.max(now, accepted.effective_at); return accepted;
  }
  const resolve = async (h: typeof a) => { const request = { identity_id: identity, audience: 'https://relying.example', challenge: hex() }; return { request, proof: await h.registry.resolve(request) }; };
  return { clock, a, b, op0, rec0, rec1, op1, thief, genesis, enrollment, identity, change, resolve, close: async () => { await a.pg.close(); await b.pg.close(); } };
}
/** A relying party: a durable pin, and verification of resolutions against it. */
function relyingParty(pin: ResolverPin) {
  return {
    get pin() { return pin; },
    async accept(r: { request: { identity_id: string; audience: string; challenge: string }; proof: any }, now: number) {
      const head = await verifyResolution(r.proof, { ...r.request, resolver_id: pin.resolver_id, resolver_key: pin.resolver_key, resolver_epoch: pin.resolver_epoch, minimum_sequence: pin.minimum_sequence, minimum_digest: pin.minimum_digest }, now);
      pin = { ...pin, minimum_sequence: head.sequence, minimum_digest: r.proof.body.head_digest }; return head;
    },
    async admit(log: IdentityLog) { const result = await admitIdentityLog(pin, log, strict); pin = result.pin; return result; },
  };
}

test('exit test: an identity leaves a hostile host using only the recovery key and the exported log; a pinned verifier follows it and refuses the old host', async () => {
  const w = await world(); try {
    // 1. Created at host A. 2. Recovery authority handed to a key whose private half never reaches A or B.
    const policy = await w.change(w.a, 'recovery-policy', w.op0, w.rec1, [w.rec0, w.rec1]);
    assert.equal(policy.sequence, 1);
    const exported = await w.a.registry.exportLog(w.identity);
    assert.deepEqual((await verifyIdentityLog(exported, strict)).unattested, []);
    // 3. A relying party pins (A, epoch 0) and accepts a resolution from A.
    const rp = relyingParty({ resolver_id: w.a.config.id, resolver_key: w.a.key.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: null });
    assert.equal((await rp.accept(await w.resolve(w.a), w.clock.now())).sequence, 1);
    // 4. A turns hostile: no transitions, no exports, but it keeps vouching for the identity it has.
    const hostile = { resolve: (r: any) => w.a.registry.resolve(r), transition: async () => { throw new Error('unavailable'); }, exportLog: async () => { throw new Error('unavailable'); } };
    await assert.rejects(hostile.exportLog());
    // 5. Only the recovery key and the copy of the log the owner kept. B adopts.
    const current = await verifyIdentityLog(exported, lenient), at = w.clock.advance(60_000);
    const rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: w.identity, expected_digest: current.head_digest, sequence: current.head.sequence + 1,
      from: { resolver_id: w.a.config.id, resolver_epoch: 0 }, to: { ...w.b.meta, resolver_epoch: 1 }, issued_at: at, expires_at: at + 300_000 }, [w.rec1]);
    const adopted = await w.b.registry.adopt(exported, rehome);
    assert.deepEqual([adopted.sequence, adopted.resolver_epoch, adopted.effective_at], [2, 1, at]);
    assert.deepEqual(await w.b.registry.adopt(exported, rehome), adopted, 'exact replay acknowledges');
    // 6. Operational keys replaced at B. B never saw A's leases, so the first key change waits a full lease plus the margin.
    const recovered = await w.change(w.b, 'recover', w.op1, w.rec1, [w.rec1, w.op1]);
    assert.equal(recovered.effective_at, at + LEASE_MS + CLOCK_MARGIN_MS);
    // 7. The relying party is shown B's log, admits the move, accepts B, and refuses a fresh, correctly signed resolution from A.
    const moved = await w.b.registry.exportLog(w.identity), verified = await verifyIdentityLog(moved, strict);
    assert.deepEqual(verified.resolvers.map(r => [r.epoch, r.id]), [[0, w.a.config.id], [1, w.b.config.id]]);
    assert.deepEqual(verified.unattested, [], 'A attested its epoch before turning hostile; B attests its own');
    const admission = await rp.admit(moved);
    assert.equal(admission.outcome, 'advanced'); assert.deepEqual([rp.pin.resolver_id, rp.pin.resolver_epoch, rp.pin.minimum_sequence], [w.b.config.id, 1, 3]);
    assert.equal((await rp.accept(await w.resolve(w.b), w.clock.now())).sequence, 3);
    const stale = await w.resolve(w.a); assert.equal(stale.proof.body.resolver_epoch, 0);
    await assert.rejects(rp.accept(stale, w.clock.now()), /resolver authority mismatch/);
    // 8. A thief with the old operational key forks at A; A vouches for it. Epoch precedence decides, and an operational-signed rehome is refused everywhere.
    const fork = await w.change(w.a, 'rotate', w.thief, w.rec1, [w.op0, w.thief]);
    assert.equal(fork.sequence, 2, 'A accepted a rival successor of the same head');
    const thiefLog = await verifyIdentityLog(await w.a.registry.exportLog(w.identity), strict);
    assert.equal(precedence(verified, thiefLog), 'a-supersedes-b'); assert.equal(precedence(thiefLog, verified), 'b-supersedes-a');
    await assert.rejects(rp.admit(await w.a.registry.exportLog(w.identity)), /conflicting|does not continue/, 'the pinned verifier does not go back');
    const rival = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { ...rehome.body, to: { ...rehome.body.to, resolver_id: crypto.randomUUID() } }, [w.op0]);
    await assert.rejects(w.b.registry.adopt(exported, rival), /quorum/);
    // 9. The identity id never changed.
    assert.equal(verified.identity_id, w.identity); assert.equal(thiefLog.identity_id, w.identity); assert.equal(adopted.identity_id, w.identity);
  } finally { await w.close(); }
});

test('cooperative move: the old host records the rehome, stops resolving, and serves the log as a forwarding address', async () => {
  const w = await world(); try {
    await w.change(w.a, 'rotate', w.op1, w.rec0, [w.op0, w.op1]);
    const exported = await w.a.registry.exportLog(w.identity), current = await verifyIdentityLog(exported, strict), at = w.clock.advance(10_000);
    const rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: w.identity, expected_digest: current.head_digest, sequence: 2, from: { resolver_id: w.a.config.id, resolver_epoch: 0 },
      to: { ...w.b.meta, resolver_epoch: 1 }, issued_at: at, expires_at: at + 300_000 }, [w.rec0]);
    await w.b.registry.adopt(exported, rehome);
    const moved = await w.b.registry.exportLog(w.identity), release = await w.a.registry.transfer(moved);
    assert.deepEqual([release.sequence, release.resolver_epoch], [2, 1]); assert.deepEqual(await w.a.registry.transfer(moved), release, 'replay acknowledges');
    await assert.rejects(w.a.registry.resolve({ identity_id: w.identity, audience: 'https://relying.example', challenge: hex() }), /transferred/);
    const forwarded = await verifyIdentityLog(await w.a.registry.exportLog(w.identity), strict), latest = await verifyIdentityLog(moved, strict);
    assert.equal(forwarded.resolver.id, w.b.config.id); assert.equal(precedence(forwarded, latest), 'equal');
    // B advances; A's copy is now a strict prefix and still verifies as one.
    await w.change(w.b, 'rotate', w.thief, w.rec0, [w.op1, w.thief]);
    assert.equal(precedence(forwarded, await verifyIdentityLog(await w.b.registry.exportLog(w.identity), strict)), 'b-extends-a');
    // Returning to A later extends the prefix A already holds rather than starting over.
    const back = await verifyIdentityLog(await w.b.registry.exportLog(w.identity), strict), at2 = w.clock.advance(40_000);
    const home = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: w.identity, expected_digest: back.head_digest, sequence: back.head.sequence + 1, from: { resolver_id: w.b.config.id, resolver_epoch: 1 },
      to: { ...w.a.meta, resolver_epoch: 2 }, issued_at: at2, expires_at: at2 + 300_000 }, [w.rec0]);
    const returned = await w.a.registry.adopt(await w.b.registry.exportLog(w.identity), home);
    assert.deepEqual([returned.sequence, returned.resolver_epoch], [4, 2]);
    const full = await verifyIdentityLog(await w.a.registry.exportLog(w.identity), strict);
    assert.deepEqual(full.resolvers.map(r => r.epoch), [0, 1, 2]); assert.deepEqual(full.unattested, []);
    await w.change(w.a, 'rotate', w.op0, w.rec0, [w.thief, w.op0]).then(() => assert.fail('retired key reinstated'), e => assert.match(e.message, /retired/));
  } finally { await w.close(); }
});

test('adoption refuses a log that names another resolver, a rehome from the wrong epoch, a foreign key as resolver key, and a divergent history', async () => {
  const w = await world(); try {
    const exported = await w.a.registry.exportLog(w.identity), current = await verifyIdentityLog(exported, strict), at = w.clock.advance(5_000);
    const body: Rehome = { identity_id: w.identity, expected_digest: current.head_digest, sequence: 1, from: { resolver_id: w.a.config.id, resolver_epoch: 0 }, to: { ...w.b.meta, resolver_epoch: 1 }, issued_at: at, expires_at: at + 300_000 };
    const sign = (b: Rehome, keys: KeyPair[] = [w.rec0]) => signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', b, keys);
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, to: { ...body.to, resolver_id: crypto.randomUUID() } })), /another resolver/);
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, to: { ...body.to, resolver_epoch: 2 } })), /epoch/);
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, from: { ...body.from, resolver_epoch: 1 } })), /current resolver/);
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, to: { ...body.to, resolver_key: w.rec0.keyId } })), /cannot resolve/);
    await assert.rejects(w.b.registry.adopt(exported, await sign(body, [w.op0])), /quorum/);
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, expires_at: at - 1 })), /window/);
    await w.b.registry.adopt(exported, await sign(body));
    // The same identity presented again with a different history at the same sequence is refused, not merged.
    const other = { ...w.b.meta, resolver_key: (await generateKeyPair()).keyId };
    await assert.rejects(w.b.registry.adopt(exported, await sign({ ...body, to: { ...other, resolver_epoch: 1 } })), /another resolver|different history/);
  } finally { await w.close(); }
});

test('rehomeIdentity: control is unchanged, the head commits to the rehome, and the barrier before the first key change is conservative', async () => {
  const [op, rec, ka, kb, next] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPair())), now = 1_800_000_000_000;
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op.keyId], threshold: 1 }, recovery: { keys: [rec.keyId], threshold: 1 } }, [op, rec]);
  const a = crypto.randomUUID(), b = crypto.randomUUID(), state = await createIdentity(genesis, { id: a, key_id: ka.keyId }, now);
  const leased = (await issueResolution(state, { identity_id: state.head.identity_id, audience: 'https://relying.example', challenge: 'a'.repeat(64) }, ka, now)).state;
  const body: Rehome = { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: 1, from: { resolver_id: a, resolver_epoch: 0 }, to: { resolver_id: b, resolver_key: kb.keyId, audience: 'https://host-b.example', resolver_epoch: 1 }, issued_at: now, expires_at: now + 300_000 };
  const moved = await rehomeIdentity(leased, await signIdentity('DTP-IDENTITY-REHOME-1', body, [rec]), now + 10);
  assert.deepEqual([moved.head.operational, moved.head.recovery, moved.retired_keys], [state.head.operational, state.head.recovery, []]);
  assert.deepEqual([moved.resolver_id, moved.resolver_key, moved.resolver_epoch, moved.head.effective_at, moved.head.sequence], [b, kb.keyId, 1, now + 10, 1]);
  assert.notEqual(moved.head.previous_digest, state.head_digest, 'the head commits to the rehome document, not merely to the previous head');
  const elsewhere = await rehomeIdentity(leased, await signIdentity('DTP-IDENTITY-REHOME-1', { ...body, to: { ...body.to, resolver_id: crypto.randomUUID() } }, [rec]), now + 10);
  assert.notEqual(elsewhere.head_digest, moved.head_digest, 'two moves from one head are distinguishable');
  // A rehome needs no drain, and the old resolver can no longer issue; the first key change at B waits a full lease plus the margin.
  await assert.rejects(issueResolution(moved, { identity_id: state.head.identity_id, audience: 'https://relying.example', challenge: 'b'.repeat(64) }, ka, now + 11), /wrong identity or resolver/);
  const fresh = await issueResolution(moved, { identity_id: state.head.identity_id, audience: 'https://relying.example', challenge: 'b'.repeat(64) }, kb, now + 11);
  assert.equal(fresh.proof.body.resolver_epoch, 1);
  const rotate: Transition = { identity_id: state.head.identity_id, expected_digest: moved.head_digest, sequence: 2, kind: 'rotate', operational: { keys: [next.keyId], threshold: 1 }, recovery: moved.head.recovery, issued_at: now + 12, expires_at: now + 300_000 };
  assert.equal((await transitionIdentity(moved, await signIdentity('DTP-IDENTITY-TRANSITION-1', rotate, [op, next]), now + 12)).head.effective_at, now + 10 + LEASE_MS + CLOCK_MARGIN_MS);
  // Same resolver, new key: a resolver key rotation through the same document.
  const rotated = await rehomeIdentity(leased, await signIdentity('DTP-IDENTITY-REHOME-1', { ...body, to: { ...body.to, resolver_id: a, audience: 'https://host-a.example' } }, [rec]), now + 10);
  assert.deepEqual([rotated.resolver_id, rotated.resolver_key, rotated.resolver_epoch], [a, kb.keyId, 1]);
  for (const [why, bad, keys] of [
    ['stale head', { ...body, expected_digest: 'f'.repeat(64) }, [rec]], ['skipped sequence', { ...body, sequence: 2 }, [rec]],
    ['wrong from', { ...body, from: { resolver_id: b, resolver_epoch: 0 } }, [rec]], ['epoch not advanced', { ...body, to: { ...body.to, resolver_epoch: 0 } }, [rec]],
    ['operational signer', body, [op]], ['resolver key is a control key', { ...body, to: { ...body.to, resolver_key: op.keyId } }, [rec]],
    ['window too long', { ...body, expires_at: now + 300_001 }, [rec]], ['bad audience', { ...body, to: { ...body.to, audience: 'https://host-b.example/path' } }, [rec]],
  ] as [string, Rehome, KeyPair[]][]) await assert.rejects(rehomeIdentity(leased, await signIdentity('DTP-IDENTITY-REHOME-1', bad, keys), now + 10), why);
});

test('the log verifier binds each head attestation to the resolver of its epoch and reports every binding', async () => {
  const w = await world(); try {
    const exported = await w.a.registry.exportLog(w.identity), current = await verifyIdentityLog(exported, strict), at = w.clock.advance(5_000);
    const rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: w.identity, expected_digest: current.head_digest, sequence: 1, from: { resolver_id: w.a.config.id, resolver_epoch: 0 }, to: { ...w.b.meta, resolver_epoch: 1 }, issued_at: at, expires_at: at + 300_000 }, [w.rec0]);
    await w.b.registry.adopt(exported, rehome); await w.change(w.b, 'rotate', w.op1, w.rec0, [w.op0, w.op1]);
    const log = await w.b.registry.exportLog(w.identity), v = await verifyIdentityLog(log, strict);
    assert.deepEqual(v.heads.map(h => h.epoch), [0, 1, 1]);
    const swapped = structuredClone(log); swapped.entries[1].attestation = await attestHead(v.heads[1].head, { id: w.a.config.id, epoch: 0 }, w.a.key);
    await assert.rejects(verifyIdentityLog(swapped, lenient), /does not describe/, 'the old resolver cannot attest the rehome head');
    const late = structuredClone(log); late.entries[1].effective_at = rehome.body.expires_at; late.entries[1].attestation = null;
    await assert.rejects(verifyIdentityLog(late, lenient), /beyond the signed window/);
    const early = structuredClone(log); early.entries[1].effective_at = rehome.body.issued_at - 1; early.entries[1].attestation = null;
    await assert.rejects(verifyIdentityLog(early, lenient), /precedes/);
    // A verifier that pinned nothing yet, with a stale pin, or with a same-epoch conflict.
    const pinA: ResolverPin = { resolver_id: w.a.config.id, resolver_key: w.a.key.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: current.head_digest };
    assert.equal((await admitIdentityLog(pinA, log, strict)).outcome, 'advanced');
    assert.equal((await admitIdentityLog(pinA, exported, strict)).outcome, 'unchanged');
    await assert.rejects(admitIdentityLog({ ...pinA, resolver_key: w.b.key.keyId }, log, strict), /pinned lineage/);
    await assert.rejects(admitIdentityLog({ ...pinA, minimum_sequence: 5 }, log, strict), /behind/);
    const conflict = await admitIdentityLog({ ...pinA, minimum_digest: 'f'.repeat(64) }, log, strict);
    assert.equal(conflict.outcome, 'superseded'); assert.deepEqual(conflict.superseded, { sequence: 0, head_digest: 'f'.repeat(64) });
    await assert.rejects(admitIdentityLog({ ...pinA, minimum_digest: 'f'.repeat(64) }, exported, strict), /same resolver epoch/);
  } finally { await w.close(); }
});
