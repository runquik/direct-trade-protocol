// Gap test for the red-team finding on dtp/inventory@2 reservation/fulfillment conservation.
//
// spec/profiles/inventory/2.md, "Payload": a fact's reservation operations are "applied after the moves, atomically
// with them." "Semantics" 3: a reservation is a claim held for a party; `fulfill` "also removes the stock from the
// position (it left for the customer). A serialized product is never fulfilled this way: it ships by a leg naming its
// serials, plus a `release`." The fixture (spec/profiles/inventory/2/fixtures.json, serialized flow, fact index 7)
// spells the mechanism out: "ship one by serial and release the claim in one fact."
//
// Because moves apply before reservations within a fact, and a move from a real position needs `quantity` of
// UNRESERVED stock there ("Semantics" 2), that one-fact mechanism is refused whenever the serials being shipped are
// fully reserved -- which is the normal end state of a reservation, since you reserve exactly what the customer
// ordered. The same-fact `release` that would free the stock only runs after the move has already been refused.
//
// The non-serialized path has no such hole: `fulfill` runs in the reservation phase and atomically clears the claim
// and removes the stock, so fully reserved non-serialized stock ships in one fact. For serialized stock there is no
// `fulfill` (it is refused with tracking_mismatch), so the only way to ship fully reserved serials is to `release`
// them in an earlier, separate fact -- which un-reserves them, exposing them to any competing claim or move before
// the shipment fact lands. The documented atomic reservation -> shipment conversion is therefore unavailable for
// serialized products.
//
// These tests assert the CURRENT (table-divergent) behaviour so CI stays green; the `GAP:` assertions flip when the
// profile gains an atomic serialized reserve->ship path (or the ordering/doc is reconciled).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openInventoryLedger, applyInventoryFact } from "../../src/profiles/inventory2.ts";
import type { InventoryFact, InventoryLedger, ReservationOp, MoveLeg } from "../../src/profiles/inventory2.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PID = "33333333-3333-4333-8333-333333333333";
const ucum = { system: "ucum", code: "{unit}", packaging_id: null, version: null, base_units_per_pack: null } as const;
const qty = (amount: string) => ({ amount, unit: ucum });
const serialPos = (location_id: string) => ({ lot_id: "B1", location_id, status: "available" as const });
const poolPos = (location_id: string) => ({ lot_id: null, location_id, status: "available" as const });
const supplier = { lot_id: null, location_id: "~supplier", status: "available" as const };
const customer = { lot_id: null, location_id: "~customer", status: "available" as const };
const links = { transformation_id: null, order_id: null };

function applier(tracking: "none" | "serial") {
  let ledger = openInventoryLedger(ORG, PID, { base_unit: { system: "ucum", code: "{unit}" }, tracking });
  let seq = 0;
  return (moves: MoveLeg[], reservations: ReservationOp[]) => {
    const fact: InventoryFact = {
      product_id: PID, observation: { source_id: "wms", sequence: ++seq }, occurred_at: "2026-01-01T00:00:00.000Z",
      expected_revision: ledger.revision, moves, reservations,
    };
    const result = applyInventoryFact(ledger, fact);
    if (result.ok) ledger = result.state;
    return { result, ledger: () => ledger };
  };
}

test("GAP: the documented one-fact serialized shipment (leg naming its serials, plus a release) is refused when the serials are fully reserved", () => {
  const apply = applier("serial");
  // Receive exactly one serial; reserve the whole on-hand for a customer.
  assert.equal(apply([{ from: supplier, to: serialPos("floor"), quantity: qty("1"), serial_ids: ["SN-1"], reason: null, links }], []).result.ok, true);
  assert.equal(apply([], [{ kind: "reserve", reservation_id: "r-1", position: serialPos("floor"), quantity: qty("1"), party: null }]).result.ok, true);

  // The documented atomic shipment: a move leg naming the serial, plus a release of the claim, in one fact.
  const ship = apply(
    [{ from: serialPos("floor"), to: customer, quantity: qty("1"), serial_ids: ["SN-1"], reason: null, links }],
    [{ kind: "release", reservation_id: "r-1", position: serialPos("floor"), quantity: qty("1"), party: null }],
  );
  // GAP: the documented, fixture-blessed path is refused because the move's unreserved-stock check runs before the
  // same-fact release. When the gap is closed this becomes { ok: true }.
  assert.equal(ship.result.ok, false, "GAP: documented serialized ship+release of fully reserved stock is refused");
  assert.equal(ship.result.ok === false && ship.result.code, "insufficient_stock");

  // fulfill is not available for serialized stock either, so there is no atomic alternative.
  const fulfill = apply([], [{ kind: "fulfill", reservation_id: "r-1", position: serialPos("floor"), quantity: qty("1"), party: null }]);
  assert.equal(fulfill.result.ok, false);
  assert.equal(fulfill.result.ok === false && fulfill.result.code, "tracking_mismatch");
});

test("the non-serialized equivalent ships fully reserved stock atomically via fulfill (the asymmetry)", () => {
  const apply = applier("none");
  assert.equal(apply([{ from: supplier, to: poolPos("floor"), quantity: qty("1"), serial_ids: null, reason: null, links }], []).result.ok, true);
  assert.equal(apply([], [{ kind: "reserve", reservation_id: "r-1", position: poolPos("floor"), quantity: qty("1"), party: null }]).result.ok, true);
  const fulfill = apply([], [{ kind: "fulfill", reservation_id: "r-1", position: poolPos("floor"), quantity: qty("1"), party: null }]);
  assert.equal(fulfill.result.ok, true, "non-serialized fully reserved stock ships atomically in one fact");
  // The claim and the stock are both gone; the position is dropped as empty.
  assert.equal(Object.keys(fulfill.ledger().reservations).length, 0);
  assert.equal(Object.keys(fulfill.ledger().positions).length, 0);
});

test("GAP: the only serialized workaround (release in a separate earlier fact, then ship) un-reserves the serials first, so the reservation gives no protection at shipment", () => {
  const apply = applier("serial");
  assert.equal(apply([{ from: supplier, to: serialPos("floor"), quantity: qty("1"), serial_ids: ["SN-1"], reason: null, links }], []).result.ok, true);
  assert.equal(apply([], [{ kind: "reserve", reservation_id: "r-1", position: serialPos("floor"), quantity: qty("1"), party: null }]).result.ok, true);

  // Fact A: release the claim (the serial is now unreserved and grabbable by anyone).
  const release = apply([], [{ kind: "release", reservation_id: "r-1", position: serialPos("floor"), quantity: qty("1"), party: null }]);
  assert.equal(release.result.ok, true);
  assert.equal(Object.keys(release.ledger().reservations).length, 0, "GAP: the serials must be unreserved before they can ship");

  // Fact B: anyone could interleave here (e.g. a competing reserve succeeds on the now-unreserved stock), because the
  // reservation that was meant to hold SN-1 for the first party is already gone.
  const interloper = apply([], [{ kind: "reserve", reservation_id: "r-2", position: serialPos("floor"), quantity: qty("1"), party: null }]);
  assert.equal(interloper.result.ok, true, "GAP: a competing claim takes the just-released reserved serial");

  // Fact C: the original shipment now cannot proceed -- the serial it was holding is reserved by someone else.
  const ship = apply(
    [{ from: serialPos("floor"), to: customer, quantity: qty("1"), serial_ids: ["SN-1"], reason: null, links }],
    [],
  );
  assert.equal(ship.result.ok, false);
  assert.equal(ship.result.ok === false && ship.result.code, "insufficient_stock", "GAP: the reserved serial was lost to the interloper between release and ship");
});
