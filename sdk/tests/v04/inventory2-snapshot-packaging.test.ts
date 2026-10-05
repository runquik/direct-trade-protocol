// Regression for #59. dtp/inventory@2 (spec/profiles/inventory/2.md, "Semantics"): "A host additionally verifies
// that every packaging unit in a fact is a revision the product published (unknown_packaging) ... and replays every
// fact on snapshot import, which must reproduce the ledger exactly."
//
// The live write path refused an unpublished pack conversion, but snapshot import replayed inventory-v2 facts through
// the reducer alone, which trusts the wire `base_units_per_pack`. A signed fact no live host would accept was admitted
// on import and inflated the rebuilt ledger. Import now applies the same rule, against the product revision that was
// head when the fact was recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import type { Context, State } from "../../src/v04/model.ts";
import { emptyState } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { draftCommand, signCommand, personId, organizationId, digest } from "../../src/v04/wire.ts";
import { buildSnapshot, applySnapshot } from "../../src/v04/snapshot.ts";
import { applyInventoryFact } from "../../src/profiles/inventory2.ts";
import { INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS, INVENTORY2_PROFILE } from "../../src/profiles/inventory2.ts";
import { PRODUCT_SCHEMA, PRODUCT_SEMANTICS } from "../../src/profiles/product.ts";
import { inventoryKey } from "../../src/profiles/inventory.ts";

const PK = "PK-CASE";
const pack = (version: string, bupp: string) => ({ system: "packaging", code: null, packaging_id: PK, version, base_units_per_pack: bupp });
const dock = { lot_id: "LOT-A", location_id: "DOCK", status: "available" } as const;
const supplier = { lot_id: null, location_id: "~supplier", status: "available" } as const;
function fact(product_id: string, sequence: number, expected_revision: number, quantity: any) {
  return {
    product_id, observation: { source_id: "wms-1", sequence }, occurred_at: "2026-09-10T10:00:00.000Z", expected_revision,
    moves: [{ from: supplier, to: dock, quantity, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null } }],
    reservations: [],
  };
}
const revision = (version: string, bupp: string) => ({ packaging_id: PK, version, name: `Case v${version}`, base_units_per_pack: bupp, gtin: null });
const productBody = (packaging: any[]) => ({
  names: [{ name: "Widget", language: null }], description: null, brand: null, category: null, identifiers: [],
  base_unit: { system: "ucum", code: "{unit}" }, packaging, tracking: "lot", shelf_life_days: null, replaces: null, status: "active",
});

/** A source host with one product (PK v1 = 6.000) and an open ledger holding one legitimate 2-case receipt. */
async function source() {
  const key = await generateKeyPair();
  const owner = { id: await personId(key.keyId), key };
  const ctx: Context = { audience: "https://source.test", storeKey: await generateKeyPair(), pins: {}, now: Date.parse("2026-09-10T12:00:00.000Z") };
  const s: State = emptyState();
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
  const productId = crypto.randomUUID();
  const append = (id: string, root_id: string, supersedes: string | null, profile_digest: string, body: any) =>
    call("record.append", org, { id, root_id, supersedes, organization_id: org, policy_id: policy, resource_id: productId, profile_digest, counterparty_ids: [], body });
  await append(productId, productId, null, productProfile, productBody([revision("1", "6.000")]));
  await call("inventory.open", org, { policy_id: policy, product_id: productId });
  const legitId = crypto.randomUUID();
  await append(legitId, legitId, null, invProfile, fact(productId, 1, 0, { amount: "2.000", unit: pack("1", "6.000") }));
  /** Records a signed fact as a host that skipped unknown_packaging would: the reducer alone admits it. */
  const inject = async (body: any) => {
    const id = crypto.randomUUID();
    const command = await signCommand(draftCommand(ctx.audience, owner, "record.append", org, {
      id, root_id: id, supersedes: null, organization_id: org, policy_id: policy, resource_id: productId, profile_digest: invProfile, counterparty_ids: [], body,
    }, ++ctx.now), [owner.key]);
    const company = s.inventory[org], change = applyInventoryFact(company.ledgers[productId], body);
    assert.ok(change.ok, "the reducer alone admits the fact");
    company.ledgers[productId] = { ...change.state, policy_id: policy };
    company.facts[inventoryKey(productId, body.observation.source_id, body.observation.sequence)] = { hash: await digest(body), record_id: id, policy_id: policy, profile_digest: invProfile };
    s.records[id] = {
      id, root_id: id, supersedes: null, organization_id: org, policy_id: policy, resource_id: productId, profile_digest: invProfile,
      counterparty_ids: [], body, command, seq: s.next_seq++, is_head: true, accepted_at: new Date(ctx.now).toISOString(),
      validation: { profile: INVENTORY2_PROFILE, revision: change.state.revision, physical_stock_verified: false },
    };
  };
  return { s, ctx, org, productId, productProfile, invProfile, append, inject };
}
const refusal = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e?.code ?? "error"; } };
const total = (s: State, org: string, productId: string) =>
  (Object.values(s.inventory[org].ledgers[productId].positions) as { quantity: string }[]).reduce((n, p) => n + Number(p.quantity), 0);

test("#59: snapshot import refuses an inventory@2 fact whose pack conversion the product never published", async () => {
  const src = await source();
  const bogus = fact(src.productId, 2, 1, { amount: "1.000", unit: pack("1", "600000.000") });
  const probe = crypto.randomUUID();
  assert.equal(await refusal(src.append(probe, probe, null, src.invProfile, bogus)), "unknown_packaging", "the live path refuses it");
  await src.inject(bogus);
  assert.equal(await refusal(applySnapshot(emptyState(), buildSnapshot(src.s, src.org, src.ctx))), "invalid_snapshot", "import refuses what a live host refuses");
});

test("#59: import checks packaging against the product revision that was head when the fact was recorded", async () => {
  // A fact pins PK v2 before any product revision published it; a later revision adds v2. The final head lists v2,
  // but no live host would have accepted the fact when it was recorded, so import refuses it.
  const src = await source();
  await src.inject(fact(src.productId, 2, 1, { amount: "1.000", unit: pack("2", "12.000") }));
  const next = crypto.randomUUID();
  await src.append(next, src.productId, src.productId, src.productProfile, productBody([revision("1", "6.000"), revision("2", "12.000")]));
  assert.equal(await refusal(applySnapshot(emptyState(), buildSnapshot(src.s, src.org, src.ctx))), "invalid_snapshot");
});

test("#59: import admits facts that pin revisions the product had published, and reproduces the ledger", async () => {
  const src = await source();
  const next = crypto.randomUUID();
  await src.append(next, src.productId, src.productId, src.productProfile, productBody([revision("1", "6.000"), revision("2", "12.000")]));
  const later = crypto.randomUUID();
  await src.append(later, later, null, src.invProfile, fact(src.productId, 2, 1, { amount: "1.000", unit: pack("2", "12.000") }));
  const dest = emptyState();
  await applySnapshot(dest, buildSnapshot(src.s, src.org, src.ctx));
  assert.equal(total(dest, src.org, src.productId), 24);
  assert.deepEqual(dest.inventory[src.org].ledgers[src.productId], src.s.inventory[src.org].ledgers[src.productId]);
});
