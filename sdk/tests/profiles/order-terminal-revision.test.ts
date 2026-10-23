// dtp/order@1 revisions that keep the status (#76; replaces gap test #77). The transition table lists every revision
// an order may take: a same-status revision only while placed, acknowledged or partially_fulfilled, and none at all
// once rejected, cancelled or closed. The reference reducer and the separately coded interop reader agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrderContinuity, ORDER_STATUSES, ORDER_TRANSITIONS, type OrderBody } from '../../src/profiles/order.ts';
import { readOrderContinuity } from '../interop/order-reader.ts';

const base: OrderBody = {
  buyer: { self: true, party_id: null, revision: null },
  seller: { self: false, party_id: '77777777-7777-4777-8777-777777777777', revision: null },
  placed_at: '2026-09-23T09:15:00.000Z',
  currency: 'USD',
  external: [{ scheme: 'buyer.po', value: 'PO-4471' }],
  lines: [{
    line_id: '1',
    product: { product_id: null, revision: null, description: 'widget' },
    quantity: { amount: '10', unit: { system: 'ucum', code: 'kg', packaging_id: null, version: null, base_units_per_pack: null } },
    price: null, requested: null, links: { contract_id: null },
  }],
  status: 'placed',
  terms: { payment_net_days: null, incoterm: null },
  replaces: null,
};
const withStatus = (status: OrderBody['status']): OrderBody => ({ ...base, status });
const SAME_STATUS_ALLOWED = ['placed', 'acknowledged', 'partially_fulfilled'];

test('order@1: a same-status revision is allowed exactly where the table lists it, in both implementations', () => {
  assert.deepEqual(ORDER_STATUSES.filter(s => ORDER_TRANSITIONS[s].includes(s)), SAME_STATUS_ALLOWED);
  for (const status of ORDER_STATUSES) {
    const allowed = SAME_STATUS_ALLOWED.includes(status);
    assert.equal(checkOrderContinuity(withStatus(status), withStatus(status)).length === 0, allowed, `reference: ${status} -> ${status}`);
    assert.equal(readOrderContinuity(withStatus(status), withStatus(status)).length === 0, allowed, `reader: ${status} -> ${status}`);
  }
});

test('order@1: a terminal order takes no revision, not even one that only adds an external identifier', () => {
  for (const terminal of ['rejected', 'cancelled', 'closed'] as const) {
    assert.deepEqual(ORDER_TRANSITIONS[terminal], []);
    const previous = withStatus(terminal), next: OrderBody = { ...previous, external: [...previous.external, { scheme: 'archive.ref', value: 'ARCH-9' }] };
    assert.deepEqual(checkOrderContinuity(previous, next), [{ path: '$.status', message: `no transition from ${terminal} to ${terminal}` }]);
    assert.deepEqual(readOrderContinuity(previous, next).map(i => i.path), ['$.status']);
  }
});

test('order@1: an acknowledged order may still add the seller\'s identifier without a change of status', () => {
  const previous = withStatus('acknowledged'), next: OrderBody = { ...previous, external: [...previous.external, { scheme: 'seller.so', value: 'SO-9' }] };
  assert.deepEqual(checkOrderContinuity(previous, next), []);
  assert.deepEqual(readOrderContinuity(previous, next), []);
});
