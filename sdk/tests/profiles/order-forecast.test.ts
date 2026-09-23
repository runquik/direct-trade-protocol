import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { ORDER_KIND, ORDER_PROFILE, ORDER_SCHEMA, ORDER_SEMANTICS, ORDER_TRANSITIONS, checkOrderContinuity, checkOrderGenesis, validateOrder } from '../../src/profiles/order.ts';
import type { OrderBody } from '../../src/profiles/order.ts';
import { FORECAST_KIND, FORECAST_PROFILE, FORECAST_SCHEMA, FORECAST_SEMANTICS, checkForecastContinuity, validateForecast } from '../../src/profiles/forecast.ts';
import type { ForecastBody } from '../../src/profiles/forecast.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const load = (p: string) => parseUntrustedJson(readFileSync(here(p), 'utf8')) as any;
const order = load('../../../spec/profiles/order/1/fixtures.json'), orderContract = load('../../../spec/profiles/order/1/profile.json');
const forecast = load('../../../spec/profiles/forecast/1/fixtures.json'), forecastContract = load('../../../spec/profiles/forecast/1/profile.json');

test('order@1 fixtures: bodies, genesis statuses and continuity pairs are judged exactly; the contract and generator are reproducible', () => {
  assert.equal(order.kind, ORDER_KIND); assert.equal(order.profile, ORDER_PROFILE); assert.equal(order.semantics, ORDER_SEMANTICS);
  assert.ok(order.accept.length >= 5 && order.reject.length >= 22 && order.continuity.accept.length >= 7 && order.continuity.reject.length >= 11);
  checkSchema(orderContract.schema);
  for (const v of order.accept) { assert.ok(validateShape(orderContract.schema, v.body), v.why); assert.deepEqual(validateOrder(v.body), [], v.why); }
  for (const v of order.reject) assert.ok(validateOrder(v.body).length > 0, v.why);
  for (const v of order.genesis.accept) assert.deepEqual(checkOrderGenesis(v.body), [], v.why);
  for (const v of order.genesis.reject) assert.ok(checkOrderGenesis(v.body).length > 0, v.why);
  for (const v of order.continuity.accept) assert.deepEqual(checkOrderContinuity(v.previous, v.next), [], v.why);
  for (const v of order.continuity.reject) assert.ok(checkOrderContinuity(v.previous, v.next).length > 0, v.why);
  // Every transition in the table is exercised by an accepted pair, and terminal states have no exits.
  const exercised = new Set(order.continuity.accept.map((v: any) => `${v.previous.status}>${v.next.status}`).filter((t: string) => !t.startsWith('placed>placed')));
  for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) for (const to of tos) if (to !== from) assert.ok(exercised.has(`${from}>${to}`), `${from} -> ${to} is exercised`);
  for (const terminal of ['rejected', 'cancelled', 'closed']) assert.deepEqual(ORDER_TRANSITIONS[terminal], []);
  assert.deepEqual(orderContract, { publisher_id: 'dtp', name: 'order', version: '1.0.0', schema: ORDER_SCHEMA, semantics: ORDER_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(orderContract), 'utf8').digest('hex'), order.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-order-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 }); assert.equal(run.status, 0, run.stderr);
});

test('forecast@1 fixtures: bodies and continuity pairs are judged exactly, an order-shaped member is refused, and the contract and generator are reproducible', () => {
  assert.equal(forecast.kind, FORECAST_KIND); assert.equal(forecast.profile, FORECAST_PROFILE); assert.equal(forecast.semantics, FORECAST_SEMANTICS);
  assert.ok(forecast.accept.length >= 3 && forecast.reject.length >= 10 && forecast.continuity.accept.length >= 3 && forecast.continuity.reject.length >= 7);
  checkSchema(forecastContract.schema);
  for (const v of forecast.accept) { assert.ok(validateShape(forecastContract.schema, v.body), v.why); assert.deepEqual(validateForecast(v.body), [], v.why); }
  for (const v of forecast.reject) assert.ok(validateForecast(v.body).length > 0, v.why);
  for (const v of forecast.continuity.accept) assert.deepEqual(checkForecastContinuity(v.previous, v.next), [], v.why);
  for (const v of forecast.continuity.reject) assert.ok(checkForecastContinuity(v.previous, v.next).length > 0, v.why);
  // A forecast body can never be mistaken for an order: no field of an order exists in it.
  const base = forecast.accept[0].body as ForecastBody;
  for (const field of ['buyer', 'seller', 'lines', 'price', 'placed_at']) assert.ok(validateForecast({ ...base, [field]: null }).length > 0, field);
  const placed = order.accept[0].body as OrderBody; assert.ok(validateForecast(placed).length > 0 && validateOrder(base).length > 0, 'neither profile accepts the other\'s body');
  assert.deepEqual(forecastContract, { publisher_id: 'dtp', name: 'forecast', version: '1.0.0', schema: FORECAST_SCHEMA, semantics: FORECAST_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(forecastContract), 'utf8').digest('hex'), forecast.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-forecast-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 }); assert.equal(run.status, 0, run.stderr);
});
