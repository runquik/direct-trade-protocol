// Desired invariants from an adversarial reviewer. A failure is a release blocker,
// not an expected-gap observation to be relabeled as success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Command, Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand, signToken } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const isDenied = (error: any) => [401, 403, 404, 409, 422].includes(error?.status);

async function fixture() {
  let state = emptyState();
  const ctx: Context = { audience: 'http://review.invalid', storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  // Synthetic test admission authority, explicitly separate from federation trust.
  ctx.assessmentPins = { [ctx.audience]: ctx.storeKey.keyId };
  const expires = new Date(ctx.now + 86400000).toISOString();
  const send = async (command: Command) => {
    const transaction = structuredClone(state);
    const result = await execute(transaction, command, ctx);
    state = transaction;
    return result;
  };
  const command = async (actor: Actor, action: string, org: string | null, payload: Record<string, any>, extra: KeyPair[] = []) =>
    signCommand(draftCommand(ctx.audience, actor, action, org, payload, ctx.now), [actor.key, ...extra]);
  const call = async (actor: Actor, action: string, org: string | null, payload: Record<string, any>, extra: KeyPair[] = []) =>
    send(await command(actor, action, org, payload, extra));
  const enroll = async () => {
    const key = await generateKeyPair(); const actor = { id: await personId(key.keyId), key };
    await call(actor, 'person.register', null, { keys: [key.keyId] }); return actor;
  };
  const owner = await enroll(), worker = await enroll(), outsider = await enroll();
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await call(owner, 'organization.create', org, { name: 'Private payroll company', nonce, controllers: [owner.id], threshold: 1 });
  const invitation_id = crypto.randomUUID();
  await call(owner, 'membership.invite', org, { invitation_id, person_id: worker.id, permissions: [], expires_at: expires });
  await call(worker, 'membership.accept', org, { invitation_id });
  const grant = (actor: Actor, actions: string[]) => ({ person_id: actor.id, actions, resource_ids: '*', expires_at: expires });
  const policy = async (workerActions: string[] = ['read', 'write']) => {
    const policy_id = crypto.randomUUID();
    await call(owner, 'policy.create', org, { policy_id, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1,
      grants: [grant(owner, ['read', 'write', 'export']), ...(workerActions.length ? [grant(worker, workerActions)] : [])] });
    return policy_id;
  };
  const publish = async (name: string, semantics = 'structural', schema: any = { type: 'object', properties: { message: { type: 'string', maxLength: 200 } }, required: ['message'], additionalProperties: false }) => {
    const contract = { publisher_id: org, name, version: '1.0.0', schema, semantics, dependencies: [] };
    const hash = await digest(contract);
    const { publisher_id: _, ...payload } = contract;
    await call(owner, 'profile.publish', org, { ...payload, visibility: 'private', readers: [], digest: hash });
    return hash;
  };
  const appendCommand = async (actor: Actor, policy_id: string, profile_digest: string, resource_id = crypto.randomUUID(), body: any = { message: 'synthetic confidential payload' }) => {
    const id = crypto.randomUUID();
    return command(actor, 'record.append', org, { id, root_id: id, supersedes: null, organization_id: org, policy_id, resource_id, profile_digest, counterparty_ids: [], body });
  };
  const install = async (profiles: string[], policy_id: string, assessmentExpires = expires) => {
    const artifact_digest = 'a'.repeat(64);
    const assessment = await signToken({ kind: 'module-assessment', issuer: ctx.audience, artifact_digest, outcome: 'approved',
      issued_at: new Date(ctx.now).toISOString(), expires_at: assessmentExpires }, ctx);
    const release = await call(owner, 'release.publish', org, { module_id: crypto.randomUUID(), version: '1.0.0', artifact_digest,
      profiles, actions: ['read', 'write'], visibility: 'private', assessment });
    const actor = { id: crypto.randomUUID(), key: await generateKeyPair() };
    await call(owner, 'installation.create', org, { installation_id: actor.id, release_digest: release.digest, key_id: actor.key.keyId,
      policy_ids: [policy_id], actions: ['read', 'write'], mode: 'interactive', expires_at: expires }, [actor.key]);
    return { ...actor, assessmentDigest: await digest(assessment) };
  };
  const moduleCall = async (actor: Actor, action: string, payload: Record<string, any>) => {
    const c = draftCommand(ctx.audience, actor, action, org, payload, ctx.now);
    c.actor.kind = 'installation'; c.requested_by = worker.id;
    return send(await signCommand(c, [actor.key, worker.key]));
  };
  return { ctx, expires, owner, worker, outsider, org, call, command, send, policy, publish, grant, appendCommand, install, moduleCall };
}

test('review: registered outsiders cannot enumerate private organization metadata through empty data pages', async () => {
  const f = await fixture();
  for (const action of ['records.list', 'workspace.view']) {
    await assert.rejects(f.call(f.outsider, action, f.org, { after: 0, limit: 10, profile_digests: [] }), isDenied);
  }
});

test('review: a module cannot fetch a readable record in an undeclared release profile', async () => {
  const f = await fixture(), policy = await f.policy(), alpha = await f.publish('alpha'), beta = await f.publish('beta');
  const append = await f.appendCommand(f.owner, policy, beta);
  await f.send(append);
  const module = await f.install([alpha], policy);
  await assert.rejects(f.moduleCall(module, 'record.get', { id: append.payload.id, profile_digest: beta }), isDenied);
});

test('review: module list profile filtering intersects installation release declarations', async () => {
  const f = await fixture(), policy = await f.policy(), alpha = await f.publish('alpha'), beta = await f.publish('beta');
  await f.send(await f.appendCommand(f.owner, policy, alpha));
  await f.send(await f.appendCommand(f.owner, policy, beta));
  const module = await f.install([alpha], policy);
  try {
    const page = await f.moduleCall(module, 'records.list', { after: 0, limit: 10, profile_digests: [alpha, beta] });
    assert.ok(page.records.every((record: any) => record.profile_digest === alpha), 'undeclared profile escaped module scope');
  } catch (error) { assert.ok(isDenied(error), `unexpected failure: ${String(error)}`); }
});

test('review: inventory writes cannot substitute an accessible policy for the stock pool policy', async () => {
  const f = await fixture(), protectedPolicy = await f.policy([]), alternatePolicy = await f.policy();
  const pool = crypto.randomUUID(), product = crypto.randomUUID();
  await f.call(f.owner, 'inventory.create', f.org, { policy_id: protectedPolicy, pool_id: pool, product_id: product, base_unit: 'unit' });
  const schema = JSON.parse(readFileSync(new URL('../../../spec/v0.4/fixtures/inventory-v1.schema.json', import.meta.url), 'utf8'));
  const profile = await f.publish('stock', 'inventory-v1', schema);
  const body = { company_id: f.org, pool_id: pool, source_id: 'scanner-a', observation_id: 'scan-a', expected_revision: 0,
    occurred_at: new Date(f.ctx.now).toISOString(), kind: 'receive', quantity: '10', unit: 'unit' };
  await assert.rejects(f.send(await f.appendCommand(f.worker, alternatePolicy, profile, pool, body)), isDenied);
});

test('review: exact write replay does not return full stored records after read permission is revoked', async () => {
  const f = await fixture(), policy = await f.policy(), profile = await f.publish('alpha');
  const append = await f.appendCommand(f.worker, policy, profile);
  await f.send(append);
  await f.call(f.owner, 'policy.update', f.org, { policy_id: policy, expected_revision: 1, classification: 'business', stewards: [f.owner.id], threshold: 1,
    grants: [f.grant(f.owner, ['read', 'write', 'export']), f.grant(f.worker, ['write'])] });
  try {
    const result = await f.send(append);
    assert.ok(!Object.hasOwn(result, 'body') && !Object.hasOwn(result, 'command'), 'write receipt returned a readable signed body after read revocation');
  } catch (error) { assert.ok(isDenied(error), `unexpected failure: ${String(error)}`); }
});

test('review: inherited prototype names return controlled invalid/not-found errors, never TypeError', async () => {
  const f = await fixture();
  for (const digest of ['constructor', '__proto__', 'toString']) {
    await assert.rejects(f.call(f.worker, 'profile.get', f.org, { digest }), (error: any) => [400, 403, 404, 422].includes(error?.status));
  }
});

test('review: a structural-only module cannot bypass profile scope through the derived inventory endpoint', async () => {
  const f = await fixture(), policy = await f.policy(), structural = await f.publish('notes');
  const pool_id = crypto.randomUUID();
  await f.call(f.owner, 'inventory.create', f.org, { policy_id: policy, pool_id, product_id: crypto.randomUUID(), base_unit: 'unit' });
  const module = await f.install([structural], policy);
  await assert.rejects(f.moduleCall(module, 'inventory.get', { policy_id: policy, pool_id }), isDenied);
});

test('review: host federation trust alone does not authorize an artifact security assessment', async () => {
  const f = await fixture(), policy = await f.policy(), profile = await f.publish('notes');
  f.ctx.pins[f.ctx.audience] = f.ctx.storeKey.keyId;
  f.ctx.assessmentPins = {};
  await assert.rejects(f.install([profile], policy), isDenied);
});

test('review: already-installed modules stop when their exact artifact assessment expires', async () => {
  const f = await fixture(), policy = await f.policy(), profile = await f.publish('notes');
  const append = await f.appendCommand(f.owner, policy, profile); await f.send(append);
  const module = await f.install([profile], policy, new Date(f.ctx.now + 60000).toISOString());
  await f.moduleCall(module, 'record.get', { id: append.payload.id, profile_digest: profile });
  f.ctx.now += 61000;
  await assert.rejects(f.moduleCall(module, 'record.get', { id: append.payload.id, profile_digest: profile }), isDenied);
});

test('review: revoking an assessment disables its installed artifact without deleting business records', async () => {
  const f = await fixture(), policy = await f.policy(), profile = await f.publish('notes');
  const append = await f.appendCommand(f.owner, policy, profile); await f.send(append);
  const module = await f.install([profile], policy);
  f.ctx.revokedAssessments = [module.assessmentDigest];
  await assert.rejects(f.moduleCall(module, 'record.get', { id: append.payload.id, profile_digest: profile }), isDenied);
  const retained = await f.call(f.owner, 'record.get', f.org, { id: append.payload.id, profile_digest: profile });
  assert.equal(retained.body.message, 'synthetic confidential payload');
});
