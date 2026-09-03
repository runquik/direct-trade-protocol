// Shared fixtures for tests and the seed script. Every helper builds fresh identities so suites can run
// against a shared (even production) store without collisions.
import { generateKeyPair, type KeyPair } from "../src/keys.ts";
import { signRecord } from "../src/sign.ts";
import { nowIso, type Envelope } from "../src/envelope.ts";
import { DtpStoreClient, draft } from "../src/client.ts";
import { createDevStore } from "../scripts/dev-server.ts";

export function uniq(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Resolve the store under test: STORE_URL if set, else an in-process PGlite dev server. */
export async function storeUnderTest(): Promise<{ url: string; close: () => Promise<void> }> {
  if (process.env.STORE_URL) return { url: process.env.STORE_URL.replace(/\/+$/, ""), close: async () => {} };
  process.env.DTP_DEV_PORT = "0";
  const s = await createDevStore();
  return { url: s.url, close: s.close };
}

export interface Company {
  id: string;
  kp: KeyPair;
  token: string;
  client: DtpStoreClient;
  companyRecordId: string;
}

export function companyBody(kp: KeyPair, name: string, opts: { business_type?: string; gln?: string | null } = {}) {
  const now = nowIso();
  return {
    display_name: name,
    legal_name: `${name} LLC`,
    business_type: opts.business_type ?? "brand",
    jurisdiction: "US",
    locations: [
      {
        location_id: "hq",
        label: "Headquarters",
        address: { line1: "1 Main St", line2: null, city: "Austin", region: "TX", postal_code: "78701", country: "US" },
        gln: opts.gln ?? null,
        roles: ["office", "ship_from"],
      },
    ],
    identifiers: { duns: null, tax_id: null, near_account: null },
    keys: [{ key_id: kp.keyId, role: "root", label: "root", status: "active", added_at: now, revoked_at: null, near_account: null }],
    kyb: null,
    certifications: [],
    fsma_pcqi_on_file: false,
    facility_allergens: [],
    data_vault_uri: null,
  };
}

/** Create a company with a fresh root key; returns an authenticated client. */
export async function makeCompany(base: DtpStoreClient, prefix: string, opts: { business_type?: string; gln?: string | null; name?: string } = {}): Promise<Company> {
  const id = uniq(prefix) + ".dtp";
  const kp = await generateKeyPair();
  const unsigned = draft({
    type: "core.company",
    subject_company_id: id,
    issuer: { key_id: kp.keyId, company_id: id, module_id: null },
    visibility: "public",
    body: companyBody(kp, opts.name ?? prefix, opts),
  });
  const env = (await signRecord(unsigned, kp.secretKey)) as Envelope;
  const r = await base.createCompany(env);
  const token = r.keys!.find((k) => k.key_id === kp.keyId)!.token;
  return { id, kp, token, client: base.with(token), companyRecordId: r.record.record_id };
}

export interface Module {
  id: string;
  publisher: Company;
  kp: KeyPair;
  token: string;
  client: DtpStoreClient;
}

export async function makeModule(base: DtpStoreClient, publisher: Company, prefix: string, requested: any[] = []): Promise<Module> {
  const id = uniq(prefix);
  const kp = await generateKeyPair();
  const now = nowIso();
  const unsigned = draft({
    type: "core.module",
    subject_company_id: publisher.id,
    issuer: { key_id: kp.keyId, company_id: publisher.id, module_id: id },
    visibility: "public",
    body: {
      module_id: id,
      name: prefix,
      publisher_company_id: publisher.id,
      description: "test module",
      homepage: null,
      keys: [{ key_id: kp.keyId, role: "root", label: "prod", status: "active", added_at: now, revoked_at: null, near_account: null }],
      requested_scopes: requested,
    },
  });
  const env = (await signRecord(unsigned, kp.secretKey)) as Envelope;
  const r = await base.createModule(env);
  const token = r.keys!.find((k) => k.key_id === kp.keyId)!.token;
  return { id, publisher, kp, token, client: base.with(token) };
}

/** Company grants scopes to module. Returns the grant record (root of the grant chain). */
export async function grant(company: Company, mod: Module, scopes: { namespace?: string; type?: string; access: "read" | "write" }[], extra: { expires_at?: string | null } = {}) {
  const unsigned = draft({
    type: "core.grant",
    subject_company_id: company.id,
    issuer: { key_id: company.kp.keyId, company_id: company.id, module_id: null },
    visibility: "private",
    body: { module_id: mod.id, scopes, status: "active", expires_at: extra.expires_at ?? null, note: "test grant" },
  });
  return company.client.sign(unsigned, company.kp.secretKey);
}

export function contractBody(buyer: string, seller: string, overrides: Record<string, unknown> = {}) {
  const now = nowIso();
  return {
    buyer_company_id: buyer,
    seller_company_id: seller,
    intent_id: null,
    listing_id: null,
    offer_id: null,
    standing_agreement_id: null,
    lot_id: null,
    buyer_po_number: "PO-1001",
    goods: {
      category: "condiments.hot_sauce",
      product_name: "Habanero Hot Sauce 5oz",
      description: "12 x 5oz glass bottles per case",
      product_type: "branded",
      commodity_details: null,
      branded_details: { brand_name: "Acme", sku: "ACME-HAB-5", gtin: "00614141000012", upc: null, manufacturer: "Acme Sauce Co." },
      value_added_details: null,
      quantity: { amount: "120", unit: "case" },
      quality: null,
      required_certifications: [],
      packaging: "12x5oz glass",
      shelf_life_days: 365,
    },
    delivery: {
      destination: { line1: "400 Dock St", line2: null, city: "Dallas", region: "TX", postal_code: "75201", country: "US" },
      destination_gln: null,
      window: { earliest: now, latest: now },
      method: "delivered",
      temperature_requirements: "ambient",
      notes: null,
    },
    finance: { payment_timing: "delivery_attestation", net_days: 30, paca_covered: false, financing_mode: "open_account", liquidity_pool_id: null, financer_company_id: null, finance_fee_bps: 0 },
    freight: null,
    price_per_unit: { amount: "42.00", currency: "USD" },
    total_value: { amount: "5040.00", currency: "USD" },
    escrow_ref: null,
    dispute_window_hours: 48,
    arbitrator_company_id: null,
    status: "active",
    ...overrides,
  };
}

/** Buyer creates a contract with seller. Subject = buyer, counterparty = seller. */
export async function makeContract(buyer: Company, seller: Company, overrides: Record<string, unknown> = {}) {
  const unsigned = draft({
    type: "trade.contract",
    subject_company_id: buyer.id,
    counterparty_ids: [seller.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: contractBody(buyer.id, seller.id, overrides),
  });
  return buyer.client.sign(unsigned, buyer.kp.secretKey);
}

export function fulfillmentBody(contractRootId: string, seller: string, buyer: string, sellerRecordId: string, overrides: Record<string, unknown> = {}) {
  const now = nowIso();
  return {
    contract_id: contractRootId,
    seller_company_id: seller,
    buyer_company_id: buyer,
    delivered_at: now,
    quantity_delivered: { amount: "120", unit: "case" },
    seller_attestation: { company_id: seller, attested_at: now, record_id: sellerRecordId, notes: "Delivered to dock 4" },
    buyer_attestation: null,
    deductions: [],
    status: "seller_attested",
    ...overrides,
  };
}

/** Seller attests delivery (genesis fulfillment). */
export async function makeFulfillment(seller: Company, buyer: Company, contractRootId: string) {
  const record_id = crypto.randomUUID();
  const unsigned = draft({
    type: "trade.fulfillment",
    record_id,
    subject_company_id: seller.id,
    counterparty_ids: [buyer.id],
    issuer: { key_id: seller.kp.keyId, company_id: seller.id, module_id: null },
    visibility: "counterparties",
    body: fulfillmentBody(contractRootId, seller.id, buyer.id, record_id),
  });
  return seller.client.sign(unsigned, seller.kp.secretKey);
}

/** Buyer attests receipt by superseding the seller's fulfillment record. */
export async function buyerAttest(buyer: Company, seller: Company, fulfillment: { record: any }) {
  const prev = fulfillment.record;
  const record_id = crypto.randomUUID();
  const now = nowIso();
  const unsigned = draft({
    type: "trade.fulfillment",
    record_id,
    root_id: prev.root_id,
    supersedes: prev.record_id,
    subject_company_id: seller.id,
    counterparty_ids: [buyer.id],
    issuer: { key_id: buyer.kp.keyId, company_id: buyer.id, module_id: null },
    visibility: "counterparties",
    body: { ...prev.body, buyer_attestation: { company_id: buyer.id, attested_at: now, record_id, notes: "Received, counted 120 cases" }, status: "buyer_attested" },
  });
  return buyer.client.sign(unsigned, buyer.kp.secretKey);
}
