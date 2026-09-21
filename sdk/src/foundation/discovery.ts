/** Replaceable bounded index over caller-authenticated publications. No transport or authority. */
import { canonicalize, sha256Hex } from '../canonical.ts';
import { parseDecimal, formatDecimal } from '../profiles/decimal.ts';
import { parseEntityReference, parseRevisionReference, parseExternalIdentifier, externalIdentifierKey,
  parseKnowledge, parseInstant, parseInstantInterval, parseTimeZone, entityReferenceKey } from './datatypes.ts';
import type { EntityReference, RevisionReference, ExternalIdentifier, Knowledge, InstantInterval } from './datatypes.ts';

export type DiscoveryKind = 'goods.supply' | 'goods.demand' | 'service.supply' | 'service.demand';
export type PublicationVisibility = { kind: 'public' } | { kind: 'allowlist'; organizations: string[] };
export type DiscoveryPricing = { kind: 'request_for_quote' } | { kind: 'asking' | 'estimate' | 'budget'; amount: string;
  currency: ExternalIdentifier; basis: ExternalIdentifier; taxes: 'included' | 'excluded' | 'unknown'; fees: 'included' | 'excluded' | 'unknown' };
export interface DiscoveryTerms {
  category: ExternalIdentifier; area: ExternalIdentifier; subject: EntityReference | null;
  time_window: InstantInterval; timezone: string;
  quantity: Knowledge<{ amount: string; unit: ExternalIdentifier }>;
  min_quantity: Knowledge<{ amount: string; unit: ExternalIdentifier }>;
  max_quantity: Knowledge<{ amount: string; unit: ExternalIdentifier }>;
  authority_locator: { provider: EntityReference; profile_digest: string; quote_operation: string; booking_operation: string };
  pricing: DiscoveryPricing; conditions: ExternalIdentifier[];
}
export interface DiscoveryPublication {
  revision: RevisionReference; previous: RevisionReference | null; profile_digest: string;
  kind: DiscoveryKind; provider: EntityReference; status: 'published' | 'withdrawn';
  visibility: PublicationVisibility; published_at: string; expires_at: string; terms: DiscoveryTerms | null;
}
export interface DiscoveryProfile { digest: string; kind: DiscoveryKind; compatibility_group: string }
export interface DiscoveryConfiguration { profiles: DiscoveryProfile[]; supported_timezones: string[] }
export interface DiscoveryQuery { demand: RevisionReference; viewer_organization: string | null; now: string; limit: number; cursor: string | null }
export interface PotentialOffer { publication: DiscoveryPublication; classification: 'potential'; limitations: string[]; authoritative_recheck_required: true }
export interface DiscoveryPage { offers: PotentialOffer[]; next_cursor: string | null; coverage: 'this-index-only'; authoritative_recheck_required: true }
export interface DiscoveryIndex {
  apply(publication: unknown, authenticatedProvider: string, acceptedAt: string): { duplicate: boolean };
  findPotentialOffers(query: unknown): Promise<DiscoveryPage>;
}
export class DiscoveryError extends Error {
  readonly code: 'invalid_discovery' | 'conflict' | 'unavailable' | 'restart_required' | 'capacity';
  constructor(reason: string, code: 'invalid_discovery' | 'conflict' | 'unavailable' | 'restart_required' | 'capacity' = 'invalid_discovery') { super(reason); this.name = 'DiscoveryError'; this.code = code; }
}
function demand(condition: unknown, reason: string, code: DiscoveryError['code'] = 'invalid_discovery'): asserts condition { if (!condition) throw new DiscoveryError(reason, code); }
function data(value: unknown): any {
  let nodes = 0;
  const visit = (input: unknown, depth: number): any => {
    demand(++nodes <= 2048 && depth <= 12, 'discovery data complexity exceeded');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') { demand(Number.isSafeInteger(input), 'safe integer required'); return input; }
    if (typeof input === 'string') { demand(input.length <= 2048, 'discovery text limit exceeded'); try { canonicalize(input); } catch { throw new DiscoveryError('malformed Unicode'); } return input; }
    demand(input !== null && typeof input === 'object', 'plain data required');
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input), keys = Reflect.ownKeys(input);
    demand(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'plain container required');
    demand(keys.length <= 129, 'container field limit exceeded');
    if (array) {
      demand(input.length <= 128 && keys.length === input.length + 1, 'dense bounded array required');
      return Array.from({ length: input.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(input, String(i)); demand(d && Object.hasOwn(d, 'value') && d.enumerable, 'data array required'); return visit(d.value, depth + 1); });
    }
    const out: Record<string, any> = {};
    for (const key of keys) {
      demand(typeof key === 'string' && key.length <= 96 && !['__proto__', 'constructor', 'prototype'].includes(key), 'unsafe data field');
      const d = Object.getOwnPropertyDescriptor(input, key); demand(d && Object.hasOwn(d, 'value') && d.enumerable, 'own enumerable data required'); out[key] = visit(d.value, depth + 1);
    }
    return out;
  };
  const copy = visit(value, 0); demand(new TextEncoder().encode(canonicalize(copy)).length <= 16384, 'aggregate discovery byte limit exceeded'); return copy;
}
function exact(value: unknown, keys: string[]): Record<string, any> {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required');
  const o = value as Record<string, any>; demand(Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k)), 'exact declared fields required'); return o;
}
function array(value: unknown, max: number): any[] { demand(Array.isArray(value) && value.length <= max, 'bounded array required'); return value; }
function uuid(value: unknown): string { demand(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), 'lowercase UUID required'); return value; }
function hash(value: unknown): string { demand(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'exact profile digest required'); return value; }
function kind(value: unknown): DiscoveryKind { demand(['goods.supply', 'goods.demand', 'service.supply', 'service.demand'].includes(value as string), 'unsupported publication kind'); return value as DiscoveryKind; }
function amount(value: unknown): string {
  try { const parsed = parseDecimal(value, 6); demand(formatDecimal(parsed, 6) === value, 'canonical decimal required'); return value as string; }
  catch (error) { if (error instanceof DiscoveryError) throw error; throw new DiscoveryError('bounded nonnegative decimal required'); }
}
function unique<T>(values: T[], key: (value: T) => string): T[] { demand(new Set(values.map(key)).size === values.length, 'duplicate scoped identifier'); return values; }
function operation(value: unknown): string { demand(typeof value === 'string' && value.length <= 96 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value), 'bounded operation name required'); return value; }
function same(a: unknown, b: unknown): boolean { return canonicalize(a) === canonicalize(b); }
function pricing(value: unknown, isDemand: boolean): DiscoveryPricing {
  demand(value !== null && typeof value === 'object', 'pricing required');
  if ((value as any).kind === 'request_for_quote') { exact(value, ['kind']); return { kind: 'request_for_quote' }; }
  const o = exact(value, ['kind', 'amount', 'currency', 'basis', 'taxes', 'fees']);
  demand(isDemand ? o.kind === 'budget' : ['asking', 'estimate'].includes(o.kind), 'pricing kind differs from supply/demand');
  demand(['included', 'excluded', 'unknown'].includes(o.taxes) && ['included', 'excluded', 'unknown'].includes(o.fees), 'tax/fee inclusion required');
  return { kind: o.kind, amount: amount(o.amount), currency: parseExternalIdentifier(o.currency), basis: parseExternalIdentifier(o.basis), taxes: o.taxes, fees: o.fees };
}
function publication(value: unknown, zones: string[]): DiscoveryPublication {
  const o = exact(data(value), ['revision', 'previous', 'profile_digest', 'kind', 'provider', 'status', 'visibility', 'published_at', 'expires_at', 'terms']);
  const revision = parseRevisionReference(o.revision), previous = o.previous === null ? null : parseRevisionReference(o.previous), provider = parseEntityReference(o.provider), family = kind(o.kind);
  demand(provider.kind === 'organization' && revision.entity.kind === 'record' && revision.entity.organization_id === provider.id, 'publication/provider scope mismatch');
  demand(previous === null || same(previous.entity, revision.entity), 'previous revision belongs to another publication');
  demand(o.status === 'published' || o.status === 'withdrawn', 'publication status required');
  let visibility: PublicationVisibility;
  if (o.visibility?.kind === 'public') { exact(o.visibility, ['kind']); visibility = { kind: 'public' }; }
  else { const v = exact(o.visibility, ['kind', 'organizations']); demand(v.kind === 'allowlist', 'explicit visibility required'); visibility = { kind: 'allowlist', organizations: unique(array(v.organizations, 64).map(uuid), v => v) }; }
  const published_at = parseInstant(o.published_at), expires_at = parseInstant(o.expires_at);
  demand(published_at < expires_at, 'publication expiry must follow publication time');
  let terms: DiscoveryTerms | null = null;
  if (o.status === 'withdrawn') demand(o.terms === null, 'withdrawal must not carry discoverable terms');
  else {
    const t = exact(o.terms, ['category', 'area', 'subject', 'time_window', 'timezone', 'quantity', 'min_quantity', 'max_quantity', 'authority_locator', 'pricing', 'conditions']);
    const subject = t.subject === null ? null : parseEntityReference(t.subject); demand(subject === null || subject.kind === 'resource', 'subject must be a resource');
    const parseQuantity = (value: unknown) => parseKnowledge(value, value => { const q = exact(value, ['amount', 'unit']); return { amount: amount(q.amount), unit: parseExternalIdentifier(q.unit) }; });
    const quantity = parseQuantity(t.quantity), min_quantity = parseQuantity(t.min_quantity), max_quantity = parseQuantity(t.max_quantity);
    const known = [quantity, min_quantity, max_quantity].filter(v => v.state === 'known');
    demand(known.every(v => same(v.value.unit, known[0].value.unit)), 'quantity bounds require consistent exact units');
    if (min_quantity.state === 'known' && max_quantity.state === 'known') demand(parseDecimal(min_quantity.value.amount, 6) <= parseDecimal(max_quantity.value.amount, 6), 'minimum exceeds maximum');
    if (family.endsWith('.demand') && quantity.state === 'known') demand(parseDecimal(quantity.value.amount, 6) > 0n, 'known demand quantity must be positive');
    if (family.endsWith('.demand') && quantity.state === 'known') {
      if (min_quantity.state === 'known') demand(parseDecimal(quantity.value.amount, 6) >= parseDecimal(min_quantity.value.amount, 6), 'demand is below its declared minimum');
      if (max_quantity.state === 'known') demand(parseDecimal(quantity.value.amount, 6) <= parseDecimal(max_quantity.value.amount, 6), 'demand exceeds its declared maximum');
    }
    const locator = exact(t.authority_locator, ['provider', 'profile_digest', 'quote_operation', 'booking_operation']), locatorProvider = parseEntityReference(locator.provider);
    demand(same(locatorProvider, provider), 'authority locator provider differs from publisher');
    const authority_locator = { provider: locatorProvider, profile_digest: hash(locator.profile_digest), quote_operation: operation(locator.quote_operation), booking_operation: operation(locator.booking_operation) };
    terms = { category: parseExternalIdentifier(t.category), area: parseExternalIdentifier(t.area), subject, time_window: parseInstantInterval(t.time_window), timezone: parseTimeZone(t.timezone, zones), quantity, min_quantity, max_quantity, authority_locator,
      pricing: pricing(t.pricing, family.endsWith('.demand')), conditions: unique(array(t.conditions, 32).map(parseExternalIdentifier), externalIdentifierKey) };
  }
  return { revision, previous, profile_digest: hash(o.profile_digest), kind: family, provider, status: o.status, visibility, published_at, expires_at, terms };
}
function visible(p: DiscoveryPublication, viewer: string | null, now: string): boolean {
  return p.status === 'published' && p.published_at <= now && p.expires_at > now && p.terms!.time_window.end > now &&
    (p.provider.id === viewer || p.visibility.kind === 'public' || (viewer !== null && p.visibility.organizations.includes(viewer)));
}
function potential(d: DiscoveryTerms, s: DiscoveryTerms): string[] | null {
  if (!same(d.category, s.category) || !same(d.area, s.area) || (d.subject !== null && !same(d.subject, s.subject))) return null;
  if (d.time_window.end <= s.time_window.start || s.time_window.end <= d.time_window.start) return null;
  if (!d.conditions.every(required => s.conditions.some(offered => same(required, offered)))) return null;
  const limitations = ['authoritative_availability_and_terms_recheck'];
  if (d.subject === null) limitations.push('subject_unspecified');
  if (s.time_window.start > d.time_window.start || s.time_window.end < d.time_window.end) limitations.push('partial_time_window');
  const known = [d.quantity, d.min_quantity, d.max_quantity, s.quantity, s.min_quantity, s.max_quantity].filter(v => v.state === 'known');
  if (!known.every(v => same(v.value.unit, known[0].value.unit))) return null;
  // Unknown exact demand does not erase its known range. Intersect every known
  // lower/upper bound, including available stock and exact requested quantity.
  let minimum = 1n, maximum: bigint | null = null;
  for (const bound of [d.quantity, d.min_quantity, s.min_quantity]) if (bound.state === 'known') {
    const n = parseDecimal(bound.value.amount, 6); if (n > minimum) minimum = n;
  }
  for (const bound of [d.quantity, d.max_quantity, s.max_quantity, s.quantity]) if (bound.state === 'known') {
    const n = parseDecimal(bound.value.amount, 6); if (maximum === null || n < maximum) maximum = n;
  }
  if (maximum !== null && minimum > maximum) return null;
  if (d.quantity.state !== 'known' || s.quantity.state !== 'known') limitations.push('quantity_unknown_not_available');
  if ([d.min_quantity, d.max_quantity, s.min_quantity, s.max_quantity].some(v => v.state !== 'known')) limitations.push('order_limits_unknown_not_unrestricted');
  if (d.pricing.kind !== 'request_for_quote' && s.pricing.kind !== 'request_for_quote') {
    if (!same(d.pricing.currency, s.pricing.currency) || !same(d.pricing.basis, s.pricing.basis) || parseDecimal(s.pricing.amount, 6) > parseDecimal(d.pricing.amount, 6)) return null;
  } else limitations.push('price_unknown_request_quote');
  if (s.pricing.kind !== 'request_for_quote') {
    if (s.pricing.kind === 'estimate') limitations.push('estimated_price');
    if (s.pricing.taxes !== 'included') limitations.push('taxes_not_confirmed_included');
    if (s.pricing.fees !== 'included') limitations.push('fees_not_confirmed_included');
  }
  return limitations;
}
export function createDiscoveryIndex(configuration: unknown): DiscoveryIndex {
  const config = exact(data(configuration), ['profiles', 'supported_timezones']);
  const zones = unique(array(config.supported_timezones, 128).map(v => { demand(typeof v === 'string', 'timezone text required'); return v; }), v => v);
  zones.forEach(zone => parseTimeZone(zone, zones));
  const profiles = new Map<string, DiscoveryProfile>();
  for (const input of array(config.profiles, 64)) {
    const p = exact(input, ['digest', 'kind', 'compatibility_group']), digest = hash(p.digest);
    demand(typeof p.compatibility_group === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(p.compatibility_group), 'compatibility group required');
    demand(!profiles.has(digest), 'duplicate profile admission'); profiles.set(digest, { digest, kind: kind(p.kind), compatibility_group: p.compatibility_group });
  }
  const heads = new Map<string, DiscoveryPublication>(), seen = new Set<string>();
  const offersFor = (d: DiscoveryPublication, viewer: string | null, now: string): PotentialOffer[] => {
    const dProfile = profiles.get(d.profile_digest)!;
    return [...heads.values()].filter(s => visible(s, viewer, now) && s.kind === d.kind.replace('.demand', '.supply') && profiles.get(s.profile_digest)!.compatibility_group === dProfile.compatibility_group)
      .map(s => ({ publication: s, limitations: potential(d.terms!, s.terms!) }))
      .filter((row): row is { publication: DiscoveryPublication; limitations: string[] } => row.limitations !== null)
      .sort((a, b) => { const x = entityReferenceKey(a.publication.revision.entity), y = entityReferenceKey(b.publication.revision.entity); return x < y ? -1 : x > y ? 1 : 0; })
      .map(row => ({ ...row, classification: 'potential', authoritative_recheck_required: true }));
  };
  return Object.freeze({
    apply(value: unknown, authenticatedProvider: string, acceptedAt: string): { duplicate: boolean } {
      const p = publication(value, zones), providerId = uuid(authenticatedProvider), now = parseInstant(acceptedAt), profile = profiles.get(p.profile_digest);
      demand(profile?.kind === p.kind, 'publication profile/kind is not admitted');
      demand(p.provider.id === providerId && p.published_at <= now, 'publisher authority/time mismatch');
      const key = entityReferenceKey(p.revision.entity), current = heads.get(key), revisionKey = canonicalize([key, p.revision.revision_id]);
      if (current && same(current.revision, p.revision)) { demand(same(current, p), 'conflicting publication retry', 'conflict'); return { duplicate: true }; }
      demand(!seen.has(revisionKey), 'previously accepted revision cannot be replayed as current', 'conflict');
      demand(current ? same(current.revision, p.previous) : p.previous === null, 'publication previous-head conflict', 'conflict');
      if (current) demand(same(current.provider, p.provider) && current.kind === p.kind && p.published_at >= current.published_at, 'publication identity or time cannot roll back', 'conflict');
      demand((current || heads.size < 1024) && seen.size < 8192, 'discovery index capacity exhausted', 'capacity');
      heads.set(key, p); seen.add(revisionKey); return { duplicate: false };
    },
    async findPotentialOffers(value: unknown): Promise<DiscoveryPage> {
      const q = exact(data(value), ['demand', 'viewer_organization', 'now', 'limit', 'cursor']);
      const ref = parseRevisionReference(q.demand), viewer = q.viewer_organization === null ? null : uuid(q.viewer_organization), now = parseInstant(q.now);
      demand(Number.isSafeInteger(q.limit) && q.limit >= 1 && q.limit <= 50 && (q.cursor === null || typeof q.cursor === 'string' && q.cursor.length <= 2048), 'invalid page request');
      const d = heads.get(entityReferenceKey(ref.entity));
      demand(d && same(d.revision, ref) && visible(d, viewer, now) && d.kind.endsWith('.demand'), 'demand unavailable', 'unavailable');
      const offers = offersFor(d, viewer, now), view = canonicalize(offers);
      const query_digest = await sha256Hex(canonicalize({ demand: ref, viewer_organization: viewer })), visible_digest = await sha256Hex(view);
      // A local write during hashing cannot cause a withdrawn/changed visible offer to escape.
      const currentDemand = heads.get(entityReferenceKey(ref.entity));
      demand(currentDemand && same(currentDemand, d) && visible(currentDemand, viewer, now) && canonicalize(offersFor(currentDemand, viewer, now)) === view, 'authorized view changed; restart query', 'restart_required');
      let after: string | null = null;
      if (q.cursor !== null) {
        let cursor: Record<string, any>;
        try { cursor = exact(data(JSON.parse(q.cursor)), ['query_digest', 'visible_digest', 'after']); }
        catch { throw new DiscoveryError('cursor invalid; restart query', 'restart_required'); }
        demand(cursor.query_digest === query_digest && cursor.visible_digest === visible_digest && typeof cursor.after === 'string' && offers.some(p => entityReferenceKey(p.publication.revision.entity) === cursor.after), 'cursor invalid; restart query', 'restart_required');
        after = cursor.after;
      }
      const start = after === null ? 0 : offers.findIndex(p => entityReferenceKey(p.publication.revision.entity) === after) + 1;
      const page = offers.slice(start, start + q.limit), hasMore = start + page.length < offers.length;
      const next_cursor = hasMore ? canonicalize({ query_digest, visible_digest, after: entityReferenceKey(page[page.length - 1].publication.revision.entity) }) : null;
      return { offers: structuredClone(page), next_cursor, coverage: 'this-index-only', authoritative_recheck_required: true };
    },
  });
}
