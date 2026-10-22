// GAP OBSERVATION (red team, surface 6 — privacy and compartments).
//
// Every business record the host appends is stamped with `seq`, taken from a
// single host-global counter (`State.next_seq`, incremented in
// `sdk/src/v04/engine.ts` record.append). That `seq` is returned to the caller
// on record.append, record.get, records.list/workspace.view and as
// `next_cursor`. Because the counter is shared across every organization and
// every policy compartment on the host, the gaps between a caller's own
// consecutive `seq` values count the records that everyone else — other
// tenants, and other compartments of the caller's own company — committed in
// between. A caller that cannot read any of those records can still count them.
//
// These tests assert the CURRENT (leaky) behaviour so CI stays green and the
// gap stays visible; see the linked finding issue. They are not a claim that
// the behaviour is desired. The assertions flip once a host stops exposing a
// cross-compartment-observable global sequence (e.g. a per-company sequence, or
// metadata that does not reveal inter-tenant ordering).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Command, Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const expiryFrom = (now: number) => new Date(now + 86400000).toISOString();
const object = (properties: any, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

async function host() {
  let state = emptyState();
  const ctx: Context = { audience: 'http://seq-gap.invalid', storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const send = async (c: Command) => { const t = structuredClone(state); const r = await execute(t, c, ctx); state = t; return r; };
  const call = async (a: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) =>
    send(await signCommand(draftCommand(ctx.audience, a, action, org, payload, ctx.now), [a.key, ...extra]));
  const enroll = async () => { const key = await generateKeyPair(); const a = { id: await personId(key.keyId), key }; await call(a, 'person.register', null, { keys: [key.keyId] }); return a; };
  return { ctx, call, enroll };
}

// One company owner, one shared profile, returns an append helper per policy/resource.
async function company(h: Awaited<ReturnType<typeof host>>, owner: Actor, name: string) {
  const { ctx, call } = h;
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await call(owner, 'organization.create', org, { name, nonce, controllers: [owner.id], threshold: 1 });
  const contract = { publisher_id: org, name: 'note-' + crypto.randomUUID(), version: '1.0.0', schema: object({ note: { type: 'string', maxLength: 100 } }), semantics: 'structural', dependencies: [] };
  const dg = await digest(contract); const { publisher_id: _p, ...pl } = contract;
  await call(owner, 'profile.publish', org, { ...pl, digest: dg, visibility: 'private', readers: [] });
  const makePolicy = async (stewards: Actor[], grantees: Actor[]) => {
    const policy_id = crypto.randomUUID();
    await call(owner, 'policy.create', org, {
      policy_id, expected_revision: 0, classification: 'business',
      stewards: stewards.map(s => s.id), threshold: stewards.length,
      grants: grantees.map(g => ({ person_id: g.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: expiryFrom(ctx.now) })),
    }, stewards.filter(s => s.id !== owner.id).map(s => s.key));
    return policy_id;
  };
  const append = async (actor: Actor, policy_id: string) => {
    const id = crypto.randomUUID();
    const r = await call(actor, 'record.append', org, { id, root_id: id, supersedes: null, organization_id: org, policy_id, resource_id: crypto.randomUUID(), profile_digest: dg, counterparty_ids: [], body: { note: 'x' } });
    return r.seq as number;
  };
  return { org, dg, makePolicy, append };
}

test('cross-tenant: an unrelated company counts a victim company\'s hidden writes via the shared seq', async () => {
  const h = await host();
  const alice = await h.enroll(), bob = await h.enroll();
  const victim = await company(h, alice, 'Company A (victim)');
  const observer = await company(h, bob, 'Company B (observer)');
  const victimPolicy = await victim.makePolicy([alice], [alice]);
  const observerPolicy = await observer.makePolicy([bob], [bob]);

  // Bob has no membership, grant or counterparty relationship with Company A:
  // he cannot read, list or get any of A's records.
  const b1 = await observer.append(bob, observerPolicy);
  const hidden = 7;
  for (let i = 0; i < hidden; i++) await victim.append(alice, victimPolicy);
  const b2 = await observer.append(bob, observerPolicy);

  const inferred = b2 - b1 - 1;
  console.log(`cross-tenant: observer saw seq ${b1} then ${b2}; inferred hidden writes = ${inferred} (victim wrote ${hidden})`);
  assert.equal(inferred, hidden, 'observer recovers the victim\'s exact hidden write count from the global seq');
});

test('cross-compartment: a member of one policy counts writes to a policy it cannot read', async () => {
  const h = await host();
  const owner = await h.enroll(), clerk = await h.enroll();
  const co = await company(h, owner, 'One company, two compartments');
  // Make the clerk a bare member so grants/stewardship can name it.
  const invitation_id = crypto.randomUUID();
  await h.call(owner, 'membership.invite', co.org, { invitation_id, person_id: clerk.id, permissions: [], expires_at: expiryFrom(h.ctx.now) });
  await h.call(clerk, 'membership.accept', co.org, { invitation_id });
  // "sales" compartment: the clerk is a steward and grantee (can read/write).
  const sales = await co.makePolicy([owner, clerk], [owner, clerk]);
  // "payroll" compartment: owner only. The clerk has no stewardship and no grant,
  // so SPEC §5 forbids the clerk reading, listing or exporting any payroll record.
  const payroll = await co.makePolicy([owner], [owner]);

  const c1 = await co.append(clerk, sales);
  const payrollRuns = 4;
  for (let i = 0; i < payrollRuns; i++) await co.append(owner, payroll);
  const c2 = await co.append(clerk, sales);

  const inferred = c2 - c1 - 1;
  console.log(`cross-compartment: clerk saw seq ${c1} then ${c2}; inferred payroll writes = ${inferred} (owner wrote ${payrollRuns})`);
  assert.equal(inferred, payrollRuns, 'clerk recovers the payroll compartment\'s write count it is not allowed to read');
});
