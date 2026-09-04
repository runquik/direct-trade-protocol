// Concurrency tests against a DTP protocol store.
//   node race-store.test.ts                                   -> in-process PGlite store (via ../helpers.ts)
//   STORE_URL=https://.../functions/v1/dtp-store node race-store.test.ts   -> a live deployment (uses ~130 requests)
// Prints markdown tables of observed {status, code} distributions at the end.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DtpStoreClient, draft } from "../../src/client.ts";
import { generateKeyPair, nowIso, signRecord, type Envelope } from "../../src/index.ts";
import { companyBody, contractBody, makeCompany, makeContract, makeModule, storeUnderTest, uniq, type Company } from "../helpers.ts";

const N = Number(process.env.RACE_N ?? 10);
const LIVE = !!process.env.STORE_URL;
const report: string[] = [];

let store: Awaited<ReturnType<typeof storeUnderTest>>;
let base: DtpStoreClient;
before(async () => {
  store = await storeUnderTest();
  base = new DtpStoreClient(store.url);
  report.push(`## Concurrency results: ${LIVE ? `live (${store.url})` : "local PGlite (in-process)"}`, "");
});
after(async () => {
  console.log("\n" + report.join("\n") + "\n");
  await store.close();
});

interface Outcome {
  status: number;
  code: string;
  message: string;
  body: any;
}

async function raw(path: string, token: string | null, body: unknown): Promise<Outcome> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(store.url + path, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(t);
  } catch {
    /* non-JSON */
  }
  const code = res.ok ? (parsed?.created === false ? "ok (replay)" : "ok") : (parsed?.error?.code ?? "unparseable");
  return { status: res.status, code, message: parsed?.error?.message ?? "", body: parsed };
}

function tally(title: string, outcomes: Outcome[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of outcomes) {
    const k = `${o.status} ${o.code}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  report.push(`### ${title}`, "", "| status code | count | example message |", "|---|---|---|");
  for (const [k, c] of [...m.entries()].sort()) {
    const ex = outcomes.find((o) => `${o.status} ${o.code}` === k)!.message.replace(/\|/g, "/").slice(0, 110);
    report.push(`| ${k} | ${c} | ${ex} |`);
  }
  report.push("");
  return m;
}

const count = (m: Map<string, number>, pred: (k: string) => boolean) => [...m.entries()].filter(([k]) => pred(k)).reduce((a, [, c]) => a + c, 0);
const fiveHundreds = (m: Map<string, number>) => count(m, (k) => k.startsWith("5"));

test(`race 1: ${N} simultaneous superseding writes of the same head (different record_ids)`, async () => {
  const buyer = await makeCompany(base, "fz");
  const seller = await makeCompany(base, "fz", { business_type: "distributor" });
  const c = await makeContract(buyer, seller);
  const prev = c.record;
  const envs: Envelope[] = [];
  for (let i = 0; i < N; i++) {
    const unsigned = draft({
      type: "trade.contract",
      root_id: prev.root_id,
      supersedes: prev.record_id,
      subject_company_id: buyer.id,
      counterparty_ids: [seller.id],
      issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
      visibility: "counterparties",
      body: { ...(prev.body as any), buyer_po_number: `PO-race-${i}` },
    });
    envs.push((await signRecord(unsigned, buyer.kp.secretKey)) as Envelope);
  }
  const outcomes = await Promise.all(envs.map((e) => raw("/records", buyer.token, e)));
  const m = tally(`Race 1: ${N} concurrent supersedes of one head (POST /records)`, outcomes);
  // post-state
  const chain = await buyer.client.listRecords({ root_id: prev.root_id, include_superseded: true });
  const heads = chain.records.filter((r) => r.is_head);
  const old = await buyer.client.getRecord(prev.record_id);
  report.push(`Post-state: ${chain.records.length} records in the chain, ${heads.length} head(s); old head is_head=${old.is_head}, superseded_by=${old.superseded_by ? "set" : "null"}`, "");
  assert.equal(heads.length, 1, "exactly one head after the race");
  assert.equal(chain.records.length, 2, "exactly one successor was persisted");
  assert.equal(count(m, (k) => k.startsWith("201")), 1, "exactly one 201");
  assert.equal(fiveHundreds(m), 0, `no 500s (got ${fiveHundreds(m)})`);
  assert.equal(count(m, (k) => k === "409 supersedes_conflict"), N - 1, "losers get 409 supersedes_conflict");
});

test(`race 2: ${N} simultaneous genesis POST /companies for one company id with different keys`, async () => {
  const id = uniq("fz") + ".dtp";
  const envs: { env: Envelope; keyId: string }[] = [];
  for (let i = 0; i < N; i++) {
    const kp = await generateKeyPair();
    const unsigned = draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, `Race ${i}`) });
    envs.push({ env: (await signRecord(unsigned, kp.secretKey)) as Envelope, keyId: kp.keyId });
  }
  const outcomes = await Promise.all(envs.map((e) => raw("/companies", null, e.env)));
  const m = tally(`Race 2: ${N} concurrent genesis writes for one company id (POST /companies)`, outcomes);
  const view = await base.getCompany(id);
  const winners = outcomes.map((o, i) => (o.status === 201 ? envs[i].keyId : null)).filter(Boolean) as string[];
  report.push(`Post-state: company exists with ${view.active_keys.length} active key(s); winner key listed: ${winners.length === 1 && view.active_keys[0]?.key_id === winners[0]}`, "");
  assert.equal(count(m, (k) => k.startsWith("201")), 1, "exactly one 201");
  assert.equal(view.active_keys.length, 1);
  assert.equal(fiveHundreds(m), 0, `no 500s (got ${fiveHundreds(m)})`);
  assert.equal(count(m, (k) => k === "409 duplicate_record_id"), N - 1, "losers get 409 duplicate_record_id");
});

test(`race 3: ${N} identical-envelope replays of one record write (idempotency under contention)`, async () => {
  const buyer = await makeCompany(base, "fz");
  const seller = await makeCompany(base, "fz", { business_type: "distributor" });
  const unsigned = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id),
  });
  const env = (await signRecord(unsigned, buyer.kp.secretKey)) as Envelope;
  const outcomes = await Promise.all(Array.from({ length: N }, () => raw("/records", buyer.token, env)));
  const m = tally(`Race 3: ${N} identical replays of one envelope (POST /records)`, outcomes);
  const chain = await buyer.client.listRecords({ root_id: env.root_id, include_superseded: true });
  report.push(`Post-state: ${chain.records.length} record(s) with that root_id`, "");
  assert.equal(chain.records.length, 1);
  assert.equal(fiveHundreds(m), 0, `no 500s (got ${fiveHundreds(m)})`);
  assert.equal(count(m, (k) => k.startsWith("201")), 1, "exactly one 201");
  assert.equal(count(m, (k) => k.startsWith("200")), N - 1, "replays return 200");

  // the same for genesis: POST /companies has no idempotent path at all
  const kp = await generateKeyPair();
  const id = uniq("fz") + ".dtp";
  const g = (await signRecord(draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body: companyBody(kp, "Replay") }), kp.secretKey)) as Envelope;
  const gOutcomes = await Promise.all(Array.from({ length: 5 }, () => raw("/companies", null, g)));
  const gm = tally("Race 3b: 5 identical replays of one genesis envelope (POST /companies)", gOutcomes);
  const seq = await raw("/companies", null, g);
  report.push(`Sequential identical replay after the race: ${seq.status} ${seq.code} (spec 3.5 idempotency says an identical envelope should be 200)`, "");
  assert.equal(fiveHundreds(gm), 0, `no 500s (got ${fiveHundreds(gm)})`);
  assert.equal(count(gm, (k) => k.startsWith("201")), 1);
});

test("race 4: grant and the module write that depends on it, issued simultaneously", async () => {
  const rounds = LIVE ? 2 : 5;
  const outcomes: { grant: Outcome; write: Outcome; retry?: Outcome }[] = [];
  for (let i = 0; i < rounds; i++) {
    const acme = await makeCompany(base, "fz");
    const bluestem = await makeCompany(base, "fz", { business_type: "distributor" });
    const fin = await makeCompany(base, "fz", { business_type: "financer" });
    const mod = await makeModule(base, fin, "fz-mod");
    const contract = await makeContract(bluestem, acme);
    const grantEnv = (await signRecord(
      draft({
        type: "core.grant",
        subject_company_id: acme.id,
        issuer: { key_id: acme.kp.keyId, company_id: acme.id, module_id: null },
        visibility: "private",
        body: { module_id: mod.id, scopes: [{ type: "finance.invoice", access: "write" }], status: "active", expires_at: null, note: "race" },
      }),
      acme.kp.secretKey,
    )) as Envelope;
    const now = nowIso();
    const invoiceEnv = (await signRecord(
      draft({
        type: "finance.invoice",
        subject_company_id: acme.id,
        counterparty_ids: [bluestem.id],
        issuer: { key_id: mod.kp.keyId, company_id: acme.id, module_id: mod.id },
        visibility: "counterparties",
        body: {
          invoice_number: "INV-race", seller_company_id: acme.id, buyer_company_id: bluestem.id, contract_id: contract.record.root_id, fulfillment_id: null,
          line_items: [{ description: "x", sku: null, quantity: { amount: "1", unit: "case" }, unit_price: { amount: "1.00", currency: "USD" }, amount: { amount: "1.00", currency: "USD" } }],
          subtotal: { amount: "1.00", currency: "USD" }, deductions: [], total: { amount: "1.00", currency: "USD" },
          issued_at: now, due_at: now, payment_terms: { net_days: 30, paca_covered: false, early_pay_discount_bps: null },
          status: "issued", paid_amount: { amount: "0", currency: "USD" }, settlement_event_ids: [], assigned_to_company_id: null,
        },
      }),
      mod.kp.secretKey,
    )) as Envelope;
    const [grant, write] = await Promise.all([raw("/records", acme.token, grantEnv), raw("/records", mod.token, invoiceEnv)]);
    const o: { grant: Outcome; write: Outcome; retry?: Outcome } = { grant, write };
    if (write.status !== 201) o.retry = await raw("/records", mod.token, invoiceEnv);
    outcomes.push(o);
  }
  report.push("### Race 4: grant + dependent module write fired together", "", "| round | grant | write | retry after grant |", "|---|---|---|---|");
  outcomes.forEach((o, i) => report.push(`| ${i + 1} | ${o.grant.status} ${o.grant.code} | ${o.write.status} ${o.write.code} | ${o.retry ? `${o.retry.status} ${o.retry.code}` : "-"} |`));
  report.push("");
  for (const o of outcomes) {
    assert.equal(o.grant.status, 201, "grant must always land");
    assert.ok(o.write.status === 201 || (o.write.status === 403 && o.write.code === "grant_missing"), `write must be 201 or 403 grant_missing, got ${o.write.status} ${o.write.code} ${o.write.message}`);
    if (o.retry) assert.equal(o.retry.status, 201, "once the grant is visible the write succeeds");
  }
});

test("events: 50 quick writes, then page the feed with limit=7 from cursor 0; every record exactly once, in seq order", async () => {
  const subject = await makeCompany(base, "fz");
  const other = await makeCompany(base, "fz", { business_type: "distributor" });
  const written: string[] = [];
  const statuses = new Map<string, number>();
  for (let batch = 0; batch < 5; batch++) {
    const envs: Envelope[] = [];
    for (let i = 0; i < 10; i++) {
      const unsigned = draft({
        type: "trade.contract",
        subject_company_id: subject.id,
        counterparty_ids: [other.id],
        issuer: { key_id: subject.kp.keyId, company_id: subject.id, module_id: null },
        visibility: "counterparties",
        body: contractBody(subject.id, other.id, { buyer_po_number: `PO-${batch}-${i}` }),
      });
      envs.push((await signRecord(unsigned, subject.kp.secretKey)) as Envelope);
    }
    const outs = await Promise.all(envs.map((e) => raw("/records", subject.token, e)));
    outs.forEach((o, i) => {
      statuses.set(`${o.status} ${o.code}`, (statuses.get(`${o.status} ${o.code}`) ?? 0) + 1);
      if (o.status === 201) written.push(envs[i].record_id);
    });
  }
  report.push("### Events: 50 writes in 5 concurrent batches of 10, then paging", "", `Write outcomes: ${[...statuses.entries()].map(([k, v]) => `${k} x${v}`).join(", ")}`, "");
  assert.equal(written.length, 50, "all 50 writes accepted");
  const expected = new Set([...written, subject.companyRecordId]);

  for (const limit of [7, 17]) {
    const seen = new Map<string, number>();
    const seqs: string[] = [];
    let after = "0";
    let pages = 0;
    for (;;) {
      const page = await subject.client.events({ company: subject.id, after, limit });
      pages++;
      for (const e of page.events) {
        seen.set(e.record_id, (seen.get(e.record_id) ?? 0) + 1);
        seqs.push(e.cursor);
      }
      assert.ok(page.events.length <= limit);
      if (!page.next_cursor) break;
      assert.ok(page.next_cursor > after, "cursor advances");
      after = page.next_cursor;
      assert.ok(pages < 200, "paging terminates");
    }
    const dupes = [...seen.entries()].filter(([, c]) => c > 1);
    const missing = [...expected].filter((id) => !seen.has(id));
    const extra = [...seen.keys()].filter((id) => !expected.has(id));
    const ordered = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
    report.push(`limit=${limit}: ${pages} pages, ${seen.size} distinct events, dupes=${dupes.length}, missing=${missing.length}, unexpected=${extra.length}, strictly increasing cursors=${ordered}`);
    assert.equal(dupes.length, 0, `duplicates: ${JSON.stringify(dupes)}`);
    assert.equal(missing.length, 0, `missing: ${missing.join(",")}`);
    assert.equal(extra.length, 0, `unexpected: ${extra.join(",")}`);
    assert.ok(ordered, "seq order");
    assert.equal(pages, Math.ceil(expected.size / limit) + (expected.size % limit === 0 ? 0 : 0), `page count for limit ${limit}`);
  }
  report.push("");
});
