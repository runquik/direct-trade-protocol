// Record sequences are per organization (#71). The gaps between a caller's own
// `seq` values used to count every other company's writes on the host, because
// one host-global counter numbered them all. Each organization now has its own
// counter; the order and volume of writes across compartments *within* one
// organization are not hidden (SPEC §6). Replaces gap test #70.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Command, Context, State } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { buildSnapshot } from '../../src/v04/snapshot.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const expiryFrom = (now: number) => new Date(now + 86400000).toISOString();
const object = (properties: any, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

async function host() {
  const h = { state: emptyState() as State, ctx: undefined as unknown as Context, call: undefined as any, enroll: undefined as any };
  h.ctx = { audience: 'http://record-seq.invalid', storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const send = async (c: Command) => { const t = structuredClone(h.state); const r = await execute(t, c, h.ctx); h.state = t; return r; };
  h.call = async (a: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) =>
    send(await signCommand(draftCommand(h.ctx.audience, a, action, org, payload, h.ctx.now), [a.key, ...extra]));
  h.enroll = async (): Promise<Actor> => { const key = await generateKeyPair(); const a = { id: await personId(key.keyId), key }; await h.call(a, 'person.register', null, { keys: [key.keyId] }); return a; };
  return h;
}

async function company(h: Awaited<ReturnType<typeof host>>, owner: Actor, name: string) {
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await h.call(owner, 'organization.create', org, { name, nonce, controllers: [owner.id], threshold: 1 });
  const contract = { publisher_id: org, name: 'note-' + crypto.randomUUID(), version: '1.0.0', schema: object({ note: { type: 'string', maxLength: 100 } }), semantics: 'structural', dependencies: [] };
  const dg = await digest(contract); const { publisher_id: _p, ...pl } = contract;
  await h.call(owner, 'profile.publish', org, { ...pl, digest: dg, visibility: 'private', readers: [] });
  const makePolicy = async (stewards: Actor[], grantees: Actor[]) => {
    const policy_id = crypto.randomUUID();
    await h.call(owner, 'policy.create', org, {
      policy_id, expected_revision: 0, classification: 'business',
      stewards: stewards.map(s => s.id), threshold: stewards.length,
      grants: grantees.map(g => ({ person_id: g.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: expiryFrom(h.ctx.now) })),
    }, stewards.filter(s => s.id !== owner.id).map(s => s.key));
    return policy_id;
  };
  const append = async (actor: Actor, policy_id: string) => {
    const id = crypto.randomUUID();
    const r = await h.call(actor, 'record.append', org, { id, root_id: id, supersedes: null, organization_id: org, policy_id, resource_id: crypto.randomUUID(), profile_digest: dg, counterparty_ids: [], body: { note: 'x' } });
    return r.seq as number;
  };
  return { org, dg, makePolicy, append };
}

test('cross-tenant: another company\'s writes leave no gap in a company\'s own sequence', async () => {
  const h = await host();
  const alice = await h.enroll(), bob = await h.enroll();
  const victim = await company(h, alice, 'Company A');
  const observer = await company(h, bob, 'Company B');
  const victimPolicy = await victim.makePolicy([alice], [alice]);
  const observerPolicy = await observer.makePolicy([bob], [bob]);

  const b1 = await observer.append(bob, observerPolicy);
  const victimSeqs: number[] = [];
  for (let i = 0; i < 7; i++) victimSeqs.push(await victim.append(alice, victimPolicy));
  const b2 = await observer.append(bob, observerPolicy);

  assert.deepEqual([b1, b2], [1, 2], 'the observer\'s sequence counts only its own records');
  assert.deepEqual(victimSeqs, [1, 2, 3, 4, 5, 6, 7], 'the other company numbers its records from 1 too');
  const listed = await h.call(bob, 'records.list', observer.org, { after: 0, limit: 10, profile_digests: [observer.dg], kinds: [] });
  assert.deepEqual(listed.records.map((r: any) => r.seq), [1, 2]);
});

test('cross-compartment: within one company the sequence is shared across policies, as SPEC §6 states', async () => {
  const h = await host();
  const owner = await h.enroll(), clerk = await h.enroll();
  const co = await company(h, owner, 'One company, two compartments');
  const invitation_id = crypto.randomUUID();
  await h.call(owner, 'membership.invite', co.org, { invitation_id, person_id: clerk.id, permissions: [], expires_at: expiryFrom(h.ctx.now) });
  await h.call(clerk, 'membership.accept', co.org, { invitation_id });
  const sales = await co.makePolicy([owner, clerk], [owner, clerk]);
  const payroll = await co.makePolicy([owner], [owner]);

  const c1 = await co.append(clerk, sales);
  for (let i = 0; i < 4; i++) await co.append(owner, payroll);
  const c2 = await co.append(clerk, sales);
  // Option (b) of #71 closes the cross-tenant channel only; this documents what stays visible.
  assert.equal(c2 - c1 - 1, 4);
});

test('a store written before per-organization sequences continues after the company\'s highest seq', async () => {
  const h = await host();
  const alice = await h.enroll(), bob = await h.enroll();
  const a = await company(h, alice, 'Company A'), b = await company(h, bob, 'Company B');
  const pa = await a.makePolicy([alice], [alice]), pb = await b.makePolicy([bob], [bob]);
  await a.append(alice, pa); await b.append(bob, pb);
  // Rewrite the store into its earlier shape: one host-global numbering and no per-company counters.
  const legacy: any = h.state;
  const ordered = Object.values(h.state.records).sort((x, y) => x.organization_id === a.org ? -1 : y.organization_id === a.org ? 1 : 0);
  ordered.forEach((r, i) => { r.seq = 10 + i * 5; });
  delete legacy.record_seq; legacy.next_seq = 99;
  const highestB = Math.max(...Object.values(h.state.records).filter(r => r.organization_id === b.org).map(r => r.seq));

  assert.equal(await b.append(bob, pb), highestB + 1);
  assert.equal(await b.append(bob, pb), highestB + 2);
  // The export renumbers 1..n, so earlier global numbers do not travel with the company.
  const snap = buildSnapshot(h.state, b.org, h.ctx);
  assert.deepEqual(snap.records.map(r => r.seq), [1, 2, 3]);
});

test('an exhausted company sequence refuses the write with 507 capacity and changes nothing', async () => {
  const h = await host();
  const alice = await h.enroll();
  const a = await company(h, alice, 'Company A');
  const pa = await a.makePolicy([alice], [alice]);
  await a.append(alice, pa);
  h.state.record_seq[a.org] = Number.MAX_SAFE_INTEGER;
  const before = JSON.stringify(h.state);
  await assert.rejects(a.append(alice, pa), (e: any) => e.code === 'capacity' && e.status === 507);
  assert.equal(JSON.stringify(h.state), before);
});
