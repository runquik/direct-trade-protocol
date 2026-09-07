// Astra infrastructure regressions. LOCAL ONLY; ignores STORE_URL.
// Converted from the September 4 diagnostics: passing now asserts the fixes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createDevStore } from "../scripts/dev-server.ts";
import { DtpStoreClient, draft, StoreRequestError } from "../src/client.ts";
import { generateKeyPair, signRecord, nowIso } from "../src/index.ts";
import { companyBody, contractBody, makeCompany, makeModule, makeContract, makeFulfillment, buyerAttest, grant, uniq, type Company } from "./helpers.ts";
import { pgliteDb, type Db } from "../../supabase/functions/dtp-store/db.ts";
import { handle } from "../../supabase/functions/dtp-store/router.ts";

let store: Awaited<ReturnType<typeof createDevStore>>;
let base: DtpStoreClient;
let buyer: Company, seller: Company, publisher: Company;
before(async () => {
  process.env.DTP_DEV_PORT = "0";
  store = await createDevStore();
  base = new DtpStoreClient(store.url);
  buyer = await makeCompany(base, "astra-buyer");
  seller = await makeCompany(base, "astra-seller");
  publisher = await makeCompany(base, "astra-publisher");
});
after(async () => store?.close());

function revision(prev: any, writer: Company, changes: Record<string, unknown> = {}) {
  return draft({ type: prev.type, subject_company_id: prev.subject_company_id,
    counterparty_ids: prev.counterparty_ids, visibility: prev.visibility,
    supersedes: prev.record_id, root_id: prev.root_id,
    issuer: { key_id: writer.kp.keyId, company_id: writer.id, module_id: null },
    body: { ...prev.body, ...changes } });
}
async function errorOf(promise: Promise<unknown>) {
  try { await promise; } catch (e) { assert.ok(e instanceof StoreRequestError); return e; }
  assert.fail("expected request to fail");
}

test("A01: private identities are hidden through every read endpoint", async () => {
  const kp = await generateKeyPair();
  const id = uniq("astra-private") + ".dtp";
  const env = await signRecord(draft({ type: "core.company", subject_company_id: id,
    issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "private",
    body: companyBody(kp, "Private identity") }), kp.secretKey);
  const missingCompany = await errorOf(base.getCompany(id));
  await base.createCompany(env);
  assert.equal((await errorOf(base.getRecord(env.record_id))).status, 404);
  for (const client of [base, buyer.client]) {
    const hidden = await errorOf(client.getCompany(id));
    assert.equal(hidden.status, 404);
    assert.equal(hidden.code, missingCompany.code);
    assert.equal(hidden.message, missingCompany.message);
    assert.deepEqual(hidden.details, missingCompany.details);
    assert.ok(!hidden.message.includes(env.record_id));
  }

  const moduleKey = await generateKeyPair();
  const moduleId = uniq("astra-private-module");
  const mod = await signRecord(draft({ type: "core.module", subject_company_id: publisher.id,
    issuer: { key_id: moduleKey.keyId, company_id: publisher.id, module_id: moduleId }, visibility: "private",
    body: { module_id: moduleId, name: "Private module", publisher_company_id: publisher.id,
      keys: [{ key_id: moduleKey.keyId, role: "root", status: "active", added_at: nowIso() }] }
  }), moduleKey.secretKey);
  const missingModule = await errorOf(base.getModule(moduleId));
  await publisher.client.createModule(mod);
  assert.equal((await errorOf(base.getRecord(mod.record_id))).status, 404);
  for (const client of [base, buyer.client]) {
    const hidden = await errorOf(client.getModule(moduleId));
    assert.equal(hidden.status, 404);
    assert.equal(hidden.code, missingModule.code);
    assert.equal(hidden.message, missingModule.message);
    assert.deepEqual(hidden.details, missingModule.details);
    assert.ok(!hidden.message.includes(mod.record_id));
  }
  assert.equal((await publisher.client.getModule(moduleId)).record.record_id, mod.record_id);
  assert.equal((await errorOf(base.createModule(mod))).code, "forbidden");
  const replay = await publisher.client.request<any>("POST", "/modules", mod);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data.keys, []);
});

test("B01: only the financer may revise an advance, and funded terms never change", async () => {
  const financer = await makeCompany(base, "advance-financer");
  const usd = (amount: string) => ({ amount, currency: "USD" });
  const first = await financer.client.sign(draft({ type: "finance.advance", subject_company_id: seller.id,
    counterparty_ids: [financer.id], issuer: { key_id: financer.kp.keyId, company_id: financer.id, module_id: null },
    body: { seller_company_id: seller.id, financer_company_id: financer.id, advance_offer_id: crypto.randomUUID(),
      invoice_id: crypto.randomUUID(), principal: usd("100"), fee: { fee_bps: 100, apr_bps: 1200 },
      funded_at: nowIso(), funding_event_id: crypto.randomUUID(), maturity_at: nowIso(),
      repaid_amount: usd("0"), outstanding: usd("101"), status: "funded" }
  }), financer.kp.secretKey);
  assert.equal((await errorOf(seller.client.sign(revision(first.record, seller, { outstanding: usd("0") }), seller.kp.secretKey))).code, "transition_forbidden");
  assert.equal((await errorOf(financer.client.sign(revision(first.record, financer, { principal: usd("999") }), financer.kp.secretKey))).code, "transition_forbidden");
  const valid = await financer.client.sign(revision(first.record, financer, {
    status: "partially_repaid", repaid_amount: usd("1"), outstanding: usd("100"), repayment_event_ids: [crypto.randomUUID()]
  }), financer.kp.secretKey);
  assert.equal(valid.created, true);
});

test("B02: invoice assignment is seller-controlled and cannot be cleared or reassigned", async () => {
  const financer = await makeCompany(base, "assignment-financer");
  const usd = (amount: string) => ({ amount, currency: "USD" });
  const first = await seller.client.sign(draft({ type: "finance.invoice", subject_company_id: seller.id,
    counterparty_ids: [buyer.id], issuer: { key_id: seller.kp.keyId, company_id: seller.id, module_id: null },
    body: { invoice_number: "INV-1", seller_company_id: seller.id, buyer_company_id: buyer.id,
      contract_id: crypto.randomUUID(), line_items: [{ description: "test", quantity: { amount: "1", unit: "case" }, unit_price: usd("100"), amount: usd("100") }],
      subtotal: usd("100"), deductions: [], total: usd("100"), issued_at: nowIso(), due_at: nowIso(),
      payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [], assigned_to_company_id: null }
  }), seller.kp.secretKey);
  assert.equal((await errorOf(buyer.client.sign(revision(first.record, buyer, {
    status: "acknowledged", assigned_to_company_id: financer.id
  }), buyer.kp.secretKey))).code, "transition_forbidden");
  assert.equal((await errorOf(seller.client.sign(revision(first.record, seller, { total: usd("999") }), seller.kp.secretKey))).code, "transition_forbidden");
  const assigned = await seller.client.sign(revision(first.record, seller, { assigned_to_company_id: financer.id }), seller.kp.secretKey);
  for (const value of [publisher.id, null]) {
    assert.equal((await errorOf(seller.client.sign(revision(assigned.record, seller, { assigned_to_company_id: value }), seller.kp.secretKey))).code, "transition_forbidden");
  }
  const acknowledged = await buyer.client.sign(revision(assigned.record, buyer, { status: "acknowledged" }), buyer.kp.secretKey);
  assert.equal(acknowledged.created, true);
});

test("B09: buyer invoice transitions preserve seller-controlled payment accounting", async () => {
  const usd = (amount: string) => ({ amount, currency: "USD" });
  for (const [from, to] of [["issued", "acknowledged"], ["issued", "disputed"],
    ["acknowledged", "disputed"], ["disputed", "acknowledged"]]) {
    let current = await seller.client.sign(draft({ type: "finance.invoice", subject_company_id: seller.id,
      counterparty_ids: [buyer.id], issuer: { key_id: seller.kp.keyId, company_id: seller.id, module_id: null },
      body: { invoice_number: `PAY-${from}-${to}`, seller_company_id: seller.id, buyer_company_id: buyer.id,
        contract_id: crypto.randomUUID(), line_items: [{ description: "test", quantity: { amount: "1", unit: "case" }, unit_price: usd("100"), amount: usd("100") }],
        subtotal: usd("100"), deductions: [], total: usd("100"), issued_at: nowIso(), due_at: nowIso(),
        payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [] }
    }), seller.kp.secretKey);
    if (from !== "issued") current = await buyer.client.sign(revision(current.record, buyer, { status: from }), buyer.kp.secretKey);
    const paymentId = crypto.randomUUID();
    current = await seller.client.sign(revision(current.record, seller, {
      paid_amount: usd("25"), settlement_event_ids: [paymentId]
    }), seller.kp.secretKey);
    for (const attack of [{ paid_amount: usd("100") }, { settlement_event_ids: [crypto.randomUUID()] }, { settlement_event_ids: [] }]) {
      const rejected = await errorOf(buyer.client.sign(revision(current.record, buyer, { status: to, ...attack }), buyer.kp.secretKey));
      assert.equal(rejected.code, "transition_forbidden", `${from} -> ${to}`);
    }
    // Rejected writes leave the head unchanged; legitimate buyer action still works.
    assert.equal((await seller.client.getRecord(current.record.record_id)).is_head, true);
    const accepted = await buyer.client.sign(revision(current.record, buyer, { status: to }), buyer.kp.secretKey);
    assert.deepEqual(accepted.record.body.paid_amount, usd("25"));
    assert.deepEqual(accepted.record.body.settlement_event_ids, [paymentId]);
    const payment = await seller.client.sign(revision(accepted.record, seller, {
      ...(to === "acknowledged" ? { status: "partially_paid" } : {}),
      paid_amount: usd("50"), settlement_event_ids: [paymentId, crypto.randomUUID()]
    }), seller.kp.secretKey);
    assert.equal(payment.created, true);
  }
});

test("B03: accepting an advance offer cannot change the offered price", async () => {
  const financer = await makeCompany(base, "offer-financer");
  const first = await financer.client.sign(draft({ type: "finance.advance_offer", subject_company_id: seller.id,
    counterparty_ids: [financer.id], issuer: { key_id: financer.kp.keyId, company_id: financer.id, module_id: null },
    body: { invoice_id: crypto.randomUUID(), seller_company_id: seller.id, financer_company_id: financer.id,
      advance_amount: { amount: "100", currency: "USD" }, advance_bps: 9000, fee: { fee_bps: 100, apr_bps: 1200 },
      repayment: { source: "buyer_payment", due_at: nowIso() }, recourse: "full",
      pricing_basis: [{ record_id: crypto.randomUUID(), type: "finance.invoice" }], expires_at: nowIso(), status: "offered" }
  }), financer.kp.secretKey);
  assert.equal((await errorOf(seller.client.sign(revision(first.record, seller, {
    status: "accepted", fee: { fee_bps: 0, apr_bps: 0 }
  }), seller.kp.secretKey))).code, "transition_forbidden");
  assert.equal((await seller.client.sign(revision(first.record, seller, { status: "accepted" }), seller.kp.secretKey)).created, true);
});

test("B04: trade settlements are append-only too", async () => {
  const first = await buyer.client.sign(draft({ type: "trade.settlement", subject_company_id: buyer.id,
    counterparty_ids: [seller.id], issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    body: { contract_id: crypto.randomUUID(), fulfillment_id: crypto.randomUUID(), buyer_company_id: buyer.id, seller_company_id: seller.id,
      gross_amount: { amount: "100", currency: "USD" }, deductions: [], net_amount: { amount: "100", currency: "USD" }, settled_at: nowIso() }
  }), buyer.kp.secretKey);
  assert.equal((await errorOf(buyer.client.sign(revision(first.record, buyer, { net_amount: { amount: "1", currency: "USD" } }), buyer.kp.secretKey))).code, "transition_forbidden");
});

test("B05: duplicate key IDs cannot defeat the last-root safeguard", async () => {
  const owner = await makeCompany(base, "duplicate-root");
  const prev = await owner.client.getRecord(owner.companyRecordId);
  const key = (prev.body.keys as any[])[0];
  assert.equal((await errorOf(owner.client.sign(revision(prev, owner, {
    keys: [key, { ...key, status: "revoked", revoked_at: nowIso() }]
  }), owner.kp.secretKey))).code, "schema_invalid");
  assert.equal((await owner.client.whoami()).role, "root");
});

test("B06: event pages and latest_cursor honor the same company filter", async () => {
  const company = await makeCompany(base, "filter-owner");
  const one = await makeContract(company, seller);
  await makeCompany(base, "later-public-event");
  const feed = await company.client.events({ company: company.id, after: "0", limit: 1 });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.latest_cursor, String(one.record.seq).padStart(16, "0"));
  assert.equal(feed.next_cursor, feed.events[0].cursor);
});

test("B07: list visibility matches direct reads for expired, revoked, private and scoped grants", async () => {
  const owner = await makeCompany(base, "visibility-owner");
  const mod = await makeModule(base, publisher, "visibility-reader");
  const unrelated = await makeModule(base, publisher, "visibility-unrelated");
  await grant(owner, unrelated, [{ namespace: "*", access: "read" }]);
  const records: import("../src/envelope.ts").StoredRecord[] = [];
  for (const visibility of ["public", "counterparties", "granted", "private"] as const) {
    records.push((await owner.client.sign(draft({ type: "trade.contract", subject_company_id: owner.id,
      counterparty_ids: [seller.id], visibility, issuer: { key_id: owner.kp.keyId, company_id: owner.id, module_id: null },
      body: contractBody(owner.id, seller.id) }), owner.kp.secretKey)).record);
  }
  await grant(owner, mod, [{ namespace: "*", access: "read" }], { expires_at: "2000-01-01T00:00:00Z" });
  async function check(expected: string[]) {
    const page = await mod.client.listRecords({ subject: owner.id, type: "trade.contract", limit: 50 });
    assert.deepEqual(page.records.map(r => r.visibility), expected);
    const feed = await mod.client.events({ company: owner.id, after: "0", limit: 500 });
    for (const r of records) {
      const direct = await mod.client.getRecord(r.record_id).then(() => true, () => false);
      assert.equal(direct, expected.includes(r.visibility));
      assert.equal(feed.events.some(e => e.record_id === r.record_id), direct);
    }
    const own = await mod.client.listRecords({ subject: owner.id, type: "core.grant" });
    assert.ok(own.records.every(r => r.body.module_id === mod.id));
  }
  await check(["public"]);
  const active = await grant(owner, mod, [{ type: "trade.contract", access: "read" }]);
  await check(["public", "counterparties", "granted"]);
  await owner.client.sign(revision(active.record, owner, { status: "revoked" }), owner.kp.secretKey);
  await check(["public"]);
  await grant(seller, mod, [{ namespace: "trade", access: "write" }]);
  await check(["public", "counterparties"]);
});

test("B08: invalid HTTP inputs are bounded and return safe client errors", async () => {
  const noop: Db = { query: async () => [], transaction: async fn => fn(noop) };
  async function call(path: string, body?: string | Uint8Array, headers?: Record<string, string>) {
    return handle(new Request("http://local/dtp-store" + path, {
      method: body === undefined ? "GET" : "POST", body: body as BodyInit | undefined, headers
    }), { db: noop });
  }
  for (const path of ["/records?limit=1.5", "/records?limit=0", "/records?after=-1", "/records?after=9007199254740992", "/records/%FF"]) {
    assert.equal((await call(path)).status, 400, path);
  }
  assert.equal((await call("/debug/canonicalize", JSON.stringify({ x: "é".repeat(140000) }), { "content-length": "1" })).status, 413);
  assert.equal((await call("/debug/canonicalize", "[".repeat(70) + "0" + "]".repeat(70))).status, 400);
  assert.equal((await call("/debug/canonicalize", new Uint8Array([0xff]))).status, 400);
  let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536)); } });
  const response = await handle(new Request("http://local/dtp-store/debug/canonicalize", {
    method: "POST", body: stream, duplex: "half"
  } as any), { db: noop });
  assert.equal(response.status, 413);
  assert.ok(pulls <= 6, "stop consuming oversized streams");
});

test("A02: hidden rows do not truncate a module's record pagination", async () => {
  const owner = await makeCompany(base, "astra-page");
  const mod = await makeModule(base, publisher, "astra-page-reader");
  await grant(owner, mod, [{ type: "finance.invoice", access: "read" }]);
  for (let i = 0; i < 4; i++) await makeContract(owner, seller);
  const visible = await owner.client.sign(draft({ type: "trade.contract", subject_company_id: owner.id,
    counterparty_ids: [seller.id], visibility: "public",
    issuer: { key_id: owner.kp.keyId, company_id: owner.id, module_id: null },
    body: contractBody(owner.id, seller.id) }), owner.kp.secretKey);
  const seen: string[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await mod.client.listRecords({ subject: owner.id, limit: 1, after });
    seen.push(...page.records.map((r) => r.record_id));
    if (!page.next_cursor) break;
    after = page.next_cursor;
  }
  assert.equal(seen.includes(visible.record.record_id), true);
  assert.equal((await mod.client.getRecord(visible.record.record_id)).record_id, visible.record.record_id);
});

test("A03: latest_cursor never names an event outside the module's read scope", async () => {
  const mod = await makeModule(base, publisher, "astra-cursor-reader");
  const g = await grant(buyer, mod, [{ type: "finance.invoice", access: "read" }]);
  const hidden = await makeContract(buyer, seller);
  const feed = await mod.client.events({ after: String(g.record.seq) });
  assert.equal(feed.events.some((e) => e.record_id === hidden.record.record_id), false);
  assert.equal(feed.latest_cursor, String(g.record.seq).padStart(16, "0"));
});

test("A04: exact supersede retries return 200 even after further supersession", async () => {
  const original = await makeContract(buyer, seller);
  const env = await signRecord(revision(original.record, buyer, { x_note: "retry-me" }), buyer.kp.secretKey);
  const accepted = await buyer.client.write(env);
  await buyer.client.sign(revision(accepted.record, buyer, { x_note: "later" }), buyer.kp.secretKey);
  const replay = await buyer.client.request<any>("POST", "/records", env);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.created, false);
  assert.equal(replay.data.record.is_head, false);
  const chain = await buyer.client.listRecords({ root_id: original.record.root_id, include_superseded: true });
  assert.equal(chain.records.length, 3);
});

test("A05: anonymous and outsider writes reveal no private target details", async () => {
  const privateRecord = await makeContract(buyer, seller);
  const attacker = await makeCompany(base, "astra-outsider");
  const attack = await signRecord(draft({ type: "trade.contract", subject_company_id: buyer.id,
    counterparty_ids: [attacker.id], visibility: "counterparties",
    root_id: privateRecord.record.root_id, supersedes: privateRecord.record.record_id,
    issuer: { key_id: attacker.kp.keyId, company_id: attacker.id, module_id: null },
    body: contractBody(buyer.id, attacker.id) }), attacker.kp.secretKey);
  assert.equal((await errorOf(base.getRecord(privateRecord.record.record_id))).status, 404);
  assert.equal((await errorOf(base.write(attack))).code, "auth_required");
  const hidden = await errorOf(attacker.client.write(attack));
  const missing = await errorOf(attacker.client.sign({ ...attack, record_id: crypto.randomUUID(), supersedes: crypto.randomUUID() }, attacker.kp.secretKey));
  assert.equal(hidden.code, "not_found");
  assert.equal(hidden.message, missing.message);
  assert.deepEqual(hidden.details, {});
});

test("A06: attested delivery terms and deductions cannot be rewritten", async () => {
  const contract = await makeContract(buyer, seller);
  const fulfillment = await makeFulfillment(seller, buyer, contract.record.root_id);
  const attested = await buyerAttest(buyer, seller, fulfillment);
  const error = await errorOf(seller.client.sign(revision(attested.record, seller, {
    contract_id: crypto.randomUUID(), quantity_delivered: { amount: "99999", unit: "case" }
  }), seller.kp.secretKey));
  assert.equal(error.code, "transition_forbidden");
  assert.equal((await errorOf(seller.client.sign(revision(attested.record, seller, {
    deductions: [{ reason: "rewrite", amount: { amount: "99", currency: "USD" } }]
  }), seller.kp.secretKey))).code, "transition_forbidden");
});

test("A07: a permitted seller status transition cannot rewrite contract price", async () => {
  const c = await makeContract(buyer, seller);
  const error = await errorOf(seller.client.sign(revision(c.record, seller, {
    status: "in_fulfillment", total_value: { amount: "999999", currency: "USD" }
  }), seller.kp.secretKey));
  assert.equal(error.code, "transition_forbidden");
});

test("A08: immutable settlement_event rejects supersession and allows compensating events", async () => {
  const first = await buyer.client.sign(draft({ type: "finance.settlement_event", subject_company_id: buyer.id,
    counterparty_ids: [seller.id], issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    body: { kind: "buyer_payment", from_company_id: buyer.id, to_company_id: seller.id,
      amount: { amount: "100", currency: "USD" }, occurred_at: nowIso(), rail: "mock", references: {}, reverses: null }
  }), buyer.kp.secretKey);
  assert.equal((await errorOf(buyer.client.sign(revision(first.record, buyer, { amount: { amount: "1", currency: "USD" } }), buyer.kp.secretKey))).code, "transition_forbidden");
  const correction = await buyer.client.sign(draft({ type: first.record.type, subject_company_id: buyer.id,
    counterparty_ids: [seller.id], issuer: first.record.issuer, body: { ...first.record.body, kind: "adjustment", reverses: first.record.root_id }
  }), buyer.kp.secretKey);
  assert.notEqual(correction.record.root_id, first.record.root_id);
});

test("A09: buyer_attested requires evidence identifying the exact buyer-signed version", async () => {
  const c = await makeContract(buyer, seller);
  const f = await makeFulfillment(seller, buyer, c.record.root_id);
  assert.equal((await errorOf(buyer.client.sign(revision(f.record, buyer, { status: "buyer_attested", buyer_attestation: null }), buyer.kp.secretKey))).code, "transition_forbidden");
  assert.equal((await errorOf(buyer.client.sign(revision(f.record, buyer, { status: "buyer_attested",
    buyer_attestation: { company_id: buyer.id, record_id: f.record.record_id, attested_at: nowIso() }
  }), buyer.kp.secretKey))).code, "transition_forbidden");
});

test("A10: genesis retry returns 200 without reissuing a bearer token", async () => {
  const kp = await generateKeyPair();
  const id = uniq("astra-retry") + ".dtp";
  const env = await signRecord(draft({ type: "core.company", subject_company_id: id, visibility: "public",
    issuer: { key_id: kp.keyId, company_id: id, module_id: null }, body: companyBody(kp, "Retry") }), kp.secretKey);
  const first = await base.request<any>("POST", "/companies", env);
  const replay = await base.request<any>("POST", "/companies", env);
  assert.equal(first.data.keys.length, 1);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.created, false);
  assert.deepEqual(replay.data.keys, []);
});

test("A11: revoking or demoting the sole root key cannot strand the company", async () => {
  const owner = await makeCompany(base, "astra-lockout");
  const prev = await owner.client.getRecord(owner.companyRecordId);
  const body = prev.body as any;
  assert.equal((await errorOf(owner.client.sign(revision(prev, owner, { keys: body.keys.map((k: any) => ({ ...k, status: "revoked", revoked_at: nowIso() })) }), owner.kp.secretKey))).code, "forbidden");
  assert.equal((await errorOf(owner.client.sign(revision(prev, owner, { keys: body.keys.map((k: any) => ({ ...k, role: "delegate" })) }), owner.kp.secretKey))).code, "forbidden");
  assert.equal((await base.getCompany(owner.id)).active_keys.length, 1);
  assert.equal((await owner.client.whoami()).role, "root");
});

test("A12: an in-flight write reauthorizes after a preceding revocation commits", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(readFileSync(new URL("../../supabase/migrations/20260903000000_protocol_store.sql", import.meta.url), "utf8"));
    const db = pgliteDb(pg);
    async function post(path: string, env: unknown, token?: string, selectedDb = db, expectedStatus = 201) {
      const response = await handle(new Request("http://local/dtp-store" + path, {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(env)
      }), { db: selectedDb });
      const data: any = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(data));
      return data;
    }
    const kp = await generateKeyPair();
    const id = "astra-interleave.dtp";
    const company = await post("/companies", await signRecord(draft({ type: "core.company", subject_company_id: id,
      visibility: "public", issuer: { key_id: kp.keyId, company_id: id, module_id: null }, body: companyBody(kp, "Interleave") }), kp.secretKey));
    const token = company.keys[0].token;
    const mk = await generateKeyPair();
    const moduleId = "astra-interleave-module";
    const module = await post("/modules", await signRecord(draft({ type: "core.module", subject_company_id: id, visibility: "public",
      issuer: { key_id: mk.keyId, company_id: id, module_id: moduleId }, body: { module_id: moduleId, name: "Interleave",
        publisher_company_id: id, keys: [{ key_id: mk.keyId, role: "root", status: "active", added_at: nowIso() }] } }), mk.secretKey), token);
    const g = await post("/records", await signRecord(draft({ type: "core.grant", subject_company_id: id, visibility: "private",
      issuer: { key_id: kp.keyId, company_id: id, module_id: null }, body: { module_id: moduleId,
        scopes: [{ namespace: "finance", access: "write" }], status: "active", expires_at: null } }), kp.secretKey), token);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const gated: Db = { query: (sql, params) => db.query(sql, params), transaction: async (fn) => {
      reached(); await resume; return db.transaction(fn);
    } };
    const env = await signRecord(draft({ type: "finance.settlement_event", subject_company_id: id, visibility: "private",
      issuer: { key_id: mk.keyId, company_id: id, module_id: moduleId }, body: { kind: "adjustment", from_company_id: id,
        to_company_id: id, amount: { amount: "1", currency: "USD" }, occurred_at: nowIso(), rail: "mock", references: {}, reverses: null }
    }), mk.secretKey);
    const inFlight = post("/records", env, module.keys[0].token, gated, 403);
    await paused;
    try {
      await post("/records", await signRecord(draft({ type: "core.grant", subject_company_id: id, visibility: "private",
        supersedes: g.record.record_id, root_id: g.record.root_id,
        issuer: { key_id: kp.keyId, company_id: id, module_id: null }, body: { ...g.record.body, status: "revoked" } }), kp.secretKey), token);
    } finally { release(); }
    const completed = await inFlight;
    const grants = await db.query<any>("select status from protocol.grants");
    assert.equal(grants[0].status, "revoked");
    assert.equal(completed.error.code, "grant_missing");
    assert.equal((await db.query("select 1 from protocol.records where record_id = $1", [env.record_id])).length, 0);
  } finally { await pg.close(); }
});
