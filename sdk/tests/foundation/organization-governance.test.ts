import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, signIdentity, transitionIdentity, verifyResolution } from '../../src/foundation/identity.ts';
import type { Control, Signed, Transition } from '../../src/foundation/identity.ts';
import { buildIdentityLog, verifyIdentityLog } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogParts } from '../../src/foundation/identity-log.ts';
import { applyGovernanceTransition, controlFromHeads, controlFromIdentityLogs, governanceHeadDigest, governanceTransitionDigest, organizationGenesisDigest, organizationId, signOrganizationConsent, verifyGovernanceLog, verifyOrganizationConsent, verifyOrganizationGenesis,
  GOVERNANCE_LOG_FORMAT, ORGANIZATION_CONSENT_DOMAIN, ORGANIZATION_TRANSITION_DOMAIN, ORGANIZATION_WINDOW_MS } from '../../src/foundation/organization.ts';
import type { GovernanceEntry, GovernanceLog, GovernanceTransition, OrganizationConsent, OrganizationGenesis } from '../../src/foundation/organization.ts';
import { createAuthorityState } from '../../src/foundation/authority.ts';

const start = 1_800_000_000_000, audience = 'https://resolver.example';
const clone = <T>(v: T): T => structuredClone(v);
/** A person with a real control history at one resolver, and what a host sees of them: a fresh resolution. */
async function person(resolver: KeyPair, resolverId: string, rotate: boolean) {
  const [op, rec, op2] = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op.keyId], threshold: 1 }, recovery: { keys: [rec.keyId], threshold: 1 } }, [op, rec]);
  let state = await createIdentity(genesis, { id: resolverId, key_id: resolver.keyId }, start), keys = [op];
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: state.head.identity_id, genesis_digest: state.genesis_digest, resolver_id: resolverId, resolver_key: resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: start - 1000, expires_at: start + 299_000 }, [op, rec]);
  const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: start, transition: null, rehome: null, attestation: null }] };
  if (rotate) {
    const command = await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1', { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: 1, kind: 'rotate', operational: { keys: [op2.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: start + 10_000, expires_at: start + 310_000 }, [op, op2]);
    state = await transitionIdentity(state, command, start + 10_500); keys = [op2];
    parts.entries.push({ effective_at: state.head.effective_at, transition: command, rehome: null, attestation: null });
  }
  const log = await buildIdentityLog(parts, resolver);
  /** What the host establishes at acceptance: the head from a resolution it verified itself. */
  const resolve = async (now: number) => {
    const request = { identity_id: state.head.identity_id, audience: 'https://host.example', challenge: 'c'.repeat(64) }, { proof } = await issueResolution(state, request, resolver, now);
    const head = await verifyResolution(proof, { ...request, resolver_id: resolverId, resolver_key: resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: null }, now);
    return { head, head_digest: proof.body.head_digest };
  };
  return { id: state.head.identity_id, state, keys, oldKeys: [op], recovery: rec, log, resolve };
}
async function world() {
  const resolver = await generateKeyPair(), resolverId = crypto.randomUUID();
  const [alice, bob, carol] = await Promise.all([person(resolver, resolverId, true), person(resolver, resolverId, false), person(resolver, resolverId, false)]);
  const now = start + 60_000, heads = controlFromHeads(await Promise.all([alice, bob, carol].map(p => p.resolve(now))));
  const sorted = (ids: string[]) => [...ids].sort();
  const genesis: OrganizationGenesis = { nonce: crypto.randomUUID(), founder: alice.id, controllers: sorted([alice.id, bob.id]), threshold: 1 };
  const orgId = await organizationId(genesis), genesisDigest = await organizationGenesisDigest(genesis);
  type P = typeof alice;
  const consent = async (p: P, subject: 'genesis' | 'transition', digest: string, at = now, keys = p.keys, overrides: Partial<OrganizationConsent> = {}) =>
    signOrganizationConsent({ organization_id: orgId, subject, digest, person_id: p.id, head_digest: (await p.resolve(now)).head_digest, issued_at: at, expires_at: at + 3_600_000, ...overrides }, keys);
  return { alice, bob, carol, now, heads, genesis, orgId, genesisDigest, consent, sorted };
}

test('organization genesis: a host accepts it only when every initial controller consents to the exact digest under their current head, with their operational keys, inside the window', async () => {
  const w = await world();
  const consents = [await w.consent(w.alice, 'genesis', w.genesisDigest), await w.consent(w.bob, 'genesis', w.genesisDigest)];
  const accepted = await verifyOrganizationGenesis(w.genesis, consents, w.heads, w.now);
  assert.equal(accepted.organization_id, w.orgId); assert.equal(accepted.genesis_digest, w.genesisDigest);
  assert.deepEqual(accepted.head, { organization_id: w.orgId, sequence: 0, previous_digest: null, controllers: w.genesis.controllers, threshold: 1 });
  assert.equal(accepted.head_digest, await governanceHeadDigest(accepted.head));
  assert.equal(createHash('sha256').update(canonicalize(accepted.head), 'utf8').digest('hex'), accepted.head_digest, 'the head digest is the plain canonical digest, like a person control head');
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [consents[0]], w.heads, w.now), /every initial controller/, 'a threshold is not enough at creation');
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [consents[0], consents[0]], w.heads, w.now), /duplicate/);
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [...consents, await w.consent(w.carol, 'genesis', w.genesisDigest)], w.heads, w.now), /not asked/);
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [consents[0], await w.consent(w.bob, 'genesis', w.genesisDigest, w.now, [w.bob.recovery])], w.heads, w.now), /operational keys/, 'recovery keys are not business signers');
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [await w.consent(w.alice, 'genesis', w.genesisDigest, w.now, w.alice.oldKeys), consents[1]], w.heads, w.now), /operational keys/, 'a retired key does not consent');
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [consents[0], await w.consent(w.bob, 'genesis', w.genesisDigest, w.now - 7_200_000)], w.heads, w.now), /expired/, 'the host checks its clock against the consent window');
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [consents[0], await w.consent(w.bob, 'genesis', 'a'.repeat(64))], w.heads, w.now), /describe/);
  await assert.rejects(verifyOrganizationGenesis({ ...w.genesis, threshold: 2 }, consents, w.heads, w.now), /describe/, 'consent binds the exact genesis digest, so a different genesis is a different consent');
  // A host vouches only for the heads it resolved: a consent naming another head of the same person is not established.
  const stale = await signOrganizationConsent({ ...consents[0].body, head_digest: (await verifyIdentityLog(w.alice.log, { require_attestation: true })).heads[0].head_digest }, w.alice.oldKeys);
  await assert.rejects(verifyOrganizationGenesis(w.genesis, [stale, consents[1]], w.heads, w.now), /not established/);
  // The same consent replays for a verifier without a clock, from the person's identity log.
  const replay = controlFromIdentityLogs(await Promise.all([w.alice.log, w.bob.log].map(l => verifyIdentityLog(l, { require_attestation: true }))));
  assert.deepEqual((await verifyOrganizationGenesis(w.genesis, consents, replay, null)).head_digest, accepted.head_digest);
  assert.equal((await verifyOrganizationGenesis(w.genesis, [stale, consents[1]], replay, null)).head_digest, accepted.head_digest, 'a replay verifier accepts a consent under any head in the log: it cannot know when it was signed');
});

test('governance transition: the current quorum and every added controller consent; the history replays to the same heads and yields the authority layer governance', async () => {
  const w = await world();
  const consents = [await w.consent(w.alice, 'genesis', w.genesisDigest), await w.consent(w.bob, 'genesis', w.genesisDigest)];
  const head0 = await verifyOrganizationGenesis(w.genesis, consents, w.heads, w.now);
  const t1: GovernanceTransition = { organization_id: w.orgId, expected_digest: head0.head_digest, sequence: 1, controllers: w.sorted([w.alice.id, w.bob.id, w.carol.id]), threshold: 2, issued_at: w.now, expires_at: w.now + ORGANIZATION_WINDOW_MS };
  const d1 = await governanceTransitionDigest(t1);
  assert.equal(createHash('sha256').update(canonicalize({ domain: ORGANIZATION_TRANSITION_DOMAIN, body: t1 }), 'utf8').digest('hex'), d1);
  const e1: GovernanceEntry = { transition: t1, consents: [await w.consent(w.alice, 'transition', d1), await w.consent(w.carol, 'transition', d1)] };
  const head1 = await applyGovernanceTransition(head0, e1, w.heads, w.now);
  assert.deepEqual(head1.head, { organization_id: w.orgId, sequence: 1, previous_digest: d1, controllers: t1.controllers, threshold: 2 });
  await assert.rejects(applyGovernanceTransition(head0, { transition: t1, consents: [await w.consent(w.carol, 'transition', d1)] }, w.heads, w.now), /quorum/, 'the added controller alone is not the current quorum');
  await assert.rejects(applyGovernanceTransition(head0, { transition: t1, consents: [await w.consent(w.alice, 'transition', d1)] }, w.heads, w.now), /added controller/, 'joining needs the joiner');
  await assert.rejects(applyGovernanceTransition(head0, { transition: t1, consents: [await w.consent(w.alice, 'transition', d1), await w.consent(w.carol, 'transition', d1), await w.consent(w.bob, 'genesis', d1)] }, w.heads, w.now), /describe/, 'a genesis consent is not a transition consent');
  await assert.rejects(applyGovernanceTransition(head0, { transition: { ...t1, sequence: 2 }, consents: e1.consents }, w.heads, w.now), /stale/);
  await assert.rejects(applyGovernanceTransition(head1, e1, w.heads, w.now), /stale/, 'a transition applies to exactly one head');
  await assert.rejects(applyGovernanceTransition(head0, { transition: { ...t1, threshold: 3 }, consents: e1.consents }, w.heads, w.now), /describe/, 'consents bind the exact transition');
  await assert.rejects(applyGovernanceTransition(head0, { transition: { ...t1, controllers: w.genesis.controllers, threshold: 1 }, consents: e1.consents }, w.heads, w.now), /changes nothing/);
  await assert.rejects(applyGovernanceTransition(head0, { transition: { ...t1, issued_at: w.now - 2, expires_at: w.now - 1 }, consents: e1.consents }, w.heads, w.now), /expired/, 'the host checks its clock against the transition window');
  // The founder leaves: two of three consent, nobody joins. After genesis the founder holds no standing authority.
  const t2: GovernanceTransition = { organization_id: w.orgId, expected_digest: head1.head_digest, sequence: 2, controllers: w.sorted([w.bob.id, w.carol.id]), threshold: 1, issued_at: w.now, expires_at: w.now + ORGANIZATION_WINDOW_MS };
  const d2 = await governanceTransitionDigest(t2), e2: GovernanceEntry = { transition: t2, consents: [await w.consent(w.bob, 'transition', d2), await w.consent(w.carol, 'transition', d2)] };
  await assert.rejects(applyGovernanceTransition(head1, { transition: t2, consents: [e2.consents[0]] }, w.heads, w.now), /quorum/);
  const head2 = await applyGovernanceTransition(head1, e2, w.heads, w.now);
  // The whole history, replayed by a verifier with no clock from the people's identity logs alone.
  const log: GovernanceLog = { format: GOVERNANCE_LOG_FORMAT, genesis: w.genesis, consents, entries: [e1, e2] };
  const logs = await Promise.all([w.alice.log, w.bob.log, w.carol.log].map(l => verifyIdentityLog(l, { require_attestation: true })));
  const v = await verifyGovernanceLog(clone(log), controlFromIdentityLogs(logs));
  assert.deepEqual(v.heads.map(h => h.head_digest), [head0.head_digest, head1.head_digest, head2.head_digest]);
  assert.deepEqual(v.governance, { organization_id: w.orgId, controllers: t2.controllers.map(id => ({ kind: 'person', id, organization_id: null })), threshold: 1 });
  assert.equal(createAuthorityState([v.governance]).governance[0].threshold, 1, 'accepted by the authority layer unchanged');
  await assert.rejects(verifyGovernanceLog(clone(log), controlFromIdentityLogs(logs.slice(0, 2))), /not established/, 'a withheld person log leaves that person\'s consents unverifiable');
  const truncated = clone(log); truncated.entries.pop(); assert.equal((await verifyGovernanceLog(truncated, controlFromIdentityLogs(logs))).head_digest, head1.head_digest, 'a log that stops early verifies: it proves lineage, not currency');
  const reordered = clone(log); [reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]]; await assert.rejects(verifyGovernanceLog(reordered, controlFromIdentityLogs(logs)), /stale/);
  const altered = clone(log); altered.entries[0].transition.threshold = 1; await assert.rejects(verifyGovernanceLog(altered, controlFromIdentityLogs(logs)), /describe/);
  await assert.rejects(verifyGovernanceLog({ ...clone(log), format: 'dtp-governance-log-2' } as never, controlFromIdentityLogs(logs)), /format/);
});

test('organization governance conformance vectors: consents and governance logs are judged exactly, and the generator reproduces the file', async () => {
  const file = fileURLToPath(new URL('../../../spec/vectors/organization-governance.json', import.meta.url));
  const vectors = parseUntrustedJson(readFileSync(file, 'utf8')) as {
    consent_domain: string; transition_domain: string; format: string; window_ms: number; people: { person_id: string; log: IdentityLog }[];
    consents: { accept: { why: string; consent: Signed<OrganizationConsent>; expected: any; head: Control; expect: OrganizationConsent }[]; reject: { why: string; consent: Signed<OrganizationConsent>; expected: any; head: Control }[] };
    governance: { accept: { why: string; log: GovernanceLog; people: string[]; expect: any }[]; reject: { why: string; log: GovernanceLog; people: string[] }[] } };
  assert.equal(vectors.consent_domain, ORGANIZATION_CONSENT_DOMAIN); assert.equal(vectors.transition_domain, ORGANIZATION_TRANSITION_DOMAIN); assert.equal(vectors.format, GOVERNANCE_LOG_FORMAT); assert.equal(vectors.window_ms, ORGANIZATION_WINDOW_MS);
  assert.ok(vectors.consents.accept.length >= 2 && vectors.consents.reject.length >= 14 && vectors.governance.accept.length >= 3 && vectors.governance.reject.length >= 16);
  const people = new Map<string, IdentityLog>(vectors.people.map(p => [p.person_id, p.log]));
  const lookup = async (ids: string[]) => controlFromIdentityLogs(await Promise.all(ids.map(id => verifyIdentityLog(people.get(id)!, { require_attestation: true }))));
  for (const v of vectors.consents.accept) assert.deepEqual(await verifyOrganizationConsent(v.consent, v.expected, v.head, null), v.expect, v.why);
  for (const v of vectors.consents.reject) await assert.rejects(verifyOrganizationConsent(v.consent, v.expected, v.head, null), v.why);
  for (const v of vectors.governance.accept) {
    const r = await verifyGovernanceLog(v.log, await lookup(v.people));
    assert.deepEqual({ organization_id: r.organization_id, genesis_digest: r.genesis_digest, heads: r.heads, governance: r.governance }, v.expect, v.why);
    // Each head digest, and each transition digest a head commits to, recomputed with a second SHA-256 implementation.
    for (const h of r.heads) assert.equal(createHash('sha256').update(canonicalize(h.head), 'utf8').digest('hex'), h.head_digest, v.why);
    v.log.entries.forEach((e, i) => assert.equal(createHash('sha256').update(canonicalize({ domain: ORGANIZATION_TRANSITION_DOMAIN, body: e.transition }), 'utf8').digest('hex'), r.heads[i + 1].head.previous_digest, v.why));
  }
  for (const v of vectors.governance.reject) await assert.rejects(verifyGovernanceLog(v.log, await lookup(v.people)), v.why);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/build-organization-governance-vectors.ts', import.meta.url)), '--check'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('organization consent and governance material is detached plain data: accessors are refused without being invoked', async () => {
  const w = await world(), consent = await w.consent(w.bob, 'genesis', w.genesisDigest), head = (await w.bob.resolve(w.now)).head;
  let reads = 0; const trap = { ...consent, body: { ...consent.body, get digest() { reads++; return w.genesisDigest; } } };
  await assert.rejects(verifyOrganizationConsent(trap as never, { organization_id: w.orgId, subject: 'genesis', digest: w.genesisDigest, person_id: w.bob.id }, head, w.now)); assert.equal(reads, 0);
  const racing = clone(consent), pending = verifyOrganizationConsent(racing, { organization_id: w.orgId, subject: 'genesis', digest: w.genesisDigest, person_id: w.bob.id }, head, w.now);
  racing.body.digest = 'f'.repeat(64); assert.equal((await pending).digest, w.genesisDigest);
});
