// Read-only architecture probes, September 10, 2026. These describe the current
// implementation's boundaries; they are NOT desired future conformance rules.
// Run from sdk: node scripts/audit-business-scope.ts. No server or credentials used.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Validator } from "@cfworker/json-schema";
import { REGISTRY, SCHEMAS } from "../src/schemas.ts";
import { COMMAND_SCHEMA, PAYLOADS } from "../src/v03/schema.ts";
import { listTypes, typeInfo, validateBody } from "../src/registry.ts";
import { permissions } from "../src/v03/permissions.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const checks: { name: string; result: unknown }[] = [];
assert.deepEqual(REGISTRY, read("../../spec/schemas/index.json"));
for (const [file, embedded] of Object.entries(SCHEMAS)) {
  assert.deepEqual(embedded, read(`../../spec/schemas/${file}`), `embedded schema differs: ${file}`);
}
assert.deepEqual(COMMAND_SCHEMA, read("../../spec/v0.3/command.schema.json"));
checks.push({ name: "generated_artifacts_match_sources", result: { schemas: Object.keys(SCHEMAS).length, command_schema: true } });

checks.push({ name: "registered_business_types", result: listTypes().filter(type => !type.startsWith("core.")) });
for (const type of ["inventory.movement", "product.item", "hr.employee", "payroll.run", "acme.batch_scan"]) {
  let permissionAccepted = true;
  try { permissions([`records.read:${type}`]); } catch { permissionAccepted = false; }
  checks.push({ name: type, result: { registered: typeInfo(type) !== null, permissionAccepted } });
}
const money = new Validator(read("../../spec/schemas/common/money.schema.json"));
const quantity = new Validator(read("../../spec/schemas/common/quantity.schema.json"));
checks.push({ name: "money_currency", result: Object.fromEntries(["USD", "USDC", "EUR", "GBP"].map(currency => [currency, money.validate({ amount: "100.00", currency }).valid])) });
checks.push({ name: "quantity_units", result: Object.fromEntries(["case", "kg", "L", "mL", "hour", "kWh"].map(unit => [unit, quantity.validate({ amount: "1", unit }).valid])) });
checks.push({ name: "v03_record_payload_fields", result: Object.keys(PAYLOADS["record.append"].properties) });
checks.push({ name: "v03_manifest_fields", result: Object.keys(PAYLOADS["module.publish"].properties.manifest.properties) });

const usd = (amount: string) => ({ amount, currency: "USD" });
// Deliberately inconsistent arithmetic and an unresolved reference. Schema
// acceptance is not financial correctness or reference/evidence verification.
const invoice = {
  invoice_number: "SCOPE-PROBE", seller_company_id: "seller.dtp", buyer_company_id: "buyer.dtp",
  contract_id: "00000000-0000-4000-8000-000000000001",
  line_items: [{ description: "Synthetic probe only", quantity: { amount: "2", unit: "case" }, unit_price: usd("100"), amount: usd("1") }],
  subtotal: usd("1"), deductions: [], total: usd("1"), issued_at: "2026-09-10T00:00:00.000Z", due_at: "2026-10-10T00:00:00.000Z",
  payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [], assigned_to_company_id: null,
};
checks.push({ name: "shape_validation_is_not_arithmetic_or_reference_validation", result: validateBody("finance.invoice", invoice) });
console.log(JSON.stringify({ audit: "DTP business scope boundary probes", checks }, null, 2));
