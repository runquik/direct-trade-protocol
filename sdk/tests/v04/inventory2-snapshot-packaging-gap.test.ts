// GAP probe (red team): a passing test here reproduces a deficiency; it does not certify readiness.
//
// dtp/inventory@2 (spec/profiles/inventory/2.md, "Semantics") promises:
//   "A host additionally verifies that every packaging unit in a fact is a revision the product
//    published (unknown_packaging) ... and replays every fact on snapshot import, which must
//    reproduce the ledger exactly."
//
// The reference enforces unknown_packaging on the LIVE write path (engine.ts, the packagingPins
// loop) but NOT on the snapshot-import path (snapshot.ts replays inventory-v2 facts through
// applyInventoryFact only, which trusts the wire `base_units_per_pack`). Every other business-fact
// profile (product/order/forecast/party) re-runs its full host checks on import; inventory-v2 does
// not. So a signed fact whose packaging conversion the product never published is REFUSED by a live
// host yet ACCEPTED on import, and the rebuilt ledger holds stock no conforming host would create.
//
// This test asserts the CURRENT (wrong) behaviour so CI stays green and the gap stays visible. A
// conforming import must reject the fact (unknown_packaging / invalid_snapshot); when that is fixed
// the "import accepts" assertion below flips, which is the signal the gap is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import type { Context } from "../../src/v04/model.ts";
import { emptyState } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { draftCommand, signCommand, personId, organizationId, digest } from "../../src/v04/wire.ts";
import { buildSnapshot, applySnapshot } from "../../src/v04/snapshot.ts";
import { applyInventoryFact } from "../../src/profiles/inventory2.ts";
import { INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS, INVENTORY2_PROFILE } from "../../src/profiles/inventory2.ts";
import { PRODUCT_SCHEMA, PRODUCT_SEMANTICS } from "../../src/profiles/product.ts";
import { inventoryKey } from "../../src/profiles/inventory.ts";

const PK = "PK-CASE", PKV = "1";
const pack = (bupp: string) => ({ system: "packaging", code: null, packaging_id: PK, version: PKV, base_units_per_pack: bupp });
const dock = { lot_id: "LOT-A", location_id: "DOCK", status: "available" } as const;
const supplier = { lot_id: null, location_id: "~supplier", status: "available" } as const;
function fact(product_id: string, sequence: number, expected_revision: number, quantity: any) {
  return {
    product_id, observation: { source_id: "wms-1", sequence }, occurred_at: "2026-09-10T10:00:00.000Z", expected_revision,
    moves: [{ from: supplier, to: dock, quantity, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null } }],
    reservations: [],
  };
}

test("GAP: snapshot import of inventory@2 skips the unknown_packaging check the live write path enforces", async () => {
  const key = await generateKeyPair();
  const owner = { id: await personId(key.keyId), key };
  const ctx: Context = { audience: "https://source.test", storeKey: await generateKeyPair(), pins: {}, now: Date.parse("2026-09-10T12:00:00.000Z") };
  const s = emptyState();
  const call = async (action: string, org: string | null, payload: any) => {
    ctx.now += 1;
    return execute(s, await signCommand(draftCommand(ctx.audience, owner, action, org, payload, ctx.now), [owner.key]), ctx);
  };

  await call("person.register", null, { keys: [key.keyId] });
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await call("organization.create", org, { name: "Synthetic Test Co", nonce, controllers: [owner.id], threshold: 1 });
  const policy = crypto.randomUUID(), expiry = new Date(ctx.now + 3600000).toISOString();
  await call("policy.create", org, {
    policy_id: policy, expected_revision: 0, classification: "business", stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ["read", "write", "export"], resource_ids: "*", expires_at: expiry }],
  });
  const publish = async (name: string, schema: any, semantics: string) => {
    const contract = { publisher_id: org, name, version: "1.0.0", schema, semantics, dependencies: [] }, h = await digest(contract);
    await call("profile.publish", org, { name, version: "1.0.0", schema, semantics, dependencies: [], visibility: "private", readers: [], digest: h });
    return h;
  };
  const productProfile = await publish("product", PRODUCT_SCHEMA, PRODUCT_SEMANTICS);
  const invProfile = await publish("inventory2", INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS);

  // A product whose only published packaging revision is PK v1 = 6.000 base units per pack.
  const productId = crypto.randomUUID();
  const productBody = {
    names: [{ name: "Widget", language: null }], description: null, brand: null, category: null, identifiers: [],
    base_unit: { system: "ucum", code: "{unit}" },
    packaging: [{ packaging_id: PK, version: PKV, name: "Case of 6", base_units_per_pack: "6.000", gtin: null }],
    tracking: "lot", shelf_life_days: null, replaces: null, status: "active",
  };
  await call("record.append", org, {
    id: productId, root_id: productId, supersedes: null, organization_id: org, policy_id: policy,
    resource_id: productId, profile_digest: productProfile, counterparty_ids: [], body: productBody,
  });
  await call("inventory.open", org, { policy_id: policy, product_id: productId });

  // A legitimate fact: receive 2 published cases = 12 base units. The live host accepts it.
  const legitId = crypto.randomUUID();
  await call("record.append", org, {
    id: legitId, root_id: legitId, supersedes: null, organization_id: org, policy_id: policy,
    resource_id: productId, profile_digest: invProfile, counterparty_ids: [], body: fact(productId, 1, 0, { amount: "2.000", unit: pack("6.000") }),
  });

  // The attack fact: same packaging id/version, a base_units_per_pack the product never published.
  const bogus = fact(productId, 2, 1, { amount: "1.000", unit: pack("600000.000") });

  // (1) The documented live guarantee: a conforming host refuses it with unknown_packaging.
  let liveCode: string | null = null;
  const probeId = crypto.randomUUID();
  try {
    await call("record.append", org, {
      id: probeId, root_id: probeId, supersedes: null, organization_id: org, policy_id: policy,
      resource_id: productId, profile_digest: invProfile, counterparty_ids: [], body: bogus,
    });
  } catch (e: any) { liveCode = e?.code ?? null; }
  assert.equal(liveCode, "unknown_packaging", "live write path must refuse an unpublished packaging conversion");

  // (2) The attacker assembles a snapshot that contains the bogus fact. Its record.append command is
  // signed by a legitimate org actor; it simply was never accepted by a conforming live host. We
  // record it into source state exactly as the host would, MINUS the unknown_packaging check that
  // the import path (snapshot.ts) also omits. The reducer alone — all the import path relies on —
  // accepts it, so the exported ledger is internally self-consistent and buildSnapshot emits it.
  const bogusId = crypto.randomUUID();
  const bogusCmd = await signCommand(draftCommand(ctx.audience, owner, "record.append", org, {
    id: bogusId, root_id: bogusId, supersedes: null, organization_id: org, policy_id: policy,
    resource_id: productId, profile_digest: invProfile, counterparty_ids: [], body: bogus,
  }, ++ctx.now), [owner.key]);
  const company = s.inventory[org];
  const change = applyInventoryFact(company.ledgers[productId], bogus);
  assert.ok(change.ok, "the reducer the import path relies on accepts the bogus packaging conversion");
  company.ledgers[productId] = { ...change.state, policy_id: policy };
  company.facts[inventoryKey(productId, bogus.observation.source_id, bogus.observation.sequence)] =
    { hash: await digest(bogus), record_id: bogusId, policy_id: policy, profile_digest: invProfile };
  s.records[bogusId] = {
    id: bogusId, root_id: bogusId, supersedes: null, organization_id: org, policy_id: policy, resource_id: productId,
    profile_digest: invProfile, counterparty_ids: [], body: bogus, command: bogusCmd, seq: s.next_seq++, is_head: true,
    accepted_at: new Date(ctx.now).toISOString(),
    validation: { profile: INVENTORY2_PROFILE, revision: change.state.revision, physical_stock_verified: false },
  };

  const snap = buildSnapshot(s, org, ctx);

  // (3) A fresh host imports it. A conforming import MUST reject the unpublished conversion. Today it
  // does not: the import succeeds and the rebuilt ledger holds 12 legitimate + 600000 phantom units.
  const dest = emptyState();
  let imported = false;
  try { await applySnapshot(dest, snap); imported = true; } catch { imported = false; }

  assert.equal(imported, true, "GAP: snapshot import accepts a packaging conversion no live host would accept");
  const total = (Object.values(dest.inventory[org].ledgers[productId].positions) as { quantity: string }[])
    .reduce((n, p) => n + Number(p.quantity), 0);
  assert.equal(total, 600012, "GAP: imported ledger is inflated by a packaging revision the product never published");
});
