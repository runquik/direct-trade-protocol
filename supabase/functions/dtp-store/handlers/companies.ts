// Company genesis (self-certifying) and spine reads.
import { grantsByCompany, type GrantRow } from "../authz.ts";
import { StoreError } from "../errors.ts";
import { checkTransition, rolesOf } from "../transitions.ts";
import { statusFromBody, validateSignedEnvelope } from "../validate.ts";
import { fetchRecordRow, insertEvent, insertRecord, rowToRecord, type Ctx, type WriteResult } from "./records.ts";
import { generateToken, tokenHash } from "../auth.ts";
import { decodeKeyId } from "../../../../sdk/src/keys.ts";

/**
 * POST /companies — body is a signed genesis core.company envelope.
 * The signing key must be a root key listed in body.keys; the store verifies with that embedded public key.
 */
export async function createCompany(ctx: Ctx, input: unknown): Promise<WriteResult & { company_id: string }> {
  const v = await validateSignedEnvelope(input);
  const { env, info } = v;
  if (env.type !== "core.company") throw new StoreError("bad_request", "POST /companies expects a core.company envelope");
  if (env.supersedes !== null) throw new StoreError("bad_request", "genesis record must have supersedes null; use POST /records to update");
  if (env.issuer.company_id !== env.subject_company_id || env.issuer.module_id !== null) {
    throw new StoreError("forbidden", "a company genesis must be signed by the company itself (issuer.company_id == subject, module_id null)");
  }
  if (env.counterparty_ids.length) throw new StoreError("envelope_invalid", "core.company has no counterparties");
  const body = env.body as Record<string, any>;
  const signing = (body.keys as any[]).find((k) => k.key_id === env.issuer.key_id);
  if (!signing || signing.role !== "root" || signing.status !== "active") {
    throw new StoreError("forbidden", "genesis must be signed by an active root key listed in body.keys");
  }
  const exists = await ctx.db.query("select 1 from protocol.companies where id = $1", [env.subject_company_id]);
  if (exists.length) throw new StoreError("duplicate_record_id", `company ${env.subject_company_id} already exists`);
  for (const k of body.keys as any[]) {
    const taken = await ctx.db.query("select 1 from protocol.keys where key_id = $1", [k.key_id]);
    if (taken.length) throw new StoreError("forbidden", `key ${k.key_id} already belongs to another principal`);
  }
  checkTransition(info, null, env.body, rolesOf(info, env.body, { issuerCompanyId: env.issuer.company_id, subjectCompanyId: env.subject_company_id, counterpartyIds: [] }));

  const minted: { key_id: string; token: string }[] = [];
  await ctx.db.transaction(async (tx) => {
    await tx.query("insert into protocol.companies (id, display_name, legal_name, head_record_id) values ($1, $2, $3, $4)", [
      env.subject_company_id, body.display_name, body.legal_name ?? null, env.record_id,
    ]);
    for (const k of body.keys as any[]) {
      const token = k.status === "active" ? generateToken() : null;
      await tx.query(
        "insert into protocol.keys (key_id, public_key, owner_kind, owner_id, role, label, status, token_hash, added_by_record_id, revoked_at) values ($1,$2,'company',$3,$4,$5,$6,$7,$8,$9)",
        [k.key_id, decodeKeyId(k.key_id), env.subject_company_id, k.role, k.label ?? null, k.status, token ? await tokenHash(token) : null, env.record_id, k.revoked_at ?? null],
      );
      if (token) minted.push({ key_id: k.key_id, token });
    }
    await insertRecord(tx, v, statusFromBody(info, env.body));
    await insertEvent(tx, v, null);
  });
  const row = await fetchRecordRow(ctx.db, env.record_id);
  return { company_id: env.subject_company_id, record: rowToRecord(row!), created: true, keys: minted };
}

export interface CompanyView {
  company_id: string;
  record: ReturnType<typeof rowToRecord> | null;
  active_keys: { key_id: string; role: string; label: string | null }[];
  grants_issued?: GrantRow[];
}

/** GET /companies/{id} — the public spine (head core.company record) + active key ids; grants if the caller is the company. */
export async function getCompany(ctx: Ctx, id: string): Promise<CompanyView> {
  const rows = await ctx.db.query<{ id: string; head_record_id: string | null }>("select id, head_record_id from protocol.companies where id = $1", [id]);
  if (!rows.length) throw new StoreError("not_found", `company ${id} not found`);
  const head = rows[0].head_record_id ? await fetchRecordRow(ctx.db, rows[0].head_record_id) : null;
  const keys = await ctx.db.query<{ key_id: string; role: string; label: string | null }>(
    "select key_id, role, label from protocol.keys where owner_kind = 'company' and owner_id = $1 and status = 'active' order by created_at",
    [id],
  );
  const view: CompanyView = { company_id: id, record: head ? rowToRecord(head) : null, active_keys: keys };
  if (ctx.principal?.kind === "company" && ctx.principal.id === id) view.grants_issued = await grantsByCompany(ctx.db, id);
  return view;
}

/** GET /companies/{id}/grants — the company sees everything it issued; a module sees only its own. */
export async function listCompanyGrants(ctx: Ctx, id: string): Promise<GrantRow[]> {
  const p = ctx.principal;
  if (!p) throw new StoreError("auth_required", "grants are not public");
  const all = await grantsByCompany(ctx.db, id);
  if (p.kind === "company") {
    if (p.id !== id) throw new StoreError("forbidden", "a company may only list its own grants");
    return all;
  }
  return all.filter((g) => g.grantee_module_id === p.id);
}
