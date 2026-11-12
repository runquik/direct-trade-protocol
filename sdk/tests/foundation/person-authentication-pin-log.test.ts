// Owner decision 2026-11-08 on #159, item 3: a relying party that advances its pin from a resolution fetches and
// keeps the identity log up to the new pin, and does not advance if it cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { issueResolution, signIdentity, transitionIdentity } from '../../src/foundation/identity.ts';
import type { IdentityState, Transition } from '../../src/foundation/identity.ts';
import { advancePinByResolution, buildIdentityLog, verifyIdentityHistory } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogEntry } from '../../src/foundation/identity-log.ts';
import type { JsonObject } from '../../src/foundation/semantics.ts';
import { personAuthenticationFixture } from './person-authentication-fixture.ts';

async function setup() {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA); await pg.exec(PERSON_AUTHENTICATION_SCHEMA);
  const f = await personAuthenticationFixture(pgliteDb(pg));
  async function rotate(from: IdentityState, to: KeyPair, signer: KeyPair, at: number): Promise<{ state: IdentityState; entry: IdentityLogEntry }> {
    const command = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: f.person.id, expected_digest: from.head_digest, sequence: from.head.sequence + 1, kind: 'rotate',
      operational: { keys: [to.keyId], threshold: 1 }, recovery: from.head.recovery, issued_at: at - 500, expires_at: at + 299_500 }, [signer, to]);
    const state = await transitionIdentity(from, command, at);
    return { state, entry: { effective_at: state.head.effective_at, transition: command, rehome: null, attestation: null } };
  }
  const now = Date.now(), second = await generateKeyPair(), one = await rotate(f.identity, f.next, f.ordinary, now), two = await rotate(one.state, second, f.next, now + 1);
  const log = (entries: IdentityLogEntry[], key: KeyPair | null = f.resolver) => buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, ...entries] }, key);
  const authenticate = async (state: IdentityState, signers: KeyPair[], adapter = f.adapter) => {
    const store = adapter === f.adapter ? f.store : createFoundationStore(f.db, { ...f.options, hooks: { ...f.options.hooks, authenticateOperation: adapter.authenticateOperation, beforeCommit: adapter.beforeCommit } });
    const i = f.intent(), challenge = await f.db.transaction(tx => adapter.issueChallenge(tx, { organization_id: f.organization_id, person_id: f.person.id, intent: i, grant_id: f.personGrant.id }));
    const resolution = (await issueResolution(state, { identity_id: f.person.id, audience: f.config.audience, challenge: challenge.nonce }, f.resolver, Date.now())).proof;
    const request = await signPersonOperation({ intent: i, actor: f.person, grant_id: f.personGrant.id, challenge, resolution }, signers, state);
    return { request, receipt: store.execute(f.organization_id, request as unknown as JsonObject) };
  };
  const row = async () => {
    const r = (await f.db.query<{ sequence: string; digest: string; log: IdentityLog | null }>('select sequence,digest,log from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.config.host_id, f.person.id]))[0];
    return { sequence: Number(r.sequence), digest: r.digest, log: r.log };
  };
  const consumed = async (nonce: string) => (await f.db.query<{ consumed_at: string | null }>('select consumed_at from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.config.host_id, nonce]))[0].consumed_at !== null;
  return { pg, ...f, one, two, second, log, authenticate, row, consumed };
}

test('a resolution above the checkpoint advances it only with the log up to the resolved head, and the adapter keeps that log beside the checkpoint', async () => {
  const f = await setup(); try {
    const { receipt: atPin } = await f.authenticate(f.identity, [f.ordinary]); await atPin;
    assert.equal(f.fetched.length, 0, 'a resolution at the checkpoint fetches nothing');
    assert.equal((await f.row()).log, null, 'the configured pin has no history yet');
    // The host serves a log that runs past the resolved head; the adapter keeps it cut off at that head.
    f.serveIdentityLog(await f.log([f.one.entry, f.two.entry]));
    const { receipt } = await f.authenticate(f.one.state, [f.next]); await receipt;
    assert.deepEqual(f.fetched, [{ identity_id: f.person.id, resolver_id: f.resolverId, resolver_epoch: 0, sequence: 1, head_digest: f.one.state.head_digest }]);
    const r = await f.row();
    assert.equal(r.sequence, 1); assert.equal(r.digest, f.one.state.head_digest);
    assert.ok(r.log !== null); assert.equal(r.log.entries.length, 2);
    const kept = await verifyIdentityHistory(r.log);
    assert.equal(kept.head_digest, f.one.state.head_digest, 'the kept log ends exactly at the checkpoint');
  } finally { await f.pg.close(); }
});

test('without the log, or with a log that cannot carry the pin to the resolved head, the checkpoint does not advance and the resolution authenticates nobody', async () => {
  const f = await setup(); try {
    await (await f.authenticate(f.identity, [f.ordinary])).receipt; const before = await f.row();
    const refused = async (why: string, pattern: RegExp, adapter = f.adapter) => {
      const { request, receipt } = await f.authenticate(f.one.state, [f.next], adapter);
      await assert.rejects(receipt, pattern, why);
      assert.deepEqual(await f.row(), before, `${why}: the checkpoint is unchanged`);
      assert.equal(await f.consumed(request.authentication.challenge.nonce), false, `${why}: the challenge is not consumed`);
    };
    await refused('no fetcher configured', /required to advance the pin/, createPersonAuthentication(f.config));
    f.serveIdentityLog(null); await refused('the host cannot serve the log', /required to advance the pin/);
    f.serveIdentityLog(await f.log([])); await refused('a log that ends before the resolved head', /does not contain the resolved head/);
    const rival = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { ...f.one.entry.transition!.body, operational: { keys: [f.second.keyId], threshold: 1 } }, [f.ordinary, f.second]);
    const rivalState = await transitionIdentity(f.identity, rival, f.one.state.head.effective_at);
    f.serveIdentityLog(await f.log([{ ...f.one.entry, effective_at: rivalState.head.effective_at, transition: rival }]));
    await refused('a log whose head at that sequence is another one', /does not contain the resolved head/);
    f.serveIdentityLog(await f.log([f.one.entry], null)); await refused('a log whose current epoch is unattested (#159, item 2)', /attestation required/);
    const fetcherThrows = createPersonAuthentication(f.config, { now: Date.now, fetchIdentityLog: async () => { throw new Error('host unreachable'); } });
    await refused('the fetch fails', /host unreachable/, fetcherThrows);
    // The same resolution authenticates once the log is served.
    f.serveIdentityLog(await f.log([f.one.entry]));
    const { receipt } = await f.authenticate(f.one.state, [f.next]); await receipt;
    assert.equal((await f.row()).sequence, 1);
  } finally { await f.pg.close(); }
});

test('advancePinByResolution: the kept log ends at the resolved head; another identity, a head in a later epoch and a missing log are refused', async () => {
  const f = await setup(); try {
    const pin = { identity_id: f.person.id, resolver_id: f.resolverId, resolver_key: f.resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: f.identity.head_digest };
    const full = await f.log([f.one.entry, f.two.entry]);
    const advanced = await advancePinByResolution(pin, { sequence: 2, head_digest: f.two.state.head_digest }, full);
    assert.equal(advanced.outcome, 'advanced'); assert.equal(advanced.pin.minimum_sequence, 2); assert.equal(advanced.log.entries.length, 3);
    const unchanged = await advancePinByResolution(pin, { sequence: 0, head_digest: f.identity.head_digest }, full);
    assert.equal(unchanged.outcome, 'unchanged'); assert.equal(unchanged.log.entries.length, 1);
    // Continuing from the kept history: the next advance is judged against it.
    const next = await advancePinByResolution(pin, { sequence: 1, head_digest: f.one.state.head_digest }, full);
    assert.equal((await advancePinByResolution(next.pin, { sequence: 2, head_digest: f.two.state.head_digest }, full, next.log)).pin.minimum_digest, f.two.state.head_digest);
    await assert.rejects(advancePinByResolution(pin, { sequence: 1, head_digest: f.one.state.head_digest }, null), /required to advance the pin/);
    await assert.rejects(advancePinByResolution({ ...pin, identity_id: crypto.randomUUID() }, { sequence: 1, head_digest: f.one.state.head_digest }, full), /another identity/);
    await assert.rejects(advancePinByResolution(pin, { sequence: 3, head_digest: f.two.state.head_digest }, full), /does not contain the resolved head/);
    await assert.rejects(advancePinByResolution(pin, { sequence: 1, head_digest: 'x' } as never, full), /invalid resolved head/);
    // A head the log reaches only after a move is not a resolution advance: it is a move, admitted from the log.
    const resolverB = await generateKeyPair(), at = Date.now() + 2;
    const rehome = await signIdentity('DTP-IDENTITY-REHOME-1', { identity_id: f.person.id, expected_digest: f.one.state.head_digest, sequence: 2, from: { resolver_id: f.resolverId, resolver_epoch: 0 },
      to: { resolver_id: crypto.randomUUID(), resolver_key: resolverB.keyId, audience: 'https://resolver-b.example', resolver_epoch: 1 }, issued_at: at - 500, expires_at: at + 299_500 }, [f.recovery]);
    const moved = await buildIdentityLog({ ...f.parts, entries: [...f.parts.entries, f.one.entry, { effective_at: at, transition: null, rehome: rehome as never, attestation: null }] }, resolverB);
    const movedHead = (await verifyIdentityHistory(moved)).head_digest;
    await assert.rejects(advancePinByResolution(pin, { sequence: 2, head_digest: movedHead }, moved), /not in the pinned epoch/);
  } finally { await f.pg.close(); }
});
