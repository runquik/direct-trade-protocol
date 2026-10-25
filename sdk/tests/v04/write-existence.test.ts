// Conformance: spec/vectors/write-existence.json, the rule of SPEC.md section 4 (Refusals and existence) (#89).
// A refused write tells its caller nothing about a policy or record it cannot read, the way the read paths already
// collapse. Replaces red-team gap test #90, whose probes are the record.append and evidence.inspect cases here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
type Refusal = { code: string; status: number; message: string };
type Case = { name: string; action: string; policy: string; supersedes?: string; expected: 'accept' | { code: string; status: number }; same_as?: string };
const vectors = parseUntrustedJson(readFileSync(new URL('../../../spec/vectors/write-existence.json', import.meta.url), 'utf8')) as { cases: Case[] };

async function harness(audience: string) {
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  let state = emptyState();
  const send = async (input: any): Promise<any> => { const cand = structuredClone(state); const r = await execute(cand, input, ctx); state = cand; return r; };
  const call = async (actor: Actor, action: string, org: string | null, payload: any) => send(await signCommand(draftCommand(audience, actor, action, org, payload, ctx.now), [actor.key]));
  const attempt = (actor: Actor, action: string, org: string | null, payload: any): Promise<'accept' | Refusal> =>
    call(actor, action, org, payload).then(() => 'accept' as const, (e: any) => ({ code: e.code, status: e.status, message: e.message }));
  const expires = new Date(ctx.now + 86400000).toISOString();
  const person = async (): Promise<Actor> => { const key = await generateKeyPair(), a = { key, id: await personId(key.keyId) }; await call(a, 'person.register', null, { keys: [key.keyId] }); return a; };
  const company = async () => {
    const owner = await person(), nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
    await call(owner, 'organization.create', org, { name: 'Synthetic Test Co', nonce, controllers: [owner.id], threshold: 1 });
    return { owner, org };
  };
  const member = async (org: string, owner: Actor) => {
    const m = await person(), invitation_id = crypto.randomUUID();
    await call(owner, 'membership.invite', org, { invitation_id, person_id: m.id, permissions: [], expires_at: expires });
    await call(m, 'membership.accept', org, { invitation_id }); return m;
  };
  const policy = async (org: string, owner: Actor, grants: [Actor, string[]][]) => {
    const policy_id = crypto.randomUUID();
    await call(owner, 'policy.create', org, { policy_id, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1,
      grants: [[owner, ['read', 'write', 'export']] as [Actor, string[]], ...grants].map(([g, actions]) => ({ person_id: g.id, actions, resource_ids: '*', expires_at: expires })) });
    return policy_id;
  };
  const profile = async (org: string, owner: Actor) => {
    const contract = { publisher_id: org, name: 'notes', version: '1.0.0', schema: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 9 } }, required: ['n'], additionalProperties: false }, dependencies: [], semantics: 'structural' };
    const d = await digest(contract), { publisher_id: _, ...payload } = contract;
    await call(owner, 'profile.publish', org, { ...payload, digest: d, visibility: 'private', readers: [] }); return d;
  };
  const record = (org: string, policy_id: string, profile_digest: string, supersedes: string | null = null) => {
    const id = crypto.randomUUID();
    return { id, root_id: supersedes ? crypto.randomUUID() : id, supersedes, organization_id: org, policy_id, resource_id: crypto.randomUUID(), profile_digest, counterparty_ids: [], body: { n: 1 } };
  };
  return { ctx, call, attempt, person, company, member, policy, profile, record };
}

// Company C with a caller holding read+write on "writable", read on "read-only" and nothing on "hidden"; company D beside it.
async function world(audience = 'https://write-existence.test') {
  const h = await harness(audience), C = await h.company(), D = await h.company(), caller = await h.member(C.org, C.owner);
  const policies: Record<string, string> = {
    writable: await h.policy(C.org, C.owner, [[caller, ['read', 'write']]]),
    'read-only': await h.policy(C.org, C.owner, [[caller, ['read']]]),
    hidden: await h.policy(C.org, C.owner, []),
    absent: crypto.randomUUID(),
    foreign: await h.policy(D.org, D.owner, []),
  };
  const prof = await h.profile(C.org, C.owner), profD = await h.profile(D.org, D.owner);
  const genesis = async (actor: Actor, org: string, pol: string, d: string) => { const r = h.record(org, pol, d); await h.call(actor, 'record.append', org, r); return r.id; };
  const predecessors: Record<string, string> = {
    readable: await genesis(caller, C.org, policies.writable, prof),
    hidden: await genesis(C.owner, C.org, policies.hidden, prof),
    foreign: await genesis(D.owner, D.org, policies.foreign, profD),
    absent: crypto.randomUUID(),
  };
  const payload = (v: Case) => {
    const policy_id = policies[v.policy];
    switch (v.action) {
      case 'record.append': return h.record(C.org, policy_id, prof, v.supersedes ? predecessors[v.supersedes] : null);
      case 'inventory.create': return { policy_id, pool_id: crypto.randomUUID(), product_id: crypto.randomUUID(), base_unit: 'unit' };
      case 'inventory.open': return { policy_id, product_id: crypto.randomUUID() };
      case 'flow.open': return { policy_id, book_id: crypto.randomUUID() };
      case 'flow.ledger.open': return { policy_id, book_id: crypto.randomUUID(), asset: { product: null, currency: 'USD' }, account: null, balance: 'nonnegative' };
      default: throw new Error(`unknown action ${v.action}`);
    }
  };
  return { h, C, D, caller, policies, prof, run: (v: Case) => h.attempt(caller, v.action, C.org, payload(v)) };
}

test('write-existence vectors are well formed: every same_as names an earlier refusal with the same expected outcome', () => {
  const byName = new Map(vectors.cases.map(v => [v.name, v]));
  assert.equal(byName.size, vectors.cases.length, 'case names are unique');
  for (const v of vectors.cases.filter(v => v.same_as)) {
    const other = byName.get(v.same_as!);
    assert.ok(other && other.expected !== 'accept', `${v.name}: same_as names a refusal`);
    assert.deepEqual(v.expected, other.expected, `${v.name}: same expected outcome as ${v.same_as}`);
    assert.equal(v.action, other.action, `${v.name}: same action as ${v.same_as}`);
  }
});

test('write-existence vectors: a refused write answers an unreadable or foreign policy or predecessor exactly as an absent one', async () => {
  const w = await world(), seen = new Map<string, 'accept' | Refusal>();
  for (const v of vectors.cases) {
    const got = await w.run(v); seen.set(v.name, got);
    if (v.expected === 'accept') { assert.equal(got, 'accept', `${v.name}: ${JSON.stringify(got)}`); continue; }
    assert.ok(got !== 'accept', `${v.name}: accepted`);
    assert.deepEqual({ code: got.code, status: got.status }, v.expected, v.name);
    if (v.same_as) assert.deepEqual(got, seen.get(v.same_as), `${v.name}: distinguishable from ${v.same_as}`);
  }
});

test('the read paths keep collapsing: record.get and policy.get answer an unreadable record or policy as an absent one', async () => {
  const w = await world(), hiddenRecord = w.h.record(w.C.org, w.policies.hidden, w.prof);
  await w.h.call(w.C.owner, 'record.append', w.C.org, hiddenRecord);
  const read = (action: string, payload: any) => w.h.attempt(w.caller, action, w.C.org, payload);
  assert.deepEqual(await read('record.get', { id: hiddenRecord.id, profile_digest: w.prof }), await read('record.get', { id: crypto.randomUUID(), profile_digest: w.prof }));
  assert.deepEqual(await read('policy.get', { policy_id: w.policies.hidden }), await read('policy.get', { policy_id: w.policies.absent }));
});

test('evidence.inspect answers a recipient compartment the inspector cannot read exactly as an absent one', async () => {
  const source = await world('https://evidence-source.test'), destination = await world('https://evidence-destination.test');
  source.h.ctx.pins[destination.h.ctx.audience] = destination.h.ctx.storeKey.keyId; destination.h.ctx.pins[source.h.ctx.audience] = source.h.ctx.storeKey.keyId;
  const shared = source.h.record(source.C.org, source.policies.writable, source.prof);
  await source.h.call(source.C.owner, 'record.append', source.C.org, shared);
  const inspect = async (policy: string) => {
    const recipient = { organization_id: destination.C.org, audience: destination.h.ctx.audience, policy_id: destination.policies[policy], resource_id: crypto.randomUUID() };
    const token = await source.h.call(source.C.owner, 'evidence.issue', source.C.org, { record_ids: [shared.id], recipient, purpose: 'Synthetic review', expires_at: new Date(source.h.ctx.now + 60000).toISOString() });
    return destination.h.attempt(destination.caller, 'evidence.inspect', destination.C.org, { token, accepted_profiles: [source.prof] });
  };
  assert.equal(await inspect('writable'), 'accept', 'the inspector reads its own compartment');
  const absent = await inspect('absent');
  assert.ok(absent !== 'accept'); assert.deepEqual({ code: absent.code, status: absent.status }, { code: 'not_found', status: 404 });
  assert.deepEqual(await inspect('hidden'), absent);
});
