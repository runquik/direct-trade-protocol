// GAP TEST (red-team, surface 8 — specification against implementation of dtp/flow@1).
//
// spec/profiles/flow/1.md promises: "On snapshot import a host replays every opening and fact, refuses a fact
// that predates the opening of a ledger it changes, and must reproduce every book exactly."
//
// A live host orders a book only by acceptance (seq): a flow fact can be written only after its ledger is open,
// and the write path (engine.ts, flow-v1) never compares the fact's command `issued_at` against the opening's.
// Snapshot import, however, reconstructs that ordering from the writer-set `issued_at`
// (snapshot.ts: `opening.issued_at <= r.command.issued_at`). Because a command's `issued_at` may sit anywhere in
// the protocol's ±5-minute validity window (wire.ts: `end - start <= 300000`, `end > now`), it need not agree with
// acceptance order. A fact whose `issued_at` is earlier than its ledger opening's — a backdated-but-in-window
// command, or a producer clock skewed behind the controller who opened the ledger moments earlier — is accepted
// and committed by the live host, yet its book is refused on import. The company becomes non-portable: migration,
// cutover and export/re-import all run validateSnapshot and fail. Two honest hosts disagree on committed records.
//
// This test pins the current divergent behaviour (live accepts; import refuses) so CI stays green and the gap
// stays visible. The `GAP:` assertion flips when the divergence is closed from either direction (import ordered by
// acceptance rather than `issued_at`, or the live path made to enforce the same ordering). See the control test
// below: the identical fact with a normal `issued_at` imports cleanly, so the difference is purely the ordering.
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

/** A source host holding one goods ledger, with the first fixture fact (a plain "move" of 50 kg into a lot at
 *  revision 0) written under a command whose `issued_at` is `factIssuedAt`. Returns the committed state. */
async function book(protocol: Awaited<ReturnType<typeof loadProtocolProfiles>>, factIssuedAt: (openingNow: number, now: number) => { issued_at: string; expires_at: string } | null) {
  const key = await generateKeyPair(), storeKey = await generateKeyPair();
  const owner = { id: await personId(key.keyId), key };
  const ctx: Context = { audience: "https://source.test", storeKey, pins: {}, now: Date.parse("2026-09-10T12:00:00.000Z"), kinds: protocol.kinds, protocolProfiles: protocol.protocolProfiles };
  const s = emptyState();
  const call = async (action: string, org: string | null, payload: any) => { ctx.now += 1; return execute(s, await signCommand(draftCommand(ctx.audience, owner, action, org, payload, ctx.now), [key]), ctx); };

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
  ctx.now += 1; const openingNow = ctx.now;
  await execute(s, await signCommand(draftCommand(ctx.audience, owner, "flow.ledger.open", org,
    { policy_id: pol, book_id: bookId, asset: { product: productId, currency: null }, account: null, balance: "nonnegative" }, openingNow), [key]), ctx);

  const id = crypto.randomUUID();
  const factRecord = { id, root_id: id, supersedes: null, organization_id: org, policy_id: pol, resource_id: bookId,
    profile_digest: flow.contract_digest, counterparty_ids: [], body: structuredClone(flow.flows[0].facts[0].fact) };
  ctx.now += 1;
  const cmd = draftCommand(ctx.audience, owner, "record.append", org, factRecord, ctx.now);
  const override = factIssuedAt(openingNow, ctx.now);
  if (override) { cmd.issued_at = override.issued_at; cmd.expires_at = override.expires_at; }
  const live = await execute(s, await signCommand(cmd, [key]), ctx);
  return { s, org, ctx, openingNow, live, factIssuedAt: cmd.issued_at };
}

test("flow-v1 GAP: snapshot import refuses a book the live host committed, solely because a fact's issued_at precedes its ledger opening's", async () => {
  const protocol = await loadProtocolProfiles();
  // A legitimate, in-window backdated fact command: issued_at 100 s before the opening, expires_at still in the future.
  const b = await book(protocol, (openingNow, now) => ({ issued_at: new Date(openingNow - 100000).toISOString(), expires_at: new Date(now + 60000).toISOString() }));

  // The live host accepts and commits the fact; the write path never compares issued_at ordering.
  assert.equal(b.live?.duplicate, false, "live host accepts the backdated fact");
  assert.ok(b.factIssuedAt < new Date(b.openingNow).toISOString(), "the fact's issued_at really precedes the opening's");

  // GAP: the committed book cannot be imported — migration/cutover/export-import all fail here.
  await assert.rejects(
    validateSnapshot(emptyState(), buildSnapshot(b.s, b.org, b.ctx)),
    (e: any) => e.code === "invalid_snapshot" && /flow fact precedes its ledger opening/.test(e.message),
    "GAP: import refuses a book the live host committed (flips when import orders by acceptance, not issued_at)",
  );
});

test("flow-v1 control: the identical fact with a normal issued_at imports and reproduces the book", async () => {
  const protocol = await loadProtocolProfiles();
  const b = await book(protocol, () => null); // default issued_at === now, after the opening
  assert.equal(b.live?.duplicate, false, "live host accepts the fact");
  await validateSnapshot(emptyState(), buildSnapshot(b.s, b.org, b.ctx)); // resolves: the book reproduces exactly
});
