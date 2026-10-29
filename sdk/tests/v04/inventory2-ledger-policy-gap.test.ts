// Expected-observation test: a passing GAP assertion reproduces a deficiency (red-team finding #130).
// When the gap is closed, the GAP assertions fail and this file is replaced by the fix's own tests.
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
import { INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS } from "../../src/profiles/inventory2.ts";
import type { InventoryFact } from "../../src/profiles/inventory2.ts";

const fixtures = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/inventory/2/fixtures.json", import.meta.url)), "utf8")) as {
  flows: { product_id: string; product: ProductBody; facts: { fact: InventoryFact; expect: { ok: boolean } }[] }[] };

test("GAP: a member who may only read a product opens the company's one stock ledger for it under a policy they steward, locking the product's own compartment out", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const publish = async (name: string, version: string, schema: unknown, semantics: string) => {
      const contract = { publisher_id: org, name, version, schema: structuredClone(schema), semantics, dependencies: [] }, hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
      await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] }); return hash;
    };
    const productProfile = await publish("product", "1.0.0", PRODUCT_SCHEMA, PRODUCT_SEMANTICS), stockProfile = await publish("inventory", "2.0.0", INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS);
    // A delegated admin who may create policies, and who is given read-only access to the operations compartment's product.
    const clerk = await person(client); await member(client, owner, org, clerk, ["policies.create"]);
    const productResource = crypto.randomUUID();
    const ops = await policy(client, owner, org, [grant(owner), grant(clerk, [productResource], ["read"])]);
    const productRecord = record(org, ops, productResource, productProfile, fixtures.flows[0].product); await client.ok(owner, "record.append", org, productRecord);
    const product_id = productRecord.root_id;
    const fact = { ...structuredClone(fixtures.flows[0].facts[0].fact), product_id }; assert.ok(fixtures.flows[0].facts[0].expect.ok);

    // Control: the clerk's grant on the product is read-only. It cannot revise the product, nor open its ledger in the product's own policy.
    assert.ok(await client.ok(clerk, "record.get", org, { id: productRecord.id, profile_digest: productProfile }));
    assert.equal((await client.act(clerk, "inventory.open", org, { policy_id: ops, product_id })).error.code, "forbidden");

    // The clerk creates a policy it alone stewards and opens the product's ledger there.
    const side = await policy(client, clerk, org, [grant(clerk)]);
    const opened = await client.act(clerk, "inventory.open", org, { policy_id: side, product_id });
    assert.equal(opened.status, 200, "GAP: read on the product plus write in any policy the opener chooses opens the product's stock ledger");

    // The ledger is a singleton per product: the operations compartment can no longer open it, and its facts are refused.
    const reopen = await client.act(owner, "inventory.open", org, { policy_id: ops, product_id });
    assert.equal(reopen.status, 409, "GAP: the product's own compartment cannot open the product's ledger");
    const opsFact = await client.act(owner, "record.append", org, record(org, ops, product_id, stockProfile, fact));
    assert.equal(opsFact.error.code, "forbidden", "GAP: a stock fact under the product's own policy is refused");
    assert.match(opsFact.error.message, /another policy/);
    assert.equal((await client.act(owner, "inventory.ledger", org, { policy_id: ops, product_id })).status, 404, "GAP: the product's compartment cannot read the product's stock");

    // The read-only clerk now writes the product's stock, and the company controller, holding every grant on the product, cannot read it.
    const clerkFact = await client.act(clerk, "record.append", org, record(org, side, product_id, stockProfile, fact));
    assert.equal(clerkFact.status, 200, "GAP: a member with read-only access to the product records its stock movements");
    assert.equal((await client.act(owner, "inventory.ledger", org, { policy_id: side, product_id })).status, 404, "GAP: the controller cannot read the product's stock");

    // Offboarding the clerk leaves the side policy with no active steward, so nobody can be granted the ledger again: it is stranded.
    await client.ok(owner, "membership.revoke", org, { person_id: clerk.id });
    const regrant = await client.act(owner, "policy.update", org, { policy_id: side, expected_revision: 1, classification: "business", stewards: [owner.id], threshold: 1, grants: [grant(owner)] });
    assert.equal(regrant.status, 403, "GAP: no one can take over the policy that holds the product's ledger");
    const stranded = await client.act(owner, "record.append", org, record(org, side, product_id, stockProfile, { ...fact, observation: { ...fact.observation, sequence: fact.observation.sequence + 1 }, expected_revision: 1 }));
    assert.equal(stranded.error.code, "forbidden", "GAP: the product's stock can no longer be written by anyone");
    assert.equal((await client.act(owner, "inventory.open", org, { policy_id: ops, product_id })).status, 409, "GAP: and the ledger still cannot be reopened");
  } finally { await store.close(); }
});
