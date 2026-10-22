// Conformance: spec/vectors/requested-by.json, the requester rule of SPEC.md section 2 (#54).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand, signToken } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const vectors = JSON.parse(readFileSync(new URL('../../../spec/vectors/requested-by.json', import.meta.url), 'utf8'));
const audience = 'https://requested-by.test';

async function host(mode: string | undefined, sponsor = 'owner', sponsorRevoked = false) {
  let state = emptyState();
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  ctx.assessmentPins = { [audience]: ctx.storeKey.keyId };
  const send = async (input: any) => { const candidate = structuredClone(state); const result = await execute(candidate, input, ctx); state = candidate; return result; };
  const call = async (actor: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) =>
    send(await signCommand(draftCommand(audience, actor, action, org, payload, ctx.now), [actor.key, ...extra]));
  const newPerson = async () => { const key = await generateKeyPair(); return { key, id: await personId(key.keyId) }; };
  const person = async () => { const actor = await newPerson(); await call(actor, 'person.register', null, { keys: [actor.key.keyId] }); return actor; };
  const owner = await person(), member = await person(), outsider = await person();
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce), expires = new Date(ctx.now + 86400000).toISOString();
  await call(owner, 'organization.create', org, { name: 'Synthetic requester company', nonce, controllers: [owner.id], threshold: 1 });
  const invitation_id = crypto.randomUUID();
  await call(owner, 'membership.invite', org, { invitation_id, person_id: member.id, permissions: sponsor === 'member' ? ['installations.manage'] : [], expires_at: expires });
  await call(member, 'membership.accept', org, { invitation_id });
  const people: Record<string, Actor> = { owner, member, outsider };
  let installation: Actor | undefined, profile: string | undefined;
  if (mode) {
    const policy_id = crypto.randomUUID(), grant = (p: Actor) => ({ person_id: p.id, actions: ['read'], resource_ids: '*', expires_at: expires });
    await call(owner, 'policy.create', org, { policy_id, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1, grants: [grant(owner), grant(member)] });
    const contract = { publisher_id: org, name: 'requester.notes', version: '1.0.0', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, dependencies: [], semantics: 'structural' };
    profile = await digest(contract);
    const { publisher_id: _, ...payload } = contract;
    await call(owner, 'profile.publish', org, { ...payload, digest: profile, visibility: 'private', readers: [] });
    const artifact_digest = 'd'.repeat(64), assessment = await signToken({ kind: 'module-assessment', issuer: audience, issued_at: new Date(ctx.now).toISOString(), expires_at: expires, artifact_digest, outcome: 'approved' }, ctx);
    const release = await call(owner, 'release.publish', org, { module_id: crypto.randomUUID(), version: '1.0.0', artifact_digest, profiles: [profile], actions: ['read'], visibility: 'private', assessment });
    installation = { id: crypto.randomUUID(), key: await generateKeyPair() };
    await call(people[sponsor], 'installation.create', org, { installation_id: installation.id, release_digest: release.digest, key_id: installation.key.keyId, policy_ids: [policy_id], actions: ['read'], mode, expires_at: expires }, [installation.key]);
    if (sponsorRevoked) await call(owner, 'membership.revoke', org, { person_id: people[sponsor].id });
  }
  return { ctx, org, people, installation, profile, newPerson, send };
}

async function run(v: any) {
  const h = await host(v.mode, v.sponsor, v.sponsor_revoked);
  const actor: Actor = v.actor === 'installation' ? h.installation! : v.actor === 'new person' ? await h.newPerson() : h.people[v.actor];
  const payload = v.action === 'person.register' ? { keys: [actor.key.keyId] } : v.action === 'records.list' ? { after: 0, limit: 10, profile_digests: [h.profile], kinds: [] } : {};
  const c = draftCommand(audience, actor, v.action, ['person.register', 'organizations.list'].includes(v.action) ? null : h.org, payload, h.ctx.now);
  if (v.actor === 'installation') c.actor.kind = 'installation';
  c.requested_by = v.requested_by === null ? null : v.requested_by === 'actor' ? actor.id : h.people[v.requested_by].id;
  try { await h.send(await signCommand(c, [actor.key, ...v.co_signers.map((p: string) => h.people[p].key)])); return 'accept'; }
  catch (error: any) { assert.ok(error?.code, `unexpected failure: ${error?.stack ?? error}`); return { code: error.code, status: error.status }; }
}

test('requested_by vectors cover both actor kinds, both installation modes and both outcomes', () => {
  const cases = vectors.cases as any[];
  assert.ok(cases.some(v => v.actor === 'installation' && v.mode === 'interactive') && cases.some(v => v.actor === 'installation' && v.mode === 'automation'));
  assert.ok(cases.some(v => v.expected === 'accept') && cases.some(v => v.expected !== 'accept'));
  assert.ok(cases.some(v => v.mode === 'automation' && v.requested_by === null && v.sponsor_revoked && v.expected !== 'accept'));
  assert.equal(new Set(cases.map(v => v.name)).size, cases.length);
});

for (const v of vectors.cases) {
  test(`requested_by vector: ${v.name}`, async () => { assert.deepEqual(await run(v), v.expected); });
}
