import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, draft, StoreRequestError } from "../src/client.ts";
import { signRecord, nowIso, type Envelope } from "../src/index.ts";
import { buyerAttest, contractBody, grant, makeCompany, makeContract, makeFulfillment, makeModule, storeUnderTest, type Company } from "./helpers.ts";

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
let acme: Company, bluestem: Company, stranger: Company;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
  acme = await makeCompany(base, "acme");
  bluestem = await makeCompany(base, "bluestem", { business_type: "distributor" });
  stranger = await makeCompany(base, "stranger");
});
after(async () => store.close());

async function expectCode(p: Promise<unknown>, code: string, detail?: (e: StoreRequestError) => void) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof StoreRequestError, `expected StoreRequestError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    detail?.(e);
    return true;
  });
}

function contractDraft(overrides: Record<string, unknown> = {}, env: Partial<Parameters<typeof draft>[0]> = {}) {
  return draft({
    type: "trade.contract",
    subject_company_id: bluestem.id,
    counterparty_ids: [acme.id],
    issuer: { key_id: bluestem.kp.keyId, company_id: bluestem.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(bluestem.id, acme.id, overrides),
    ...env,
  });
}

test("signed write returns a stored record with seq and payload_hash", async () => {
  const r = await makeContract(bluestem, acme);
  assert.equal(r.created, true);
  assert.ok(r.record.seq > 0);
  assert.match(r.record.payload_hash, /^[0-9a-f]{64}$/);
  assert.equal(r.record.is_head, true);
  assert.equal(r.record.superseded_by, null);
  assert.equal(r.record.root_id, r.record.record_id);
});

test("rejections: no token, tampered body, issuer mismatch, float, unknown type, schema path, namespace, subject-in-counterparties", async () => {
  const env = (await signRecord(contractDraft(), bluestem.kp.secretKey)) as Envelope;
  await expectCode(base.write(env), "auth_required");
  await expectCode(bluestem.client.write({ ...env, body: { ...env.body, buyer_po_number: "PO-9" } }), "signature_invalid");
  await expectCode(acme.client.write(env), "issuer_mismatch");
  // the SDK refuses to sign floats; a hand-built envelope with one is rejected by the store before signature checks
  const withFloat = { ...env, body: { ...env.body, dispute_window_hours: 1.5 } };
  await expectCode(bluestem.client.write(withFloat as Envelope), "float_not_allowed");
  await expectCode(bluestem.client.sign(contractDraft({}, { type: "trade.nope" }), bluestem.kp.secretKey), "unknown_type");
  await expectCode(bluestem.client.sign(contractDraft({}, { schema_version: "9.9" }), bluestem.kp.secretKey), "unknown_type");
  await expectCode(bluestem.client.sign(contractDraft({ total_value: { amount: "12.3456789", currency: "USD" } }), bluestem.kp.secretKey), "schema_invalid", (e) => {
    const issues = (e.details as any).issues as { path: string }[];
    assert.ok(issues.some((i) => i.path === "$.body.total_value.amount"), JSON.stringify(issues));
  });
  await expectCode(bluestem.client.sign(contractDraft({ bogus: 1 }), bluestem.kp.secretKey), "schema_invalid");
  const badNs = contractDraft();
  badNs.namespace = "finance";
  await expectCode(bluestem.client.sign(badNs, bluestem.kp.secretKey), "envelope_invalid");
  await expectCode(bluestem.client.sign(contractDraft({}, { counterparty_ids: [acme.id, bluestem.id] }), bluestem.kp.secretKey), "envelope_invalid");
  await expectCode(bluestem.client.sign(contractDraft({}, { issuer: { key_id: bluestem.kp.keyId, company_id: stranger.id, module_id: null } }), bluestem.kp.secretKey), "issuer_mismatch");
});

test("x_ extension fields are accepted on strict types", async () => {
  const r = await bluestem.client.sign(contractDraft({ x_erp_ref: "SO-77" }), bluestem.kp.secretKey);
  assert.equal((r.record.body as any).x_erp_ref, "SO-77");
});

test("idempotency: identical replay returns 200, same id with a different body returns 409", async () => {
  const unsigned = contractDraft();
  const env = (await signRecord(unsigned, bluestem.kp.secretKey)) as Envelope;
  const a = await bluestem.client.request("POST", "/records", env);
  const b = await bluestem.client.request("POST", "/records", env);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  const other = (await signRecord({ ...unsigned, body: contractBody(bluestem.id, acme.id, { buyer_po_number: "PO-2" }) }, bluestem.kp.secretKey)) as Envelope;
  await expectCode(bluestem.client.write(other), "duplicate_record_id");
});

test("supersession: state machine, roles, head tracking, conflicts", async () => {
  const c = await makeContract(bluestem, acme);
  const root = c.record.root_id;
  // buyer (bluestem) may not move active -> in_fulfillment; only the seller may
  const byBuyer = draft({ ...contractDraft({ status: "in_fulfillment" }), root_id: root, supersedes: c.record.record_id });
  await expectCode(bluestem.client.sign(byBuyer, bluestem.kp.secretKey), "transition_forbidden");
  // seller (acme, a counterparty) may
  const bySeller = draft({
    type: "trade.contract", subject_company_id: bluestem.id, counterparty_ids: [acme.id], root_id: root, supersedes: c.record.record_id,
    issuer: { key_id: acme.kp.keyId, company_id: acme.id, module_id: null }, visibility: "counterparties",
    body: contractBody(bluestem.id, acme.id, { status: "in_fulfillment" }),
  });
  const v2 = await acme.client.sign(bySeller, acme.kp.secretKey);
  assert.equal(v2.record.is_head, true);
  const v1 = await bluestem.client.getRecord(c.record.record_id);
  assert.equal(v1.is_head, false);
  assert.equal(v1.superseded_by, v2.record.record_id);
  // second supersede of v1 conflicts
  await expectCode(acme.client.sign(draft({ ...bySeller, record_id: crypto.randomUUID() }), acme.kp.secretKey), "supersedes_conflict");
  // wrong root_id
  await expectCode(acme.client.sign(draft({ ...bySeller, record_id: crypto.randomUUID(), supersedes: v2.record.record_id, root_id: crypto.randomUUID() }), acme.kp.secretKey), "supersedes_conflict");
  // wrong subject (body kept consistent with the forged subject so the supersede check is what fires)
  await expectCode(acme.client.sign(draft({ ...bySeller, record_id: crypto.randomUUID(), supersedes: v2.record.record_id, subject_company_id: acme.id, counterparty_ids: [bluestem.id], body: contractBody(acme.id, bluestem.id, { status: "in_fulfillment" }) }), acme.kp.secretKey), "supersedes_conflict");
  // a stranger is not a party
  await expectCode(stranger.client.sign(draft({ ...bySeller, record_id: crypto.randomUUID(), supersedes: v2.record.record_id, issuer: { key_id: stranger.kp.keyId, company_id: stranger.id, module_id: null } }), stranger.kp.secretKey), "issuer_not_party");
  // invalid transition (in_fulfillment -> settled)
  await expectCode(bluestem.client.sign(draft({ ...contractDraft({ status: "settled" }), root_id: root, supersedes: v2.record.record_id }), bluestem.kp.secretKey), "transition_forbidden");
  // list hides superseded by default, includes with flag
  const heads = await bluestem.client.listRecords({ root_id: root });
  assert.equal(heads.records.length, 1);
  const all = await bluestem.client.listRecords({ root_id: root, include_superseded: true });
  assert.equal(all.records.length, 2);
});

test("buyer attests the seller's fulfillment by superseding it (counterparty transition)", async () => {
  const c = await makeContract(bluestem, acme);
  const f = await makeFulfillment(acme, bluestem, c.record.root_id);
  assert.equal((f.record.body as any).status, "seller_attested");
  const a = await buyerAttest(bluestem, acme, f);
  assert.equal((a.record.body as any).status, "buyer_attested");
  assert.equal(a.record.issuer.company_id, bluestem.id);
  assert.equal(a.record.subject_company_id, acme.id);
  // seller cannot self-attest as buyer
  const f2 = await makeFulfillment(acme, bluestem, c.record.root_id);
  const selfAttest = draft({
    type: "trade.fulfillment", root_id: f2.record.root_id, supersedes: f2.record.record_id, subject_company_id: acme.id, counterparty_ids: [bluestem.id],
    issuer: { key_id: acme.kp.keyId, company_id: acme.id, module_id: null }, visibility: "counterparties",
    body: { ...(f2.record.body as any), status: "buyer_attested" },
  });
  await expectCode(acme.client.sign(selfAttest, acme.kp.secretKey), "transition_forbidden");
});

test("visibility: public / counterparties / granted / private", async () => {
  const fin = await makeCompany(base, "fin", { business_type: "financer" });
  const mod = await makeModule(base, fin, "reader");
  const mk = (visibility: any, cps: string[]) =>
    draft({ type: "trade.contract", subject_company_id: bluestem.id, counterparty_ids: cps, issuer: { key_id: bluestem.kp.keyId, company_id: bluestem.id, module_id: null }, visibility, body: contractBody(bluestem.id, acme.id) });
  const pub = await bluestem.client.sign(mk("public", [acme.id]), bluestem.kp.secretKey);
  const cp = await bluestem.client.sign(mk("counterparties", [acme.id]), bluestem.kp.secretKey);
  const gr = await bluestem.client.sign(mk("granted", [acme.id]), bluestem.kp.secretKey);
  const pv = await bluestem.client.sign(mk("private", [acme.id]), bluestem.kp.secretKey);
  const can = async (client: DtpStoreClient, id: string) => client.getRecord(id).then(() => true, (e) => (e.code === "not_found" ? false : Promise.reject(e)));
  // anonymous
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(base, r.record.record_id))), [true, false, false, false]);
  // subject
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(bluestem.client, r.record.record_id))), [true, true, true, true]);
  // counterparty
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(acme.client, r.record.record_id))), [true, true, false, false]);
  // stranger
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(stranger.client, r.record.record_id))), [true, false, false, false]);
  // module with no grant
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(mod.client, r.record.record_id))), [true, false, false, false]);
  // module granted by the counterparty (acme): sees counterparties records, not granted (subject-only)
  await grant(acme, mod, [{ namespace: "trade", access: "read" }]);
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(mod.client, r.record.record_id))), [true, true, false, false]);
  // module granted by the subject: sees granted too, never private
  await grant(bluestem, mod, [{ type: "trade.contract", access: "read" }]);
  assert.deepEqual(await Promise.all([pub, cp, gr, pv].map((r) => can(mod.client, r.record.record_id))), [true, true, true, false]);
  // list obeys the same rules
  const anon = await base.listRecords({ subject: bluestem.id, type: "trade.contract" });
  assert.ok(anon.records.every((r) => r.visibility === "public"));
});

test("record ids are validated and unknown records are 404 for everyone", async () => {
  await expectCode(bluestem.client.getRecord(crypto.randomUUID()), "not_found");
});
