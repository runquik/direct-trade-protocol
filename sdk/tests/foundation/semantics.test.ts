import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticRegistry, operationDescriptorDigest, parseOperationDescriptor, SemanticError } from '../../src/foundation/semantics.ts';
import type { OperationDescriptor, AuthorizedOperationInput, EffectPlan, HandlerAdmission, JsonObject } from '../../src/foundation/semantics.ts';

const org = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const resource = { kind: 'resource' as const, id: '33333333-3333-4333-8333-333333333333', organization_id: org };
const revision = { entity: resource, revision_id: '44444444-4444-4444-8444-444444444444', digest: 'a'.repeat(64) };
const profile = 'b'.repeat(64), output = 'c'.repeat(64), implementation = 'd'.repeat(64);
const next = '55555555-5555-4555-8555-555555555555', record = '66666666-6666-4666-8666-666666666666';
const contract: OperationDescriptor = { profile_digest: profile, name: 'capacity.reserve', input_profile_digests: [profile], output_profile_digests: [profile, output],
  allowed_effects: ['resource.update', 'record.append'], required_grants: ['capacity.reserve'], max_inputs: 2, max_resources: 2, max_effects: 3, concurrency: 'exact-revision', retry: 'business-operation-id' };
const bodyValidator = (body: Readonly<JsonObject>) => Object.keys(body).length === 1 && Number.isSafeInteger(body.available) && (body.available as number) >= 0;
const plan = (): EffectPlan => ({ expected_resources: [{ resource, revision }], effects: [
  { kind: 'resource.update', resource, expected_revision: revision, next_revision_id: next, profile_digest: profile, body: { available: 8 } },
  { kind: 'record.append', record_id: record, resource, profile_digest: output, body: { available: 2 } },
] });
async function fixture(evaluate: HandlerAdmission['evaluate'] = () => plan(), descriptor = contract, validate = bodyValidator) {
  const descriptor_digest = await operationDescriptorDigest(descriptor);
  const admission = { descriptor, descriptor_digest, handler_digest: implementation, evaluate };
  const validators = [{ profile_digest: profile, validate }, { profile_digest: output, validate }];
  const registry = await createSemanticRegistry([admission], validators);
  const input: AuthorizedOperationInput = { intent: { operation_id: '77777777-7777-4777-8777-777777777777', organization_id: org, profile_digest: profile, operation: contract.name,
    descriptor_digest, handler_digest: implementation, resources: [resource], inputs: [revision], parameters: { quantity: '2' } },
    authorized_inputs: [{ revision, profile_digest: profile, body: { available: 10 } }],
    snapshots: [{ resource, profile_digest: profile, current_revision: revision, body: { available: 10 } }], accepted_at: '2026-09-12T12:00:00.000Z' };
  return { registry, input, admission, validators };
}
const denied = (error: unknown) => error instanceof SemanticError || (error as any)?.name === 'DatatypeError';

test('semantics: deterministic admitted plans carry exact intent pins without applying effects', async () => {
  const f = await fixture(), before = structuredClone(f.input);
  const first = await f.registry.evaluateAuthorized(f.input), second = await f.registry.evaluateAuthorized(f.input);
  assert.deepEqual(first, second); assert.deepEqual(first.plan, plan()); assert.deepEqual(f.input, before);
  assert.equal(first.operation_id, f.input.intent.operation_id); assert.match(first.intent_digest, /^[a-f0-9]{64}$/);
  const altered = structuredClone(f.input); altered.intent.parameters.quantity = '3';
  assert.notEqual((await f.registry.evaluateAuthorized(altered)).intent_digest, first.intent_digest);
});

test('semantics: changed descriptor or implementation pins and unsupported profiles fail closed', async () => {
  const f = await fixture();
  for (const changes of [{ descriptor_digest: output }, { handler_digest: output }, { profile_digest: output }, { operation: 'capacity.release' }]) {
    const input = structuredClone(f.input); Object.assign(input.intent, changes); await assert.rejects(f.registry.evaluateAuthorized(input), denied);
  }
  await assert.rejects(createSemanticRegistry([{ ...f.admission, descriptor_digest: output }], f.validators), denied);
  await assert.rejects(createSemanticRegistry([f.admission, f.admission], f.validators), denied);
  await assert.rejects(createSemanticRegistry([f.admission], []), denied);
});

test('semantics: admission metadata is copied and capability inspection cannot mutate registry pins', async () => {
  const descriptor = structuredClone(contract), f = await fixture(undefined, descriptor);
  descriptor.allowed_effects.length = 0;
  const capabilities = f.registry.capabilities(); capabilities[0].descriptor.allowed_effects.length = 0;
  assert.deepEqual((await f.registry.evaluateAuthorized(f.input)).plan, plan());
});

test('semantics: every declared input and resource needs exactly one authorized snapshot/copy', async () => {
  const f = await fixture();
  for (const changes of [{ authorized_inputs: [] }, { authorized_inputs: [...f.input.authorized_inputs, ...f.input.authorized_inputs] }, { snapshots: [] }, { snapshots: [...f.input.snapshots, ...f.input.snapshots] }]) {
    await assert.rejects(f.registry.evaluateAuthorized({ ...f.input, ...changes }), denied);
  }
  const duplicate = structuredClone(f.input); duplicate.intent.inputs.push(revision); await assert.rejects(f.registry.evaluateAuthorized(duplicate), denied);
  const conflict = structuredClone(f.input); conflict.snapshots[0].body = { available: 1000 }; await assert.rejects(f.registry.evaluateAuthorized(conflict), denied);
  const unsupported = structuredClone(f.input); unsupported.authorized_inputs[0].profile_digest = output; await assert.rejects(f.registry.evaluateAuthorized(unsupported), denied);
});

test('semantics: resource scope is both represented-company and explicit intent bound', async () => {
  for (const target of [{ ...resource, organization_id: other }, { ...resource, id: other }]) {
    const f = await fixture(() => { const output = plan(); output.effects[0].resource = target; return output; });
    await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  }
  const f = await fixture(), input = structuredClone(f.input); input.intent.resources[0].organization_id = other;
  await assert.rejects(f.registry.evaluateAuthorized(input), denied);
});

test('semantics: exact CAS closure rejects omissions, stale expectations and revision reuse', async () => {
  const variants = [() => { const p = plan(); p.expected_resources = []; return p; },
    () => { const p = plan(); p.expected_resources[0].revision = null; return p; },
    () => { const p = plan(); (p.effects[0] as any).expected_revision = null; return p; },
    () => { const p = plan(); (p.effects[0] as any).next_revision_id = revision.revision_id; return p; }];
  for (const evaluate of variants) { const f = await fixture(evaluate); await assert.rejects(f.registry.evaluateAuthorized(f.input), denied); }
});

test('semantics: duplicate update resources and proposed record identities are rejected', async () => {
  for (const evaluate of [() => { const p = plan(); p.effects.push({ ...p.effects[0], next_revision_id: other } as any); return p; },
    () => { const p = plan(); (p.effects[1] as any).record_id = next; return p; },
    () => { const p = plan(); p.effects.push(p.effects[1]); return p; }]) {
    const f = await fixture(evaluate); await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  }
});

test('semantics: output profile and schema validity are separate from bounded JSON shape', async () => {
  for (const evaluate of [() => { const p = plan(); p.effects[1].profile_digest = implementation; return p; },
    () => { const p = plan(); p.effects[1].body = { unrelated: true }; return p; },
    () => { const p = plan(); p.effects[0].profile_digest = output; return p; }]) {
    const f = await fixture(evaluate); await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  }
});

test('semantics: descriptor effects and count ceilings constrain otherwise valid plans', async () => {
  const d = structuredClone(contract); d.max_effects = 1;
  const f = await fixture(undefined, d); await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  const onlyAppend = await fixture(undefined, { ...contract, allowed_effects: ['record.append'] });
  await assert.rejects(onlyAppend.registry.evaluateAuthorized(onlyAppend.input), denied);
  for (const value of [{ ...contract, max_effects: 33 }, { ...contract, concurrency: 'best-effort' }, { ...contract, allowed_effects: ['payment.send'] }, { ...contract, input_profile_digests: [profile, profile] }, { ...contract, uploaded_code: 'anything' }]) assert.throws(() => parseOperationDescriptor(value), denied);
});

test('semantics: aggregate output size is bounded even when each string is individually small', async () => {
  const f = await fixture(() => { const p = plan(); p.effects[0].body = { a: 'x'.repeat(65536), b: 'x'.repeat(65536), c: 'x'.repeat(65536), d: 'x'.repeat(65536) }; return p; }, contract, () => true);
  await assert.rejects(f.registry.evaluateAuthorized(f.input), denied);
  const input = structuredClone(f.input); input.intent.parameters = { nested: Array(257).fill(0) }; await assert.rejects(f.registry.evaluateAuthorized(input), denied);
});

test('semantics: frozen copied handler inputs and malformed/async plans fail without state mutation', async () => {
  const f = await fixture(input => { input.snapshots[0].body!.available = 999; return plan(); });
  await assert.rejects(f.registry.evaluateAuthorized(f.input), denied); assert.equal(f.input.snapshots[0].body!.available, 10);
  for (const evaluate of [() => Promise.resolve(plan()), () => ({ ...plan(), budget_charges: [] }), () => ({ expected_resources: [], effects: [{ kind: 'policy.update' }] })]) {
    const p = await fixture(evaluate); await assert.rejects(p.registry.evaluateAuthorized(p.input), denied);
  }
});

test('semantics: getters, prototype pollution and float values reject without evaluating hidden code', async () => {
  const f = await fixture(); let calls = 0;
  const input = structuredClone(f.input); Object.defineProperty(input.intent.parameters, 'secret', { enumerable: true, get() { calls++; return 'secret'; } });
  await assert.rejects(f.registry.evaluateAuthorized(input), denied); assert.equal(calls, 0);
  for (const parameters of [JSON.parse('{"__proto__":{}}'), { amount: 0.1 }, { nested: Object.create({ hidden: true }) }, { omitted: undefined }]) await assert.rejects(f.registry.evaluateAuthorized({ ...f.input, intent: { ...f.input.intent, parameters } }), denied);
});
