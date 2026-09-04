// RT-01: Any registered company can supersede (tamper with) any other company's record.
// authorizeWrite (records.ts:116-119) checks "issuer is a party" against the NEW envelope's counterparty_ids,
// which the attacker writes. The supersession check (records.ts:238-245) never compares the issuer to the
// parties of the record being superseded. transitions.ts:63-68 then grants "counterparty" role from the same list.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { setup, makeCompany, makeContract, supersedeOf, post, attempt, log, type Env, type Company } from "./rt-helpers.ts";

let env: Env; let buyer: Company; let seller: Company; let stranger: Company;
before(async () => {
  env = await setup();
  buyer = await makeCompany(env.base, "wb-buyer");
  seller = await makeCompany(env.base, "wb-seller");
  stranger = await makeCompany(env.base, "wb-stranger");
});
after(() => env.close());

test("VULN: a stranger rewrites the price on a contract between two other companies (same-status revision)", async () => {
  const c = await makeContract
