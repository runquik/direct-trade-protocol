// Conformance for spec/vectors/snapshot-import.json (#63): the host import rules a destination re-runs at
// migration.ready, beyond the profile reducers. The base MUST import and reproduce its projections exactly; every
// case MUST be refused with invalid_snapshot. Regenerate with `node scripts/build-snapshot-import-vectors.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { emptyState } from "../../src/v04/model.ts";
import type { Snapshot } from "../../src/v04/model.ts";
import { applySnapshot, validateSnapshot } from "../../src/v04/snapshot.ts";
import { canonicalize } from "../../src/canonical.ts";

type Case = { name: string; rule: string; why: string; expect: string; snapshot: Snapshot };
const vectors = parseUntrustedJson(readFileSync(new URL("../../../spec/vectors/snapshot-import.json", import.meta.url), "utf8")) as {
  base: { expect: string; projections: { heads: Record<string, string>; inventory: unknown }; snapshot: Snapshot }; cases: Case[];
};
const refusal = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return { code: e?.code, message: String(e?.message) }; } };

test("snapshot-import vectors: the base imports and the destination reproduces its projections exactly", async () => {
  assert.equal(vectors.base.expect, "import");
  const dest = emptyState(), snap = vectors.base.snapshot, org = snap.organization.id;
  await applySnapshot(dest, structuredClone(snap));
  const heads = Object.fromEntries(Object.values(dest.records).filter(r => r.is_head).map(r => [r.root_id, r.id]));
  assert.deepEqual(heads, vectors.base.projections.heads);
  assert.equal(canonicalize(dest.inventory[org]), canonicalize(vectors.base.projections.inventory));
  assert.equal(canonicalize(dest.inventory[org]), canonicalize(snap.inventory[org]), "the carried inventory is what replay produces");
  const kinds = new Set(snap.profiles.map(p => p.id));
  for (const kind of ["dtp/product@1.0.0", "dtp/inventory@2.0.0", "dtp/party@1.0.0", "dtp/order@1.0.0", "dtp/forecast@1.0.0"]) assert.ok(kinds.has(kind), `the base carries ${kind}`);
});

// The reference refusal for each case: the code is normative, the message pins that the case breaks the rule it names
// and not an earlier check (a bad signature, a schema refusal).
const reasons: Record<string, RegExp> = {
  "fact-unpublished-pack": /packaging revision the product had not published/,
  "fact-pack-before-published": /packaging revision the product had not published/,
  "product-drops-packaging": /product continuity violated/,
  "product-alters-packaging": /product continuity violated/,
  "order-born-acknowledged": /order continuity violated/,
  "order-lines-after-acknowledgment": /order continuity violated/,
  "forecast-subject-changed": /forecast continuity violated/,
  "party-kind-changed": /party continuity violated/,
  "person-party-business-policy": /person party outside a personnel policy/,
  "ledger-projection-differs": /inventory projection differs from signed events/,
};

test("snapshot-import vectors: every case is refused with invalid_snapshot, for the rule it names", async () => {
  assert.deepEqual(vectors.cases.map(c => c.name).sort(), Object.keys(reasons).sort(), "every case has a pinned reason, and every required case is present");
  for (const c of vectors.cases) {
    assert.equal(c.expect, "invalid_snapshot", c.name);
    const validated = await refusal(validateSnapshot(emptyState(), structuredClone(c.snapshot)));
    assert.equal(validated?.code, "invalid_snapshot", `${c.name}: ${c.why}`);
    assert.match(validated!.message, reasons[c.name], c.name);
    const dest = emptyState();
    assert.equal((await refusal(applySnapshot(dest, structuredClone(c.snapshot))))?.code, "invalid_snapshot", c.name);
    assert.deepEqual(dest.organizations, {}, `${c.name}: a refused import leaves nothing behind`);
  }
});

test("snapshot-import vectors: each case is the base company with its records re-signed, not a different company", () => {
  const base = vectors.base.snapshot;
  for (const c of vectors.cases) {
    assert.equal(c.snapshot.organization.id, base.organization.id, c.name);
    assert.equal(canonicalize(c.snapshot.persons), canonicalize(base.persons), c.name);
    assert.equal(canonicalize(c.snapshot.profiles), canonicalize(base.profiles), c.name);
    assert.equal(canonicalize(c.snapshot.policies), canonicalize(base.policies), c.name);
    assert.notEqual(canonicalize(c.snapshot), canonicalize(base), c.name);
  }
});
