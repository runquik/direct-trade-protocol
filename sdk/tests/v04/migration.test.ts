import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import { emptyState, type Context, type Snapshot, type State } from "../../src/v04/model.ts";
import { draftCommand, signToken } from "../../src/v04/wire.ts";
import { migrationPrepare, migrationStage, migrationChunk, migrationUpload, migrationReady, migrationCommit, migrationFinalize, migrationReceipt, migrationReserved, migrationResourceReserved, migrationCancel, migrationAbort, MIGRATION_CHUNK_BYTES } from "../../src/v04/migration.ts";
import { authorityIssue, authorityAccept, authorityRelocate, requireRemoteAuthority } from "../../src/v04/federation.ts";

async function fixture(size = 0) {
  const [ka, kb, kc] = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  const pins = { "https://a.test": ka.keyId, "https://b.test": kb.keyId, "https://c.test": kc.keyId };
  const a: Context = { audience: "https://a.test", storeKey: ka, pins, now }, b: Context = { audience: "https://b.test", storeKey: kb, pins, now }, c: Context = { audience: "https://c.test", storeKey: kc, pins, now };
  const sa = emptyState(), sb = emptyState(), orgId = crypto.randomUUID(), person = crypto.randomUUID();
  sa.organizations[orgId] = { id: orgId, name: "Synthetic source", controllers: [person], threshold: 1, generation: 1, status: "active", members: {}, invitations: {}, installations: {}, history: [] };
  const snapshot: Snapshot = { version: "0.4", source: a.audience, organization: structuredClone(sa.organizations[orgId]), persons: [{ id: person, keys: [ka.keyId], retired_keys: [], history: [] }], policies: [], profiles: [], releases: [], records: [], remote_authorities: [], inventory: { synthetic_notes: "x".repeat(size) } };
  const cmd = draftCommand(a.audience, { id: person, key: ka }, "migration.prepare", orgId, {}, now);
  const token = await migrationPrepare(sa, cmd, a, snapshot, { audience: b.audience, key_id: kb.keyId });
  const mid = token.body.manifest.migration_id as string;
  async function stage() { return migrationStage(sb, b, token); }
  async function upload(reverse = false) { const indices = token.body.manifest.chunk_hashes.map((_: string, i: number) => i); if (reverse) indices.reverse(); for (const i of indices) await migrationUpload(sb, mid, i, migrationChunk(sa, mid, i).data, b); }
  async function ready() { await stage(); await upload(); return migrationReady(sb, mid, b, () => {}); }
  function apply(snapshot: Snapshot) { sb.organizations[orgId] = { ...snapshot.organization, status: "active", generation: snapshot.organization.generation + 1 }; }
  return { a, b, c, sa, sb, orgId, person, snapshot, cmd, token, mid, stage, upload, ready, apply };
}
const rejectsCode = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => e.code === code);

test("migration: >1MiB snapshots use bounded chunks, out-of-order resume and durable finalization", async () => {
  const f = await fixture(2 * 1024 * 1024);
  assert.ok(f.token.body.manifest.byte_length > 2 * 1024 * 1024);
  await f.stage(); assert.equal(migrationReserved(f.sb, f.orgId), true);
  const first = migrationChunk(f.sa, f.mid, 0); assert.equal(Buffer.from(first.data, "base64").length, MIGRATION_CHUNK_BYTES);
  await migrationUpload(f.sb, f.mid, 0, first.data, f.b);
  await rejectsCode(migrationReady(f.sb, f.mid, f.b, () => {}), "incomplete_migration");
  await f.upload(true); await f.stage(); // identical resume does not erase chunks
  let validations = 0;
  const ready = await migrationReady(f.sb, f.mid, f.b, () => { validations++; });
  assert.equal(validations, 1); assert.deepEqual(await migrationReady(f.sb, f.mid, f.b, () => { throw Error("already validated"); }), ready);
  assert.equal(migrationResourceReserved(f.sb, "persons", f.person), true);
  const commit = await migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot);
  assert.equal(f.sa.organizations[f.orgId].status, "migrated"); assert.deepEqual(migrationReceipt(f.sa, f.mid), commit);
  assert.deepEqual(await migrationCommit(f.sa, f.mid, ready, { ...f.a, now: f.a.now + 7200000 }, f.snapshot), commit);
  const late = { ...f.b, now: f.b.now + 7200000 };
  assert.deepEqual(await migrationFinalize(f.sb, f.mid, commit, late, f.apply), { organization_id: f.orgId, generation: 2, activated: true });
  assert.equal(migrationReserved(f.sb, f.orgId), false); assert.equal(migrationResourceReserved(f.sb, "persons", f.person), false);
  await migrationFinalize(f.sb, f.mid, commit, late, () => { throw Error("must not reactivate"); });
});

test("migration: bad chunks cannot complete or replace content", async () => {
  const f = await fixture(70000); await f.stage(); const first = migrationChunk(f.sa, f.mid, 0);
  await rejectsCode(migrationUpload(f.sb, f.mid, 0, Buffer.alloc(MIGRATION_CHUNK_BYTES, 0).toString("base64"), f.b), "invalid_chunk");
  await rejectsCode(migrationUpload(f.sb, f.mid, 0, "@@@", f.b), "invalid_chunk");
  await rejectsCode(migrationUpload(f.sb, f.mid, 999, first.data, f.b), "invalid_chunk");
  await migrationUpload(f.sb, f.mid, 0, first.data, f.b); await migrationUpload(f.sb, f.mid, 0, first.data, f.b);
  assert.equal(Object.keys(f.sb.incoming[f.mid].chunks).length, 1); assert.equal(f.sa.organizations[f.orgId].status, "active");
});

test("migration: wrong destination, tampering and unpinned sources fail before staging", async () => {
  const f = await fixture();
  await rejectsCode(migrationStage(emptyState(), f.c, f.token), "wrong_destination");
  await rejectsCode(migrationStage(f.sb, { ...f.b, pins: {} }, f.token), "untrusted_source");
  const tampered = structuredClone(f.token); tampered.body.manifest.byte_length++;
  await rejectsCode(migrationStage(f.sb, f.b, tampered), "signature_invalid"); assert.equal(Object.keys(f.sb.incoming).length, 0);
});

test("migration: failed destination validation never produces readiness or freezes source", async () => {
  const f = await fixture(); await f.stage(); await f.upload();
  await assert.rejects(migrationReady(f.sb, f.mid, f.b, () => { throw Error("unsupported profile"); }), /unsupported profile/);
  assert.equal(f.sb.incoming[f.mid].ready_token, undefined); assert.equal(f.sa.organizations[f.orgId].status, "active");
});

test("migration: changed source and expired readiness leave source writable", async () => {
  const f = await fixture(), ready = await f.ready();
  const changed = structuredClone(f.snapshot); changed.organization.name = "Changed";
  await rejectsCode(migrationCommit(f.sa, f.mid, ready, f.a, changed), "conflict");
  await rejectsCode(migrationCommit(f.sa, f.mid, ready, { ...f.a, now: f.a.now + 3600000 }, f.snapshot), "expired");
  assert.equal(f.sa.organizations[f.orgId].status, "active"); assert.equal(f.sa.outgoing[f.mid].commit_token, undefined);
});

test("migration: exhausted generation rejects preparation while source stays active", async () => {
  const f=await fixture();f.sa.organizations[f.orgId].generation=Number.MAX_SAFE_INTEGER;f.snapshot.organization.generation=Number.MAX_SAFE_INTEGER;
  await rejectsCode(migrationPrepare(f.sa,{...f.cmd,request_id:crypto.randomUUID()},f.a,f.snapshot,{audience:f.b.audience,key_id:f.b.storeKey.keyId}),"migration_capacity");
  assert.equal(f.sa.organizations[f.orgId].status,"active");
});

test("migration: readiness for another migration or forged destination cannot freeze source", async () => {
  const f = await fixture(), ready = await f.ready();
  const body = { ...ready.body, organization_id: crypto.randomUUID() };
  await rejectsCode(migrationCommit(f.sa, f.mid, await signToken(body, f.b), f.a, f.snapshot), "invalid_ready");
  await rejectsCode(migrationCommit(f.sa, f.mid, await signToken({ ...ready.body, issuer: f.c.audience }, f.c), f.a, f.snapshot), "invalid_ready");
  assert.equal(f.sa.organizations[f.orgId].status, "active");
});

test("migration: destination clock ahead cannot produce a stranded early commit", async () => {
  const f = await fixture(); await f.stage(); await f.upload();
  const ready = await migrationReady(f.sb, f.mid, { ...f.b, now: f.b.now + 20000 }, () => {});
  await rejectsCode(migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot), "invalid_ready");
  assert.equal(f.sa.organizations[f.orgId].status, "active");
  await migrationCommit(f.sa, f.mid, ready, { ...f.a, now: f.a.now + 20000 }, f.snapshot);
});

test("migration: second company stage conflicts and changed staged bytes fail finalization", async () => {
  const f = await fixture(), ready = await f.ready();
  const newToken = await signToken({ ...f.token.body, manifest: { ...f.token.body.manifest, migration_id: crypto.randomUUID() } }, f.a);
  await rejectsCode(migrationStage(f.sb, f.b, newToken), "conflict");
  const commit = await migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot);
  f.sb.incoming[f.mid].snapshot!.organization.name = "tampered";
  await rejectsCode(migrationFinalize(f.sb, f.mid, commit, f.b, f.apply), "conflict"); assert.equal(f.sb.organizations[f.orgId], undefined);
});

test("migration: historical receipt cannot authorize commit after readiness expiry", async () => {
  const f = await fixture(), ready = await f.ready();
  const valid = await migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot);
  const lateContext = { ...f.a, now: f.a.now + 3600001 };
  const forgedLate = await signToken({ ...valid.body, issued_at: new Date(lateContext.now).toISOString(), expires_at: new Date(lateContext.now + 3600000).toISOString() }, lateContext);
  await rejectsCode(migrationFinalize(f.sb, f.mid, forgedLate, { ...f.b, now: lateContext.now }, f.apply), "invalid_commit");
});

test("migration: source-authorized cancellation releases ready reservations without rollback", async () => {
  const f = await fixture(), ready = await f.ready();
  const cancel = await migrationCancel(f.sa, f.mid, f.a);
  assert.deepEqual(await migrationCancel(f.sa, f.mid, f.a), cancel);
  await rejectsCode(migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot), "cancelled");
  await migrationAbort(f.sb, f.mid, cancel, { ...f.b, now: f.b.now + 7200000 });
  assert.equal(migrationReserved(f.sb, f.orgId), false); assert.equal(migrationResourceReserved(f.sb, "persons", f.person), false);
  assert.equal(f.sa.organizations[f.orgId].status, "active"); assert.equal(f.sb.incoming[f.mid].snapshot, undefined);
  await migrationAbort(f.sb, f.mid, cancel, f.b);
  await rejectsCode(f.stage(), "conflict");
});

test("migration: cancellation cannot undo source commit and unrelated cancellation cannot release stage", async () => {
  const f = await fixture(), ready = await f.ready();
  const cancel = await signToken({ kind: "migration-cancel", issuer: f.a.audience, issued_at: new Date(f.a.now).toISOString(), expires_at: new Date(f.a.now + 3600000).toISOString(), migration_id: crypto.randomUUID(), organization_id: f.orgId, manifest_hash: "0".repeat(64), destination: f.token.body.manifest.destination }, f.a);
  await rejectsCode(migrationAbort(f.sb, f.mid, cancel, f.b), "invalid_cancel"); assert.equal(migrationReserved(f.sb, f.orgId), true);
  await migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot);
  await rejectsCode(migrationCancel(f.sa, f.mid, f.a), "conflict"); assert.equal(f.sa.organizations[f.orgId].status, "migrated");
});

test("federation: trusted current authority never creates local company authority", async () => {
  const f = await fixture(), token = await authorityIssue(f.sa, f.orgId, f.a);
  const accepted = await authorityAccept(f.sb, token, f.b); assert.equal(accepted.organization_id, f.orgId); assert.equal(f.sb.organizations[f.orgId], undefined);
  await requireRemoteAuthority(f.sb, f.orgId, f.b);
  await rejectsCode(requireRemoteAuthority(f.sb, f.orgId, { ...f.b, now: f.b.now + 60000 }), "expired");
  await rejectsCode(authorityAccept(emptyState(), token, { ...f.b, pins: {} }), "untrusted_source");
});

test("federation: conflicting host, generation rollback and overlong proof rejected", async () => {
  const f = await fixture(); f.sa.organizations[f.orgId].generation = 2;
  const token = await authorityIssue(f.sa, f.orgId, f.a); await authorityAccept(f.sb, token, f.b);
  const rollback = await signToken({ ...token.body, generation: 1 }, f.a); await rejectsCode(authorityAccept(f.sb, rollback, f.b), "stale_authority");
  const competitor = await signToken({ ...token.body, issuer: f.c.audience, host: { audience: f.c.audience, key_id: f.c.storeKey.keyId } }, f.c);
  await rejectsCode(authorityAccept(f.sb, competitor, f.b), "relocation_required");
  const higher = await signToken({ ...competitor.body, generation: 3 }, f.c); await rejectsCode(authorityAccept(f.sb, higher, f.b), "relocation_required");
  const long = await signToken({ ...token.body, expires_at: new Date(f.a.now + 61000).toISOString() }, f.a); await rejectsCode(authorityAccept(f.sb, long, f.b), "invalid_authority");
});

test("federation: migrated source can authenticate its destination's next generation", async () => {
  const f = await fixture(), ready = await f.ready();
  const commit = await migrationCommit(f.sa, f.mid, ready, f.a, f.snapshot); await migrationFinalize(f.sb, f.mid, commit, f.b, f.apply);
  const proof = await authorityIssue(f.sb, f.orgId, f.b); await authorityAccept(f.sa, proof, f.a);
  assert.equal(f.sa.organizations[f.orgId].status, "migrated"); assert.equal(f.sa.remote_authorities[f.orgId].token.body.generation, 2);
  await rejectsCode(authorityIssue(f.sa, f.orgId, f.a), "not_found");
  const wrong = await signToken({ ...proof.body, generation: 3 }, f.b);
  await rejectsCode(authorityAccept(f.sa, wrong, f.a), "relocation_required");
});

test("federation: a third pinned host verifies a one-hop relocation without inventing local authority", async () => {
  const f=await fixture(), third=emptyState();
  const old=await authorityIssue(f.sa,f.orgId,f.a);await authorityAccept(third,old,f.c);
  const ready=await f.ready(),commit=await migrationCommit(f.sa,f.mid,ready,f.a,f.snapshot);await migrationFinalize(f.sb,f.mid,commit,f.b,f.apply);
  // The old cached locator can be expired: it is historical continuity evidence.
  // The destination locator must still be freshly issued and currently valid.
  const now=f.a.now+120000,receiver={...f.c,now};const token=await authorityIssue(f.sb,f.orgId,{...f.b,now});
  await rejectsCode(authorityAccept(third,token,receiver),"relocation_required");
  const changed=await authorityRelocate(third,token,commit,receiver);assert.equal(changed.generation,2);assert.equal(changed.host.audience,f.b.audience);
  assert.equal(third.organizations[f.orgId],undefined);assert.equal(Object.keys(third.persons).length,0);assert.equal(Object.keys(third.outgoing).length,0);
  assert.deepEqual(await authorityRelocate(third,token,commit,receiver),changed);await requireRemoteAuthority(third,f.orgId,receiver);
});

test("federation: third-peer relocation rejects forged, mismatched, stale and unpinned proofs", async () => {
  const f=await fixture(),third=emptyState();await authorityAccept(third,await authorityIssue(f.sa,f.orgId,f.a),f.c);
  const ready=await f.ready(),commit=await migrationCommit(f.sa,f.mid,ready,f.a,f.snapshot);await migrationFinalize(f.sb,f.mid,commit,f.b,f.apply);
  const token=await authorityIssue(f.sb,f.orgId,f.b);
  const badCompany=await signToken({...token.body,organization_id:crypto.randomUUID()},f.b);await rejectsCode(authorityRelocate(third,badCompany,commit,f.c),"relocation_required");
  const badGeneration=await signToken({...token.body,generation:3},f.b);await rejectsCode(authorityRelocate(third,badGeneration,commit,f.c),"invalid_relocation");
  const forged=structuredClone(commit);forged.body.snapshot_hash="a".repeat(64);await rejectsCode(authorityRelocate(third,token,forged,f.c),"signature_invalid");
  const badReady=await signToken({...ready.body,manifest_hash:"a".repeat(64)},f.b),badCommit=await signToken({...commit.body,ready:badReady},f.a);
  await rejectsCode(authorityRelocate(third,token,badCommit,f.c),"invalid_relocation");
  await rejectsCode(authorityRelocate(third,token,commit,{...f.c,now:f.c.now+60000}),"expired");
  await rejectsCode(authorityRelocate(third,token,commit,{...f.c,pins:{[f.b.audience]:f.b.storeKey.keyId}}),"untrusted_source");
  assert.equal(third.remote_authorities[f.orgId].token.body.generation,1);assert.equal(third.organizations[f.orgId],undefined);
});

test("federation: relocation preserves the destination-readiness temporal boundary", async () => {
  const f=await fixture(),third=emptyState();await authorityAccept(third,await authorityIssue(f.sa,f.orgId,f.a),f.c);
  const ready=await f.ready(),commit=await migrationCommit(f.sa,f.mid,ready,f.a,f.snapshot);await migrationFinalize(f.sb,f.mid,commit,f.b,f.apply);
  const now=f.a.now+7200000,receiver={...f.c,now},token=await authorityIssue(f.sb,f.orgId,{...f.b,now});
  const late=await signToken({...commit.body,issued_at:new Date(f.a.now+3600001).toISOString(),expires_at:new Date(f.a.now+7200001).toISOString()},f.a);
  await rejectsCode(authorityRelocate(third,token,late,receiver),"invalid_relocation");
  const future=await signToken({...commit.body,issued_at:new Date(now+60000).toISOString(),expires_at:new Date(now+120000).toISOString()},f.a);
  await rejectsCode(authorityRelocate(third,token,future,receiver),"invalid_relocation");
  await authorityRelocate(third,token,commit,receiver);assert.equal(third.remote_authorities[f.orgId].token.body.generation,2);
});

test("federation: a former source follows a second verified hop without a fabricated local handoff", async () => {
  const f=await fixture(),ready=await f.ready(),commit=await migrationCommit(f.sa,f.mid,ready,f.a,f.snapshot);await migrationFinalize(f.sb,f.mid,commit,f.b,f.apply);
  await authorityAccept(f.sa,await authorityIssue(f.sb,f.orgId,f.b),f.a);
  const now=f.b.now+1,b={...f.b,now},c={...f.c,now},destination=emptyState();
  const snap={...structuredClone(f.snapshot),source:b.audience,organization:structuredClone(f.sb.organizations[f.orgId])};
  const command=draftCommand(b.audience,{id:f.person,key:f.a.storeKey},"migration.prepare",f.orgId,{},now);
  const manifest=await migrationPrepare(f.sb,command,b,snap,{audience:c.audience,key_id:c.storeKey.keyId}),mid=manifest.body.manifest.migration_id;
  await migrationStage(destination,c,manifest);
  for(let index=0;index<manifest.body.manifest.chunk_hashes.length;index++)await migrationUpload(destination,mid,index,migrationChunk(f.sb,mid,index).data,c);
  const ready2=await migrationReady(destination,mid,c,()=>{}),commit2=await migrationCommit(f.sb,mid,ready2,b,snap);
  await migrationFinalize(destination,mid,commit2,c,snapshot=>{destination.organizations[f.orgId]={...snapshot.organization,status:"active",generation:3};});
  const current={...f.a,now},next=await authorityIssue(destination,f.orgId,c);
  await authorityRelocate(f.sa,next,commit2,current);await requireRemoteAuthority(f.sa,f.orgId,current);
  assert.equal(f.sa.organizations[f.orgId].status,"migrated");assert.equal(f.sa.remote_authorities[f.orgId].token.body.generation,3);
  assert.equal(Object.keys(f.sa.outgoing).length,1);assert.equal(f.sa.outgoing[f.mid].manifest.destination.audience,f.b.audience);
});
