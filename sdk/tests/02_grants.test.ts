import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, draft, StoreRequestError } from "../src/client.ts";
import { nowIso, signRecord, type Envelope } from "../src/index.ts";
import { buyerAttest, grant, makeCompany, makeContract, makeFulfillment, makeModule, storeUnderTest, type Company, type Module } from "./helpers.ts";

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
let acme: Company, bluestem: Company, fin: Company, mod: Module;
let contractRoot: string;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
  acme = await makeCompany(base, "acme");
  bluestem = await makeCompany(base, "bluestem", { business_type: "distributor" });
  fin = await makeCompany(base, "demo-fin", { business_type: "financer" });
  mod = await makeModule(base, fin, "financing");
  const c = await makeContract(bluestem, acme);
  contractRoot = c.record.root_id;
  const f = await makeFulfillment(acme, bluestem, contractRoot);
  await buyerAttest(bluestem, acme, f);
});
after(async () => store.close());

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof StoreRequestError, `expected StoreRequestError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

function invoice(overrides: Record<string, unknown> = {}) {
  const now = nowIso();
  return draft({
    type: "finance.invoice",
    subject_company_id: acme.id,
    counterparty_ids: [bluestem.id],
    issuer: { key_id: mod.kp.keyId, company_id: acme.id, module_id: mod.id },
    visibility: "counterparties",
    body: {
      invoice_number: "INV-1", seller_company_id: acme.id, buyer_company_id: bluestem.id, contract_id: contractRoot, fulfillment_id: null,
      line_items: [{ description: "Habanero 5oz case", sku: null, quantity: { amount: "120", unit: "case" }, unit_price: { amount: "42.00", currency: "USD" }, amount: { amount: "5040.00", currency: "USD" } }],
      subtotal: { amount: "5040.00", currency: "USD" }, deductions: [], total: { amount: "5040.00", currency: "USD" },
      issued_at: now, due_at: now, payment_terms: { net_days: 30, paca_covered: false, early_pay_discount_bps: null },
      status: "issued", paid_amount: { amount: "0", currency: "USD" }, settlement_event_ids: [], assigned_to_company_id: null,
      ...overrides,
    },
  });
}

test("module without a grant cannot write, and cannot read counterparties records", async () => {
  await expectCode(mod.client.sign(invoice(), mod.kp.secretKey), "grant_missing");
  const list = await mod.client.listRecords({ subject: acme.id, namespace: "trade" });
  assert.equal(list.records.length, 0, "the public spine is visible, trade records are not");
});

test("module cannot issue a grant to itself", async () => {
  const g = draft({
    type: "core.grant",
    subject_company_id: acme.id,
    issuer: { key_id: mod.kp.keyId, company_id: acme.id, module_id: mod.id },
    visibility: "private",
    body: { module_id: mod.id, scopes: [{ namespace: "*", access: "write" }], status: "active", expires_at: null, note: null },
  });
  await expectCode(mod.client.sign(g, mod.kp.secretKey), "forbidden");
});

test("grant unlocks reads and writes exactly per scope; revocation removes them", async () => {
  const g = await grant(acme, mod, [{ namespace: "trade", access: "read" }, { type: "finance.invoice", access: "write" }]);
  assert.equal(g.record.type, "core.grant");
  // reads: trade.* from acme, including the fulfillment (subject acme) and the contract (acme is counterparty)
  const trade = await mod.client.listRecords({ namespace: "trade" });
  const types = trade.records.map((r) => r.type).sort();
  assert.deepEqual(types, ["trade.contract", "trade.fulfillment"]);
  // write: finance.invoice ok
  const inv = await mod.client.sign(invoice(), mod.kp.secretKey);
  assert.equal(inv.created, true);
  assert.equal(inv.record.issuer.module_id, mod.id);
  // write: finance.advance_offer not covered by the type-scoped grant
  const offer = draft({
    type: "finance.advance_offer",
    subject_company_id: acme.id,
    counterparty_ids: [fin.id],
    issuer: { key_id: mod.kp.keyId, company_id: fin.id, module_id: mod.id },
    visibility: "counterparties",
    body: { invoice_id: inv.record.root_id, seller_company_id: acme.id, financer_company_id: fin.id, advance_amount: { amount: "4284.00", currency: "USD" }, advance_bps: 8500, fee: { fee_bps: 150, apr_bps: 3000, fixed_fee: null }, repayment: { source: "buyer_payment", due_at: nowIso() }, recourse: "limited", pricing_basis: [{ record_id: inv.record.root_id, type: "finance.invoice", note: null }], expires_at: nowIso(), status: "offered" },
  });
  await expectCode(mod.client.sign(offer, mod.kp.secretKey), "grant_missing");
  // the module sees its own grant at /companies/{id}/grants
  const seen = await mod.client.companyGrants(acme.id);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].grantee_module_id, mod.id);
  // company sees all its grants
  assert.equal((await acme.client.companyGrants(acme.id)).length, 1);
  await expectCode(bluestem.client.companyGrants(acme.id), "forbidden");
  // revoke by superseding
  const revoke = draft({
    type: "core.grant",
    subject_company_id: acme.id,
    root_id: g.record.root_id,
    supersedes: g.record.record_id,
    issuer: { key_id: acme.kp.keyId, company_id: acme.id, module_id: null },
    visibility: "private",
    body: { ...(g.record.body as any), status: "revoked" },
  });
  await acme.client.sign(revoke, acme.kp.secretKey);
  await expectCode(mod.client.sign(invoice({ invoice_number: "INV-2" }), mod.kp.secretKey), "grant_missing");
  assert.equal((await mod.client.listRecords({ namespace: "trade" })).records.length, 0);
});

test("expired grant does not authorize", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await grant(acme, mod, [{ namespace: "finance", access: "write" }], { expires_at: past });
  await expectCode(mod.client.sign(invoice({ invoice_number: "INV-3" }), mod.kp.secretKey), "grant_missing");
});

test("a module writing on behalf of a company must be a party to the record", async () => {
  await grant(fin, mod, [{ namespace: "finance", access: "write" }]);
  // fin grants finance write, but fin is neither subject nor counterparty of this invoice
  const bad = invoice({ invoice_number: "INV-4" });
  bad.issuer = { key_id: mod.kp.keyId, company_id: fin.id, module_id: mod.id };
  await expectCode(mod.client.sign(bad, mod.kp.secretKey), "issuer_not_party");
});

test("issuer.module_id must match the module the token belongs to", async () => {
  const other = await makeModule(base, fin, "other-module");
  await grant(acme, other, [{ namespace: "finance", access: "write" }]);
  const env = invoice({ invoice_number: "INV-5" }); // issuer says mod (and mod signs), but the token is other's
  const signed = await signRecord(env, mod.kp.secretKey);
  await expectCode(other.client.write(signed as Envelope), "issuer_mismatch");
});
