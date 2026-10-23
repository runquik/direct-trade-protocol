/** A hostile former resolver cannot poison a relying party's checkpoint through the owner's wallet (#83; replaces gap
 *  test #84). The relying party advances its checkpoint to the resolved head only inside a person operation the owner's
 *  operational quorum signed, and the wallet signs only a resolution over the head it holds. A resolution over a head A
 *  fabricated is refused before anything reaches the relying party, so the checkpoint stays where the owner's own log
 *  can reach it and the owner's escape is admitted. The leftover case, stolen operational keys plus a hostile A, is the
 *  follow-up decided on #83 (resolution-only advances become provisional). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { PERSON_AUTHENTICATION_SCHEMA, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { canonicalBytes, sha256Hex } from '../../src/canonical.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { FOUNDATION_STORE_SCHEMA } from '../../src/foundation/persistence.ts';
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
  /** The wallet holds `held`, the head of the owner's own verified log; the resolver serves `served`. */
  const authenticate = async (served: IdentityState, key: KeyPair, held: IdentityState = f.identity) => {
    const i = f.intent(), challenge = await f.db.transaction(tx => f.adapter.issueChallenge(tx, { organization_id: f.organization_id, person_id: f.person.id, intent: i, grant_id: f.personGrant.id }));
    const resolution = (await issueResolution(served, { identity_id: f.person.id, audience: f.config.audience, challenge: challenge.nonce }, key, Date.now())).proof;
    return f.store.execute(f.organization_id, await signPersonOperation({ intent: i, actor: f.person, grant_id: f.personGrant.id, challenge, resolution }, [f.ordinary], held) as unknown as JsonObject);
  };
  const push = (log: IdentityLog) => f.db.transaction(tx => f.adapter.receiveIdentityLogPush(tx, { message: { format: IDENTITY_LOG_PUSH_FORMAT, log }, require_attestation: false }));
  const row = async () => { const r = (await f.db.query<{ resolver_epoch: string; sequence: string }>('select resolver_epoch,sequence from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.config.host_id, f.person.id]))[0]; return { epoch: Number(r.resolver_epoch), sequence: Number(r.sequence) }; };
  return { pg, ...f, resolverB, escape, fabricated, authenticate, push, row };
}

for (const [name, sequence, wasRefusedAs] of [['far ahead', 1_000_000, 'behind'], ['at the next sequence', 1, 'conflict']] as const) {
  test(`a resolution over a fabricated head ${name} is refused by the wallet, and the owner's escape is admitted (was \`${wasRefusedAs}\`)`, async () => {
    const f = await setup(); try {
      await f.authenticate(f.identity, f.resolver);
      await assert.rejects(f.authenticate(await f.fabricated(sequence), f.resolver), /resolution head is not the head this wallet holds/);
      assert.deepEqual(await f.row(), { epoch: 0, sequence: 0 }, 'the checkpoint stays at a head the owner signed');
      const { state, log } = await f.escape();
      assert.equal((await f.push(log)).outcome, 'advanced');
      await f.authenticate(state, f.resolverB, state);
      assert.deepEqual(await f.row(), { epoch: 1, sequence: 1 });
      await assert.rejects(f.authenticate(f.identity, f.resolver), /resolver authority mismatch/, 'the former resolver is refused after the move, even by a device still holding the old head');
    } finally { await f.pg.close(); }
  });
}

test('signPersonOperation refuses a held head for another identity, a held head whose digest does not match, and a stale held head', async () => {
  const f = await setup(); try {
    const i = f.intent(), challenge = await f.issue(i), resolution = await f.proof(challenge);
    const sign = (held: { head: Control; head_digest: string }) => signPersonOperation({ intent: i, actor: f.person, grant_id: f.personGrant.id, challenge, resolution }, [f.ordinary], held);
    const other = structuredClone(f.identity.head); other.identity_id = crypto.randomUUID();
    await assert.rejects(sign({ head: other, head_digest: await sha256Hex(canonicalBytes(other)) }), /resolution head is not the head this wallet holds/);
    await assert.rejects(sign({ head: f.identity.head, head_digest: 'b'.repeat(64) }), /held identity head digest mismatch/);
    const { state } = await f.escape();
    await assert.rejects(sign(state), /resolution head is not the head this wallet holds/, 'a wallet past the resolved head does not sign over its old head');
    assert.equal((await sign(f.identity)).authentication.signatures.length, 1);
  } finally { await f.pg.close(); }
});
