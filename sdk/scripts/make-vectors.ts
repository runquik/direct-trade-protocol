// Generates spec/vectors/*.json from a FIXED seed so any implementation (any language) can check
// its canonicalization, hashing, and Ed25519 signing byte-for-byte. Run once; commit the output.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256Hex, bytesToHex } from "../src/canonical.ts";
import { encodeKeyId, encodeSecretKey, keyPairFromSecret, signBytes } from "../src/keys.ts";
import { signRecord, signingInput } from "../src/sign.ts";
import { base58Encode } from "../src/base58.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../spec/vectors");
mkdirSync(out, { recursive: true });

// Fixed 32-byte seed (NOT a real key; published on purpose).
const seed = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
// Derive the public key by importing the seed through WebCrypto (pkcs8 -> export raw is not available for private keys,
// so derive via a sign/verify-free path: generate the pair from the seed using the JWK route).
async function pubFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seed]);
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const x = (jwk as any).x as string;
  const bin = atob(x.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (x.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const pub = await pubFromSeed(seed);
const secretKey = encodeSecretKey(seed, pub);
const kp = await keyPairFromSecret(secretKey);
void b64unused;
function b64unused() {}

const keys = { description: "Fixed Ed25519 test key. NEAR-compatible encodings. Never use for anything real.", seed_hex: bytesToHex(seed), public_key_hex: bytesToHex(pub), key_id: kp.keyId, secret_key: secretKey };
writeFileSync(join(out, "keys.json"), JSON.stringify(keys, null, 2) + "\n");

// Canonicalization vectors
const canonCases = [
  { name: "key order and nesting", input: { z: 1, a: { y: "2", x: [3, { b: true, a: null }] } } },
  { name: "unicode and escapes", input: { s: "héllo \"quoted\" \\ back\nnewline ", e: "" } },
  { name: "integers and arrays", input: { n: [0, -1, 9007199254740991], m: {} } },
  { name: "undefined is dropped, null kept", input: { a: null, b: undefined, c: [undefined] } },
];
const canonical = await Promise.all(canonCases.map(async (c) => {
  const text = canonicalize(c.input);
  return { name: c.name, input: c.input, canonical: text, sha256: await sha256Hex(text) };
}));
writeFileSync(join(out, "canonicalization.json"), JSON.stringify({ description: "canonical = RFC 8785 JCS with integer-only numbers; sha256 over UTF-8 bytes of canonical", cases: canonical }, null, 2) + "\n");

// Signature vectors: a company genesis record and a contract, both signed by the fixed key
const created_at = "2026-09-08T14:03:22.117Z";
const companyId = "acme-sauce.dtp";
const companyRecordId = "018f6d2e-3b1a-7c4e-9a1f-2f6c1a9d0e21";
const company = await signRecord({
  record_id: companyRecordId, root_id: companyRecordId, type: "core.company", namespace: "core", schema_version: "0.2",
  subject_company_id: companyId, counterparty_ids: [], issuer: { key_id: kp.keyId, company_id: companyId, module_id: null },
  visibility: "public", created_at, supersedes: null,
  body: {
    display_name: "Acme Sauce Co.", legal_name: "Acme Sauce Company LLC", business_type: "brand", jurisdiction: "US",
    locations: [{ location_id: "plant", label: "Plant and shipping dock", address: { line1: "12 Pepper Rd", line2: null, city: "Austin", region: "TX", postal_code: "78701", country: "US" }, gln: "0614141000012", roles: ["ship_from", "plant"] }],
    identifiers: { duns: "123456789", tax_id: null, near_account: null },
    keys: [{ key_id: kp.keyId, role: "root", label: "owner", status: "active", added_at: created_at, revoked_at: null, near_account: null }],
    kyb: null, certifications: [], fsma_pcqi_on_file: false, facility_allergens: [], data_vault_uri: null,
  },
}, secretKey);
const contractId = "018f6d2e-3b1a-7c4e-9a1f-2f6c1a9d0e22";
const contract = await signRecord({
  record_id: contractId, root_id: contractId, type: "trade.contract", namespace: "trade", schema_version: "0.2",
  subject_company_id: "bluestem-dist.dtp", counterparty_ids: [companyId], issuer: { key_id: kp.keyId, company_id: companyId, module_id: null },
  visibility: "counterparties", created_at, supersedes: null,
  body: {
    buyer_company_id: "bluestem-dist.dtp", seller_company_id: companyId, intent_id: null, listing_id: null, offer_id: null, standing_agreement_id: null, lot_id: null, buyer_po_number: "PO-1001",
    goods: { category: "condiments.hot_sauce", product_name: "Habanero Hot Sauce 5oz", description: null, product_type: "branded", commodity_details: null, branded_details: { brand_name: "Acme", sku: "ACME-HAB-5", gtin: "00614141000012", upc: null, manufacturer: "Acme Sauce Co." }, value_added_details: null, quantity: { amount: "120", unit: "case" }, quality: null, required_certifications: [], packaging: "12x5oz glass", shelf_life_days: 365 },
    delivery: { destination: { line1: "400 Dock St", line2: null, city: "Dallas", region: "TX", postal_code: "75201", country: "US" }, destination_gln: null, window: { earliest: "2026-09-15T00:00:00.000Z", latest: "2026-09-19T00:00:00.000Z" }, method: "delivered", temperature_requirements: "ambient", notes: null },
    finance: { payment_timing: "delivery_attestation", net_days: 30, paca_covered: false, financing_mode: "open_account", liquidity_pool_id: null, financer_company_id: null, finance_fee_bps: 0 },
    freight: null, price_per_unit: { amount: "42.00", currency: "USD" }, total_value: { amount: "5040.00", currency: "USD" }, escrow_ref: null, dispute_window_hours: 48, arbitrator_company_id: null, status: "active",
  },
}, secretKey);
const vec = async (name: string, env: any) => ({ name, envelope: env, signing_input: new TextDecoder().decode(signingInput(env)), payload_hash: await sha256Hex(signingInput(env)), signature: env.signature });
const rawMsg = new TextEncoder().encode("dtp");
const rawSig = await signBytes(secretKey, rawMsg);
writeFileSync(join(out, "signatures.json"), JSON.stringify({
  description: "signature = Ed25519(secret, UTF-8 bytes of signing_input); signing_input = canonical JSON of the envelope minus `signature`. Encodings: ed25519:<base58>.",
  key_id: kp.keyId,
  raw: { message_utf8: "dtp", signature: "ed25519:" + base58Encode(rawSig), signature_hex: bytesToHex(rawSig) },
  records: [await vec("core.company genesis", company), await vec("trade.contract", contract)],
}, null, 2) + "\n");
console.log("wrote spec/vectors/{keys,canonicalization,signatures}.json for key", kp.keyId, "(pub", encodeKeyId(pub) === kp.keyId ? "ok" : "MISMATCH", ")");
