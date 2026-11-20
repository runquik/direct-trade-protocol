// GAP (red team, surface 6): a flow@1 fact's pack-conversion check reads the
// head of any product the company holds, before anything checks that the writer
// may read that product. A member who can write only their own book learns,
// from the refusal alone, whether a product in a compartment they cannot read
// exists and whether a guessed pack conversion (packaging_id, version,
// base_units_per_pack) is one it published. SPEC v0.4 section 4, "Refusals and
// existence": "A refused command tells its caller nothing about a policy or
// record the caller cannot read." The read and anchor paths for the same
// product collapse to 404; this write path does not. The probe is refused, so
// it leaves no record. Finding: #209.
// This test pins today's behaviour so the gap stays visible. When it starts to
// fail, the gap is closed: delete this file in the pull request that fixes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, member, person, policy, record } from "./helpers.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const flow = load("../../../spec/profiles/flow/1/fixtures.json"), product = load("../../../spec/profiles/product/1/fixtures.json"), object = load("../../../spec/profiles/object/1/fixtures.json");
const answer = (r: any) => JSON.stringify([r.status, r.error?.code ?? null, r.error?.message ?? null]);

test("GAP: a flow@1 fact's packaging check answers about a product the writer cannot read", async () => {
  const store = await createDtpStore(); try {
    const client = new Client(store.audience), owner = await person(client), clerk = await person(client), org = await company(client, owner);
    for (const digest of [product.contract_digest, object.contract_digest, flow.contract_digest]) await client.ok(owner, "profile.admit", org, { digest });
    await member(client, owner, org, clerk);
    // A compartment the clerk holds no grant on, with one product whose packaging is "case-12", version "1", 12 per pack.
    const restricted = await policy(client, owner, org, [grant(owner)]), hidden = crypto.randomUUID();
    await client.ok(owner, "record.append", org, { ...record(org, restricted, hidden, product.contract_digest, product.accept[0].body), id: hidden, root_id: hidden });
    // The clerk's own compartment and an empty book in it.
    const own = await policy(client, owner, org, [grant(owner), grant(clerk)]), book = crypto.randomUUID();
    await client.ok(clerk, "flow.open", org, { policy_id: own, book_id: book });

    // Controls: every read and anchor path for the hidden product answers exactly as for an absent one.
    const absent = crypto.randomUUID();
    const get = (id: string) => client.act(clerk, "record.get", org, { id, profile_digest: product.contract_digest });
    assert.equal(answer(await get(hidden)), answer(await get(absent)));
    const anchor = (p: string) => client.act(clerk, "flow.ledger.open", org, { policy_id: own, book_id: book, asset: { product: p, currency: null }, account: null, balance: "nonnegative" });
    assert.equal(answer(await anchor(hidden)), answer(await anchor(absent)));
    assert.equal((await anchor(hidden)).status, 404);

    // The probe: one goods leg in the clerk's own book, quantity in a guessed packaging unit.
    let sequence = 0;
    const probe = async (root: string, packaging_id: string, per: string) => {
      const fact = structuredClone(flow.flows[0].facts[0].fact);
      fact.act.observation = { source_id: "probe", sequence: ++sequence };
      fact.legs[0].asset.product = root;
      fact.legs[0].quantity = { amount: "1", unit: { system: "packaging", code: null, packaging_id, version: "1", base_units_per_pack: per } };
      return client.act(clerk, "record.append", org, record(org, own, book, flow.contract_digest, fact));
    };
    const right = await probe(hidden, "case-12", "12"), wrong = await probe(hidden, "case-12", "24"), unknownId = await probe(hidden, "case-6", "12"), missing = await probe(absent, "case-12", "12");
    // The three negative answers agree with each other...
    assert.equal(answer(wrong), answer(missing));
    assert.equal(answer(unknownId), answer(missing));
    assert.equal(wrong.error.code, "unknown_packaging");
    // GAP: ...but the right guess is answered differently, so the refusal discloses the hidden product's existence and its
    // published pack conversion. Fixed means this answer equals `missing` (or the probe is refused before the product is consulted).
    assert.notEqual(answer(right), answer(missing));
    assert.equal(right.status, 409);
    assert.equal(right.error.code, "ledger_unavailable");
    // Nothing was written: the probe leaves no record.
    const listed = await client.ok(owner, "records.list", org, { after: 0, limit: 100, profile_digests: [flow.contract_digest], kinds: [] });
    assert.equal(listed.records.length, 0);
  } finally { await store.close(); }
});
