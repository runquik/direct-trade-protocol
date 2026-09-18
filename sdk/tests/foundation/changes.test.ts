import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangeView, appendChangeBatch, snapshotPage, pullChanges, retainChanges, consumeSnapshotPage, consumeChangePage } from '../../src/foundation/changes.ts';
import type { ChangeItem, ViewBinding } from '../../src/foundation/changes.ts';

const id = (): string => crypto.randomUUID();
const t0 = '2026-09-12T12:00:00.000Z', t1 = '2026-09-12T12:01:00.000Z', end = '2026-09-12T13:00:00.000Z';
function fixture(count = 1) {
  const company = id();
  const binding: ViewBinding = { view_id: id(), subject: { kind: 'person', id: id(), organization_id: null }, audience: 'https://app.example',
    organization_id: company, authority_id: id(), authority_epoch: id(), policy_epoch: id() };
  const item = (): ChangeItem => ({ revision: { entity: { kind: 'record', id: id(), organization_id: company }, revision_id: id(), digest: 'a'.repeat(64) }, profile_digest: 'b'.repeat(64), body: { quantity: '4' } });
  const items = Array.from({ length: count }, item);
  const state = createChangeView({ binding, snapshot: items, source_checkpoint: id(), initial_checkpoint: id(), snapshot_tokens: Array.from({ length: Math.max(0, Math.ceil(count / 64) - 1) }, id), as_of: t0, expires_at: end });
  const event = (previous = items[0]) => ({ event_id: id(), checkpoint: id(), entity: previous.revision.entity, previous: previous.revision,
    value: { ...previous, revision: { ...previous.revision, revision_id: id(), digest: 'c'.repeat(64) }, body: { quantity: '3' } }, accepted_at: t1 });
  const batch = (events: ReturnType<typeof event>[]) => ({ expected_version: state.version, from_source_checkpoint: state.source_checkpoint, to_source_checkpoint: id(), events, as_of: t1 });
  return { binding, items, state, item, event, batch };
}

test('snapshot and catch-up share an immutable boundary despite concurrent additions', () => {
  const f = fixture(65), first = snapshotPage(f.state, f.binding, null, t0);
  assert.equal(first.kind, 'snapshot'); if (first.kind !== 'snapshot') return;
  let consumer = consumeSnapshotPage(null, first);
  const updated = appendChangeBatch(f.state, f.batch([f.event()]));
  const second = snapshotPage(updated, f.binding, first.next, t1);
  assert.equal(second.kind, 'snapshot'); if (second.kind !== 'snapshot') return;
  assert.deepEqual(second.items, [f.items[64]]); assert.equal(second.snapshot_as_of, t0); assert.equal(second.current_as_of, t1);
  consumer = consumeSnapshotPage(consumer, second);
  consumer = consumeChangePage(consumer, pullChanges(updated, f.binding, consumer.checkpoint!, 64, t1));
  assert.equal(consumer.items.length, 65); assert.equal(consumer.items[0].body && (consumer.items[0].body as any).quantity, '3');
  assert.equal(consumer.completeness, 'complete'); assert.equal(consumer.as_of, t1);
});

test('snapshot page retry and serialized consumer restart do not duplicate records', () => {
  const f = fixture(65), first = snapshotPage(f.state, f.binding, null, t0); assert.equal(first.kind, 'snapshot'); if (first.kind !== 'snapshot') return;
  let consumer = consumeSnapshotPage(null, first); const repeated = consumeSnapshotPage(consumer, first); assert.deepEqual(repeated, consumer);
  consumer = JSON.parse(JSON.stringify(consumer));
  const second = snapshotPage(f.state, f.binding, first.next, t0); assert.equal(second.kind, 'snapshot'); if (second.kind !== 'snapshot') return;
  assert.throws(() => consumeSnapshotPage(null, second));
  assert.equal(consumeSnapshotPage(consumer, second).items.length, 65);
});

test('at-least-once change deliveries deduplicate and reject reordered or missing predecessors', () => {
  const f = fixture(), initial = snapshotPage(f.state, f.binding, null, t0); if (initial.kind !== 'snapshot') throw Error('fixture');
  let consumer = consumeSnapshotPage(null, initial);
  const e1 = f.event(), e2 = f.event(e1.value); e2.value.revision.digest = 'd'.repeat(64);
  const state = appendChangeBatch(f.state, f.batch([e1, e2]));
  const p1 = pullChanges(state, f.binding, consumer.checkpoint!, 1, t1); if (p1.kind !== 'changes') throw Error('fixture');
  const p2 = pullChanges(state, f.binding, p1.to, 1, t1);
  assert.throws(() => consumeChangePage(consumer, p2));
  consumer = consumeChangePage(consumer, p1); assert.deepEqual(consumeChangePage(consumer, p1), consumer);
  consumer = consumeChangePage(JSON.parse(JSON.stringify(consumer)), p2);
  assert.equal(consumer.checkpoint, e2.checkpoint); assert.equal(consumer.items[0].revision.digest, 'd'.repeat(64));
});

test('source retries are exact and continuity/version conflicts leave input unchanged', () => {
  const f = fixture(), batch = f.batch([f.event()]), state = appendChangeBatch(f.state, batch);
  assert.deepEqual(appendChangeBatch(state, batch), state);
  assert.throws(() => appendChangeBatch(state, { ...batch, events: [{ ...batch.events[0], accepted_at: t0 }] }));
  assert.throws(() => appendChangeBatch(state, { ...batch, expected_version: state.version, to_source_checkpoint: id() }));
  assert.equal(f.state.version, 0); assert.deepEqual(f.state.snapshot, f.items);
});

test('policy, person, audience and authority changes invalidate without removed identifiers or counts', () => {
  const f = fixture(65), first = snapshotPage(f.state, f.binding, null, t0); if (first.kind !== 'snapshot') throw Error('fixture');
  const expected = { kind: 'resnapshot_required' };
  for (const binding of [{ ...f.binding, policy_epoch: id() }, { ...f.binding, authority_epoch: id() }, { ...f.binding, authority_id: id() },
    { ...f.binding, subject: { ...f.binding.subject, id: id() } }, { ...f.binding, audience: 'https://another.example' }]) {
    assert.deepEqual(snapshotPage(f.state, binding, first.next, t1), expected);
    assert.deepEqual(pullChanges(f.state, binding, f.state.initial_checkpoint, 64, t1), expected);
  }
  const invalid = consumeChangePage(consumeSnapshotPage(null, first), expected as any);
  assert.equal(invalid.mode, 'invalidated'); assert.deepEqual(invalid.items, []);
});

test('retention gaps and expiry require fresh snapshot; hidden-only source traffic does not advance visible checkpoint', () => {
  const f = fixture(), hidden = appendChangeBatch(f.state, f.batch([]));
  const page = pullChanges(hidden, f.binding, f.state.initial_checkpoint, 64, t1); if (page.kind !== 'changes') throw Error('fixture');
  assert.equal(page.from, page.to); assert.deepEqual(page.events, []);
  assert.ok(!JSON.stringify(page).includes(hidden.source_checkpoint)); assert.ok(!('version' in page));
  const state = appendChangeBatch(hidden, { ...f.batch([f.event()]), expected_version: hidden.version, from_source_checkpoint: hidden.source_checkpoint });
  const pruned = retainChanges(state, state.version, 0);
  assert.deepEqual(pullChanges(pruned, f.binding, f.state.initial_checkpoint, 64, t1), { kind: 'resnapshot_required' });
  assert.deepEqual(snapshotPage(pruned, f.binding, null, end), { kind: 'resnapshot_required' });
});

test('correction then tombstone reconstructs an empty view and conflicting stable event IDs fail', () => {
  const f = fixture(), initial = snapshotPage(f.state, f.binding, null, t0); if (initial.kind !== 'snapshot') throw Error('fixture');
  const e1 = f.event(), removed = { ...e1, event_id: id(), checkpoint: id(), previous: e1.value.revision, value: null };
  const state = appendChangeBatch(f.state, f.batch([e1, removed] as any));
  assert.deepEqual(consumeChangePage(consumeSnapshotPage(null, initial), pullChanges(state, f.binding, f.state.initial_checkpoint, 64, t1)).items, []);
  assert.throws(() => appendChangeBatch(state, { ...f.batch([{ ...e1, checkpoint: id() }]), expected_version: state.version, from_source_checkpoint: state.source_checkpoint }));
});

test('cross-company projections, malformed data and opaque token aliases fail before effects', () => {
  const f = fixture(), event = f.event(); event.value.revision.entity = { ...event.entity, organization_id: id() };
  assert.throws(() => appendChangeBatch(f.state, f.batch([event])));
  assert.throws(() => appendChangeBatch(f.state, f.batch([{ ...f.event(), checkpoint: f.state.initial_checkpoint }])));
  let invoked = false; const malicious = { ...f.event() }; Object.defineProperty(malicious, 'value', { enumerable: true, get() { invoked = true; return null; } });
  assert.throws(() => appendChangeBatch(f.state, f.batch([malicious]))); assert.equal(invoked, false);
  assert.throws(() => pullChanges(f.state, f.binding, f.state.initial_checkpoint, 65, t0));
});

test('a replacement consumer reconstructs identical unfinished work without executing business effects', () => {
  const f = fixture(), initial = snapshotPage(f.state, f.binding, null, t0); if (initial.kind !== 'snapshot') throw Error('fixture');
  const state = appendChangeBatch(f.state, f.batch([f.event()]));
  const page = pullChanges(state, f.binding, f.state.initial_checkpoint, 64, t1);
  const a = consumeChangePage(consumeSnapshotPage(null, initial), page);
  const b = consumeChangePage(consumeSnapshotPage(null, initial), page);
  assert.deepEqual(a, b); assert.deepEqual(a.items, state.current);
});

test('declared item, page, TTL and byte bounds reject oversized projections', () => {
  const f = fixture();
  const { binding, snapshot, source_checkpoint, initial_checkpoint, snapshot_tokens, as_of } = f.state;
  assert.throws(() => createChangeView({ binding, snapshot: Array.from({ length: 1025 }, f.item), source_checkpoint, initial_checkpoint, snapshot_tokens, as_of, expires_at: end }));
  const tooBig = f.event(); tooBig.value.body = { quantity: 'x'.repeat(17000) };
  assert.throws(() => appendChangeBatch(f.state, f.batch([tooBig])));
  assert.throws(() => appendChangeBatch(f.state, f.batch(Array.from({ length: 65 }, () => f.event()))));
  assert.throws(() => createChangeView({ binding, snapshot, source_checkpoint, initial_checkpoint, snapshot_tokens, as_of, expires_at: '2026-09-14T12:00:00.000Z' }));
});

test('view storage and returned pages are detached from caller objects', () => {
  const f = fixture(), original = structuredClone(f.state), page = snapshotPage(f.state, f.binding, null, t0);
  if (page.kind !== 'snapshot') throw Error('fixture');
  (page.items[0].body as any).quantity = '999'; page.binding.subject.id = id();
  assert.deepEqual(f.state, original);
  const batch = f.batch([f.event()]), state = appendChangeBatch(f.state, batch);
  batch.events[0].value.body.quantity = '777';
  assert.equal((state.current[0].body as any).quantity, '3');
});

test('new view after cooperative relocation reconstructs state and rejects old view checkpoint', () => {
  const f = fixture(), state = appendChangeBatch(f.state, f.batch([f.event()]));
  const binding = { ...f.binding, view_id: id(), authority_id: id(), authority_epoch: id() };
  const moved = createChangeView({ binding, snapshot: state.current, source_checkpoint: id(), initial_checkpoint: id(), snapshot_tokens: [], as_of: t1, expires_at: end });
  assert.deepEqual(pullChanges(moved, binding, state.latest_checkpoint, 64, t1), { kind: 'resnapshot_required' });
  const page = snapshotPage(moved, binding, null, t1); if (page.kind !== 'snapshot') throw Error('fixture');
  const consumer = consumeChangePage(consumeSnapshotPage(null, page), pullChanges(moved, binding, page.base_checkpoint, 64, t1));
  assert.deepEqual(consumer.items, state.current); assert.equal(consumer.completeness, 'complete');
});
