// Explicit live DEVELOPMENT smoke test. Creates only clearly labeled synthetic state.
// Caller loads private config without printing secrets. No existing data is changed.
import assert from "node:assert/strict";
import { Passport } from "../../modules/passport/src/index.ts";
import { PbpError } from "../src/v03/wire.ts";
const audience = process.env.PBP_AUDIENCE, token = process.env.PBP_DEV_ACCESS_TOKEN, revision = process.env.PBP_REVISION;
assert.equal(audience, "https://vsuqtdofphppybkhnijg.supabase.co/functions/v1", "targets only the authorized development project");
assert.ok(token && revision, "load development token and expected revision without printing them");
const health = await fetch(audience + "/pbp-store/health"); assert.equal(health.status, 200);
assert.equal(health.headers.get("x-pbp-revision"), revision);
const metadata = await health.json() as any; assert.equal(metadata.audience, audience); assert.equal(metadata.protocol_version, "0.3");
assert.equal((await fetch(audience + "/pbp-store/commands", { method: "POST", body: "{}" })).status, 401);
const passport = new Passport(audience!, token), owner = await passport.createIdentity(), cfo = await passport.createIdentity();
const orgs: string[] = [];
for (let i = 0; i < 3; i++) {
  const org = await passport.createCompany(owner, `PBP deployment smoke ${new Date().toISOString()} / ${i + 1}`); orgs.push(org);
  const invite = await passport.invite(owner, org, cfo.id, ["records.read:finance.invoice"], new Date(Date.now() + 3600000).toISOString());
  await passport.accept(cfo, org, invite);
  assert.equal((await passport.enter(cfo, org)).organization.id, org);
}
await passport.revoke(owner, orgs[1], cfo.id);
await assert.rejects(passport.enter(cfo, orgs[1]), (e: unknown) => e instanceof PbpError && e.code === "forbidden");
assert.equal((await passport.organizations(cfo)).length, 2);
await passport.enter(cfo, orgs[0]); await passport.enter(cfo, orgs[2]);
assert.equal((await new Passport(audience!, token).organizations(owner)).length, 3);
console.log(JSON.stringify({ result: "PASS", revision, audience, store_key_id: metadata.store_key_id,
  checks: ["live Deno + PostgreSQL signed enrollment", "three company memberships", "revocation isolation", "fresh client persistence", "anonymous command denial"],
  retained_synthetic_companies: 3, real_company_data: false }));
