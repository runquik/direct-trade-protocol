// Deliberately separate implementation of dtp/flow@1, written from spec/profiles/flow/1.md, spec/profiles/verbs.md and
// the fixtures. Do not import the SDK reducer, decimal helpers, act.ts or canonicalizer here. Same author as the
// reference: separately coded agreement, not independent authorship. It must reach the same outcome for every fact
// and the same final book, including ledger and position keys and the digest chain, from the documents alone.
import { readerCanonical, readerDigest } from './product-reader.ts';
import { readAct, readRef } from './verb-datatypes-reader.ts';

export type Outcome = { ok: true; duplicate: boolean } | { ok: false; code: string };
type Ref = { minted_by: string | null; root: string; record_id: string | null };
type Pos = { lot_id: string | null; location: { ref: Ref | null; virtual: string | null }; status: string; owner: Ref | null };
type Ledger = { asset: { product: string | null; currency: string | null }; account: string | null; unit: string; tracking: string; balance: string; revision: number; head: string | null;
  positions: Record<string, { position: Pos; quantity: string; serials: string[] }>; reservations: Record<string, { position: string; quantity: string; party: Ref | null }> };
export type Book = { profile: string; organization_id: string; book_id: string; ledgers: Record<string, Ledger>; sources: Record<string, { high_water: number; recent: Record<string, string> }> };
const WINDOW = 64, STATUSES = ['available', 'quarantine', 'damaged', 'expired', 'in_transit'];
const GOODS_OUT = ['~supplier', '~customer', '~adjustment', '~production'], MONEY_OUT = ['~counterparty', '~adjustment'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, CURRENCY = /^[A-Z]{3,8}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const text = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const ident = (v: unknown, max: number) => text(v, max) && !/["\\]/.test(v as string);
class Stop extends Error { code: string; constructor(code: string, message = code) { super(message); this.code = code; } }
const stop = (code: string, message = code): never => { throw new Stop(code, message); };
/** Fixed point with `places` decimals, as bigint; negative allowed only where a balance may be signed. */
function fixed(v: unknown, places: number, negative = false): bigint {
  if (typeof v !== 'string' || !new RegExp(`^${negative ? '-?' : ''}\\d{1,18}(\\.\\d{1,${places}})?$`).test(v)) return stop('invalid', 'decimal');
  const neg = v.startsWith('-'), [w, f = ''] = (neg ? v.slice(1) : v).split('.'), n = BigInt(w) * 10n ** BigInt(places) + BigInt(f.padEnd(places, '0'));
  return neg ? -n : n;
}
function show(n: bigint, places: number): string {
  const neg = n < 0n, m = neg ? -n : n, d = 10n ** BigInt(places), f = (m % d).toString().padStart(places, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (m / d).toString() + (f ? '.' + f : '');
}
const goodsKey = (product: string) => readerDigest(['product', product]);
const moneyKey = (currency: string, account: string) => readerDigest(['money', currency, account]);
const posKey = (p: Pos) => readerDigest([p.lot_id, p.location, p.status, p.owner]);
const outside = (p: Pos) => p.location.virtual !== null;
const places = (l: Ledger) => l.asset.currency !== null ? 6 : 3;

export function openBook(organization_id: string, book_id: string, openings: any[]): Book {
  const book: Book = { profile: 'dtp.flow/1', organization_id, book_id, ledgers: {}, sources: {} };
  for (const o of openings) {
    if (o.kind === 'goods') book.ledgers[goodsKey(o.product_id)] = { asset: { product: o.product_id, currency: null }, account: null, unit: o.product.base_unit.code, tracking: o.product.tracking, balance: 'nonnegative', revision: 0, head: null, positions: {}, reservations: {} };
    else book.ledgers[moneyKey(o.currency, o.account)] = { asset: { product: null, currency: o.currency }, account: o.account, unit: o.currency, tracking: 'none', balance: o.balance, revision: 0, head: null, positions: {}, reservations: {} };
  }
  return book;
}
function asset(a: any, path: string) {
  if (!plain(a) || !keysAre(a, ['product', 'currency']) || (a.product === null) === (a.currency === null)) stop('invalid', `${path} asset`);
  if (a.product !== null && !UUID.test(a.product)) stop('invalid'); if (a.currency !== null && !CURRENCY.test(a.currency)) stop('invalid');
  return a as { product: string | null; currency: string | null };
}
function ledgerKeyOf(book: Book, a: { product: string | null; currency: string | null }, p: Pos): string {
  const k = a.product !== null ? goodsKey(a.product) : moneyKey(a.currency!, p.location.ref!.root);
  if (!book.ledgers[k]) stop('ledger_unavailable');
  return k;
}
function position(book: Book, a: { product: string | null; currency: string | null }, p: any, path: string): Pos {
  if (!plain(p) || !keysAre(p, ['lot_id', 'location', 'status', 'owner'])) stop('invalid', `${path} position`);
  const l = p.location;
  if (!plain(l) || !keysAre(l, ['ref', 'virtual']) || (l.ref === null) === (l.virtual === null)) stop('invalid', `${path} location`);
  if (!STATUSES.includes(p.status)) stop('invalid');
  if (p.owner !== null && readRef(p.owner, '$').length) stop('invalid');
  const money = a.currency !== null;
  if (l.virtual !== null) {
    if (!(money ? MONEY_OUT : GOODS_OUT).includes(l.virtual)) stop('invalid', 'virtual');
    if (p.lot_id !== null || p.owner !== null || p.status !== 'available') stop('invalid', 'virtual carries nothing');
    return p;
  }
  if (readRef(l.ref, '$').length) stop('invalid');
  const ledger = book.ledgers[ledgerKeyOf(book, a, p)];
  if (money) { if (l.ref.minted_by !== null || l.ref.record_id !== null || p.lot_id !== null || p.owner !== null || p.status !== 'available') stop('invalid', 'money position'); return p; }
  if (p.lot_id !== null && !ident(p.lot_id, 120)) stop('invalid');
  if ((ledger.tracking === 'none') !== (p.lot_id === null)) stop('tracking_mismatch');
  return p;
}
function base(ledger: Ledger | null, a: { product: string | null; currency: string | null }, q: any): bigint {
  if (!plain(q) || !keysAre(q, ['amount', 'unit']) || !plain(q.unit) || !keysAre(q.unit, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) stop('invalid', 'quantity');
  const money = a.currency !== null, amount = fixed(q.amount, money ? 6 : 3), u = q.unit;
  if (amount <= 0n) stop('invalid', 'positive');
  if (money) { if (u.system !== 'currency' || u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null || u.code !== a.currency) stop('unit_mismatch'); return amount; }
  if (u.system === 'ucum') { if (u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) stop('invalid'); if (ledger && u.code !== ledger.unit) stop('unit_mismatch'); return amount; }
  if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) stop(u.system === 'currency' ? 'unit_mismatch' : 'invalid');
  const per = fixed(u.base_units_per_pack, 3); if (per <= 0n) stop('invalid');
  if ((amount * per) % 1000n !== 0n) stop('invalid', 'never rounded');
  return amount * per / 1000n;
}
const same = (a: unknown, b: unknown) => readerCanonical(a) === readerCanonical(b);
const reserved = (l: Ledger, k: string) => Object.values(l.reservations).filter(r => r.position === k).reduce((n, r) => n + fixed(r.quantity, 3), 0n);
const slot = (l: Ledger, p: Pos) => l.positions[posKey(p)] ??= { position: JSON.parse(JSON.stringify(p)), quantity: '0', serials: [] };

export function readFlowFact(state: Book, fact: any): { outcome: Outcome; book: Book } {
  const book: Book = JSON.parse(JSON.stringify(state));
  try {
    if (!plain(fact) || !keysAre(fact, ['act', 'ledgers', 'legs', 'reservations', 'transform', 'rights', 'settles'])) stop('invalid');
    if (readAct(fact.act).length) stop('invalid', 'act');
    const verb = fact.act.verb; if (!['move', 'transform', 'transfer'].includes(verb)) stop('invalid', 'verb');
    for (const [list, max] of [[fact.legs, 16], [fact.reservations, 16], [fact.settles, 16], [fact.ledgers, 16]] as [unknown, number][]) if (!Array.isArray(list) || list.length > max) stop('invalid');
    if (fact.legs.length + fact.reservations.length + fact.settles.length === 0) stop('invalid', 'empty');
    const { source_id, sequence } = fact.act.observation, digest = readerDigest(fact), src = book.sources[source_id] ?? { high_water: 0, recent: {} };
    if (!ident(source_id, 200)) stop('invalid');
    if (sequence <= src.high_water) {
      const seen = src.recent[String(sequence)];
      if (seen !== undefined) { if (seen === digest) return { outcome: { ok: true, duplicate: true }, book: state }; stop('observation_conflict'); }
      if (sequence <= src.high_water - WINDOW) stop('stale_observation');
    }
    const touched = new Set<string>(), mark = (a: any, p: Pos) => { if (!outside(p)) touched.add(ledgerKeyOf(book, a, p)); };
    for (const l of fact.legs) {
      if (!plain(l) || !keysAre(l, ['asset', 'from', 'to', 'quantity', 'serial_ids', 'reason'])) stop('invalid');
      const a = asset(l.asset, 'leg'), from = position(book, a, l.from, 'from'), to = position(book, a, l.to, 'to');
      if (outside(from) && outside(to)) stop('invalid', 'one real end');
      if (posKey(from) === posKey(to)) stop('invalid', 'same position');
      if (l.reason !== null && !text(l.reason, 200)) stop('invalid');
      if ([from.location.virtual, to.location.virtual].includes('~adjustment') && l.reason === null) stop('invalid', 'adjustment reason');
      mark(a, from); mark(a, to);
    }
    for (const r of fact.reservations) {
      if (!plain(r) || !keysAre(r, ['kind', 'reservation_id', 'asset', 'position', 'quantity', 'party'])) stop('invalid');
      const a = asset(r.asset, 'res'); if (a.product === null) stop('invalid');
      if (!['reserve', 'release', 'fulfill'].includes(r.kind) || !ident(r.reservation_id, 120) || (r.party !== null && readRef(r.party, '$').length)) stop('invalid');
      const p = position(book, a, r.position, 'res'); if (outside(p) || p.status !== 'available') stop('invalid');
      mark(a, p);
    }
    const prod = (l: any) => l.from.location.virtual === '~production' || l.to.location.virtual === '~production';
    if (verb === 'transform') {
      const t = fact.transform;
      if (!plain(t) || !keysAre(t, ['recipe', 'yield_loss', 'equipment'])) stop('invalid');
      if (!fact.legs.every(prod) || fact.reservations.length) stop('invalid');
      if (!fact.legs.some((l: any) => l.to.location.virtual === '~production') || !fact.legs.some((l: any) => l.from.location.virtual === '~production')) stop('invalid');
      if (t.recipe !== null && readRef(t.recipe, '$').length) stop('invalid');
      if (!Array.isArray(t.equipment) || t.equipment.length > 16 || t.equipment.some((e: unknown) => readRef(e, '$').length)) stop('invalid');
      if (!Array.isArray(t.yield_loss) || t.yield_loss.length > 16) stop('invalid');
      const inputs = fact.legs.filter((l: any) => l.to.location.virtual === '~production').map((l: any) => l.asset.product);
      for (const y of t.yield_loss) {
        if (!plain(y) || !keysAre(y, ['product', 'quantity', 'reason']) || !text(y.reason, 200) || !inputs.includes(y.product)) stop('invalid');
        base(book.ledgers[goodsKey(y.product)] ?? null, { product: y.product, currency: null }, y.quantity);
      }
    } else {
      if (fact.transform !== null || fact.legs.some(prod)) stop('invalid');
    }
    if (verb === 'transfer') {
      const rights = fact.rights;
      if (!Array.isArray(rights) || !rights.length || new Set(rights).size !== rights.length || rights.some((r: string) => r !== 'title' && r !== 'custody')) stop('invalid');
      const title = rights.includes('title'), custody = rights.includes('custody');
      if (!fact.legs.length && !fact.settles.some((s: any) => s.kind !== 'payment')) stop('invalid');
      for (const l of fact.legs) {
        if (l.asset.currency !== null) { if (!title || custody || (l.from.location.virtual !== '~counterparty' && l.to.location.virtual !== '~counterparty')) stop('rights_mismatch'); continue; }
        if (outside(l.from) || outside(l.to) || l.from.lot_id !== l.to.lot_id || l.from.status !== l.to.status) stop('rights_mismatch');
        if (same(l.from.owner, l.to.owner) === title || same(l.from.location.ref, l.to.location.ref) === custody) stop('rights_mismatch');
      }
    } else {
      if (fact.rights !== null) stop('invalid');
      for (const l of fact.legs) {
        if (l.asset.product !== null && !outside(l.from) && !outside(l.to) && !same(l.from.owner, l.to.owner)) stop('rights_mismatch');
        if (l.asset.currency !== null && [l.from.location.virtual, l.to.location.virtual].includes('~counterparty')) stop('rights_mismatch');
      }
    }
    const paid = new Set(fact.legs.filter((l: any) => l.asset.currency !== null).map((l: any) => l.asset.currency));
    for (const s of fact.settles) {
      if (!plain(s) || !keysAre(s, ['claim', 'kind', 'amount', 'currency', 'reverses']) || readRef(s.claim, '$').length || !['payment', 'offset', 'reversal'].includes(s.kind) || !CURRENCY.test(s.currency)) stop('invalid');
      if (fixed(s.amount, 6) <= 0n) stop('invalid');
      if ((s.kind === 'reversal') !== (s.reverses !== null) || (s.reverses !== null && !UUID.test(s.reverses))) stop('invalid');
      if (s.kind === 'payment' && !paid.has(s.currency)) stop('invalid');
    }
    if (fact.settles.filter((s: any) => s.kind === 'offset').length === 1) stop('invalid');
    const listed: string[] = [];
    for (const l of fact.ledgers) {
      if (!plain(l) || !keysAre(l, ['key', 'expected_revision', 'expected_digest']) || typeof l.key !== 'string' || !/^[0-9a-f]{64}$/.test(l.key) || !Number.isSafeInteger(l.expected_revision) || l.expected_revision < 0 || (l.expected_digest !== null && !/^[0-9a-f]{64}$/.test(String(l.expected_digest)))) stop('invalid');
      if (listed.includes(l.key)) stop('invalid'); listed.push(l.key);
    }
    if (listed.length !== touched.size || [...touched].some(k => !listed.includes(k))) stop('wrong_scope');
    for (const l of fact.ledgers) { const g = book.ledgers[l.key]; if (l.expected_revision !== g.revision || l.expected_digest !== g.head) stop('revision_conflict'); }
    for (const l of fact.legs) {
      const fromKey = outside(l.from) ? null : ledgerKeyOf(book, l.asset, l.from), toKey = outside(l.to) ? null : ledgerKeyOf(book, l.asset, l.to);
      const anchor = book.ledgers[(fromKey ?? toKey)!], n = base(anchor, l.asset, l.quantity), dp = places(anchor), serial = anchor.tracking === 'serial';
      if (serial) {
        if (!Array.isArray(l.serial_ids)) stop('tracking_mismatch');
        if (!l.serial_ids.length || l.serial_ids.length > 256 || !l.serial_ids.every((s: unknown) => ident(s, 120)) || new Set(l.serial_ids).size !== l.serial_ids.length || BigInt(l.serial_ids.length) * 1000n !== n) stop('serial_conflict');
      } else if (l.serial_ids !== null) stop('tracking_mismatch');
      if (fromKey) {
        const g = book.ledgers[fromKey], s = slot(g, l.from), have = fixed(s.quantity, dp, true), held = l.asset.currency !== null ? 0n : reserved(g, posKey(l.from));
        if (g.balance === 'nonnegative' && have - held < n) stop('insufficient_stock');
        s.quantity = show(have - n, dp);
        if (serial) for (const x of l.serial_ids) { const i = s.serials.indexOf(x); if (i < 0) stop('serial_conflict'); s.serials.splice(i, 1); }
      } else if (serial) for (const x of l.serial_ids) if (Object.values(anchor.positions).some(p => p.serials.includes(x))) stop('serial_conflict');
      if (toKey) { const s = slot(book.ledgers[toKey], l.to); s.quantity = show(fixed(s.quantity, dp, true) + n, dp); if (serial) s.serials.push(...l.serial_ids); }
    }
    for (const r of fact.reservations) {
      const g = book.ledgers[ledgerKeyOf(book, r.asset, r.position)], k = posKey(r.position), n = base(g, r.asset, r.quantity), cur = g.reservations[r.reservation_id];
      if (r.kind === 'reserve') {
        if (cur && cur.position !== k) stop('invalid');
        if (fixed(slot(g, r.position).quantity, 3, true) - reserved(g, k) < n) stop('insufficient_stock');
        g.reservations[r.reservation_id] = { position: k, quantity: show((cur ? fixed(cur.quantity, 3) : 0n) + n, 3), party: cur ? cur.party : r.party };
        continue;
      }
      if (!cur || cur.position !== k || fixed(cur.quantity, 3) < n) stop('insufficient_reservation');
      const left = fixed(cur.quantity, 3) - n; if (left === 0n) delete g.reservations[r.reservation_id]; else g.reservations[r.reservation_id] = { ...cur, quantity: show(left, 3) };
      if (r.kind === 'fulfill') { if (g.tracking === 'serial') stop('tracking_mismatch'); const s = slot(g, r.position), have = fixed(s.quantity, 3, true); if (have < n) stop('insufficient_stock'); s.quantity = show(have - n, 3); }
    }
    for (const k of touched) {
      const g = book.ledgers[k];
      for (const [pk, p] of Object.entries(g.positions)) if (fixed(p.quantity, places(g), true) === 0n && !p.serials.length) delete g.positions[pk];
      g.revision += 1; g.head = digest;
    }
    const s = book.sources[source_id] ??= { high_water: 0, recent: {} };
    s.recent[String(sequence)] = digest; s.high_water = Math.max(s.high_water, sequence);
    for (const k of Object.keys(s.recent)) if (Number(k) <= s.high_water - WINDOW) delete s.recent[k];
    return { outcome: { ok: true, duplicate: false }, book };
  } catch (e) {
    if (e instanceof Stop) return { outcome: { ok: false, code: e.code }, book: state };
    return { outcome: { ok: false, code: 'invalid' }, book: state };
  }
}
/** The inventory@2 view of one product: own positions only, location ids spelled root or minted_by/root. */
export function readProjection(book: Book, product: string) {
  const g = book.ledgers[goodsKey(product)], positions: Record<string, any> = {}, rename: Record<string, string> = {}, reservations: Record<string, any> = {};
  for (const [k, p] of Object.entries(g.positions)) {
    if (p.position.owner !== null) continue;
    const r = p.position.location.ref!, location_id = r.minted_by === null ? r.root : `${r.minted_by}/${r.root}`, nk = readerDigest([p.position.lot_id, location_id, p.position.status]);
    positions[nk] = { position: { lot_id: p.position.lot_id, location_id, status: p.position.status }, quantity: p.quantity, serials: [...p.serials] }; rename[k] = nk;
  }
  for (const [id, r] of Object.entries(g.reservations)) if (rename[r.position]) reservations[id] = { position: rename[r.position], quantity: r.quantity, party: r.party && r.party.minted_by === null ? r.party.root : null };
  return { profile: 'dtp.inventory/2', derived: true, organization_id: book.organization_id, product_id: product, base_unit: { system: 'ucum', code: g.unit }, tracking: g.tracking, revision: g.revision, positions, reservations };
}
