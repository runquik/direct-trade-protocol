// Registration rule (#47): the resolver refuses a key that is not of prime order when it enters a person's control
// (genesis, rotation, recovery, recovery-policy). Verifying an identity is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { encodeSignature, generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity } from '../../src/foundation/identity.ts';
import type { Signed, Transition } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';

// The identity point: with R = identity and S = 0 its signature verifies for every message (spec/vectors/key-registration.json).
const WEAK = 'ed25519:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM';
const forged = { key_id: WEAK, signature: encodeSignature(Uint8Array.from(Buffer.from('01' + '00'.repeat(63), 'hex'))) };
async function sign<T>(domain: Parameters<typeof signIdentity>[0], body: T, keys: KeyPair[]): Promise<Signed<T>> {
  const signed = await signIdentity(domain as any, body, keys);
  return { ...signed, signatures: [...signed.signatures, forged] };
}
async function fixture() {
  const pg = new PGlite(); await pg.exec(IDENTITY_REGISTRY_SCHEMA);
  const [person, recovery, resolver] = await Promise.all(Array.from({ length: 3 }, () => generateKeyPair()));
  const now = 1800000000000, config = { id: crypto.randomUUID(), audience: 'https://resolver.example', key: resolver, now: () => now };
  const enroll = async (genesis: Signed<any>, keys: KeyPair[], weak: boolean) => {
    const initial = await createIdentity(genesis, { id: config.id, key_id: resolver.keyId }, now);
    const body = { identity_id: initial.head.identity_id, genesis_digest: initial.genesis_digest, resolver_id: config.id, resolver_key: resolver.keyId, audience: config.audience, nonce: 'a'.repeat(64), issued_at: now, expires_at: now + 300000 };
    return { initial, enrollment: weak ? await sign('DTP-IDENTITY-ENROLLMENT-1', body, keys) : await signIdentity('DTP-IDENTITY-ENROLLMENT-1', body, keys) };
  };
  return { pg, person, recovery, now, enroll, registry: createIdentityRegistry(pgliteDb(pg), config) };
}

test('genesis naming a small-order recovery key is refused at enrollment, though createIdentity still verifies it', async () => {
  const f = await fixture(); try {
    const genesis = await sign('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [f.person.keyId], threshold: 1 }, recovery: { keys: [WEAK], threshold: 1 } }, [f.person]);
    const { initial, enrollment } = await f.enroll(genesis, [f.person], true); // verification is unchanged (#45)
    assert.deepEqual(initial.head.recovery.keys, [WEAK]);
    await assert.rejects(f.registry.enroll(genesis, enrollment), /prime order/);
  } finally { await f.pg.close(); }
});

test('a rotation or recovery-policy change adding a small-order key is refused; the head is unchanged', async () => {
  const f = await fixture(); try {
    const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [f.person.keyId], threshold: 1 }, recovery: { keys: [f.recovery.keyId], threshold: 1 } }, [f.person, f.recovery]);
    const { initial, enrollment } = await f.enroll(genesis, [f.person, f.recovery], false);
    await f.registry.enroll(genesis, enrollment);
    const base = { identity_id: initial.head.identity_id, expected_digest: initial.head_digest, sequence: 1, issued_at: f.now, expires_at: f.now + 300000 };
    const rotate = await sign<Transition>('DTP-IDENTITY-TRANSITION-1', { ...base, kind: 'rotate', operational: { keys: [f.person.keyId, WEAK], threshold: 1 }, recovery: initial.head.recovery }, [f.person]);
    await assert.rejects(f.registry.transition(initial.head.identity_id, rotate), /prime order/);
    const policy = await sign<Transition>('DTP-IDENTITY-TRANSITION-1', { ...base, kind: 'recovery-policy', operational: initial.head.operational, recovery: { keys: [f.recovery.keyId, WEAK], threshold: 1 } }, [f.recovery]);
    await assert.rejects(f.registry.transition(initial.head.identity_id, policy), /prime order/);
    const next = await generateKeyPair();
    const good = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { ...base, kind: 'rotate', operational: { keys: [f.person.keyId, next.keyId], threshold: 1 }, recovery: initial.head.recovery }, [f.person, next]);
    assert.equal((await f.registry.transition(initial.head.identity_id, good)).sequence, 1);
  } finally { await f.pg.close(); }
});
