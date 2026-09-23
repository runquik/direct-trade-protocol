/** dtp/forecast@1: a projection of demand or supply. It commits nobody to anything: a forecast or a plan is never an
 * order, and this kind exists so that projections have a home other than dtp/order@1. Portable, dependency-free.
 * Profile document and fixtures: spec/profiles/forecast/1.md, spec/profiles/forecast/1/. */
import { canonicalize } from '../canonical.ts';
import { parseDecimal } from './decimal.ts';
import { isInstant, isLocalDate } from './order.ts';
import type { WireUnit } from './inventory2.ts';

export const FORECAST_PROFILE = 'dtp.forecast/1';
export const FORECAST_KIND = 'dtp/forecast@1';
export const FORECAST_SEMANTICS = 'forecast-v1';
export const FORECAST_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export type ForecastBody = {
  subject: { product_id: string | null; description: string | null }; party_id: string | null; direction: 'demand' | 'supply';
  horizon: { start: string; end: string }; as_of: string; method: string; quantity: { amount: string; unit: WireUnit };
  confidence: number | null; scenario: string | null; status: typeof FORECAST_STATUSES[number];
};
export type ForecastIssue = { path: string; message: string };
const unit = { type: 'object', additionalProperties: false, required: ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'], properties: { system: { type: 'string', maxLength: 9, enum: ['ucum', 'packaging'] }, code: { type: 'string', maxLength: 32, nullable: true }, packaging_id: { type: 'string', maxLength: 80, nullable: true }, version: { type: 'string', maxLength: 40, nullable: true }, base_units_per_pack: { type: 'string', maxLength: 24, nullable: true } } };
export const FORECAST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['subject', 'party_id', 'direction', 'horizon', 'as_of', 'method', 'quantity', 'confidence', 'scenario', 'status'],
  properties: {
    subject: { type: 'object', additionalProperties: false, required: ['product_id', 'description'], properties: { product_id: { type: 'string', maxLength: 36, nullable: true }, description: { type: 'string', maxLength: 500, nullable: true } } },
    party_id: { type: 'string', maxLength: 36, nullable: true }, direction: { type: 'string', maxLength: 6, enum: ['demand', 'supply'] },
    horizon: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'string', maxLength: 10 }, end: { type: 'string', maxLength: 10 } } },
    as_of: { type: 'string', maxLength: 24 }, method: { type: 'string', maxLength: 120 },
    quantity: { type: 'object', additionalProperties: false, required: ['amount', 'unit'], properties: { amount: { type: 'string', maxLength: 24 }, unit } },
    confidence: { type: 'integer', minimum: 0, maximum: 100, nullable: true }, scenario: { type: 'string', maxLength: 120, nullable: true },
    status: { type: 'string', maxLength: 9, enum: [...FORECAST_STATUSES] },
  },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, UCUM = /^[!-~]{1,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuidOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
export function validateForecast(body: unknown): ForecastIssue[] {
  const issues: ForecastIssue[] = [], fail = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(body) || !exact(body, [...FORECAST_SCHEMA.required])) return [{ path: '$', message: 'exact forecast fields required' }];
  const b = body as unknown as ForecastBody, s = b.subject;
  if (!isObject(s) || !exact(s, ['product_id', 'description']) || !uuidOrNull(s.product_id) || (s.description !== null && !text(s.description, 500))) fail('$.subject', 'product root and description, each or null, required');
  else if (s.product_id === null && s.description === null) fail('$.subject', 'a product root or a description is required');
  if (!uuidOrNull(b.party_id)) fail('$.party_id', 'party root or null required');
  if (!['demand', 'supply'].includes(b.direction)) fail('$.direction', 'demand or supply required');
  if (!isObject(b.horizon) || !exact(b.horizon, ['start', 'end']) || !isLocalDate(b.horizon.start) || !isLocalDate(b.horizon.end)) fail('$.horizon', 'start and end dates required');
  else if (b.horizon.start >= b.horizon.end) fail('$.horizon', 'horizon must end after it starts');
  if (!isInstant(b.as_of)) fail('$.as_of', 'UTC millisecond instant required');
  if (!text(b.method, 120)) fail('$.method', 'the method that produced the figure is required');
  if (!isObject(b.quantity) || !exact(b.quantity, ['amount', 'unit'])) fail('$.quantity', 'amount and unit required');
  else {
    try { if (parseDecimal(b.quantity.amount, 3) < 0n) fail('$.quantity.amount', 'nonnegative quantity required'); } catch { fail('$.quantity.amount', 'three-place decimal required'); }
    const u = b.quantity.unit as unknown as Record<string, unknown>;
    if (!isObject(u) || !exact(u, ['system', 'code', 'packaging_id', 'version', 'base_units_per_pack'])) fail('$.quantity.unit', 'exact unit fields required');
    else if (u.system === 'ucum') { if (!(typeof u.code === 'string' && UCUM.test(u.code)) || u.packaging_id !== null || u.version !== null || u.base_units_per_pack !== null) fail('$.quantity.unit', 'ucum unit carries a code and no packaging'); }
    else if (u.system !== 'packaging' || u.code !== null || !text(u.packaging_id, 80) || !text(u.version, 40)) fail('$.quantity.unit', 'packaging unit needs packaging_id and version');
    else { try { if (parseDecimal(u.base_units_per_pack, 3) <= 0n) fail('$.quantity.unit', 'positive pack conversion required'); } catch { fail('$.quantity.unit', 'three-place pack conversion required'); } }
  }
  if (b.confidence !== null && !(Number.isSafeInteger(b.confidence) && b.confidence >= 0 && b.confidence <= 100)) fail('$.confidence', '0-100 or null required');
  if (b.scenario !== null && !text(b.scenario, 120)) fail('$.scenario', 'bounded scenario or null required');
  if (!(FORECAST_STATUSES as readonly string[]).includes(b.status)) fail('$.status', 'draft, published or withdrawn required');
  return issues;
}
/** Revisions re-forecast the same thing: subject, party, direction and horizon are immutable, `as_of` never goes
 *  back, and status moves draft -> published -> withdrawn only. A different subject or horizon is a new forecast. */
export function checkForecastContinuity(previous: ForecastBody, next: ForecastBody): ForecastIssue[] {
  const issues: ForecastIssue[] = [], same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
  for (const key of ['subject', 'party_id', 'direction', 'horizon'] as const) if (!same(previous[key], next[key])) issues.push({ path: `$.${key}`, message: `${key} is immutable; a different one is a new forecast` });
  if (next.as_of < previous.as_of) issues.push({ path: '$.as_of', message: 'a revision is never older than what it revises' });
  const order = FORECAST_STATUSES.indexOf(previous.status), after = FORECAST_STATUSES.indexOf(next.status);
  if (after < order) issues.push({ path: '$.status', message: `no transition from ${previous.status} to ${next.status}` });
  return issues;
}
