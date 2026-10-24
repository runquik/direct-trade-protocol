// Conformance: spec/vectors/membership-revocation.json, membership revocation ends policy grants (SPEC.md section 4, #98).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Command, Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const vectors = JSON.parse(readFileSync(new URL('../../../spec/vectors/membership-revocation.json', import.meta.url), 'utf8'));
const audience = 'https://membership-revocation.test', DAY = 86400000;

async function host() {
  let state = emptyState();
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const send = async (input: Command) => { const candidate = structuredClone(state); const result = await execute(candidate, input, ctx); state = candidate; return result; };
  const sign = (actor: Actor, action: string, org: string | null, payload: any) => signCommand(draftCommand(audience, actor, action, org, payload, ctx.now), [actor.key]);
  const call = async (actor: Actor, action: string, org: string | null, payload: any) => send(await sign(actor, action, org, payload));
  const person = async () => { const key = await generateKeyPair(); const actor = { key, id: await personId(key.keyId) }; await call(actor, 'person.register', null, { keys: [key.keyId] }); return actor; };
  const owner = await person(), worker = await person();
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce), expires = new Date(ctx.now + 30 * DAY).toISOString();
  await call(owner, 'organization.create', org, { name: 'Synthetic revocation company', nonce, controllers: [owner.id], threshold: 1 });
  const invite = async () => { const invitation_id = crypto.randomUUID(); await call(owner, 'membership.invite', org, { invitation_id, person_id: worker.id, permissions: [], expires_at: expires }); return invitation_id; };
  await call(worker, 'membership.accept', org, { invitation_id: await invite() });
  const contract = { publisher_id: org, name: 'revocation.notes', version: '1.0.0', schema: { type: 'object', properties: { note: { type: 'string', maxLength: 40 } }, required: ['note'], additionalProperties: false }, dependencies: [], semantics: 'structural' };
  const profile = await digest(contract);
  const { publisher_id: _, ...published } = contract;
  await call(owner, 'profile.publish', org, { ...published, digest: profile, visibility: 'private', readers: [] });
  const policy_id = crypto.randomUUID(), grants = [owner, worker].map(p => ({ person_id: p.id, actions: ['read', 'write'], resource_ids: '*', expires_at: expires }));
  let revision = 0;
  const policy = (action: string) => ({ action, payload: { policy_id, expected_revision: revision, classification: 'business', stewards: [owner.id], threshold: 1, grants } });
  await call(owner, 'policy.create', org, policy('policy.create').payload); revision = 1;
  const record = crypto.randomUUID(), resource_id = crypto.randomUUID(), envelope = { root_id: record, organization_id: org, policy_id, resource_id, profile_digest: profile, counterparty_ids: [] };
  await call(owner, 'record.append', org, { id: record, supersedes: null, ...envelope, body: { note: 'synthetic' } });
  // Each step yields the commands it would submit; "sign" holds them for a later "submit".
  const commands = async (op: string): Promise<Command[]> => {
    if (op === 'revoke') return [await sign(owner, 'membership.revoke', org, { person_id: worker.id })];
    if (op === 'regrant') { const { action, payload } = policy('policy.update'); revision += 1; return [await sign(owner, action, org, payload)]; }
    if (op === 'read') return [await sign(worker, 'record.get', org, { id: record, profile_digest: profile })];
    if (op === 'write') { const id = crypto.randomUUID(); return [await sign(worker, 'record.append', org, { id, supersedes: record, ...envelope, body: { note: 'rewrite' } })]; }
    throw new Error(`unknown step ${op}`);
  };
  return { ctx, send, commands, reinvite: async () => { const invitation_id = await invite(); await call(worker, 'membership.accept', org, { invitation_id }); } };
}

async function run(v: any) {
  const h = await host(), held: Record<string, Command[]> = {};
  let outcome: any = 'accept';
  for (const [index, step] of (v.steps as any[]).entries()) {
    if (!step.same_instant) h.ctx.now += vectors.clock_step_ms;
    const last = index === v.steps.length - 1;
    try {
      if (step.op === 'sign') { held[step.as] = await h.commands(step.what); continue; }
      if (step.op === 'reinvite') { await h.reinvite(); continue; }
      for (const c of step.op === 'submit' ? held[step.what] : await h.commands(step.op)) await h.send(c);
    } catch (error: any) {
      assert.ok(error?.code, `unexpected failure: ${error?.stack ?? error}`);
      assert.ok(last, `step ${index} (${step.op}) refused: ${error.code}`);
      outcome = { code: error.code, status: error.status };
    }
  }
  return outcome;
}

test('membership-revocation vectors cover re-admission, re-grant and both ordering refusals', () => {
  const cases = vectors.cases as any[];
  assert.ok(cases.some(v => v.steps.some((s: any) => s.op === 'reinvite') && v.expected !== 'accept'));
  assert.ok(cases.some(v => v.steps.some((s: any) => s.op === 'regrant') && v.expected === 'accept'));
  assert.ok(cases.some(v => v.expected?.code === 'conflict') && cases.some(v => v.expected?.code === 'invalid'));
  assert.ok(cases.some(v => v.steps.some((s: any) => s.same_instant)));
  assert.equal(new Set(cases.map(v => v.name)).size, cases.length);
});

for (const v of vectors.cases) {
  test(`membership-revocation vector: ${v.name}`, async () => { assert.deepEqual(await run(v), v.expected); });
}
