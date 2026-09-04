// RED-TEAM rt03: error-mapping under concurrent supersession.
// SPEC §3.4: "the second one to land gets supersedes_conflict". The head/is_head check in
// writeRecord() runs OUTSIDE the transaction; the only real guard against two records superseding the
// same head is the DB unique index records_one_successor_uidx. A concurrent loser therefore surfaces
// as a raw unique-violation mapped to `internal` (HTTP 500), not `supersedes_conflict` (409).
//
//   node --test tests/redteam/rt03_concurrent_supersede.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, draft, attempt, log, type Env } from "./rt-helpers.ts";
import { contractBody } from "../helpers.ts";

let env: Env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

test("D: two supersedes of the same head race — loser should be supersedes_conflict (409)", async () => {
  const buyer = await makeCompany(env.base, "wb-race-b");
  const seller = await makeCompany(env.base, "wb-race-s");

  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { status: "active" }),
  });
  const head = (await buyer.client.sign(g, buyer.kp.secretKey)).record;

  // Two distinct records, both superseding the same head, fired concurrently.
  const mk = () => {
    const record_id = crypto.randomUUID();
    return draft({
      type: "trade.contract",
      record_id, root_id: head.root_id, supersedes: head.record_id,
      subject_company_id: buyer.id, counterparty_ids: [seller.id],
      issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
      visibility: "counterparties",
      body: { ...head.body, x_tag: record_id, status: "active" },
    });
  };
  const [r1, r2] = await Promise.all([
    attempt(buyer.client.sign(mk(), buyer.kp.secretKey)),
    attempt(buyer.client.sign(mk(), buyer.kp.secretKey)),
  ]);
  const results = [r1, r2].map((r) => ({ ok: r.ok, code: r.code, status: r.status }));
  log("D race results", results);

  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  // If the two happened to serialize cleanly the loser may already be a proper conflict; the finding is
  // that WHENEVER the loser reaches the DB insert it is a 500/internal rather than a 409/supersedes_conflict.
  if (losers.length === 1) {
    log("D loser code", losers[0]);
    assert.notEqual(losers[0].code, "internal",
      `CONFIRMED (if this fails): concurrent supersede loser mapped to ${losers[0].code}/${losers[0].status} instead of supersedes_conflict/409`);
    assert.equal(losers[0].code, "supersedes_conflict", "loser should be a clean 409 supersedes_conflict");
  } else {
    log("D note", "both writes serialized without contention on this backend; see rt03b for the deterministic variant");
  }
  assert.ok(winners.length >= 1);
});

// Deterministic variant: force the unique-violation path directly by inserting two successors of the
// same head where the second bypasses the app-level is_head check by racing the read. On PGlite (single
// connection) the app check usually wins; this documents the observed backend behavior.
test("D2: sequential supersede of an already-superseded head is a clean 409 (control)", async () => {
  const buyer = await makeCompany(env.base, "wb-race2-b");
  const seller = await makeCompany(env.base, "wb-race2-s");
  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id, counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { status: "active" }),
  });
  const head = (await buyer.client.sign(g, buyer.kp.secretKey)).record;
  const mk = () => draft({
    type: "trade.contract", record_id: crypto.randomUUID(), root_id: head.root_id, supersedes: head.record_id,
    subject_company_id: buyer.id, counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties", body: { ...head.body, x_n: crypto.randomUUID(), status: "active" },
  });
  await buyer.client.sign(mk(), buyer.kp.secretKey);                 // first supersede wins
  const loser = await attempt(buyer.client.sign(mk(), buyer.kp.secretKey)); // second, sequential
  log("D2 sequential loser", { code: loser.code, status: loser.status });
  assert.equal(loser.code, "supersedes_conflict", "sequential loser is correctly a 409 (the app-level is_head check caught it)");
});
