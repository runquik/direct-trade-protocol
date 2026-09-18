// Independent helper conformance, not authentication or live availability evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryIndex } from '../../src/foundation/discovery.ts';
import type { DiscoveryPublication, DiscoveryConfiguration, DiscoveryQuery } from '../../src/foundation/discovery.ts';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const buyer = id(1), seller = id(2), registry = id(3), hiddenBuyer = id(4);
const now = '2026-09-12T12:00:00.000Z';
const external = (type: string, value: string) => ({ issuer: { kind: 'organization' as const, id: registry, organization_id: null }, type, value });
const config = (): DiscoveryConfiguration => ({ profiles: [
  { digest: '1'.repeat(64), kind: 'goods.demand', compatibility_group: 'fixtures.goods' },
  { digest: '2'.repeat(64), kind: 'goods.supply', compatibility_group: 'fixtures.goods' },
  { digest: '3'.repeat(64), kind: 'goods.supply', compatibility_group: 'different.meaning' },
  { digest: '4'.repeat(64), kind: 'service.supply', compatibility_group: 'fixtures.goods' },
], supported_timezones: ['UTC'] });
function publication(n: number, demand = false): DiscoveryPublication {
  const provider = demand ? buyer : seller, unit = external('unit', 'case');
  return {
    revision: { entity: { kind: 'record', id: id(100 + n), organization_id: provider }, revision_id: id(1000 + n), digest: n.toString(16).padStart(64, '0') },
    previous: null, profile_digest: (demand ? '1' : '2').repeat(64), kind: demand ? 'goods.demand' : 'goods.supply',
    provider: { kind: 'organization', id: provider, organization_id: null }, status: 'published', visibility: { kind: 'public' },
    published_at: '2026-09-12T10:00:00.000Z', expires_at: '2026-09-15T00:00:00.000Z',
    terms: { category: external('category', 'hot-sauce'), area: external('area', 'austin'), subject: { kind: 'resource', id: id(8), organization_id: seller },
      time_window: { start: '2026-09-13T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' }, timezone: 'UTC',
      quantity: { state: 'known', value: { amount: demand ? '10' : '25', unit } },
      min_quantity: { state: 'known', value: { amount: '1', unit } },
      max_quantity: { state: 'known', value: { amount: '100', unit } },
      authority_locator: { provider: { kind: 'organization', id: provider, organization_id: null }, profile_digest: 'f'.repeat(64), quote_operation: 'quote.request', booking_operation: 'commitment.accept' },
      pricing: { kind: demand ? 'budget' : 'asking', amount: demand ? '50' : '40', currency: external('currency', 'USD'), basis: unit, taxes: 'included', fees: 'included' },
      conditions: [external('condition', 'sealed')] },
  };
}
function revision(p: DiscoveryPublication, n: number, patch: Partial<DiscoveryPublication> = {}): DiscoveryPublication {
  return { ...structuredClone(p), ...patch, previous: structuredClone(p.revision), revision: { ...structuredClone(p.revision), revision_id: id(2000 + n), digest: n.toString(16).padStart(64, 'a') } };
}
function fixture(offers: DiscoveryPublication[] = []) {
  const index = createDiscoveryIndex(config()), d = publication(1, true);
  index.apply(d, buyer, now); for (const offer of offers) index.apply(offer, seller, now);
  const query: DiscoveryQuery = { demand: d.revision, viewer_organization: buyer, now, limit: 1, cursor: null };
  return { index, d, query };
}
const restart = (e: any) => e?.code === 'restart_required';

test('discovery independent: hidden rows never change visible page bytes or cursors, including during hashing', async () => {
  const a = fixture([publication(2), publication(3)]), b = fixture([publication(2), publication(3)]);
  const hidden = publication(4); hidden.visibility = { kind: 'allowlist', organizations: [hiddenBuyer] };
  b.index.apply(hidden, seller, now);
  const expected = await a.index.findPotentialOffers(a.query);
  assert.deepEqual(await b.index.findPotentialOffers(b.query), expected);
  const inFlight = b.index.findPotentialOffers(b.query);
  b.index.apply(revision(hidden, 11, { status: 'withdrawn', terms: null }), seller, now);
  assert.deepEqual(await inFlight, expected);
  assert.deepEqual(await a.index.findPotentialOffers({ ...a.query, cursor: expected.next_cursor }), await b.index.findPotentialOffers({ ...b.query, cursor: expected.next_cursor }));
  assert.deepEqual(Object.keys(expected).sort(), ['authoritative_recheck_required', 'coverage', 'next_cursor', 'offers']);
});

test('discovery independent: withdrawal or visibility loss during real asynchronous hashing prevents stale output', async () => {
  for (const patch of [{ status: 'withdrawn' as const, terms: null }, { visibility: { kind: 'allowlist' as const, organizations: [hiddenBuyer] } }]) {
    const offer = publication(2), f = fixture([offer]);
    const pending = f.index.findPotentialOffers(f.query);
    f.index.apply(revision(offer, 20, patch), seller, now);
    await assert.rejects(pending, restart);
    assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0);
  }
});

test('discovery independent: demand replacement during hashing forces restart, even if offers do not change', async () => {
  const f = fixture([publication(2)]), pending = f.index.findPotentialOffers(f.query);
  f.index.apply(revision(f.d, 21, { expires_at: '2026-09-16T00:00:00.000Z' }), buyer, now);
  await assert.rejects(pending, restart);
});

test('discovery independent: caller-owned configuration, publication and query mutations do not alter accepted state', async () => {
  const configuration = config(), index = createDiscoveryIndex(configuration), d = publication(1, true), offer = publication(2);
  index.apply(d, buyer, now); index.apply(offer, seller, now);
  configuration.profiles[1].compatibility_group = 'different'; configuration.supported_timezones.length = 0;
  offer.terms!.conditions.length = 0; offer.visibility = { kind: 'allowlist', organizations: [] };
  const query: DiscoveryQuery = { demand: d.revision, viewer_organization: buyer, now, limit: 1, cursor: null };
  const pending = index.findPotentialOffers(query); query.viewer_organization = hiddenBuyer; query.demand.digest = 'f'.repeat(64);
  const page = await pending; assert.equal(page.offers.length, 1);
  assert.equal(page.offers[0].publication.visibility.kind, 'public');
});

test('discovery independent: exact admitted compatibility cannot be inferred from equal business fields', async () => {
  const wrongMeaning = publication(2); wrongMeaning.profile_digest = '3'.repeat(64);
  const wrongFamily = publication(3); wrongFamily.profile_digest = '4'.repeat(64); wrongFamily.kind = 'service.supply';
  const f = fixture([wrongMeaning, wrongFamily]);
  assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0);
  const unknown = publication(4); unknown.profile_digest = '5'.repeat(64);
  assert.throws(() => f.index.apply(unknown, seller, now));
});

test('discovery independent: unit, currency, price basis and conditions preserve exact issuer scope', async () => {
  const mutations: ((p: DiscoveryPublication) => void)[] = [
    p => { if (p.terms!.quantity.state === 'known') p.terms!.quantity.value.unit.issuer.id = id(80); },
    p => { if (p.terms!.pricing.kind !== 'request_for_quote') p.terms!.pricing.currency.issuer.id = id(80); },
    p => { if (p.terms!.pricing.kind !== 'request_for_quote') p.terms!.pricing.basis.issuer.id = id(80); },
    p => { p.terms!.conditions[0].issuer.id = id(80); },
    p => { p.terms!.area.issuer.id = id(80); },
  ];
  for (const mutate of mutations) { const offer = publication(2); mutate(offer); const f = fixture([offer]); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0); }
});

test('discovery independent: exact decimal quantity and budget boundaries use no floating point tolerance', async () => {
  for (const [quantity, price, matches] of [['10', '50', true], ['9.999999', '50', false], ['10', '50.000001', false], ['10.000001', '49.999999', true]] as const) {
    const offer = publication(2);
    if (offer.terms!.quantity.state === 'known') offer.terms!.quantity.value.amount = quantity;
    if (offer.terms!.pricing.kind !== 'request_for_quote') offer.terms!.pricing.amount = price;
    const f = fixture([offer]); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length === 1, matches);
  }
});

test('discovery independent: half-open time-window edges do not match and partial overlap is explicitly limited', async () => {
  for (const [start, end, matches] of [
    ['2026-09-12T00:00:00.000Z', '2026-09-13T00:00:00.000Z', false],
    ['2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z', false],
    ['2026-09-13T23:59:59.999Z', '2026-09-14T00:00:00.000Z', true],
  ] as const) {
    const offer = publication(2); offer.terms!.time_window = { start, end }; const f = fixture([offer]);
    const page = await f.index.findPotentialOffers(f.query); assert.equal(page.offers.length === 1, matches);
    if (matches) assert.ok(page.offers[0].limitations.includes('partial_time_window'));
  }
});

test('discovery independent: withdrawal tombstones reject both exact stale replay and changed digest under old revision ID', async () => {
  const offer = publication(2), f = fixture([offer]), withdrawn = revision(offer, 30, { status: 'withdrawn', terms: null });
  f.index.apply(withdrawn, seller, now);
  assert.throws(() => f.index.apply(offer, seller, now), (e: any) => e.code === 'conflict');
  const replay = structuredClone(offer); replay.previous = withdrawn.revision; replay.revision.digest = 'f'.repeat(64);
  assert.throws(() => f.index.apply(replay, seller, now), (e: any) => e.code === 'conflict');
  assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0);
});

test('discovery independent: invisible, missing, stale and withdrawn demands share the same failure', async () => {
  const f = fixture(), hidden = revision(f.d, 31, { visibility: { kind: 'allowlist', organizations: [] } });
  f.index.apply(hidden, buyer, now);
  for (const demand of [hidden.revision, f.d.revision, publication(99, true).revision]) {
    await assert.rejects(f.index.findPotentialOffers({ ...f.query, viewer_organization: hiddenBuyer, demand }), (e: any) => e.code === 'unavailable' && e.message === 'demand unavailable');
  }
  const withdrawn = revision(hidden, 32, { status: 'withdrawn', terms: null }); f.index.apply(withdrawn, buyer, now);
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, demand: withdrawn.revision }), (e: any) => e.code === 'unavailable' && e.message === 'demand unavailable');
});

test('discovery independent: malformed object/array/accessor and decimal input never becomes indexed', async () => {
  const bad: unknown[] = []; let reads = 0;
  const accessor = publication(2); Object.defineProperty(accessor, 'terms', { enumerable: true, get() { reads++; return {}; } }); bad.push(accessor);
  const sparse = publication(2); sparse.terms!.conditions = new Array(1); bad.push(sparse);
  const cycle = publication(2) as any; cycle.terms.conditions = [cycle]; bad.push(cycle);
  const extra = publication(2) as any; extra.terms.minimum = '10'; bad.push(extra);
  for (const amount of ['01', '1.0', '-0', '1e2', '0.0000001', '1000000000000000000', 1.5, NaN, Infinity]) {
    const p = publication(2); (p.terms!.quantity as any).value.amount = amount; bad.push(p);
  }
  for (const p of bad) { const f = fixture(); assert.throws(() => f.index.apply(p, seller, now)); assert.equal((await f.index.findPotentialOffers(f.query)).offers.length, 0); }
  assert.equal(reads, 0);
});

test('discovery independent: cursor cannot use a hidden anchor or expand another viewer scope', async () => {
  const hidden = publication(4); hidden.visibility = { kind: 'allowlist', organizations: [hiddenBuyer] };
  const f = fixture([publication(2), publication(3), hidden]), first = await f.index.findPotentialOffers(f.query);
  assert.ok(first.next_cursor);
  const cursor = JSON.parse(first.next_cursor); cursor.after = JSON.stringify(hidden.revision.entity);
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, cursor: JSON.stringify(cursor) }), restart);
  await assert.rejects(f.index.findPotentialOffers({ ...f.query, viewer_organization: null, cursor: first.next_cursor }), restart);
});

test('discovery independent: minimum and maximum order boundaries remain distinct from available stock', async () => {
  for (const [minimum, maximum, matches] of [['10','10',true],['10.000001','100',false],['1','9.999999',false]] as const) {
    const offer=publication(2);
    if(offer.terms!.min_quantity.state==='known')offer.terms!.min_quantity.value.amount=minimum;
    if(offer.terms!.max_quantity.state==='known')offer.terms!.max_quantity.value.amount=maximum;
    const f=fixture([offer]);assert.equal((await f.index.findPotentialOffers(f.query)).offers.length===1,matches);
  }
  const offer=publication(2);offer.terms!.min_quantity={state:'unknown'};offer.terms!.max_quantity={state:'withheld'};
  const f=fixture([offer]);assert.ok((await f.index.findPotentialOffers(f.query)).offers[0].limitations.includes('order_limits_unknown_not_unrestricted'));
});

test('discovery independent: unknown requested quantity does not erase incompatible known order ranges', async () => {
  for(const [available,minimum,maximum] of [['100','30','100'],['100','1','5'],['5','1','100']] as const){
    const offer=publication(2);
    if(offer.terms!.quantity.state==='known')offer.terms!.quantity.value.amount=available;
    if(offer.terms!.min_quantity.state==='known')offer.terms!.min_quantity.value.amount=minimum;
    if(offer.terms!.max_quantity.state==='known')offer.terms!.max_quantity.value.amount=maximum;
    const f=fixture([offer]),d=revision(f.d,90);
    d.terms!.quantity={state:'unknown'};
    if(d.terms!.min_quantity.state==='known')d.terms!.min_quantity.value.amount='10';
    if(d.terms!.max_quantity.state==='known')d.terms!.max_quantity.value.amount='20';
    f.index.apply(d,buyer,now);
    assert.equal((await f.index.findPotentialOffers({...f.query,demand:d.revision})).offers.length,0,'known constraints have no feasible requested quantity');
  }
});

test('discovery independent: malformed or cross-unit bounds and cross-provider locators are rejected',()=>{
  const cases:((p:DiscoveryPublication)=>void)[]=[
    p=>{if(p.terms!.min_quantity.state==='known')p.terms!.min_quantity.value.amount='101';},
    p=>{if(p.terms!.max_quantity.state==='known')p.terms!.max_quantity.value.unit=external('unit','pallet');},
    p=>{p.terms!.authority_locator.provider.id=buyer;},
    p=>{p.terms!.authority_locator.profile_digest='latest';},
    p=>{p.terms!.authority_locator.booking_operation='https://untrusted.invalid/book';},
  ];
  for(const mutate of cases){const f=fixture(),offer=publication(2);mutate(offer);assert.throws(()=>f.index.apply(offer,seller,now));}
});

test('discovery independent: locator changes pin a new publication revision and invalidate old cursors without fetching URLs',async()=>{
  const offer=publication(2),f=fixture([offer,publication(3)]),page=await f.index.findPotentialOffers(f.query);
  const next=revision(offer,91);next.terms!.authority_locator.quote_operation='quote.request-v2';
  f.index.apply(next,seller,now);
  await assert.rejects(f.index.findPotentialOffers({...f.query,cursor:page.next_cursor}),restart);
  const current=await f.index.findPotentialOffers(f.query);
  assert.deepEqual(current.offers[0].publication.revision.entity,offer.revision.entity);
  assert.equal(current.offers[0].publication.terms!.authority_locator.quote_operation,'quote.request-v2');
});
