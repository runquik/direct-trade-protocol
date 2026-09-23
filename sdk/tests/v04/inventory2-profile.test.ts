import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, member, person, policy, record } from "./helpers.ts";
import { digest } from "../../src/v04/wire.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { PRODUCT_SCHEMA, PRODUCT_SEMANTICS } from "../../src/profiles/product.ts";
import type { ProductBody } from "../../src/profiles/product.ts";
import { INVENTORY2_PROFILE, INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS } from "../../src/profiles/inventory2.ts";
import type { InventoryFact, InventoryLedger } from "../../src/profiles/inventory2.ts";

const fixtures = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/inventory/2/fixtures.json", import.meta.url)), "utf8")) as {
  flows: { product_id: string; product: ProductBody; facts: { why: string; fact: InventoryFact; expect: { ok: boolean; duplicate?: boolean; code?: string } }[]; final: InventoryLedger }[] };
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });
/** The host keys the ledger on this company and this product record, so fact digests differ from the fixture's; compare everything else exactly. */
const comparable = (ledger: InventoryLedger, org: string, product_id: string) => ({ ...ledger, organization_id: org, product_id, sources: Object.fromEntries(Object.entries(ledger.sources).map(([k, v]) => [k, { high_water: v.high_water, recent: Object.keys(v.recent).sort() }])) });

/** A company with the two profiles published under its own id, a product written, and its ledger opened. */
async function setup(store: { audience: string }, flow = fixtures.flows[0]) {
  const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
  const publish = async (name: string, version: string, schema: unknown, semantics: string) => {
    const contract = { publisher_id: org, name, version, schema: structuredClone(schema), semantics, dependencies: [] }, hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
    await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] }); return hash;
  };
  const productProfile = await publish("product", "1.0.0", PRODUCT_SCHEMA, PRODUCT_SEMANTICS), stockProfile = await publish("inventory", "2.0.0", INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS);
  const pol = await policy(client, owner, org, [grant(owner)]);
  const productRecord = record(org, pol, crypto.randomUUID(), productProfile, flow.product); await client.ok(owner, "record.append", org, productRecord);
  const product_id = productRecord.root_id;
  // Fixture facts name a fixed product id; the host keys the ledger on the record root, so rewrite them.
  const facts = flow.facts.map(f => ({ ...f, fact: { ...structuredClone(f.fact), product_id: f.fact.product_id === flow.product_id ? product_id : f.fact.product_id } }));
  return { client, owner, org, pol, productProfile, stockProfile, product_id, productRecord, facts, final: { ...structuredClone(flow.final), product_id } };
}

test("inventory-v2 in the reference host: a ledger opens from the product head, every fixture fact reaches its expected outcome, retries are idempotent, and the ledger reads back exactly", async () => {
  const store = await createDtpStore(); try {
    const f = await setup(store), { client, owner, org, pol, stockProfile, product_id } = f;
    assert.equal((await client.act(owner, "record.append", org, record(org, pol, product_id, stockProfile, f.facts[0].fact))).error.code, "ledger_unavailable", "facts need an opened ledger");
    assert.equal((await client.act(owner, "inventory.open", org, { policy_id: pol, product_id: crypto.randomUUID() })).status, 404, "a ledger anchors on an existing product");
    const opened = await client.ok(owner, "inventory.open", org, { policy_id: pol, product_id }); assert.deepEqual(opened, { product_id, revision: 0 });
    assert.equal((await client.act(owner, "inventory.open", org, { policy_id: pol, product_id })).status, 409, "a second opening of the same ledger conflicts");
    const wrongResource = await client.act(owner, "record.append", org, record(org, pol, crypto.randomUUID(), stockProfile, f.facts[0].fact));
    assert.equal(wrongResource.error.code, "forbidden", "the fact's product must be the authorized resource");
    const receipts: Record<number, { id: string; seq: number }> = {};
    for (const [i, step] of f.facts.entries()) {
      const response = await client.act(owner, "record.append", org, record(org, pol, product_id, stockProfile, step.fact));
      if (step.expect.ok && !step.expect.duplicate) { assert.equal(response.status, 200, `${step.why}: ${JSON.stringify(response.error)}`); receipts[i] = response.result; }
      else if (step.expect.ok) { assert.equal(response.status, 200, step.why); assert.equal(response.result.duplicate, true, step.why); assert.equal(response.result.id, receipts[1].id, "the duplicate acknowledges the original record"); }
      else if (step.expect.code === "wrong_scope") { assert.equal(response.status, 403, step.why); assert.equal(response.error.code, "forbidden", "the host refuses a fact for another product before the reducer sees it"); }
      else { assert.ok([409, 422].includes(response.status), `${step.why}: ${response.status}`); assert.equal(response.error.code, step.expect.code, step.why); }
    }
    const ledger = await client.ok(owner, "inventory.ledger", org, { policy_id: pol, product_id });
    assert.deepEqual(comparable(ledger, org, product_id), { ...comparable(f.final, org, product_id), policy_id: pol });
    const listed = await client.ok(owner, "records.list", org, page([`${org}/inventory@2`]));
    assert.equal(listed.records.length, f.facts.filter(s => s.expect.ok && !s.expect.duplicate).length, "one record per accepted fact, none for duplicates or refusals");
    assert.deepEqual(listed.records[0].validation, { profile: INVENTORY2_PROFILE, revision: 1, physical_stock_verified: false });
    // Retrying an accepted fact with a fresh request id is still the same observation: the original receipt, no new record.
    const again = await client.ok(owner, "record.append", org, record(org, pol, product_id, stockProfile, f.facts[0].fact));
    assert.deepEqual(again, { ...receipts[0], duplicate: true });
    // A pack conversion the product never published is refused before the reducer sees it.
    const forged = structuredClone(f.facts[0].fact); forged.observation = { source_id: "wms", sequence: 500 }; forged.expected_revision = ledger.revision; forged.moves[0].quantity.unit = { system: "packaging", code: null, packaging_id: "case-12", version: "1", base_units_per_pack: "13" };
    const pinned = await client.act(owner, "record.append", org, record(org, pol, product_id, stockProfile, forged)); assert.equal(pinned.error.code, "unknown_packaging");
    // A member without a grant on the product resource neither reads the ledger nor opens one.
    const staff = await person(client); await member(client, owner, org, staff);
    assert.equal((await client.act(staff, "inventory.ledger", org, { policy_id: pol, product_id })).status, 404);
    assert.equal((await client.act(staff, "inventory.open", org, { policy_id: pol, product_id })).status, 403);
  } finally { await store.close(); }
});

test("inventory-v2 serialized flow in the reference host, and a superseded product keeps its ledger", async () => {
  const store = await createDtpStore(); try {
    const f = await setup(store, fixtures.flows[1]), { client, owner, org, pol, stockProfile, product_id, productProfile } = f;
    await client.ok(owner, "inventory.open", org, { policy_id: pol, product_id });
    for (const step of f.facts) {
      const response = await client.act(owner, "record.append", org, record(org, pol, product_id, stockProfile, step.fact));
      if (step.expect.ok) assert.equal(response.status, 200, `${step.why}: ${JSON.stringify(response.error)}`); else assert.equal(response.error.code, step.expect.code, step.why);
    }
    assert.deepEqual(comparable(await client.ok(owner, "inventory.ledger", org, { policy_id: pol, product_id }), org, product_id), { ...comparable(f.final, org, product_id), policy_id: pol });
    // The product is revised (a new name); base unit and tracking are immutable, so the ledger is untouched and still writable.
    const revised = { ...record(org, pol, f.productRecord.resource_id, productProfile, { ...fixtures.flows[1].product, names: [{ name: "Fermenter FX-2 (2027)", language: "en" }] }), root_id: product_id, supersedes: f.productRecord.id };
    await client.ok(owner, "record.append", org, revised);
    assert.equal((await client.ok(owner, "inventory.ledger", org, { policy_id: pol, product_id })).revision, f.final.revision);
  } finally { await store.close(); }
});
