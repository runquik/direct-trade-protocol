// Regression for #119: a flow@1 fact is ordered against its ledger's opening by the commands' `issued_at`, on the live
// write path and on snapshot import alike. Before the fix the live host accepted a fact whose `issued_at` preceded the
// opening's (anywhere inside the command window) and snapshot import then refused the book it had committed. Now the
// live host refuses that fact with 409 `conflict`, and an equal `issued_at` is accepted by both paths. The import side
// is pinned by the `flow-fact-before-opening` case and the base of spec/vectors/snapshot-import.json.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateKeyPair } from "../../src/keys.ts";
import type { Context } from "../../src/v04/model.ts";
import { emptyState } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { draftCommand, signCommand, personId, organizationId } from "../../src/v04/wire.ts";
import { buildSnapshot, validateSnapshot } from "../../src/v04/snapshot.ts";
import { loadProtocolProfiles } from "../../scripts/dtp-v04-dev-server.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";

const load = (p: string) => parseUntrustedJson(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")) as any;
const flow = load("../../../spec/profiles/flow/1/fixtures.json");
const product = load("../../../spec/profiles/product/1/fixtures.json");
const protocol = await loadProtocolProfiles();

/** One goods ledger, then the first fixture fact (a move of 50 kg into a lot at revision 0) written under a command
 *  issued `offset` ms after the ledger opening's `issued_at`, with the host clock after both. */
async function attempt(offset: number) {
  const key = await generateKeyPair(), storeKey = await generateKeyPair();
  const owner = { id: await personId(key.keyId), key };
  const ctx: Context = { audience: "https://source.test", storeKey, pins: {}, now: Date.parse("2026-09-10T12:00:00.000Z"), kinds: protocol.kinds, protocolProfiles: protocol.protocolProfiles };
  const s = emptyState();
  const call = async (action: string, org: string | null, payload: any, issuedAt = ctx.now + 1) => {
    ctx.now += 1;
    const c = draftCommand(ctx.audience, owner, action, org, payload, issuedAt);
    c.expires_at = new Date(ctx.now + 60000).toISOString();
    return execute(s, await signCommand(c, [key]), ctx);
  };
  await call("person.register", null, { keys: [key.keyId] });
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  await call("organization.create", org, { name: "Co", nonce, controllers: [owner.id], threshold: 1 });
  for (const digest of [product.contract_digest, flow.contract_digest]) await call("profile.admit", org, { digest });
  const pol = crypto.randomUUID();
  await call("policy.create", org, { policy_id: pol, expected_revision: 0, classification: "business", stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ["read", "write", "export"], resource_ids: "*", expires_at: new Date(ctx.now + 86400000).toISOString() }] });
  const productId = "00000001-0000-4000-8000-000000000001";
  await call("record.append", org, { id: productId, root_id: productId, supersedes: null, organization_id: org, policy_id: pol,
    resource_id: productId, profile_digest: product.contract_digest, counterparty_ids: [],
    body: { ...product.accept[0].body, identifiers: [], packaging: [], base_unit: { system: "ucum", code: "kg" }, tracking: "lot" } });
  const bookId = flow.flows[0].book_id;
  await call("flow.open", org, { policy_id: pol, book_id: bookId });
  const opened = ctx.now + 1;
  await call("flow.ledger.open", org, { policy_id: pol, book_id: bookId, asset: { product: productId, currency: null }, account: null, balance: "nonnegative" }, opened);
  ctx.now += 100_000; // the fact arrives later than the opening on the host clock, whatever its own issued_at says
  const id = crypto.randomUUID();
  const fact = { id, root_id: id, supersedes: null, organization_id: org, policy_id: pol, resource_id: bookId,
    profile_digest: flow.contract_digest, counterparty_ids: [], body: structuredClone(flow.flows[0].facts[0].fact) };
  let live: any, refusal: any;
  try { live = await call("record.append", org, fact, opened + offset); } catch (e) { refusal = e; }
  return { s, org, ctx, bookId, live, refusal };
}

test("flow-v1 #119: the live host refuses a fact whose issued_at precedes its ledger opening's, and leaves the book untouched", async () => {
  const a = await attempt(-100_000); // backdated 100 s, inside the command window
  assert.equal(a.live, undefined, "the live host must not commit the fact");
  assert.equal(a.refusal?.code, "conflict");
  assert.equal(a.refusal?.status, 409);
  assert.match(a.refusal?.message, /flow fact precedes its ledger opening/);
  const book = a.s.inventory[a.org]!.books[a.bookId];
  assert.ok(Object.values(book.ledgers).every((l: any) => l.revision === 0), "no ledger moved");
  assert.equal(Object.values(a.s.records).filter(r => r.resource_id === a.bookId).length, 0, "no flow record was stored");
  await validateSnapshot(emptyState(), buildSnapshot(a.s, a.org, a.ctx)); // the company stays portable
});

test("flow-v1 #119: one millisecond before the opening is refused; an equal issued_at is accepted live and imports", async () => {
  assert.equal((await attempt(-1)).refusal?.code, "conflict");
  for (const offset of [0, 1]) {
    const a = await attempt(offset);
    assert.equal(a.refusal, undefined, `offset ${offset}: ${a.refusal?.message}`);
    assert.equal(a.live?.duplicate, false);
    await validateSnapshot(emptyState(), buildSnapshot(a.s, a.org, a.ctx)); // live and import agree
  }
});
