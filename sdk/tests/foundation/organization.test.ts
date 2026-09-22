import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { ORGANIZATION_GENESIS_DOMAIN, organizationGenesisDigest, organizationGovernance, organizationId, parseOrganizationGenesis } from '../../src/foundation/organization.ts';
import type { OrganizationGenesis } from '../../src/foundation/organization.ts';
import { createAuthorityState } from '../../src/foundation/authority.ts';

const file = fileURLToPath(new URL('../../../spec/vectors/organization-identity.json', import.meta.url));
const vectors = parseUntrustedJson(readFileSync(file, 'utf8')) as {
  domain: string; accept: { why: string; genesis: OrganizationGenesis; preimage: string; genesis_digest: string; organization_id: string }[];
  reject: { why: string; genesis: OrganizationGenesis }[] };
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', nonce = '0f0e0d0c-0b0a-4908-8706-050403020100';

test('organization conformance vectors: preimage, digest and id', async () => {
  assert.equal(vectors.domain, ORGANIZATION_GENESIS_DOMAIN);
  assert.ok(vectors.accept.length >= 5 && vectors.reject.length >= 12);
  for (const v of vectors.accept) {
    // The digest is recomputed from the published preimage by a second implementation of SHA-256.
    assert.equal(createHash('sha256').update(v.preimage, 'utf8').digest('hex'), v.genesis_digest, v.why);
    assert.equal(await organizationGenesisDigest(v.genesis), v.genesis_digest, v.why);
    assert.equal(await organizationId(v.genesis), v.organization_id, v.why);
    const h = v.genesis_digest;
    assert.equal(v.organization_id, `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`, v.why);
  }
  assert.equal(new Set(vectors.accept.map(v => v.organization_id)).size, vectors.accept.length, 'every accepted genesis is a distinct organization');
  for (const v of vectors.reject) await assert.rejects(organizationId(v.genesis), v.why);
});

test('organization vectors are reproducible from their generator', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/build-organization-vectors.ts', import.meta.url)), '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('the id commits to the initial governance, so a rival starting point is a different organization', async () => {
  const genesis = { nonce, founder: a, controllers: [a], threshold: 1 };
  const rival = { nonce, founder: a, controllers: [a, b], threshold: 1 };
  assert.notEqual(await organizationId(genesis), await organizationId(rival));
  const governance = await organizationGovernance({ nonce, founder: a, controllers: [a, b], threshold: 2 });
  assert.equal(governance.organization_id, await organizationId({ nonce, founder: a, controllers: [a, b], threshold: 2 }));
  assert.deepEqual(governance.controllers, [{ kind: 'person', id: a, organization_id: null }, { kind: 'person', id: b, organization_id: null }]);
  assert.equal(createAuthorityState([governance]).governance[0].threshold, 2, 'accepted by the authority layer unchanged');
});

test('organization genesis is detached plain data: accessors and later caller changes have no effect', async () => {
  const genesis = { nonce, founder: a, controllers: [a], threshold: 1 }, parsed = parseOrganizationGenesis(genesis);
  genesis.controllers.push(b); assert.deepEqual(parsed.controllers, [a]);
  let reads = 0; const trap = { nonce, founder: a, controllers: [a], get threshold() { reads++; return 1; } };
  await assert.rejects(organizationId(trap)); assert.equal(reads, 0);
});
