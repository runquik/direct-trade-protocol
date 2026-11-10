// GAP (red team, surface 5): a source host keeps a full base64 copy of the
// snapshot for every `migration.prepare`, in the one host-wide state, and
// nothing ever releases it: not cancellation, not expiry, not commit. One
// company's controller retrying a preparation (each manifest lives one hour)
// therefore fills the reference host's single serialized-state ceiling
// (SPEC v0.4 section 9) and every other company on that host is refused 507.
// SPEC v0.4 section 8 step 1 says "The source remains writable" during
// preparation, and section 9 reasons about the capacity of the destination only.
// This test pins today's behaviour so the gap stays visible. When it starts to
// fail, the gap is closed: delete this file in the pull request that fixes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

async function host(abandonedPreparations: boolean) {
  const options = { maxStateBytes: 4 * 1024 * 1024 };
  const source = await createDtpStore(options);
  try {
    // A pinned destination that never answers: preparation needs only its pin.
    const destination = await generateKeyPair(), audience = "https://destination.example.test";
    source.pins[audience] = destination.keyId;
    const a = new Client(source.audience);
    // Company X: a controller and some ordinary records, about 240 KB of snapshot.
    const owner = await person(a), org = await company(a, owner), schema = await profile(a, owner, org), pol = await policy(a, owner, org, [grant(owner)]);
    for (let i = 0; i < 4; i++) await a.ok(owner, "record.append", org, record(org, pol, crypto.randomUUID(), schema, { note: "SYNTHETIC".repeat(6500) }));
    // Company Y: an unrelated tenant on the same host.
    const other = await person(a), otherOrg = await company(a, other, "Unrelated Synthetic Co"), otherSchema = await profile(a, other, otherOrg), otherPol = await policy(a, other, otherOrg, [grant(other)]);
    let prepared = 0, refused: any;
    if (abandonedPreparations) {
      // X's controller prepares and then cancels, again and again, as a retry
      // after an expired manifest would. Each cancellation is a durable
      // source-signed token. None of them frees the stored chunks.
      for (let i = 0; i < 64; i++) {
        const attempt = await a.act(owner, "migration.prepare", org, { destination: { audience, key_id: destination.keyId } });
        if (attempt.status !== 200) { refused = attempt; break; }
        prepared++;
        const cancelled = await a.act(owner, "migration.cancel", org, { migration_id: attempt.result.body.manifest.migration_id });
        if (cancelled.status !== 200) { refused = cancelled; break; }
      }
    }
    // How many ordinary 58 KB records can Y still write?
    let written = 0;
    for (; written < 200; written++) {
      const attempt = await a.act(other, "record.append", otherOrg, record(otherOrg, otherPol, crypto.randomUUID(), otherSchema, { note: "SYNTHETIC".repeat(6500) }));
      if (attempt.status !== 200) { assert.equal(attempt.status, 507); assert.equal(attempt.error.code, "capacity"); break; }
    }
    const fresh = await a.act(owner, "migration.prepare", org, { destination: { audience, key_id: destination.keyId } });
    return { prepared, refused, written, freshPrepare: fresh.status };
  } finally { await source.close(); }
}

test("GAP: abandoned migration preparations are never released and exhaust the source host for every company", { timeout: 240000 }, async () => {
  const baseline = await host(false), attacked = await host(true);
  // One company's cancelled preparations alone reach the host-wide ceiling.
  assert.ok(attacked.prepared >= 2 && attacked.prepared < 64, `capacity reached after ${attacked.prepared} cancelled preparations`);
  assert.equal(attacked.refused.status, 507);
  assert.equal(attacked.refused.error.code, "capacity");
  // GAP: the unrelated company, which did nothing, loses almost all of its room to write.
  assert.ok(baseline.written >= 25, `baseline: the unrelated company writes ${baseline.written} records`);
  assert.ok(attacked.written <= 6, `GAP: after the cancelled preparations it writes only ${attacked.written}`);
  assert.ok(baseline.written - attacked.written >= 20, "GAP: retained, cancelled preparations take the room of 20 or more ordinary records");
  // GAP: and the company that caused it cannot begin a fresh migration out.
  assert.equal(baseline.freshPrepare, 507, "the baseline host is full too, after the unrelated company's writes");
  assert.equal(attacked.freshPrepare, 507);
});
