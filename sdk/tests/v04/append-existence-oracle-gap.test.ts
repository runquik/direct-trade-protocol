// GAP (surface 6 — privacy and compartments). The read surface is deliberately
// collapsed: record.get / records.list / policy.get return an identical
// `not_found` whether a record or policy is absent, in another company, or in a
// compartment the caller cannot access (SPEC.md §4, §5; the error table in §10
// says 404 is scoped-unavailable and "Do not infer that every 404/unknown
// reference means the object does not exist globally"). The *write* surface
// (record.append) is NOT collapsed:
//
//   1. `supersedes` distinguishes a record id that exists anywhere on the host
//      ("record continuity failed") from one that does not
//      ("predecessor missing or genesis invalid"). Same stable code (`conflict`),
//      different message. This is a host-global record-existence oracle that
//      crosses the company boundary (a co-tenant probes another company) and the
//      compartment boundary (a member probes a compartment it cannot read),
//      gated only by knowing the target record UUID.
//
//   2. `policy_id` distinguishes a policy that exists in the caller's own company
//      but on which it has no grant (`forbidden` / 403) from a policy id that
//      does not exist (`not_found` / 404). This is a *stable-code* difference, so
//      even a spec-conformant client keying only on the code learns that the
//      policy exists — exactly what `policy.get` refuses to tell a non-steward.
//
// This file asserts the current, distinguishable behaviour so CI stays green and
// the gap stays visible. The `GAP:` assertions flip when record.append collapses
// these branches the way the read paths already do. Companion to the host-global
// `seq` count leak (#71): that finding is about *volume/timing*; this one is
// about *existence*. No fix is proposed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
type Outcome = { outcome: 'accept' } | { code: string; status: number; message: string };
const audience = 'https://append-existence-oracle.test';

async function harness() {
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  let state = emptyState();
  const send = async (input: any): Promise<any> => { const cand = structuredClone(state); const r = await execute(cand, input, ctx); state = cand; return r; };
  const call = async (actor: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) =>
    send(await signCommand(draftCommand(audience, actor, action, org, payload, ctx.now), [actor.key, ...extra]));
  const attempt = (actor: Actor, action: string, org: string | null, payload: any): Promise<Outcome> =>
    call(actor, action, org, payload).then(() => ({ outcome: 'accept' as const }), (e: any) => ({ code: e.code, status: e.status, message: e.message }));
  const expires = new Date(ctx.now + 86400000).toISOString();
  const newPerson = async (): Promise<Actor> => { const key = await generateKeyPair(); return { key, id: await personId(key.keyId) }; };
  const person = async (): Promise<Actor> => { const a = await newPerson(); await call(a, 'person.register', null, { keys: [a.key.keyId] }); return a; };

  async function company(label: string) {
    const owner = await person();
    const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
    await call(owner, 'organization.create', org, { name: label, nonce, controllers: [owner.id], threshold: 1 });
    return { owner, org };
  }
  async function profile(org: string, owner: Actor, name: string) {
    const contract = { publisher_id: org, name, version: '1.0.0', schema: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 1_000_000 } }, required: ['n'], additionalProperties: false }, dependencies: [], semantics: 'structural' };
    const d = await digest(contract); const { publisher_id: _p, ...payload } = contract;
    await call(owner, 'profile.publish', org, { ...payload, digest: d, visibility: 'private', readers: [] });
    return d;
  }
  async function policy(org: string, owner: Actor, classification: 'business' | 'personnel', grantees: Actor[]) {
    const policy_id = crypto.randomUUID();
    await call(owner, 'policy.create', org, { policy_id, expected_revision: 0, classification, stewards: [owner.id], threshold: 1,
      grants: grantees.map(g => ({ person_id: g.id, actions: ['read', 'write'], resource_ids: '*', expires_at: expires })) });
    return policy_id;
  }
  async function member(org: string, owner: Actor) {
    const m = await person(); const invitation_id = crypto.randomUUID();
    await call(owner, 'membership.invite', org, { invitation_id, person_id: m.id, permissions: [], expires_at: expires });
    await call(m, 'membership.accept', org, { invitation_id });
    return m;
  }
  const genesis = async (actor: Actor, org: string, policy_id: string, resource_id: string, profile_digest: string) => {
    const id = crypto.randomUUID();
    await call(actor, 'record.append', org, { id, root_id: id, supersedes: null, organization_id: org, policy_id, resource_id, profile_digest, counterparty_ids: [], body: { n: 1 } });
    return id;
  };
  const supersede = (actor: Actor, org: string, policy_id: string, resource_id: string, profile_digest: string, supersedes: string) => {
    const id = crypto.randomUUID();
    return attempt(actor, 'record.append', org, { id, root_id: crypto.randomUUID(), supersedes, organization_id: org, policy_id, resource_id, profile_digest, counterparty_ids: [], body: { n: 2 } });
  };
  return { call, attempt, company, profile, policy, member, genesis, supersede };
}

test('GAP: record.append `supersedes` is a host-global, cross-COMPANY record-existence oracle', async () => {
  const h = await harness();
  // Victim company A holds a private record. Attacker company B is an unrelated
  // co-tenant on the same host with only its own write grant.
  const A = await h.company('Company A (victim)');
  const polA = await h.policy(A.org, A.owner, 'business', [A.owner]);
  const profA = await h.profile(A.org, A.owner, 'a.notes');
  const victimRecord = await h.genesis(A.owner, A.org, polA, crypto.randomUUID(), profA);

  const B = await h.company('Company B (attacker co-tenant)');
  const polB = await h.policy(B.org, B.owner, 'business', [B.owner]);
  const profB = await h.profile(B.org, B.owner, 'b.notes');
  const resB = crypto.randomUUID();

  const exists = await h.supersede(B.owner, B.org, polB, resB, profB, victimRecord);     // A's real record id
  const absent = await h.supersede(B.owner, B.org, polB, resB, profB, crypto.randomUUID()); // random id

  assert.ok('code' in exists && 'code' in absent);
  assert.equal(exists.code, 'conflict');
  assert.equal(absent.code, 'conflict');
  // GAP: the two cases are distinguishable by message, so B confirms that a
  // record UUID belonging to another company exists on the host. When the branch
  // is collapsed (e.g. one "record continuity failed" for both), these differ.
  assert.equal(exists.message, 'record continuity failed');
  assert.equal(absent.message, 'predecessor missing or genesis invalid');
  assert.notEqual(exists.message, absent.message);
});

test('GAP: record.append `supersedes` is a cross-COMPARTMENT record-existence oracle; record.get is not', async () => {
  const h = await harness();
  const C = await h.company('Company C');
  const clerk = await h.member(C.org, C.owner);
  const polSales = await h.policy(C.org, C.owner, 'business', [C.owner, clerk]);   // clerk has read+write
  const polPayroll = await h.policy(C.org, C.owner, 'personnel', [C.owner]);        // clerk has NO grant
  const profC = await h.profile(C.org, C.owner, 'c.notes');
  const payrollRecord = await h.genesis(C.owner, C.org, polPayroll, crypto.randomUUID(), profC);
  const resSales = crypto.randomUUID();

  const exists = await h.supersede(clerk, C.org, polSales, resSales, profC, payrollRecord);
  const absent = await h.supersede(clerk, C.org, polSales, resSales, profC, crypto.randomUUID());
  assert.ok('code' in exists && 'code' in absent);
  // GAP: the clerk, with no authority on the payroll compartment, confirms that a
  // payroll record exists by the differing message.
  assert.equal(exists.message, 'record continuity failed');
  assert.equal(absent.message, 'predecessor missing or genesis invalid');
  assert.notEqual(exists.message, absent.message);

  // CONTROL: the read path collapses both to an identical not_found (the intended
  // behaviour that record.append does not match). This assertion is expected to
  // keep holding after the gap is fixed.
  const readExists = await h.attempt(clerk, 'record.get', C.org, { id: payrollRecord, profile_digest: profC });
  const readAbsent = await h.attempt(clerk, 'record.get', C.org, { id: crypto.randomUUID(), profile_digest: profC });
  assert.ok('code' in readExists && 'code' in readAbsent);
  assert.equal(readExists.code, 'not_found');
  assert.deepEqual({ code: readExists.code, message: readExists.message }, { code: readAbsent.code, message: readAbsent.message });
});

test('GAP: record.append distinguishes an in-company policy (403) from an absent one (404) by stable code', async () => {
  const h = await harness();
  const C = await h.company('Company C');
  const clerk = await h.member(C.org, C.owner);
  await h.policy(C.org, C.owner, 'business', [C.owner, clerk]); // clerk's own compartment (unused here)
  const polPayroll = await h.policy(C.org, C.owner, 'personnel', [C.owner]); // exists; clerk has no grant
  const profC = await h.profile(C.org, C.owner, 'c.notes');

  const g1 = crypto.randomUUID();
  const policyExists = await h.attempt(clerk, 'record.append', C.org, { id: g1, root_id: g1, supersedes: null, organization_id: C.org, policy_id: polPayroll, resource_id: crypto.randomUUID(), profile_digest: profC, counterparty_ids: [], body: { n: 1 } });
  const g2 = crypto.randomUUID();
  const policyAbsent = await h.attempt(clerk, 'record.append', C.org, { id: g2, root_id: g2, supersedes: null, organization_id: C.org, policy_id: crypto.randomUUID(), resource_id: crypto.randomUUID(), profile_digest: profC, counterparty_ids: [], body: { n: 1 } });

  assert.ok('code' in policyExists && 'code' in policyAbsent);
  // GAP: a policy that exists in the caller's own company but on which it has no
  // grant answers `forbidden`/403; an absent policy id answers `not_found`/404.
  // The stable code alone reveals the policy's existence — which `policy.get`
  // deliberately hides from a non-steward. When collapsed, both would be 404.
  assert.deepEqual({ code: policyExists.code, status: policyExists.status }, { code: 'forbidden', status: 403 });
  assert.deepEqual({ code: policyAbsent.code, status: policyAbsent.status }, { code: 'not_found', status: 404 });
  assert.notEqual(policyExists.code, policyAbsent.code);

  // CONTROL: policy.get collapses both to not_found for the non-steward clerk.
  const getExists = await h.attempt(clerk, 'policy.get', C.org, { policy_id: polPayroll });
  const getAbsent = await h.attempt(clerk, 'policy.get', C.org, { policy_id: crypto.randomUUID() });
  assert.ok('code' in getExists && 'code' in getAbsent);
  assert.equal(getExists.code, 'not_found');
  assert.deepEqual({ code: getExists.code, message: getExists.message }, { code: getAbsent.code, message: getAbsent.message });
});
