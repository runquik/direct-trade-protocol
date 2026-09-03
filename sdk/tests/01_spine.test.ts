import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, draft, StoreRequestError } from "../src/client.ts";
import { generateKeyPair, signRecord, nowIso, type Envelope } from "../src/index.ts";
import { companyBody, makeCompany, makeModule, storeUnderTest, uniq } from "./helpers.ts";

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
});
after(async () => store.close());

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof StoreRequestError, `expected StoreRequestError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

test("health reports protocol version", async () => {
  const h = await base.health();
  assert.equal(h.status, "ok");
  assert.equal(h.protocol_version, "0.2");
});

test("company genesis is self-certifying and mints a token per active key", async () => {
  const c = await makeCompany(base, "acme");
  assert.match(c.token, /^dtps_[0-9a-f]{48}$/);
  const me = await c.client.whoami();
  assert.equal(me.kind, "company");
  assert.equal(me.id, c.id);
  assert.equal(me.role, "root");
  const view = await base.getCompany(c.id);
  assert.equal(view.record.type, "core.company");
  assert.equal(view.active_keys.length, 1);
  assert.equal(view.grants_issued, undefined, "anonymous callers do not see grants");
  const own = await c.client.getCompany(c.id);
  assert.deepEqual(own.grants_issued, []);
});

test("genesis signed by a key not in body.keys is rejected", async () => {
  const listed = await generateKeyPair();
  const other = await generateKeyPair();
  const id = uniq("bad") + ".dtp";
  const unsigned = draft({ type: "core.company", subject_company_id: id, issuer: { key_id: other.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(listed, "Bad") });
  const env = (await signRecord(unsigned, other.secretKey)) as Envelope;
  await expectCode(base.createCompany(env), "forbidden");
});

test("genesis with a tampered signature is rejected", async () => {
  const kp = await generateKeyPair();
  const id = uniq("tamper") + ".dtp";
  const unsigned = draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, "Tamper") });
  const env = (await signRecord(unsigned, kp.secretKey)) as Envelope;
  env.body = { ...env.body, display_name: "Changed" };
  await expectCode(base.createCompany(env), "signature_invalid");
});

test("duplicate company id is rejected", async () => {
  const c = await makeCompany(base, "dupe");
  const kp = await generateKeyPair();
  const unsigned = draft({ type: "core.company", subject_company_id: c.id, issuer: { key_id: kp.keyId, company_id: c.id, module_id: null }, visibility: "public", body: companyBody(kp, "Dupe") });
  await expectCode(base.createCompany((await signRecord(unsigned, kp.secretKey)) as Envelope), "duplicate_record_id");
});

test("company id must follow the NEAR account grammar", async () => {
  const kp = await generateKeyPair();
  const id = "Bad Name.dtp";
  const unsigned = draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, "Bad") });
  await expectCode(base.createCompany((await signRecord(unsigned, kp.secretKey)) as Envelope), "envelope_invalid");
});

test("genesis core.company via POST /records is redirected to /companies", async () => {
  const kp = await generateKeyPair();
  const id = uniq("viarecords") + ".dtp";
  const unsigned = draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, "X") });
  await expectCode(base.write((await signRecord(unsigned, kp.secretKey)) as Envelope), "bad_request");
});

test("company can rotate keys by superseding its spine with a root key", async () => {
  const c = await makeCompany(base, "rotate");
  const k2 = await generateKeyPair();
  const now = nowIso();
  const prevBody = (await base.getCompany(c.id)).record.body as any;
  const unsigned = draft({
    type: "core.company",
    subject_company_id: c.id,
    root_id: c.companyRecordId,
    supersedes: c.companyRecordId,
    issuer: { key_id: c.kp.keyId, company_id: c.id, module_id: null },
    visibility: "public",
    body: { ...prevBody, keys: [...prevBody.keys, { key_id: k2.keyId, role: "delegate", label: "agent", status: "active", added_at: now, revoked_at: null, near_account: null }] },
  });
  const r = await c.client.sign(unsigned, c.kp.secretKey);
  assert.equal(r.created, true);
  assert.equal(r.keys?.length, 1, "one new key minted");
  assert.equal(r.keys![0].key_id, k2.keyId);
  const me = await base.with(r.keys![0].token).whoami();
  assert.equal(me.role, "delegate");
  // delegate key cannot write core.*
  const again = draft({
    type: "core.company",
    subject_company_id: c.id,
    root_id: c.companyRecordId,
    supersedes: r.record.record_id,
    issuer: { key_id: k2.keyId, company_id: c.id, module_id: null },
    visibility: "public",
    body: r.record.body,
  });
  await expectCode(base.with(r.keys![0].token).sign(again, k2.secretKey), "forbidden");
  assert.equal((await base.getCompany(c.id)).active_keys.length, 2);
});

test("module genesis: self-certified by its own root key", async () => {
  const pub = await makeCompany(base, "publisher", { business_type: "service_provider" });
  const m = await makeModule(base, pub, "demo-financing", [{ namespace: "trade", access: "read" }, { namespace: "finance", access: "write" }]);
  const me = await m.client.whoami();
  assert.equal(me.kind, "module");
  assert.equal(me.id, m.id);
  const view = await base.getModule(m.id);
  assert.equal(view.publisher_company_id, pub.id);
});

test("module genesis: publisher-signed requires the publisher root token", async () => {
  const pub = await makeCompany(base, "publisher2", { business_type: "service_provider" });
  const modKp = await generateKeyPair();
  const id = uniq("pubsigned");
  const now = nowIso();
  const body = { module_id: id, name: "pubsigned", publisher_company_id: pub.id, description: null, homepage: null, keys: [{ key_id: modKp.keyId, role: "root", label: null, status: "active", added_at: now, revoked_at: null, near_account: null }], requested_scopes: [] };
  const unsigned = draft({ type: "core.module", subject_company_id: pub.id, issuer: { key_id: pub.kp.keyId, company_id: pub.id, module_id: null }, visibility: "public", body });
  const env = (await signRecord(unsigned, pub.kp.secretKey)) as Envelope;
  await expectCode(base.createModule(env), "forbidden"); // no token
  const r = await pub.client.createModule(env);
  assert.equal(r.module_id, id);
  assert.equal(r.keys?.length, 1);
});

test("unknown bearer token is rejected", async () => {
  await expectCode(base.with("dtps_" + "0".repeat(48)).whoami(), "auth_invalid");
  await expectCode(base.with("nonsense").whoami(), "auth_invalid");
});
