// Builds spec/profiles/forecast/1/profile.json and fixtures.json from the reference rules. Deterministic; `--check` compares.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { digest } from '../src/v04/wire.ts';
import { checkSchema, profileContract, validateShape } from '../src/v04/profiles.ts';
import { FORECAST_KIND, FORECAST_PROFILE, FORECAST_SCHEMA, FORECAST_SEMANTICS, checkForecastContinuity, validateForecast } from '../src/profiles/forecast.ts';
import type { ForecastBody } from '../src/profiles/forecast.ts';

const contract = profileContract({ publisher_id: 'dtp', name: 'forecast', version: '1.0.0', schema: structuredClone(FORECAST_SCHEMA) as Record<string, any>, semantics: FORECAST_SEMANTICS, dependencies: [] });
checkSchema(contract.schema);
const clone = <V>(v: V): V => structuredClone(v);
const PRODUCT = '22222222-2222-4222-8222-222222222222', PARTY = '77777777-7777-4777-8777-777777777777';
const jar = { system: 'ucum' as const, code: '{jar}', packaging_id: null, version: null, base_units_per_pack: null };
const base: ForecastBody = {
  subject: { product_id: PRODUCT, description: null }, party_id: PARTY, direction: 'demand', horizon: { start: '2026-10-01', end: '2026-12-31' },
  as_of: '2026-09-23T06:00:00.000Z', method: 'trailing 12-week average, seasonal', quantity: { amount: '14400', unit: jar }, confidence: 60, scenario: 'base', status: 'draft',
};
const change = (edit: (b: ForecastBody) => void, from: ForecastBody = base): ForecastBody => { const b = clone(from); edit(b); return b; };
type Case = [string, unknown];
const accept: Case[] = [
  ['a demand forecast for a product and a customer over a quarter, from a stated method, with a confidence and a scenario', base],
  ['a supply forecast with no party, by description, zero quantity, no confidence, no scenario', { subject: { product_id: null, description: 'Glass jars 680 ml' }, party_id: null, direction: 'supply', horizon: { start: '2026-10-01', end: '2026-10-08' }, as_of: '2026-09-23T06:00:00.000Z', method: 'supplier statement', quantity: { amount: '0', unit: jar }, confidence: null, scenario: null, status: 'published' }],
  ['a withdrawn forecast', change(b => { b.status = 'withdrawn'; })],
];
const reject: Case[] = [
  ['a subject with neither product nor description', change(b => { b.subject = { product_id: null, description: null }; })],
  ['a direction outside demand and supply', change(b => { (b as any).direction = 'plan'; })],
  ['a horizon that does not end after it starts', change(b => { b.horizon = { start: '2026-10-01', end: '2026-10-01' }; })],
  ['an as-of that is not a UTC instant', change(b => { b.as_of = '2026-09-23'; })],
  ['no method', change(b => { b.method = ''; })],
  ['a negative quantity', change(b => { b.quantity.amount = '-1'; })],
  ['a confidence above one hundred', change(b => { b.confidence = 101; })],
  ['an unknown status', change(b => { (b as any).status = 'placed'; })],
  ['a member an order would have: nothing here commits anyone', change(b => { (b as any).buyer = { self: true }; })],
  ['a missing member', (() => { const { method: _, ...rest } = clone(base); return rest; })()],
];
type Pair = [string, ForecastBody, ForecastBody];
const continuityAccept: Pair[] = [
  ['re-forecast: a later as-of, a new figure and confidence', base, change(b => { b.as_of = '2026-09-30T06:00:00.000Z'; b.quantity.amount = '15100'; b.confidence = 70; })],
  ['published from draft', base, change(b => { b.status = 'published'; })],
  ['withdrawn from published', change(b => { b.status = 'published'; }), change(b => { b.status = 'withdrawn'; })],
];
const continuityReject: Pair[] = [
  ['a changed subject: a different forecast', base, change(b => { b.subject = { product_id: null, description: 'something else' }; })],
  ['a changed horizon', base, change(b => { b.horizon.end = '2027-03-31'; })],
  ['a changed party', base, change(b => { b.party_id = null; })],
  ['a changed direction', base, change(b => { b.direction = 'supply'; })],
  ['an as-of earlier than what it revises', base, change(b => { b.as_of = '2026-09-01T06:00:00.000Z'; })],
  ['published back to draft', change(b => { b.status = 'published'; }), base],
  ['withdrawn back to published', change(b => { b.status = 'withdrawn'; }), change(b => { b.status = 'published'; })],
];
for (const [why, body] of accept) { if (!validateShape(contract.schema, body)) throw new Error(`generator: dialect refuses "${why}"`); const i = validateForecast(body); if (i.length) throw new Error(`generator: refused "${why}": ${i[0].message} at ${i[0].path}`); }
for (const [why, body] of reject) if (validateForecast(body).length === 0) throw new Error(`generator: accepted "${why}"`);
for (const [why, a, b] of continuityAccept) { const i = checkForecastContinuity(a, b); if (i.length) throw new Error(`generator: continuity refused "${why}": ${i[0].message}`); }
for (const [why, a, b] of continuityReject) if (checkForecastContinuity(a, b).length === 0) throw new Error(`generator: continuity accepted "${why}"`);
const out = {
  description: 'dtp/forecast@1 fixtures. A conforming validator MUST accept every body under "accept" and refuse every body under "reject"; given a previous and a next revision of one forecast it MUST accept every pair under "continuity.accept" and refuse every pair under "continuity.reject". A forecast commits nobody to anything; a forecast or a plan is never an order.',
  kind: FORECAST_KIND, profile: FORECAST_PROFILE, semantics: FORECAST_SEMANTICS, contract_digest: await digest(contract),
  accept: accept.map(([why, body]) => ({ why, body })), reject: reject.map(([why, body]) => ({ why, body })),
  continuity: { accept: continuityAccept.map(([why, previous, next]) => ({ why, previous, next })), reject: continuityReject.map(([why, previous, next]) => ({ why, previous, next })) },
};
const dir = new URL('../../spec/profiles/forecast/1/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [target, text] of [[new URL('profile.json', dir), JSON.stringify(contract, null, 2) + '\n'], [new URL('fixtures.json', dir), JSON.stringify(out, null, 2) + '\n']] as [URL, string][]) {
  if (!process.argv.includes('--check')) writeFileSync(target, text);
  else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error(`${target.pathname} is stale; rerun this script without --check`); process.exit(1); }
}
console.log('forecast@1:', out.contract_digest, accept.length, 'accept,', reject.length, 'reject,', continuityAccept.length + continuityReject.length, 'continuity cases');
