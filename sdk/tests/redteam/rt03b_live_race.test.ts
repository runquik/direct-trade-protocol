// RED-TEAM rt03b: fire N concurrent supersedes of the SAME head and look for a loser mapped to
// `internal`/500 instead of `supersedes_conflict`/409. Meaningful only against a multi-connection
// backend (the live Supabase deployment); on single-connection PGlite the writes serialize.
//
//   STORE_URL=https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store \
//     node --test tests/redteam/rt03b_live_race.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, draft, attempt, log, type Env } from "./rt-helpers.ts";
import { contractBody } from "../helpers.ts";

let env: Env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

test("D-live: N concurrent supersedes of one head — any 500 confirms the error-mapping bug", async () => {
  const buyer = await makeCompany(env.base, "wb-nrace-b");
  const seller = await makeCompany(env.base, "wb-nrace-s");
  const g = draft({
    type: "trade.contract",
    subject_company_id: buyer.id, counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, { status: "active" }),
  });
  const head = (await buyer.client.sign(g, buyer.kp.secretKey)).record;

  const N = env.live ? 6 : 3;
  const mk = () => draft({
    type: "trade.contract", record_id: crypto.randomUUID(), root_id: head.root_id, supersedes: head.record_id,
    subject_company_id: buyer.id, counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties", body: { ...head.body, x_n: crypto.randomUUID(), status: "active" },
  });
  const results = await Promise.all(
    Array.from({ length: N }, () => attempt(buyer.client.sign(mk(), buyer.kp.secretKey))),
  );
  const summary = results.map((r) => ({ ok: r.ok, code: r.code, status: r.status }));
  log("D-live results", summary);

  const winners = summary.filter((r) => r.ok);
  const internal500 = summary.filter((r) => !r.ok && (r.code === "internal" || r.status === 500));
  const conflicts = summary.filter((r) => r.code === "supersedes_conflict");
  log("D-live tally", { winners: winners.length, conflicts: conflicts.length, internal500: internal500.length });

  assert.equal(winners.length, 1, "exactly one supersede should win");
  // The finding: losers should ALL be 409 supersedes_conflict. Any 500 is the bug.
  assert.equal(internal500.length, 0,
    `CONFIRMED (if this fails): ${internal500.length} concurrent loser(s) returned internal/500 instead of supersedes_conflict/409`);
});
