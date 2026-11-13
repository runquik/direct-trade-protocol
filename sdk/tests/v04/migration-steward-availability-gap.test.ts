// Gap observation (records current behaviour; stays green on main).
//
// SPEC.md v0.4 §8 requires migration.prepare to collect "current quorum for
// **every** owned policy" ("Full company portability is not a controller
// shortcut around personnel stewardship"), and §3 requires a policy update to
// carry "the prior active steward quorum". Neither the spec nor the reducer
// bounds a policy's steward set to remain reachable: memberships are mandatory-
// expiring (≤366 days, §9) and a controller may revoke a member at any time.
//
// So a business compartment whose only stewards are non-controller members can
// reach ZERO active stewards. Once there, the active-steward quorum is an empty
// set and can never meet a threshold ≥ 1, which:
//   (1) blocks migration.prepare for the WHOLE company (assertAllStewards spans
//       every policy), i.e. the company becomes permanently non-portable, and
//   (2) blocks policy.update of that compartment (steward quorum), so it can
//       never be re-stewarded — not even by the full controller quorum.
//
// The one escape hatch is cooperative: a threshold of the policy's ORIGINAL
// stewards must still hold their keys and re-accept membership. If they are
// gone (lost keys, departed, defunct), there is no protocol recovery. This test
// pins all three facts. The GAP: assertions flip if a controller-quorum
// recovery/override is ever introduced; the recovery case documents the escape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { Client, company, expiry, grant, member, person, policy } from "./helpers.ts";

test("v0.4 migration: a policy whose non-controller stewards all go inactive traps the whole company", { timeout: 60000 }, async () => {
  const source = await createDtpStore(), destination = await createDtpStore();
  try {
    source.pins[destination.audience] = destination.keyId;
    destination.pins[source.audience] = source.keyId;
    const a = new Client(source.audience), b = new Client(destination.audience);
    const owner = await person(a);        // sole controller (controllers never expire)
    const steward = await person(a);      // non-controller member and sole steward
    await person(b, owner);               // destination independently knows the controller identity
    const org = await company(a, owner);
    await member(a, owner, org, steward, ["members.manage"]);
    const pol = await policy(a, owner, org, [grant(owner)], [steward], "business");
    const dest = { destination: { audience: destination.audience, key_id: destination.keyId } };

    // Baseline: migratable while the sole steward is an active member and co-signs.
    assert.equal((await a.act(owner, "migration.prepare", org, dest, [steward.key])).status, 200);

    // The controller revokes the member/steward (revoke only forbids controllers).
    await a.ok(owner, "membership.revoke", org, { person_id: steward.id });

    // GAP (1): the whole company is now non-portable — assertAllStewards spans
    // every policy and the compartment's active-steward quorum is unreachable.
    const trapped = await a.act(owner, "migration.prepare", org, dest, [steward.key]);
    assert.equal(trapped.status, 403);
    assert.equal(trapped.error?.code, "approval_required");

    // GAP (2): the controller cannot re-steward the frozen compartment either;
    // policy.update needs the prior active steward quorum, which is empty.
    const restew = await a.act(owner, "policy.update", org, {
      policy_id: pol, expected_revision: 1, classification: "business",
      threshold: 1, stewards: [owner.id],
      grants: [{ person_id: owner.id, actions: ["read", "write", "export"], resource_ids: "*", expires_at: expiry() }],
    });
    assert.equal(restew.status, 403);
    assert.equal(restew.error?.code, "forbidden");

    // Escape hatch (cooperative only): the ORIGINAL steward re-accepts membership
    // and becomes active again, after which migration can proceed. This works
    // only because the steward still holds keys and cooperates.
    const invitation_id = crypto.randomUUID();
    await a.ok(owner, "membership.invite", org, { invitation_id, person_id: steward.id, permissions: ["members.manage"], expires_at: new Date(Date.now() + 2 * 86400000).toISOString() });
    await a.ok(steward, "membership.accept", org, { invitation_id });
    assert.equal((await a.act(owner, "migration.prepare", org, dest, [steward.key])).status, 200);
  } finally {
    await source.close(); await destination.close();
  }
});
