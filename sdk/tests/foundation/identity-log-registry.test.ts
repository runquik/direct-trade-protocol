import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { Transition } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';
import { compareCheckpoint, verifyIdentityLog } from '../../src/foundation/identity-log.ts';

const delay = 4_321;
async function fixture() {
  const pg = new PGlite(); await pg.exec(IDENTITY_REGISTRY_SCHEMA); const db = pgliteDb(pg);
  const [person, recovery, resolver, next, last] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPair()));
  let now = 1_800_000_000_000; const signedAt = now, config = { id: crypto.randomUUID(), audience: 'https://resolver.example', key: resolver, now: () => now };
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [person.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 } }, [person, recovery]);
  const initial = await createIdentity(genesis, { id: config.id, key_id: resolver.keyId }, now), identity = initial.head.identity_id;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: identity, genesis_digest: initial.genesis_digest, resolver_id: config.id, resolver_key: resolver.keyId,
    audience: config.audience, nonce: 'a'.repeat(64), issued_at: now, expires_at: now + 300_000 }, [person, recovery]);
  // The owner signs before the host accepts, as on a real network: head 0 takes effect later than issued_at.
  now += delay;
  const registry = createIdentityRegistry(db, config), request = { identity_id: identity, audience: 'https://company.example', challenge: 'b'.repeat(64) };
  const expected = { ...request, resolver_id: config.id, resolver_key: resolver.keyId, resolver_epoch: 0 };
  /** Transitions are built from the resolver's own proof, never from a locally guessed head. */
  async function change(kind: Transition['kind'], operational: string, signers: (typeof person)[]) {
    const challenge = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const proof = await registry.resolve({ ...request, challenge }), leasedAt = now;
    const head = await verifyResolution(proof, { ...expected, challenge, minimum_sequence: 0, minimum_digest: null }, now);
    now += 900;
    const accepted = await registry.transition(identity, await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: identity, expected_digest: proof.body.head_digest, sequence: head.sequence + 1, kind,
      operational: { keys: [operational], threshold: 1 }, recovery: head.recovery, issued_at: now, expires_at: now + 300_000 }, signers));
    assert.equal(accepted.effective_at, leasedAt + LEASE_MS + CLOCK_MARGIN_MS, 'the lease barrier, not acceptance time, sets the instant');
    now = accepted.effective_at; return accepted;
  }
  return { pg, db, config, registry, identity, genesis, enrollment, person, recovery, next, last, request, signedAt, change };
}
const strict = { require_attestation: true };

test('registry export: a host-independent verifier reproduces the digests the live registry acknowledged', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment);
    const genesisOnly = await verifyIdentityLog(await f.registry.exportLog(f.identity), strict);
    assert.equal(genesisOnly.heads.length, 1); assert.equal(genesisOnly.head.effective_at, f.signedAt + delay);
    const first = await f.change('rotate', f.next.keyId, [f.person, f.next]), second = await f.change('recover', f.last.keyId, [f.recovery, f.last]);
    // Through JSON, as it would travel.
    const log = await f.registry.exportLog(f.identity), verified = await verifyIdentityLog(JSON.parse(JSON.stringify(log)), strict);
    assert.deepEqual(verified.heads.slice(1).map(h => [h.head.sequence, h.head_digest, h.head.effective_at]), [first, second].map(r => [r.sequence, r.head_digest, r.effective_at]));
    assert.deepEqual(verified.head.operational.keys, [f.last.keyId]); assert.deepEqual(verified.unattested, []);
    // Freshness still comes from the resolver; the log then proves that head's whole lineage.
    const proof = await f.registry.resolve({ ...f.request, challenge: 'c'.repeat(64) });
    assert.equal(compareCheckpoint(verified, { sequence: proof.body.head.sequence, head_digest: proof.body.head_digest }), 'consistent');
  } finally { await f.pg.close(); }
});

test('registry export: rows enrolled before the genesis instant was recorded still export the same log', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment); await f.change('rotate', f.next.keyId, [f.person, f.next]);
    const recorded = await f.registry.exportLog(f.identity);
    await f.db.query('update dtp_foundation.identities set genesis_effective_at=null where identity_id=$1', [f.identity]);
    assert.deepEqual(await f.registry.exportLog(f.identity), recorded);
  } finally { await f.pg.close(); }
});

test('registry export: a frozen identity can still leave with its history; another resolver cannot export it', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment); await f.change('rotate', f.next.keyId, [f.person, f.next]);
    await f.db.query("update dtp_foundation.identities set status='frozen' where identity_id=$1", [f.identity]);
    await assert.rejects(f.registry.resolve(f.request), /frozen/);
    assert.equal((await verifyIdentityLog(await f.registry.exportLog(f.identity), strict)).heads.length, 2);
    const foreign = createIdentityRegistry(f.db, { ...f.config, key: await generateKeyPair() });
    await assert.rejects(foreign.exportLog(f.identity), /another resolver/);
    await assert.rejects(f.registry.exportLog(crypto.randomUUID()), /unavailable/);
  } finally { await f.pg.close(); }
});

test('registry export: a store whose interior history no longer verifies refuses to export rather than emit a bad log', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment); await f.change('rotate', f.next.keyId, [f.person, f.next]);
    // The instant of head 0 is pinned by the expected_digest the owner signed in transition 1.
    await f.db.query('update dtp_foundation.identities set genesis_effective_at=genesis_effective_at+1 where identity_id=$1', [f.identity]);
    await assert.rejects(f.registry.exportLog(f.identity), /stale control head/);
  } finally { await f.pg.close(); }
});
