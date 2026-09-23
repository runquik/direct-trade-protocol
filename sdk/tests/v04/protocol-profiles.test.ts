import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore, loadProtocolProfiles } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, member, person, policy, record } from "./helpers.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { PRODUCT_PROFILE } from "../../src/profiles/product.ts";
import { INVENTORY2_PROFILE } from "../../src/profiles/inventory2.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const productFixtures = load("../../../spec/profiles/product/1/fixtures.json"), inventoryFixtures = load("../../../spec/profiles/inventory/2/fixtures.json");
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

test("protocol profiles: a host loads the registry and the registered contracts, a company admits them, and protocol kinds then select records written under them", async () => {
  const protocol = await loadProtocolProfiles();
  assert.deepEqual(Object.keys(protocol.kinds).sort(), ["dtp/inventory@2", "dtp/product@1"]);
  assert.deepEqual(Object.keys(protocol.protocolProfiles).sort(), [productFixtures.contract_digest, inventoryFixtures.contract_digest].sort(), "every registered digest has its contract beside the document");
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const health = await (await fetch(store.audience + "/dtp/v0.4/health")).json();
    assert.deepEqual(health.capabilities.protocol_kinds, ["dtp/inventory@2", "dtp/product@1"], "the repository registry is the default");
    // Registered but not yet admitted at this host: the kind selects nothing.
    assert.equal((await client.act(owner, "records.list", org, page(["dtp/product@1"]))).error.code, "unsupported_profile");
    const admitted = await client.ok(owner, "profile.admit", org, { digest: productFixtures.contract_digest });
    assert.deepEqual(admitted, { id: "dtp/product@1.0.0", digest: productFixtures.contract_digest, admitted: true });
    assert.equal((await client.ok(owner, "profile.admit", org, { digest: productFixtures.contract_digest })).admitted, false, "admitting again is idempotent");
    assert.equal((await client.act(owner, "profile.admit", org, { digest: "f".repeat(64) })).status, 404, "a contract the host does not carry");
    const got = await client.ok(owner, "profile.get", org, { digest: productFixtures.contract_digest });
    assert.deepEqual([got.publisher_id, got.id, got.visibility, got.readers, got.semantics, got.command.action], ["dtp", "dtp/product@1.0.0", "community", [], "product-v1", "profile.admit"]);
    // A member without the publishing permission cannot admit.
    const staff = await person(client); await member(client, owner, org, staff);
    assert.equal((await client.act(staff, "profile.admit", org, { digest: inventoryFixtures.contract_digest })).status, 403);
    await client.ok(owner, "profile.admit", org, { digest: inventoryFixtures.contract_digest });
    // Products written under the protocol contract, selected by the protocol kind; a ledger opened on one of them.
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    const productRecord = record(org, pol, resource, productFixtures.contract_digest, inventoryFixtures.flows[0].product);
    await client.ok(owner, "record.append", org, productRecord);
    const products = await client.ok(owner, "records.list", org, page(["dtp/product@1"]));
    assert.deepEqual(products.profile_digests, [productFixtures.contract_digest]); assert.equal(products.records.length, 1);
    assert.deepEqual(products.records[0].validation, { profile: PRODUCT_PROFILE, level: "business-rules", business_verified: false });
    await client.ok(owner, "inventory.open", org, { policy_id: pol, product_id: productRecord.root_id });
    const fact = { ...structuredClone(inventoryFixtures.flows[0].facts[0].fact), product_id: productRecord.root_id };
    const receipt = await client.ok(owner, "record.append", org, record(org, pol, productRecord.root_id, inventoryFixtures.contract_digest, fact));
    const stock = await client.ok(owner, "records.list", org, page(["dtp/inventory@2"]));
    assert.deepEqual(stock.records.map((r: any) => r.id), [receipt.id]); assert.equal(stock.records[0].validation.profile, INVENTORY2_PROFILE);
    // A second company on the same host finds the contract already admitted and uses it without publishing anything.
    const other = await person(client), elsewhere = await company(client, other, "Elsewhere Co");
    assert.equal((await client.ok(other, "profile.admit", elsewhere, { digest: productFixtures.contract_digest })).admitted, false);
    const theirs = await policy(client, other, elsewhere, [grant(other)]);
    await client.ok(other, "record.append", elsewhere, record(elsewhere, theirs, crypto.randomUUID(), productFixtures.contract_digest, productFixtures.accept[1].body));
    assert.equal((await client.ok(other, "records.list", elsewhere, page(["dtp/product@1"]))).records.length, 1);
  } finally { await store.close(); }
});

test("protocol profiles: a host started without the contracts refuses admission, and a registered digest whose contract differs is refused", async () => {
  const protocol = await loadProtocolProfiles();
  const store = await createDtpStore({ kinds: protocol.kinds, protocolProfiles: {} }); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    assert.equal((await client.act(owner, "profile.admit", org, { digest: productFixtures.contract_digest })).status, 404);
  } finally { await store.close(); }
  const tampered = structuredClone(protocol.protocolProfiles); tampered[productFixtures.contract_digest] = { ...tampered[productFixtures.contract_digest], version: "1.0.1" };
  const store2 = await createDtpStore({ kinds: protocol.kinds, protocolProfiles: tampered }); try {
    const client = new Client(store2.audience), owner = await person(client), org = await company(client, owner);
    const response = await client.act(owner, "profile.admit", org, { digest: productFixtures.contract_digest });
    assert.equal(response.status, 422); assert.equal(response.error.code, "digest_mismatch");
  } finally { await store2.close(); }
  const unregistered = await createDtpStore({ kinds: {}, protocolProfiles: protocol.protocolProfiles }); try {
    const client = new Client(unregistered.audience), owner = await person(client), org = await company(client, owner);
    assert.equal((await client.act(owner, "profile.admit", org, { digest: productFixtures.contract_digest })).error.code, "unsupported_profile", "a contract the registry does not list");
  } finally { await unregistered.close(); }
});
