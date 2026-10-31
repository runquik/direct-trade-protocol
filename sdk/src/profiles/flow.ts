/** dtp/flow@1: a company's book of conserved ledgers for goods and money. It carries the verbs `move`, `transform` and
 * `transfer` (build step 2 of docs/foundation/verb-layer-proposal.md, decisions V7, V8 and V14). It generalizes
 * dtp/inventory@2: ledgers for currencies held in accounts beside ledgers for products, locations as object references,
 * an owner on every position, facts that change up to sixteen ledgers of one book atomically, and a digest chain per
 * ledger. Portable, dependency-free, synchronous: it runs inside a host transaction on any runtime.
 * Profile document and fixtures: spec/profiles/flow/1.md, spec/profiles/flow/1/. inventory2.ts is unchanged. */
import { canonicalize } from '../canonical.ts';
import { sha256HexSync } from '../sha256.ts';
import { formatDecimal, parseDecimal } from './decimal.ts';
import { ACT_SCHEMA, OBJECT_REF_SCHEMA, checkActOwner, checkRefOwner, validateAct, validateObjectRef } from './act.ts';
import type { Act, ObjectRef } from './act.ts';
import { POSITION_STATUSES, samePackConversion } from './inventory2.ts';
import type { PositionStatus, WireUnit } from './inventory2.ts';
import type { ProductBody } from './product.ts';

export const FLOW_PROFILE = 'dtp.flow/1';
export const FLOW_KIND = 'dtp/flow@1';
export const FLOW_SEMANTICS = 'flow-v1';
export const FLOW_VERBS = ['move', 'transform', 'transfer'] as const;
export const MAX_FLOW_LEDGERS = 16, MAX_FLOW_LEGS = 16, MAX_FLOW_RESERVATIONS = 16, MAX_SETTLEMENTS = 16, MAX_SERIALS_PER_LEG = 256, OBSERVATION_WINDOW = 64;
/** Counterparts outside the book. Goods enter and leave through the first four, money through the last two. */
export const GOODS_VIRTUALS = ['~supplier', '~customer', '~adjustment', '~production'] as const;
export const MONEY_VIRTUALS = ['~counterparty', '~adjustment'] as const;
export const GOODS_SCALE = 3, MONEY_SCALE = 6;
const CURRENCY = /^[A-Z]{3,8}$/;

/** Exactly one of product and currency. */
export type Asset = { product: string | null; currency: string | null };
export type Location = { ref: ObjectRef | null; virtual: string | null };
export type FlowPosition = { lot_id: string | null; location: Location; status: PositionStatus; owner: ObjectRef | null };
/** Goods use the inventory@2 unit object; money uses system "currency" with the asset's code. */
export type FlowUnit = WireUnit | { system: 'currency'; code: string; packaging_id: null; version: null; base_units_per_pack: null };
export type FlowQuantity = { amount: string; unit: FlowUnit };
export type FlowLeg = { asset: Asset; from: FlowPosition; to: FlowPosition; quantity: FlowQuantity; serial_ids: string[] | null; reason: string | null };
export type FlowReservation = { kind: 'reserve' | 'release' | 'fulfill'; reservation_id: string; asset: Asset; position: FlowPosition; quantity: FlowQuantity; party: ObjectRef | null };
export type Transform = { recipe: ObjectRef | null; yield_loss: { product: string; quantity: FlowQuantity; reason: string }[]; equipment: ObjectRef[] };
export type Settlement = { claim: ObjectRef; kind: 'payment' | 'offset' | 'reversal'; amount: string; currency: string; reverses: string | null };
export type FlowFact = {
  act: Act; ledgers: { key: string; expected_revision: number; expected_digest: string | null }[]; legs: FlowLeg[]; reservations: FlowReservation[];
  transform: Transform | null; rights: ('title' | 'custody')[] | null; settles: Settlement[];
};
export type FlowPositionState = { position: FlowPosition; quantity: string; serials: string[] };
export type FlowLedger = {
  asset: Asset; account: string | null; unit: string; tracking: 'none' | 'lot' | 'serial'; balance: 'nonnegative' | 'signed'; revision: number; head: string | null;
  positions: Record<string, FlowPositionState>; reservations: Record<string, { position: string; quantity: string; party: ObjectRef | null }>;
};
export type FlowBook = { profile: typeof FLOW_PROFILE; organization_id: string; book_id: string; ledgers: Record<string, FlowLedger>; sources: Record<string, { high_water: number; recent: Record<string, string> }> };
export type FlowIssue = 'invalid' | 'wrong_scope' | 'observation_conflict' | 'stale_observation' | 'revision_conflict' | 'unit_mismatch' | 'tracking_mismatch' | 'insufficient_stock' | 'insufficient_reservation' | 'serial_conflict' | 'rights_mismatch' | 'ledger_unavailable';
export type FlowResult = { ok: true; duplicate: boolean; state: FlowBook } | { ok: false; code: FlowIssue; message: string; state: FlowBook };

const nullableRef = { ...OBJECT_REF_SCHEMA, nullable: true };
const asset = { type: 'object', additionalProperties: false, required: ['product', 'currency'], properties: { product: { type: 'string', maxLength: 36, nullable: true }, currency: { type: 'string', maxLength: 8, nullable: true } } };
const unit = { type: 'object', additionalProperties: false, required: ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'], properties: { system: { type: 'string', maxLength: 9, enum: ['ucum', 'packaging', 'currency'] }, code: { type: 'string', maxLength: 32, nullable: true }, packaging_id: { type: 'string', maxLength: 80, nullable: true }, version: { type: 'string', maxLength: 40, nullable: true }, base_units_per_pack: { type: 'string', maxLength: 24, nullable: true } } };
const quantity = { type: 'object', additionalProperties: false, required: ['amount', 'unit'], properties: { amount: { type: 'string', maxLength: 28 }, unit } };
const position = { type: 'object', additionalProperties: false, required: ['lot_id', 'location', 'status', 'owner'], properties: {
  lot_id: { type: 'string', maxLength: 120, nullable: true },
  location: { type: 'object', additionalProperties: false, required: ['ref', 'virtual'], properties: { ref: nullableRef, virtual: { type: 'string', maxLength: 16, nullable: true } } },
  status: { type: 'string', maxLength: 10, enum: [...POSITION_STATUSES] }, owner: nullableRef } };
export const FLOW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['act', 'ledgers', 'legs', 'reservations', 'transform', 'rights', 'settles'],
  properties: {
    act: ACT_SCHEMA,
    ledgers: { type: 'array', maxItems: MAX_FLOW_LEDGERS, items: { type: 'object', additionalProperties: false, required: ['key', 'expected_revision', 'expected_digest'], properties: { key: { type: 'string', maxLength: 64 }, expected_revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, expected_digest: { type: 'string', maxLength: 64, nullable: true } } } },
    legs: { type: 'array', maxItems: MAX_FLOW_LEGS, items: { type: 'object', additionalProperties: false, required: ['asset', 'from', 'to', 'quantity', 'serial_ids', 'reason'], properties: { asset, from: position, to: position, quantity, serial_ids: { type: 'array', maxItems: MAX_SERIALS_PER_LEG, items: { type: 'string', maxLength: 120 }, nullable: true }, reason: { type: 'string', maxLength: 200, nullable: true } } } },
    reservations: { type: 'array', maxItems: MAX_FLOW_RESERVATIONS, items: { type: 'object', additionalProperties: false, required: ['kind', 'reservation_id', 'asset', 'position', 'quantity', 'party'], properties: { kind: { type: 'string', maxLength: 7, enum: ['reserve', 'release', 'fulfill'] }, reservation_id: { type: 'string', maxLength: 120 }, asset, position, quantity, party: nullableRef } } },
    transform: { type: 'object', additionalProperties: false, required: ['recipe', 'yield_loss', 'equipment'], nullable: true, properties: {
      recipe: nullableRef,
      yield_loss: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['product', 'quantity', 'reason'], properties: { product: { type: 'string', maxLength: 36 }, quantity, reason: { type: 'string', maxLength: 200 } } } },
      equipment: { type: 'array', maxItems: 16, items: OBJECT_REF_SCHEMA } } },
    rights: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 7, enum: ['title', 'custody'] }, nullable: true },
    settles: { type: 'array', maxItems: MAX_SETTLEMENTS, items: { type: 'object', additionalProperties: false, required: ['claim', 'kind', 'amount', 'currency', 'reverses'], properties: { claim: OBJECT_REF_SCHEMA, kind: { type: 'string', maxLength: 8, enum: ['payment', 'offset', 'reversal'] }, amount: { type: 'string', maxLength: 28 }, currency: { type: 'string', maxLength: 8 }, reverses: { type: 'string', maxLength: 36, nullable: true } } } },
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, UCUM = /^[!-~]{1,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const ident = (v: unknown, max: number) => text(v, max) && !/["\\]/.test(v as string);
const digestOf = (v: unknown) => sha256HexSync(canonicalize(v));
class Refusal extends Error { code: FlowIssue; constructor(code: FlowIssue, message: string) { super(message); this.code = code; } }
const refuse = (code: FlowIssue, message: string): never => { throw new Refusal(code, message); };

/** A ledger's key: the digest of its canonical asset tuple, so member names never need escaping (#38). */
export const goodsLedgerKey = (product: string) => digestOf(['product', product]);
export const moneyLedgerKey = (currency: string, account: string) => digestOf(['money', currency, account]);
export const flowPositionKey = (p: FlowPosition) => digestOf([p.lot_id, p.location, p.status, p.owner]);

export function openFlowBook(organization_id: string, book_id: string): FlowBook {
  if (!UUID.test(organization_id) || !UUID.test(book_id)) throw new Error('invalid book scope');
  return { profile: FLOW_PROFILE, organization_id, book_id, ledgers: {}, sources: {} };
}
/** Opens a product's ledger in a book, anchored by the product's immutable base unit and tracking. */
export function openGoodsLedger(book: FlowBook, product_id: string, product: Pick<ProductBody, 'base_unit' | 'tracking'>): FlowBook {
  if (!UUID.test(product_id) || !isObject(product?.base_unit) || product.base_unit.system !== 'ucum' || !UCUM.test(product.base_unit.code) || !['none', 'lot', 'serial'].includes(product.tracking)) throw new Error('invalid product anchor');
  const key = goodsLedgerKey(product_id); if (book.ledgers[key]) throw new Error('ledger exists');
  const next = structuredClone(book);
  next.ledgers[key] = { asset: { product: product_id, currency: null }, account: null, unit: product.base_unit.code, tracking: product.tracking, balance: 'nonnegative', revision: 0, head: null, positions: {}, reservations: {} };
  return next;
}
/** Opens a currency's ledger for one account (a dtp/account object the company owns). A signed account may go negative. */
export function openMoneyLedger(book: FlowBook, currency: string, account: string, balance: 'nonnegative' | 'signed'): FlowBook {
  if (!CURRENCY.test(currency) || !UUID.test(account) || !['nonnegative', 'signed'].includes(balance)) throw new Error('invalid money anchor');
  const key = moneyLedgerKey(currency, account); if (book.ledgers[key]) throw new Error('ledger exists');
  const next = structuredClone(book);
  next.ledgers[key] = { asset: { product: null, currency }, account, unit: currency, tracking: 'none', balance, revision: 0, head: null, positions: {}, reservations: {} };
  return next;
}

function checkAsset(a: unknown, path: string): Asset {
  if (!isObject(a) || !exact(a, ['product', 'currency'])) refuse('invalid', `${path}: product and currency required`);
  const asset = a as Asset;
  if ((asset.product === null) === (asset.currency === null)) refuse('invalid', `${path}: exactly one of product and currency`);
  if (asset.product !== null && !UUID.test(String(asset.product))) refuse('invalid', `${path}: product root required`);
  if (asset.currency !== null && !CURRENCY.test(String(asset.currency))) refuse('invalid', `${path}: currency code required`);
  return asset;
}
const isVirtual = (p: FlowPosition) => p.location.virtual !== null;
/** The ledger a real position belongs to: the product's, or the currency's for the account the money is in. */
function ledgerOf(book: FlowBook, asset: Asset, p: FlowPosition, path: string): string {
  const key = asset.product !== null ? goodsLedgerKey(asset.product) : moneyLedgerKey(asset.currency!, p.location.ref!.root);
  if (!book.ledgers[key]) refuse('ledger_unavailable', `${path}: no ledger is open for this ${asset.product !== null ? 'product' : 'currency and account'} in the book`);
  return key;
}
function checkPosition(book: FlowBook, asset: Asset, raw: unknown, path: string): FlowPosition {
  if (!isObject(raw) || !exact(raw, ['lot_id', 'location', 'status', 'owner'])) refuse('invalid', `${path}: lot_id, location, status and owner required`);
  const p = raw as FlowPosition, loc = p.location as unknown;
  if (!isObject(loc) || !exact(loc, ['ref', 'virtual']) || (loc.ref === null) === (loc.virtual === null)) refuse('invalid', `${path}.location: exactly one of ref and virtual`);
  if (!(POSITION_STATUSES as readonly string[]).includes(p.status)) refuse('invalid', `${path}: unknown status`);
  if (p.owner !== null && validateObjectRef(p.owner, `${path}.owner`).length) refuse('invalid', `${path}.owner: object reference or null required`);
  const money = asset.currency !== null;
  if (p.location.virtual !== null) {
    if (!((money ? MONEY_VIRTUALS : GOODS_VIRTUALS) as readonly string[]).includes(p.location.virtual)) refuse('invalid', `${path}: unknown virtual location for this asset`);
    if (p.lot_id !== null || p.owner !== null || p.status !== 'available') refuse('invalid', `${path}: a virtual position has no lot, owner or status other than available`);
    return p;
  }
  if (validateObjectRef(p.location.ref, `${path}.location.ref`).length) refuse('invalid', `${path}.location.ref: object reference required`);
  const ledger = book.ledgers[ledgerOf(book, asset, p, path)];
  if (money) {
    if (p.location.ref!.minted_by !== null || p.location.ref!.record_id !== null) refuse('invalid', `${path}: money is held in the company's own account, referenced by root`);
    if (p.lot_id !== null || p.owner !== null || p.status !== 'available') refuse('invalid', `${path}: money positions carry no lot, no owner and status available`);
    return p;
  }
  if (p.lot_id !== null && !ident(p.lot_id, 120)) refuse('invalid', `${path}: bounded lot or null required`);
  if (ledger.tracking === 'none' && p.lot_id !== null) refuse('tracking_mismatch', `${path}: this product is not lot-tracked`);
  if (ledger.tracking !== 'none' && p.lot_id === null) refuse('tracking_mismatch', `${path}: this product is lot-tracked; a lot is required`);
  return p;
}
/** Goods: the product base unit or a published packaging revision, three places, never rounded. Money: the currency, six places. */
function toBase(ledger: FlowLedger | null, asset: Asset, q: unknown, path: string): bigint {
  if (!isObject(q) || !exact(q, ['amount', 'unit']) || !isObject(q.unit) || !exact(q.unit, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) refuse('invalid', `${path}: quantity with amount and exact unit required`);
  const u = (q as FlowQuantity).unit as Record<string, unknown>, money = asset.currency !== null;
  let amount: bigint; try { amount = parseDecimal((q as FlowQuantity).amount, money ? MONEY_SCALE : GOODS_SCALE); } catch { return refuse('invalid', `${path}: ${money ? 'six' : 'three'}-place decimal amount required`); }
  if (amount <= 0n) refuse('invalid', `${path}: positive quantity required`);
  if (money) {
    if (u.system !== 'currency' || u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) refuse('unit_mismatch', `${path}: money is counted in its currency`);
    if (u.code !== asset.currency) refuse('unit_mismatch', `${path}: the amount is in ${asset.currency}; no currency is converted`);
    return amount;
  }
  if (u.system === 'ucum') {
    if (u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) refuse('invalid', `${path}: a ucum unit carries no packaging`);
    if (ledger && u.code !== ledger.unit) refuse('unit_mismatch', `${path}: quantities are in the product base unit ${ledger.unit}; no unit is converted`);
    return amount;
  }
  if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) refuse(u.system === 'currency' ? 'unit_mismatch' : 'invalid', `${path}: packaging unit needs packaging_id and version`);
  let per: bigint; try { per = parseDecimal(u.base_units_per_pack, GOODS_SCALE); } catch { return refuse('invalid', `${path}: three-place pack conversion required`); }
  if (per <= 0n) refuse('invalid', `${path}: positive pack conversion required`);
  const base = amount * per; if (base % 1000n !== 0n) refuse('invalid', `${path}: conversion exceeds base precision; stock is never rounded`);
  return base / 1000n;
}
const scaleOf = (l: FlowLedger) => l.asset.currency !== null ? MONEY_SCALE : GOODS_SCALE;
const reservedAt = (l: FlowLedger, key: string) => Object.values(l.reservations).filter(r => r.position === key).reduce((n, r) => n + parseDecimal(r.quantity, GOODS_SCALE), 0n);
function positionAt(l: FlowLedger, p: FlowPosition): FlowPositionState { return l.positions[flowPositionKey(p)] ??= { position: structuredClone(p), quantity: '0', serials: [] }; }
function compact(l: FlowLedger) { for (const [k, p] of Object.entries(l.positions)) if (parseDecimal(p.quantity, scaleOf(l), true) === 0n && p.serials.length === 0) delete l.positions[k]; }
const sameRef = (a: ObjectRef | null, b: ObjectRef | null) => canonicalize(a) === canonicalize(b);

/** Host rule, not the reducer's: true when a goods leg, reservation or yield loss pins a pack conversion its product has
 *  not published (`unknown_packaging`), matched by value as in inventory@2 (#99), or the product is unknown. `products` maps product roots to their heads. */
export function flowUnpublishedPackaging(fact: unknown, products: (root: string) => Pick<ProductBody, 'packaging'> | undefined): boolean {
  const f = fact as any, items = [...(Array.isArray(f?.legs) ? f.legs : []), ...(Array.isArray(f?.reservations) ? f.reservations : [])].map((x: any) => [x?.asset?.product, x?.quantity?.unit]);
  for (const y of Array.isArray(f?.transform?.yield_loss) ? f.transform.yield_loss : []) items.push([y?.product, y?.quantity?.unit]);
  return items.filter(([, u]) => u && typeof u === 'object' && u.system === 'packaging').some(([root, u]) => {
    const product = typeof root === 'string' ? products(root) : undefined;
    return !product || !(product.packaging as any[]).some(x => x.packaging_id === u.packaging_id && x.version === u.version && samePackConversion(x.base_units_per_pack, u.base_units_per_pack));
  });
}
/** Host rule: references to the writer's own objects leave minted_by null, everywhere in the fact (checkRefOwner). */
export function checkFlowOwner(fact: FlowFact, organizationId: string): { path: string; message: string }[] {
  const issues = checkActOwner(fact.act, organizationId), ref = (r: ObjectRef | null, path: string) => { if (r) issues.push(...checkRefOwner(r, path, organizationId)); };
  const pos = (p: FlowPosition, path: string) => { ref(p.location.ref, `${path}.location.ref`); ref(p.owner, `${path}.owner`); };
  fact.legs.forEach((l, i) => { pos(l.from, `$.legs[${i}].from`); pos(l.to, `$.legs[${i}].to`); });
  fact.reservations.forEach((r, i) => { pos(r.position, `$.reservations[${i}].position`); ref(r.party, `$.reservations[${i}].party`); });
  if (fact.transform) { ref(fact.transform.recipe, '$.transform.recipe'); fact.transform.equipment.forEach((e, i) => ref(e, `$.transform.equipment[${i}]`)); }
  fact.settles.forEach((s, i) => ref(s.claim, `$.settles[${i}].claim`));
  return issues;
}

/** Applies one fact atomically to every ledger it names. Assumes an authenticated, schema-admitted fact and authoritative
 *  persisted state; the caller MUST deduplicate and persist the returned book in one transaction. */
export function applyFlowFact(state: FlowBook, fact: FlowFact): FlowResult {
  const fail = (code: FlowIssue, message: string): FlowResult => ({ ok: false, code, message, state });
  try {
    if (!isObject(fact) || !exact(fact, [...FLOW_SCHEMA.required])) return fail('invalid', 'exact fact fields required');
    const actIssues = validateAct(fact.act); if (actIssues.length) return fail('invalid', `${actIssues[0].path}: ${actIssues[0].message}`);
    const verb = fact.act.verb as typeof FLOW_VERBS[number];
    if (!(FLOW_VERBS as readonly string[]).includes(verb)) return fail('invalid', '$.act.verb: a flow fact moves, transforms or transfers');
    if (!Array.isArray(fact.legs) || fact.legs.length > MAX_FLOW_LEGS || !Array.isArray(fact.reservations) || fact.reservations.length > MAX_FLOW_RESERVATIONS || !Array.isArray(fact.settles) || fact.settles.length > MAX_SETTLEMENTS || !Array.isArray(fact.ledgers) || fact.ledgers.length > MAX_FLOW_LEDGERS) return fail('invalid', 'bounded legs, reservations, settlements and ledgers required');
    if (fact.legs.length + fact.reservations.length + fact.settles.length === 0) return fail('invalid', 'a fact carries at least one leg, reservation or settlement');
    // Observation deduplication: a per-source high-water mark per book, with a bounded window for late arrivals.
    const { source_id, sequence } = fact.act.observation, source = state.sources[source_id] ?? { high_water: 0, recent: {} }, factDigest = digestOf(fact);
    if (!ident(source_id, 200)) return fail('invalid', '$.act.observation.source_id: member-name-safe source required');
    if (sequence <= source.high_water) {
      const known = source.recent[String(sequence)];
      if (known !== undefined) return known === factDigest ? { ok: true, duplicate: true, state } : fail('observation_conflict', 'observation sequence already names a different fact');
      if (sequence <= source.high_water - OBSERVATION_WINDOW) return fail('stale_observation', `observation is older than the ${OBSERVATION_WINDOW}-sequence window and cannot be told from a duplicate`);
    }
    const next: FlowBook = structuredClone(state), touched = new Set<string>();
    const touch = (asset: Asset, p: FlowPosition, path: string) => { if (!isVirtual(p)) touched.add(ledgerOf(next, asset, p, path)); };
    // Shape of every leg, reservation, transform and settlement first, so the ledger list can be checked before any change.
    fact.legs.forEach((leg, i) => {
      const path = `$.legs[${i}]`;
      if (!isObject(leg) || !exact(leg, ['asset', 'from', 'to', 'quantity', 'serial_ids', 'reason'])) refuse('invalid', `${path}: exact leg fields required`);
      const asset = checkAsset(leg.asset, `${path}.asset`), from = checkPosition(next, asset, leg.from, `${path}.from`), to = checkPosition(next, asset, leg.to, `${path}.to`);
      if (isVirtual(from) && isVirtual(to)) refuse('invalid', `${path}: a leg needs at least one real position`);
      if (flowPositionKey(from) === flowPositionKey(to)) refuse('invalid', `${path}: from and to are the same position`);
      if (leg.reason !== null && !text(leg.reason, 200)) refuse('invalid', `${path}: bounded reason or null required`);
      if ((from.location.virtual === '~adjustment' || to.location.virtual === '~adjustment') && leg.reason === null) refuse('invalid', `${path}: an adjustment requires a reason`);
      touch(asset, from, `${path}.from`); touch(asset, to, `${path}.to`);
    });
    fact.reservations.forEach((op, i) => {
      const path = `$.reservations[${i}]`;
      if (!isObject(op) || !exact(op, ['kind', 'reservation_id', 'asset', 'position', 'quantity', 'party'])) refuse('invalid', `${path}: exact reservation fields required`);
      const asset = checkAsset(op.asset, `${path}.asset`); if (asset.product === null) refuse('invalid', `${path}: reservations claim goods`);
      if (!['reserve', 'release', 'fulfill'].includes(op.kind) || !ident(op.reservation_id, 120) || (op.party !== null && validateObjectRef(op.party, `${path}.party`).length)) refuse('invalid', `${path}: kind, reservation id and party or null required`);
      const p = checkPosition(next, asset, op.position, `${path}.position`); if (isVirtual(p)) refuse('invalid', `${path}: reservations claim real stock`);
      if (p.status !== 'available') refuse('invalid', `${path}: only available stock is reserved`);
      touch(asset, p, `${path}.position`);
    });
    const productionLegs = fact.legs.filter(l => l.from.location.virtual === '~production' || l.to.location.virtual === '~production');
    if (verb === 'transform') {
      const t = fact.transform as unknown;
      if (!isObject(t) || !exact(t, ['recipe', 'yield_loss', 'equipment'])) refuse('invalid', '$.transform: a transform states its recipe, yield loss and equipment');
      if (productionLegs.length !== fact.legs.length || fact.reservations.length) refuse('invalid', '$.legs: a transform carries only production legs');
      if (!fact.legs.some(l => l.to.location.virtual === '~production') || !fact.legs.some(l => l.from.location.virtual === '~production')) refuse('invalid', '$.legs: a transform consumes at least one input and produces at least one output');
      const tr = t as Transform;
      if (tr.recipe !== null && validateObjectRef(tr.recipe, '$.transform.recipe').length) refuse('invalid', '$.transform.recipe: object reference or null required');
      if (!Array.isArray(tr.equipment) || tr.equipment.length > 16 || tr.equipment.some((e, i) => validateObjectRef(e, `$.transform.equipment[${i}]`).length)) refuse('invalid', '$.transform.equipment: object references required');
      if (!Array.isArray(tr.yield_loss) || tr.yield_loss.length > 16) refuse('invalid', '$.transform.yield_loss: at most 16 entries');
      const inputs = new Set(fact.legs.filter(l => l.to.location.virtual === '~production').map(l => l.asset.product));
      tr.yield_loss.forEach((y, i) => {
        if (!isObject(y) || !exact(y, ['product', 'quantity', 'reason']) || !text(y.reason, 200)) refuse('invalid', `$.transform.yield_loss[${i}]: product, quantity and reason required`);
        if (!inputs.has(y.product)) refuse('invalid', `$.transform.yield_loss[${i}]: a loss is of an input`);
        toBase(next.ledgers[goodsLedgerKey(y.product)] ?? null, { product: y.product, currency: null }, y.quantity, `$.transform.yield_loss[${i}].quantity`);
      });
    } else {
      if (fact.transform !== null) refuse('invalid', '$.transform: only a transform carries one');
      if (productionLegs.length) refuse('invalid', '$.legs: production legs belong to a transform');
    }
    // Rights: a move never changes title or custody's holder in place; a transfer changes exactly what it says it does.
    if (verb === 'transfer') {
      const rights = fact.rights as unknown;
      if (!Array.isArray(rights) || rights.length === 0 || new Set(rights).size !== rights.length || !rights.every(r => r === 'title' || r === 'custody')) refuse('invalid', '$.rights: a transfer names the rights it moves');
      const title = (rights as string[]).includes('title'), custody = (rights as string[]).includes('custody');
      if (fact.legs.length === 0 && !fact.settles.some(s => s.kind !== 'payment')) refuse('invalid', '$.legs: a transfer moves something, or offsets or reverses settlements');
      fact.legs.forEach((leg, i) => {
        const path = `$.legs[${i}]`;
        if (leg.asset.currency !== null) {
          if (!title || custody) refuse('rights_mismatch', `${path}: money changes hands by title only`);
          if (leg.from.location.virtual !== '~counterparty' && leg.to.location.virtual !== '~counterparty') refuse('rights_mismatch', `${path}: money changes hands with a counterparty; between the company's own accounts it moves`);
          return;
        }
        if (isVirtual(leg.from) || isVirtual(leg.to)) refuse('rights_mismatch', `${path}: a transfer of goods is between two real positions; goods enter and leave the book by a move`);
        if (leg.from.lot_id !== leg.to.lot_id || leg.from.status !== leg.to.status) refuse('rights_mismatch', `${path}: a transfer changes neither lot nor status`);
        const ownerChanged = !sameRef(leg.from.owner, leg.to.owner), placeChanged = !sameRef(leg.from.location.ref, leg.to.location.ref);
        if (ownerChanged !== title || placeChanged !== custody) refuse('rights_mismatch', `${path}: the leg changes ${[ownerChanged && 'title', placeChanged && 'custody'].filter(Boolean).join(' and ') || 'nothing'}, not what rights says`);
      });
    } else {
      if (fact.rights !== null) refuse('invalid', '$.rights: only a transfer names rights');
      fact.legs.forEach((leg, i) => {
        if (leg.asset.product !== null && !isVirtual(leg.from) && !isVirtual(leg.to) && !sameRef(leg.from.owner, leg.to.owner)) refuse('rights_mismatch', `$.legs[${i}]: a change of owner is a transfer of title`);
        if (leg.asset.currency !== null && (leg.from.location.virtual === '~counterparty' || leg.to.location.virtual === '~counterparty')) refuse('rights_mismatch', `$.legs[${i}]: money paid or received is a transfer of title`);
      });
    }
    // Settlements: shapes only. claim@1 reads them; the reducer checks what a fact alone can say.
    const currencies = new Set(fact.legs.filter(l => l.asset.currency !== null).map(l => l.asset.currency));
    fact.settles.forEach((s, i) => {
      const path = `$.settles[${i}]`;
      if (!isObject(s) || !exact(s, ['claim', 'kind', 'amount', 'currency', 'reverses'])) refuse('invalid', `${path}: exact settlement fields required`);
      if (validateObjectRef(s.claim, `${path}.claim`).length) refuse('invalid', `${path}.claim: object reference required`);
      if (!['payment', 'offset', 'reversal'].includes(s.kind) || !CURRENCY.test(String(s.currency))) refuse('invalid', `${path}: kind and currency required`);
      try { if (parseDecimal(s.amount, MONEY_SCALE) <= 0n) refuse('invalid', `${path}.amount: positive amount required`); } catch (e) { if (e instanceof Refusal) throw e; refuse('invalid', `${path}.amount: six-place decimal required`); }
      if ((s.kind === 'reversal') !== (s.reverses !== null)) refuse('invalid', `${path}.reverses: a reversal names the settlement fact it reverses, and only a reversal`);
      if (s.reverses !== null && !UUID.test(String(s.reverses))) refuse('invalid', `${path}.reverses: record id required`);
      if (s.kind === 'payment' && !currencies.has(s.currency)) refuse('invalid', `${path}: a payment settles with money legs in its currency`);
    });
    const offsets = fact.settles.filter(s => s.kind === 'offset');
    if (offsets.length === 1) refuse('invalid', '$.settles: an offset nets at least two claims');
    // The ledger list names exactly the ledgers touched, each at its current revision and head: one compare-and-set per ledger.
    const listed = new Set<string>();
    fact.ledgers.forEach((l, i) => {
      if (!isObject(l) || !exact(l, ['key', 'expected_revision', 'expected_digest']) || typeof l.key !== 'string' || !/^[0-9a-f]{64}$/.test(l.key) || !Number.isSafeInteger(l.expected_revision) || l.expected_revision < 0 || (l.expected_digest !== null && !(typeof l.expected_digest === 'string' && /^[0-9a-f]{64}$/.test(l.expected_digest)))) refuse('invalid', `$.ledgers[${i}]: key, revision and digest or null required`);
      if (listed.has(l.key)) refuse('invalid', `$.ledgers[${i}]: a ledger is listed once`); listed.add(l.key);
    });
    if (listed.size !== touched.size || [...touched].some(k => !listed.has(k))) refuse('wrong_scope', '$.ledgers: name exactly the ledgers the fact changes');
    for (const l of fact.ledgers) {
      const ledger = next.ledgers[l.key];
      if (ledger.revision >= Number.MAX_SAFE_INTEGER) refuse('invalid', 'ledger revision capacity exhausted');
      if (l.expected_revision !== ledger.revision || l.expected_digest !== ledger.head) refuse('revision_conflict', `ledger ${l.key.slice(0, 12)} changed; reload before deciding a new action`);
    }
    // Releases and fulfilments settle existing claims before any leg moves stock, so a leg can ship what a release in the
    // same fact frees (#85); reserves claim stock after the legs, so one fact can receive stock and reserve it.
    const reservation = (op: FlowReservation, i: number, phase: 'settle' | 'claim') => {
      if ((op.kind === 'reserve') !== (phase === 'claim')) return;
      const path = `$.reservations[${i}]`, ledger = next.ledgers[ledgerOf(next, op.asset, op.position, path)], key = flowPositionKey(op.position), qty = toBase(ledger, op.asset, op.quantity, `${path}.quantity`);
      const current = ledger.reservations[op.reservation_id];
      if (op.kind === 'reserve') {
        if (current && current.position !== key) refuse('invalid', `${path}: a reservation claims one position`);
        const have = parseDecimal(positionAt(ledger, op.position).quantity, GOODS_SCALE, true), reserved = reservedAt(ledger, key);
        if (have - reserved < qty) refuse('insufficient_stock', `${path}: reservation exceeds unreserved stock at the position`);
        ledger.reservations[op.reservation_id] = { position: key, quantity: formatDecimal((current ? parseDecimal(current.quantity, GOODS_SCALE) : 0n) + qty, GOODS_SCALE), party: current?.party ?? op.party };
        return;
      }
      if (!current || current.position !== key) refuse('insufficient_reservation', `${path}: no such reservation at that position`);
      const held = parseDecimal(current.quantity, GOODS_SCALE); if (held < qty) refuse('insufficient_reservation', `${path}: release or fulfilment exceeds the reservation`);
      if (held === qty) delete ledger.reservations[op.reservation_id]; else ledger.reservations[op.reservation_id] = { ...current, quantity: formatDecimal(held - qty, GOODS_SCALE) };
      if (op.kind === 'fulfill') {
        if (ledger.tracking === 'serial') refuse('tracking_mismatch', `${path}: serialized stock is fulfilled by a move naming its serials, plus a release`);
        const p = positionAt(ledger, op.position), have = parseDecimal(p.quantity, GOODS_SCALE, true); if (have < qty) refuse('insufficient_stock', `${path}: fulfilment exceeds the position`);
        p.quantity = formatDecimal(have - qty, GOODS_SCALE);
      }
    };
    fact.reservations.forEach((op, i) => reservation(op, i, 'settle'));
    // Apply the legs in order, between the two reservation phases.
    fact.legs.forEach((leg, i) => {
      const path = `$.legs[${i}]`, money = leg.asset.currency !== null;
      const fromKey = isVirtual(leg.from) ? null : ledgerOf(next, leg.asset, leg.from, path), toKey = isVirtual(leg.to) ? null : ledgerOf(next, leg.asset, leg.to, path);
      const anchor = next.ledgers[(fromKey ?? toKey)!], qty = toBase(anchor, leg.asset, leg.quantity, `${path}.quantity`), scale = scaleOf(anchor);
      if (anchor.tracking === 'serial') {
        if (leg.serial_ids === null) refuse('tracking_mismatch', `${path}: this product is serialized; the leg must name its serials`);
        if (!Array.isArray(leg.serial_ids) || leg.serial_ids.length === 0 || leg.serial_ids.length > MAX_SERIALS_PER_LEG || !leg.serial_ids.every(s => ident(s, 120)) || new Set(leg.serial_ids).size !== leg.serial_ids.length) refuse('serial_conflict', `${path}: serialized stock moves by distinct serial`);
        if (BigInt(leg.serial_ids!.length) * 1000n !== qty) refuse('serial_conflict', `${path}: quantity must equal the number of serials`);
      } else if (leg.serial_ids !== null) refuse('tracking_mismatch', `${path}: ${money ? 'money' : 'this product'} is not serialized`);
      if (fromKey) {
        const ledger = next.ledgers[fromKey], p = positionAt(ledger, leg.from), have = parseDecimal(p.quantity, scale, true), reserved = money ? 0n : reservedAt(ledger, flowPositionKey(leg.from));
        if (ledger.balance === 'nonnegative' && have - reserved < qty) refuse('insufficient_stock', `${path}: only ${formatDecimal(have - reserved, scale)} ${money ? 'available in the account' : 'unreserved at the source position'}`);
        p.quantity = formatDecimal(have - qty, scale);
        if (anchor.tracking === 'serial') for (const s of leg.serial_ids!) { const at = p.serials.indexOf(s); if (at < 0) refuse('serial_conflict', `${path}: serial ${s} is not at the source position`); p.serials.splice(at, 1); }
      } else if (anchor.tracking === 'serial') {
        for (const s of leg.serial_ids!) if (Object.values(anchor.positions).some(p => p.serials.includes(s))) refuse('serial_conflict', `${path}: serial ${s} already exists in the ledger`);
      }
      if (toKey) {
        const ledger = next.ledgers[toKey], p = positionAt(ledger, leg.to);
        p.quantity = formatDecimal(parseDecimal(p.quantity, scale, true) + qty, scale);
        if (anchor.tracking === 'serial') p.serials.push(...leg.serial_ids!);
      }
    });
    fact.reservations.forEach((op, i) => reservation(op, i, 'claim'));
    for (const key of touched) { const ledger = next.ledgers[key]; compact(ledger); ledger.revision += 1; ledger.head = factDigest; }
    const src = next.sources[source_id] ??= { high_water: 0, recent: {} };
    src.recent[String(sequence)] = factDigest; src.high_water = Math.max(src.high_water, sequence);
    for (const k of Object.keys(src.recent)) if (Number(k) <= src.high_water - OBSERVATION_WINDOW) delete src.recent[k];
    return { ok: true, duplicate: false, state: next };
  } catch (error) {
    if (error instanceof Refusal) return fail(error.code, error.message);
    return fail('invalid', error instanceof Error ? error.message : 'invalid profile data');
  }
}
/** The inventory@2 view of one product's ledger in a book: the company's own positions at its own or foreign locations,
 *  with location ids spelled `root` or `minted_by/root`. Derived, marked so, and never turned back into a flow ledger. */
export function projectInventory2(book: FlowBook, product_id: string) {
  const ledger = book.ledgers[goodsLedgerKey(product_id)]; if (!ledger) throw new Error('no ledger for that product');
  const spell = (p: FlowPosition) => p.location.ref!.minted_by === null ? p.location.ref!.root : `${p.location.ref!.minted_by}/${p.location.ref!.root}`;
  const keyV2 = (lot: string | null, location: string, status: string) => digestOf([lot, location, status]);
  const positions: Record<string, { position: { lot_id: string | null; location_id: string; status: PositionStatus }; quantity: string; serials: string[] }> = {}, moved: Record<string, string> = {};
  for (const [k, p] of Object.entries(ledger.positions)) {
    if (p.position.owner !== null) continue;
    const position = { lot_id: p.position.lot_id, location_id: spell(p.position), status: p.position.status }, key = keyV2(position.lot_id, position.location_id, position.status);
    const same = positions[key]; moved[k] = key;
    // Positions that differ only in a location's record_id spell the same inventory@2 position: sum them, never overwrite (#133).
    positions[key] = same ? { position, quantity: formatDecimal(parseDecimal(same.quantity, scaleOf(ledger), true) + parseDecimal(p.quantity, scaleOf(ledger), true), scaleOf(ledger)), serials: [...same.serials, ...p.serials].sort() } : { position, quantity: p.quantity, serials: [...p.serials] };
  }
  const reservations: Record<string, { position: string; quantity: string; party: string | null }> = {};
  for (const [id, r] of Object.entries(ledger.reservations)) if (moved[r.position]) reservations[id] = { position: moved[r.position], quantity: r.quantity, party: r.party?.minted_by === null ? r.party.root : null };
  return { profile: 'dtp.inventory/2' as const, derived: true as const, organization_id: book.organization_id, product_id, base_unit: { system: 'ucum' as const, code: ledger.unit }, tracking: ledger.tracking, revision: ledger.revision, positions, reservations };
}
