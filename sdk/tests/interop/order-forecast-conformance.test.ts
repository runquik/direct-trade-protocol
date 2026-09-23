import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkOrderContinuity, checkOrderGenesis, validateOrder } from '../../src/profiles/order.ts';
import { checkForecastContinuity, validateForecast } from '../../src/profiles/forecast.ts';
import { readerDigest } from './product-reader.ts';
import { readOrder, readOrderContinuity, readOrderGenesis } from './order-reader.ts';
import { readForecast, readForecastContinuity } from './forecast-reader.ts';

const load = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const order = load('../../../spec/profiles/order/1/fixtures.json'), orderContract = load('../../../spec/profiles/order/1/profile.json');
const forecast = load('../../../spec/profiles/forecast/1/fixtures.json'), forecastContract = load('../../../spec/profiles/forecast/1/profile.json');
const paths = (issues: { path: string }[]) => issues.map(i => i.path);

test('second implementation of order@1: bodies, genesis and continuity judged exactly, blaming the same fields as the reference', () => {
  assert.equal(readerDigest(orderContract), order.contract_digest);
  for (const v of order.accept) assert.deepEqual(readOrder(v.body), [], v.why);
  for (const v of order.reject) { const mine = readOrder(v.body); assert.ok(mine.length > 0, v.why); assert.deepEqual(new Set(paths(mine)), new Set(paths(validateOrder(v.body))), v.why); }
  for (const v of order.genesis.accept) assert.deepEqual(readOrderGenesis(v.body), [], v.why);
  for (const v of order.genesis.reject) assert.deepEqual(paths(readOrderGenesis(v.body)), paths(checkOrderGenesis(v.body)), v.why);
  for (const v of order.continuity.accept) assert.deepEqual(readOrderContinuity(v.previous, v.next), [], v.why);
  for (const v of order.continuity.reject) { const mine = readOrderContinuity(v.previous, v.next); assert.ok(mine.length > 0, v.why); assert.deepEqual(paths(mine), paths(checkOrderContinuity(v.previous, v.next)), v.why); }
});

test('second implementation of forecast@1: bodies and continuity judged exactly, blaming the same fields as the reference', () => {
  assert.equal(readerDigest(forecastContract), forecast.contract_digest);
  for (const v of forecast.accept) assert.deepEqual(readForecast(v.body), [], v.why);
  for (const v of forecast.reject) { const mine = readForecast(v.body); assert.ok(mine.length > 0, v.why); assert.deepEqual(new Set(paths(mine)), new Set(paths(validateForecast(v.body))), v.why); }
  for (const v of forecast.continuity.accept) assert.deepEqual(readForecastContinuity(v.previous, v.next), [], v.why);
  for (const v of forecast.continuity.reject) { const mine = readForecastContinuity(v.previous, v.next); assert.ok(mine.length > 0, v.why); assert.deepEqual(paths(mine), paths(checkForecastContinuity(v.previous, v.next)), v.why); }
});
