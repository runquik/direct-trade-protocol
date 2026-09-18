import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticRegistry, operationDescriptorDigest, SemanticError } from '../../src/foundation/semantics.ts';
import type { OperationDescriptor, AuthorizedOperationInput, EffectPlan, HandlerAdmission } from '../../src/foundation/semantics.ts';

const org = '11111111-1111-4111-8111-111111111111', foreign = '22222222-2222-4222-8222-222222222222';
const resource = { kind: 'resource' as const, id: '33333333-3333-4333-8333-333333333333', organization_id: org };
const revision = { entity: resource, revision_id: '44444444-4444-4444-8444-444444444444', digest: 'a'.repeat(64) };
const profile = 'b'.repeat(64), implementation = 'c'.repeat(64), otherProfile = 'd'.repeat(64);
const contract: OperationDescriptor = { profile_digest: profile, name: 'review.adjust', input_profile_digests: [profile], output_profile_digests: [profile], required_grants: ['review.adjust'],
  allowed_effects: ['resource.update'], max_inputs: 2, max_resources: 2, max_effects: 2, concurrency: 'exact-revision', retry: 'business-operation-id' };
const plan = (): EffectPlan => ({ expected_resources: [{ resource, revision }], effects: [{ kind: 'resource.update', resource, expected_revision: revision,
  next_revision_id: '55555555-5555-4555-8555-555555555555', profile_digest: profile, body: { available: 8 } }] });
async function fixture(evaluate: HandlerAdmission['evaluate'] = () => plan(), validate = (body: Readonly<Record<string, any>>) => Object.keys(body).length === 1 && Number.isSafeInteger(body.available) && body.available >= 0) {
  const descriptor_digest = await operationDescriptorDigest(contract);
  const registry = await createSemanticRegistry([{ descriptor: contract, descriptor_digest, handler_digest: implementation, evaluate }], [{ profile_digest: profile, validate }]);
  const input: AuthorizedOperationInput = { intent: { operation_id: '66666666-6666-4666-8666-666666666666', organization_id: org, profile_digest: profile, operation: contract.name,
    descriptor_digest, handler_digest: implementation, resources: [resource], inputs: [revision], parameters: { amount: '2' } },
    authorized_inputs: [{ revision, profile_digest: profile, body: { available: 10 } }], snapshots: [{ resource, profile_digest: profile, current_revision: revision, body: { available: 10 } }], accepted_at: '2026-09-12T12:00:00.000Z' };
  return { registry, input };
}
const denied = (error: unknown) => error instanceof SemanticError || (error as any)?.name === 'DatatypeError';

test('independent semantic review: conflicting identity digest, profile and body aliases reject before handler invocation', async () => {
  let calls = 0; const f = await fixture(() => { calls++; return plan(); });
  for (const mutation of [(x: AuthorizedOperationInput) => { x.snapshots[0].current_revision = { ...x.snapshots[0].current_revision!, digest: 'e'.repeat(64) }; },
    (x: AuthorizedOperationInput) => { x.snapshots[0].profile_digest = otherProfile; },
    (x: AuthorizedOperationInput) => { x.snapshots[0].body = { available: 99 }; },
    (x: AuthorizedOperationInput) => { x.authorized_inputs[0].revision = { ...x.authorized_inputs[0].revision, entity: { ...x.authorized_inputs[0].revision.entity, organization_id: foreign } }; }]) {
    const input = structuredClone(f.input); mutation(input);
    await assert.rejects(f.registry.evaluateAuthorized(input), denied);
  }
  assert.equal(calls, 0);
});

test('independent semantic review: complete CAS closure cannot substitute a second company or kind', async () => {
  for (const changed of [{ ...resource, organization_id: foreign }, { ...resource, kind: 'record' }]) {
    const f = await fixture(() => { const p = plan(); p.expected_resources[0].resource = changed as any; return p; });
    await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  }
});

test('independent semantic review: initializing a resource requires exact nonexistence and an admitted output profile', async () => {
  const f = await fixture(() => { const p = plan(); p.expected_resources[0].revision = null; (p.effects[0] as any).expected_revision = null; return p; });
  const input = structuredClone(f.input); input.intent.inputs = []; input.authorized_inputs = []; input.snapshots[0].current_revision = null; input.snapshots[0].body = null;
  assert.equal((await f.registry.evaluateAuthorized(input)).plan.effects.length, 1);
  for (const row of [{ ...input.snapshots[0], body: { available: 10 } }, { ...input.snapshots[0], profile_digest: otherProfile }]) {
    await assert.rejects(f.registry.evaluateAuthorized({ ...input, snapshots: [row] }), denied);
  }
});

test('independent semantic review: malformed output getters and prototype containers do not execute', async () => {
  let calls = 0;
  const f = await fixture(() => { const p = plan(); Object.defineProperty(p.effects[0].body, 'available', { enumerable: true, get() { calls++; return 8; } }); return p; });
  await assert.rejects(f.registry.evaluateAuthorized(f.input), denied); assert.equal(calls, 0);
  const inherited = await fixture(() => { const p = plan(); p.effects[0].body = Object.assign(Object.create({ private: 'secret' }), { available: 8 }); return p; });
  await assert.rejects(inherited.registry.evaluateAuthorized(inherited.input), denied);
});

test('independent semantic review: undeclared effect kinds and injected receipt or authority fields reject', async () => {
  for (const mutation of [(p: any) => { p.effects[0].kind = 'policy.grant'; },
    (p: any) => { p.effects[0].authorized_by = 'self'; },
    (p: any) => { p.receipt = { verified: true }; },
    (p: any) => { p.effects[0].next_revision_id = revision.revision_id; }]) {
    const f = await fixture(() => { const p = plan(); mutation(p); return p; });
    await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  }
});

test('independent semantic review: output validation exceptions are redacted and promises do not approve', async () => {
  for (const validator of [() => { throw new Error('SYNTHETIC-PRIVATE-VALIDATOR-DETAIL'); }, (() => Promise.resolve(true)) as any]) {
    const f = await fixture(undefined, validator);
    await assert.rejects(f.registry.evaluateAuthorized(f.input), (error: unknown) => error instanceof SemanticError && !error.message.includes('PRIVATE'));
  }
});

test('independent semantic review: cycles, depth, hidden array fields and aggregate input bounds reject before evaluation', async () => {
  let calls = 0; const f = await fixture(() => { calls++; return plan(); });
  const cycle: any = {}; cycle.self = cycle;
  let deep: any = {}; for (let i = 0; i < 18; i++) deep = { nested: deep };
  const hidden: any[] = []; Object.defineProperty(hidden, 'secret', { value: true });
  for (const parameters of [cycle, deep, { rows: hidden }, { a: 'x'.repeat(65536), b: 'x'.repeat(65536), c: 'x'.repeat(65536), d: 'x'.repeat(65536) }]) {
    await assert.rejects(f.registry.evaluateAuthorized({ ...f.input, intent: { ...f.input.intent, parameters } }), denied);
  }
  assert.equal(calls, 0);
});

test('independent semantic review: copied capability output and deeply frozen inputs cannot mutate future evaluation', async () => {
  let froze = false;
  const f = await fixture(input => { froze = Object.isFrozen(input) && Object.isFrozen(input.intent.parameters) && Object.isFrozen(input.authorized_inputs[0].revision.entity) && Object.isFrozen(input.snapshots[0].body); return plan(); });
  const first = await f.registry.evaluateAuthorized(f.input); assert.equal(froze, true);
  assert.throws(() => { first.plan.effects[0].body.available = 999; }, TypeError);
  const capabilities = f.registry.capabilities(); capabilities[0].descriptor.required_grants.length = 0;
  assert.equal((await f.registry.evaluateAuthorized(f.input)).plan.effects[0].body.available, 8);
  assert.deepEqual(f.registry.capabilities()[0].descriptor.required_grants, ['review.adjust']);
});
