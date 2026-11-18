// A destination stage that never became ready is abandoned when its manifest expires (#205). Nothing can complete
// it after expiry (upload and ready refuse `expired`, and commit needs a ready receipt), so the host releases its
// uploaded chunks and its company-ID reservation, as an abort does. An abandoned unready stage therefore cannot hold
// the destination's one shared capacity against unrelated tenants. Ready stages are not touched (SPEC v0.4 section 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { draftCommand, signCommand } from "../../src/v04/wire.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

test("v0.4 migration: an unready stage past its manifest expiry releases its chunks and company ID", { timeout: 180000 }, async () => {
  const clock = { offset: 0 }, now = () => Date.now() + clock.offset;
  // A small destination ceiling keeps the run short; the mechanism does not depend on it.
  const A = await createDtpStore({ now }), B = await createDtpStore({ now, maxStateBytes: 3 * 1024 * 1024 });
  try {
    A.pins[B.audience] = B.keyId; B.pins[A.audience] = A.keyId;
    const a = new Client(A.audience), b = new Client(B.audience);
    const at = async (c: Client, who: any, action: string, o: string | null, payload: any) =>
      c.send(await signCommand(draftCommand(c.audience, who, action, o, payload, now()), [who.key]));
    // An unrelated tenant of the destination.
    const y = await person(b), yorg = await company(b, y), ys = await profile(b, y, yorg), yp = await policy(b, y, yorg, [grant(y)]);
    const yWrite = () => at(b, y, "record.append", yorg, record(yorg, yp, crypto.randomUUID(), ys, { note: "Y " + "z".repeat(50000) }));
    assert.equal((await yWrite()).status, 200);

    // A company at the source stages a move larger than the destination's free space and walks away.
    const x = await person(a); await person(b, x);
    const org = await company(a, x), schema = await profile(a, x, org), pol = await policy(a, x, org, [grant(x)]), res = crypto.randomUUID();
    for (let i = 0; i < 30; i++) await a.ok(x, "record.append", org, record(org, pol, res, schema, { note: i + ":" + "SYNTHETIC-".repeat(6000) }));
    const dest = { audience: B.audience, key_id: B.keyId };
    const manifest = await a.ok(x, "migration.prepare", org, { destination: dest }), migration_id = manifest.body.manifest.migration_id;
    await b.ok(x, "migration.stage", null, { manifest });
    let full = false;
    for (let index = 0; index < manifest.body.manifest.chunk_hashes.length && !full; index++) {
      const r = await b.act(x, "migration.upload", null, { migration_id, index, data: (await a.ok(x, "migration.chunk", org, { migration_id, index })).data });
      if (r.status === 507) full = true; else assert.equal(r.status, 200, JSON.stringify(r.error));
    }
    assert.ok(full, "the staged chunks fill the destination");
    const blocked = await yWrite();
    assert.equal(blocked.status, 507, "while the manifest is live, the stage holds the space");

    // Past the manifest's expiry the stage can never become ready, so it no longer holds the space.
    clock.offset = 3 * 3600000;
    const after = await yWrite();
    assert.equal(after.status, 200, `before #205 this was 507: ${JSON.stringify(after.error)}`);
    const status = await at(b, x, "migration.status", null, { migration_id });
    assert.equal(status.status, 200, JSON.stringify(status.error));
    assert.deepEqual({ ...status.result, migration_id: undefined }, { migration_id: undefined, uploaded: [], total: manifest.body.manifest.chunk_hashes.length, ready: false, activated: false, aborted: true });
    // The company ID is released too: a fresh move can be staged.
    const fresh = (await at(a, x, "migration.prepare", org, { destination: dest })).result;
    const staged = await at(b, x, "migration.stage", null, { manifest: fresh });
    assert.equal(staged.status, 200, JSON.stringify(staged.error));
  } finally { await A.close(); await B.close(); }
});
