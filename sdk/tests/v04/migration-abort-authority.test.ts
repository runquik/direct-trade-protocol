// Who may abandon a staged move at the destination (#204). The source-signed cancellation is the authority:
// any registered person who presents a cancellation that matches the stage may abort it, so a move whose
// initiator has left the company, or lost their key, can still be released by the company's current controllers.
// A cancellation that does not match the stage is still refused, and an activated stage still cannot be aborted.
// Rule: spec/v0.4/SPEC.md section 8.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { organizationId } from "../../src/v04/wire.ts";
import { Client, member, person } from "./helpers.ts";

test("v0.4 migration: a controller other than the initiator aborts a cancelled stage and releases its reservations", { timeout: 120000 }, async () => {
  const source = await createDtpStore(), destination = await createDtpStore();
  try {
    source.pins[destination.audience] = destination.keyId; destination.pins[source.audience] = source.keyId;
    const a = new Client(source.audience), b = new Client(destination.audience);
    const initiator = await person(a), other = await person(a), unregistered = await person(a), stranger = await person(b);
    await person(b, initiator); await person(b, other);
    const nonce = crypto.randomUUID(), org = await organizationId(initiator.id, nonce);
    await a.ok(initiator, "organization.create", org, { name: "Synthetic Two-Controller Co", nonce, controllers: [initiator.id, other.id], threshold: 1 }, [other.key]);
    await member(a, initiator, org, unregistered);
    const dest = { audience: destination.audience, key_id: destination.keyId };

    const manifest = await a.ok(initiator, "migration.prepare", org, { destination: dest }), migration_id = manifest.body.manifest.migration_id;
    await b.ok(initiator, "migration.stage", null, { manifest });
    for (let index = 0; index < manifest.body.manifest.chunk_hashes.length; index++)
      await b.ok(initiator, "migration.upload", null, { migration_id, index, data: (await a.ok(initiator, "migration.chunk", org, { migration_id, index })).data });
    await b.ok(initiator, "migration.ready", null, { migration_id });
    // The ready stage holds the company ID and its unregistered member's identity at the destination.
    assert.equal((await b.act(unregistered, "person.register", null, { keys: [unregistered.key.keyId] })).status, 409);

    // The initiator leaves; the remaining controller cancels at the source.
    await a.ok(other, "organization.policy", org, { controllers: [other.id], threshold: 1 });
    const cancel = await a.ok(other, "migration.cancel", org, { migration_id });

    // A cancellation for a different migration does not release this stage, whoever presents it.
    const decoy = await a.ok(other, "migration.prepare", org, { destination: dest });
    const decoyCancel = await a.ok(other, "migration.cancel", org, { migration_id: decoy.body.manifest.migration_id });
    const mismatched = await b.act(stranger, "migration.abort", null, { migration_id, cancel: decoyCancel });
    assert.equal(mismatched.error?.code, "invalid_cancel", JSON.stringify(mismatched.error));

    // Before #204 this was 403 "staging owner required".
    const aborted = await b.ok(other, "migration.abort", null, { migration_id, cancel });
    assert.deepEqual(aborted, { migration_id, aborted: true });
    // Idempotent for anyone holding the same cancellation, including the former initiator.
    assert.deepEqual(await b.ok(initiator, "migration.abort", null, { migration_id, cancel }), { migration_id, aborted: true });

    // Reservations are released: the member can enrol, and the company can stage a fresh move.
    await b.ok(unregistered, "person.register", null, { keys: [unregistered.key.keyId] });
    await b.ok(other, "migration.stage", null, { manifest: await a.ok(other, "migration.prepare", org, { destination: dest }) });
  } finally { await source.close(); await destination.close(); }
});
