import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, record } from "./helpers.ts";
import { digest } from "../../src/v04/wire.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { PARTY_PROFILE, PARTY_SCHEMA, PARTY_SEMANTICS } from "../../src/profiles/party.ts";
import type { PartyBody } from "../../src/profiles/party.ts";

const fixtures = parseUntrustedJson(readFileSync(fileURLToPath(new URL("../../../spec/profiles/party/1/fixtures.json", import.meta.url)), "utf8")) as { accept: { why: string; body: PartyBody }[]; reject: { why: string; body: unknown }[]; continuity: { accept: { why: string; previous: PartyBody; next: PartyBody }[]; reject: { why: string; previous: PartyBody; next: PartyBody }[] } };
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

test("party-v1 in the reference host: fixtures accepted and refused, continuity on supersession, and a person party only under a personnel policy", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    const contract = { publisher_id: org, name: "party", version: "1.0.0", schema: structuredClone(PARTY_SCHEMA), semantics: PARTY_SEMANTICS, dependencies: [] };
    const hash = await digest(contract); const { publisher_id: _, ...payload } = contract;
    await client.ok(owner, "profile.publish", org, { ...payload, digest: hash, visibility: "private", readers: [] });
    const business = await policy(client, owner, org, [grant(owner)]), personnel = await policy(client, owner, org, [grant(owner)], [owner], "personnel"), resource = crypto.randomUUID();
    const people = fixtures.accept.filter(v => v.body.kind === "person"), others = fixtures.accept.filter(v => v.body.kind !== "person");
    assert.ok(people.length >= 1 && others.length >= 3);
    for (const v of others) await client.ok(owner, "record.append", org, record(org, business, resource, hash, v.body));
    for (const v of people) {
      const refused = await client.act(owner, "record.append", org, record(org, business, resource, hash, v.body));
      assert.equal(refused.error.code, "invalid_party", `${v.why}: a person party is refused under a business policy`);
      await client.ok(owner, "record.append", org, record(org, personnel, resource, hash, v.body));
    }
    const listed = await client.ok(owner, "records.list", org, page([`${org}/party@1`]));
    assert.equal(listed.records.length, fixtures.accept.length);
    assert.deepEqual(listed.records[0].validation, { profile: PARTY_PROFILE, level: "business-rules", business_verified: false });
    const codes = new Set<string>();
    for (const v of fixtures.reject) {
      const response = await client.act(owner, "record.append", org, record(org, personnel, resource, hash, v.body));
      assert.ok([400, 422].includes(response.status), v.why); if (response.status === 422) { assert.ok(["invalid_body", "invalid_party"].includes(response.error.code), v.why); codes.add(response.error.code); }
    }
    assert.ok(codes.has("invalid_party") && codes.has("invalid_body"));
    for (const v of fixtures.continuity.accept) {
      const pol = v.previous.kind === "person" || v.next.kind === "person" ? personnel : business;
      const first = record(org, pol, resource, hash, v.previous); await client.ok(owner, "record.append", org, first);
      await client.ok(owner, "record.append", org, { ...record(org, pol, resource, hash, v.next), root_id: first.id, supersedes: first.id });
    }
    for (const v of fixtures.continuity.reject) {
      const first = record(org, personnel, resource, hash, v.previous); await client.ok(owner, "record.append", org, first);
      const response = await client.act(owner, "record.append", org, { ...record(org, personnel, resource, hash, v.next), root_id: first.id, supersedes: first.id });
      assert.equal(response.status, 422, v.why); assert.equal(response.error.code, "invalid_party", v.why);
    }
  } finally { await store.close(); }
});
