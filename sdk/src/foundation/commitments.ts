/** Pure provider/coordinator transitions. Callers own authentication, atomic CAS and durability. */
import { canonicalize, sha256Hex } from '../canonical.ts';
import { parseDecimal, formatDecimal } from '../profiles/decimal.ts';
import { parseEntityReference, parseRevisionReference, parseExternalIdentifier, parseInstant, parseInstantInterval, entityReferenceKey } from './datatypes.ts';
import type { EntityReference, RevisionReference, ExternalIdentifier, InstantInterval } from './datatypes.ts';

export interface Quote {
  revision: RevisionReference; previous: RevisionReference | null; provider: EntityReference; customer: EntityReference;
  resource: EntityReference; quantity: number; unit: ExternalIdentifier; window: InstantInterval; expires_at: string;
  terms: { amount: string; currency: ExternalIdentifier; taxes: 'included' | 'excluded' | 'unknown'; fees: 'included' | 'excluded' | 'unknown';
    cancellation: 'before_fulfillment' | 'never'; combined_quote_issuer: string; buyer_counterparty: string; freight_cost_bearer: string; substitutions: 'new_quote_and_approval' };
}
export type CommitmentStatus = 'held' | 'expired' | 'accepted' | 'released' | 'cancelled' | 'fulfilling' | 'completed' | 'disputed';
export interface CapacityHold {
  id: string; quote: RevisionReference; expires_at: string; status: CommitmentStatus;
  good: number; damaged: number; fulfillment_closed: boolean; settlement: 'external_pending';
  fulfillments: { operation_id: string; good: number; damaged: number; final: boolean; evidence: RevisionReference }[];
  disputes: { operation_id: string; reason: string; evidence: RevisionReference }[];
}
export type ProviderAction = 'quote.publish' | 'hold' | 'confirm' | 'release' | 'cancel' | 'fulfill' | 'dispute';
export interface ProviderCommand { operation_id: string; action: ProviderAction; payload: Record<string, unknown> }
export interface ProviderReceipt { operation_id: string; command_digest: string; action: ProviderAction; hold_id: string | null;
  quote: RevisionReference; status: CommitmentStatus | 'quoted'; accepted_revision: number; historical: true }
export interface ProviderState {
  provider: EntityReference; resource: EntityReference; kind: 'goods' | 'warehouse' | 'transport' | 'staffing';
  unit: ExternalIdentifier; capacity: number; revision: number; last_accepted_at: string;
  quotes: Quote[]; holds: CapacityHold[]; receipts: ProviderReceipt[];
}
export interface ExecutionContext { expected_revision: number; accepted_at: string }
export class CommitmentError extends Error {
  readonly code: 'invalid_commitment' | 'conflict' | 'expired' | 'capacity' | 'policy';
  constructor(reason: string, code: 'invalid_commitment' | 'conflict' | 'expired' | 'capacity' | 'policy' = 'invalid_commitment') { super(reason); this.name = 'CommitmentError'; this.code = code; }
}
function demand(value: unknown, reason: string, code: CommitmentError['code'] = 'invalid_commitment'): asserts value { if (!value) throw new CommitmentError(reason, code); }
function data(value: unknown): any {
  let nodes = 0;
  const visit = (input: unknown, depth: number): any => {
    demand(++nodes <= 200000 && depth <= 20, 'commitment data complexity exceeded');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') { demand(input.length <= 2048, 'commitment text too long'); try { canonicalize(input); } catch { throw new CommitmentError('invalid Unicode'); } return input; }
    if (typeof input === 'number') { demand(Number.isSafeInteger(input), 'safe integer required'); return input; }
    demand(input !== null && typeof input === 'object', 'plain commitment data required');
    const isArray = Array.isArray(input), prototype = Object.getPrototypeOf(input), keys = Reflect.ownKeys(input);
    demand(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'plain commitment container required');
    if (isArray) {
      demand(input.length <= 2048 && keys.length === input.length + 1, 'bounded dense array required');
      return Array.from({ length: input.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(input, String(i)); demand(d && Object.hasOwn(d, 'value') && d.enumerable, 'data array required'); return visit(d.value, depth + 1); });
    }
    demand(keys.length <= 64, 'commitment object field limit exceeded'); const out: Record<string, any> = {};
    for (const key of keys) { demand(typeof key === 'string' && key.length <= 96 && !['__proto__', 'prototype', 'constructor'].includes(key), 'unsafe commitment field'); const d = Object.getOwnPropertyDescriptor(input, key); demand(d && Object.hasOwn(d, 'value') && d.enumerable, 'own data fields required'); out[key] = visit(d.value, depth + 1); }
    return out;
  };
  const out = visit(value, 0); demand(new TextEncoder().encode(canonicalize(out)).length <= 4 * 1024 * 1024, 'commitment byte capacity exceeded', 'capacity'); return out;
}
function exact(value: unknown, keys: string[]): Record<string, any> { demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required'); const o = value as Record<string, any>; demand(Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k)), 'exact declared fields required'); return o; }
function array(value: unknown, max: number): any[] { demand(Array.isArray(value) && value.length <= max, 'bounded array required'); return value; }
function uuid(value: unknown): string { demand(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), 'UUID required'); return value; }
function hash(value: unknown): string { demand(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'digest required'); return value; }
function units(value: unknown, positive = false): number { demand(Number.isSafeInteger(value) && (value as number) >= (positive ? 1 : 0), 'bounded integer units required'); return value as number; }
function same(a: unknown, b: unknown): boolean { return canonicalize(a) === canonicalize(b); }
function company(value: unknown): EntityReference { const ref = parseEntityReference(value); demand(ref.kind === 'organization', 'company reference required'); return ref; }
function unique<T>(values: T[], key: (value: T) => string): T[] { demand(new Set(values.map(key)).size === values.length, 'duplicate identity'); return values; }
function reason(value: unknown): string { demand(typeof value === 'string' && value.length > 0 && value.length <= 500 && value.trim() === value && !/[\u0000-\u001f]/.test(value), 'bounded reason required'); return value; }
function quote(value: unknown): Quote {
  const o = exact(value, ['revision', 'previous', 'provider', 'customer', 'resource', 'quantity', 'unit', 'window', 'expires_at', 'terms']);
  const revision = parseRevisionReference(o.revision), previous = o.previous === null ? null : parseRevisionReference(o.previous), provider = company(o.provider), customer = company(o.customer), resource = parseEntityReference(o.resource);
  demand(resource.kind === 'resource' && resource.organization_id === provider.id && revision.entity.kind === 'record' && revision.entity.organization_id === provider.id, 'quote/provider/resource scope mismatch');
  demand(previous === null || same(previous.entity, revision.entity), 'quote ancestry changes identity');
  const t = exact(o.terms, ['amount', 'currency', 'taxes', 'fees', 'cancellation', 'combined_quote_issuer', 'buyer_counterparty', 'freight_cost_bearer', 'substitutions']);
  let amount: string; try { const n = parseDecimal(t.amount, 6); demand(formatDecimal(n, 6) === t.amount, 'canonical price required'); amount = t.amount; } catch { throw new CommitmentError('bounded canonical decimal price required'); }
  demand(['included', 'excluded', 'unknown'].includes(t.taxes) && ['included', 'excluded', 'unknown'].includes(t.fees) && ['before_fulfillment', 'never'].includes(t.cancellation) && t.substitutions === 'new_quote_and_approval', 'unsupported quote terms');
  return { revision, previous, provider, customer, resource, quantity: units(o.quantity, true), unit: parseExternalIdentifier(o.unit), window: parseInstantInterval(o.window), expires_at: parseInstant(o.expires_at),
    terms: { amount, currency: parseExternalIdentifier(t.currency), taxes: t.taxes, fees: t.fees, cancellation: t.cancellation, combined_quote_issuer: uuid(t.combined_quote_issuer), buyer_counterparty: uuid(t.buyer_counterparty), freight_cost_bearer: uuid(t.freight_cost_bearer), substitutions: t.substitutions } };
}
export function parseQuote(value: unknown): Quote { return quote(data(value)); }
function command(value: unknown): ProviderCommand {
  const o = exact(data(value), ['operation_id', 'action', 'payload']);
  demand(['quote.publish', 'hold', 'confirm', 'release', 'cancel', 'fulfill', 'dispute'].includes(o.action), 'unsupported provider action');
  const fields: Record<ProviderAction, string[]> = { 'quote.publish': ['quote'], hold: ['hold_id', 'quote', 'expires_at'], confirm: ['hold_id', 'quote'], release: ['hold_id', 'quote'], cancel: ['hold_id', 'quote'], fulfill: ['hold_id', 'quote', 'good', 'damaged', 'final', 'evidence'], dispute: ['hold_id', 'quote', 'reason', 'evidence'] };
  const p = exact(o.payload, fields[o.action as ProviderAction]);
  if (o.action === 'quote.publish') return { operation_id: uuid(o.operation_id), action: o.action, payload: { quote: quote(p.quote) } };
  const payload: Record<string, unknown> = { hold_id: uuid(p.hold_id), quote: parseRevisionReference(p.quote) };
  if (o.action === 'hold') payload.expires_at = parseInstant(p.expires_at);
  if (o.action === 'fulfill') { payload.good = units(p.good); payload.damaged = units(p.damaged); demand(typeof p.final === 'boolean', 'final flag required'); payload.final = p.final; payload.evidence = parseRevisionReference(p.evidence); }
  if (o.action === 'dispute') { payload.reason = reason(p.reason); payload.evidence = parseRevisionReference(p.evidence); }
  return { operation_id: uuid(o.operation_id), action: o.action, payload };
}
function receipt(value: unknown): ProviderReceipt {
  const o = exact(value, ['operation_id', 'command_digest', 'action', 'hold_id', 'quote', 'status', 'accepted_revision', 'historical']);
  demand(['quote.publish', 'hold', 'confirm', 'release', 'cancel', 'fulfill', 'dispute'].includes(o.action) && ['quoted', 'held', 'expired', 'accepted', 'released', 'cancelled', 'fulfilling', 'completed', 'disputed'].includes(o.status) && o.historical === true, 'invalid historical receipt');
  return { operation_id: uuid(o.operation_id), command_digest: hash(o.command_digest), action: o.action, hold_id: o.hold_id === null ? null : uuid(o.hold_id), quote: parseRevisionReference(o.quote), status: o.status, accepted_revision: units(o.accepted_revision, true), historical: true };
}
function hold(value: unknown): CapacityHold {
  const o = exact(value, ['id', 'quote', 'expires_at', 'status', 'good', 'damaged', 'fulfillment_closed', 'settlement', 'fulfillments', 'disputes']);
  demand(['held', 'expired', 'accepted', 'released', 'cancelled', 'fulfilling', 'completed', 'disputed'].includes(o.status) && typeof o.fulfillment_closed === 'boolean' && o.settlement === 'external_pending', 'invalid hold state');
  const fulfillments = unique(array(o.fulfillments, 128).map(v => { const p = exact(v, ['operation_id', 'good', 'damaged', 'final', 'evidence']); demand(typeof p.final === 'boolean', 'final flag required'); return { operation_id: uuid(p.operation_id), good: units(p.good), damaged: units(p.damaged), final: p.final, evidence: parseRevisionReference(p.evidence) }; }), v => v.operation_id);
  const disputes = unique(array(o.disputes, 128).map(v => { const p = exact(v, ['operation_id', 'reason', 'evidence']); return { operation_id: uuid(p.operation_id), reason: reason(p.reason), evidence: parseRevisionReference(p.evidence) }; }), v => v.operation_id);
  demand(fulfillments.reduce((n, f) => n + BigInt(f.good), 0n) === BigInt(units(o.good)) && fulfillments.reduce((n, f) => n + BigInt(f.damaged), 0n) === BigInt(units(o.damaged)), 'fulfillment totals differ from evidence');
  return { id: uuid(o.id), quote: parseRevisionReference(o.quote), expires_at: parseInstant(o.expires_at), status: o.status, good: o.good, damaged: o.damaged, fulfillment_closed: o.fulfillment_closed, settlement: 'external_pending', fulfillments, disputes };
}
function state(value: unknown): ProviderState {
  const o = exact(data(value), ['provider', 'resource', 'kind', 'unit', 'capacity', 'revision', 'last_accepted_at', 'quotes', 'holds', 'receipts']);
  const provider = company(o.provider), resource = parseEntityReference(o.resource), unit = parseExternalIdentifier(o.unit);
  demand(resource.kind === 'resource' && resource.organization_id === provider.id && ['goods', 'warehouse', 'transport', 'staffing'].includes(o.kind), 'pool/provider/kind mismatch');
  const quotes = unique(array(o.quotes, 256).map(quote), q => canonicalize([q.revision.entity, q.revision.revision_id]));
  const heads = new Map<string, Quote>();
  for (const q of quotes) {
    demand(same(q.resource, resource) && same(q.provider, provider) && same(q.unit, unit), 'quote differs from pool');
    const key = entityReferenceKey(q.revision.entity), prior = heads.get(key);
    demand(prior ? same(prior.revision, q.previous) : q.previous === null, 'quote history is not contiguous'); heads.set(key, q);
  }
  const holds = unique(array(o.holds, 512).map(hold), h => h.id);
  for (const h of holds) { const q = quotes.find(q => same(q.revision, h.quote)); demand(q && h.expires_at <= q.expires_at && BigInt(h.good) + BigInt(h.damaged) <= BigInt(q.quantity), 'hold differs from immutable quote'); }
  return { provider, resource, kind: o.kind, unit, capacity: units(o.capacity, true), revision: units(o.revision), last_accepted_at: parseInstant(o.last_accepted_at), quotes, holds, receipts: unique(array(o.receipts, 1024).map(receipt), r => r.operation_id) };
}
export function createProviderState(configuration: unknown, acceptedAt: string): ProviderState {
  const o = exact(data(configuration), ['provider', 'resource', 'kind', 'unit', 'capacity']);
  return state({ ...o, revision: 0, last_accepted_at: parseInstant(acceptedAt), quotes: [], holds: [], receipts: [] });
}
function currentQuote(s: ProviderState, ref: RevisionReference): Quote | undefined { return [...s.quotes].reverse().find(q => same(q.revision.entity, ref.entity)); }
function reserveFits(s: ProviderState, q: Quote): boolean {
  const points: { time: string; delta: bigint }[] = [{ time: q.window.start, delta: BigInt(q.quantity) }, { time: q.window.end, delta: -BigInt(q.quantity) }];
  for (const h of s.holds) if (!['expired', 'released', 'cancelled'].includes(h.status)) {
    const quote = s.quotes.find(quote => same(quote.revision, h.quote))!;
    points.push({ time: quote.window.start, delta: BigInt(quote.quantity) }, { time: quote.window.end, delta: -BigInt(quote.quantity) });
  }
  points.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.delta < b.delta ? -1 : 1);
  let used = 0n; for (const point of points) { used += point.delta; if (used > BigInt(s.capacity)) return false; } return true;
}
export async function applyProviderCommand(value: unknown, input: unknown, execution: ExecutionContext): Promise<{ state: ProviderState; receipt: ProviderReceipt; duplicate: boolean }> {
  const s = state(value), c = command(input), context = exact(data(execution), ['expected_revision', 'accepted_at']), now = parseInstant(context.accepted_at), expected = units(context.expected_revision);
  const digest = await sha256Hex(canonicalize(c)), prior = s.receipts.find(r => r.operation_id === c.operation_id);
  if (prior) { demand(prior.command_digest === digest, 'business operation ID reused with changed command', 'conflict'); return { state: s, receipt: structuredClone(prior), duplicate: true }; }
  demand(expected === s.revision && s.revision < Number.MAX_SAFE_INTEGER && now >= s.last_accepted_at, 'pool revision or clock conflict', 'conflict');
  demand(s.receipts.length < 1024, 'receipt capacity exhausted', 'capacity');
  for (const h of s.holds) if (h.status === 'held' && h.expires_at <= now) h.status = 'expired';
  const p = c.payload as any;
  let quoteRef: RevisionReference, target: CapacityHold | undefined;
  if (c.action === 'quote.publish') {
    const q = p.quote as Quote, latest = currentQuote(s, q.revision);
    demand(same(q.provider, s.provider) && same(q.resource, s.resource) && same(q.unit, s.unit), 'quote belongs to another capacity pool');
    demand(q.expires_at > now && q.window.end > now, 'quote expired', 'expired');
    demand(!s.quotes.some(old => old.revision.revision_id === q.revision.revision_id && same(old.revision.entity, q.revision.entity)) && (latest ? same(latest.revision, q.previous) : q.previous === null), 'quote previous-head conflict', 'conflict');
    demand(s.quotes.length < 256, 'quote capacity exhausted', 'capacity'); s.quotes.push(q); quoteRef = q.revision;
  } else {
    quoteRef = p.quote; const q = s.quotes.find(q => same(q.revision, quoteRef)); demand(q, 'exact quote unavailable');
    target = s.holds.find(h => h.id === p.hold_id);
    if (c.action === 'hold') {
      demand(!target && s.holds.length < 512, 'hold identity conflict or capacity exhausted', 'conflict');
      demand(same(currentQuote(s, q.revision)?.revision, q.revision) && q.expires_at > now && q.window.end > now && p.expires_at > now && p.expires_at <= q.expires_at, 'quote or hold expiry/current revision invalid', 'expired');
      demand(reserveFits(s, q), 'provider capacity unavailable', 'capacity');
      target = { id: p.hold_id, quote: q.revision, expires_at: p.expires_at, status: 'held', good: 0, damaged: 0, fulfillment_closed: false, settlement: 'external_pending', fulfillments: [], disputes: [] }; s.holds.push(target);
    } else {
      demand(target && same(target.quote, q.revision), 'hold quote or provider cannot be substituted', 'conflict');
      if (c.action === 'confirm') {
        demand(target.status === 'held' && target.expires_at > now && q.expires_at > now && q.window.end > now && same(currentQuote(s, q.revision)?.revision, q.revision), 'hold/quote/window expired or superseded', 'expired'); target.status = 'accepted';
      } else if (c.action === 'release') {
        demand(['held', 'expired'].includes(target.status), 'accepted commitment cannot be released', 'policy'); target.status = 'released';
      } else if (c.action === 'cancel') {
        demand(target.status === 'accepted' && q.terms.cancellation === 'before_fulfillment' && target.fulfillments.length === 0, 'commitment cancellation is not permitted', 'policy'); target.status = 'cancelled';
      } else if (c.action === 'fulfill') {
        demand(['accepted', 'fulfilling', 'disputed'].includes(target.status) && !target.fulfillment_closed && target.fulfillments.length < 128, 'commitment not open for fulfillment', 'policy');
        const good = BigInt(target.good) + BigInt(p.good), damaged = BigInt(target.damaged) + BigInt(p.damaged);
        demand(good + damaged <= BigInt(q.quantity) && (p.good + p.damaged > 0 || p.final), 'fulfillment exceeds committed integer quantity');
        target.good = Number(good); target.damaged = Number(damaged); target.fulfillment_closed = p.final;
        target.fulfillments.push({ operation_id: c.operation_id, good: p.good, damaged: p.damaged, final: p.final, evidence: p.evidence });
        target.status = target.disputes.length || damaged > 0n || (p.final && good < BigInt(q.quantity)) ? 'disputed' : p.final ? 'completed' : 'fulfilling';
      } else {
        demand(['accepted', 'fulfilling', 'completed', 'disputed'].includes(target.status) && target.disputes.length < 128, 'commitment cannot be disputed in this state', 'policy');
        target.disputes.push({ operation_id: c.operation_id, reason: p.reason, evidence: p.evidence }); target.status = 'disputed';
      }
    }
  }
  s.revision++; s.last_accepted_at = now;
  const result: ProviderReceipt = { operation_id: c.operation_id, command_digest: digest, action: c.action, hold_id: target?.id ?? null, quote: quoteRef!, status: target?.status ?? 'quoted', accepted_revision: s.revision, historical: true };
  s.receipts.push(result); return { state: state(s), receipt: structuredClone(result), duplicate: false };
}
export function providerView(value: unknown, acceptedAt: string): ProviderState {
  const s = state(value), now = parseInstant(acceptedAt); demand(now >= s.last_accepted_at, 'clock rollback', 'conflict');
  for (const h of s.holds) if (h.status === 'held' && h.expires_at <= now) h.status = 'expired'; return s;
}

export interface CoordinatorLegSpec {
  leg_id: string; quote: Quote; hold_id: string; hold_expires_at: string;
  operation_ids: { hold: string; confirm: string; release: string; cancel: string };
}
export interface CoordinatorLeg extends CoordinatorLegSpec { status: 'planned' | 'held' | 'accepted' | 'released' | 'cancelled' | 'rejected' | 'exception' }
export interface CoordinatorRequest { provider_id: string; command: ProviderCommand }
export interface CoordinatorResponse { provider_id: string; operation_id: string; command_digest: string; outcome: 'accepted' | 'rejected'; receipt: ProviderReceipt | null; reason: string | null }
export interface CoordinatorState {
  coordination_id: string; customer: EntityReference; revision: number;
  phase: 'holding' | 'confirming' | 'compensating' | 'committed' | 'compensated' | 'exception';
  legs: CoordinatorLeg[]; pending: CoordinatorRequest | null; uncertain: boolean; responses: CoordinatorResponse[];
}
function response(value: unknown): CoordinatorResponse {
  const o = exact(value, ['provider_id', 'operation_id', 'command_digest', 'outcome', 'receipt', 'reason']);
  demand(o.outcome === 'accepted' || o.outcome === 'rejected', 'definitive provider outcome required');
  demand(o.outcome === 'accepted' ? o.receipt !== null && o.reason === null : o.receipt === null && o.reason !== null, 'provider outcome/evidence mismatch');
  return { provider_id: uuid(o.provider_id), operation_id: uuid(o.operation_id), command_digest: hash(o.command_digest), outcome: o.outcome,
    receipt: o.receipt === null ? null : receipt(o.receipt), reason: o.reason === null ? null : reason(o.reason) };
}
function coordinator(value: unknown): CoordinatorState {
  const o = exact(data(value), ['coordination_id', 'customer', 'revision', 'phase', 'legs', 'pending', 'uncertain', 'responses']);
  const customer = company(o.customer);
  demand(['holding', 'confirming', 'compensating', 'committed', 'compensated', 'exception'].includes(o.phase) && typeof o.uncertain === 'boolean', 'coordinator phase required');
  const legs: CoordinatorLeg[] = unique(array(o.legs, 16).map(v => {
    const l = exact(v, ['leg_id', 'quote', 'hold_id', 'hold_expires_at', 'operation_ids', 'status']), q = quote(l.quote), ids = exact(l.operation_ids, ['hold', 'confirm', 'release', 'cancel']);
    demand(same(q.customer, customer) && ['planned', 'held', 'accepted', 'released', 'cancelled', 'rejected', 'exception'].includes(l.status), 'leg customer/status differs');
    const expires = parseInstant(l.hold_expires_at); demand(expires <= q.expires_at, 'leg hold outlives quote');
    return { leg_id: uuid(l.leg_id), quote: q, hold_id: uuid(l.hold_id), hold_expires_at: expires,
      operation_ids: { hold: uuid(ids.hold), confirm: uuid(ids.confirm), release: uuid(ids.release), cancel: uuid(ids.cancel) }, status: l.status };
  }), l => l.leg_id);
  demand(legs.length > 0, 'at least one provider leg required');
  unique(legs, l => l.hold_id); unique(legs.flatMap(l => Object.values(l.operation_ids)), v => v);
  let pending: CoordinatorRequest | null = null;
  if (o.pending !== null) { const p = exact(o.pending, ['provider_id', 'command']); pending = { provider_id: uuid(p.provider_id), command: command(p.command) }; }
  demand(!o.uncertain || pending !== null, 'uncertain request must remain persisted');
  if (o.phase === 'holding') demand(legs.every(l => ['planned', 'held'].includes(l.status)), 'holding phase contains incompatible progress');
  if (o.phase === 'confirming') demand(legs.every(l => ['held', 'accepted'].includes(l.status)), 'confirming phase contains incompatible progress');
  if (o.phase === 'committed') demand(pending === null && legs.every(l => l.status === 'accepted'), 'committed phase requires every accepted leg');
  if (o.phase === 'compensated') demand(pending === null && legs.every(l => ['planned', 'released', 'cancelled', 'rejected'].includes(l.status)), 'compensated phase retains obligations');
  if (o.phase === 'exception') demand(pending === null && legs.some(l => l.status === 'exception') && legs.every(l => !['held', 'accepted'].includes(l.status)), 'exception phase hides unfinished compensation');
  if (pending) {
    const action = pending.command.action;
    demand(['hold', 'confirm', 'release', 'cancel'].includes(action), 'unsupported pending action');
    const leg = legs.find(l => l.quote.provider.id === pending.provider_id && l.operation_ids[action as keyof CoordinatorLeg['operation_ids']] === pending.command.operation_id);
    demand(leg && same(legRequest(leg, action as 'hold' | 'confirm' | 'release' | 'cancel'), pending), 'persisted pending request changes declared provider/quote');
    demand(action === 'hold' ? o.phase === 'holding' && leg.status === 'planned' : action === 'confirm' ? o.phase === 'confirming' && leg.status === 'held' : o.phase === 'compensating' && leg.status === (action === 'release' ? 'held' : 'accepted'), 'pending action contradicts recorded progress');
  }
  return { coordination_id: uuid(o.coordination_id), customer, revision: units(o.revision), phase: o.phase, legs, pending, uncertain: o.uncertain,
    responses: unique(array(o.responses, 64).map(response), r => canonicalize([r.provider_id, r.operation_id])) };
}
export function createCoordinator(value: unknown): CoordinatorState {
  const o = exact(data(value), ['coordination_id', 'customer', 'legs']);
  const legs = array(o.legs, 16).map(v => { const l = exact(v, ['leg_id', 'quote', 'hold_id', 'hold_expires_at', 'operation_ids']); return { ...l, status: 'planned' }; });
  return coordinator({ ...o, legs, revision: 0, phase: 'holding', pending: null, uncertain: false, responses: [] });
}
function checkCoordinatorRevision(s: CoordinatorState, expectedRevision: number): void { demand(units(expectedRevision) === s.revision && s.revision < Number.MAX_SAFE_INTEGER, 'coordinator CAS conflict', 'conflict'); }
function legRequest(leg: CoordinatorLeg, action: 'hold' | 'confirm' | 'release' | 'cancel'): CoordinatorRequest {
  return { provider_id: leg.quote.provider.id, command: { operation_id: leg.operation_ids[action], action,
    payload: { hold_id: leg.hold_id, quote: leg.quote.revision, ...(action === 'hold' ? { expires_at: leg.hold_expires_at } : {}) } } };
}
export function planCoordinator(value: unknown, expectedRevision: number): { state: CoordinatorState; request: CoordinatorRequest | null } {
  const s = coordinator(value); checkCoordinatorRevision(s, expectedRevision);
  if (s.pending) return { state: s, request: structuredClone(s.pending) };
  if (['committed', 'compensated', 'exception'].includes(s.phase)) return { state: s, request: null };
  let request: CoordinatorRequest | null = null;
  if (s.phase === 'holding') {
    const leg = s.legs.find(l => l.status === 'planned');
    if (leg) request = legRequest(leg, 'hold'); else s.phase = 'confirming';
  }
  if (s.phase === 'confirming') {
    const leg = s.legs.find(l => l.status === 'held');
    if (leg) request = legRequest(leg, 'confirm');
    else { demand(s.legs.every(l => l.status === 'accepted'), 'coordinator cannot claim all commitments'); s.phase = 'committed'; }
  }
  if (s.phase === 'compensating') {
    for (const leg of s.legs) {
      if (leg.status === 'held') { request = legRequest(leg, 'release'); break; }
      if (leg.status === 'accepted') {
        if (leg.quote.terms.cancellation === 'before_fulfillment') { request = legRequest(leg, 'cancel'); break; }
        leg.status = 'exception';
      }
    }
    if (!request) s.phase = s.legs.some(l => l.status === 'exception' || l.status === 'accepted') ? 'exception' : 'compensated';
  }
  s.pending = request; s.uncertain = false; s.revision++;
  return { state: coordinator(s), request: request === null ? null : structuredClone(request) };
}
export function recordCoordinatorTimeout(value: unknown, operationId: string, expectedRevision: number): CoordinatorState {
  const s = coordinator(value); checkCoordinatorRevision(s, expectedRevision);
  demand(s.pending?.command.operation_id === uuid(operationId), 'timeout does not identify pending request', 'conflict');
  s.uncertain = true; s.revision++; return s;
}
export async function recordCoordinatorResponse(value: unknown, input: unknown, expectedRevision: number): Promise<CoordinatorState> {
  const s = coordinator(value), r = response(data(input)), prior = s.responses.find(p => p.provider_id === r.provider_id && p.operation_id === r.operation_id);
  if (prior) { demand(same(prior, r), 'provider response conflict', 'conflict'); return s; }
  checkCoordinatorRevision(s, expectedRevision); const pending = s.pending;
  demand(pending && pending.provider_id === r.provider_id && pending.command.operation_id === r.operation_id && await sha256Hex(canonicalize(pending.command)) === r.command_digest, 'response does not bind exact pending request', 'conflict');
  const action = pending.command.action; demand(['hold', 'confirm', 'release', 'cancel'].includes(action), 'unsupported coordinator action');
  const leg = s.legs.find(l => l.quote.provider.id === r.provider_id && l.operation_ids[action as keyof CoordinatorLeg['operation_ids']] === r.operation_id);
  demand(leg && same(legRequest(leg, action as 'hold' | 'confirm' | 'release' | 'cancel'), pending), 'pending provider/quote/terms substituted', 'conflict');
  const status: Record<string, CoordinatorLeg['status']> = { hold: 'held', confirm: 'accepted', release: 'released', cancel: 'cancelled' };
  if (r.outcome === 'accepted') {
    const receipt = r.receipt!;
    demand(receipt.operation_id === r.operation_id && receipt.command_digest === r.command_digest && receipt.action === action && receipt.hold_id === leg.hold_id && same(receipt.quote, leg.quote.revision) && receipt.status === status[action], 'provider receipt differs from exact request', 'conflict');
    leg.status = status[action];
  } else {
    // Refused cancellation/release cannot be represented as undoing known obligations.
    leg.status = action === 'cancel' || action === 'release' ? 'exception' : action === 'confirm' ? 'held' : 'rejected'; s.phase = 'compensating';
  }
  s.responses.push(r); s.pending = null; s.uncertain = false; s.revision++; return coordinator(s);
}
