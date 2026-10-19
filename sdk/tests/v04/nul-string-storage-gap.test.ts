// Gap observation (red team): a string value containing U+0000 is valid canonical JSON and the
// v0.4 kernel accepts it, but the reference host keeps its state in Postgres jsonb, which cannot
// store U+0000, so the same signed command fails with 500 internal. These tests assert the
// current, divergent behaviour so CI stays green; the GAP assertions flip when the gap is closed
// (either the host stores the value, or the documents refuse it with a stable 400 code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { canonicalize } from "../../src/canonical.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { execute } from "../../src/v04/engine.ts";
import { emptyState } from "../../src/v04/model.ts";
import type { Context } from "../../src/v04/model.ts";
import { draftCommand, organizationId, personId, signCommand } from "../../src/v04/wire.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

test("Canonicalization and the kernel accept a string value containing U+0000", async () => {
  // SPEC section 2: member names exclude control characters; "Member values are unrestricted."
  assert.equal(canonicalize({ name: "A\u0000B" }), '{"name":"A\\u0000B"}');
  const state = emptyState();
  const ctx: Context = { audience: "https://nul-gap.test", storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const key = await generateKeyPair(), owner = { id: await personId(key.keyId), key };
  await execute(state, await signCommand(draftCommand(ctx.audience, owner, "person.register", null, { keys: [key.keyId] }, ctx.now), [key]), ctx);
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
  const result = await execute(state, await signCommand(draftCommand(ctx.audience, owner, "organization.create", org, { name: "A\u0000B", nonce, controllers: [owner.id], threshold: 1 }, ctx.now), [key]), ctx);
  assert.deepEqual(result, { organization_id: org });
  assert.equal(state.organizations[org].name, "A\u0000B");
});

test("GAP: the reference host answers 500 internal for the same signed commands", async () => {
  const host = await createDtpStore(), client = new Client(host.audience);
  try {
    const owner = await person(client);
    const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
    const nul = await client.act(owner, "organization.create", org, { name: "A\u0000B", nonce, controllers: [owner.id], threshold: 1 });
    assert.equal(nul.status, 500, "GAP: a valid company name with U+0000 is not stored");
    assert.equal(nul.error.code, "internal");
    // Control: any other control character in a value is stored.
    const soh = await client.act(owner, "organization.create", org, { name: "A\u0001B", nonce, controllers: [owner.id], threshold: 1 });
    assert.equal(soh.status, 200, JSON.stringify(soh.error));

    const company2 = await company(client, owner), pol = await policy(client, owner, company2, [grant(owner)]), prof = await profile(client, owner, company2);
    const body = await client.act(owner, "record.append", company2, record(company2, pol, crypto.randomUUID(), prof, { note: "line 1\u0000line 2" }));
    assert.equal(body.status, 500, "GAP: a record body that passes its contract is not stored");
    assert.equal(body.error.code, "internal");
    const control = await client.act(owner, "record.append", company2, record(company2, pol, crypto.randomUUID(), prof, { note: "line 1\u0001line 2" }));
    assert.equal(control.status, 200, JSON.stringify(control.error));
  } finally { await host.close(); }
});
