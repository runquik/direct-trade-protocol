import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256Hex } from '../../src/canonical.ts';
import { createProviderState, applyProviderCommand, providerView, createCoordinator, planCoordinator,
  recordCoordinatorTimeout, recordCoordinatorResponse, CommitmentError } from '../../src/foundation/commitments.ts';
import type { Quote, ProviderCommand, CoordinatorState, CoordinatorRequest, CoordinatorResponse } from '../../src/foundation/commitments.ts';

// Independent synthetic fixtures, not imported from the implementation's test suite.
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = (n: number) => ({ kind: 'organization' as const, id: id(n), organization_id: null });
const now = '2026-09-12T00:00:00.000Z', expiry = '2026-09-12T12:00:00.000Z';
const at = (hour: number) => `2026-09-12T${String(hour).padStart(2, '0')}:00:00.000Z`;
const unit = { issuer: company(90), type: 'unit', value: 'slot' }, customer = company(1);
function q(n: number, quantity = 2, start = 4, end = 8, provider = 2): Quote {
  return { revision: { entity: { kind: 'record', id: id(100 + n), organization_id: id(provider) }, revision_id: id(200 + n), digest: n.toString(16).padStart(64, '0') }, previous: null,
    provider: company(provider), customer, resource: { kind: 'resource', id: id(provider + 20), organization_id: id(provider) }, quantity, unit,
    window: { start: at(start), end: at(end) }, expires_at: expiry,
    terms: { amount: '31.125', currency: { issuer: company(90), type: 'currency', value: 'USD' }, taxes: 'unknown', fees: 'excluded', cancellation: 'before_fulfillment',
      combined_quote_issuer: customer.id, buyer_counterparty: id(provider), freight_cost_bearer: customer.id, substitutions: 'new_quote_and_approval' } };
}
function provider(capacity = 10, n = 2) {
  let s = createProviderState({ provider: company(n), resource: { kind: 'resource', id: id(n + 20), organization_id: id(n) }, kind: 'warehouse', unit, capacity }, now);
  let serial = 10000 + n * 1000;
  const send = async (action: ProviderCommand['action'], payload: Record<string, unknown>, time = now, operation = id(++serial)) => {
    const command = { operation_id: operation, action, payload };
    const result = await applyProviderCommand(s, command, { expected_revision: s.revision, accepted_at: time }); s = result.state;
    return { ...result, command };
  };
  return { get state() { return s; }, send, publish: (quote: Quote) => send('quote.publish', { quote }) };
}
const target = (quote: Quote, n = 400) => ({ hold_id: id(n), quote: quote.revision });
const held = (quote: Quote, n = 400, expires = expiry) => ({ ...target(quote, n), expires_at: expires });
const rejected = (e: unknown) => e instanceof CommitmentError || (e as any)?.name === 'DatatypeError';

test('independent commitments: sweep agrees with discrete half-open peak oracle across many reservations', async () => {
  const p = provider(9), accepted: { start: number; end: number; quantity: number }[] = [];
  // Deliberately alternating windows: pairwise overlap sums would reject valid bookings.
  const windows = [[1, 4, 6], [4, 7, 6], [2, 6, 3], [6, 9, 3], [1, 2, 3], [3, 5, 1], [8, 10, 6], [7, 8, 6], [2, 3, 1], [10, 11, 9]];
  for (let i = 0; i < windows.length; i++) {
    const [start, end, quantity] = windows[i], quote = q(i + 1, quantity, start, end); await p.publish(quote);
    const fits = Array.from({ length: 12 }, (_, h) => h).every(h => accepted.reduce((sum, x) => sum + (x.start <= h && h < x.end ? x.quantity : 0), 0) + (start <= h && h < end ? quantity : 0) <= 9);
    if (fits) { await p.send('hold', held(quote, 400 + i)); accepted.push({ start, end, quantity }); }
    else { const before = structuredClone(p.state); await assert.rejects(p.send('hold', held(quote, 400 + i)), (e: any) => e.code === 'capacity'); assert.deepEqual(p.state, before); }
  }
  assert.equal(p.state.holds.length, accepted.length);
});

test('independent commitments: completed or disputed booking retains capacity, cancellation alone releases firm capacity', async () => {
  for (const good of [2, 1]) {
    const p = provider(2), quote = q(1); await p.publish(quote); await p.send('hold', held(quote)); await p.send('confirm', target(quote));
    await p.send('fulfill', { ...target(quote), good, damaged: 0, final: true, evidence: quote.revision }, at(4));
    const another = q(2); await p.send('quote.publish', { quote: another }, at(4));
    await assert.rejects(p.send('hold', held(another, 401), at(4)), (e: any) => e.code === 'capacity');
    assert.equal(p.state.holds[0].settlement, 'external_pending');
  }
  const p = provider(2), quote = q(3); await p.publish(quote); await p.send('hold', held(quote)); await p.send('confirm', target(quote));
  await p.send('cancel', target(quote)); await p.send('hold', held(quote, 401)); assert.equal(p.state.holds[0].status, 'cancelled');
});

test('independent commitments: new confirmation cannot accept a capacity window that has already ended', async () => {
  const p = provider(), quote = q(1, 2, 1, 2); await p.publish(quote); await p.send('hold', held(quote));
  const before = structuredClone(p.state);
  await assert.rejects(p.send('confirm', target(quote), at(2)), (e: any) => e.code === 'expired');
  assert.deepEqual(p.state, before);
});

test('independent commitments: exact expiry rejects confirmation while a historical hold retry remains only historical', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const result = await p.send('hold', held(quote, 400, at(2)));
  await assert.rejects(p.send('confirm', target(quote), at(2)), (e: any) => e.code === 'expired');
  const replay = await applyProviderCommand(p.state, result.command, { expected_revision: 0, accepted_at: at(3) });
  assert.equal(replay.duplicate, true); assert.equal(replay.receipt.historical, true); assert.equal(replay.receipt.status, 'held');
  assert.equal(providerView(replay.state, at(3)).holds[0].status, 'expired');
});

test('independent commitments: replay conflicts bind action, hold, quote and evidence without reapplying effects', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const result = await p.send('hold', held(quote));
  for (const changed of [
    { ...result.command, action: 'release', payload: target(quote) },
    { ...result.command, payload: held(quote, 401) },
    { ...result.command, payload: { ...held(quote), expires_at: at(3) } },
    { ...result.command, payload: held({ ...quote, revision: { ...quote.revision, digest: 'f'.repeat(64) } }) },
  ]) await assert.rejects(applyProviderCommand(p.state, changed, { expected_revision: p.state.revision, accepted_at: now }), rejected);
  await p.send('confirm', target(quote)); const delivery = await p.send('fulfill', { ...target(quote), good: 1, damaged: 0, final: false, evidence: quote.revision }, at(4));
  const retry = await applyProviderCommand(p.state, delivery.command, { expected_revision: 0, accepted_at: at(5) }); assert.equal(retry.state.holds[0].good, 1);
  await assert.rejects(applyProviderCommand(p.state, { ...delivery.command, payload: { ...delivery.command.payload, evidence: q(2).revision } }, { expected_revision: p.state.revision, accepted_at: at(5) }), rejected);
});

test('independent commitments: partial damage and zero final shortage cannot masquerade as complete or settled', async () => {
  const p = provider(), quote = q(1, 5); await p.publish(quote); await p.send('hold', held(quote)); await p.send('confirm', target(quote));
  await p.send('fulfill', { ...target(quote), good: 2, damaged: 1, final: false, evidence: quote.revision }, at(4));
  await assert.rejects(p.send('cancel', target(quote), at(4)), (e: any) => e.code === 'policy');
  await p.send('fulfill', { ...target(quote), good: 0, damaged: 0, final: true, evidence: q(2).revision }, at(4));
  assert.equal(p.state.holds[0].status, 'disputed'); assert.equal(p.state.holds[0].fulfillment_closed, true); assert.equal(p.state.holds[0].settlement, 'external_pending');
  const before = structuredClone(p.state); await assert.rejects(p.send('fulfill', { ...target(quote), good: 2, damaged: 0, final: true, evidence: q(3).revision }, at(4)), rejected); assert.deepEqual(p.state, before);
});

function coordinator(quotes: Quote[]): CoordinatorState {
  return createCoordinator({ coordination_id: id(800), customer, legs: quotes.map((quote, i) => ({ leg_id: id(810 + i), quote, hold_id: id(820 + i), hold_expires_at: expiry,
    operation_ids: { hold: id(900 + i * 4), confirm: id(901 + i * 4), release: id(902 + i * 4), cancel: id(903 + i * 4) } })) });
}
async function answer(request: CoordinatorRequest, providers: Map<string, ReturnType<typeof provider>>, time = now): Promise<CoordinatorResponse> {
  const command_digest = await sha256Hex(canonicalize(request.command));
  try { const r = await providers.get(request.provider_id)!.send(request.command.action, request.command.payload, time, request.command.operation_id);
    return { provider_id: request.provider_id, operation_id: request.command.operation_id, command_digest, outcome: 'accepted', receipt: r.receipt, reason: null };
  } catch (e) { if (!(e instanceof CommitmentError)) throw e; return { provider_id: request.provider_id, operation_id: request.command.operation_id, command_digest, outcome: 'rejected', receipt: null, reason: e.code }; }
}
async function step(s: CoordinatorState, providers: Map<string, ReturnType<typeof provider>>, time = now) {
  const planned = planCoordinator(s, s.revision); assert.ok(planned.request);
  return recordCoordinatorResponse(planned.state, await answer(planned.request, providers, time), planned.state.revision);
}

test('independent coordinator: provider receipt binding rejects each independently altered field', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const providers = new Map([[quote.provider.id, p]]);
  const planned = planCoordinator(coordinator([quote]), 0), response = await answer(planned.request!, providers);
  for (const change of [
    (r: CoordinatorResponse) => { r.provider_id = id(3); },
    (r: CoordinatorResponse) => { r.operation_id = id(999); },
    (r: CoordinatorResponse) => { r.command_digest = 'f'.repeat(64); },
    (r: CoordinatorResponse) => { r.receipt!.hold_id = id(999); },
    (r: CoordinatorResponse) => { r.receipt!.action = 'confirm'; },
    (r: CoordinatorResponse) => { r.receipt!.status = 'accepted'; },
    (r: CoordinatorResponse) => { r.receipt!.quote.digest = 'f'.repeat(64); },
    (r: CoordinatorResponse) => { r.receipt!.command_digest = 'f'.repeat(64); },
  ]) { const r = structuredClone(response); change(r); await assert.rejects(recordCoordinatorResponse(planned.state, r, planned.state.revision), rejected); }
  const result = await recordCoordinatorResponse(planned.state, response, planned.state.revision); assert.equal(result.legs[0].status, 'held');
  assert.deepEqual(await recordCoordinatorResponse(result, response, 0), result);
});

test('independent coordinator: timeout after real confirmation neither compensates nor duplicates a firm obligation', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const providers = new Map([[quote.provider.id, p]]);
  let s = await step(coordinator([quote]), providers); const planned = planCoordinator(s, s.revision);
  assert.equal(planned.request!.command.action, 'confirm'); const lost = await answer(planned.request!, providers);
  s = recordCoordinatorTimeout(planned.state, planned.request!.command.operation_id, planned.state.revision);
  assert.equal(s.phase, 'confirming'); assert.equal(s.uncertain, true); assert.equal(p.state.holds[0].status, 'accepted');
  for (let i = 0; i < 3; i++) {
    const restarted = planCoordinator(JSON.parse(JSON.stringify(s)), s.revision); assert.deepEqual(restarted.request, planned.request);
    s = recordCoordinatorTimeout(restarted.state, restarted.request!.command.operation_id, restarted.state.revision);
  }
  const retried = planCoordinator(s, s.revision), response = await answer(retried.request!, providers); assert.deepEqual(response, lost);
  s = await recordCoordinatorResponse(retried.state, response, retried.state.revision); s = planCoordinator(s, s.revision).state;
  assert.equal(s.phase, 'committed'); assert.equal(p.state.holds.length, 1); assert.equal(p.state.receipts.filter(r => r.action === 'confirm').length, 1);
});

test('independent coordinator: expired hold receipt cannot finish coordination without a fresh confirmation', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const providers = new Map([[quote.provider.id, p]]);
  const initial = coordinator([quote]); initial.legs[0].hold_expires_at = at(2);
  let s = await step(initial, providers); s = await step(s, providers, at(2));
  assert.equal(s.phase, 'compensating'); assert.equal(s.legs[0].status, 'held');
  s = await step(s, providers, at(2)); s = planCoordinator(s, s.revision).state;
  assert.equal(s.phase, 'compensated'); assert.equal(p.state.holds[0].status, 'released');
});

test('independent coordinator: real fulfillment racing compensation leaves an exception, not fictional rollback', async () => {
  const a = provider(10, 2), b = provider(10, 3), qa = q(1, 2, 4, 8, 2), qb = q(2, 2, 4, 8, 3);
  await a.publish(qa); await b.publish(qb); const providers = new Map([[qa.provider.id, a], [qb.provider.id, b]]);
  let s = coordinator([qa, qb]); s = await step(s, providers); s = await step(s, providers); s = await step(s, providers);
  assert.equal(a.state.holds[0].status, 'accepted');
  const changed = structuredClone(qb); changed.previous = qb.revision; changed.revision.revision_id = id(999); changed.revision.digest = 'e'.repeat(64); await b.publish(changed);
  s = await step(s, providers); assert.equal(s.phase, 'compensating');
  await a.send('fulfill', { ...target(qa, 820), good: 1, damaged: 0, final: false, evidence: qa.revision }, at(4));
  s = await step(s, providers, at(4)); assert.equal(s.legs[0].status, 'exception');
  s = await step(s, providers, at(4)); s = planCoordinator(s, s.revision).state;
  assert.equal(s.phase, 'exception'); assert.equal(a.state.holds[0].status, 'fulfilling'); assert.equal(b.state.holds[0].status, 'released');
});

test('independent commitments: asynchronous input mutations do not change provider command or returned state', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); const original = structuredClone(p.state), command = { operation_id: id(990), action: 'hold', payload: held(quote) };
  const pending = applyProviderCommand(original, command, { expected_revision: original.revision, accepted_at: now });
  original.capacity = 1; command.payload.hold_id = id(991); quote.terms.amount = '999';
  const result = await pending; assert.equal(result.state.capacity, 10); assert.equal(result.state.holds[0].id, id(400)); assert.equal(result.state.quotes[0].terms.amount, '31.125');
});

test('independent coordinator: lost cancellation acknowledgment stays uncertain until the exact receipt is recovered', async () => {
  const a = provider(10, 2), b = provider(10, 3), qa = q(1, 2, 4, 8, 2), qb = q(2, 2, 4, 8, 3);
  await a.publish(qa); await b.publish(qb); const providers = new Map([[qa.provider.id, a], [qb.provider.id, b]]);
  let s = coordinator([qa, qb]); for (let i = 0; i < 3; i++) s = await step(s, providers);
  const changed = structuredClone(qb); changed.previous = qb.revision; changed.revision.revision_id = id(999); changed.revision.digest = 'e'.repeat(64); await b.publish(changed);
  s = await step(s, providers); const cancel = planCoordinator(s, s.revision); assert.equal(cancel.request!.command.action, 'cancel');
  const lost = await answer(cancel.request!, providers); assert.equal(a.state.holds[0].status, 'cancelled');
  s = recordCoordinatorTimeout(cancel.state, cancel.request!.command.operation_id, cancel.state.revision);
  assert.equal(s.phase, 'compensating'); assert.equal(s.legs[0].status, 'accepted'); assert.equal(s.uncertain, true);
  const restored = planCoordinator(JSON.parse(JSON.stringify(s)), s.revision); assert.deepEqual(restored.request, cancel.request);
  const retry = await answer(restored.request!, providers); assert.deepEqual(retry, lost);
  s = await recordCoordinatorResponse(restored.state, retry, restored.state.revision);
  s = await step(s, providers); s = planCoordinator(s, s.revision).state;
  assert.equal(s.phase, 'compensated'); assert.equal(a.state.receipts.filter(r => r.action === 'cancel').length, 1); assert.equal(b.state.holds[0].status, 'released');
});

test('independent commitments: malformed data and empty nonfinal fulfillment cannot change authoritative input', async () => {
  const p = provider(), quote = q(1); await p.publish(quote); await p.send('hold', held(quote)); await p.send('confirm', target(quote));
  const before = structuredClone(p.state);
  let calls = 0; const payload = { ...target(quote), good: 0, damaged: 0, final: false, evidence: quote.revision };
  Object.defineProperty(payload, 'good', { enumerable: true, get() { calls++; return 1; } });
  await assert.rejects(p.send('fulfill', payload), rejected); assert.equal(calls, 0);
  await assert.rejects(p.send('fulfill', { ...target(quote), good: 0, damaged: 0, final: false, evidence: quote.revision }), rejected);
  await assert.rejects(p.send('fulfill', { ...target(quote), good: Number.MAX_SAFE_INTEGER, damaged: Number.MAX_SAFE_INTEGER, final: true, evidence: quote.revision }), rejected);
  assert.deepEqual(p.state, before);
});
