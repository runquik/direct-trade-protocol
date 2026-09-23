// Step 2: synthetic companies, people, authority and records on a running host, then the module's release and installation.
// Everything here is done through signed commands over HTTP; nothing touches the host's source or storage.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, keys } from "@dtp/sdk/preview/foundation";
import { v04Wire } from "@dtp/sdk/preview";
import { ASSESSOR_ISSUER, KINDS, asPerson, connect, loadCredentials, saveCredentials } from "./common.mjs";

const { client } = await connect();
const credentials = loadCredentials();
if (!credentials.assessor) throw new Error("run prepare.mjs first, then start the host with the configuration it wrote");
const assessor = await keys.keyPairFromSecret(credentials.assessor.secret_key);
const expires = new Date(Date.now() + 30 * 86400000).toISOString();
const productDigest = KINDS["dtp/product@1"], inventoryDigest = KINDS["dtp/inventory@2"];

async function newPerson() {
  const key = await keys.generateKeyPair(), person = { id: await v04Wire.personId(key.keyId), key };
  await asPerson(client, person, "person.register", null, { keys: [key.keyId] });
  return person;
}
async function newCompany(controller, name) {
  const nonce = crypto.randomUUID(), id = await v04Wire.organizationId(controller.id, nonce);
  await asPerson(client, controller, "organization.create", id, { name, nonce, controllers: [controller.id], threshold: 1 });
  return id;
}
const grant = (person, actions) => ({ person_id: person.id, actions, resource_ids: "*", expires_at: expires });
async function newPolicy(controller, company, grants) {
  const policy_id = crypto.randomUUID();
  await asPerson(client, controller, "policy.create", company, { policy_id, expected_revision: 0, classification: "business", stewards: [controller.id], threshold: 1, grants });
  return policy_id;
}
// A genesis record: it is its own root. A product is its own resource; an inventory fact's resource is the product it moves.
const record = (company, policy_id, profile_digest, body, resource_id = null) => {
  const id = crypto.randomUUID();
  return { id, root_id: id, supersedes: null, organization_id: company, policy_id, resource_id: resource_id ?? id, profile_digest, counterparty_ids: [], body };
};

// A product as one company defines it (the accepted fixture body of dtp/product@1): a lot-tracked jar with a GTIN, a SKU and a case-of-12 packaging revision.
const product = {
  names: [{ name: "Heritage Tomato Sauce 680 g", language: "en" }, { name: "Salsa de tomate 680 g", language: "es" }],
  description: "Slow-cooked tomato sauce in a glass jar.", brand: "Example Foods", category: "sauces",
  identifiers: [{ scheme: "gs1.gtin", value: "00012345678905" }, { scheme: "sku", value: "HTS-680" }, { scheme: "supplier.code", value: "A-77" }],
  base_unit: { system: "ucum", code: "{jar}" },
  packaging: [{ packaging_id: "case-12", version: "1", name: "Case of 12 jars", base_units_per_pack: "12", gtin: "10012345678902" }],
  tracking: "lot", shelf_life_days: 540, replaces: null, status: "active",
};
const jars = amount => ({ amount, unit: { system: "ucum", code: "{jar}", packaging_id: null, version: null, base_units_per_pack: null } });
const cases = amount => ({ amount, unit: { system: "packaging", code: null, packaging_id: "case-12", version: "1", base_units_per_pack: "12" } });
const at = (lot_id, location_id, status = "available") => ({ lot_id, location_id, status });
const leg = (from, to, quantity, extra = {}) => ({ from, to, quantity, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null }, ...extra });
const fact = (product_id, sequence, occurred_at, expected_revision, moves, reservations = []) =>
  ({ product_id, observation: { source_id: "wms", sequence }, occurred_at, expected_revision, moves, reservations });

async function seedCompany(name, facts) {
  const controller = await newPerson(), company = await newCompany(controller, name);
  const policy_id = await newPolicy(controller, company, [grant(controller, ["read", "write", "export"])]);
  for (const digest of [productDigest, inventoryDigest]) await asPerson(client, controller, "profile.admit", company, { digest });
  const productRecord = record(company, policy_id, productDigest, product);
  await asPerson(client, controller, "record.append", company, productRecord);
  await asPerson(client, controller, "inventory.open", company, { policy_id, product_id: productRecord.id });
  for (const body of facts(productRecord.id)) await asPerson(client, controller, "record.append", company, record(company, policy_id, inventoryDigest, body, productRecord.id));
  return { id: company, controller, policy_id, product_id: productRecord.id };
}

// Company A: receive ten cases of lot L1 at the dock, move a hundred jars to the shelf, reserve thirty for a customer, ship twenty.
const a = await seedCompany("Synthetic Sauce Works", product_id => [
  fact(product_id, 1, "2026-09-23T08:01:00.000Z", 0, [leg(at(null, "~supplier"), at("L1", "dock"), cases("10"))]),
  fact(product_id, 2, "2026-09-23T08:02:00.000Z", 1, [leg(at("L1", "dock"), at("L1", "shelf"), jars("100"))]),
  fact(product_id, 3, "2026-09-23T09:00:00.000Z", 2, [], [{ kind: "reserve", reservation_id: "res-1", position: at("L1", "shelf"), quantity: jars("30"), party: null }]),
  fact(product_id, 4, "2026-09-23T10:00:00.000Z", 3, [leg(at("L1", "shelf"), at(null, "~customer"), jars("20"))]),
]);
// Company B: a different company on the same host, whose records this module must never see.
const b = await seedCompany("Synthetic Other Foods", product_id => [
  fact(product_id, 1, "2026-09-23T08:30:00.000Z", 0, [leg(at(null, "~supplier"), at("B7", "floor"), cases("5"))]),
]);

// The module's sponsor: a member of A with the permission to manage installations and a read grant, but no write.
const sponsor = await newPerson();
const invitation_id = crypto.randomUUID();
await asPerson(client, a.controller, "membership.invite", a.id, { invitation_id, person_id: sponsor.id, permissions: ["installations.manage"], expires_at: expires });
await asPerson(client, sponsor, "membership.accept", a.id, { invitation_id });
await asPerson(client, a.controller, "policy.update", a.id, { policy_id: a.policy_id, expected_revision: 1, classification: "business", stewards: [a.controller.id], threshold: 1,
  grants: [grant(a.controller, ["read", "write", "export"]), grant(sponsor, ["read"])] });

// The module's release: an immutable descriptor naming the exact artifact and the exact profiles it reads, approved by the pinned assessor.
const artifactBytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "read.mjs"));
const artifact_digest = await canonical.sha256Hex(new Uint8Array(artifactBytes));
const assessmentBody = { kind: "module-assessment", issuer: ASSESSOR_ISSUER, artifact_digest, outcome: "approved", issued_at: new Date().toISOString(), expires_at: expires };
const assessment = { body: assessmentBody, key_id: assessor.keyId,
  signature: keys.encodeSignature(await keys.signBytes(assessor.secretKey, canonical.canonicalBytes({ domain: "DTP-TOKEN-0.4", body: assessmentBody }))) };
const { result: release } = await asPerson(client, a.controller, "release.publish", a.id, { module_id: crypto.randomUUID(), version: "1.0.0", artifact_digest,
  profiles: [productDigest, inventoryDigest], actions: ["read"], visibility: "private", assessment });

// The installation: company A admits the module under one policy, read only, unattended, with an expiry; the module key proves possession by cosigning.
const moduleKey = await keys.generateKeyPair(), installation_id = crypto.randomUUID();
await asPerson(client, sponsor, "installation.create", a.id, { installation_id, release_digest: release.digest, key_id: moduleKey.keyId,
  policy_ids: [a.policy_id], actions: ["read"], mode: "automation", expires_at: expires }, [moduleKey]);

const secrets = person => ({ id: person.id, key_id: person.key.keyId, secret_key: person.key.secretKey });
saveCredentials({ ...credentials,
  company_a: { id: a.id, policy_id: a.policy_id, product_id: a.product_id, controller: secrets(a.controller), sponsor: secrets(sponsor) },
  company_b: { id: b.id, policy_id: b.policy_id, product_id: b.product_id, controller: secrets(b.controller) },
  release: { digest: release.digest, artifact_digest },
  installation: { id: installation_id, key_id: moduleKey.keyId, secret_key: moduleKey.secretKey, mode: "automation", actions: ["read"] },
});
console.error(`seeded company A ${a.id} and company B ${b.id}; installation ${installation_id} may read A under policy ${a.policy_id}\nnow run: node read.mjs`);
