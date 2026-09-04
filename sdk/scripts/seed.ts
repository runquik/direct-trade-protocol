// Seed a store with the Sprint 01 fixtures:
//   acme-sauce.dtp (brand) and bluestem-dist.dtp (distributor), a publisher company demo-fin.dtp with module
//   demo-financing, grants for the module, one trade.contract, and a fulfillment attested by both sides —
//   so an attested receivable exists on day 0.
//
//   STORE_URL=https://.../functions/v1/dtp-store node scripts/seed.ts
//   node scripts/seed.ts                 -> starts an in-process PGlite store, seeds it, prints, exits
//   node scripts/seed.ts --prefix sprint -> company ids like sprint-acme-sauce.dtp (use when the default ids are taken)
// Writes sdk/fixtures/dev-keys.json (gitignored) with every id, key, and token.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DtpStoreClient, draft } from "../src/client.ts";
import { generateKeyPair, signRecord, nowIso, type Envelope } from "../src/index.ts";
import { buyerAttest, companyBody, contractBody, fulfillmentBody, grant, type Company, type Module } from "../tests/helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const prefixIdx = args.indexOf("--prefix");
const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] + "-" : "";

let close = async () => {};
let url = process.env.STORE_URL?.replace(/\/+$/, "");
if (!url) {
  const { createDevStore } = await import("./dev-server.ts");
  process.env.DTP_DEV_PORT ??= "8787";
  const s = await createDevStore(process.env.DTP_DEV_DATA);
  url = s.url;
  close = s.close;
  console.log(`(no STORE_URL; seeded an in-process PGlite store at ${url} — it goes away when this process exits unless DTP_DEV_DATA is set)`);
}
const base = new DtpStoreClient(url);

async function company(id: string, name: string, business_type: string, gln: string | null): Promise<Company> {
  const kp = await generateKeyPair();
  const body = companyBody(kp, name, { business_type, gln });
  const env = (await signRecord(draft({ type: "core.company", subject_company_id: id, issuer: { key_id: kp.keyId, company_id: id, module_id: null }, visibility: "public", body }), kp.secretKey)) as Envelope;
  const r = await base.createCompany(env);
  const token = r.keys!.find((k) => k.key_id === kp.keyId)!.token;
  return { id, kp, token, client: base.with(token), companyRecordId: r.record.record_id };
}

async function module(publisher: Company, id: string, name: string): Promise<Module> {
  const kp = await generateKeyPair();
  const now = nowIso();
  const body = {
    module_id: id, name, publisher_company_id: publisher.id,
    description: "Sprint 01 M3: issues invoices and offers advances against attested receivables.",
    homepage: null,
    keys: [{ key_id: kp.keyId, role: "root", label: "prod", status: "active", added_at: now, revoked_at: null, near_account: null }],
    requested_scopes: [{ namespace: "trade", access: "read" }, { type: "core.company", access: "read" }, { namespace: "finance", access: "write" }],
  };
  const env = (await signRecord(draft({ type: "core.module", subject_company_id: publisher.id, issuer: { key_id: kp.keyId, company_id: publisher.id, module_id: id }, visibility: "public", body }), kp.secretKey)) as Envelope;
  const r = await publisher.client.createModule(env);
  const token = r.keys!.find((k) => k.key_id === kp.keyId)!.token;
  return { id, publisher, kp, token, client: base.with(token) };
}

const acme = await company(`${prefix}acme-sauce.dtp`, "Acme Sauce Co.", "brand", "0614141000012");
const bluestem = await company(`${prefix}bluestem-dist.dtp`, "Bluestem Distribution", "distributor", "0614141000029");
const fin = await company(`${prefix}demo-fin.dtp`, "Demo Financing Inc.", "financer", null);
const mod = await module(fin, `${prefix}demo-financing`, "Demo Financing");

await grant(acme, mod, [{ namespace: "trade", access: "read" }, { type: "core.company", access: "read" }, { namespace: "finance", access: "write" }]);
await grant(bluestem, mod, [{ namespace: "trade", access: "read" }, { namespace: "finance", access: "read" }]);

// Bluestem buys 120 cases from Acme
const contract = await bluestem.client.sign(
  draft({ type: "trade.contract", subject_company_id: bluestem.id, counterparty_ids: [acme.id], issuer: { key_id: bluestem.kp.keyId, company_id: bluestem.id, module_id: null }, visibility: "counterparties", body: contractBody(bluestem.id, acme.id) }),
  bluestem.kp.secretKey,
);
// Acme ships and attests; Bluestem attests receipt by superseding
const fulfillmentId = crypto.randomUUID();
const fulfillment = await acme.client.sign(
  draft({ type: "trade.fulfillment", record_id: fulfillmentId, subject_company_id: acme.id, counterparty_ids: [bluestem.id], issuer: { key_id: acme.kp.keyId, company_id: acme.id, module_id: null }, visibility: "counterparties", body: fulfillmentBody(contract.record.root_id, acme.id, bluestem.id, fulfillmentId) }),
  acme.kp.secretKey,
);
const attested = await buyerAttest(bluestem, acme, fulfillment);

const out = {
  store_url: url,
  companies: {
    acme: { id: acme.id, key_id: acme.kp.keyId, secret_key: acme.kp.secretKey, token: acme.token, spine_record_id: acme.companyRecordId },
    bluestem: { id: bluestem.id, key_id: bluestem.kp.keyId, secret_key: bluestem.kp.secretKey, token: bluestem.token, spine_record_id: bluestem.companyRecordId },
    demo_fin: { id: fin.id, key_id: fin.kp.keyId, secret_key: fin.kp.secretKey, token: fin.token, spine_record_id: fin.companyRecordId },
  },
  module: { id: mod.id, publisher: fin.id, key_id: mod.kp.keyId, secret_key: mod.kp.secretKey, token: mod.token },
  records: {
    contract_root_id: contract.record.root_id,
    fulfillment_root_id: attested.record.root_id,
    fulfillment_head_record_id: attested.record.record_id,
  },
};
mkdirSync(resolve(here, "../fixtures"), { recursive: true });
writeFileSync(resolve(here, "../fixtures/dev-keys.json"), JSON.stringify(out, null, 2) + "\n");

console.log(`
Seeded ${url}

  ${acme.id}      brand        token ${acme.token}
  ${bluestem.id}  distributor  token ${bluestem.token}
  ${fin.id}       financer     token ${fin.token}
  module ${mod.id} (publisher ${fin.id})  token ${mod.token}
    grants: ${acme.id} -> trade read, core.company read, finance write
            ${bluestem.id} -> trade read, finance read

  trade.contract     root ${contract.record.root_id}   (bluestem buys 120 cases from acme, $5,040.00)
  trade.fulfillment  root ${attested.record.root_id}   status buyer_attested  <- an attested receivable, ready for M3

Keys and tokens saved to sdk/fixtures/dev-keys.json (gitignored). Secret keys sign; tokens authenticate.
`);
await close();
