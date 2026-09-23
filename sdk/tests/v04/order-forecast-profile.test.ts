import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, record } from "./helpers.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { ORDER_PROFILE } from "../../src/profiles/order.ts";
import { FORECAST_PROFILE } from "../../src/profiles/forecast.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const order = load("../../../spec/profiles/order/1/fixtures.json"), forecast = load("../../../spec/profiles/forecast/1/fixtures.json");
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

test("order-v1 and forecast-v1 in the reference host, through the registered protocol contracts: births, refusals, transitions, and a forecast that never becomes an order", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    for (const digest of [order.contract_digest, forecast.contract_digest]) await client.ok(owner, "profile.admit", org, { digest });
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    // Orders: every accepted body that is born placed is accepted; the others are refused at birth with the order code.
    for (const v of order.accept) {
      const response = await client.act(owner, "record.append", org, record(org, pol, resource, order.contract_digest, v.body));
      if (v.body.status === "placed") assert.equal(response.status, 200, `${v.why}: ${JSON.stringify(response.error)}`);
      else { assert.equal(response.status, 422, v.why); assert.equal(response.error.code, "invalid_order", v.why); }
    }
    const codes = new Set<string>();
    for (const v of order.reject) { const r = await client.act(owner, "record.append", org, record(org, pol, resource, order.contract_digest, v.body)); assert.ok([400, 422].includes(r.status), v.why); if (r.status === 422) codes.add(r.error.code); }
    assert.ok(codes.has("invalid_order"));
    for (const v of order.continuity.accept) {
      const first = { ...record(org, pol, resource, order.contract_digest, v.previous) };
      if (v.previous.status !== "placed") continue; // pairs that start beyond placed are reached through the chain below
      await client.ok(owner, "record.append", org, first);
      await client.ok(owner, "record.append", org, { ...record(org, pol, resource, order.contract_digest, v.next), root_id: first.id, supersedes: first.id });
    }
    // One order's whole life: placed, acknowledged, partially fulfilled, fulfilled, closed; then nothing.
    const life = ["placed", "acknowledged", "partially_fulfilled", "fulfilled", "closed"], base = order.accept[0].body;
    const genesis = record(org, pol, resource, order.contract_digest, base); await client.ok(owner, "record.append", org, genesis);
    let head = genesis.id;
    for (const status of life.slice(1)) { const next = { ...record(org, pol, resource, order.contract_digest, { ...base, status }), root_id: genesis.id, supersedes: head }; await client.ok(owner, "record.append", org, next); head = next.id; }
    const reopened = await client.act(owner, "record.append", org, { ...record(org, pol, resource, order.contract_digest, { ...base, status: "acknowledged" }), root_id: genesis.id, supersedes: head });
    assert.equal(reopened.error.code, "invalid_order", "closed is terminal");
    for (const v of order.continuity.reject) {
      const first = record(org, pol, resource, order.contract_digest, { ...v.previous, status: "placed" }); await client.ok(owner, "record.append", org, first);
      let prev = first.id;
      if (v.previous.status !== "placed") { const step = { ...record(org, pol, resource, order.contract_digest, v.previous), root_id: first.id, supersedes: first.id }; const r = await client.act(owner, "record.append", org, step); if (r.status !== 200) continue; prev = step.id; }
      const response = await client.act(owner, "record.append", org, { ...record(org, pol, resource, order.contract_digest, v.next), root_id: first.id, supersedes: prev });
      assert.equal(response.status, 422, v.why); assert.equal(response.error.code, "invalid_order", v.why);
    }
    const orders = await client.ok(owner, "records.list", org, page(["dtp/order@1"]));
    assert.ok(orders.records.length > 0); assert.deepEqual(orders.records[0].validation, { profile: ORDER_PROFILE, level: "business-rules", business_verified: false });
    // Forecasts: accepted and refused; a forecast never appears among orders and an order never among forecasts.
    for (const v of forecast.accept) await client.ok(owner, "record.append", org, record(org, pol, resource, forecast.contract_digest, v.body));
    for (const v of forecast.reject) { const r = await client.act(owner, "record.append", org, record(org, pol, resource, forecast.contract_digest, v.body)); assert.ok([400, 422].includes(r.status), v.why); }
    for (const v of forecast.continuity.accept) { const first = record(org, pol, resource, forecast.contract_digest, v.previous); await client.ok(owner, "record.append", org, first); await client.ok(owner, "record.append", org, { ...record(org, pol, resource, forecast.contract_digest, v.next), root_id: first.id, supersedes: first.id }); }
    for (const v of forecast.continuity.reject) { const first = record(org, pol, resource, forecast.contract_digest, v.previous); await client.ok(owner, "record.append", org, first); const r = await client.act(owner, "record.append", org, { ...record(org, pol, resource, forecast.contract_digest, v.next), root_id: first.id, supersedes: first.id }); assert.equal(r.error.code, "invalid_forecast", v.why); }
    const forecasts = await client.ok(owner, "records.list", org, page(["dtp/forecast@1"]));
    assert.deepEqual(forecasts.records[0].validation, { profile: FORECAST_PROFILE, level: "business-rules", business_verified: false });
    const again = await client.ok(owner, "records.list", org, page(["dtp/order@1"]));
    assert.ok(again.records.every((r: any) => r.profile_digest === order.contract_digest) && forecasts.records.every((r: any) => r.profile_digest === forecast.contract_digest), "kinds keep them apart");
    const disguised = await client.act(owner, "record.append", org, record(org, pol, resource, order.contract_digest, forecast.accept[0].body));
    assert.ok([400, 422].includes(disguised.status), "a forecast body under the order contract is refused");
  } finally { await store.close(); }
});
