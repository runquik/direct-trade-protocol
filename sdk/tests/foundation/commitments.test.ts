import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256Hex } from '../../src/canonical.ts';
import { createProviderState, applyProviderCommand, providerView, createCoordinator, planCoordinator,
  recordCoordinatorTimeout, recordCoordinatorResponse, CommitmentError } from '../../src/foundation/commitments.ts';
import type { Quote, ProviderCommand, CoordinatorState, CoordinatorRequest, CoordinatorResponse } from '../../src/foundation/commitments.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-09-12T12:00:00.000Z', expires = '2026-09-12T13:00:00.000Z';
const company = (n: number) => ({ kind: 'organization' as const, id: id(n), organization_id: null });
const customer = company(10), unit = { issuer: company(30), type: 'unit', value: 'pallet-slot' };
const window = { start: '2026-09-13T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' };
function quote(n: number, providerN = 20, quantity = 5): Quote {
  return { revision: { entity: { kind: 'record', id: id(n), organization_id: id(providerN) }, revision_id: id(n + 1000), digest: n.toString(16).padStart(64, '0') }, previous: null,
    provider: company(providerN), customer, resource: { kind: 'resource', id: id(providerN + 100), organization_id: id(providerN) }, quantity, unit, window, expires_at: expires,
    terms: { amount: '100', currency: { issuer: company(30), type: 'currency', value: 'USD' }, taxes: 'included', fees: 'included', cancellation: 'before_fulfillment',
      combined_quote_issuer: customer.id, buyer_counterparty: id(providerN), freight_cost_bearer: customer.id, substitutions: 'new_quote_and_approval' } };
}
async function fixture(providerN = 20, capacity = 10) {
  let state = createProviderState({ provider: company(providerN), resource: { kind: 'resource', id: id(providerN + 100), organization_id: id(providerN) }, kind: 'warehouse', unit, capacity }, now), serial = providerN * 10000;
  const send = async (action: ProviderCommand['action'], payload: Record<string, unknown>, operation_id = id(++serial), at = now) => {
    const command = { operation_id, action, payload }, result = await applyProviderCommand(state, command, { expected_revision: state.revision, accepted_at: at }); state = result.state; return { ...result, command };
  };
  const publish = (q: Quote) => send('quote.publish', { quote: q });
  return { get state() { return state; }, send, publish };
}
const denied = (error: unknown) => error instanceof CommitmentError || (error as any)?.name === 'DatatypeError';
const holdPayload = (q: Quote, n = 70) => ({ hold_id: id(n), quote: q.revision, expires_at: expires });
const target = (q: Quote, n = 70) => ({ hold_id: id(n), quote: q.revision });

test('commitments: exact business retry does not allocate again, while changed reuse and stale CAS reject', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q);
  const before = structuredClone(f.state), held = await f.send('hold', holdPayload(q), id(500));
  const replay = await applyProviderCommand(f.state, held.command, { expected_revision: before.revision, accepted_at: '2026-09-12T14:00:00.000Z' });
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.receipt, held.receipt); assert.equal(replay.state.holds.length, 1); assert.equal(replay.state.revision, held.state.revision);
  await assert.rejects(applyProviderCommand(f.state, { ...held.command, payload: holdPayload(q, 71) }, { expected_revision: f.state.revision, accepted_at: now }), denied);
  await assert.rejects(applyProviderCommand(f.state, { ...held.command, operation_id: id(501) }, { expected_revision: before.revision, accepted_at: now }), denied);
});

test('commitments: last available slot rejects a second allocation without mutating input', async () => {
  const f = await fixture(20, 5), q = quote(1); await f.publish(q); await f.send('hold', holdPayload(q));
  const before = structuredClone(f.state); await assert.rejects(f.send('hold', holdPayload(q, 71)), (error: any) => error.code === 'capacity'); assert.deepEqual(f.state, before);
});

test('commitments: sweep-line capacity accepts disjoint overlaps and exact adjacent boundaries', async () => {
  const f = await fixture(20, 10), a = quote(1, 20, 6), b = quote(2, 20, 6), middle = quote(3, 20, 4);
  a.window = { start: window.start, end: '2026-09-13T12:00:00.000Z' }; b.window = { start: a.window.end, end: window.end };
  for (const q of [a, b, middle]) await f.publish(q);
  await f.send('hold', holdPayload(a, 71)); await f.send('hold', holdPayload(b, 72)); await f.send('hold', holdPayload(middle, 73));
  assert.equal(f.state.holds.length, 3);
});

test('commitments: capacity sums remain exact beyond floating-number safe aggregation', async () => {
  const f = await fixture(20, Number.MAX_SAFE_INTEGER), q = quote(1, 20, Number.MAX_SAFE_INTEGER); await f.publish(q); await f.send('hold', holdPayload(q));
  const extra = quote(2, 20, 1); await f.publish(extra);
  await assert.rejects(f.send('hold', holdPayload(extra, 71)), (error: any) => error.code === 'capacity');
});

test('commitments: expired holds free capacity but cannot be confirmed as current', async () => {
  const f = await fixture(20, 5), q = quote(1); q.expires_at = '2026-09-12T15:00:00.000Z'; await f.publish(q); await f.send('hold', holdPayload(q));
  const later = '2026-09-12T13:00:00.000Z'; assert.equal(providerView(f.state, later).holds[0].status, 'expired');
  await assert.rejects(f.send('confirm', target(q), undefined, later), (error: any) => error.code === 'expired');
  await f.send('hold', { ...holdPayload(q, 71), expires_at: '2026-09-12T14:00:00.000Z' }, undefined, later); assert.equal(f.state.holds[0].status, 'expired');
});

test('commitments: superseded quotes block new confirmation but preserve existing firm obligations', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q); await f.send('hold', holdPayload(q)); await f.send('confirm', target(q));
  await f.send('hold', holdPayload(q, 71));
  const changed = structuredClone(q); changed.previous = q.revision; changed.revision.revision_id = id(1002); changed.revision.digest = 'b'.repeat(64); changed.terms.amount = '200'; await f.publish(changed);
  await assert.rejects(f.send('confirm', target(q, 71)), (error: any) => error.code === 'expired');
  assert.equal(f.state.holds[0].status, 'accepted'); assert.deepEqual(f.state.holds[0].quote, q.revision);
  await assert.rejects(f.send('confirm', target(changed, 71)), denied);
});

test('commitments: cancellation policy is binding and accepted commitments cannot use release', async () => {
  const f = await fixture(), q = quote(1); q.terms.cancellation = 'never'; await f.publish(q); await f.send('hold', holdPayload(q)); await f.send('confirm', target(q));
  await assert.rejects(f.send('release', target(q)), (error: any) => error.code === 'policy');
  await assert.rejects(f.send('cancel', target(q)), (error: any) => error.code === 'policy'); assert.equal(f.state.holds[0].status, 'accepted');
});

test('commitments: short/damaged fulfillment remains disputed and never implies payment settlement', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q); await f.send('hold', holdPayload(q)); await f.send('confirm', target(q));
  const event = await f.send('fulfill', { ...target(q), good: 3, damaged: 1, final: true, evidence: q.revision }, undefined, window.start);
  assert.equal(event.state.holds[0].status, 'disputed'); assert.equal(event.state.holds[0].settlement, 'external_pending'); assert.equal(event.state.holds[0].good, 3);
  await assert.rejects(f.send('fulfill', { ...target(q), good: 1, damaged: 0, final: true, evidence: q.revision }, undefined, window.start), denied);
  await assert.rejects(f.send('cancel', target(q), undefined, window.start), denied);
});

test('commitments: full delivery can still be disputed and remains distinct from settlement', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q); await f.send('hold', holdPayload(q)); await f.send('confirm', target(q));
  await f.send('fulfill', { ...target(q), good: 5, damaged: 0, final: true, evidence: q.revision }, undefined, window.start);
  assert.equal(f.state.holds[0].status, 'completed'); await f.send('dispute', { ...target(q), reason: 'Seal damage reported later', evidence: q.revision }, undefined, window.start);
  assert.equal(f.state.holds[0].status, 'disputed'); assert.equal(f.state.holds[0].settlement, 'external_pending');
});

test('commitments: fractional capacity, wrong ownership/units and modified quote shapes fail closed', async () => {
  const f = await fixture();
  for (const change of [(q: Quote) => { q.quantity = 1.5; }, (q: Quote) => { q.unit = { ...unit, value: 'case' }; }, (q: Quote) => { q.provider = company(21); }]) { const q = quote(1); change(q); await assert.rejects(f.publish(q), denied); }
  await assert.rejects(f.publish({ ...quote(1), private_bank_balance: 'secret' } as any), denied);
  assert.throws(() => createProviderState({ provider: company(20), resource: { kind: 'resource', id: id(120), organization_id: id(20) }, kind: 'warehouse', unit, capacity: 1.5 }, now), denied);
});

function coordination(quotes: Quote[]): CoordinatorState {
  return createCoordinator({ coordination_id: id(800), customer, legs: quotes.map((q, i) => ({ leg_id: id(810 + i), quote: q, hold_id: id(820 + i), hold_expires_at: expires,
    operation_ids: { hold: id(830 + i * 4), confirm: id(831 + i * 4), release: id(832 + i * 4), cancel: id(833 + i * 4) } })) });
}
async function answer(request: CoordinatorRequest, providers: Map<string, Awaited<ReturnType<typeof fixture>>>): Promise<CoordinatorResponse> {
  const f = providers.get(request.provider_id)!, digest = await sha256Hex(canonicalize(request.command));
  try { const result = await f.send(request.command.action, request.command.payload, request.command.operation_id); return { provider_id: request.provider_id, operation_id: request.command.operation_id, command_digest: digest, outcome: 'accepted', receipt: result.receipt, reason: null }; }
  catch (error) { if (!(error instanceof CommitmentError)) throw error; return { provider_id: request.provider_id, operation_id: request.command.operation_id, command_digest: digest, outcome: 'rejected', receipt: null, reason: error.code }; }
}
async function drive(initial: CoordinatorState, providers: Map<string, Awaited<ReturnType<typeof fixture>>>, intercept?: (request: CoordinatorRequest) => Promise<void>): Promise<CoordinatorState> {
  let s = initial;
  for (let i = 0; i < 32; i++) {
    const step = planCoordinator(s, s.revision); s = step.state; if (!step.request) return s;
    await intercept?.(step.request); s = await recordCoordinatorResponse(s, await answer(step.request, providers), s.revision);
  }
  assert.fail('bounded coordinator did not reach a terminal or waiting state');
}

test('coordinator: persisted restart after timeout retries exact operation without duplicate holds', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q); let s = coordination([q]);
  const planned = planCoordinator(s, s.revision); s = planned.state; const lost = await answer(planned.request!, new Map([[q.provider.id, f]]));
  s = recordCoordinatorTimeout(s, planned.request!.command.operation_id, s.revision); assert.equal(s.uncertain, true);
  s = JSON.parse(JSON.stringify(s)); const retry = planCoordinator(s, s.revision); assert.deepEqual(retry.request, planned.request);
  const response = await answer(retry.request!, new Map([[q.provider.id, f]])); assert.deepEqual(response, lost); assert.equal(f.state.holds.length, 1);
  s = await recordCoordinatorResponse(retry.state, response, retry.state.revision); assert.equal(s.uncertain, false);
  assert.deepEqual(await recordCoordinatorResponse(s, response, s.revision - 1), s);
});

test('coordinator: two providers commit only after each exact hold/confirmation succeeds', async () => {
  const a = await fixture(20), b = await fixture(21), qa = quote(1, 20), qb = quote(2, 21); await a.publish(qa); await b.publish(qb);
  const final = await drive(coordination([qa, qb]), new Map([[qa.provider.id, a], [qb.provider.id, b]]));
  assert.equal(final.phase, 'committed'); assert.ok(final.legs.every(l => l.status === 'accepted')); assert.equal(a.state.holds[0].settlement, 'external_pending');
});

test('coordinator: partial confirmation keeps irreversible acceptance visible and releases refused leg hold', async () => {
  const a = await fixture(20), b = await fixture(21), qa = quote(1, 20), qb = quote(2, 21); qa.terms.cancellation = 'never'; await a.publish(qa); await b.publish(qb);
  const final = await drive(coordination([qa, qb]), new Map([[qa.provider.id, a], [qb.provider.id, b]]), async request => {
    if (request.provider_id === qb.provider.id && request.command.action === 'confirm') {
      const revised = structuredClone(qb); revised.previous = qb.revision; revised.revision.revision_id = id(1900); revised.revision.digest = 'e'.repeat(64); revised.terms.amount = '200'; await b.publish(revised);
    }
  });
  assert.equal(final.phase, 'exception'); assert.equal(final.legs[0].status, 'exception'); assert.equal(a.state.holds[0].status, 'accepted'); assert.equal(b.state.holds[0].status, 'released');
});

test('coordinator: reversible acceptance is only compensated after provider-confirmed cancellation', async () => {
  const a = await fixture(20), b = await fixture(21), qa = quote(1, 20), qb = quote(2, 21); await a.publish(qa); await b.publish(qb);
  const final = await drive(coordination([qa, qb]), new Map([[qa.provider.id, a], [qb.provider.id, b]]), async request => {
    if (request.provider_id === qb.provider.id && request.command.action === 'confirm') {
      const revised = structuredClone(qb); revised.previous = qb.revision; revised.revision.revision_id = id(1900); revised.revision.digest = 'e'.repeat(64); await b.publish(revised);
    }
  });
  assert.equal(final.phase, 'compensated'); assert.equal(a.state.holds[0].status, 'cancelled'); assert.equal(b.state.holds[0].status, 'released');
});

test('coordinator: wrong provider, changed quote, conflicted response and premature success reject', async () => {
  const f = await fixture(), q = quote(1); await f.publish(q); const step = planCoordinator(coordination([q]), 0), response = await answer(step.request!, new Map([[q.provider.id, f]]));
  await assert.rejects(recordCoordinatorResponse(step.state, { ...response, provider_id: id(999) }, step.state.revision), denied);
  const completed = await recordCoordinatorResponse(step.state, response, step.state.revision);
  await assert.rejects(recordCoordinatorResponse(completed, { ...response, outcome: 'rejected', receipt: null, reason: 'policy' }, completed.revision), denied);
  const forged = structuredClone(step.state); forged.pending!.command.payload.quote = quote(2).revision; assert.throws(() => planCoordinator(forged, forged.revision), denied);
  assert.throws(() => planCoordinator({ ...completed, phase: 'committed' }, completed.revision), denied);
});
