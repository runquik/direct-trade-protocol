/** Bounded authorized-view oracle. Host supplies authenticated snapshots/outbox and durable CAS. */
import { canonicalize } from '../canonical.ts';
import { entityReferenceKey, parseEntityReference, parseRevisionReference, parseInstant } from './datatypes.ts';
import type { EntityReference, RevisionReference } from './datatypes.ts';

export interface ViewBinding {
  view_id: string; subject: EntityReference; audience: string; organization_id: string;
  authority_id: string; authority_epoch: string; policy_epoch: string;
}
export interface ChangeItem { revision: RevisionReference; profile_digest: string; body: unknown }
export interface ChangeEvent {
  event_id: string; checkpoint: string; entity: EntityReference; previous: RevisionReference | null;
  value: ChangeItem | null; accepted_at: string;
}
export interface DeliveredChange extends ChangeEvent { previous_checkpoint: string }
export interface ChangeBatch {
  expected_version: number; from_source_checkpoint: string; to_source_checkpoint: string;
  events: ChangeEvent[]; as_of: string;
}
export interface ViewInput {
  binding: ViewBinding; snapshot: ChangeItem[]; source_checkpoint: string; initial_checkpoint: string;
  snapshot_tokens: string[]; as_of: string; expires_at: string;
}
interface Seen { event_id: string; checkpoint: string; canonical: string }
export interface ChangeView extends ViewInput {
  version: number; snapshot_as_of: string; current: ChangeItem[]; events: DeliveredChange[];
  seen: Seen[]; floor_checkpoint: string; latest_checkpoint: string; last_batch: ChangeBatch | null;
}
export interface ResnapshotRequired { kind: 'resnapshot_required' }
export interface SnapshotPage {
  kind: 'snapshot'; binding: ViewBinding; from: string | null; next: string | null;
  base_checkpoint: string; items: ChangeItem[]; snapshot_as_of: string; current_as_of: string;
  complete: boolean;
}
export interface ChangesPage {
  kind: 'changes'; binding: ViewBinding; from: string; to: string; events: DeliveredChange[];
  current_as_of: string; complete: boolean;
}
export interface ConsumerState {
  binding: ViewBinding; mode: 'snapshot' | 'live' | 'invalidated'; items: ChangeItem[];
  checkpoint: string | null; next_snapshot: string | null; base_checkpoint: string;
  as_of: string; current_as_of: string; completeness: 'partial' | 'complete';
  snapshot_receipts: SnapshotPage[]; seen: Seen[];
}
export class ChangesError extends Error {
  readonly code: 'invalid_changes' | 'conflict' | 'source_gap' | 'capacity';
  constructor(message: string, code: ChangesError['code'] = 'invalid_changes') { super(message); this.name = 'ChangesError'; this.code = code; }
}
function need(ok: unknown, reason: string, code: ChangesError['code'] = 'invalid_changes'): asserts ok { if (!ok) throw new ChangesError(reason, code); }
const equal = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
const key = (item: ChangeItem) => entityReferenceKey(item.revision.entity);
const restart = (): ResnapshotRequired => ({ kind: 'resnapshot_required' });
const PAGE = 64;

/** Caller-owned data never remains aliased; this is not a Proxy sandbox. */
function copy<T>(input: T): T {
  let nodes = 0;
  function visit(v: unknown, depth: number): any {
    need(++nodes <= 262144 && depth <= 20, 'change data complexity exceeded', 'capacity');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { need(Number.isSafeInteger(v), 'safe integer required'); return v; }
    if (typeof v === 'string') { need(v.length <= 65536, 'change text too large', 'capacity'); canonicalize(v); return v; }
    need(v && typeof v === 'object', 'plain change data required');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v), names = Reflect.ownKeys(v);
    need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, 'plain change container required');
    if (array) {
      const length = Object.getOwnPropertyDescriptor(v, 'length')!.value;
      need(length <= 4096 && names.length === length + 1, 'bounded dense change array required', 'capacity');
      return Array.from({ length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(v, String(i)); need(d && 'value' in d && d.enumerable, 'change array data required'); return visit(d.value, depth + 1); });
    }
    need(names.length <= 256, 'change object too large', 'capacity'); const out: Record<string, unknown> = {};
    for (const name of names) {
      need(typeof name === 'string' && name.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(name), 'unsafe change field');
      const d = Object.getOwnPropertyDescriptor(v, name); need(d && 'value' in d && d.enumerable, 'change object data required'); out[name] = visit(d.value, depth + 1);
    }
    return out;
  }
  const result = visit(input, 0); need(new TextEncoder().encode(canonicalize(result)).length <= 8 * 1024 * 1024, 'change state byte capacity', 'capacity'); return result;
}
function exact(v: any, fields: string[]) { need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k)), 'exact change fields required'); }
function uuid(v: unknown): asserts v is string { need(typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v), 'opaque UUID required'); }
function integer(v: number, max = Number.MAX_SAFE_INTEGER) { need(Number.isSafeInteger(v) && v >= 0 && v <= max, 'bounded integer required'); }
function binding(v: ViewBinding): ViewBinding {
  exact(v, ['view_id', 'subject', 'audience', 'organization_id', 'authority_id', 'authority_epoch', 'policy_epoch']);
  for (const id of [v.view_id, v.organization_id, v.authority_id, v.authority_epoch, v.policy_epoch]) uuid(id);
  const subject = parseEntityReference(v.subject); need(subject.kind === 'person' || subject.kind === 'service', 'person or service viewer required');
  need(typeof v.audience === 'string' && v.audience.length <= 2048, 'exact audience required');
  const url = new URL(v.audience); need(url.origin === v.audience && ['http:', 'https:'].includes(url.protocol), 'exact audience origin required');
  return v;
}
function item(v: ChangeItem, company: string): ChangeItem {
  exact(v, ['revision', 'profile_digest', 'body']); const ref = parseRevisionReference(v.revision);
  need(['record', 'resource'].includes(ref.entity.kind) && ref.entity.organization_id === company, 'item company scope mismatch');
  need(typeof v.profile_digest === 'string' && /^[a-f0-9]{64}$/.test(v.profile_digest), 'profile digest required');
  need(new TextEncoder().encode(canonicalize(v)).length <= 16384, 'change item byte limit', 'capacity'); return v;
}
function items(values: ChangeItem[], company: string) {
  need(Array.isArray(values) && values.length <= 1024, 'view item capacity', 'capacity'); values.forEach(v => item(v, company));
  need(new Set(values.map(key)).size === values.length, 'duplicate snapshot entity');
}
function event(v: ChangeEvent, company: string) {
  exact(v, ['event_id', 'checkpoint', 'entity', 'previous', 'value', 'accepted_at']); uuid(v.event_id); uuid(v.checkpoint); parseInstant(v.accepted_at);
  const entity = parseEntityReference(v.entity); need(['record', 'resource'].includes(entity.kind) && entity.organization_id === company, 'event company scope mismatch');
  if (v.previous !== null) { parseRevisionReference(v.previous); need(equal(v.previous.entity, entity), 'event predecessor entity mismatch'); }
  if (v.value !== null) { item(v.value, company); need(equal(v.value.revision.entity, entity), 'event value entity mismatch'); }
  need(v.previous !== null || v.value !== null, 'empty change not permitted');
  if (v.previous && v.value) need(v.previous.revision_id !== v.value.revision.revision_id, 'new revision identity required');
}
function apply(items: ChangeItem[], e: ChangeEvent) {
  const index = items.findIndex(v => key(v) === entityReferenceKey(e.entity)), old = index < 0 ? null : items[index].revision;
  need(equal(old, e.previous), 'change predecessor conflict', 'conflict');
  if (e.value === null) items.splice(index, 1); else if (index < 0) items.push(e.value); else items[index] = e.value;
  need(items.length <= 1024, 'view item capacity', 'capacity');
}
function access(state: ChangeView, current: ViewBinding, now: string): boolean {
  binding(current); parseInstant(now); return equal(state.binding, current) && now >= state.as_of && now < state.expires_at;
}

/** Snapshot and source checkpoint MUST be captured in one authorized host transaction. */
export function createChangeView(input: ViewInput): ChangeView {
  const v = copy(input); exact(v, ['binding', 'snapshot', 'source_checkpoint', 'initial_checkpoint', 'snapshot_tokens', 'as_of', 'expires_at']); binding(v.binding);
  items(v.snapshot, v.binding.organization_id); uuid(v.source_checkpoint); uuid(v.initial_checkpoint); parseInstant(v.as_of); parseInstant(v.expires_at);
  need(v.expires_at > v.as_of && Date.parse(v.expires_at) - Date.parse(v.as_of) <= 86400000, 'view lifetime must be at most 24 hours');
  need(v.snapshot_tokens.length === Math.max(0, Math.ceil(v.snapshot.length / PAGE) - 1), 'one opaque token per continuation page required');
  v.snapshot_tokens.forEach(uuid); const tokens = [v.initial_checkpoint, ...v.snapshot_tokens]; need(new Set(tokens).size === tokens.length && !tokens.includes(v.source_checkpoint), 'checkpoint namespaces must be distinct');
  return copy({ ...v, version: 0, snapshot_as_of: v.as_of, current: v.snapshot, events: [], seen: [], floor_checkpoint: v.initial_checkpoint, latest_checkpoint: v.initial_checkpoint, last_batch: null });
}

/** Source inputs are already authorized projections, not client-submitted effects. */
export function appendChangeBatch(input: ChangeView, source: ChangeBatch): ChangeView {
  const state = copy(input), batch = copy(source); exact(batch, ['expected_version', 'from_source_checkpoint', 'to_source_checkpoint', 'events', 'as_of']);
  integer(batch.expected_version); uuid(batch.from_source_checkpoint); uuid(batch.to_source_checkpoint); parseInstant(batch.as_of);
  need(Array.isArray(batch.events) && batch.events.length <= PAGE, 'bounded source batch required');
  batch.events.forEach(e => event(e, state.binding.organization_id));
  if (state.last_batch && equal(batch, state.last_batch)) return state;
  need(batch.expected_version === state.version, 'view version conflict', 'conflict');
  need(batch.from_source_checkpoint === state.source_checkpoint && batch.to_source_checkpoint !== batch.from_source_checkpoint, 'source continuity gap', 'source_gap');
  need(batch.to_source_checkpoint !== state.initial_checkpoint && !state.snapshot_tokens.includes(batch.to_source_checkpoint) && !state.seen.some(s => s.checkpoint === batch.to_source_checkpoint), 'source checkpoint must remain private');
  need(batch.as_of >= state.as_of && batch.as_of < state.expires_at, 'source watermark outside view lifetime');
  for (const e of batch.events) {
    const serialized = canonicalize(e), seen = state.seen.find(s => s.event_id === e.event_id);
    if (seen) { need(seen.canonical === serialized, 'conflicting stable change identity', 'conflict'); continue; }
    need(e.accepted_at >= state.as_of && e.accepted_at <= batch.as_of, 'event outside accepted source interval');
    need(e.checkpoint !== state.initial_checkpoint && !state.snapshot_tokens.includes(e.checkpoint) && !state.seen.some(s => s.checkpoint === e.checkpoint), 'checkpoint reuse', 'conflict');
    need(e.checkpoint !== batch.from_source_checkpoint && e.checkpoint !== batch.to_source_checkpoint, 'source checkpoint must remain private');
    apply(state.current, e);
    state.events.push({ ...e, previous_checkpoint: state.latest_checkpoint }); state.latest_checkpoint = e.checkpoint;
    state.seen.push({ event_id: e.event_id, checkpoint: e.checkpoint, canonical: serialized });
    need(state.seen.length <= 4096, 'view dedup capacity; start new snapshot', 'capacity');
  }
  need(state.events.length <= 256, 'retained change capacity; prune with explicit gap behavior', 'capacity');
  state.source_checkpoint = batch.to_source_checkpoint; state.as_of = batch.as_of; state.last_batch = batch;
  integer(state.version + 1); state.version++; return copy(state);
}

/** Retention removes delivery history, never the lifetime dedup identities. */
export function retainChanges(input: ChangeView, expectedVersion: number, keep: number): ChangeView {
  const state = copy(input); integer(keep, 256); need(state.version === expectedVersion, 'view version conflict', 'conflict');
  const removed = state.events.splice(0, Math.max(0, state.events.length - keep));
  if (removed.length) state.floor_checkpoint = removed.at(-1)!.checkpoint;
  integer(state.version + 1); state.version++; state.last_batch = null; return state;
}

export function snapshotPage(input: ChangeView, currentBinding: ViewBinding, cursor: string | null, now: string): SnapshotPage | ResnapshotRequired {
  const state = copy(input), current = copy(currentBinding);
  if (!access(state, current, now) || state.floor_checkpoint !== state.initial_checkpoint) return restart();
  if (cursor !== null) uuid(cursor);
  const page = cursor === null ? 0 : state.snapshot_tokens.indexOf(cursor) + 1;
  if (cursor !== null && page === 0) return restart();
  const next = state.snapshot_tokens[page] ?? null;
  return copy({ kind: 'snapshot', binding: state.binding, from: cursor, next, base_checkpoint: state.initial_checkpoint,
    items: state.snapshot.slice(page * PAGE, (page + 1) * PAGE), snapshot_as_of: state.snapshot_as_of, current_as_of: state.as_of, complete: next === null });
}

export function pullChanges(input: ChangeView, currentBinding: ViewBinding, checkpoint: string, limit: number, now: string): ChangesPage | ResnapshotRequired {
  const state = copy(input), current = copy(currentBinding); integer(limit, PAGE); need(limit > 0, 'positive page size required');
  if (!access(state, current, now)) return restart(); uuid(checkpoint);
  const index = checkpoint === state.floor_checkpoint ? -1 : state.events.findIndex(e => e.checkpoint === checkpoint);
  if (index === -1 && checkpoint !== state.floor_checkpoint) return restart();
  const events = state.events.slice(index + 1, index + 1 + limit), to = events.at(-1)?.checkpoint ?? checkpoint;
  return copy({ kind: 'changes', binding: state.binding, from: checkpoint, to, events, current_as_of: state.as_of, complete: to === state.latest_checkpoint });
}

/** Consumer state must be persisted atomically with its projection; no business effects run here. */
export function consumeSnapshotPage(input: ConsumerState | null, incoming: SnapshotPage): ConsumerState {
  const page = copy(incoming); exact(page, ['kind', 'binding', 'from', 'next', 'base_checkpoint', 'items', 'snapshot_as_of', 'current_as_of', 'complete']);
  need(page.kind === 'snapshot', 'snapshot page required'); binding(page.binding); uuid(page.base_checkpoint);
  if (page.from !== null) uuid(page.from); if (page.next !== null) uuid(page.next);
  parseInstant(page.snapshot_as_of); parseInstant(page.current_as_of); need(page.current_as_of >= page.snapshot_as_of && page.complete === (page.next === null), 'invalid snapshot metadata');
  items(page.items, page.binding.organization_id); need(page.items.length <= PAGE, 'snapshot page size');
  need(page.complete || page.items.length === PAGE, 'nonfinal snapshot page must be full');
  need(page.from !== page.base_checkpoint && page.next !== page.base_checkpoint, 'snapshot and catch-up tokens must differ');
  const state: ConsumerState = input === null ? { binding: page.binding, mode: 'snapshot', items: [], checkpoint: null, next_snapshot: null,
    base_checkpoint: page.base_checkpoint, as_of: page.snapshot_as_of, current_as_of: page.current_as_of, completeness: 'partial', snapshot_receipts: [], seen: [] } : copy(input);
  const originalSnapshotAsOf = state.snapshot_receipts[0]?.snapshot_as_of ?? state.as_of;
  need(equal(state.binding, page.binding) && state.base_checkpoint === page.base_checkpoint && originalSnapshotAsOf === page.snapshot_as_of, 'snapshot context conflict', 'conflict');
  const prior = state.snapshot_receipts.find(p => p.from === page.from);
  if (prior) {
    need(equal({ ...prior, current_as_of: page.current_as_of }, page), 'conflicting snapshot retry', 'conflict');
    if (page.current_as_of > state.current_as_of) {
      state.current_as_of = page.current_as_of;
      if (state.current_as_of > state.as_of) state.completeness = 'partial';
    }
    return state;
  }
  need(state.mode === 'snapshot' && state.next_snapshot === page.from, 'snapshot delivery gap', 'source_gap');
  need(page.next === null || page.next !== page.from && !state.snapshot_receipts.some(p => p.from === page.next), 'snapshot cursor cycle');
  state.items.push(...page.items); items(state.items, state.binding.organization_id); state.snapshot_receipts.push(page);
  need(state.snapshot_receipts.length <= 16, 'snapshot page capacity', 'capacity'); state.next_snapshot = page.next;
  if (page.current_as_of > state.current_as_of) state.current_as_of = page.current_as_of;
  if (page.complete) { state.mode = 'live'; state.checkpoint = page.base_checkpoint; state.completeness = 'partial'; }
  return copy(state);
}

export function consumeChangePage(input: ConsumerState, incoming: ChangesPage | ResnapshotRequired): ConsumerState {
  const state = copy(input), page = copy(incoming);
  if (page.kind === 'resnapshot_required') {
    exact(page, ['kind']); return { ...state, mode: 'invalidated', items: [], checkpoint: null, next_snapshot: null, completeness: 'partial', seen: [], snapshot_receipts: [] };
  }
  exact(page, ['kind', 'binding', 'from', 'to', 'events', 'current_as_of', 'complete']); need(page.kind === 'changes', 'changes page required');
  binding(page.binding); need(state.mode === 'live' && equal(state.binding, page.binding), 'consumer context conflict', 'conflict');
  uuid(page.from); uuid(page.to); parseInstant(page.current_as_of); need(typeof page.complete === 'boolean', 'explicit completeness required');
  need(Array.isArray(page.events) && page.events.length <= PAGE, 'bounded changes page required');
  need(page.from === state.base_checkpoint || page.from === state.checkpoint || state.seen.some(s => s.checkpoint === page.from), 'consumer checkpoint gap', 'source_gap');
  let predecessor = page.from;
  for (const delivered of page.events) {
    exact(delivered, ['event_id', 'checkpoint', 'entity', 'previous', 'value', 'accepted_at', 'previous_checkpoint']); uuid(delivered.previous_checkpoint);
    const { previous_checkpoint, ...e } = delivered; event(e, state.binding.organization_id);
    need(previous_checkpoint === predecessor && e.accepted_at <= page.current_as_of, 'delivery predecessor gap', 'source_gap');
    const serialized = canonicalize(delivered), seen = state.seen.find(s => s.event_id === e.event_id);
    if (seen) need(seen.canonical === serialized, 'conflicting delivered event', 'conflict');
    else {
      need(!state.seen.some(s => s.checkpoint === e.checkpoint) && e.checkpoint !== state.base_checkpoint, 'duplicate checkpoint', 'conflict');
      need(state.checkpoint === previous_checkpoint, 'out-of-order change delivery', 'source_gap');
      apply(state.items, e); state.checkpoint = e.checkpoint; state.seen.push({ event_id: e.event_id, checkpoint: e.checkpoint, canonical: serialized });
      need(state.seen.length <= 4096, 'consumer dedup capacity; resnapshot', 'capacity');
    }
    predecessor = e.checkpoint;
  }
  need(predecessor === page.to, 'page checkpoint mismatch');
  if (page.current_as_of >= state.current_as_of) {
    state.current_as_of = page.current_as_of;
    state.completeness = page.complete && page.to === state.checkpoint ? 'complete' : 'partial';
    if (state.completeness === 'complete') state.as_of = page.current_as_of;
  }
  return copy(state);
}
