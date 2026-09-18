import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { signIdentity, transitionIdentity } from '../../src/foundation/identity.ts';
import type { JsonObject } from '../../src/foundation/semantics.ts';
import { personAuthenticationFixture } from './person-authentication-fixture.ts';
async function setup(threshold = 1) {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA); await pg.exec(PERSON_AUTHENTICATION_SCHEMA);
  try { return { pg, ...await personAuthenticationFixture(pgliteDb(pg), threshold) }; } catch (e) { await pg.close(); throw e; }
}
test('real resolver proof and operational quorum authenticate a person and atomically consume the challenge', async () => {
  const f = await setup(); try {
    const request = await f.personRequest(), receipt = await f.run(request);
    assert.deepEqual(receipt.actor, f.person);
    assert.match(request.authentication.challenge.nonce, /^[0-9a-f]{64}$/);
    const row = (await f.db.query<{ binding: any; deadline_ms: string; consumed_at: string }>('select binding,deadline_ms,consumed_at from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.config.host_id, request.authentication.challenge.nonce]))[0];
    assert.deepEqual(row.binding, request.authentication.challenge);
    assert.ok(Number(row.deadline_ms) <= request.authentication.resolution.body.expires_at);
    assert.ok(Number(row.consumed_at) > 0);
    await assert.rejects(f.run(request), /already consumed/);
    assert.equal((await f.authority()).grants.find(g => g.grant.id === f.personGrant.id)!.used[0].amount, '2');
  } finally { await f.pg.close(); }
});
test('historical business retry accepts fresh identity authentication but never a changed intent or grant', async () => {
  const f = await setup(); try {
    const original = await f.personRequest(), receipt = await f.run(original), calls = f.state.handlerCalls;
    const retry = await f.personRequest(original.intent);
    assert.notEqual(retry.authentication.challenge.nonce, original.authentication.challenge.nonce);
    assert.deepEqual(await f.run(retry), receipt); assert.equal(f.state.handlerCalls, calls);
    const changed = structuredClone(original.intent); changed.parameters.quantity = 1;
    await assert.rejects(f.run(await f.personRequest(changed)), /operation ID conflict/);
    const differentGrant = { ...f.personGrant, id: crypto.randomUUID() }; f.state.now = Date.now();
    await f.store.govern(f.organization_id, { action: 'grant', grant: differentGrant }, f.controller);
    const challenge = await f.issue(original.intent, f.organization_id, differentGrant.id);
    const swap = await signPersonOperation({ intent: original.intent, actor: f.person, grant_id: differentGrant.id, challenge, resolution: await f.proof(challenge) }, [f.ordinary]);
    await assert.rejects(f.run(swap), /operation ID conflict/);
  } finally { await f.pg.close(); }
});
test('bad operational quorum, duplicate key, recovery key and wrong-purpose signatures fail without consuming', async () => {
  const f = await setup(2); try {
    const one = await f.personRequest(f.intent(), [f.ordinary]); await assert.rejects(f.run(one), /quorum/);
    const duplicated = structuredClone(one); duplicated.authentication.signatures.push(duplicated.authentication.signatures[0]);
    await assert.rejects(f.run(duplicated), /duplicate/);
    await assert.rejects(f.run(await f.personRequest(f.intent(), [f.recovery])), /not a current operational/);
    const wrongPurpose = await f.personRequest(); wrongPurpose.authentication.signatures = wrongPurpose.authentication.resolution.signatures;
    await assert.rejects(f.run(wrongPurpose), /not a current operational/);
    const signedOtherDomain = await signIdentity('DTP-IDENTITY-RESOLUTION-1', one.intent, [f.ordinary, f.second]);
    const forged = structuredClone(one); forged.authentication.signatures = signedOtherDomain.signatures;
    await assert.rejects(f.run(forged), /invalid person operation signature/);
    const n = (await f.db.query<{ n: number }>('select count(*)::int as n from dtp_foundation.person_auth_challenges where host_id=$1 and consumed_at is not null', [f.config.host_id]))[0].n;
    assert.equal(n, 0);
    await f.run(await f.personRequest());
  } finally { await f.pg.close(); }
});
test('organization, person, audience, grant and intent are immutable challenge/signature bindings', async () => {
  const f = await setup(); try {
    const valid = await f.personRequest();
    for (const mutate of [
      (r: typeof valid) => { r.authentication.challenge.organization_id = crypto.randomUUID(); },
      (r: typeof valid) => { r.actor.id = crypto.randomUUID(); },
      (r: typeof valid) => { r.authentication.challenge.audience = 'https://other.example'; },
      (r: typeof valid) => { r.grant_id = crypto.randomUUID(); },
      (r: typeof valid) => { r.intent.parameters.quantity = 1; },
      (r: typeof valid) => { r.authentication.challenge.expires_at += 1; },
    ]) { const r = structuredClone(valid); mutate(r); await assert.rejects(f.run(r)); }
    await f.run(valid);
  } finally { await f.pg.close(); }
});
test('resolver key/epoch pins and durable head checkpoint reject replacement and rollback across organizations', async () => {
  const f = await setup(); try {
    const valid = await f.personRequest();
    const wrongPin = createPersonAuthentication({ ...f.config, identities: [{ ...f.config.identities[0], resolver_key: f.next.keyId }] });
    await assert.rejects(f.db.transaction(tx => wrongPin.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now(), request: valid as unknown as JsonObject })), /untrusted resolver signature/);
    const epoch = structuredClone(valid); epoch.authentication.resolution.body.resolver_epoch = 1;
    epoch.authentication.resolution = await signIdentity('DTP-IDENTITY-RESOLUTION-1', epoch.authentication.resolution.body, [f.resolver]);
    await assert.rejects(f.run(epoch), /resolver authority mismatch/);
    // A pinned resolver equivocation/stale lease must not undo a control checkpoint learned elsewhere.
    const moved = await transitionIdentity(f.identity, await signIdentity('DTP-IDENTITY-TRANSITION-1', {
      identity_id: f.person.id, expected_digest: f.identity.head_digest, sequence: 1, kind: 'rotate', operational: { keys: [f.next.keyId], threshold: 1 },
      recovery: f.identity.head.recovery, issued_at: Date.now() - 9000, expires_at: Date.now() + 60000,
    }, [f.ordinary, f.next]), Date.now() - 9000);
    const otherOrg = crypto.randomUUID(), otherIntent = f.intent(); otherIntent.organization_id = otherOrg;
    otherIntent.resources = otherIntent.resources.map(r => ({ ...r, organization_id: otherOrg }));
    const c = await f.issue(otherIntent, otherOrg), resolution = await f.proof(c, moved);
    const higher = await signPersonOperation({ intent: otherIntent, actor: f.person, grant_id: f.personGrant.id, challenge: c, resolution }, [f.next]);
    await f.db.transaction(async tx => {
      const verified = await f.adapter.authenticateOperation(tx, { organization_id: otherOrg, now: Date.now(), request: higher as unknown as JsonObject });
      await f.adapter.beforeCommit(tx, { organization_id: otherOrg, now: Date.now(), verified, request: higher as unknown as JsonObject, valid_until: Date.now() + 60000 });
    });
    await assert.rejects(f.run(valid), /control rollback/);
    const head = (await f.db.query<{ sequence: string; digest: string }>('select sequence,digest from dtp_foundation.person_auth_checkpoints where host_id=$1 and person_id=$2', [f.config.host_id, f.person.id]))[0];
    assert.equal(Number(head.sequence), 1); assert.equal(head.digest, moved.head_digest);
  } finally { await f.pg.close(); }
});
test('a failed business transaction rolls back challenge consumption and permits the same signed request', async () => {
  const f = await setup(); try {
    const request = await f.personRequest();
    const failed = createFoundationStore(f.db, { ...f.options, hooks: { ...f.options.hooks, approveUsage: async () => { throw Error('synthetic business failure'); } } });
    await assert.rejects(failed.execute(f.organization_id, request as unknown as JsonObject), /business failure/);
    const row = (await f.db.query<{ consumed_at: string | null }>('select consumed_at from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.config.host_id, request.authentication.challenge.nonce]))[0];
    assert.equal(row.consumed_at, null); assert.equal((await f.counts()).business_receipts, 0);
    await f.run(request);
  } finally { await f.pg.close(); }
});
test('deferred actual database-clock deadline rejects commit and rolls back business effects and consumption', async () => {
  const f = await setup(); try {
    const request = await f.personRequest(), before = await f.counts();
    const bad = createFoundationStore(f.db, { ...f.options, hooks: { ...f.options.hooks, beforeCommit: async (tx, input) => {
      await f.adapter.beforeCommit(tx, input);
      // No sleep or fake clock: force an already-expired deadline after every JS check.
      await tx.query('update dtp_foundation.person_auth_challenges set deadline_ms=0 where host_id=$1 and nonce=$2', [f.config.host_id, request.authentication.challenge.nonce]);
    } } });
    await assert.rejects(bad.execute(f.organization_id, request as unknown as JsonObject), /deadline expired before commit/);
    assert.deepEqual(await f.counts(), before);
    const row = (await f.db.query<{ consumed_at: string | null }>('select consumed_at from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.config.host_id, request.authentication.challenge.nonce]))[0];
    assert.equal(row.consumed_at, null); await f.run(request);
  } finally { await f.pg.close(); }
});
test('late authorization, clock skew and a consumed proof from another transaction are rejected', async () => {
  const f = await setup(); try {
    const request = await f.personRequest();
    await assert.rejects(f.db.transaction(tx => f.adapter.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now() + 10000, request: request as unknown as JsonObject })), /clock skew/);
    await assert.rejects(f.db.transaction(async tx => {
      const verified = await f.adapter.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now(), request: request as unknown as JsonObject });
      await f.adapter.beforeCommit(tx, { organization_id: f.organization_id, now: Date.now(), verified, request: request as unknown as JsonObject, valid_until: Date.now() + 1000 });
    }), /deadline expired/);
    const receipt = await f.run(request);
    await assert.rejects(f.db.transaction(tx => f.adapter.beforeCommit(tx, { organization_id: f.organization_id, now: Date.now(), verified: { actor: receipt.actor, intent: request.intent, grant_id: request.grant_id }, request: request as unknown as JsonObject, valid_until: Date.now() + 60000 })), /this transaction consumed request/);
  } finally { await f.pg.close(); }
});
test('fresh local clock sampling rejects real skew and regression, not an old admission timestamp', async () => {
  const f = await setup(); try {
    const request = await f.personRequest();
    const skewed = createPersonAuthentication(f.config, { now: () => Date.now() + 10000 });
    await assert.rejects(f.db.transaction(tx => skewed.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now(), request: request as unknown as JsonObject })), /clock skew/);
    let samples = 0;
    const regressed = createPersonAuthentication(f.config, { now: () => Date.now() - (++samples >= 3 ? 2000 : 0) });
    await assert.rejects(f.db.transaction(tx => regressed.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now(), request: request as unknown as JsonObject })), /clock regressed/);
    const oldAdmission = Date.now() - 5000;
    await f.db.transaction(async tx => {
      const verified = await f.adapter.authenticateOperation(tx, { organization_id: f.organization_id, now: oldAdmission, request: request as unknown as JsonObject });
      await f.adapter.beforeCommit(tx, { organization_id: f.organization_id, now: oldAdmission, verified, request: request as unknown as JsonObject, valid_until: Date.now() + 60000 });
    });
    const row = (await f.db.query<{ consumed_at: string | null }>('select consumed_at from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [f.config.host_id, request.authentication.challenge.nonce]))[0];
    assert.notEqual(row.consumed_at, null);
  } finally { await f.pg.close(); }
});
test('challenge issuer capacity is finite and service/unsafe inputs cannot use person authentication', async () => {
  const f = await setup(); try {
    const i = f.intent();
    for (let n = 0; n < 16; n++) await f.issue(i);
    await assert.rejects(f.issue(i), /person challenge capacity/);
    await f.db.query('update dtp_foundation.person_auth_issuers set issued_count=4096 where host_id=$1', [f.config.host_id]);
    await assert.rejects(f.issue(i), /capacity exhausted/);
    const unsafe = JSON.parse('{"__proto__":1}');
    await assert.rejects(f.db.transaction(tx => f.adapter.issueChallenge(tx, unsafe)), /invalid identity field/);
    assert.throws(() => createPersonAuthentication({ ...f.config, identities: [] }), /explicit person/);
    let getterInvoked = false;
    const hostileContext = { get organization_id() { getterInvoked = true; return f.organization_id; } };
    await assert.rejects(f.db.transaction(tx => f.adapter.beforeCommit(tx, hostileContext as any)), /data fields/);
    assert.equal(getterInvoked, false);
  } finally { await f.pg.close(); }
  const g = await setup(); try {
    const request = await g.personRequest(); (request.actor as any) = { kind: 'service', id: g.person.id, organization_id: g.organization_id };
    await assert.rejects(g.run(request), /only person/);
  } finally { await g.pg.close(); }
});
