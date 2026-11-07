// SPEC section 5 and section 7 (#110, owner decision 2026-11-04, document only): a private profile's full `readers` list and the
// publisher's signed `profile.publish` command are visible to every listed reader, and travel in every business-evidence token
// whose closure includes the profile. This pins that behaviour with more than one reader. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };

async function host(audience: string) {
  let state = emptyState();
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const send = async (input: any) => { const candidate = structuredClone(state); try { const r = await execute(candidate, input, ctx); state = candidate; return { ok: true as const, r }; } catch (e: any) { return { ok: false as const, code: e.code, status: e.status }; } };
  const call = async (a: Actor, action: string, org: string | null, payload: any) => send(await signCommand(draftCommand(audience, a, action, org, payload, ctx.now), [a.key]));
  const person = async () => { const key = await generateKeyPair(), a = { key, id: await personId(key.keyId) }; assert.ok((await call(a, 'person.register', null, { keys: [key.keyId] })).ok); return a; };
  const company = async (owner: Actor) => { const nonce = crypto.randomUUID(), id = await organizationId(owner.id, nonce); assert.ok((await call(owner, 'organization.create', id, { name: 'Synthetic Co', nonce, controllers: [owner.id], threshold: 1 })).ok); return id; };
  return { ctx, call, person, company };
}

test('a private profile\'s readers list and publishing command are visible to every reader and to evidence recipients (SPEC sections 5 and 7, #110)', async () => {
  const source = await host('https://readers-source.test'), destination = await host('https://readers-destination.test');
  source.ctx.pins[destination.ctx.audience] = destination.ctx.storeKey.keyId; destination.ctx.pins[source.ctx.audience] = source.ctx.storeKey.keyId;
  const publisher = await source.person(), alice = await source.person(), bob = await source.person(), eve = await source.person();
  const P = await source.company(publisher), R1 = await source.company(alice), R2 = await source.company(bob), O = await source.company(eve);
  const contract = { publisher_id: P, name: 'synthetic.price-sheet', version: '1.0.0', schema: { type: 'object', properties: { note: { type: 'string', maxLength: 200 } }, required: ['note'], additionalProperties: false }, dependencies: [], semantics: 'structural' };
  const d = await digest(contract), { publisher_id: _, ...payload } = contract;
  assert.ok((await source.call(publisher, 'profile.publish', P, { ...payload, digest: d, visibility: 'private', readers: [R1, R2] })).ok);

  // Each reader receives the whole publication: the other reader, and the publishing member's signed command.
  for (const [actor, org] of [[alice, R1], [bob, R2]] as const) {
    const got = await source.call(actor, 'profile.get', org, { digest: d });
    assert.ok(got.ok);
    assert.deepEqual(got.r.readers, [R1, R2]);
    assert.equal(got.r.command.actor.id, publisher.id);
    assert.equal(got.r.command.signatures.length, 1);
  }
  // A company that is not listed still learns nothing: the access check is unchanged.
  const outsider = await source.call(eve, 'profile.get', O, { digest: d });
  assert.equal(outsider.ok, false); if (!outsider.ok) assert.equal(outsider.code, 'not_found');

  // Evidence whose closure includes the profile carries the same publication, because inspection verifies it.
  const policy_id = crypto.randomUUID(), expires = new Date(source.ctx.now + 86400000).toISOString();
  assert.ok((await source.call(publisher, 'policy.create', P, { policy_id, expected_revision: 0, classification: 'business', stewards: [publisher.id], threshold: 1, grants: [{ person_id: publisher.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: expires }] })).ok);
  const id = crypto.randomUUID();
  assert.ok((await source.call(publisher, 'record.append', P, { id, root_id: id, supersedes: null, organization_id: P, policy_id, resource_id: crypto.randomUUID(), profile_digest: d, counterparty_ids: [], body: { note: 'SYNTHETIC' } })).ok);
  const recipientOwner = await destination.person(), D = await destination.company(recipientOwner);
  const issued = await source.call(publisher, 'evidence.issue', P, { record_ids: [id], recipient: { organization_id: D, audience: destination.ctx.audience, policy_id: crypto.randomUUID(), resource_id: crypto.randomUUID() }, purpose: 'Synthetic review', expires_at: new Date(source.ctx.now + 60000).toISOString() });
  assert.ok(issued.ok, JSON.stringify(issued));
  const carried = issued.r.body.profiles.find((p: any) => p.digest === d);
  assert.deepEqual(carried.readers, [R1, R2]);
  assert.equal(carried.command.actor.id, publisher.id);
});
