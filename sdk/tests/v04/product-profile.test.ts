import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, record } from "./helpers.ts";
import { digest } from "../../src/v04/wire.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { PRODUCT_PROFILE, PRODUCT_SCHEMA, PRODUCT_SEMANTICS } from "../../src/profiles/product.ts";
import type { ProductBody } from "../../src/profiles/product.ts";

const fixtures = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/product/1/fixtures.json", import.meta.url)), "utf8")) as { accept: { why: string; body: ProductBody }[]; reject: { why: string; body: unknown }[]; continuity: { accept: { why: string; previous: ProductBody; next: ProductBody }[]; reject: { why: string; previous: ProductBody; next: ProductBody }[] } };
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

test("product-v1 in the reference host: a company publishes the product kind, writes products, and revisions obey continuity whatever its own schema says", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    // The company's own copy of the contract, under its own id. Until the kind is registered, this is how a host carries it.
    const contract = { publisher_id: org, name: "product", version: "1.0.0", schema: structuredClone(PRODUCT_SCHEMA), semantics: PRODUCT_SEMANTICS, dependencies: [] };
    const hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
    await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] });
    const health = await (await fetch(store.audience + "/dtp/v0.4/health")).json(); assert.ok(health.capabilities.semantics.includes(PRODUCT_SEMANTICS));
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    // Every fixture body the validator accepts is accepted by the host, and carries the profile's validation projection.
    const roots: string[] = [];
    for (const v of fixtures.accept) { const r = record(org, pol, resource, hash, v.body); const receipt = await client.ok(owner, "record.append", org, r); roots.push(receipt.id); }
    const listed = await client.ok(owner, "records.list", org, page([`${org}/product@1`]));
    assert.equal(listed.records.length, fixtures.accept.length);
    assert.deepEqual(listed.records[0].validation, { profile: PRODUCT_PROFILE, level: "business-rules", business_verified: false });
    // Every rejected fixture body is refused: by the dialect schema where shape alone decides (invalid_body), otherwise by the profile's rules (invalid_product).
    const codes = new Set<string>();
    for (const v of fixtures.reject) {
      const response = await client.act(owner, "record.append", org, record(org, pol, resource, hash, v.body));
      assert.ok([400, 422].includes(response.status), v.why); if (response.status === 422) { assert.ok(["invalid_body", "invalid_product"].includes(response.error.code), v.why); codes.add(response.error.code); }
    }
    assert.ok(codes.has("invalid_product") && codes.has("invalid_body"), "fixtures exercise both the shape and the rules");
    // Revisions: continuity pairs from the fixtures, applied as supersessions of a fresh root each.
    for (const v of fixtures.continuity.accept) {
      const first = record(org, pol, resource, hash, v.previous); await client.ok(owner, "record.append", org, first);
      await client.ok(owner, "record.append", org, { ...record(org, pol, resource, hash, v.next), root_id: first.id, supersedes: first.id });
    }
    for (const v of fixtures.continuity.reject) {
      const first = record(org, pol, resource, hash, v.previous); await client.ok(owner, "record.append", org, first);
      const response = await client.act(owner, "record.append", org, { ...record(org, pol, resource, hash, v.next), root_id: first.id, supersedes: first.id });
      assert.equal(response.status, 422, v.why); assert.equal(response.error.code, "invalid_product", v.why);
    }
    // A publisher cannot loosen the rules by publishing a looser schema under the same semantics.
    const looseContract = { publisher_id: org, name: "product-loose", version: "1.0.0", schema: { type: "object", properties: { names: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } } }, required: [], additionalProperties: false }, semantics: PRODUCT_SEMANTICS, dependencies: [] };
    const looseHash = await digest(looseContract); const { publisher_id: __, ...loosePayload } = looseContract;
    await client.ok(owner, "profile.publish", org, { ...loosePayload, digest: looseHash, visibility: "private", readers: [] });
    const under = await client.act(owner, "record.append", org, record(org, pol, resource, looseHash, { names: ["Sauce"] }));
    assert.equal(under.status, 422); assert.equal(under.error.code, "invalid_product");
  } finally { await store.close(); }
});

test("nullable in the dialect: accepted on non-null nodes, refused elsewhere, and null passes only where declared", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const publish = async (schema: any) => { const contract = { publisher_id: org, name: "n-" + crypto.randomUUID(), version: "1.0.0", schema, semantics: "structural", dependencies: [] }; const hash = await digest(contract); const { publisher_id: _, ...payload } = contract; return client.act(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] }); };
    const ok = await publish({ type: "object", properties: { note: { type: "string", maxLength: 10, nullable: true } }, required: ["note"], additionalProperties: false }); assert.equal(ok.status, 200);
    assert.equal((await publish({ type: "object", properties: { note: { type: "string", maxLength: 10, nullable: false } }, required: ["note"], additionalProperties: false })).status, 400, "only true is meaningful");
    assert.equal((await publish({ type: "object", properties: { note: { type: "null", nullable: true } }, required: ["note"], additionalProperties: false })).status, 400, "null is already null");
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    assert.equal((await client.act(owner, "record.append", org, record(org, pol, resource, ok.result.digest, { note: null }))).status, 200);
    assert.equal((await client.act(owner, "record.append", org, record(org, pol, resource, ok.result.digest, { note: "x" }))).status, 200);
    assert.equal((await client.act(owner, "record.append", org, record(org, pol, resource, ok.result.digest, { note: 1 }))).status, 422);
  } finally { await store.close(); }
});
