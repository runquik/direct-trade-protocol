// Explicit, short-lived host attestations. No discovery network or local
// counterfeit company is created. Pinned hosts are trusted for current state.
import type { Context, SignedToken, State } from "./model.ts";
import { demand, exact, instant, digest, signToken, verifyToken } from "./wire.ts";

export async function authorityIssue(s: State, organizationId: string, ctx: Context) {
  const org = s.organizations[organizationId]; demand(org?.status === "active", "not_found", "active local company unavailable", 404);
  return signToken({ kind: "organization-authority", issuer: ctx.audience, issued_at: new Date(ctx.now).toISOString(), expires_at: new Date(ctx.now + 60000).toISOString(), organization_id: org.id, generation: org.generation, host: { audience: ctx.audience, key_id: ctx.storeKey.keyId } }, ctx);
}
async function acceptAuthority(s: State, token: SignedToken, ctx: Context, verifiedPreviousDigest?: string) {
  const b = await verifyToken(token, ctx, "organization-authority");
  exact(b, ["kind", "issuer", "issued_at", "expires_at", "organization_id", "generation", "host"]); exact(b.host, ["audience", "key_id"]);
  demand(typeof b.organization_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(b.organization_id) && Number.isSafeInteger(b.generation) && b.generation >= 1, "invalid_authority", "invalid authority identity", 400);
  demand(b.issuer !== ctx.audience && b.host.audience === b.issuer && b.host.key_id === token.key_id && instant(b.expires_at) - instant(b.issued_at) <= 60000 && instant(b.expires_at) > instant(b.issued_at), "invalid_authority", "invalid host binding or authority lifetime");
  const local = s.organizations[b.organization_id];
  demand(!local || (local.status === "migrated" && b.generation > local.generation), "conflict", "remote proof conflicts with local company authority", 409);
  const localHandoff = () => Object.values(s.outgoing).find(m => m.commit_token && m.manifest.organization_id === b.organization_id && m.manifest.generation + 1 === b.generation && m.manifest.destination.audience === b.issuer && m.manifest.destination.key_id === token.key_id);
  const previous = s.remote_authorities[b.organization_id]?.token;
  const verifiedHop = !!(previous && verifiedPreviousDigest && verifiedPreviousDigest === await digest(previous));
  const sameKnownLocation = !!(previous && b.issuer === previous.body.issuer && token.key_id === previous.key_id && b.generation === previous.body.generation);
  if (local) demand(localHandoff() || verifiedHop || sameKnownLocation, "relocation_required", "remote authority differs from committed local handoff");
  if (previous) {
    const old = previous.body;
    demand(b.generation >= old.generation, "stale_authority", "authority generation regressed", 409);
    if (b.issuer !== old.issuer || token.key_id !== previous.key_id) {
      demand(localHandoff() || verifiedHop, "relocation_required", "changed host requires verified relocation continuity");
    }
    if (b.generation === old.generation) {
      demand(b.issuer === old.issuer && token.key_id === previous.key_id, "conflict", "competing hosts claim the same authority generation", 409);
      demand(instant(b.issued_at) >= instant(old.issued_at), "stale_authority", "authority observation regressed", 409);
      if (b.issued_at === old.issued_at) demand(await digest(b) === await digest(old), "conflict", "authority timestamp has conflicting content", 409);
    }
  }
  s.remote_authorities[b.organization_id] = { token: structuredClone(token) };
  return { organization_id: b.organization_id, generation: b.generation, host: structuredClone(b.host), expires_at: b.expires_at };
}
export async function authorityAccept(s: State, token: SignedToken, ctx: Context) {
  return acceptAuthority(s,token,ctx);
}
async function historicalToken(token: SignedToken, kind: string, ctx: Context) {
  demand(token?.body,"invalid_relocation","missing historical relocation proof");
  const issued=instant(token.body.issued_at),expires=instant(token.body.expires_at);
  demand(issued<=ctx.now+30000 && expires>issued && expires-issued<=3600000,"invalid_relocation","invalid historical proof lifetime");
  return verifyToken(token,{...ctx,now:issued},kind);
}
/** A third-party host advances its cached locator one independently verified hop.
 * Historical handoff evidence never substitutes for a fresh destination proof. */
export async function authorityRelocate(s: State, token: SignedToken, commitToken: SignedToken, ctx: Context) {
  const next=await verifyToken(token,ctx,"organization-authority");
  const previous=s.remote_authorities[next.organization_id]?.token;
  demand(previous,"relocation_required","previous authority must be explicitly known before relocation");
  const old=await historicalToken(previous,"organization-authority",ctx);
  const alreadyCurrent=await digest(previous)===await digest(token);
  const commit=await historicalToken(commitToken,"migration-commit",ctx);
  exact(commit,["kind","issuer","issued_at","expires_at","manifest_hash","migration_id","organization_id","generation","source","destination","snapshot_hash","ready"]);
  exact(commit.source,["audience","key_id"]);exact(commit.destination,["audience","key_id"]);
  demand(typeof commit.manifest_hash==="string" && /^[0-9a-f]{64}$/.test(commit.manifest_hash) && typeof commit.snapshot_hash==="string" && /^[0-9a-f]{64}$/.test(commit.snapshot_hash) && typeof commit.migration_id==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(commit.migration_id),"invalid_relocation","invalid handoff identity or digest");
  demand(commit.organization_id===old.organization_id && next.organization_id===old.organization_id && commit.issuer===commit.source.audience && commitToken.key_id===commit.source.key_id && (alreadyCurrent ? next.generation===commit.generation+1 : commit.generation===old.generation && next.generation===old.generation+1 && commit.source.audience===old.issuer && commit.source.key_id===previous.key_id),"invalid_relocation","handoff does not continue cached company authority");
  demand(commit.destination.audience===next.issuer && commit.destination.key_id===token.key_id && commit.destination.audience!==commit.source.audience && commit.destination.key_id!==commit.source.key_id,"invalid_relocation","handoff destination differs from fresh authority");
  const ready=await historicalToken(commit.ready,"migration-ready",ctx);
  exact(ready,["kind","issuer","issued_at","expires_at","manifest_hash","migration_id","organization_id","generation","source","destination","snapshot_hash"]);
  demand(ready.issuer===commit.destination.audience && commit.ready.key_id===commit.destination.key_id && ready.manifest_hash===commit.manifest_hash && ready.migration_id===commit.migration_id && ready.organization_id===commit.organization_id && ready.generation===commit.generation && ready.snapshot_hash===commit.snapshot_hash && await digest(ready.source)===await digest(commit.source) && await digest(ready.destination)===await digest(commit.destination),"invalid_relocation","destination readiness differs from source handoff");
  demand(instant(commit.issued_at)>=instant(ready.issued_at) && instant(commit.issued_at)<instant(ready.expires_at),"invalid_relocation","source committed outside destination readiness lifetime");
  // This private argument is computed only after both pinned-host proofs and the
  // temporal/company/generation chain verify. No public boolean bypass exists.
  return acceptAuthority(s,token,ctx,await digest(previous));
}
export async function requireRemoteAuthority(s: State, organizationId: string, ctx: Context) {
  const token = s.remote_authorities[organizationId]?.token; demand(token, "authority_unavailable", "remote authority evidence unavailable");
  await authorityAccept(s, token, ctx); return structuredClone(token.body);
}
