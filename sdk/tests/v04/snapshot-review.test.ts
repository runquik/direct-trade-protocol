import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Command, Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { buildSnapshot, validateSnapshot } from '../../src/v04/snapshot.ts';
import { digest, draftCommand, organizationId, personId, signCommand, signToken } from '../../src/v04/wire.ts';

async function sourceFixture() {
  let state = emptyState();
  const ctx: Context = { audience: 'https://snapshot-review.test', storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const ownerKey = await generateKeyPair(), outsiderKey = await generateKeyPair();
  const owner = { id: await personId(ownerKey.keyId), key: ownerKey }, outsider = { id: await personId(outsiderKey.keyId), key: outsiderKey };
  const call = async (actor: typeof owner, action: string, org: string | null, payload: any, extraKeys: KeyPair[] = []) => {
    const candidate = structuredClone(state);
    const result = await execute(candidate, await signCommand(draftCommand(ctx.audience, actor, action, org, payload, ctx.now), [actor.key, ...extraKeys]), ctx);
    state = candidate; return result;
  };
  for (const actor of [owner, outsider]) await call(actor, 'person.register', null, { keys: [actor.key.keyId] });
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await call(owner, 'organization.create', org, { name: 'Snapshot review synthetic company', nonce, controllers: [owner.id], threshold: 1 });
  const policy = crypto.randomUUID(), resource = crypto.randomUUID();
  await call(owner, 'policy.create', org, { policy_id: policy, expected_revision: 0, classification: 'personnel', stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: new Date(ctx.now + 86400000).toISOString() }] });
  const contract = { publisher_id: org, name: 'personnel-fixture', version: '1.0.0', semantics: 'structural', dependencies: [],
    schema: { type: 'object', properties: { note: { type: 'string', maxLength: 200 } }, required: ['note'], additionalProperties: false } };
  const profile = await digest(contract), { publisher_id: _, ...payload } = contract;
  await call(owner, 'profile.publish', org, { ...payload, visibility: 'private', readers: [], digest: profile });
  const id = crypto.randomUUID();
  await call(owner, 'record.append', org, { id, root_id: id, supersedes: null, organization_id: org, policy_id: policy,
    resource_id: resource, profile_digest: profile, counterparty_ids: [], body: { note: 'Synthetic personnel canary, no actual employee data' } });
  const snapshot = () => buildSnapshot(state, org, ctx);
  const outsiderHistory = () => structuredClone(state.persons[outsider.id]);
  const resignAsOutsider = async (command: Command) => {
    const forged = structuredClone(command);
    forged.actor = { kind: 'person', id: outsider.id, key_id: outsider.key.keyId }; forged.requested_by = outsider.id;
    return signCommand(forged, [outsider.key]);
  };
  return { ctx, owner, outsider, org, policy, resource, profile, call, snapshot, outsiderHistory, resignAsOutsider, state: () => structuredClone(state) };
}
const rejected = (snapshot: any) => assert.rejects(validateSnapshot(emptyState(), snapshot), (error: any) => [400, 403, 409, 422].includes(error?.status));

test('snapshot review: genuine signed fixture validates and unrelated company identity is not exported', async () => {
  const f = await sourceFixture(), snapshot = f.snapshot();
  assert.deepEqual(snapshot.persons.map(person => person.id), [f.owner.id]);
  await validateSnapshot(emptyState(), snapshot);
});

test('snapshot review: a valid signature from a never-associated person cannot become company record authority', async () => {
  const f = await sourceFixture(), snapshot = f.snapshot();
  snapshot.persons.push(f.outsiderHistory());
  snapshot.records[0].command = await f.resignAsOutsider(snapshot.records[0].command);
  await rejected(snapshot);
});

test('snapshot review: owned profile publication cannot be attributed to a never-associated signer', async () => {
  const f = await sourceFixture(), snapshot = f.snapshot();
  snapshot.persons.push(f.outsiderHistory());
  snapshot.profiles[0].command = await f.resignAsOutsider(snapshot.profiles[0].command);
  await rejected(snapshot);
});

test('snapshot review: a grant cannot invent membership for a person never associated with this company', async () => {
  const f = await sourceFixture(), snapshot = f.snapshot();
  snapshot.persons.push(f.outsiderHistory());
  const policy = snapshot.policies[0];
  policy.grants[0].person_id = f.outsider.id;
  const command = structuredClone(policy.history[0]); command.payload.grants = structuredClone(policy.grants);
  policy.history[0] = await signCommand(command, [f.owner.key]);
  await rejected(snapshot);
});

test('snapshot review: losing migration preparations can be cancelled after a different destination wins', async () => {
  const f = await sourceFixture();
  const destinationKey = await generateKeyPair(), losingKey = await generateKeyPair();
  f.ctx.pins['https://winner.test'] = destinationKey.keyId; f.ctx.pins['https://loser.test'] = losingKey.keyId;
  const winner = await f.call(f.owner, 'migration.prepare', f.org, { destination: { audience: 'https://winner.test', key_id: destinationKey.keyId } });
  const loser = await f.call(f.owner, 'migration.prepare', f.org, { destination: { audience: 'https://loser.test', key_id: losingKey.keyId } });
  const manifest = winner.body.manifest;
  // Synthetic destination readiness isolates source routing; full upload/readiness
  // validation is covered by the separate migration HTTP and snapshot suites.
  const ready = await signToken({ kind: 'migration-ready', issuer: 'https://winner.test', issued_at: new Date(f.ctx.now).toISOString(), expires_at: manifest.expires_at,
    manifest_hash: await digest(manifest), migration_id: manifest.migration_id, organization_id: f.org, generation: manifest.generation,
    source: manifest.source, destination: manifest.destination, snapshot_hash: manifest.snapshot_hash },
  { audience: 'https://winner.test', storeKey: destinationKey, pins: {}, now: f.ctx.now });
  await f.call(f.owner, 'migration.commit', f.org, { migration_id: manifest.migration_id, ready });
  const cancellation = await f.call(f.owner, 'migration.cancel', f.org, { migration_id: loser.body.manifest.migration_id });
  assert.equal(cancellation.body.kind, 'migration-cancel');
  assert.equal(cancellation.body.migration_id, loser.body.manifest.migration_id);
});

test('snapshot review: independently allocated installation IDs cannot alias at migration destination', async () => {
  const source = await sourceFixture(), destination = await sourceFixture(), installation_id = crypto.randomUUID();
  for (const f of [source, destination]) {
    f.ctx.assessmentPins = { [f.ctx.audience]: f.ctx.storeKey.keyId };
    const artifact_digest = 'c'.repeat(64), expires_at = new Date(f.ctx.now + 86400000).toISOString();
    const assessment = await signToken({ kind: 'module-assessment', issuer: f.ctx.audience, issued_at: new Date(f.ctx.now).toISOString(), expires_at,
      artifact_digest, outcome: 'approved' }, f.ctx);
    const release = await f.call(f.owner, 'release.publish', f.org, { module_id: crypto.randomUUID(), version: '1.0.0', artifact_digest,
      profiles: [f.profile], actions: ['read'], visibility: 'private', assessment });
    const moduleKey = await generateKeyPair();
    await f.call(f.owner, 'installation.create', f.org, { installation_id, release_digest: release.digest, key_id: moduleKey.keyId,
      policy_ids: [f.policy], actions: ['read'], mode: 'interactive', expires_at }, [moduleKey]);
  }
  const snapshot = source.snapshot();
  await validateSnapshot(emptyState(), snapshot);
  await assert.rejects(validateSnapshot(destination.state(), snapshot), (error: any) => error?.code === 'conflict');
});
