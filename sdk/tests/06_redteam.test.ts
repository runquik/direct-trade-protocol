// Regression tests for the Sprint 01 red-team findings (black-box, white-box, fuzz). Each test asserts the
// vulnerability is CLOSED. Original reproductions live in tests/redteam/ and tests/fuzz/.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, draft, StoreRequestError } from "../src/client.ts";
import { generateKeyPair, signRecord, nowIso, type Envelope } from "../src/index.ts";
import { buyerAttest, companyBody, contractBody, makeCompany, makeContract, makeFulfillment, makeModule, storeUnderTest, uniq, type Company } from "./helpers.ts";

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
let buyer: Company, seller: Company, stranger: Company, arbiter: Company;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
  buyer = await makeCompany(base, "buyer", { business_type: "distributor" });
  seller = await makeCompany(base, "seller");
  stranger = await makeCompany(base, "stranger");
  arbiter = await makeCompany(base, "arbiter", { business_type: "service_provider" });
});
after(async () => store.close());

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof StoreRequestError, `expected StoreRequestError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

function supersedeOf(prev: any, issuer: Company, body: Record<string, unknown>, env: Partial<Parameters<typeof draft>[0]> = {}) {
  return draft({
    type: prev.type,
    subject_company_id: prev.subject_company_id,
    counterparty_ids: prev.counterparty_ids,
    root_id: prev.root_id,
    supersedes: prev.record_id,
    issuer: { key_id: issuer.kp.keyId, company_id: issuer.id, module_id: null },
    visibility: prev.visibility,
    body,
    ...env,
  });
}

test("WB-CRITICAL: a stranger cannot hijack a record by naming itself as counterparty on a supersede", async () => {
  const c = await makeContract(buyer, seller);
  const attack = supersedeOf(c.record, stranger, { ...(c.record.body as any), total_value: { amount: "0.01", currency: "USD" } }, { counterparty_ids: [stranger.id] });
  await expectCode(stranger.client.sign(attack, stranger.kp.secretKey), "supersedes_conflict"); // counterparties are locked
  const attack2 = supersedeOf(c.record, stranger, { ...(c.record.body as any), total_value: { amount: "0.01", currency: "USD" } });
  await expectCode(stranger.client.sign(attack2, stranger.kp.secretKey), "issuer_not_party"); // and even with the right list, a stranger is not a party
  const head = await buyer.client.getRecord(c.record.record_id);
  assert.equal(head.is_head, true, "the original is still the head");
});

test("BB-F4: counterparty_ids and visibility cannot change across a supersede (no hiding/exposing)", async () => {
  const c = await makeContract(buyer, seller);
  const f = await makeFulfillment(seller, buyer, c.record.root_id);
  // seller tries to make the fulfillment private (hide it from the buyer)
  await expectCode(seller.client.sign(supersedeOf(f.record, seller, f.record.body as any, { visibility: "private" }), seller.kp.secretKey), "supersedes_conflict");
  // seller tries to drop the buyer: an empty list fails the envelope schema; swapping in a stranger fails continuity
  await expectCode(seller.client.sign(supersedeOf(f.record, seller, f.record.body as any, { counterparty_ids: [] }), seller.kp.secretKey), "envelope_invalid");
  await expectCode(seller.client.sign(supersedeOf(f.record, seller, f.record.body as any, { counterparty_ids: [stranger.id] }), seller.kp.secretKey), "supersedes_conflict");
  // seller tries to add an outsider
  await expectCode(seller.client.sign(supersedeOf(f.record, seller, f.record.body as any, { counterparty_ids: [buyer.id, stranger.id] }), seller.kp.secretKey), "supersedes_conflict");
  const still = await buyer.client.getRecord(f.record.record_id);
  assert.equal(still.is_head, true);
});

test("BB-F5: a counterparty cannot rewrite body fields under an unchanged status; the subject can", async () => {
  const c = await makeContract(buyer, seller); // subject = buyer
  const bySeller = supersedeOf(c.record, seller, { ...(c.record.body as any), total_value: { amount: "0.01", currency: "USD" } });
  await expectCode(seller.client.sign(bySeller, seller.kp.secretKey), "transition_forbidden");
  const byBuyer = supersedeOf(c.record, buyer, { ...(c.record.body as any), buyer_po_number: "PO-CORRECTED" });
  const r = await buyer.client.sign(byBuyer, buyer.kp.secretKey);
  assert.equal((r.record.body as any).buyer_po_number, "PO-CORRECTED");
});

test("WB-HIGH: x-dtp-subject binding is enforced — the body field must name the envelope subject", async () => {
  const bad = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(stranger.id, seller.id), // body says the buyer is the stranger
  });
  await expectCode(buyer.client.sign(bad, buyer.kp.secretKey), "schema_invalid");
});

test("WB-HIGH: roles come from the previous record and role fields are immutable; third-party roles cannot be a party", async () => {
  // buyer cannot appoint itself arbitrator at genesis
  await expectCode(makeContract(buyer, seller, { arbitrator_company_id: buyer.id }), "transition_forbidden");
  await expectCode(makeContract(buyer, seller, { arbitrator_company_id: seller.id }), "transition_forbidden");
  // a contract with a proper third-party arbitrator
  const c = await makeContract(buyer, seller, { arbitrator_company_id: arbiter.id });
  // the seller ships, the buyer disputes
  const v2 = await seller.client.sign(supersedeOf(c.record, seller, { ...(c.record.body as any), status: "in_fulfillment" }), seller.kp.secretKey);
  const v3 = await buyer.client.sign(supersedeOf(v2.record, buyer, { ...(v2.record.body as any), status: "disputed" }), buyer.kp.secretKey);
  // buyer cannot resolve its own dispute, nor swap the arbitrator to itself while doing so
  await expectCode(buyer.client.sign(supersedeOf(v3.record, buyer, { ...(v3.record.body as any), status: "resolved_buyer" }), buyer.kp.secretKey), "transition_forbidden");
  await expectCode(buyer.client.sign(supersedeOf(v3.record, buyer, { ...(v3.record.body as any), arbitrator_company_id: buyer.id, status: "resolved_buyer" }), buyer.kp.secretKey), "transition_forbidden");
  // the seller cannot rename the buyer (subject binding fires) nor itself (role continuity fires)
  await expectCode(seller.client.sign(supersedeOf(v3.record, seller, { ...(v3.record.body as any), buyer_company_id: stranger.id }), seller.kp.secretKey), "schema_invalid");
  await expectCode(seller.client.sign(supersedeOf(v3.record, seller, { ...(v3.record.body as any), seller_company_id: stranger.id }), seller.kp.secretKey), "transition_forbidden");
  // the arbitrator is not a party (not subject, not counterparty) — it cannot write to this record at all in v0.2
  // (design note: arbitration by a non-party is a gap-log item; here we assert the store does not let anyone else do it)
  await expectCode(arbiter.client.sign(supersedeOf(v3.record, arbiter, { ...(v3.record.body as any), status: "resolved_buyer" }), arbiter.kp.secretKey), "issuer_not_party");
});

test("WB/BB-F3: module genesis requires the publisher's own root token (no publisher spoofing)", async () => {
  const modKp = await generateKeyPair();
  const id = uniq("spoof");
  const now = nowIso();
  const body = { module_id: id, name: "Official Buyer Tool", publisher_company_id: buyer.id, description: null, homepage: null, keys: [{ key_id: modKp.keyId, role: "root", label: null, status: "active", added_at: now, revoked_at: null, near_account: null }], requested_scopes: [] };
  const env = (await signRecord(draft({ type: "core.module", subject_company_id: buyer.id, issuer: { key_id: modKp.keyId, company_id: buyer.id, module_id: id }, visibility: "public", body }), modKp.secretKey)) as Envelope;
  await expectCode(base.createModule(env), "forbidden"); // anonymous
  await expectCode(stranger.client.createModule(env), "forbidden"); // someone else's token
  const ok = await buyer.client.createModule(env); // the publisher itself
  assert.equal(ok.module_id, id);
});

test("BB-F2: malformed record ids on the read path are a clean 404", async () => {
  await expectCode(buyer.client.getRecord("abc"), "not_found");
  await expectCode(buyer.client.getRecord("..%2f..%2fhealth"), "not_found");
  const l = await buyer.client.listRecords({ root_id: "not-a-uuid" });
  assert.equal(l.records.length, 0);
});

test("BB-F1 / WB-MEDIUM: concurrent supersedes yield exactly one 201 and the rest 409 supersedes_conflict", async () => {
  const c = await makeContract(buyer, seller);
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      buyer.client.sign(supersedeOf(c.record, buyer, { ...(c.record.body as any), buyer_po_number: `PO-${i}` }), buyer.kp.secretKey).then(
        () => 201,
        (e) => (e instanceof StoreRequestError ? `${e.status}:${e.code}` : `ERR:${String(e)}`),
      ),
    ),
  );
  const wins = attempts.filter((a) => a === 201).length;
  const conflicts = attempts.filter((a) => a === "409:supersedes_conflict").length;
  assert.equal(wins, 1, JSON.stringify(attempts));
  assert.equal(conflicts, 7, JSON.stringify(attempts));
});

test("concurrent duplicate genesis: one 201, the rest duplicate_record_id (never 500)", async () => {
  const id = uniq("race") + ".dtp";
  const envs = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const kp = await generateKeyPair();
      return signRecord(draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, "Race") }), kp.secretKey);
    }),
  );
  const results = await Promise.all(envs.map((e) => base.createCompany(e as Envelope).then(() => 201, (err) => (err instanceof StoreRequestError ? err.code : "ERR"))));
  assert.equal(results.filter((r) => r === 201).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => r === "duplicate_record_id").length === 3, JSON.stringify(results));
});

test("BB-F6: latest_cursor is scoped to the caller's visibility", async () => {
  const c = await makeContract(buyer, seller); // counterparties-only; invisible to stranger
  const hiddenSeq = String(c.record.seq).padStart(16, "0");
  const s = await stranger.client.events();
  // whatever the stranger's latest_cursor is, it must be an event the stranger can actually read
  // (on a shared store other public writes may land later, so we cannot assert a fixed value)
  assert.notEqual(s.latest_cursor, hiddenSeq, "an outsider must not observe a hidden write via latest_cursor");
  if (Number(s.latest_cursor) > 0) {
    const tail = await stranger.client.events({ after: String(Number(s.latest_cursor) - 1) });
    assert.ok(tail.events.some((e) => e.cursor === s.latest_cursor), "latest_cursor must point at a visible event");
  }
  const own = await buyer.client.events({ company: buyer.id });
  assert.ok(own.latest_cursor >= hiddenSeq);
});

test("business_types is optional and plural; a company can be several things and roles are per record", async () => {
  const kp = await generateKeyPair();
  const id = uniq("multi") + ".dtp";
  const body = { ...companyBody(kp, "Multi"), business_types: ["brand", "distributor", "financer"] };
  const env = (await signRecord(draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body }), kp.secretKey)) as Envelope;
  const r = await base.createCompany(env);
  assert.deepEqual((r.record.body as any).business_types, ["brand", "distributor", "financer"]);
  const { business_types, ...noType } = body;
  const kp2 = await generateKeyPair();
  const id2 = uniq("none") + ".dtp";
  const env2 = (await signRecord(draft({ type: "core.company", subject_company_id: id2, issuer: { key_id: kp2.keyId, company_id: id2, module_id: null }, visibility: "public", body: { ...noType, keys: [{ key_id: kp2.keyId, role: "root", label: "root", status: "active", added_at: nowIso(), revoked_at: null, near_account: null }] } }), kp2.secretKey)) as Envelope;
  const r2 = await base.createCompany(env2);
  assert.equal((r2.record.body as any).business_types, undefined);
  // the same company is buyer on one contract and seller on another
  const multi = { id, kp, token: r.keys![0].token, client: base.with(r.keys![0].token), companyRecordId: r.record.record_id };
  const asBuyer = await makeContract(multi, seller);
  const asSeller = await makeContract(buyer, multi);
  assert.equal((asBuyer.record.body as any).buyer_company_id, id);
  assert.equal((asSeller.record.body as any).seller_company_id, id);
  await buyerAttest(buyer, multi, await makeFulfillment(multi, buyer, asSeller.record.root_id));
});
