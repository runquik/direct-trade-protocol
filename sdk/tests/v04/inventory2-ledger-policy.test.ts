// #130: an inventory@2 ledger opens only under its product's own policy, and the opener must hold write on the product
// there. Replaces gap test #131, whose read-only member opened the company's one ledger for a product under a policy
// they chose and locked the product's own compartment out. Snapshot import's half of the rule is pinned by the
// `ledger-opened-under-other-policy` case of spec/vectors/snapshot-import.json.
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

test("a product's stock ledger opens only under the product's own policy; a read-only member cannot take it, and a mismatch is refused before the 409", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const publish = async (name: string, version: string, schema: unknown, semantics: string) => {
      const contract = { publisher_id: org, name, version, schema: structuredClone(schema), semantics, dependencies: [] }, hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
      await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] }); return hash;
    };
    const productProfile = await publish("product", "1.0.0", PRODUCT_SCHEMA, PRODUCT_SEMANTICS), stockProfile = await publish("inventory", "2.0.0", INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS);
    const clerk = await person(client); await member(client, owner, org, clerk, ["policies.create"]);
    const productResource = crypto.randomUUID();
    const ops = await policy(client, owner, org, [grant(owner), grant(clerk, [productResource], ["read"])]);
    const productRecord = record(org, ops, productResource, productProfile, fixtures.flows[0].product); await client.ok(owner, "record.append", org, productRecord);
    const product_id = productRecord.root_id;
    const fact = { ...structuredClone(fixtures.flows[0].facts[0].fact), product_id }; assert.ok(fixtures.flows[0].facts[0].expect.ok);

    // The clerk may read the product record but holds nothing on the ledger's resource (the product root) in the
    // product's policy, so it cannot open the ledger there; SPEC section 4 (#89) answers that as an absent policy, 404.
    assert.ok(await client.ok(clerk, "record.get", org, { id: productRecord.id, profile_digest: productProfile }));
    assert.equal((await client.act(clerk, "inventory.open", org, { policy_id: ops, product_id })).error.code, "not_found");

    // Nor under a policy it stewards and can write: the ledger is not the opener's to place.
    const side = await policy(client, clerk, org, [grant(clerk)]);
    const squat = await client.act(clerk, "inventory.open", org, { policy_id: side, product_id });
    assert.equal(squat.status, 403); assert.equal(squat.error.code, "forbidden"); assert.match(squat.error.message, /product's policy/);

    // The controller is held to the same rule, and nothing has been opened.
    const other = await policy(client, owner, org, [grant(owner)]);
    assert.equal((await client.act(owner, "inventory.open", org, { policy_id: other, product_id })).error.code, "forbidden");

    // The product's own compartment opens it, writes its stock and reads it.
    assert.deepEqual(await client.ok(owner, "inventory.open", org, { policy_id: ops, product_id }), { product_id, revision: 0 });
    assert.equal((await client.act(owner, "record.append", org, record(org, ops, product_id, stockProfile, fact))).status, 200);
    assert.equal((await client.act(owner, "inventory.ledger", org, { policy_id: ops, product_id })).status, 200);

    // Once it exists, a mismatched opening is still refused forbidden, not 409, so the refusal does not reveal the ledger.
    const late = await client.act(owner, "inventory.open", org, { policy_id: other, product_id });
    assert.equal(late.status, 403); assert.equal(late.error.code, "forbidden");
    assert.equal((await client.act(owner, "inventory.open", org, { policy_id: ops, product_id })).status, 409, "a second opening in the right policy conflicts");
  } finally { await store.close(); }
});
