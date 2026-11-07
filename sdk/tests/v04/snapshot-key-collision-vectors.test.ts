// Conformance for spec/vectors/snapshot-key-collision.json (#137): which key collisions with identities outside the
// company may refuse a migration import, and what a refusal names. Regenerate with
// `node scripts/build-snapshot-key-collision-vectors.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { emptyState } from "../../src/v04/model.ts";
import type { Context, Person, Snapshot } from "../../src/v04/model.ts";
import { execute } from "../../src/v04/engine.ts";
import { applySnapshot, validateSnapshot } from "../../src/v04/snapshot.ts";
import { generateKeyPair } from "../../src/keys.ts";

type Case = { name: string; why: string; expect: "import" | "conflict"; collides?: { person_id?: string; installation_id?: string };
  destination: { persons: Person[] }; snapshot: Snapshot; after?: { persons: { id: string; keys: string[]; retired_keys: string[] }[] } };
const vectors = parseUntrustedJson(readFileSync(new URL("../../../spec/vectors/snapshot-key-collision.json", import.meta.url), "utf8")) as { cases: Case[] };

/** Establishes the destination's persons through the host's own command path, each command at its signed instant. */
async function destination(persons: Person[]) {
  const s = emptyState(), ctx: Context = { audience: persons[0].history[0].audience, storeKey: await generateKeyPair(), pins: {}, now: 0 };
  const commands = persons.flatMap(p => p.history).sort((a, b) => Date.parse(a.issued_at) - Date.parse(b.issued_at));
  for (const c of commands) { ctx.now = Date.parse(c.issued_at); await execute(s, structuredClone(c), ctx); }
  for (const p of persons) assert.deepEqual({ ...s.persons[p.id] }, p, "replaying the published history gives the published person");
  return s;
}

test("snapshot-key-collision vectors: the required cases are present", () => {
  assert.deepEqual(vectors.cases.map(c => [c.name, c.expect]).sort(), [
    ["active-installation-key-registered", "conflict"], ["current-key-registered", "conflict"], ["former-member-forked", "import"],
    ["invitee-forked", "conflict"], ["member-forked", "conflict"], ["retired-key-registered", "import"], ["revoked-installation-key-registered", "import"],
  ]);
});

test("snapshot-key-collision vectors: a historical-only key or a former member's fork does not block the import, and the destination keeps its own record", async () => {
  for (const c of vectors.cases.filter(c => c.expect === "import")) {
    const dest = await destination(c.destination.persons);
    await applySnapshot(dest, structuredClone(c.snapshot));
    assert.ok(dest.organizations[c.snapshot.organization.id], c.name);
    for (const p of c.destination.persons) assert.deepEqual({ ...dest.persons[p.id] }, p, `${c.name}: the destination's person ${p.id} is unchanged`);
    assert.deepEqual(Object.values(dest.persons).map(p => ({ id: p.id, keys: p.keys, retired_keys: p.retired_keys })).sort((a, b) => a.id < b.id ? -1 : 1), c.after!.persons, c.name);
  }
});

test("snapshot-key-collision vectors: a current key or a current person's fork is refused with conflict, naming who collides", async () => {
  for (const c of vectors.cases.filter(c => c.expect === "conflict")) {
    const named = c.collides!.person_id ? `person ${c.collides!.person_id}` : `installation ${c.collides!.installation_id}`;
    const dest = await destination(c.destination.persons);
    let refusal: any = null;
    try { await validateSnapshot(dest, structuredClone(c.snapshot)); } catch (e) { refusal = e; }
    assert.equal(refusal?.code, "conflict", `${c.name}: ${c.why}`); assert.equal(refusal.status, 409, c.name);
    assert.ok(String(refusal.message).includes(named), `${c.name}: the refusal names ${named}: ${refusal.message}`);
    // Without the destination's squatted persons, the same snapshot imports: the collision is the only reason.
    const clean = emptyState(); await applySnapshot(clean, structuredClone(c.snapshot));
    assert.ok(clean.organizations[c.snapshot.organization.id], `${c.name}: imports at a host without the collision`);
  }
});
