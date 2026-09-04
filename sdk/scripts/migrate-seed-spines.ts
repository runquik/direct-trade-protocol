// One-off: supersede the seeded companies' spines so their bodies use `business_types` (plural, optional)
// instead of the retired `business_type`. Reads keys from fixtures/dev-keys.json; protocol-native (a normal
// core.company supersede signed by each company's root key). Safe to re-run: skips spines already migrated.
//   STORE_URL=https://.../dtp-store node scripts/migrate-seed-spines.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DtpStoreClient, draft } from "../src/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(resolve(here, "../fixtures/dev-keys.json"), "utf8"));
const url = process.env.STORE_URL ?? keys.store_url;
const base = new DtpStoreClient(url);

for (const [name, c] of Object.entries<any>(keys.companies)) {
  const view = await base.getCompany(c.id);
  const head = view.record;
  const body = { ...head.body } as Record<string, unknown>;
  if (!("business_type" in body)) {
    console.log(`${c.id}: already migrated (head ${head.record_id})`);
    continue;
  }
  const bt = body.business_type as string;
  delete body.business_type;
  body.business_types = [bt];
  const unsigned = draft({
    type: "core.company",
    subject_company_id: c.id,
    root_id: head.root_id,
    supersedes: head.record_id,
    issuer: { key_id: c.key_id, company_id: c.id, module_id: null },
    visibility: head.visibility,
    body,
  });
  const r = await base.with(c.token).sign(unsigned, c.secret_key);
  console.log(`${c.id} (${name}): superseded ${head.record_id} -> ${r.record.record_id}; business_types=${JSON.stringify(body.business_types)}`);
}
