import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, StoreRequestError } from "../src/client.ts";
import { buyerAttest, grant, makeCompany, makeContract, makeFulfillment, makeModule, storeUnderTest, type Company } from "./helpers.ts";

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
let acme: Company, bluestem: Company;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
  acme = await makeCompany(base, "acme");
  bluestem = await makeCompany(base, "bluestem", { business_type: "distributor" });
});
after(async () => store.close());

test("events are ordered, cursor-paginated, and carry status", async () => {
  const start = (await acme.client.events({ company: acme.id })).latest_cursor;
  const c = await makeContract(bluestem, acme);
  const f = await makeFulfillment(acme, bluestem, c.record.root_id);
  await buyerAttest(bluestem, acme, f);
  const feed = await acme.client.events({ company: acme.id, after: start });
  const kinds = feed.events.map((e) => `${e.type}:${e.status}`);
  assert.deepEqual(kinds, ["trade.contract:active", "trade.fulfillment:seller_attested", "trade.fulfillment:buyer_attested"]);
  assert.equal(feed.events[2].supersedes, f.record.record_id);
  assert.equal(feed.events[2].root_id, f.record.root_id);
  assert.equal(feed.events[2].issuer.company_id, bluestem.id);
  assert.ok(feed.events[0].cursor < feed.events[1].cursor && feed.events[1].cursor < feed.events[2].cursor);
  assert.equal(feed.next_cursor, null);
  // paginate with limit 1
  const p1 = await acme.client.events({ company: acme.id, after: start, limit: 1 });
  assert.equal(p1.events.length, 1);
  assert.ok(p1.next_cursor);
  const p2 = await acme.client.events({ company: acme.id, after: p1.next_cursor!, limit: 1 });
  assert.equal(p2.events[0].record_id, feed.events[1].record_id);
  // caught up
  const p3 = await acme.client.events({ company: acme.id, after: feed.latest_cursor });
  assert.equal(p3.events.length, 0);
});

test("feed is visibility-filtered per principal; anonymous is rejected", async () => {
  await assert.rejects(base.events(), (e: any) => e instanceof StoreRequestError && e.code === "auth_required");
  const stranger = await makeCompany(base, "stranger");
  const start = (await stranger.client.events()).latest_cursor;
  const c = await makeContract(bluestem, acme); // counterparties visibility
  const s = await stranger.client.events({ after: start });
  assert.ok(!s.events.some((e) => e.record_id === c.record.record_id), "stranger must not see a counterparties record");
  const a = await acme.client.events({ after: start });
  assert.ok(a.events.some((e) => e.record_id === c.record.record_id), "counterparty sees it");
});

test("a module sees events only for types and companies it is granted", async () => {
  const fin = await makeCompany(base, "fin", { business_type: "financer" });
  const mod = await makeModule(base, fin, "watcher");
  const start = (await mod.client.events()).latest_cursor;
  const c = await makeContract(bluestem, acme);
  let feed = await mod.client.events({ after: start });
  assert.equal(feed.events.filter((e) => e.record_id === c.record.record_id).length, 0);
  await grant(acme, mod, [{ namespace: "trade", access: "read" }]);
  feed = await mod.client.events({ after: start });
  assert.equal(feed.events.filter((e) => e.record_id === c.record.record_id).length, 1, "granted by a counterparty of the contract");
  // the grant record itself is visible to the grantee module
  assert.ok(feed.events.some((e) => e.type === "core.grant"));
});
