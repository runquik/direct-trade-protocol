import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangeView, appendChangeBatch, retainChanges, snapshotPage, pullChanges, consumeSnapshotPage, consumeChangePage } from '../../src/foundation/changes.ts';
import type { ChangeItem, ChangeEvent, ChangeView, SnapshotPage, ChangesPage, ViewBinding } from '../../src/foundation/changes.ts';

const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const t = (n: number) => `2026-09-12T${String(n).padStart(2, '0')}:00:00.000Z`;
function fixture(count = 1) {
  let serial = 2000; const fresh = () => id(serial++);
  const binding: ViewBinding = { view_id: id(1), subject: { kind: 'person', id: id(2), organization_id: null }, audience: 'https://review.example',
    organization_id: id(3), authority_id: id(4), authority_epoch: id(5), policy_epoch: id(6) };
  const item = (n: number): ChangeItem => ({ revision: { entity: { kind: 'record', id: id(100 + n), organization_id: binding.organization_id }, revision_id: id(1200 + n), digest: 'a'.repeat(64) }, profile_digest: 'b'.repeat(64), body: { count: n } });
  const snapshot = Array.from({ length: count }, (_, n) => item(n));
  const state = createChangeView({ binding, snapshot, source_checkpoint: id(10), initial_checkpoint: id(11), snapshot_tokens: Array.from({ length: Math.max(0, Math.ceil(count / 64) - 1) }, fresh), as_of: t(0), expires_at: t(23) });
  const change = (previous: ChangeItem | null, value: ChangeItem | null = previous, hour = 1): ChangeEvent => {
    const next = value === null ? null : { ...structuredClone(value), revision: { ...structuredClone(value.revision), revision_id: fresh(), digest: 'c'.repeat(64) } };
    return { event_id: fresh(), checkpoint: fresh(), entity: (previous ?? next)!.revision.entity, previous: previous?.revision ?? null, value: next, accepted_at: t(hour) };
  };
  const batch = (s: ChangeView, events: ChangeEvent[], hour = 1) => ({ expected_version: s.version, from_source_checkpoint: s.source_checkpoint, to_source_checkpoint: fresh(), events, as_of: t(hour) });
  return { state, binding, item, change, batch, fresh };
}
const snapshot = (value: ReturnType<typeof snapshotPage>): SnapshotPage => { assert.equal(value.kind, 'snapshot'); if (value.kind !== 'snapshot') throw Error('fixture snapshot'); return value; };
const changes = (value: ReturnType<typeof pullChanges>): ChangesPage => { assert.equal(value.kind, 'changes'); if (value.kind !== 'changes') throw Error('fixture changes'); return value; };

test('independent feed: immutable multi-page snapshot plus updates/addition/tombstone reconstructs exact authoritative projection', () => {
  const f = fixture(130), first = snapshot(snapshotPage(f.state, f.binding, null, t(0)));
  let consumer = consumeSnapshotPage(null, first);
  const revised = f.change(f.state.current[0]), removed = f.change(f.state.current[129], null), added = f.change(null, f.item(150));
  const state = appendChangeBatch(f.state, f.batch(f.state, [revised, removed, added]));
  const second = snapshot(snapshotPage(state, f.binding, first.next, t(1))), third = snapshot(snapshotPage(state, f.binding, second.next, t(1)));
  assert.throws(() => consumeSnapshotPage(consumer, third));
  consumer = consumeSnapshotPage(JSON.parse(JSON.stringify(consumer)), second); consumer = consumeSnapshotPage(consumer, third);
  assert.equal(consumer.items.length, 130); assert.equal(consumer.completeness, 'partial'); assert.deepEqual(consumer.items, f.state.snapshot);
  consumer = consumeChangePage(consumer, pullChanges(state, f.binding, consumer.checkpoint!, 64, t(1)));
  assert.deepEqual(consumer.items, state.current); assert.equal(consumer.completeness, 'complete'); assert.equal(consumer.as_of, t(1));
});

test('independent feed: reordered, omitted and overlapping duplicated changes preserve exact chain after restart', () => {
  const f = fixture(), initial = consumeSnapshotPage(null, snapshot(snapshotPage(f.state, f.binding, null, t(0))));
  const a = f.change(f.state.current[0]), b = f.change(a.value!), c = f.change(b.value!);
  const state = appendChangeBatch(f.state, f.batch(f.state, [a, b, c]));
  const all = changes(pullChanges(state, f.binding, state.initial_checkpoint, 64, t(1)));
  for (const events of [[all.events[1], all.events[0], all.events[2]], [all.events[0], all.events[2]]]) {
    assert.throws(() => consumeChangePage(initial, { ...all, events })); assert.equal(initial.items[0].revision.digest, 'a'.repeat(64));
  }
  let consumer = consumeChangePage(initial, changes(pullChanges(state, f.binding, state.initial_checkpoint, 2, t(1))));
  consumer = consumeChangePage(JSON.parse(JSON.stringify(consumer)), all); assert.equal(consumer.seen.length, 3); assert.deepEqual(consumer.items, state.current);
  assert.deepEqual(consumeChangePage(consumer, all), consumer);
});

test('independent feed: stable event ID cannot acquire changed body/provenance even after delivery history is pruned', () => {
  const f = fixture(), event = f.change(f.state.current[0]); let state = appendChangeBatch(f.state, f.batch(f.state, [event]));
  state = retainChanges(state, state.version, 0);
  const before = structuredClone(state);
  for (const mutate of [
    (e: ChangeEvent) => { (e.value!.body as any).count = 999; },
    (e: ChangeEvent) => { e.checkpoint = f.fresh(); },
    (e: ChangeEvent) => { e.accepted_at = t(2); },
    (e: ChangeEvent) => { e.value!.profile_digest = 'd'.repeat(64); },
  ]) { const altered = structuredClone(event); mutate(altered); assert.throws(() => appendChangeBatch(state, f.batch(state, [altered], 2))); assert.deepEqual(state, before); }
  const deduped = appendChangeBatch(state, f.batch(state, [event], 2)); assert.deepEqual(deduped.current, state.current); assert.equal(deduped.events.length, 0); assert.equal(deduped.seen.length, 1);
});

test('independent feed: hidden-only activity at equal scan watermark is byte-indistinguishable across pages', () => {
  const f = fixture(65); const a = appendChangeBatch(f.state, f.batch(f.state, [], 2));
  let b = appendChangeBatch(f.state, f.batch(f.state, [], 1)); b = appendChangeBatch(b, f.batch(b, [], 2));
  assert.notEqual(a.version, b.version); assert.notEqual(a.source_checkpoint, b.source_checkpoint);
  assert.deepEqual(snapshotPage(a, f.binding, null, t(2)), snapshotPage(b, f.binding, null, t(2)));
  assert.deepEqual(pullChanges(a, f.binding, a.initial_checkpoint, 64, t(2)), pullChanges(b, f.binding, b.initial_checkpoint, 64, t(2)));
  const event = f.change(f.state.current[0], f.state.current[0], 3);
  const aa = appendChangeBatch(a, f.batch(a, [event], 3)), bb = appendChangeBatch(b, f.batch(b, [event], 3));
  assert.deepEqual(pullChanges(aa, f.binding, aa.initial_checkpoint, 64, t(3)), pullChanges(bb, f.binding, bb.initial_checkpoint, 64, t(3)));
});

test('independent feed: every current authority/view binding component invalidates continuation uniformly', () => {
  const f = fixture(65), first = snapshot(snapshotPage(f.state, f.binding, null, t(0)));
  const bindings: ViewBinding[] = [
    ...['view_id', 'organization_id', 'authority_id', 'authority_epoch', 'policy_epoch'].map(field => ({ ...f.binding, [field]: f.fresh() })),
    { ...f.binding, audience: 'https://other.example' }, { ...f.binding, subject: { kind: 'service', id: f.fresh(), organization_id: f.binding.organization_id } },
  ];
  for (const binding of bindings) {
    assert.deepEqual(snapshotPage(f.state, binding, first.next, t(1)), { kind: 'resnapshot_required' });
    assert.deepEqual(pullChanges(f.state, binding, f.state.initial_checkpoint, 1, t(1)), { kind: 'resnapshot_required' });
  }
  const current = { ...f.binding, policy_epoch: f.fresh() }, invalid = consumeChangePage(consumeSnapshotPage(null, first), snapshotPage(f.state, current, first.next, t(1)) as any);
  assert.equal(invalid.mode, 'invalidated'); assert.deepEqual(invalid.items, []); assert.deepEqual(invalid.snapshot_receipts, []);
});

test('independent feed: pruned snapshot boundary and exactly expired view never yield apparently complete stale pages', () => {
  const f = fixture(65), first = snapshot(snapshotPage(f.state, f.binding, null, t(0))), a = f.change(f.state.current[0]), b = f.change(a.value!);
  const state = appendChangeBatch(f.state, f.batch(f.state, [a, b])), pruned = retainChanges(state, state.version, 1);
  assert.deepEqual(snapshotPage(pruned, f.binding, first.next, t(1)), { kind: 'resnapshot_required' });
  assert.deepEqual(pullChanges(pruned, f.binding, state.initial_checkpoint, 64, t(1)), { kind: 'resnapshot_required' });
  assert.equal(changes(pullChanges(pruned, f.binding, a.checkpoint, 64, t(1))).events[0].event_id, b.event_id);
  for (const view of [state, pruned]) {
    assert.deepEqual(snapshotPage(view, f.binding, null, t(23)), { kind: 'resnapshot_required' });
    assert.deepEqual(pullChanges(view, f.binding, view.latest_checkpoint, 64, t(23)), { kind: 'resnapshot_required' });
  }
});

test('independent feed: source gaps/CAS failures and conflicting delivery IDs roll back the whole returned transition', () => {
  const f = fixture(), a = f.change(f.state.current[0]), b = f.change(a.value!), batch = f.batch(f.state, [a, b]);
  for (const altered of [{ ...batch, expected_version: 2 }, { ...batch, from_source_checkpoint: f.fresh() }, { ...batch, events: [b, a] }]) assert.throws(() => appendChangeBatch(f.state, altered));
  assert.equal(f.state.current[0].revision.digest, 'a'.repeat(64)); assert.equal(f.state.seen.length, 0);
  const state = appendChangeBatch(f.state, batch), page = changes(pullChanges(state, f.binding, state.initial_checkpoint, 64, t(1)));
  const initial = consumeSnapshotPage(null, snapshot(snapshotPage(f.state, f.binding, null, t(0)))), consumed = consumeChangePage(initial, page);
  const conflict = structuredClone(page); (conflict.events[1].value!.body as any).count = 998;
  assert.throws(() => consumeChangePage(consumed, conflict)); assert.deepEqual(consumed.items, state.current);
});

test('independent feed: delivered empty scan can complete catchup but never advance a visible event checkpoint', () => {
  const f = fixture(), initial = consumeSnapshotPage(null, snapshot(snapshotPage(f.state, f.binding, null, t(0))));
  const state = appendChangeBatch(f.state, f.batch(f.state, [], 5)), page = changes(pullChanges(state, f.binding, state.initial_checkpoint, 64, t(5)));
  const consumer = consumeChangePage(initial, page); assert.equal(consumer.completeness, 'complete'); assert.equal(consumer.as_of, t(5)); assert.equal(consumer.checkpoint, state.initial_checkpoint); assert.equal(consumer.seen.length, 0);
  assert.ok(!JSON.stringify(page).includes(state.source_checkpoint));
});

test('independent feed: delayed immutable snapshot page cannot lower the latest observed scan watermark', () => {
  const f = fixture(65), oldFirst = snapshot(snapshotPage(f.state, f.binding, null, t(0))), oldSecond = snapshot(snapshotPage(f.state, f.binding, oldFirst.next, t(0)));
  const state = appendChangeBatch(f.state, f.batch(f.state, [], 2)), newerFirst = snapshot(snapshotPage(state, f.binding, null, t(2)));
  const consumer = consumeSnapshotPage(consumeSnapshotPage(null, newerFirst), oldSecond);
  assert.equal(consumer.current_as_of, t(2)); assert.equal(consumer.as_of, t(0)); assert.equal(consumer.completeness, 'partial');
});

test('independent feed: duplicate snapshot page retains a newer authoritative watermark without duplicating items', () => {
  const f = fixture(65), first = snapshot(snapshotPage(f.state, f.binding, null, t(0))), initial = consumeSnapshotPage(null, first);
  const state = appendChangeBatch(f.state, f.batch(f.state, [], 2)), fresh = snapshot(snapshotPage(state, f.binding, null, t(2)));
  const consumer = consumeSnapshotPage(initial, fresh); assert.equal(consumer.current_as_of, t(2)); assert.equal(consumer.items.length, 64); assert.equal(consumer.snapshot_receipts.length, 1);
});

test('independent feed: newer snapshot retry cannot mark an already-live projection caught up to that newer watermark', () => {
  const f = fixture(), initial = consumeSnapshotPage(null, snapshot(snapshotPage(f.state, f.binding, null, t(0))));
  const complete = consumeChangePage(initial, pullChanges(f.state, f.binding, f.state.initial_checkpoint, 64, t(0))); assert.equal(complete.completeness, 'complete');
  const state = appendChangeBatch(f.state, f.batch(f.state, [f.change(f.state.current[0], f.state.current[0], 2)], 2));
  const retry = snapshot(snapshotPage(state, f.binding, null, t(2))), consumer = consumeSnapshotPage(complete, retry);
  assert.equal(consumer.current_as_of, t(2)); assert.equal(consumer.as_of, t(0)); assert.equal(consumer.completeness, 'partial');
  assert.equal(consumer.items[0].revision.digest, 'a'.repeat(64));
});

test('independent feed: historical exact snapshot retry is harmless after complete live catchup advances as_of', () => {
  const f = fixture(), first = snapshot(snapshotPage(f.state, f.binding, null, t(0))), initial = consumeSnapshotPage(null, first);
  const state = appendChangeBatch(f.state, f.batch(f.state, [f.change(f.state.current[0])], 1));
  const caught = consumeChangePage(initial, pullChanges(state, f.binding, f.state.initial_checkpoint, 64, t(1)));
  assert.equal(caught.as_of, t(1)); assert.deepEqual(consumeSnapshotPage(caught, first), caught);
});

test('independent feed: inputs and result pages remain detached without pretending synchronous helpers await authorization', () => {
  const f = fixture(), source = f.batch(f.state, [f.change(f.state.current[0])]), saved = structuredClone(f.state);
  const state = appendChangeBatch(f.state, source); (source.events[0].value!.body as any).count = 99; assert.notEqual((state.current[0].body as any).count, 99);
  const page = snapshot(snapshotPage(f.state, f.binding, null, t(0))); page.binding.policy_epoch = f.fresh(); (page.items[0].body as any).count = 77; assert.deepEqual(f.state, saved);
  let getters = 0; const hostile = f.batch(f.state, []); Object.defineProperty(hostile, 'events', { enumerable: true, get() { getters++; return []; } });
  assert.throws(() => appendChangeBatch(f.state, hostile)); assert.equal(getters, 0);
});
