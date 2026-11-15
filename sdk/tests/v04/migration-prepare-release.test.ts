// #173: a source releases a preparation's base64 chunks once no destination can
// use them (commit, cancellation, manifest expiry, or a newer preparation by the
// same company), so repeated or abandoned preparations cannot grow the source's
// stored state without bound. Manifests and receipts stay for verified retries.
// Replaces the red team's gap test from #174.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import { emptyState, type Context, type Snapshot } from "../../src/v04/model.ts";
import { draftCommand } from "../../src/v04/wire.ts";
import { migrationPrepare, migrationStage, migrationChunk, migrationUpload, migrationReady, migrationCommit, migrationCancel, migrationReceipt } from "../../src/v04/migration.ts";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

const rejectsCode = (p: () => unknown, code: string) => assert.throws(p, (e: any) => e.code === code && e.status === 409);

async function source() {
  const [ka, kb] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  const now = Date.parse("2026-11-10T12:00:00.000Z");
  const pins = { "https://a.test": ka.keyId, "https://b.test": kb.keyId };
  const a: Context = { audience: "https://a.test", storeKey: ka, pins, now }, b: Context = { audience: "https://b.test", storeKey: kb, pins, now };
  const sa = emptyState(), sb = emptyState();
  function company() {
    const orgId = crypto.randomUUID(), personId = crypto.randomUUID();
    sa.organizations[orgId] = { id: orgId, name: "Synthetic source", controllers: [personId], threshold: 1, generation: 1, status: "active", members: {}, invitations: {}, installations: {}, history: [] };
    const snapshot: Snapshot = { version: "0.4", source: a.audience, organization: structuredClone(sa.organizations[orgId]), persons: [{ id: personId, keys: [ka.keyId], retired_keys: [], history: [] }], policies: [], profiles: [], releases: [], records: [], inventory: { synthetic_notes: "x".repeat(150000) } };
    async function prepare(ctx: Context = a) {
      const token = await migrationPrepare(sa, draftCommand(a.audience, { id: personId, key: ka }, "migration.prepare", orgId, {}, ctx.now), ctx, snapshot, { audience: b.audience, key_id: kb.keyId });
      return { token, mid: token.body.manifest.migration_id as string };
    }
    return { orgId, snapshot, prepare };
  }
  const held = () => Object.values(sa.outgoing).reduce((n, out) => n + out.chunks.length, 0);
  return { a, b, sa, sb, company, held };
}

test("#173: cancellation releases the source's chunks, and the manifest and cancel receipt stay", async () => {
  const f = await source(), x = f.company();
  const { mid } = await x.prepare();
  assert.equal(f.held(), 3);
  const cancel = await migrationCancel(f.sa, mid, f.a);
  assert.equal(f.held(), 0);
  rejectsCode(() => migrationChunk(f.sa, mid, 0, f.a.now), "expired");
  assert.ok(f.sa.outgoing[mid].manifest_token);
  assert.deepEqual(await migrationCancel(f.sa, mid, f.a), cancel, "a retried cancel returns the same durable receipt");
});

test("#173: commit releases the source's chunks; the destination already holds them and the receipt stays", async () => {
  const f = await source(), x = f.company();
  const { token, mid } = await x.prepare();
  await migrationStage(f.sb, f.b, token);
  for (let i = 0; i < token.body.manifest.chunk_hashes.length; i++) await migrationUpload(f.sb, mid, i, migrationChunk(f.sa, mid, i, f.a.now).data, f.b);
  const ready = await migrationReady(f.sb, mid, f.b, () => {});
  const commit = await migrationCommit(f.sa, mid, ready, f.a, x.snapshot);
  assert.equal(f.held(), 0);
  rejectsCode(() => migrationChunk(f.sa, mid, 0, f.a.now), "expired");
  assert.deepEqual(migrationReceipt(f.sa, mid), commit);
  assert.deepEqual(await migrationCommit(f.sa, mid, ready, f.a, x.snapshot), commit, "a retried commit returns the same receipt");
});

test("#173: a newer preparation by the same company supersedes the older payload, and the older one can still be cancelled", async () => {
  const f = await source(), x = f.company(), y = f.company();
  const older = await x.prepare(), other = await y.prepare(), newer = await x.prepare();
  assert.equal(f.sa.outgoing[older.mid].chunks.length, 0);
  assert.equal(f.sa.outgoing[newer.mid].chunks.length, 3);
  assert.equal(f.sa.outgoing[other.mid].chunks.length, 3, "another company's live preparation is untouched");
  rejectsCode(() => migrationChunk(f.sa, older.mid, 0, f.a.now), "expired");
  assert.ok(migrationChunk(f.sa, newer.mid, 0, f.a.now).data);
  await migrationCancel(f.sa, older.mid, f.a);
  for (let i = 0; i < 50; i++) await x.prepare();
  assert.equal(f.held(), 6, "however often one company prepares, the source holds one payload for it");
});

test("#173: an expired, uncommitted preparation is released by the next preparation on the host", async () => {
  const f = await source(), x = f.company(), y = f.company();
  const { mid } = await x.prepare();
  const later: Context = { ...f.a, now: f.a.now + 3600000 };
  rejectsCode(() => migrationChunk(f.sa, mid, 0, later.now), "expired");
  await y.prepare(later);
  assert.equal(f.sa.outgoing[mid].chunks.length, 0);
  assert.equal(f.held(), 3);
});

test("#173: one company's cancelled preparations no longer take another company's room on the host", { timeout: 240000 }, async () => {
  async function run(abandoned: boolean) {
    const host = await createDtpStore({ maxStateBytes: 4 * 1024 * 1024 });
    try {
      const destination = await generateKeyPair(), audience = "https://destination.example.test";
      host.pins[audience] = destination.keyId;
      const a = new Client(host.audience);
      const owner = await person(a), org = await company(a, owner), schema = await profile(a, owner, org), pol = await policy(a, owner, org, [grant(owner)]);
      for (let i = 0; i < 4; i++) await a.ok(owner, "record.append", org, record(org, pol, crypto.randomUUID(), schema, { note: "SYNTHETIC".repeat(6500) }));
      const other = await person(a), otherOrg = await company(a, other, "Unrelated Synthetic Co"), otherSchema = await profile(a, other, otherOrg), otherPol = await policy(a, other, otherOrg, [grant(other)]);
      let prepared = 0;
      if (abandoned) for (let i = 0; i < 64; i++) {
        const attempt = await a.act(owner, "migration.prepare", org, { destination: { audience, key_id: destination.keyId } });
        assert.equal(attempt.status, 200, `preparation ${i + 1} is accepted`);
        const migration_id = attempt.result.body.manifest.migration_id;
        if (i % 2 === 0) assert.equal((await a.act(owner, "migration.cancel", org, { migration_id })).status, 200);
        prepared++;
      }
      let written = 0;
      for (; written < 200; written++) {
        const attempt = await a.act(other, "record.append", otherOrg, record(otherOrg, otherPol, crypto.randomUUID(), otherSchema, { note: "SYNTHETIC".repeat(6500) }));
        if (attempt.status !== 200) { assert.equal(attempt.status, 507); assert.equal(attempt.error.code, "capacity"); break; }
      }
      return { prepared, written };
    } finally { await host.close(); }
  }
  const baseline = await run(false), attacked = await run(true);
  assert.equal(attacked.prepared, 64);
  assert.ok(baseline.written >= 25, `baseline: ${baseline.written}`);
  // What remains is one live payload (about 4/3 of X's ~240 KB snapshot, some
  // 5 records' worth) plus 64 manifests and receipts of a few KB each. Before
  // the fix the unrelated company kept 4 of 31 records' room.
  assert.ok(baseline.written - attacked.written <= 12, `the unrelated company writes ${attacked.written} of ${baseline.written}`);
});
