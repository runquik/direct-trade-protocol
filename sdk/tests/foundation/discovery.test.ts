import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryIndex, DiscoveryError } from '../../src/foundation/discovery.ts';
import type { DiscoveryPublication, DiscoveryKind, DiscoveryConfiguration, DiscoveryQuery } from '../../src/foundation/discovery.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const buyer = id(10), seller = id(20), registry = id(30);
const now = '2026-09-12T12:00:00.000Z';
const profile: Record<DiscoveryKind, string> = { 'goods.demand': 'a'.repeat(64), 'goods.supply': 'b'.repeat(64), 'service.demand': 'c'.repeat(64), 'service.supply': 'd'.repeat(64) };
const configuration: DiscoveryConfiguration = { profiles: Object.entries(profile).map(([kind, digest]) => ({ kind: kind as DiscoveryKind, digest, compatibility_group: kind.startsWith('goods') ? 'goods.hot-sauce-v1' : 'services.handling-v1' })), supported_timezones: ['UTC'] };
const external = (type: string, value: string) => ({ issuer: { kind: 'organization' as const, id: registry, organization_id: null }, type, value });
function publication(n: number, kind: DiscoveryKind = 'goods.supply', providerId = seller): DiscoveryPublication {
  const isDemand = kind.endsWith('demand'), service = kind.startsWith('service');
  const unit = external('unit', service ? 'pallet-slot' : 'case');
  return { revision: { entity: { kind: 'record', id: id(n), organization_id: providerId }, revision_id: id(n + 1000), digest: n.toString(16).padStart(64, '0') }, previous: null,
    profile_digest: profile[kind], kind, provider: { kind: 'organization', id: providerId, organization_id: null }, status: 'published', visibility: { kind: 'public' },
    published_at: '2026-09-12T10:00:00.000Z', expires_at: '2026-09-15T00:00:00.000Z',
    terms: { category: external('category', service ? 'warehouse.handling' : 'food.hot-sauce'), area: external('region', 'austin'),
      subject: service ? null : { kind: 'resource', id: id(70), organization_id: registry },
      time_window: { start: '2026-09-13T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' }, timezone: 'UTC',
      quantity: { state: 'known', value: { amount: isDemand ? '20' : '100', unit } },
      min_quantity: { state: 'known', value: { amount: '1', unit } }, max_quantity: { state: 'known', value: { amount: '100', unit } },
      authority_locator: { provider: { kind: 'organization', id: providerId, organization_id: null }, profile_digest: 'f'.repeat(64), quote_operation: 'quote.request', booking_operation: 'commitment.accept' },
      pricing: { kind: isDemand ? 'budget' : 'asking', amount: isDemand ? '50' : '40', currency: external('currency', 'USD'), basis: unit, taxes: 'included', fees: 'included' }, conditions: [external('handling', 'dry')] } };
}
function revise(p: DiscoveryPublication, n: number, changes: Partial<DiscoveryPublication> = {}): DiscoveryPublication {
  return { ...structuredClone(p), ...changes, previous: p.revision, revision: { ...p.revision, revision_id: id(n + 1000), digest: n.toString(16).padStart(64, '0') } };
}
function fixture(offers: DiscoveryPublication[] = []) {
  const index = createDiscoveryIndex(configuration), demand = publication(1, 'goods.demand', buyer);
  index.apply(demand, buyer, now); for (const offer of offers) index.apply(offer, offer.provider.id, now);
  const query: DiscoveryQuery = { demand: demand.revision, viewer_organization: buyer, now, limit: 50, cursor: null };
  return { index, demand, query };
}
const denied = (error: unknown) => error instanceof DiscoveryError || (error as any)?.name === 'DatatypeError';

test('discovery: hot sauce demand returns potential offers with exact source pins, never commitments', async () => {
  const p = publication(2), f = fixture([p]), result = await f.index.findPotentialOffers(f.query);
  assert.equal(result.offers.length, 1); assert.deepEqual(result.offers[0].publication.revision, p.revision);
  assert.equal(result.offers[0].classification, 'potential'); assert.equal(result.offers[0].authoritative_recheck_required, true);
  assert.equal(result.coverage, 'this-index-only'); assert.ok(!Object.hasOwn(result, 'total_count'));
  result.offers[0].publication.terms = null; assert.notEqual((await f.index.findPotentialOffers(f.query)).offers[0].publication.terms, null);
});

test('discovery: unrelated goods and service consumers retain separate admitted meanings', async () => {
  const goods = publication(2), service = publication(3, 'service.supply'), f = fixture([goods, service]);
  const demand = publication(4, 'service.demand', buyer); f.index.apply(demand, buyer, now);
  const page = await f.index.findPotentialOffers({ ...f.query, demand: demand.revision });
  assert.deepEqual(page.offers.map(o => o.publication.revision.entity.id), [service.revision.entity.id]);
  assert.ok(page.offers[0].limitations.includes('subject_unspecified'));
});

test('discovery: issuer, unit, category, currency and basis matches never imply conversions or aliases', async () => {
  const variants = [
    (p: DiscoveryPublication) => { p.terms!.category.issuer.id = id(99); },
    (p: DiscoveryPublication) => { p.terms!.category.value = 'food.sauce'; },
    (p: DiscoveryPublication) => { for (const q of [p.terms!.quantity, p.terms!.min_quantity, p.terms!.max_quantity]) if (q.state === 'known') q.value.unit.value = 'bottle'; },
    (p: DiscoveryPublication) => { if (p.terms!.pricing.kind !== 'request_for_quote') p.terms!.pricing.currency.value = 'EUR'; },
    (p: DiscoveryPublication) => { if (p.terms!.pricing.kind !== 'request_for_quote') p.terms!.pricing.basis.value = 'pallet'; },
    (p: DiscoveryPublication) => { p.terms!.conditions = []; },
    (p: DiscoveryPublication) => { p.terms!.subject!.id = id(90); },
  ];
  for (const change of variants) { const p = publication(2); change(p); const f = fixture([p]); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0); }
});

test('discovery: unknown quantity is not zero and is never reported as confirmed availability', async () => {
  const unknown = publication(2), zero = publication(3); unknown.terms!.quantity = { state: 'withheld' }; zero.terms!.quantity = { state: 'known', value: { amount: '0', unit: external('unit', 'case') } };
  unknown.terms!.pricing = { kind: 'request_for_quote' };
  const f = fixture([unknown, zero]), page = await f.index.findPotentialOffers(f.query);
  assert.equal(page.offers.length, 1); assert.equal(page.offers[0].publication.revision.entity.id, unknown.revision.entity.id);
  assert.ok(page.offers[0].limitations.includes('quantity_unknown_not_available')); assert.ok(page.offers[0].limitations.includes('price_unknown_request_quote'));
});

test('discovery: public and allowlisted visibility excludes private terms and unauthorized demand existence', async () => {
  const hidden = publication(2), allowed = publication(3); hidden.visibility = { kind: 'allowlist', organizations: [id(90)] }; allowed.visibility = { kind: 'allowlist', organizations: [buyer] };
  const f = fixture([hidden, allowed]); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 1);
  assert.equal((await f.index.findPotentialOffers({ ...f.query, viewer_organization: null })).offers.length, 0);
  const privateDemand = revise(f.demand, 100, { visibility: { kind: 'allowlist', organizations: [] } }); f.index.apply(privateDemand, buyer, now);
  for (const demand of [privateDemand.revision, publication(90, 'goods.demand').revision]) {
    await assert.rejects(f.index.findPotentialOffers({ ...f.query, demand, viewer_organization: id(91) }), (error: any) => error.code === 'unavailable' && error.message === 'demand unavailable');
  }
});

test('discovery: expiry and withdrawal invalidate cached visible pages without resurrecting old revisions', async () => {
  const a = publication(2), b = publication(3), f = fixture([a, b]);
  const page = await f.index.findPotentialOffers({ ...f.query, limit: 1 }); assert.ok(page.next_cursor);
  const withdrawal = revise(b, 100, { status: 'withdrawn', terms: null }); f.index.apply(withdrawal, seller, now);
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, limit: 1, cursor: page.next_cursor }), (error: any) => error.code === 'restart_required');
  assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 1);
  assert.throws(() => f.index.apply(b, seller, now), (error: any) => error.code === 'conflict');
  assert.deepEqual(f.index.apply(withdrawal, seller, now), { duplicate: true });
  assert.throws(() => f.index.apply(revise(b, 101), seller, now), (error: any) => error.code === 'conflict');
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, now: '2026-09-15T00:00:00.000Z' }), (error: any) => error.code === 'unavailable');
});

test('discovery: hidden publication insertions, updates and withdrawals leave another viewer cursor unchanged', async () => {
  const visible = [publication(2), publication(3)], f = fixture(visible), first = await f.index.findPotentialOffers({ ...f.query, limit: 1 });
  const hidden = publication(4); hidden.visibility = { kind: 'allowlist', organizations: [id(90)] }; f.index.apply(hidden, seller, now);
  const changed = revise(hidden, 100, { expires_at: '2026-09-16T00:00:00.000Z' }); f.index.apply(changed, seller, now);
  f.index.apply(revise(changed, 101, { status: 'withdrawn', terms: null }), seller, now);
  const after = await f.index.findPotentialOffers({ ...f.query, limit: 1 }); assert.deepEqual(after, first);
  const next = await f.index.findPotentialOffers({ ...f.query, limit: 1, cursor: first.next_cursor }); assert.equal(next.offers[0].publication.revision.entity.id, visible[1].revision.entity.id);
});

test('discovery: visibility loss and foreign-viewer or malformed cursors fail without hidden counters', async () => {
  const a = publication(2), b = publication(3), f = fixture([a, b]), page = await f.index.findPotentialOffers({ ...f.query, limit: 1 });
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, cursor: page.next_cursor, viewer_organization: id(91) }), (error: any) => error.code === 'restart_required');
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, cursor: 'not-json' }), (error: any) => error.code === 'restart_required');
  f.index.apply(revise(b, 100, { visibility: { kind: 'allowlist', organizations: [] } }), seller, now);
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, cursor: page.next_cursor }), (error: any) => error.code === 'restart_required');
});

test('discovery: exact retries are idempotent while wrong provider, changed content and unknown profiles reject', () => {
  const p = publication(2), f = fixture([p]); assert.deepEqual(f.index.apply(p, seller, now), { duplicate: true });
  assert.throws(() => f.index.apply(publication(3), buyer, now), denied);
  assert.throws(() => f.index.apply({ ...p, expires_at: '2026-10-01T00:00:00.000Z' }, seller, now), denied);
  assert.throws(() => f.index.apply({ ...publication(3), profile_digest: 'e'.repeat(64) }, seller, now), denied);
  assert.throws(() => f.index.apply({ ...publication(3), kind: 'service.supply' }, seller, now), denied);
});

test('discovery: independently disposable index instances replay identical history and replacement pages', async () => {
  const a = createDiscoveryIndex(configuration), b = createDiscoveryIndex(configuration), demand = publication(1, 'goods.demand', buyer), offer = publication(2);
  const withdrawn = revise(offer, 100, { status: 'withdrawn', terms: null }), renewed = revise(withdrawn, 101, { status: 'published', terms: offer.terms });
  const history = [demand, offer, publication(3), withdrawn, renewed];
  for (const p of history) a.apply(p, p.provider.id, now);
  for (const p of structuredClone(history)) b.apply(p, p.provider.id, now);
  const query = { demand: demand.revision, viewer_organization: buyer, now, limit: 1, cursor: null };
  const page = await a.findPotentialOffers(query); assert.deepEqual(await b.findPotentialOffers(query), page);
  assert.deepEqual(await a.findPotentialOffers({ ...query, cursor: page.next_cursor }), await b.findPotentialOffers({ ...query, cursor: page.next_cursor }));
});

test('discovery: partial timing and estimates explicitly disclose unconfirmed coverage and fees', async () => {
  const offer = publication(2); offer.terms!.time_window.start = '2026-09-13T12:00:00.000Z';
  if (offer.terms!.pricing.kind !== 'request_for_quote') { offer.terms!.pricing.kind = 'estimate'; offer.terms!.pricing.taxes = 'excluded'; offer.terms!.pricing.fees = 'unknown'; }
  const f = fixture([offer]), page = await f.index.findPotentialOffers(f.query);
  for (const flag of ['partial_time_window', 'estimated_price', 'taxes_not_confirmed_included', 'fees_not_confirmed_included']) assert.ok(page.offers[0].limitations.includes(flag));
});

test('discovery: closed bounded publication data rejects private extras, malicious shapes and wrong decimals', async () => {
  const f = fixture(), offer = publication(2); let calls = 0;
  const accessor = structuredClone(offer); Object.defineProperty(accessor.terms!, 'bank_balance', { enumerable: true, get() { calls++; return 'secret'; } });
  for (const p of [accessor, { ...offer, internal_cost: 'secret' }, { ...offer, visibility: { kind: 'public', organizations: [] } }, { ...offer, terms: Object.create(offer.terms) }]) assert.throws(() => f.index.apply(p, seller, now), denied);
  assert.equal(calls, 0);
  for (const value of ['1.0000001', '01', '-1', '1e3']) { const bad = structuredClone(offer); if (bad.terms!.quantity.state === 'known') bad.terms!.quantity.value.amount = value; assert.throws(() => f.index.apply(bad, seller, now), denied); }
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, limit: 51 }), denied);
});

test('discovery: minimum and maximum order constraints exclude incompatible quantities; unknown is not unlimited', async () => {
  for (const [field, amount] of [['min_quantity', '25'], ['max_quantity', '15']] as const) {
    const offer = publication(2), bound = offer.terms![field]; if (bound.state === 'known') bound.value.amount = amount;
    const f = fixture([offer]); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0);
  }
  const offer = publication(2); offer.terms!.min_quantity = { state: 'unknown' }; offer.terms!.max_quantity = { state: 'withheld' };
  const f = fixture([offer]); assert.ok((await f.index.findPotentialOffers(f.query)).offers[0].limitations.includes('order_limits_unknown_not_unrestricted'));
});

test('discovery: contradictory quantity bounds and spoofed authority locators reject before indexing', () => {
  const f = fixture();
  for (const change of [(p: DiscoveryPublication) => { if (p.terms!.min_quantity.state === 'known') p.terms!.min_quantity.value.amount = '101'; },
    (p: DiscoveryPublication) => { if (p.terms!.min_quantity.state === 'known') p.terms!.min_quantity.value.unit = external('unit', 'bottle'); },
    (p: DiscoveryPublication) => { p.terms!.authority_locator.provider.id = buyer; },
    (p: DiscoveryPublication) => { p.terms!.authority_locator.profile_digest = 'unversioned'; },
    (p: DiscoveryPublication) => { p.terms!.authority_locator.quote_operation = 'https://untrusted.test/quote'; }]) {
    const offer = publication(2); change(offer); assert.throws(() => f.index.apply(offer, seller, now), denied);
  }
});
