// Deliberately separate implementation of dtp/forecast@1, written from spec/profiles/forecast/1.md and its fixtures.
// Do not import the SDK validator, decimal helpers or canonicalizer here. Same author: separately coded agreement.
import { readerCanonical } from './product-reader.ts';
import { dateValid, instantValid, unitIssue } from './order-reader.ts';

export type Issue = { path: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const uuidOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
const STATUSES = ['draft', 'published', 'withdrawn'];

export function readForecast(body: unknown): Issue[] {
  const out: Issue[] = [], bad = (path: string, message: string) => out.push({ path, message });
  if (!plain(body) || !keysAre(body, ['subject', 'party_id', 'direction', 'horizon', 'as_of', 'method', 'quantity', 'confidence', 'scenario', 'status'])) return [{ path: '$', message: 'exact fields' }];
  const b = body, s = b.subject;
  if (!plain(s) || !keysAre(s, ['product_id', 'description']) || !uuidOrNull(s.product_id) || (s.description !== null && !bounded(s.description, 500))) bad('$.subject', 'subject');
  else if (s.product_id === null && s.description === null) bad('$.subject', 'root or description');
  if (!uuidOrNull(b.party_id)) bad('$.party_id', 'party');
  if (!['demand', 'supply'].includes(b.direction)) bad('$.direction', 'direction');
  if (!plain(b.horizon) || !keysAre(b.horizon, ['start', 'end']) || !dateValid(b.horizon.start) || !dateValid(b.horizon.end)) bad('$.horizon', 'horizon');
  else if (b.horizon.start >= b.horizon.end) bad('$.horizon', 'order of dates');
  if (!instantValid(b.as_of)) bad('$.as_of', 'instant');
  if (!bounded(b.method, 120)) bad('$.method', 'method');
  if (!plain(b.quantity) || !keysAre(b.quantity, ['amount', 'unit'])) bad('$.quantity', 'quantity');
  else { if (!(typeof b.quantity.amount === 'string' && /^\d{1,18}(\.\d{1,3})?$/.test(b.quantity.amount))) bad('$.quantity.amount', 'amount'); if (unitIssue(b.quantity.unit)) bad('$.quantity.unit', 'unit'); }
  if (b.confidence !== null && !(Number.isSafeInteger(b.confidence) && b.confidence >= 0 && b.confidence <= 100)) bad('$.confidence', 'confidence');
  if (b.scenario !== null && !bounded(b.scenario, 120)) bad('$.scenario', 'scenario');
  if (!STATUSES.includes(b.status)) bad('$.status', 'status');
  return out;
}
export function readForecastContinuity(previous: any, next: any): Issue[] {
  const out: Issue[] = [], same = (a: unknown, b: unknown) => readerCanonical(a) === readerCanonical(b);
  for (const k of ['subject', 'party_id', 'direction', 'horizon']) if (!same(previous[k], next[k])) out.push({ path: `$.${k}`, message: 'immutable' });
  if (next.as_of < previous.as_of) out.push({ path: '$.as_of', message: 'backwards' });
  if (STATUSES.indexOf(next.status) < STATUSES.indexOf(previous.status)) out.push({ path: '$.status', message: 'transition' });
  return out;
}
