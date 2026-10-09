// Gap test for the order-v1 state-machine. dtp/order@1 (spec/profiles/order/1.md, "Semantics"):
// the status "follows the table below", whose rows are the ONLY listed moves. The table marks
// `rejected`, `cancelled` and `closed` as terminal -- "nothing" in the "To" column -- and lists a
// same-status self-loop for exactly one state, `partially_fulfilled`. An honest implementer building a
// validator from that table rejects every un-listed move, including a revision that keeps a terminal
// order in its terminal status.
//
// The reference reducer (src/profiles/order.ts) checks the table only when the status CHANGES:
//
//     if (previous.status !== next.status && !(ORDER_TRANSITIONS[previous.status] ?? []).includes(next.status)) ...
//
// so every same-status supersession passes regardless of the table -- including `closed -> closed`,
// `cancelled -> cancelled` and `rejected -> rejected`, which the table calls terminal. The reference
// host wires this reducer verbatim for every order supersession (src/v04/engine.ts: checkOrderContinuity
// on `record.append`, and snapshot.ts re-checks the same rule on import), so the reference accepts a new,
// committed revision of a terminal order (e.g. one that only adds an external identifier). A stricter host
// built from the table refuses that same signed record, so the two hosts' heads diverge and a snapshot
// that carries such a revision is refused on import (invalid_order / invalid_snapshot).
//
// This test PINS the current, table-divergent behaviour so CI stays green and the gap stays visible.
// It is a gap observation, not a fix, and no fix is proposed here. When the reducer is tightened to honour
// the table (self-loops allowed only where a row lists them), the assertions marked GAP below flip and
// this test is updated to the corrected expectation. See the red-team finding linked from the issue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrderContinuity, ORDER_TRANSITIONS, ORDER_STATUSES, type OrderBody } from "../../src/profiles/order.ts";

const base: OrderBody = {
  buyer: { self: true, party_id: null, revision: null },
  seller: { self: false, party_id: "77777777-7777-4777-8777-777777777777", revision: null },
  placed_at: "2026-09-23T09:15:00.000Z",
  currency: "USD",
  external: [{ scheme: "buyer.po", value: "PO-4471" }],
  lines: [{
    line_id: "1",
    product: { product_id: null, revision: null, description: "widget" },
    quantity: { amount: "10", unit: { system: "ucum", code: "kg", packaging_id: null, version: null, base_units_per_pack: null } },
    price: null, requested: null, links: { contract_id: null },
  }],
  status: "placed",
  terms: { payment_net_days: null, incoterm: null },
  replaces: null,
};
const withStatus = (status: OrderBody["status"]): OrderBody => ({ ...base, status });

// Which statuses the transition table lists a same-status self-loop for. Only partially_fulfilled.
const SELF_LOOP_IN_TABLE = new Set(ORDER_STATUSES.filter(s => (ORDER_TRANSITIONS[s] ?? []).includes(s)));

test("order-v1: the transition table lists a self-loop only for partially_fulfilled", () => {
  assert.deepEqual([...SELF_LOOP_IN_TABLE].sort(), ["partially_fulfilled"]);
  // The three terminal states carry no outgoing transition at all ("nothing" in the table).
  for (const terminal of ["rejected", "cancelled", "closed"] as const) assert.deepEqual(ORDER_TRANSITIONS[terminal], []);
});

test("GAP: the reducer accepts a same-status revision for every status, even where the table lists none", () => {
  for (const status of ORDER_STATUSES) {
    const issues = checkOrderContinuity(withStatus(status), withStatus(status));
    // GAP: current behaviour accepts the self-loop even when the table does not list one for `status`.
    // When the reducer is fixed to honour the table, the `!SELF_LOOP_IN_TABLE.has(status)` cases flip to a
    // `no transition from <status> to <status>` issue and this expectation becomes `.has(status)`.
    assert.equal(issues.length, 0, `self-loop ${status} -> ${status} is currently accepted`);
    if (!SELF_LOOP_IN_TABLE.has(status)) {
      // Documented divergence: the table does not list this self-loop, yet the reducer accepts it.
      assert.ok(true, `table lists no ${status} -> ${status} self-loop, but the reducer accepts it (gap)`);
    }
  }
});

test("GAP: a terminal (closed) order can be superseded by a revision that only adds an external identifier", () => {
  const closed = withStatus("closed");
  const closedPlusExternal: OrderBody = { ...closed, external: [...closed.external, { scheme: "archive.ref", value: "ARCH-9" }] };
  const issues = checkOrderContinuity(closed, closedPlusExternal);
  // GAP: the table calls `closed` terminal ("nothing"), yet the reference reducer accepts this revision.
  // A host built strictly from the table refuses the same signed record, so heads diverge across hosts and a
  // snapshot carrying it is refused on import. When the gap is closed this asserts a `$.status` issue instead.
  assert.equal(issues.length, 0, "terminal order currently accepts a same-status revision");
});
