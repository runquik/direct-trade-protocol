import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, rehomeIdentity, signIdentity, transitionIdentity } from '../../src/foundation/identity.ts';
import type { IdentityState, Rehome, Transition } from '../../src/foundation/identity.ts';
import { attestHead, buildIdentityLog } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogEntry, IdentityLogParts } from '../../src/foundation/identity-log.ts';
import type { JsonObject } from '../../src/foundation/semantics.ts';
import { personAuthenticationFixture } from './person-authentication-fixture.ts';

async function setup() {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA); await pg.exec(PERSON_AUTHENTICATION_SCHEMA);
  const f = await personAuthenticationFixture(pgliteDb(pg));
  // The history as its owner keeps it. Resolver A attested nothing before it became unreachable.
  const audienceA = 'https://resolver-a.example', at0 = f.identity.head.effective_at;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: f.person.id, genesis_digest: f.identity.genesis_digest, resolver_id: f.resolverId, resolver_key: f.resolver.keyId,
    audience: audienceA, nonce: 'e'.repeat(64), issued_at: at0 - 1_000, expires_at: at0 + 299_000 }, [f.ordinary, f.recovery]);
  const parts: IdentityLogParts = { genesis: f.genesis, enrollment, entries: [{ effective_at: at0, transition: null, rehome: null, attestation: null }] };
  const resolverB = await generateKeyPair(), b = { resolver_id: crypto.randomUUID(), resolver_key: resolverB.keyId, audience: 'https://resolver-b.example' };
  async function move(from: IdentityState, at: number): Promise<{ state: IdentityState; entry: IdentityLogEntry }> {
    const rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: f.person.id, expected_digest: from.head_digest, sequence: from.head.sequence + 1,
      from: { resolver_id: from.resolver_id, resolver_epoch: from.resolver_epoch }, to: { ...b, resolver_epoch: from.resolver_epoch + 1 }, issued_at: at - 500, expires_at: at + 299_500 }, [f.recovery]);
    return { state: await rehomeIdentity(from, rehome, at), entry: { effective_at: at, transition: null, rehome, attestation: null } };
  }
  async function rotate(from: IdentityState, to: KeyPair, signer: KeyPair, at: number): Promise<{ state: IdentityState; entry: IdentityLogEntry }> {
    const command = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: f.person.id, expected_digest: from.head_digest, sequence: from.head.sequence + 1, kind: 'rotate',
      operational: { keys: [to.keyId], threshold: 1 }, recovery: from.head.recovery, issued_at: at - 500, expires_at: at + 299_500 }, [signer, to]);
    const state = await transitionIdentity(from, command, at);
    return { state, entry: { effective_at: state.head.effective_at, transition: command, rehome: null, attestation: null } };
  }
  const hooks = (adapter: typeof f.adapter) => createFoundationStore(f.db, { ...f.options, hooks: { ...f.options.hooks, authenticateOperation: adapter.authenticateOperation, beforeCommit: adapter.beforeCommit } });
  /** A person operation authenticated with a resolution issued by `key` over `state`, exactly as the workspace would receive it. */
  const authenticate = async (state: IdentityState, key: KeyPair, signers: KeyPair[] = [f.ordinary], adapter = f.adapter, store = f.store) => {
    const i = f.intent(), challenge = await f.db.transaction(tx => adapter.issueChallenge(tx, { organization_id: f.organization_id, person_id: f.person.id, intent: i, grant_id: f.personGrant.id }));
    const resolution = (await issueResolution(state, { identity_id: f.person.id, audience: f.config.audience, challenge: challenge.nonce }, key, Date.now())).proof;
    return store.execute(f.organization_id, await signPersonOperation({ intent: i, actor: f.person, grant_id: f.personGrant.id, challenge, resolution }, signers) as unknown as JsonObject);
  };
  const admit = (log: IdentityLog, require_attestation = false, adapter = f.adapter, person_id = f.person.id) => f.db.transaction(tx => adapter.admitIdentityMove(tx, { person_id, log, require_attestation }));
  const row = async () => { const r = (await f.db.query<{ resolver_id: string; resolver_epoch: string; sequence: string; digest: string }>('select resolver_id,resolver_epoch,sequence,digest from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.config.host_id, f.person.id]))[0]; return { resolver_id: r.resolver_id, epoch: Number(r.resolver_epoch), sequence: Number(r.sequence), digest: r.digest }; };
  return { pg, ...f, parts, resolverB, b, move, rotate, hooks, authenticate, admit, row };
}

test('a move admitted from the owner\'s log becomes the durable binding: the new resolver authenticates, the former is refused, and a restart with the enrollment configuration keeps it', async () => {
  const f = await setup(); try {
    await f.authenticate(f.identity, f.resolver);
    assert.deepEqual(await f.row(), { resolver_id: f.resolverId, epoch: 0, sequence: 0, digest: f.identity.head_digest });
    const moved = await f.move(f.identity, Date.now()), log = await buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, moved.entry] }, f.resolverB);
    assert.equal(log.entries[0].attestation, null, 'the former resolver never attested; only the new one can attest its own epoch');
    await assert.rejects(f.admit(log, true), /attestation required/, 'the policy is the caller\'s and explicit');
    assert.deepEqual(await f.row(), { resolver_id: f.resolverId, epoch: 0, sequence: 0, digest: f.identity.head_digest }, 'a refused admission changes nothing');
    const admitted = await f.admit(log);
    assert.equal(admitted.outcome, 'advanced'); assert.equal(admitted.superseded, null);
    assert.deepEqual(await f.row(), { resolver_id: f.b.resolver_id, epoch: 1, sequence: 1, digest: moved.state.head_digest });
    await f.authenticate(moved.state, f.resolverB);
    await assert.rejects(f.authenticate(f.identity, f.resolver), /resolver authority mismatch/, 'a fresh, correctly signed resolution from the former resolver');
    // The host restarts with the configuration it enrolled the person with. The durable row, not the configuration, is the binding.
    const restarted = createPersonAuthentication(f.config), store = f.hooks(restarted);
    await f.authenticate(moved.state, f.resolverB, [f.ordinary], restarted, store);
    await assert.rejects(f.authenticate(f.identity, f.resolver, [f.ordinary], restarted, store), /resolver authority mismatch/);
    assert.equal((await f.admit(log, false, restarted)).outcome, 'unchanged', 'presenting the same log again is idempotent');
    // Once the former resolver's attestation turns up, the strict policy admits the same history too.
    const attested = structuredClone(log); attested.entries[0].attestation = await attestHead(f.identity.head, { id: f.resolverId, epoch: 0 }, f.resolver);
    assert.equal((await f.admit(attested, true)).outcome, 'unchanged');
  } finally { await f.pg.close(); }
});

test('admission refuses another identity, a lineage this host never enrolled, an operational-signed move, and a same-epoch fork; a higher-epoch fork supersedes and is reported; a failed transaction changes nothing', async () => {
  const f = await setup(); try {
    await f.authenticate(f.identity, f.resolver);
    const now = Date.now(), moved = await f.move(f.identity, now), valid = await buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, moved.entry] }, f.resolverB);
    await assert.rejects(f.db.transaction(async tx => { await f.adapter.admitIdentityMove(tx, { person_id: f.person.id, log: valid, require_attestation: false }); throw new Error('synthetic host failure'); }), /synthetic/);
    assert.deepEqual(await f.row(), { resolver_id: f.resolverId, epoch: 0, sequence: 0, digest: f.identity.head_digest }, 'the admission rolled back with the transaction');
    await assert.rejects(f.admit(valid, false, f.adapter, crypto.randomUUID()), /not enrolled/);
    // Another person, enrolled at the same resolver, presented under this person's id.
    const [op, rec] = await Promise.all([generateKeyPair(), generateKeyPair()]);
    const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op.keyId], threshold: 1 }, recovery: { keys: [rec.keyId], threshold: 1 } }, [op, rec]);
    const other = await createIdentity(genesis, { id: f.resolverId, key_id: f.resolver.keyId }, f.identity.head.effective_at);
    const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { ...f.parts.enrollment.body, identity_id: other.head.identity_id, genesis_digest: other.genesis_digest }, [op, rec]);
    await assert.rejects(f.admit(await buildIdentityLog({ genesis, enrollment, entries: f.parts.entries }, null)), /another identity/);
    // The same person, but a lineage enrolled at a resolver this host never pinned.
    const c = await generateKeyPair(), elsewhere = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { ...f.parts.enrollment.body, resolver_id: crypto.randomUUID(), resolver_key: c.keyId }, [f.ordinary, f.recovery]);
    await assert.rejects(f.admit(await buildIdentityLog({ ...f.parts, enrollment: elsewhere }, null)), /pinned lineage/);
    // A move signed with the operational key is not a move.
    const forged = structuredClone(valid); forged.entries[1].rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', forged.entries[1].rehome!.body, [f.ordinary]); forged.entries[1].attestation = null;
    await assert.rejects(f.admit(forged), /quorum/);
    // The host has seen the owner rotate at A (checkpoint at sequence 1). A rival rotation from the same head is a same-epoch fork.
    const rotated = await f.rotate(f.identity, f.next, f.ordinary, now + 1), rival = await f.rotate(f.identity, await generateKeyPair(), f.ordinary, now + 1);
    await f.authenticate(rotated.state, f.resolver, [f.next]);
    assert.deepEqual(await f.row(), { resolver_id: f.resolverId, epoch: 0, sequence: 1, digest: rotated.state.head_digest });
    await assert.rejects(f.admit(await buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, rival.entry] }, null)), /same resolver epoch/);
    assert.equal((await f.row()).digest, rotated.state.head_digest);
    // The recovery quorum moves the rival branch to B. Epoch precedence admits it, and the superseded checkpoint is reported, not hidden.
    const rivalMoved = await f.move(rival.state, now + 2), superseding = await buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, rival.entry, rivalMoved.entry] }, f.resolverB);
    const outcome = await f.admit(superseding);
    assert.equal(outcome.outcome, 'superseded'); assert.deepEqual(outcome.superseded, { sequence: 1, head_digest: rotated.state.head_digest });
    assert.deepEqual(await f.row(), { resolver_id: f.b.resolver_id, epoch: 1, sequence: 2, digest: rivalMoved.state.head_digest });
    await assert.rejects(f.authenticate(rotated.state, f.resolver, [f.next]), /resolver authority mismatch/);
  } finally { await f.pg.close(); }
});
