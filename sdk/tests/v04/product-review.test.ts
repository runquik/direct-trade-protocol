// Independent desired-invariant product probes, not expected-gap tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDtpStore } from '../../scripts/dtp-v04-dev-server.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { draftCommand, signCommand, signToken } from '../../src/v04/wire.ts';
import { Client, person, company, profile, policy, grant, record, expiry } from './helpers.ts';

test('product review: list, export and workspace reject unknown consumer profiles explicitly', async () => {
  const store = await createDtpStore();
  try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    for (const action of ['records.list', 'records.export', 'workspace.view']) {
      const response = await client.act(owner, action, org, { after: 0, limit: 10, profile_digests: ['f'.repeat(64)] });
      assert.equal(response.status, 422, `${action}: unsupported profile must not masquerade as an empty business dataset`);
      assert.equal(response.error.code, 'unsupported_profile');
    }
  } finally { await store.close(); }
});

test('product review: derived inventory requires every contributing exact profile, not just its semantic family', async () => {
  const assessorKey = await generateKeyPair(), issuer = 'https://review-assessor.example.test';
  const store = await createDtpStore({ assessmentPins: { [issuer]: assessorKey.keyId } });
  try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const pol = await policy(client, owner, org, [grant(owner)]);
    const schema = JSON.parse(readFileSync(new URL('../../../spec/v0.4/fixtures/inventory-v1.schema.json', import.meta.url), 'utf8'));
    const alpha = await profile(client, owner, org, schema, 'inventory-v1');
    const beta = await profile(client, owner, org, schema, 'inventory-v1');
    const pool_id = crypto.randomUUID();
    await client.ok(owner, 'inventory.create', org, { pool_id, policy_id: pol, product_id: crypto.randomUUID(), base_unit: 'unit' });
    const event = (revision: number, observation: string) => ({ company_id: org, pool_id, source_id: 'review-scanner', observation_id: observation, expected_revision: revision, occurred_at: new Date().toISOString(), kind: 'receive', quantity: '7', unit: 'unit' });
    await client.ok(owner, 'record.append', org, record(org, pol, pool_id, alpha, event(0, 'alpha')));
    await client.ok(owner, 'record.append', org, record(org, pol, pool_id, beta, event(1, 'beta-private-observation')));
    async function install(profiles: string[]) {
      const artifact_digest = 'a'.repeat(64);
      const assessment = await signToken({ kind: 'module-assessment', issuer, issued_at: new Date().toISOString(), expires_at: expiry(), artifact_digest, outcome: 'approved' }, { audience: issuer, storeKey: assessorKey, pins: {}, now: Date.now() });
      const release = await client.ok(owner, 'release.publish', org, { module_id: crypto.randomUUID(), version: '1.0.0', artifact_digest, profiles, actions: ['read'], visibility: 'private', assessment });
      const installation = { id: crypto.randomUUID(), key: await generateKeyPair() };
      await client.ok(owner, 'installation.create', org, { installation_id: installation.id, release_digest: release.digest, key_id: installation.key.keyId, policy_ids: [pol], actions: ['read'], mode: 'interactive', expires_at: expiry() }, [installation.key]);
      return installation;
    }
    async function poolAs(installation: Awaited<ReturnType<typeof install>>) {
      const command = draftCommand(client.audience, owner, 'inventory.get', org, { policy_id: pol, pool_id });
      command.actor = { kind: 'installation', id: installation.id, key_id: installation.key.keyId };
      return client.send(await signCommand(command, [installation.key, owner.key]));
    }
    assert.equal((await poolAs(await install([alpha, beta]))).status, 200, 'fully scoped module can read aggregate');
    const denied = await poolAs(await install([alpha]));
    assert.ok([403, 404, 422].includes(denied.status), `partial profile module received aggregate: ${JSON.stringify(denied)}`);
    assert.equal(denied.result, undefined, 'denial does not return derived business data');
  } finally { await store.close(); }
});
