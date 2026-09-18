import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../../../supabase/functions/dtp-store/db.ts';
import { FOUNDATION_STORE_SCHEMA, createFoundationStore } from '../../src/foundation/persistence.ts';
import { PERSON_AUTHENTICATION_SCHEMA, createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { signIdentity } from '../../src/foundation/identity.ts';
import { personReviewFixture, asJson } from './person-authentication-review-fixture.ts';

async function fixture(threshold = 1) {
  const pg = new PGlite(); await pg.exec(FOUNDATION_STORE_SCHEMA); await pg.exec(PERSON_AUTHENTICATION_SCHEMA);
  try { return { pg, ...await personReviewFixture(pgliteDb(pg), threshold) }; } catch (e) { await pg.close(); throw e; }
}
test('independent person auth: altered organization/person/grant/intent/audience/proof cannot consume challenge', async () => {
  const f = await fixture(); try {
    const request = await f.request(), before = await f.counts();
    for (const mutate of [
      (r: typeof request) => { r.actor.id = crypto.randomUUID(); },
      (r: typeof request) => { r.grant_id = crypto.randomUUID(); },
      (r: typeof request) => { r.intent.parameters.quantity = 1; },
      (r: typeof request) => { r.authentication.challenge.organization_id = crypto.randomUUID(); },
      (r: typeof request) => { r.authentication.challenge.audience = 'https://other.example'; },
      (r: typeof request) => { r.authentication.resolution.body.expires_at--; },
      (r: typeof request) => { r.authentication.resolution.body.challenge = 'f'.repeat(64); },
    ]) {
      const modified = structuredClone(request); mutate(modified); await assert.rejects(f.store.execute(f.organization_id, asJson(modified)));
      assert.equal((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null); assert.deepEqual(await f.counts(), before);
    }
    await f.store.execute(f.organization_id, asJson(request)); assert.notEqual((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null);
  } finally { await f.pg.close(); }
});

test('independent person auth: operational threshold excludes recovery, duplicate signatures and wrong signing purpose', async () => {
  const f = await fixture(2); try {
    const one = await f.request(f.unsigned(), [f.operational]); await assert.rejects(f.store.execute(f.organization_id, asJson(one)), /quorum/);
    const duplicate = structuredClone(one); duplicate.authentication.signatures.push(duplicate.authentication.signatures[0]); await assert.rejects(f.store.execute(f.organization_id, asJson(duplicate)), /duplicate/);
    const recovery = await signPersonOperation({ intent: one.intent, actor: f.actor, grant_id: f.grant.id, challenge: one.authentication.challenge, resolution: one.authentication.resolution }, [f.operational, f.recovery]);
    await assert.rejects(f.store.execute(f.organization_id, asJson(recovery)), /current operational key/);
    const wrongPurpose = structuredClone(one); wrongPurpose.authentication.signatures = (await signIdentity('DTP-IDENTITY-RESOLUTION-1', one.intent, [f.operational, f.second])).signatures;
    await assert.rejects(f.store.execute(f.organization_id, asJson(wrongPurpose)), /invalid person operation signature/);
    const valid = await signPersonOperation({ intent: one.intent, actor: f.actor, grant_id: f.grant.id, challenge: one.authentication.challenge, resolution: one.authentication.resolution }, [f.operational, f.second]);
    await f.store.execute(f.organization_id, asJson(valid)); assert.equal((await f.counts()).business_receipts, 1);
  } finally { await f.pg.close(); }
});

test('independent person auth: fresh clock sampling rejects both real skew directions and ambiguous or regressing samples without consuming', async () => {
  const f = await fixture(); try {
    const request = await f.request(), before = await f.counts();
    for (const offset of [-10000, 10000]) {
      const auth = createPersonAuthentication(f.authOptions, { now: () => Date.now() + offset });
      await assert.rejects(f.db.transaction(tx => auth.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now() - 20000, request: asJson(request) })), /clock skew/);
    }
    for (const [offset, error] of [[2000, /sample roundtrip exceeded/], [-2000, /clock regressed/]] as const) {
      let calls = 0;
      const auth = createPersonAuthentication(f.authOptions, { now: () => Date.now() + (++calls >= 3 ? offset : 0) });
      await assert.rejects(f.db.transaction(tx => auth.authenticateOperation(tx, { organization_id: f.organization_id, now: Date.now() - 20000, request: asJson(request) })), error);
    }
    assert.equal((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null); assert.deepEqual(await f.counts(), before);
    await f.store.execute(f.organization_id, asJson(request));
  } finally { await f.pg.close(); }
});

test('independent person auth: business rollback restores nonce and checkpoint; successful historical retry needs fresh authentication', async () => {
  const f = await fixture(); try {
    const request = await f.request(), before = await f.counts();
    const failed = createFoundationStore(f.db, { ...f.storeOptions, hooks: { ...f.storeOptions.hooks, beforeCommit: async (tx, input) => { await f.auth.beforeCommit(tx, input); await tx.query('select 1/0'); } } });
    await assert.rejects(failed.execute(f.organization_id, asJson(request)), (e: any) => e.code === '22012'); assert.deepEqual(await f.counts(), before);
    assert.equal((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null);
    assert.deepEqual(await f.db.query('select person_id from dtp_foundation.person_auth_checkpoints where host_id=$1', [f.host_id]), []);
    const receipt = await f.store.execute(f.organization_id, asJson(request)), calls = f.state.handlerCalls;
    await assert.rejects(f.store.execute(f.organization_id, asJson(request)), /already consumed/);
    const fresh = await f.request({ intent: request.intent, actor: f.actor, grant_id: f.grant.id });
    assert.deepEqual(await f.store.execute(f.organization_id, asJson(fresh)), receipt); assert.equal(f.state.handlerCalls, calls); assert.equal((await f.counts()).business_receipts, 1);
  } finally { await f.pg.close(); }
});

test('independent person auth: genuinely resolver-signed expired/wrong-audience proofs still fail bound verification', async () => {
  const f = await fixture(); try {
    for (const mutate of [
      (b: any) => { b.issued_at = Date.now() - 31000; b.expires_at = Date.now() - 1001; },
      (b: any) => { b.audience = 'https://wrong.example'; },
      (b: any) => { b.resolver_epoch = 1; },
    ]) {
      const request = await f.request(f.unsigned(), [f.operational], async proof => { const body = structuredClone(proof.body); mutate(body); return signIdentity('DTP-IDENTITY-RESOLUTION-1', body, [f.resolver]); });
      await assert.rejects(f.store.execute(f.organization_id, asJson(request))); assert.equal((await f.consumed(request.authentication.challenge.nonce))[0].consumed_at, null);
    }
    assert.equal((await f.counts()).business_receipts, 0);
  } finally { await f.pg.close(); }
});

test('independent person auth: beforeCommit refuses the right request from a different transaction', async () => {
  const f = await fixture(); try {
    const request = await f.request(); await f.store.execute(f.organization_id, asJson(request));
    await assert.rejects(f.db.transaction(tx => f.auth.beforeCommit(tx, { organization_id: f.organization_id, now: Date.now(),
      verified: { intent: request.intent, actor: request.actor, grant_id: request.grant_id }, request: asJson(request), valid_until: f.grant.expires_at })), /this transaction consumed/);
  } finally { await f.pg.close(); }
});
