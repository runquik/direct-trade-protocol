import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyFlowFact, openFlowBook, openGoodsLedger, openMoneyLedger } from '../../src/profiles/flow.ts';
import type { FlowBook } from '../../src/profiles/flow.ts';
import { readerDigest } from './product-reader.ts';
import { openBook, readFlowFact, readProjection } from './flow-reader.ts';

const load = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const fixtures = load('../../../spec/profiles/flow/1/fixtures.json'), contract = load('../../../spec/profiles/flow/1/profile.json');

test('second implementation of flow@1: the reader reaches every expected outcome, agrees with the reference after every fact, ends at the exact final book and projects the same inventory@2 view', () => {
  assert.equal(readerDigest(contract), fixtures.contract_digest);
  for (const flow of fixtures.flows) {
    let mine = openBook(fixtures.organization_id, flow.book_id, flow.openings);
    let reference: FlowBook = openFlowBook(fixtures.organization_id, flow.book_id);
    for (const o of flow.openings) reference = o.kind === 'goods' ? openGoodsLedger(reference, o.product_id, o.product) : openMoneyLedger(reference, o.currency, o.account, o.balance);
    assert.deepEqual(mine, reference, `${flow.why}: opened books agree`);
    for (const step of flow.facts) {
      const read = readFlowFact(mine, structuredClone(step.fact)); assert.deepEqual(read.outcome, step.expect, step.why);
      const ref = applyFlowFact(reference, structuredClone(step.fact)); if (ref.ok) reference = ref.state;
      mine = read.book; assert.deepEqual(mine, reference, `${step.why}: books agree after the fact`);
    }
    assert.deepEqual(mine, flow.final, `${flow.why}: final book`);
    if (flow.bridge) assert.deepEqual(readProjection(mine, flow.bridge.product_id), flow.bridge.projection, `${flow.why}: projection`);
  }
});
