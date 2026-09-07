import assert from "node:assert/strict";
import { createPbpStore } from "./pbp-dev-server.ts";
import { Passport } from "../../modules/passport/src/index.ts";
import { PbpError } from "../src/v03/wire.ts";

const store = await createPbpStore();
try {
  const passport = new Passport(store.audience);
  const controller = await passport.createIdentity(), cfo = await passport.createIdentity();
  const names = ["Acme Sauce (demo)", "Bluestem Foods (demo)", "Northstar Manufacturing (demo)"];
  const organizations: string[] = [];
  for (const [i, name] of names.entries()) {
    const org = await passport.createCompany(controller, name); organizations.push(org);
    const rights = i === 1 ? ["records.read:trade.contract"] : ["records.read:finance.invoice"];
    const invite = await passport.invite(controller, org, cfo.id, rights, new Date(Date.now() + 86400000).toISOString());
    await passport.accept(cfo, org, invite);
    const v = await passport.enter(cfo, org);
    console.log(`${v.organization.name}: ${v.permissions.join(", ")}`);
  }
  assert.equal((await passport.organizations(cfo)).length, 3);
  await passport.revoke(controller, organizations[1], cfo.id);
  await assert.rejects(passport.enter(cfo, organizations[1]), (e: unknown) => e instanceof PbpError && e.code === "forbidden");
  assert.equal((await passport.organizations(cfo)).length, 2);
  await passport.enter(cfo, organizations[0]); await passport.enter(cfo, organizations[2]);
  console.log("PASS: one person, three independent memberships; revocation in one company leaves the other two accessible.");
  console.log("Developer authority demo only. Browser dashboard, real KYB, live financing and marketplace are not implemented here.");
} finally { await store.close(); }
