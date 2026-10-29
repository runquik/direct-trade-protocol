/** GAP observation (red team, surface 2 — Identity and re-homing). Not a fix; a test that pins the
 *  current, wrong behaviour so it stays visible and CI stays green, in the style of
 *  tests/stress/business-boundaries.test.ts. When the gap is closed the `GAP:` assertions flip.
 *
 *  organization-identity.md promises that "a verifier holding a governance log and a person's
 *  identity log can ... check an organization's control history end to end without trusting the
 *  host that served either", and that verifyGovernanceLog "proves that each change was consented
 *  to by the people entitled to consent". But the replay lookup (controlFromIdentityLogs) vouches
 *  for ANY head in a controller's identity log, so a consent signed by a RETIRED operational key
 *  under an old head verifies with no time bound, no revocation and no fork/precedence rule (the
 *  identity layer has one for retired recovery keys, #50; governance has none). A thief holding a
 *  retired operational key of a sole threshold-1 controller — exactly what the reference onboarding
 *  host creates — can forge a fully-consented alternative history that hands the organization to
 *  themselves, and a cold/replaying verifier cannot tell it from the real one. Live acceptance
 *  (controlFromHeads) is unaffected: it vouches only for the currently resolved head.
 *
 *  Finding: see the linked red-team issue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, signIdentity, transitionIdentity, verifyResolution } from '../../src/foundation/identity.ts';
import type { Transition } from '../../src/foundation/identity.ts';
import { buildIdentityLog, verifyIdentityLog } from '../../src/foundation/identity-log.ts';
import type { IdentityLogParts } from '../../src/foundation/identity-log.ts';
import {
  applyGovernanceTransition, controlFromHeads, controlFromIdentityLogs, governanceTransitionDigest,
  organizationGenesisDigest, organizationId, signOrganizationConsent, verifyGovernanceLog, verifyOrganizationGenesis,
  GOVERNANCE_LOG_FORMAT, ORGANIZATION_WINDOW_MS,
} from '../../src/foundation/organization.ts';
import type { GovernanceEntry, GovernanceLog, GovernanceTransition, OrganizationGenesis } from '../../src/foundation/organization.ts';
import { createAuthorityState } from '../../src/foundation/authority.ts';

const start = 1_800_000_000_000, audience = 'https://resolver.example';

/** A person with a genuine, resolver-attested control history at one resolver. When `rotate` is
 *  set, the genesis operational key is rotated away (retired); `retiredKeys` and `retiredHeadDigest`
 *  expose it and the OLD head that still lives in the portable identity log. */
async function person(resolver: KeyPair, resolverId: string, rotate: boolean) {
  const [op, rec, op2] = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op.keyId], threshold: 1 }, recovery: { keys: [rec.keyId], threshold: 1 } }, [op, rec]);
  let state = await createIdentity(genesis, { id: resolverId, key_id: resolver.keyId }, start);
  const retiredHeadDigest = state.head_digest;
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: state.head.identity_id, genesis_digest: state.genesis_digest, resolver_id: resolverId, resolver_key: resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: start - 1000, expires_at: start + 299_000 }, [op, rec]);
  const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: start, transition: null, rehome: null, attestation: null }] };
  let currentKeys = [op];
  if (rotate) {
    const command = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: 1, kind: 'rotate', operational: { keys: [op2.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: start + 10_000, expires_at: start + 310_000 }, [op, op2]);
    state = await transitionIdentity(state, command, start + 10_500); currentKeys = [op2];
    parts.entries.push({ effective_at: state.head.effective_at, transition: command, rehome: null, attestation: null });
  }
  const log = await buildIdentityLog(parts, resolver);
  const resolve = async (now: number) => {
    const request = { identity_id: state.head.identity_id, audience: 'https://host.example', challenge: 'c'.repeat(64) }, { proof } = await issueResolution(state, request, resolver, now);
    const head = await verifyResolution(proof, { ...request, resolver_id: resolverId, resolver_key: resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: null }, now);
    return { head, head_digest: proof.body.head_digest };
  };
  return { id: state.head.identity_id, currentKeys, retiredKeys: [op], retiredHeadDigest, log, resolve };
}

test('GAP: a retired operational key forges a governance history the cold/replay verifier accepts, transferring the organization', async () => {
  const resolver = await generateKeyPair(), resolverId = crypto.randomUUID();
  // Alice: the sole controller (threshold 1), the reference onboarding default. She rotates her
  // operational key, so the genesis key is retired. Mallory is the thief's own identity.
  const alice = await person(resolver, resolverId, /*rotate*/ true);
  const mallory = await person(resolver, resolverId, /*rotate*/ false);
  const genesis: OrganizationGenesis = { nonce: crypto.randomUUID(), founder: alice.id, controllers: [alice.id], threshold: 1 };
  const orgId = await organizationId(genesis), genesisDigest = await organizationGenesisDigest(genesis);
  const now = start + 60_000;

  // Legitimate genesis head 0, as a live host would accept it (Alice's CURRENT key, CURRENT head).
  const aliceLive = await alice.resolve(now), malloryLive = await mallory.resolve(now);
  const liveHeads = controlFromHeads([aliceLive, malloryLive]);
  const legitGenesisConsent = await signOrganizationConsent({ organization_id: orgId, subject: 'genesis', digest: genesisDigest, person_id: alice.id, head_digest: aliceLive.head_digest, issued_at: now, expires_at: now + 3_600_000 }, alice.currentKeys);
  const head0 = await verifyOrganizationGenesis(genesis, [legitGenesisConsent], liveHeads, now);

  // The forgery: every Alice consent signed by her RETIRED key under her OLD head.
  const forgedGenesisConsent = await signOrganizationConsent({ organization_id: orgId, subject: 'genesis', digest: genesisDigest, person_id: alice.id, head_digest: alice.retiredHeadDigest, issued_at: now, expires_at: now + 3_600_000 }, alice.retiredKeys);
  const t1: GovernanceTransition = { organization_id: orgId, expected_digest: head0.head_digest, sequence: 1, controllers: [mallory.id], threshold: 1, issued_at: now, expires_at: now + ORGANIZATION_WINDOW_MS };
  const d1 = await governanceTransitionDigest(t1);
  const e1: GovernanceEntry = { transition: t1, consents: [
    await signOrganizationConsent({ organization_id: orgId, subject: 'transition', digest: d1, person_id: alice.id, head_digest: alice.retiredHeadDigest, issued_at: now, expires_at: now + 3_600_000 }, alice.retiredKeys),
    await signOrganizationConsent({ organization_id: orgId, subject: 'transition', digest: d1, person_id: mallory.id, head_digest: malloryLive.head_digest, issued_at: now, expires_at: now + 3_600_000 }, mallory.currentKeys),
  ] };
  const forgedLog: GovernanceLog = { format: GOVERNANCE_LOG_FORMAT, genesis, consents: [forgedGenesisConsent], entries: [e1] };

  // A cold verifier trusting no host, only the genuine attested identity logs, accepts the forgery.
  const replay = controlFromIdentityLogs(await Promise.all([alice.log, mallory.log].map(l => verifyIdentityLog(l, { require_attestation: true }))));
  const verified = await verifyGovernanceLog(forgedLog, replay);

  // GAP: the forged history verifies and hands control to the thief, authorized only by a retired key.
  assert.deepEqual(verified.governance.controllers.map(c => c.id), [mallory.id],
    'GAP: verifyGovernanceLog accepts a history consented entirely by a retired operational key and installs the thief');
  assert.equal(verified.governance.threshold, 1);
  assert.equal(createAuthorityState([verified.governance]).governance[0].controllers[0].id, mallory.id,
    'GAP: the authority layer consumes the forged governance unchanged');

  // Control: live acceptance vouches only for the current head, so the retired-key consent is refused.
  await assert.rejects(verifyOrganizationGenesis(genesis, [forgedGenesisConsent], liveHeads, now), /not established/,
    'a live host re-resolving Alice rejects the retired-key consent; the gap is specific to the portable replay path');

  // And the applyGovernanceTransition primitive accepts it too, under the same replay lookup.
  const head1 = await applyGovernanceTransition(head0, e1, replay, null);
  assert.deepEqual(head1.head.controllers, [mallory.id], 'GAP: the transition primitive also accepts retired-key consent in replay');
});
