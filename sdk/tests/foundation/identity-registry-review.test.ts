import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity, transitionIdentity, verifyResolution } from '../../src/foundation/identity.ts';
import { createIdentityRegistry, IDENTITY_REGISTRY_SCHEMA } from '../../src/foundation/identity-registry.ts';

async function fixture() {
  const pg = new PGlite(); await pg.exec(IDENTITY_REGISTRY_SCHEMA); const db = pgliteDb(pg);
  const [ordinary, recovery, resolver, next] = await Promise.all(Array.from({ length: 4 }, generateKeyPair));
  let now = 1_800_000_000_000;
  const config = { id: crypto.randomUUID(), audience: 'https://review-resolver.example', key: resolver, now: () => now };
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [ordinary.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 } }, [ordinary, recovery]);
  const initial = await createIdentity(genesis, { id: config.id, key_id: resolver.keyId }, now);
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: initial.head.identity_id, genesis_digest: initial.genesis_digest,
    resolver_id: config.id, resolver_key: resolver.keyId, audience: config.audience, nonce: 'a'.repeat(64), issued_at: now, expires_at: now + 300_000 }, [ordinary, recovery]);
  const registry = createIdentityRegistry(db, config);
  const request = { identity_id: initial.head.identity_id, audience: 'https://review-client.example', challenge: 'b'.repeat(64) };
  const command = () => signIdentity('DTP-IDENTITY-TRANSITION-1', { identity_id: initial.head.identity_id, expected_digest: initial.head_digest, sequence: 1,
    kind: 'rotate' as const, operational: { keys: [next.keyId], threshold: 1 }, recovery: initial.head.recovery, issued_at: now, expires_at: now + 300_000 }, [ordinary, next]);
  return { pg, db, ordinary, recovery, resolver, next, config, genesis, enrollment, initial, registry, request, command, get now() { return now; }, advance(ms: number) { now += ms; } };
}

test('independent registry review: exact duplicate enrollment is stable after a control transition and exposes no new keys', async () => {
  const f = await fixture(); try {
    const first = await f.registry.enroll(f.genesis, f.enrollment);
    await f.registry.transition(f.initial.head.identity_id, await f.command());
    const repeated = await f.registry.enroll(f.genesis, f.enrollment);
    assert.deepEqual(repeated, first); assert.ok(!JSON.stringify(repeated).includes(f.next.keyId));
    assert.equal((await f.db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.identity_history'))[0].n, 2);
  } finally { await f.pg.close(); }
});

test('independent registry review: simultaneous identical and competing enrollment attempts do not create two histories', async () => {
  const f = await fixture(); try {
    const alternate = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { ...f.enrollment.body, nonce: 'c'.repeat(64) }, [f.ordinary, f.recovery]);
    const results = await Promise.allSettled([f.registry.enroll(f.genesis, f.enrollment), f.registry.enroll(f.genesis, f.enrollment), f.registry.enroll(f.genesis, alternate)]);
    assert.ok(results.some(r => r.status === 'fulfilled'));
    assert.ok(results.some(r => r.status === 'rejected'));
    assert.equal((await f.db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.identities'))[0].n, 1);
    assert.equal((await f.db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.identity_history'))[0].n, 1);
  } finally { await f.pg.close(); }
});

test('independent registry review: full genesis digest conflict cannot merge an existing UUID row', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment);
    // Models the database collision guard without pretending to find a SHA-256 collision.
    await f.db.query('update dtp_foundation.identities set genesis_digest=$1 where identity_id=$2', ['f'.repeat(64), f.initial.head.identity_id]);
    const before = await f.db.query('select * from dtp_foundation.identities');
    await assert.rejects(f.registry.enroll(f.genesis, f.enrollment), /conflict/);
    assert.deepEqual(await f.db.query('select * from dtp_foundation.identities'), before);
  } finally { await f.pg.close(); }
});

test('independent registry review: a different resolver audience cannot reuse the original owner enrollment', async () => {
  const f = await fixture(); try {
    await f.registry.enroll(f.genesis, f.enrollment);
    const other = createIdentityRegistry(f.db, { ...f.config, audience: 'https://not-enrolled.example' });
    await assert.rejects(other.resolve(f.request), 'same key and ID do not erase the signed resolver audience restriction');
  } finally { await f.pg.close(); }
});

test('independent registry review: transition copies the verified body before asynchronous verification', async () => {
  const f = await fixture(); try {
    const command = await f.command();
    const pending = transitionIdentity(f.initial, command, f.now);
    command.body.operational.threshold = 0;
    const accepted = await pending;
    assert.equal(accepted.head.operational.threshold, 1, 'post-call mutation must not change the validated and signed threshold');
  } finally { await f.pg.close(); }
});

test('independent registry review: enrollment audit persists the verified request snapshot, not later caller mutation', async () => {
  const f = await fixture(); try {
    const original = structuredClone({ genesis: f.genesis, enrollment: f.enrollment });
    const delayed: Db = { ...f.db, transaction: fn => f.db.transaction(tx => fn({ ...tx, query: async (sql: string, parameters?: unknown[]) => {
      const result = await tx.query(sql, parameters);
      if (sql.startsWith('insert into dtp_foundation.identities')) {
        f.genesis.body.nonce = crypto.randomUUID(); f.enrollment.body.nonce = 'd'.repeat(64);
      }
      return result as any;
    } })) };
    await createIdentityRegistry(delayed, f.config).enroll(f.genesis, f.enrollment);
    const rows = await f.db.query<{ body: unknown }>('select body from dtp_foundation.identity_history where sequence=0');
    assert.deepEqual(rows[0].body, original, 'stored signed evidence must be the bytes that were checked');
  } finally { await f.pg.close(); }
});

test('independent registry review: copied signing configuration survives caller object changes', async () => {
  const f = await fixture(); try {
    const expectedKey = f.resolver.keyId;
    await f.registry.enroll(f.genesis, f.enrollment);
    f.config.key.keyId = f.next.keyId; f.config.key.secretKey = f.next.secretKey;
    const proof = await f.registry.resolve(f.request);
    assert.equal((await verifyResolution(proof, { ...f.request, resolver_id: f.config.id, resolver_key: expectedKey, resolver_epoch: 0,
      minimum_sequence: 0, minimum_digest: f.initial.head_digest }, f.now)).identity_id, f.initial.head.identity_id);
  } finally { await f.pg.close(); }
});
