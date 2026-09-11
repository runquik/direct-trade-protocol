// Cooperative, trust-pinned migration. Callers authorize every operation and
// execute these helpers transactionally, discarding state if any check fails.
import { canonicalize, sha256Hex } from "../canonical.ts";
import type { Command, Context, MigrationManifest, SignedToken, Snapshot, State } from "./model.ts";
import { demand, exact, instant, digest, signToken, verifyToken } from "./wire.ts";

export const MIGRATION_CHUNK_BYTES = 64 * 1024;
export const MIGRATION_MAX_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const hex = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const id = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function b64(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}
function decode(value: unknown): Uint8Array {
  demand(typeof value === "string" && value.length <= Math.ceil(MIGRATION_CHUNK_BYTES / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), "invalid_chunk", "invalid bounded base64 chunk", 400);
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  demand(bytes.length > 0 && bytes.length <= MIGRATION_CHUNK_BYTES && b64(bytes) === value, "invalid_chunk", "noncanonical or empty chunk", 400);
  return bytes;
}
function manifestShape(m: MigrationManifest) {
  exact(m, ["migration_id", "organization_id", "generation", "source", "destination", "snapshot_hash", "byte_length", "chunk_hashes", "expires_at"]);
  exact(m.source, ["audience", "key_id"]); exact(m.destination, ["audience", "key_id"]);
  demand(id(m.migration_id) && id(m.organization_id) && Number.isSafeInteger(m.generation) && m.generation >= 1 && m.generation < Number.MAX_SAFE_INTEGER && hex(m.snapshot_hash), "invalid_manifest", "invalid migration identity or exhausted generation", 400);
  demand(typeof m.source.audience === "string" && typeof m.destination.audience === "string" && m.source.audience !== m.destination.audience && m.source.key_id !== m.destination.key_id, "invalid_manifest", "migration needs distinct hosts", 400);
  demand(Number.isSafeInteger(m.byte_length) && m.byte_length > 0 && m.byte_length <= MIGRATION_MAX_BYTES && Array.isArray(m.chunk_hashes) && m.chunk_hashes.length === Math.ceil(m.byte_length / MIGRATION_CHUNK_BYTES) && m.chunk_hashes.every(hex), "invalid_manifest", "invalid migration size or hashes", 400);
  instant(m.expires_at);
}
function tokenTimes(body: Record<string, any>) {
  const issued = instant(body.issued_at), expires = instant(body.expires_at);
  demand(expires > issued && expires - issued <= 3600000, "invalid_token", "invalid migration token lifetime", 400);
  return { issued, expires };
}
async function durable(token: SignedToken, ctx: Context, kind: string) {
  // Migration receipts are historical evidence, not renewable live capabilities.
  // Signature/pin verification remains mandatory even after their live expiry.
  demand(token?.body, "invalid_token", "missing migration receipt", 400);
  const { issued } = tokenTimes(token.body);
  demand(issued <= ctx.now + 30000, "invalid_token", "receipt issued in future", 400);
  return verifyToken(token, { ...ctx, now: issued }, kind);
}
function localDestination(m: MigrationManifest, ctx: Context) {
  demand(m.destination.audience === ctx.audience && m.destination.key_id === ctx.storeKey.keyId, "wrong_destination", "migration is bound to another destination");
}
function localSource(m: MigrationManifest, ctx: Context) {
  demand(m.source.audience === ctx.audience && m.source.key_id === ctx.storeKey.keyId, "wrong_source", "migration is bound to another source");
}
function body(kind: string, ctx: Context, expires: string, fields: Record<string, any>) {
  return { kind, issuer: ctx.audience, issued_at: new Date(ctx.now).toISOString(), expires_at: expires, ...fields };
}
export function migrationReserved(s: State, organizationId: string): boolean {
  return Object.values(s.incoming).some(x => !x.activated && !x.aborted && x.manifest.organization_id === organizationId);
}
export function migrationResourceReserved(s: State, kind: "persons" | "policies" | "profiles" | "releases" | "records", resourceId: string): boolean {
  return Object.values(s.incoming).some(stage => !stage.activated && !stage.aborted && stage.ready_token && stage.snapshot?.[kind].some(value => (kind === "profiles" || kind === "releases" ? (value as any).digest : (value as any).id) === resourceId));
}
function readySnapshots(s: State): Snapshot[] { return Object.values(s.incoming).filter(stage => !stage.activated && !stage.aborted && stage.ready_token && stage.snapshot).map(stage => stage.snapshot!); }
export function migrationKeyReserved(s: State, key: string): boolean {
  return readySnapshots(s).some(snap => snap.persons.some(p => [...p.keys,...p.retired_keys].includes(key)) || Object.values(snap.organization.installations).some(i => i.key_id === key));
}
export function migrationProfileReserved(s: State, publisher: string, name: string, version: string): boolean {
  return readySnapshots(s).some(snap => snap.profiles.some(p => p.publisher_id === publisher && p.name === name && p.version === version));
}
export function migrationModuleReserved(s: State, moduleId: string): boolean {
  return readySnapshots(s).some(snap => snap.releases.some(r => r.module_id === moduleId));
}
export function migrationInstallationReserved(s: State, installationId: string): boolean {
  return readySnapshots(s).some(snap => Object.hasOwn(snap.organization.installations,installationId));
}
export async function migrationPrepare(s: State, c: Command, ctx: Context, snapshot: Snapshot, destination: { audience: string; key_id: string }) {
  exact(destination, ["audience", "key_id"]);
  const org = s.organizations[snapshot.organization.id];
  demand(org?.status === "active" && snapshot.source === ctx.audience && org.generation === snapshot.organization.generation && c.organization_id === org.id && c.actor.kind === "person" && org.controllers.includes(c.actor.id) && id(c.request_id), "invalid_source", "snapshot is not the authorized active source company");
  demand(Number.isSafeInteger(org.generation) && org.generation >= 1 && org.generation < Number.MAX_SAFE_INTEGER,"migration_capacity","authority generation cannot be incremented safely",507);
  demand(ctx.pins[destination.audience] === destination.key_id && destination.audience !== ctx.audience && destination.key_id !== ctx.storeKey.keyId, "untrusted_destination", "destination key must be explicitly pinned");
  const bytes = encoder.encode(canonicalize(snapshot));
  demand(bytes.length > 0 && bytes.length <= MIGRATION_MAX_BYTES, "migration_too_large", "snapshot exceeds the 32 MiB candidate limit", 413);
  const chunks: string[] = [], hashes: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += MIGRATION_CHUNK_BYTES) { const part = bytes.slice(offset, offset + MIGRATION_CHUNK_BYTES); chunks.push(b64(part)); hashes.push(await sha256Hex(part)); }
  const manifest: MigrationManifest = { migration_id: c.request_id, organization_id: org.id, generation: org.generation,
    source: { audience: ctx.audience, key_id: ctx.storeKey.keyId }, destination: structuredClone(destination), snapshot_hash: await digest(snapshot),
    byte_length: bytes.length, chunk_hashes: hashes, expires_at: new Date(ctx.now + 3600000).toISOString() };
  const prior = s.outgoing[manifest.migration_id];
  if (prior) { demand(await digest(prior.authorization) === await digest(c), "conflict", "migration ID already used", 409); return structuredClone(prior.manifest_token); }
  const manifest_token = await signToken(body("migration-manifest", ctx, manifest.expires_at, { actor_id: c.actor.id, manifest }), ctx);
  s.outgoing[manifest.migration_id] = { manifest, chunks, manifest_token, authorization: structuredClone(c) };
  return structuredClone(manifest_token);
}
export function migrationChunk(s: State, migrationId: string, index: number) {
  const out = s.outgoing[migrationId]; demand(out, "not_found", "migration unavailable", 404);
  demand(Number.isSafeInteger(index) && index >= 0 && index < out.chunks.length, "invalid_chunk", "invalid chunk index", 400);
  return { migration_id: migrationId, index, data: out.chunks[index], hash: out.manifest.chunk_hashes[index] };
}
export async function migrationStage(s: State, ctx: Context, manifestToken: SignedToken) {
  const verified = await verifyToken(manifestToken, ctx, "migration-manifest");
  exact(verified, ["kind", "issuer", "issued_at", "expires_at", "actor_id", "manifest"]); tokenTimes(verified);
  demand(id(verified.actor_id), "invalid_manifest", "manifest actor must be a person ID", 400);
  const m = verified.manifest as MigrationManifest; manifestShape(m); localDestination(m, ctx);
  demand(verified.issuer === m.source.audience && manifestToken.key_id === m.source.key_id && verified.expires_at === m.expires_at && instant(m.expires_at) > ctx.now, "invalid_manifest", "manifest source or lifetime differs");
  const old = s.incoming[m.migration_id];
  if (old) { demand(!old.aborted && await digest(old.manifest_token) === await digest(manifestToken), "conflict", "migration stage is immutable or aborted", 409); return { migration_id: m.migration_id, uploaded: Object.keys(old.chunks).length, activated: old.activated }; }
  demand(!s.organizations[m.organization_id] && !migrationReserved(s, m.organization_id), "conflict", "company already exists or is reserved", 409);
  s.incoming[m.migration_id] = { manifest: structuredClone(m), manifest_token: structuredClone(manifestToken), chunks: {}, activated: false };
  return { migration_id: m.migration_id, uploaded: 0, activated: false };
}
export async function migrationUpload(s: State, migrationId: string, index: number, data: string, ctx: Context) {
  const stage = s.incoming[migrationId]; demand(stage, "not_found", "migration stage unavailable", 404); localDestination(stage.manifest, ctx);
  demand(!stage.activated && !stage.aborted && instant(stage.manifest.expires_at) > ctx.now, "expired", "stage is activated, aborted or expired", 409);
  demand(Number.isSafeInteger(index) && index >= 0 && index < stage.manifest.chunk_hashes.length, "invalid_chunk", "invalid chunk index", 400);
  const bytes = decode(data), expectedBytes = index === stage.manifest.chunk_hashes.length - 1 ? stage.manifest.byte_length - index * MIGRATION_CHUNK_BYTES : MIGRATION_CHUNK_BYTES;
  demand(bytes.length === expectedBytes && await sha256Hex(bytes) === stage.manifest.chunk_hashes[index], "invalid_chunk", "chunk size or digest differs", 400);
  const old = stage.chunks[String(index)]; demand(old === undefined || old === data, "conflict", "chunk cannot be replaced", 409);
  stage.chunks[String(index)] = data;
  return { migration_id: migrationId, index, uploaded: Object.keys(stage.chunks).length };
}
export async function migrationReady(s: State, migrationId: string, ctx: Context, validateSnapshot: (snapshot: Snapshot, manifest: MigrationManifest) => Promise<void> | void) {
  const stage = s.incoming[migrationId]; demand(stage, "not_found", "migration stage unavailable", 404); const m = stage.manifest; localDestination(m, ctx);
  demand(!stage.activated && !stage.aborted && instant(m.expires_at) > ctx.now, "expired", "stage is activated, aborted or expired", 409);
  if (stage.ready_token) return structuredClone(stage.ready_token);
  demand(Object.keys(stage.chunks).length === m.chunk_hashes.length, "incomplete_migration", "all chunks are required", 409);
  const bytes = new Uint8Array(m.byte_length); let offset = 0;
  for (let i = 0; i < m.chunk_hashes.length; i++) { const part = decode(stage.chunks[String(i)]); demand(await sha256Hex(part) === m.chunk_hashes[i], "invalid_chunk", "staged chunk is corrupt", 400); bytes.set(part, offset); offset += part.length; }
  demand(offset === m.byte_length, "invalid_manifest", "assembled size differs", 400);
  let snapshot: Snapshot;
  try { snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { demand(false, "invalid_snapshot", "invalid snapshot encoding", 400); }
  const queue: { value: unknown; depth: number }[] = [{ value: snapshot!, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.pop()!; demand(depth <= 48, "invalid_snapshot", "snapshot nesting exceeds 48 levels", 400);
    if (value && typeof value === "object") for (const child of Object.values(value)) queue.push({ value: child, depth: depth + 1 });
  }
  demand(await digest(snapshot!) === m.snapshot_hash && encoder.encode(canonicalize(snapshot!)).length === m.byte_length, "invalid_snapshot", "snapshot digest or size differs", 400);
  demand(snapshot!.version === "0.4" && snapshot!.source === m.source.audience && snapshot!.organization.id === m.organization_id && snapshot!.organization.generation === m.generation && snapshot!.organization.status === "active", "invalid_snapshot", "snapshot identity differs", 400);
  demand(snapshot!.organization.controllers.includes(stage.manifest_token.body.actor_id), "invalid_snapshot", "migration initiator is not an exported controller");
  demand(Array.isArray(snapshot!.records),"invalid_snapshot","snapshot records are required",400);
  const reservedSequences=Object.values(s.incoming).filter(other=>other!==stage && other.ready_token && !other.activated && !other.aborted).reduce((total,other)=>total+(other.snapshot?.records.length??0),0);
  const nextSequence=s.next_seq+reservedSequences+snapshot!.records.length;
  demand(m.generation<Number.MAX_SAFE_INTEGER && Number.isSafeInteger(s.next_seq) && s.next_seq>=1 && Number.isSafeInteger(nextSequence) && nextSequence<=Number.MAX_SAFE_INTEGER,"migration_capacity","destination sequence or generation capacity exhausted",507);
  demand(!s.organizations[m.organization_id], "conflict", "company exists at destination", 409);
  await validateSnapshot(snapshot!, m);
  stage.snapshot = structuredClone(snapshot!);
  stage.ready_token = await signToken(body("migration-ready", ctx, m.expires_at, { manifest_hash: await digest(m), migration_id: migrationId, organization_id: m.organization_id, generation: m.generation, source: m.source, destination: m.destination, snapshot_hash: m.snapshot_hash }), ctx);
  return structuredClone(stage.ready_token);
}
async function readyMatches(ready: SignedToken, m: MigrationManifest, ctx: Context, historical: boolean) {
  const r = historical ? await durable(ready, ctx, "migration-ready") : await verifyToken(ready, ctx, "migration-ready");
  exact(r, ["kind", "issuer", "issued_at", "expires_at", "manifest_hash", "migration_id", "organization_id", "generation", "source", "destination", "snapshot_hash"]); tokenTimes(r);
  demand(r.issuer === m.destination.audience && ready.key_id === m.destination.key_id && r.manifest_hash === await digest(m) && r.migration_id === m.migration_id && r.organization_id === m.organization_id && r.generation === m.generation && r.snapshot_hash === m.snapshot_hash && await digest(r.source) === await digest(m.source) && await digest(r.destination) === await digest(m.destination) && r.expires_at === m.expires_at, "invalid_ready", "ready receipt does not bind this migration");
  return r;
}
export async function migrationCommit(s: State, migrationId: string, readyToken: SignedToken, ctx: Context, currentSnapshot: Snapshot) {
  const out = s.outgoing[migrationId]; demand(out, "not_found", "outbound migration unavailable", 404); const m = out.manifest; localSource(m, ctx);
  demand(!out.cancel_token, "cancelled", "migration was cancelled", 409);
  if (out.commit_token) { demand(await digest(out.commit_token.body.ready) === await digest(readyToken), "conflict", "committed readiness differs", 409); return structuredClone(out.commit_token); }
  const org = s.organizations[m.organization_id]; demand(org?.status === "active" && org.generation === m.generation, "conflict", "source company is not active at expected generation", 409);
  const readyBody = await readyMatches(readyToken, m, ctx, false);
  demand(instant(readyBody.issued_at) <= ctx.now, "invalid_ready", "source clock precedes destination readiness");
  demand(instant(m.expires_at) > ctx.now && await digest(currentSnapshot) === m.snapshot_hash, "conflict", "source snapshot changed or readiness expired", 409);
  out.commit_token = await signToken(body("migration-commit", ctx, new Date(ctx.now + 3600000).toISOString(), { manifest_hash: await digest(m), migration_id: migrationId, organization_id: m.organization_id, generation: m.generation, source: m.source, destination: m.destination, snapshot_hash: m.snapshot_hash, ready: structuredClone(readyToken) }), ctx);
  org.status = "migrated";
  return structuredClone(out.commit_token);
}
export function migrationReceipt(s: State, migrationId: string) {
  const token = s.outgoing[migrationId]?.commit_token; demand(token, "not_found", "no committed migration receipt", 404); return structuredClone(token);
}
export async function migrationFinalize(s: State, migrationId: string, commitToken: SignedToken, ctx: Context, applySnapshot: (snapshot: Snapshot, manifest: MigrationManifest) => Promise<void> | void) {
  const stage = s.incoming[migrationId]; demand(stage?.ready_token && !stage.aborted, "not_ready", "destination has no validated ready stage", 409); const m = stage.manifest; localDestination(m, ctx);
  const c = await durable(commitToken, ctx, "migration-commit");
  exact(c, ["kind", "issuer", "issued_at", "expires_at", "manifest_hash", "migration_id", "organization_id", "generation", "source", "destination", "snapshot_hash", "ready"]);
  demand(c.issuer === m.source.audience && commitToken.key_id === m.source.key_id && c.manifest_hash === await digest(m) && c.migration_id === migrationId && c.organization_id === m.organization_id && c.generation === m.generation && c.snapshot_hash === m.snapshot_hash && await digest(c.source) === await digest(m.source) && await digest(c.destination) === await digest(m.destination) && await digest(c.ready) === await digest(stage.ready_token), "invalid_commit", "commit receipt does not bind this stage");
  const ready = await readyMatches(c.ready, m, ctx, true);
  demand(instant(c.issued_at) >= instant(ready.issued_at) && instant(c.issued_at) < instant(ready.expires_at), "invalid_commit", "source committed outside readiness lifetime");
  if (stage.activated) return { organization_id: m.organization_id, generation: m.generation + 1, activated: true };
  demand(stage.snapshot && !s.organizations[m.organization_id] && await digest(stage.snapshot) === m.snapshot_hash, "conflict", "destination company exists or staged snapshot changed", 409);
  await applySnapshot(structuredClone(stage.snapshot), m);
  demand(s.organizations[m.organization_id]?.status === "active" && s.organizations[m.organization_id]?.generation === m.generation + 1, "invalid_activation", "snapshot application did not activate expected generation", 500);
  stage.activated = true;
  // Atomically replace the staged snapshot with active state. Retaining both it
  // and base64 chunks can exceed a capacity limit AFTER the source has frozen.
  // Keep binding/ready/activation receipts for replay, never a second payload copy.
  delete stage.snapshot; stage.chunks = {};
  return { organization_id: m.organization_id, generation: m.generation + 1, activated: true };
}
export async function migrationCancel(s: State, migrationId: string, ctx: Context) {
  const out = s.outgoing[migrationId]; demand(out, "not_found", "outbound migration unavailable", 404); localSource(out.manifest, ctx);
  demand(!out.commit_token, "conflict", "committed migration cannot be cancelled", 409);
  if (out.cancel_token) return structuredClone(out.cancel_token);
  out.cancel_token = await signToken(body("migration-cancel", ctx, new Date(ctx.now + 3600000).toISOString(), { migration_id: migrationId, organization_id: out.manifest.organization_id, manifest_hash: await digest(out.manifest), destination: out.manifest.destination }), ctx);
  return structuredClone(out.cancel_token);
}
export async function migrationAbort(s: State, migrationId: string, cancelToken: SignedToken, ctx: Context) {
  const stage = s.incoming[migrationId]; demand(stage, "not_found", "migration stage unavailable", 404); const m = stage.manifest; localDestination(m, ctx);
  demand(!stage.activated, "conflict", "activated migration cannot be aborted", 409);
  const c = await durable(cancelToken, ctx, "migration-cancel"); exact(c, ["kind", "issuer", "issued_at", "expires_at", "migration_id", "organization_id", "manifest_hash", "destination"]);
  demand(c.issuer === m.source.audience && cancelToken.key_id === m.source.key_id && c.migration_id === migrationId && c.organization_id === m.organization_id && c.manifest_hash === await digest(m) && await digest(c.destination) === await digest(m.destination), "invalid_cancel", "cancellation does not match staged migration");
  stage.aborted = true; stage.chunks = {}; delete stage.snapshot; delete stage.ready_token;
  return { migration_id: migrationId, aborted: true };
}
