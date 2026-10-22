/** GAP (red team): a hostile former resolver can keep a person at a relying party forever by poisoning its checkpoint.
 *  The re-homing design requires that the former resolver A "must not be able to move an identity, block a move, or keep
 *  serving it to an RP that has learned of the move" and that the move "must work when A is offline, destroyed or hostile"
 *  (docs/foundation/identity-rehoming-proposal.md section 2). A relying party advances its checkpoint on A's word alone
 *  (a higher-sequence head is "a statement by the explicitly trusted pinned resolver"), with no lineage check. One
 *  resolution from A over a fabricated head, keeping the owner's real keys so nothing looks wrong, leaves a checkpoint
 *  that no owner-signed log can ever satisfy: the owner's move is refused as `behind` (head far ahead) or `conflict`
 *  (same sequence, different digest, and the adapter holds only a pin), and A keeps authenticating the person there.
 *  These assertions record the current behaviour so CI stays green; they flip when the gap is closed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { canonicalBytes, sha256Hex } from '../../src/canonical.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { issueResolution, rehomeIdentity, signIdentity } from '../../src/foundation/identity.ts';
import type { Control, IdentityState, Rehome } from '../../src/foundation/identity.ts';
import { IDENTITY_LOG_PUSH_FORMAT, buildIdentityLog } from '../../src/foundation/identity-log.ts';
import type { IdentityLog } from '../../src/foundation/identity-log.ts';
import type { JsonObject } from '../../src/foundation/semantics.ts';
import { personAuthenticationFixture } from './person-authentication-fixture.ts';

async function setup() {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA); await pg.exec(PERSON_AUTHENTICATION_SCHEMA);
  const f = await personAuthenticationFixture(pgliteDb(pg));
  const at0 = f.identity.head.effective_at;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: f.person.id, genesis_digest: f.identity.genesis_digest, resolver_id: f.resolverId, resolver_key: f.resolver.keyId,
    audience: 'https://resolver-a.example', nonce: 'e'.repeat(64), issued_at: at0 - 1_000, expires_at: at0 + 299_000 }, [f.ordinary, f.recovery]);
  const resolverB = await generateKeyPair(), b = { resolver_id: crypto.randomUUID(), resolver_key: resolverB.keyId, audience: 'https://resolver-b.example' };
  /** The owner's escape: recovery quorum alone, from the owner's real head, adopted and attested by B. */
  async function escape(): Promise<{ state: IdentityState; log: IdentityLog }> {
    const at = Date.now(), from = f.identity;
    const rehome = await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1', { identity_id: f.person.id, expected_digest: from.head_digest, sequence: from.head.sequence + 1,
      from: { resolver_id: from.resolver_id, resolver_epoch: from.resolver_epoch }, to: { ...b, resolver_epoch: from.resolver_epoch + 1 }, issued_at: at - 500, expires_at: at + 299_500 }, [f.recovery]);
    const state = await rehomeIdentity(from, rehome, at);
    const log = await buildIdentityLog({ genesis: f.genesis, enrollment, entries: [{ effective_at: at0, transition: null, rehome: null, attestation: null }, { effective_at: at, transition: null, rehome, attestation: null }] }, resolverB);
    return { state, log };
  }
  /** What hostile A serves: a head it never stored and the owner never signed, keeping the owner's real keys. */
  async function fabricated(sequence: number): Promise<IdentityState> {
    const head: Control = { ...structuredClone(f.identity.head), sequence, previous_digest: 'a'.repeat(64) };
    return { ...structuredClone(f.identity), head, head_digest: await sha256Hex(canonicalBytes(head)) };
  }
  const authenticate = async (state: IdentityState, key: KeyPair) => {
    const i = f.intent(), challenge = await f.db.transaction(tx => f.adapter.issueChallenge(tx, { organization_id: f.organization_id, person_id: f.person.id, intent: i, grant_id: f.personGrant.id }));
    const resolution = (await issueResolution(state, { identity_id: f.person.id, audience: f.config.audience, challenge: challenge.nonce }, key, Date.now())).proof;
    return f.store.execute(f.organization_id, await signPersonOperation({ intent: i, actor: f.person, grant_id: f.personGrant.id, challenge, resolution }, [f.ordinary]) as unknown as JsonObject);
  };
  const push = (log: IdentityLog) => f.db.transaction(tx => f.adapter.receiveIdentityLogPush(tx, { message: { format: IDENTITY_LOG_PUSH_FORMAT, log }, require_attestation: false }));
  const admit = (log: IdentityLog) => f.db.transaction(tx => f.adapter.admitIdentityMove(tx, { person_id: f.person.id, log, require_attestation: false }));
  const row = async () => { const r = (await f.db.query<{ resolver_epoch: string; sequence: string }>('select resolver_epoch,sequence from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.config.host_id, f.person.id]))[0]; return { epoch: Number(r.resolver_epoch), sequence: Number(r.sequence) }; };
  return { pg, ...f, resolverB, escape, fabricated, authenticate, push, admit, row };
}

test('GAP: one resolution from A over a fabricated far-ahead head makes every owner escape `behind`, and A keeps authenticating the person', async () => {
  const f = await setup(); try {
    await f.authenticate(f.identity, f.resolver);
    // A turns hostile. It issues one ordinary-looking resolution: the owner's real keys, sequence 1,000,000. The owner signs as usual.
    await f.authenticate(await f.fabricated(1_000_000), f.resolver);
    assert.deepEqual(await f.row(), { epoch: 0, sequence: 1_000_000 }, 'GAP: the checkpoint jumped to a head no owner signature produced');
    // The owner leaves A exactly as documented: recovery-signed rehome, B adopts and attests, wallet pushes.
    const { state, log } = await f.escape();
    const ack = await f.push(log);
    assert.deepEqual([ack.outcome, ack.reason], ['refused', 'behind'], 'GAP: the owner\'s complete, valid, adopted move is refused');
    await assert.rejects(f.admit(log), /behind/, 'GAP: the explicit admission path refuses it too');
    // A log can hold at most 4096 entries, so no owner-signed history can ever reach the fabricated sequence.
    await assert.rejects(f.authenticate(state, f.resolverB), /resolver authority mismatch/, 'GAP: the new resolver is refused');
    await f.authenticate(await f.fabricated(1_000_000), f.resolver);
    assert.deepEqual(await f.row(), { epoch: 0, sequence: 1_000_000 }, 'GAP: the former resolver keeps serving the person after the RP was shown the move');
  } finally { await f.pg.close(); }
});

test('GAP: a fabricated head at the next sequence turns the owner escape into a `conflict` the pin-only adapter can never resolve', async () => {
  const f = await setup(); try {
    await f.authenticate(f.identity, f.resolver);
    await f.authenticate(await f.fabricated(1), f.resolver);
    assert.deepEqual(await f.row(), { epoch: 0, sequence: 1 });
    const { state, log } = await f.escape();
    const ack = await f.push(log);
    assert.deepEqual([ack.outcome, ack.reason], ['refused', 'conflict'], 'GAP: the owner\'s higher-epoch move is refused against a head the owner never signed');
    await assert.rejects(f.authenticate(state, f.resolverB), /resolver authority mismatch/);
    await f.authenticate(await f.fabricated(1), f.resolver);
    assert.deepEqual(await f.row(), { epoch: 0, sequence: 1 }, 'GAP: A is still the binding');
  } finally { await f.pg.close(); }
});
