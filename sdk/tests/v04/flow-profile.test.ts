import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, record } from "./helpers.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { FLOW_PROFILE } from "../../src/profiles/flow.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const flow = load("../../../spec/profiles/flow/1/fixtures.json"), product = load("../../../spec/profiles/product/1/fixtures.json"), object = load("../../../spec/profiles/object/1/fixtures.json");
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

/** A company holding the fixture's products and accounts under their fixture roots, with every protocol contract admitted. */
async function setup(store: { audience: string }) {
  const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
  for (const digest of [product.contract_digest, object.contract_digest, flow.contract_digest]) await client.ok(owner, "profile.admit", org, { digest });
  const pol = await policy(client, owner, org, [grant(owner)]), base = product.accept[0].body;
  const write = async (root: string, digest: string, body: any) => { const r = { ...record(org, pol, root, digest, body), id: root, root_id: root }; await client.ok(owner, "record.append", org, r); };
  for (const f of flow.flows) for (const o of f.openings) {
    if (o.kind === "goods") await write(o.product_id, product.contract_digest, { ...base, identifiers: [], packaging: [], base_unit: o.product.base_unit, tracking: o.product.tracking });
    else await write(o.account, object.contract_digest, { class: "dtp/account", label: "Account", identifiers: [], status: "active", retired: null, evidence: [] });
  }
  const openBook = async (f: any) => {
    await client.ok(owner, "flow.open", org, { policy_id: pol, book_id: f.book_id });
    for (const o of f.openings) await client.ok(owner, "flow.ledger.open", org, o.kind === "goods"
      ? { policy_id: pol, book_id: f.book_id, asset: { product: o.product_id, currency: null }, account: null, balance: "nonnegative" }
      : { policy_id: pol, book_id: f.book_id, asset: { product: null, currency: o.currency }, account: o.account, balance: o.balance });
  };
  return { client, owner, org, pol, openBook, append: (book: string, body: any) => client.act(owner, "record.append", org, record(org, pol, book, flow.contract_digest, body)) };
}

test("flow-v1 in the reference host: books and ledgers open from their anchors, every fixture fact reaches its outcome, and the book reads back exactly", async () => {
  const store = await createDtpStore(); try {
    const { client, owner, org, pol, openBook, append } = await setup(store);
    const [plant, tools] = flow.flows;
    assert.equal((await append(plant.book_id, plant.facts[0].fact)).error.code, "book_unavailable", "facts need an opened book");
    await openBook(plant); await openBook(tools);
    for (const f of flow.flows) for (const step of f.facts) {
      const r = await append(f.book_id, step.fact);
      if (step.expect.ok) { assert.equal(r.status, 200, `${step.why}: ${JSON.stringify(r.error)}`); assert.equal(Boolean(r.result.duplicate), step.expect.duplicate, step.why); }
      else { assert.ok([409, 422].includes(r.status), step.why); assert.equal(r.error.code, step.expect.code, step.why); }
    }
    for (const f of flow.flows) {
      const book = await client.ok(owner, "flow.book", org, { policy_id: pol, book_id: f.book_id });
      const { policy_id, ...rest } = book; assert.equal(policy_id, pol);
      assert.deepEqual(rest, { ...f.final, organization_id: org }, `${f.why}: the host's book equals the fixture's`);
    }
    const listed = await client.ok(owner, "records.list", org, page(["dtp/flow@1"]));
    const accepted = flow.flows.flatMap((f: any) => f.facts).filter((s: any) => s.expect.ok && !s.expect.duplicate).length;
    assert.equal(listed.records.length, accepted);
    assert.equal(listed.records[0].validation.profile, FLOW_PROFILE); assert.equal(listed.records[0].validation.physical_stock_verified, false);
  } finally { await store.close(); }
});

test("flow-v1 host rules: ledger anchors, one spelling per object, published packaging and the book's policy", async () => {
  const store = await createDtpStore(); try {
    const { client, owner, org, pol, openBook, append } = await setup(store);
    const [plant] = flow.flows, goods = plant.openings[0], money = plant.openings.find((o: any) => o.kind === "money");
    await client.ok(owner, "flow.open", org, { policy_id: pol, book_id: plant.book_id });
    assert.equal((await client.act(owner, "flow.open", org, { policy_id: pol, book_id: plant.book_id })).status, 409, "a book opens once");
    const ledger = (asset: any, account: string | null, balance = "nonnegative") => client.act(owner, "flow.ledger.open", org, { policy_id: pol, book_id: plant.book_id, asset, account, balance });
    assert.equal((await ledger({ product: crypto.randomUUID(), currency: null }, null)).status, 404, "a goods ledger anchors on a product the company holds");
    assert.equal((await ledger({ product: null, currency: "USD" }, goods.product_id)).status, 404, "a money ledger anchors on a dtp/account object, not a product");
    assert.equal((await ledger({ product: goods.product_id, currency: null }, null, "signed")).error.code, "invalid_flow", "goods never go negative");
    assert.equal((await ledger({ product: goods.product_id, currency: null }, null)).status, 200);
    assert.equal((await ledger({ product: goods.product_id, currency: null }, null)).status, 409, "a ledger opens once");
    assert.equal((await ledger({ product: null, currency: "USD" }, money.account, "signed")).status, 200);
    const receipt = structuredClone(plant.facts[0].fact);
    const spelled = structuredClone(receipt); spelled.legs[0].to.location.ref.minted_by = org;
    assert.equal((await append(plant.book_id, spelled)).error.code, "invalid_flow", "the company's own dock is referenced with minted_by null");
    const packed = structuredClone(receipt); packed.legs[0].quantity = { amount: "2", unit: { system: "packaging", code: null, packaging_id: "sack", version: "1", base_units_per_pack: "25" } };
    assert.equal((await append(plant.book_id, packed)).error.code, "unknown_packaging");
    const otherPolicy = await policy(client, owner, org, [grant(owner)]);
    const elsewhere = await client.act(owner, "record.append", org, record(org, otherPolicy, plant.book_id, flow.contract_digest, receipt));
    assert.equal(elsewhere.error.code, "forbidden", "a fact is written under its book's policy");
    assert.equal((await append(plant.book_id, receipt)).status, 200);
    const again = await append(plant.book_id, receipt); assert.equal(again.status, 200); assert.equal(again.result.duplicate, true, "a retried observation is the same fact");
  } finally { await store.close(); }
});
