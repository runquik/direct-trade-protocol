import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, record } from "./helpers.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { OBJECT_PROFILE } from "../../src/profiles/object.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const object = load("../../../spec/profiles/object/1/fixtures.json");
const page = (kinds: string[]) => ({ after: 0, limit: 100, profile_digests: [], kinds });

test("object-v1 in the reference host, through the registered protocol contract: create, retire, found, refusals and one spelling per object", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), org = await company(client, owner);
    await client.ok(owner, "profile.admit", org, { digest: object.contract_digest });
    const pol = await policy(client, owner, org, [grant(owner)]), resource = crypto.randomUUID();
    const append = (body: any, chain?: { root: string; head: string }) => {
      const r = record(org, pol, resource, object.contract_digest, body);
      return { r, send: () => client.act(owner, "record.append", org, chain ? { ...r, root_id: chain.root, supersedes: chain.head } : r) };
    };
    // Genesis: every accepted body that enters active is accepted; one already retired is refused at birth.
    for (const v of object.accept) {
      const response = await append(v.body).send();
      if (v.body.status === "active") assert.equal(response.status, 200, `${v.why}: ${JSON.stringify(response.error)}`);
      else { assert.equal(response.status, 422, v.why); assert.equal(response.error.code, "invalid_object", v.why); }
    }
    // A body the contract's schema already refuses fails as invalid_body; the rest fail on the profile's own rules.
    const codes = new Set<string>();
    for (const v of object.reject) { const r = await append(v.body).send(); assert.ok([400, 422].includes(r.status), v.why); assert.ok(["invalid_body", "invalid_object"].includes(r.error.code), `${v.why}: ${r.error.code}`); codes.add(r.error.code); }
    assert.ok(codes.has("invalid_object"));
    // Every continuity pair, reached through a real chain from an active genesis.
    const chainTo = async (previous: any) => {
      const born = append({ ...previous, status: "active", retired: null }); assert.equal((await born.send()).status, 200);
      let head = born.r.id;
      if (previous.status === "retired") { const step = append(previous, { root: born.r.id, head }); assert.equal((await step.send()).status, 200); head = step.r.id; }
      return { root: born.r.id, head };
    };
    for (const v of object.continuity.accept) { const chain = await chainTo(v.previous); const r = await append(v.next, chain).send(); assert.equal(r.status, 200, `${v.why}: ${JSON.stringify(r.error)}`); }
    for (const v of object.continuity.reject) { const chain = await chainTo(v.previous); const r = await append(v.next, chain).send(); assert.equal(r.status, 422, v.why); assert.equal(r.error.code, "invalid_object", v.why); }
    // One spelling per object: the writer's own object is referenced with minted_by null, never with its own id.
    const base = object.accept[0].body, mine = { root: crypto.randomUUID(), record_id: null };
    const spelledForeign = await append({ ...base, evidence: [{ minted_by: org, ...mine }] }).send();
    assert.equal(spelledForeign.status, 422); assert.equal(spelledForeign.error.code, "invalid_object");
    assert.equal((await append({ ...base, evidence: [{ minted_by: null, ...mine }] }).send()).status, 200);
    const listed = await client.ok(owner, "records.list", org, page(["dtp/object@1"]));
    assert.ok(listed.records.length > 0 && listed.records.every((r: any) => r.profile_digest === object.contract_digest));
    assert.deepEqual(listed.records[0].validation, { profile: OBJECT_PROFILE, level: "business-rules", business_verified: false });
  } finally { await store.close(); }
});
