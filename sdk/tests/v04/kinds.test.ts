import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, member, person, policy, record, string, object } from "./helpers.ts";
import { digest } from "../../src/v04/wire.ts";
import { KIND_PATTERN, KIND_REGISTRY_FORMAT, expandKinds, isKind, parseKindRegistry, profileKind, profileMajor } from "../../src/v04/profiles.ts";
import { emptyState } from "../../src/v04/model.ts";
import { COMMAND_SCHEMA } from "../../src/v04/schema.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";

/** Publishes a profile with an explicit name and version, and returns its digest. */
async function publish(client: Client, owner: any, org: string, name: string, version: string, schema = object({ note: string(200) }), visibility = "private") {
  const contract = { publisher_id: org, name, version, schema, semantics: "structural", dependencies: [] };
  const hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
  await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility, readers: [] }); return hash;
}
const page = (extra: Partial<{ after: number; limit: number; profile_digests: string[]; kinds: string[] }>) => ({ after: 0, limit: 100, profile_digests: [], kinds: [], ...extra });

test("kinds: the registry file, the grammar and the version rule", () => {
  const file = fileURLToPath(new URL("../../../spec/profiles/index.json", import.meta.url));
  const registry = parseUntrustedJson(readFileSync(file, "utf8")) as { format: string; kinds: Record<string, unknown> };
  assert.equal(registry.format, KIND_REGISTRY_FORMAT);
  const product = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/product/1/fixtures.json", import.meta.url)), "utf8")) as { contract_digest: string };
  const inventory = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/inventory/2/fixtures.json", import.meta.url)), "utf8")) as { contract_digest: string };
  const party = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/party/1/fixtures.json", import.meta.url)), "utf8")) as { contract_digest: string };
  const order = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/order/1/fixtures.json", import.meta.url)), "utf8")) as { contract_digest: string };
  const forecast = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/forecast/1/fixtures.json", import.meta.url)), "utf8")) as { contract_digest: string };
  assert.deepEqual(parseKindRegistry(registry), { "dtp/product@1": [product.contract_digest], "dtp/inventory@2": [inventory.contract_digest], "dtp/order@1": [order.contract_digest], "dtp/forecast@1": [forecast.contract_digest], "dtp/party@1": [party.contract_digest] }, "every kind with a second implementation is registered, pinning its exact contract");
  const org = "11111111-1111-4111-8111-111111111111", d = "a".repeat(64);
  assert.deepEqual(parseKindRegistry({ format: KIND_REGISTRY_FORMAT, kinds: { "dtp/inventory@2": { digests: [d] } } }), { "dtp/inventory@2": [d] });
  for (const bad of [{ format: "dtp-profile-kinds-2", kinds: {} }, { format: KIND_REGISTRY_FORMAT, kinds: [] }, { format: KIND_REGISTRY_FORMAT, kinds: { [`${org}/inventory@2`]: { digests: [d] } } },
    { format: KIND_REGISTRY_FORMAT, kinds: { "dtp/inventory@2": { digests: [] } } }, { format: KIND_REGISTRY_FORMAT, kinds: { "dtp/inventory@2": { digests: [d, d] } } }, { format: KIND_REGISTRY_FORMAT, kinds: { "dtp/Inventory@2": { digests: [d] } } }])
    assert.throws(() => parseKindRegistry(bad), JSON.stringify(bad));
  for (const ok of ["dtp/inventory@2", `${org}/stock.movement@1`, "dtp/a@0", `${org}/x-y_z.w@10`]) assert.ok(isKind(ok), ok);
  for (const bad of ["inventory@2", "dtp/inventory", "dtp/inventory@02", "dtp/inventory@1.2", "DTP/inventory@2", "acme/inventory@2", `${org}/@1`, "dtp/" + "a".repeat(81) + "@1"]) assert.ok(!isKind(bad), bad);
  assert.equal(profileMajor("2.7.1"), 2); assert.throws(() => profileMajor("2.7"));
  assert.equal(profileKind({ publisher_id: org, name: "stock", version: "3.1.4" }), `${org}/stock@3`);
  // The wire schema and the code share one grammar.
  const kind = (COMMAND_SCHEMA.allOf as any[]).find(x => x.if.properties.action.const === "records.list").then.properties.payload.properties.kinds.items;
  assert.equal(kind.pattern, KIND_PATTERN); assert.equal(kind.maxLength, 160);
  assert.throws(() => expandKinds(emptyState(), ["not a kind"], () => true, undefined), /invalid kind/);
});

test("kinds: a subscriber selects every admitted minor of a major, not a producer, and a kind that selects nothing is an explicit error", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    // Two producers of one kind, one of the next major, and an unrelated kind.
    const v10 = await publish(client, owner, org, "stock", "1.0.0"), v11 = await publish(client, owner, org, "stock", "1.1.0", object({ note: string(200), lot: string(40) }, ["note"]));
    const v20 = await publish(client, owner, org, "stock", "2.0.0"), other = await publish(client, owner, org, "order", "1.0.0");
    const written = [];
    for (const [d, body] of [[v10, { note: "first producer" }], [v11, { note: "second producer", lot: "L1" }], [v20, { note: "next major" }], [other, { note: "an order" }]] as [string, any][])
      written.push((await client.ok(owner, "record.append", org, record(org, pol, resource, d, body))).id);
    const stock = await client.ok(owner, "records.list", org, page({ kinds: [`${org}/stock@1`] }));
    assert.deepEqual(stock.profile_digests, [v10, v11].sort(), "the kind expanded to both admitted minors of major 1 and reports the set");
    assert.deepEqual(stock.records.map((r: any) => r.id), written.slice(0, 2), "records from both producers, in company order, and nothing from major 2 or another kind");
    const union = await client.ok(owner, "workspace.view", org, page({ kinds: [`${org}/stock@2`], profile_digests: [other] }));
    assert.deepEqual(union.profile_digests, [v20, other].sort()); assert.deepEqual(union.records.map((r: any) => r.id), written.slice(2));
    const exported = await client.ok(owner, "records.export", org, page({ kinds: [`${org}/stock@1`, `${org}/order@1`] }));
    assert.equal(exported.records.length, 3);
    const dup = await client.act(owner, "records.list", org, page({ kinds: [`${org}/stock@1`, `${org}/stock@1`] })); assert.equal(dup.status, 400, "kinds are a set");
    const none = await client.act(owner, "records.list", org, page({ kinds: [`${org}/stock@3`] }));
    assert.equal(none.status, 422); assert.equal(none.error.code, "unsupported_profile", "a kind nobody published is an error, never an empty page");
    const unregistered = await client.act(owner, "records.list", org, page({ kinds: ["dtp/stock@1"] }));
    assert.equal(unregistered.status, 422, "a protocol kind this host has not been configured with is unsupported");
    const malformed = await client.act(owner, "records.list", org, page({ kinds: ["stock@1"] })); assert.equal(malformed.status, 400);
    // Another company's private kind is not visible from here, so it selects nothing.
    const stranger = await person(client), elsewhere = await company(client, stranger, "Elsewhere Co");
    await publish(client, stranger, elsewhere, "stock", "1.0.0");
    const foreign = await client.act(owner, "records.list", org, page({ kinds: [`${elsewhere}/stock@1`] })); assert.equal(foreign.status, 422);
    // A community profile of another publisher is selectable by its kind.
    const shared = await publish(client, stranger, elsewhere, "shared", "1.0.0", object({ note: string(200) }), "community");
    const community = await client.ok(owner, "records.list", org, page({ kinds: [`${elsewhere}/shared@1`] }));
    assert.deepEqual(community.profile_digests, [shared]); assert.deepEqual(community.records, []);
    // A member with no grant on the resource sees the expansion but no rows: kinds widen selection, never authority.
    const staff = await person(client); await member(client, owner, org, staff);
    const denied = await client.ok(staff, "records.list", org, page({ kinds: [`${org}/stock@1`] }));
    assert.deepEqual(denied.profile_digests, [v10, v11].sort()); assert.deepEqual(denied.records, []);
  } finally { await store.close(); }
});

test("kinds: a protocol kind resolves through the host's registry to admitted profiles only", async () => {
  // The registry is operator configuration handed to the host; the same object is read on every request here, so a
  // digest registered after the host starts is honoured, which is how an operator admits a newly registered profile.
  const missing = "f".repeat(64), registry = parseKindRegistry({ format: KIND_REGISTRY_FORMAT, kinds: { "dtp/inventory@2": { digests: [missing] }, "dtp/order@1": { digests: [missing] } } });
  const store = await createDtpStore({ kinds: registry }); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const health = await (await fetch(store.audience + "/dtp/v0.4/health")).json();
    assert.equal(health.capabilities.kind_registry, KIND_REGISTRY_FORMAT); assert.deepEqual(health.capabilities.protocol_kinds, ["dtp/inventory@2", "dtp/order@1"], "this host was started with an explicit registry, not the repository one");
    const before = await client.act(owner, "records.list", org, page({ kinds: ["dtp/inventory@2"] }));
    assert.equal(before.status, 422); assert.equal(before.error.code, "unsupported_profile", "registered, but no listed digest is admitted at this host");
    // The registry pins exact contracts: a profile of the same name and major from an unlisted publisher does not count.
    const lookalike = await publish(client, owner, org, "inventory", "2.0.0");
    assert.equal((await client.act(owner, "records.list", org, page({ kinds: ["dtp/inventory@2"] }))).status, 422);
    // Register the digest this company publishes next; from then on the protocol kind selects it.
    const contract = { publisher_id: org, name: "inventory", version: "2.1.0", schema: object({ note: string(200) }), semantics: "structural", dependencies: [] };
    registry["dtp/inventory@2"].push(await digest(contract));
    const d = await publish(client, owner, org, "inventory", "2.1.0"), pol = await policy(client, owner, org, [grant(owner)]);
    const resource = crypto.randomUUID();
    await client.ok(owner, "record.append", org, record(org, pol, resource, lookalike, { note: "unlisted" }));
    const id = (await client.ok(owner, "record.append", org, record(org, pol, resource, d, { note: "protocol stock" }))).id;
    const rows = await client.ok(owner, "records.list", org, page({ kinds: ["dtp/inventory@2"] }));
    assert.deepEqual(rows.profile_digests, [d]); assert.deepEqual(rows.records.map((r: any) => r.id), [id], "only the registered digest, not the lookalike");
    const both = await client.ok(owner, "records.list", org, page({ kinds: ["dtp/inventory@2", `${org}/inventory@2`] }));
    assert.deepEqual(both.profile_digests, [d, lookalike].sort(), "the private kind of the same publisher selects both minors; the union is reported");
    assert.equal((await client.act(owner, "records.list", org, page({ kinds: ["dtp/order@1"] }))).status, 422, "listed digests nobody published");
    assert.equal((await client.act(owner, "records.list", org, page({ kinds: ["dtp/party@1"] }))).status, 422, "a kind absent from the registry");
  } finally { await store.close(); }
});
