// SPEC v0.4 §8, "A former host": a company that migrated away from a host cannot
// migrate back to it in this candidate. The former host keeps the frozen `migrated`
// record, and `migration.stage` refuses the same company ID with `409 conflict`
// before anything is reserved or committed, so the company stays live where it is.
// Finding #175.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";
import type { Person } from "./helpers.ts";

async function move(from: Client, to: Client, owner: Person, org: string, dest: { audience: string; keyId: string }) {
  const manifest = await from.ok(owner, "migration.prepare", org, { destination: { audience: dest.audience, key_id: dest.keyId } });
  const migration_id = manifest.body.manifest.migration_id;
  const staged = await to.act(owner, "migration.stage", null, { manifest });
  if (staged.status !== 200) return { staged, migration_id };
  for (let index = 0; index < manifest.body.manifest.chunk_hashes.length; index++) {
    const chunk = await from.ok(owner, "migration.chunk", org, { migration_id, index });
    await to.ok(owner, "migration.upload", null, { migration_id, index, data: chunk.data });
  }
  const ready = await to.ok(owner, "migration.ready", null, { migration_id });
  const commit = await from.ok(owner, "migration.commit", org, { migration_id, ready });
  return { staged, migration_id, finalized: await to.act(owner, "migration.finalize", null, { migration_id, commit }) };
}

test("a company cannot migrate back to a host it left: stage is refused 409 conflict and the company stays live", async () => {
  const A = await createDtpStore(), B = await createDtpStore();
  try {
    A.pins[B.audience] = B.keyId; B.pins[A.audience] = A.keyId;
    const a = new Client(A.audience), b = new Client(B.audience), owner = await person(a);
    await person(b, owner);
    const org = await company(a, owner), schema = await profile(a, owner, org), pol = await policy(a, owner, org, [grant(owner)]);
    await a.ok(owner, "record.append", org, record(org, pol, crypto.randomUUID(), schema, { note: "synthetic" }));

    const out = await move(a, b, owner, org, { audience: B.audience, keyId: B.keyId });
    assert.equal(out.finalized?.status, 200, JSON.stringify(out.finalized));

    const back = await move(b, a, owner, org, { audience: A.audience, keyId: A.keyId });
    assert.equal(back.staged.status, 409, JSON.stringify(back.staged));
    assert.equal(back.staged.error?.code, "conflict");
    assert.equal(back.finalized, undefined);

    // The former host still holds only its frozen copy, at the old generation.
    const atA = await a.ok(owner, "organizations.list", null, {});
    const frozen = atA.find((o: any) => o.id === org);
    assert.equal(frozen?.status, "migrated");
    assert.equal(frozen?.generation, 1);

    // The refused return left the company live and writable at its current host.
    const atB = (await b.ok(owner, "organizations.list", null, {})).find((o: any) => o.id === org);
    assert.equal(atB?.status, "active");
    assert.equal(atB?.generation, 2);
    await b.ok(owner, "migration.cancel", org, { migration_id: back.migration_id });
  } finally { await A.close(); await B.close(); }
});
