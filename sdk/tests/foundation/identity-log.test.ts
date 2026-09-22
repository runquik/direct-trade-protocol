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
import { createIdentity, issueResolution, signIdentity, transitionIdentity, verifyResolution, LEASE_MS, CLOCK_MARGIN_MS } from '../../src/foundation/identity.ts';
import type { IdentityState, Transition, Signed } from '../../src/foundation/identity.ts';
import { attestHead, buildIdentityLog, compareCheckpoint, precedence, recoverGenesisInstant, verifyIdentityLog, IDENTITY_LOG_FORMAT, LEGACY_IDENTITY_LOG_FORMAT } from '../../src/foundation/identity-log.ts';
import type { IdentityLog, IdentityLogParts } from '../../src/foundation/identity-log.ts';

const start = 1_800_000_000_000, audience = 'https://resolver.example';
const strict = { require_attestation: true }, lenient = { require_attestation: false };
/** A live host timeline, including leases the log never records, driven through the real state machine. */
async function live() {
  const [op0, rec0, op1, op2, rec1, resolver, stranger] = await Promise.all(Array.from({ length: 7 }, () => generateKeyPair()));
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: [op0.keyId], threshold: 1 }, recovery: { keys: [rec0.keyId], threshold: 1 } }, [op0, rec0]);
  const resolverId = crypto.randomUUID();
  let state = await createIdentity(genesis, { id: resolverId, key_id: resolver.keyId }, start);
  const enrollment = await signIdentity('DTP-IDENTITY-ENROLLMENT-1', { identity_id: state.head.identity_id, genesis_digest: state.genesis_digest, resolver_id: resolverId,
    resolver_key: resolver.keyId, audience, nonce: 'e'.repeat(64), issued_at: start - 1000, expires_at: start + 299_000 }, [op0, rec0]);
  const parts: IdentityLogParts = { genesis, enrollment, entries: [{ effective_at: start, transition: null, rehome: null, attestation: null }] }, states: IdentityState[] = [state];
  let now = start;
  async function step(kind: Transition['kind'], operational: string[], recovery: string[], signers: KeyPair[], leaseFirst: boolean) {
    now = Math.max(now + 7_000, state.head.effective_at);
    if (leaseFirst) { state = (await issueResolution(state, { identity_id: state.head.identity_id, audience: 'https://relying.example', challenge: 'a'.repeat(64) }, resolver, now)).state; now += 1_234; }
    const body: Transition = { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: state.head.sequence + 1, kind,
      operational: { keys: operational, threshold: 1 }, recovery: { keys: recovery, threshold: 1 }, issued_at: now - 500, expires_at: now + 200_000 };
    const command = await signIdentity('DTP-IDENTITY-TRANSITION-1', body, signers);
    state = await transitionIdentity(state, command, now); states.push(state);
    parts.entries.push({ effective_at: state.head.effective_at, transition: command, rehome: null, attestation: null });
  }
  await step('rotate', [op1.keyId], [rec0.keyId], [op0, op1], true);        // a lease pushes effective_at past acceptance
  await step('recover', [op2.keyId], [rec0.keyId], [rec0, op2], false);      // no outstanding lease
  await step('recovery-policy', [op2.keyId], [rec1.keyId], [rec0, rec1], true);
  return { op0, rec0, op1, op2, rec1, resolver, stranger, resolverId, parts, states, state };
}
const clone = <T>(v: T): T => structuredClone(v);

test('identity log: a verifier holding only the log reproduces every head digest the live host computed', async () => {
  const f = await live(), log = await buildIdentityLog(f.parts, f.resolver);
  assert.equal(log.format, IDENTITY_LOG_FORMAT);
  assert.ok(f.states[1].head.effective_at > f.parts.entries[1].transition!.body.issued_at + LEASE_MS, 'fixture exercises the lease barrier');
  const verified = await verifyIdentityLog(clone(log), strict);
  assert.deepEqual(verified.heads.map(h => h.head_digest), f.states.map(s => s.head_digest));
  assert.deepEqual(verified.head, f.state.head); assert.equal(verified.head_digest, f.state.head_digest);
  assert.deepEqual(verified.retired_keys, f.state.retired_keys); assert.deepEqual(verified.unattested, []);
  assert.deepEqual(verified.resolver, { id: f.resolverId, key_id: f.resolver.keyId, audience, epoch: 0 });
  assert.equal(verified.identity_id, f.state.head.identity_id); assert.equal(verified.genesis_digest, f.state.genesis_digest);
});

test('identity log: tampered, reordered, truncated-in-the-middle and spliced logs are refused', async () => {
  const f = await live(), log = await buildIdentityLog(f.parts, f.resolver), other = await live(), foreign = await buildIdentityLog(other.parts, other.resolver);
  const cases: [string, (l: IdentityLog) => void][] = [
    ['reordered entries', l => { [l.entries[1], l.entries[2]] = [l.entries[2], l.entries[1]]; }],
    ['a dropped middle entry', l => { l.entries.splice(2, 1); }],
    ['a dropped genesis entry', l => { l.entries.shift(); }],
    ['a repeated entry', l => { l.entries.splice(2, 0, clone(l.entries[1])); }],
    ['an interior instant moved by one millisecond', l => { l.entries[1].effective_at += 1; l.entries[1].attestation = null; }],
    ['a transition signature altered', l => { const s = l.entries[1].transition!.signatures[0]; s.signature = l.entries[2].transition!.signatures[0].signature; }],
    ['a transition body altered after signing', l => { l.entries[1].transition!.body.operational.keys = [f.stranger.keyId]; }],
    ['a signature removed so the quorum fails', l => { l.entries[2].transition!.signatures = l.entries[2].transition!.signatures.slice(1); }],
    ['a transition spliced from another identity', l => { l.entries[1] = clone(foreign.entries[1]); }],
    ['another identity\'s genesis', l => { l.genesis = clone(foreign.genesis); }],
    ['another identity\'s enrollment', l => { l.enrollment = clone(foreign.enrollment); }],
    ['a genesis instant outside the enrollment window', l => { l.entries[0].effective_at = start + 299_000; l.entries[0].attestation = null; }],
    ['an unknown format', l => { (l as any).format = 'dtp-identity-log-3'; }],
    ['a format 1 log carrying a rehome member', l => { (l as any).format = 'dtp-identity-log-1'; }],
    ['an entry carrying both a transition and a rehome', l => { l.entries[1].rehome = { body: { identity_id: 'x' }, signatures: [] } as any; }],
    ['an extra member', l => { (l as any).note = 'x'; }],
    ['an extra entry member', l => { (l.entries[1] as any).accepted_at = start; }],
    ['a transition on the genesis entry', l => { l.entries[0].transition = clone(l.entries[1].transition); }],
    ['a rehome on the genesis entry', l => { l.entries[0].rehome = { body: { identity_id: 'x' }, signatures: [] } as any; }],
    ['no entries', l => { l.entries = []; }],
  ];
  for (const [why, damage] of cases) { const l = clone(log); damage(l); await assert.rejects(verifyIdentityLog(l, lenient), why); }
  await verifyIdentityLog(clone(log), strict);
});

test('identity log: instants are bounded by what the owner signed', async () => {
  const f = await live(), log = await buildIdentityLog({ ...f.parts, entries: f.parts.entries.slice(0, 2) }, null);
  const t = log.entries[1].transition!.body, check = async (at: number) => { const l = clone(log); l.entries[1].effective_at = at; return verifyIdentityLog(l, lenient); };
  await assert.rejects(check(t.issued_at - 1), /precedes/);
  await assert.rejects(check(t.expires_at + LEASE_MS + CLOCK_MARGIN_MS), /beyond/);
  assert.equal((await check(t.expires_at - 1 + LEASE_MS + CLOCK_MARGIN_MS)).head.effective_at, t.expires_at - 1 + LEASE_MS + CLOCK_MARGIN_MS);
  const early = clone(log); early.entries[0].effective_at = start + 100_000; // inside the enrollment window, but later than head 1: time runs backwards
  assert.ok(early.entries[1].effective_at < start + 100_000 && early.entries[1].effective_at >= t.issued_at);
  await assert.rejects(verifyIdentityLog(early, lenient), /decrease/);
});

test('identity log: the final instant is host-asserted; only an attestation or a checkpoint pins it', async () => {
  const f = await live(), honest = await buildIdentityLog(f.parts, f.resolver), verified = await verifyIdentityLog(honest, strict);
  // A host, or anyone relaying the log, shifts the last head by one millisecond inside the signed window.
  const shifted = clone(honest), last = shifted.entries.length - 1; shifted.entries[last].effective_at += 1;
  await assert.rejects(verifyIdentityLog(clone(shifted), lenient), /does not describe this head/, 'the stale attestation exposes it');
  shifted.entries[last].attestation = null;
  await assert.rejects(verifyIdentityLog(clone(shifted), strict), /attestation required/);
  const accepted = await verifyIdentityLog(clone(shifted), lenient);
  assert.deepEqual(accepted.unattested, [last]); assert.notEqual(accepted.head_digest, verified.head_digest);
  assert.deepEqual(accepted.head.operational, verified.head.operational, 'who controls the identity is still owner-proven');
  // A verifier that pinned the honest head from a resolution sees the disagreement instead of guessing.
  assert.equal(compareCheckpoint(accepted, { sequence: last, head_digest: verified.head_digest }), 'conflict');
  assert.equal(compareCheckpoint(verified, { sequence: last, head_digest: verified.head_digest }), 'consistent');
  assert.equal(compareCheckpoint(verified, { sequence: last + 1, head_digest: 'f'.repeat(64) }), 'log-behind');
  // If the enrolled resolver signs both versions, the two attestations are portable proof of equivocation.
  const second = await attestHead(accepted.head, accepted.resolver, f.resolver); shifted.entries[last].attestation = second;
  await verifyIdentityLog(clone(shifted), strict);
  assert.equal(second.body.sequence, honest.entries[last].attestation!.body.sequence); assert.notEqual(second.body.head_digest, honest.entries[last].attestation!.body.head_digest);
});

test('identity log: attestations bind the enrolled resolver key, the head and the sequence', async () => {
  const f = await live(), log = await buildIdentityLog(f.parts, f.resolver);
  await assert.rejects(buildIdentityLog(f.parts, f.stranger), /enrolled resolver key/);
  const forged = clone(log); forged.entries[1].attestation = await attestHead((await verifyIdentityLog(clone(log), strict)).heads[1].head, { id: f.resolverId, epoch: 0 }, f.stranger);
  await assert.rejects(verifyIdentityLog(forged, lenient), /enrolled resolver key/);
  const moved = clone(log); moved.entries[1].attestation = clone(log.entries[2].attestation);
  await assert.rejects(verifyIdentityLog(moved, lenient), /does not describe/);
  const epoch = clone(log); epoch.entries[1].attestation!.body.resolver_epoch = 1;
  await assert.rejects(verifyIdentityLog(epoch, lenient), /does not describe/);
  await assert.rejects(verifyIdentityLog(clone(log), {} as never)); await assert.rejects(verifyIdentityLog(clone(log), { require_attestation: 'no' } as never));
});

test('identity log: a verified log and a fresh resolution together prove current control and its full lineage', async () => {
  const f = await live(), log = await verifyIdentityLog(await buildIdentityLog(f.parts, f.resolver), strict);
  const request = { identity_id: log.identity_id, audience: 'https://relying.example', challenge: 'c'.repeat(64) }, at = f.state.head.effective_at;
  const { proof } = await issueResolution(f.state, request, f.resolver, at);
  const head = await verifyResolution(proof, { ...request, resolver_id: log.resolver.id, resolver_key: log.resolver.key_id, resolver_epoch: log.resolver.epoch, minimum_sequence: log.head.sequence, minimum_digest: log.head_digest }, at);
  assert.equal(compareCheckpoint(log, { sequence: head.sequence, head_digest: proof.body.head_digest }), 'consistent');
});

test('identity log: a host that never recorded the genesis instant can recover it from the first transition', async () => {
  const f = await live(), first = f.parts.entries[1].transition!;
  assert.equal(await recoverGenesisInstant(f.parts.genesis, f.parts.enrollment, first.body.expected_digest), start);
  assert.equal(await recoverGenesisInstant(f.parts.genesis, f.parts.enrollment, 'f'.repeat(64)), null);
});

test('identity log conformance vectors: accepted logs yield exactly the published heads; every rejected log is refused', async () => {
  const file = fileURLToPath(new URL('../../../spec/vectors/identity-log.json', import.meta.url));
  const vectors = parseUntrustedJson(readFileSync(file, 'utf8')) as { format: string; legacy_format: string; rehome_domain: string; lease_ms: number; clock_margin_ms: number;
    accept: { why: string; require_attestation: boolean; log: IdentityLog; expect: any }[]; reject: { why: string; require_attestation: boolean; log: IdentityLog }[];
    precedence: { why: string; a: IdentityLog; b: IdentityLog; expect: ReturnType<typeof precedence> }[] };
  assert.equal(vectors.format, IDENTITY_LOG_FORMAT); assert.equal(vectors.legacy_format, LEGACY_IDENTITY_LOG_FORMAT); assert.equal(vectors.rehome_domain, 'DTP-IDENTITY-REHOME-1');
  assert.equal(vectors.lease_ms, LEASE_MS); assert.equal(vectors.clock_margin_ms, CLOCK_MARGIN_MS);
  assert.ok(vectors.accept.length >= 8 && vectors.reject.length >= 47 && vectors.precedence.length >= 5);
  assert.ok(vectors.accept.some(v => v.log.format === LEGACY_IDENTITY_LOG_FORMAT) && vectors.accept.some(v => v.log.entries.some(e => e.rehome !== null)), 'both formats and a move are covered');
  for (const v of vectors.accept) {
    const r = await verifyIdentityLog(v.log, { require_attestation: v.require_attestation });
    assert.deepEqual({ identity_id: r.identity_id, genesis_digest: r.genesis_digest, resolver: r.resolver, resolvers: r.resolvers,
      heads: r.heads.map(h => ({ sequence: h.head.sequence, head_digest: h.head_digest, effective_at: h.head.effective_at, epoch: h.epoch, attested: h.attested })),
      operational: r.head.operational, recovery: r.head.recovery, retired_keys: r.retired_keys, unattested: r.unattested }, v.expect, v.why);
    // Each head digest is recomputed here from first principles with a second SHA-256 implementation.
    for (const h of r.heads) assert.equal(createHash('sha256').update(canonicalize(h.head), 'utf8').digest('hex'), h.head_digest, v.why);
  }
  for (const v of vectors.reject) await assert.rejects(verifyIdentityLog(v.log, { require_attestation: v.require_attestation }), v.why);
  for (const v of vectors.precedence) assert.equal(precedence(await verifyIdentityLog(v.a, { require_attestation: false }), await verifyIdentityLog(v.b, { require_attestation: false })), v.expect, v.why);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/build-identity-log-vectors.ts', import.meta.url)), '--check'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('identity log: accessors are refused without being invoked and later caller changes have no effect', async () => {
  const f = await live(), log = await buildIdentityLog(f.parts, f.resolver);
  let reads = 0; const trapped = clone(log) as any; Object.defineProperty(trapped.entries[1], 'effective_at', { enumerable: true, get() { reads++; return 0; } });
  await assert.rejects(verifyIdentityLog(trapped, lenient)); assert.equal(reads, 0);
  const racing = clone(log), pending = verifyIdentityLog(racing, strict); racing.entries[1].transition!.body.operational.threshold = 0; racing.entries.length = 1;
  assert.equal((await pending).heads.length, log.entries.length);
});
