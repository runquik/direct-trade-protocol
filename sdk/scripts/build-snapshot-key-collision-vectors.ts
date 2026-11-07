// Builds spec/vectors/snapshot-key-collision.json (#137): whole, signed v0.4 snapshots, each with the persons a
// destination host already holds, that a conforming destination MUST import or MUST refuse at `migration.ready`.
// Someone outside the company registered, at the destination, a key the company's history also binds. A key that is
// historical only in the snapshot (retired, or a revoked installation's) does not block the import; a current key does,
// and so does a fork of a person ID who is still a controller, member or invitee. Keys, instants and IDs are fixed and
// Ed25519 signatures are deterministic, so rerunning this must leave the file unchanged; `--check` compares without
// writing. The keys are published on purpose: never use them for anything real. Rule: spec/v0.4/SPEC.md sections 3, 8.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Sync } from '../src/sha256.ts';
import { encodeKeyId, encodeSecretKey } from '../src/keys.ts';
import type { KeyPair } from '../src/keys.ts';
import { emptyState } from '../src/v04/model.ts';
import type { Context, Person, Snapshot, State } from '../src/v04/model.ts';
import { execute } from '../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand, signToken } from '../src/v04/wire.ts';
import { applySnapshot, buildSnapshot } from '../src/v04/snapshot.ts';
import { loadProtocolProfiles } from './dtp-v04-dev-server.ts';

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-snapshot-key-collision-vector:${label}`);
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, true, ['sign']);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey('jwk', key)).x!, 'base64url'));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const K = {
  owner: await fixedKey('owner'), member: await fixedKey('member-genesis'), memberSecond: await fixedKey('member-second'), memberFresh: await fixedKey('member-fresh'),
  vendor: await fixedKey('module-vendor'), squatter: await fixedKey('squatter-rotated'), sourceHost: await fixedKey('source-host'), destinationHost: await fixedKey('destination-host'), assessor: await fixedKey('assessor'),
};
const ASSESSOR = 'https://assessor.example';
const owner = { id: await personId(K.owner.keyId), key: K.owner }, worker = { id: await personId(K.member.keyId), key: K.member };
const SOURCE = 'https://source-host.example', DESTINATION = 'https://destination-host.example', T = Date.parse('2026-09-01T08:00:00.000Z');
const NONCE = '5b5b5b5b-0000-4000-8000-000000000001', ORG = await organizationId(owner.id, NONCE);
const fixedId = (role: number, n: number) => `${role.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const POLICY = fixedId(1, 1), INVITATION = fixedId(2, 1), INSTALLATION = fixedId(3, 1), MODULE = fixedId(4, 1);
const protocol = await loadProtocolProfiles();

type Variant = 'revoked-installation-key-registered' | 'retired-key-registered' | 'former-member-forked'
  | 'active-installation-key-registered' | 'current-key-registered' | 'member-forked' | 'invitee-forked';

function host(audience: string, storeKey: KeyPair, offset: number, role: number) {
  const s: State = emptyState();
  const ctx: Context = { audience, storeKey, pins: {}, now: T + offset, assessmentPins: { [ASSESSOR]: K.assessor.keyId }, kinds: protocol.kinds, protocolProfiles: protocol.protocolProfiles };
  let n = 0;
  const call = async (actor: { id: string; key: KeyPair }, action: string, org: string | null, payload: Record<string, unknown>, cosign: KeyPair[] = []) => {
    ctx.now += 60_000;
    const c = draftCommand(audience, actor, action, org, payload, ctx.now); c.request_id = fixedId(role, ++n);
    return execute(s, await signCommand(c, [actor.key, ...cosign]), ctx);
  };
  return { s, ctx, call };
}
const year = (from: number) => new Date(from + 300 * 86_400_000).toISOString();

/** The company at the source, then the persons someone outside it registered at the destination first. */
async function build(variant: Variant): Promise<{ snapshot: Snapshot; destination: Person[] }> {
  const src = host(SOURCE, K.sourceHost, 0, 0xc);
  await src.call(owner, 'person.register', null, { keys: [K.owner.keyId] });
  await src.call(owner, 'organization.create', ORG, { name: 'Synthetic Portable Co', nonce: NONCE, controllers: [owner.id], threshold: 1 });
  await src.call(owner, 'policy.create', ORG, { policy_id: POLICY, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: year(T) }] });
  if (variant.includes('installation')) {
    const contract = { publisher_id: ORG, name: 'synthetic-note', version: '1.0.0', schema: { type: 'object', properties: { note: { type: 'string', maxLength: 120 } }, required: ['note'], additionalProperties: false }, semantics: 'structural', dependencies: [] };
    const profileDigest = await digest(contract); const { publisher_id: _, ...profile } = contract;
    await src.call(owner, 'profile.publish', ORG, { ...profile, digest: profileDigest, visibility: 'private', readers: [] });
    const assessment = await signToken({ kind: 'module-assessment', issuer: ASSESSOR, issued_at: new Date(T).toISOString(), expires_at: year(T), artifact_digest: 'b'.repeat(64), outcome: 'approved' },
      { audience: ASSESSOR, storeKey: K.assessor, pins: {}, now: T });
    const release = await src.call(owner, 'release.publish', ORG, { module_id: MODULE, version: '1.0.0', artifact_digest: 'b'.repeat(64), profiles: [profileDigest], actions: ['read'], visibility: 'private', assessment }) as any;
    await src.call(owner, 'installation.create', ORG, { installation_id: INSTALLATION, release_digest: release.digest, key_id: K.vendor.keyId, policy_ids: [POLICY], actions: ['read'], mode: 'interactive', expires_at: year(T) }, [K.vendor]);
    if (variant === 'revoked-installation-key-registered') await src.call(owner, 'installation.revoke', ORG, { installation_id: INSTALLATION });
  } else {
    await src.call(worker, 'person.register', null, { keys: [K.member.keyId] });
    await src.call(owner, 'membership.invite', ORG, { invitation_id: INVITATION, person_id: worker.id, permissions: [], expires_at: year(T) });
    if (variant !== 'invitee-forked') await src.call(worker, 'membership.accept', ORG, { invitation_id: INVITATION });
    if (variant === 'retired-key-registered' || variant === 'current-key-registered') await src.call(worker, 'person.rotate', null, { add: [K.memberSecond.keyId], revoke: [] }, [K.memberSecond]);
    if (variant === 'retired-key-registered') await src.call(worker, 'person.rotate', null, { add: [], revoke: [K.memberSecond.keyId] });
    if (variant.endsWith('forked')) await src.call(worker, 'person.rotate', null, { add: [K.memberFresh.keyId], revoke: [K.member.keyId] }, [K.memberFresh]);
    if (variant === 'former-member-forked') await src.call(owner, 'membership.revoke', ORG, { person_id: worker.id });
  }
  const snapshot = buildSnapshot(src.s, ORG, src.ctx);

  const dst = host(DESTINATION, K.destinationHost, 86_400_000, 0xd);
  const squat = async (key: KeyPair) => { const p = { id: await personId(key.keyId), key }; await dst.call(p, 'person.register', null, { keys: [key.keyId] }); return p; };
  if (variant.includes('installation')) await squat(K.vendor);
  else if (variant.endsWith('forked')) { const thief = await squat(K.member); await dst.call(thief, 'person.rotate', null, { add: [K.squatter.keyId], revoke: [K.member.keyId] }, [K.squatter]); }
  else await squat(K.memberSecond);
  return { snapshot, destination: Object.values(dst.s.persons).sort((a, b) => a.id < b.id ? -1 : 1) };
}

const CASES: { name: Variant; why: string; expect: 'import' | 'conflict'; collides?: { person_id: string } | { installation_id: string } }[] = [
  { name: 'revoked-installation-key-registered', expect: 'import', why: 'the company revoked a module installation; its vendor registered the installation key as a person at the destination' },
  { name: 'retired-key-registered', expect: 'import', why: 'a member retired a second key; whoever holds it registered it at the destination as a new identity' },
  { name: 'former-member-forked', expect: 'import', why: 'a member rotated away their genesis key and was then revoked; whoever holds the genesis key registered it at the destination (the same person ID) and rotated to a key of their own. The destination keeps its own record for that person ID' },
  { name: 'active-installation-key-registered', expect: 'conflict', collides: { installation_id: INSTALLATION }, why: 'the installation is still active and its key is registered at the destination as a person' },
  { name: 'current-key-registered', expect: 'conflict', collides: { person_id: worker.id }, why: "a member's current second key is registered at the destination as a new identity" },
  { name: 'member-forked', expect: 'conflict', collides: { person_id: worker.id }, why: "as former-member-forked, but the member's membership is still active" },
  { name: 'invitee-forked', expect: 'conflict', collides: { person_id: worker.id }, why: 'as former-member-forked, but the person holds a pending invitation and no membership' },
];

/** Seeds a destination with the given persons the way a host holds them, then imports. */
const destinationState = (persons: Person[]) => { const s = emptyState(); for (const p of persons) s.persons[p.id] = structuredClone(p); return s; };
const cases = [];
for (const c of CASES) {
  const { snapshot, destination } = await build(c.name);
  const dest = destinationState(destination);
  let outcome: { code: string; message: string } | null = null;
  try { await applySnapshot(dest, structuredClone(snapshot)); } catch (e: any) { outcome = { code: e?.code, message: String(e?.message) }; }
  if (c.expect === 'import') {
    if (outcome) throw new Error(`${c.name}: the reference refused the import: ${outcome.message}`);
    for (const p of destination) if (JSON.stringify(dest.persons[p.id]) !== JSON.stringify(p)) throw new Error(`${c.name}: the import changed the destination's person ${p.id}`);
    cases.push({ name: c.name, why: c.why, expect: c.expect, destination: { persons: destination }, snapshot, after: { persons: Object.values(dest.persons).sort((a, b) => a.id < b.id ? -1 : 1).map(p => ({ id: p.id, keys: p.keys, retired_keys: p.retired_keys })) } });
  } else {
    const named = 'person_id' in c.collides! ? `person ${c.collides.person_id}` : `installation ${c.collides!.installation_id}`;
    if (outcome?.code !== 'conflict' || !outcome.message.includes(named)) throw new Error(`${c.name}: the reference gave ${JSON.stringify(outcome)}, not a conflict naming ${named}`);
    cases.push({ name: c.name, why: c.why, expect: c.expect, collides: c.collides, destination: { persons: destination }, snapshot });
  }
}

const out = {
  description: 'v0.4 candidate: key collisions at migration import (spec/v0.4/SPEC.md sections 3 and 8, #137). Each case is a whole, signed company snapshot and the persons the destination host already holds, each with its signed history at the destination. A conforming host that holds exactly those persons MUST import every case marked "import", leave each listed destination person unchanged and end with exactly the persons under "after"; it MUST refuse every case marked "conflict" with 409 conflict, and the refusal MUST name the company identity under "collides" (a person ID or installation ID). A consumer establishes the destination persons by replaying their histories at the destination, or by seeding the equivalent records. The keys are published on purpose: never use them for anything real.',
  rule: 'At import, a key the snapshot binds must not be bound at the destination to another identity when it can still act for the company: a person\'s current key or an active installation\'s key. A retired key or a revoked installation\'s key is historical only and does not block the import. A person ID the destination holds with another key history is kept as the destination holds it when that person is not a controller, member or pending invitee of the company; otherwise the import is refused. Every such refusal names the company\'s colliding person or installation.',
  keys: Object.fromEntries(Object.entries(K).map(([label, k]) => [label, { key_id: k.keyId, secret_key: k.secretKey }])),
  cases,
};
const text = JSON.stringify(out, null, 2) + '\n', target = new URL('../../spec/vectors/snapshot-key-collision.json', import.meta.url);
if (!process.argv.includes('--check')) writeFileSync(target, text);
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/snapshot-key-collision.json is stale; rerun this script without --check'); process.exit(1); }
