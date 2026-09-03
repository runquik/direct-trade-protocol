// Module genesis. Subject is the publisher company; signed by a module root key listed in body.keys
// (self-certifying, issuer.module_id = module_id) or by a publisher root key (issuer.module_id null).
import { generateToken, tokenHash } from "../auth.ts";
import { StoreError } from "../errors.ts";
import { checkTransition, rolesOf } from "../transitions.ts";
import { statusFromBody, validateSignedEnvelope } from "../validate.ts";
import { fetchRecordRow, insertEvent, insertRecord, rowToRecord, type Ctx, type WriteResult } from "./records.ts";
import { decodeKeyId } from "../../../../sdk/src/keys.ts";

export async function createModule(ctx: Ctx, input: unknown): Promise<WriteResult & { module_id: string }> {
  const v = await validateSignedEnvelope(input);
  const { env, info } = v;
  if (env.type !== "core.module") throw new StoreError("bad_request", "POST /modules expects a core.module envelope");
  if (env.supersedes !== null) throw new StoreError("bad_request", "genesis record must have supersedes null; use POST /records to update");
  const body = env.body as Record<string, any>;
  const moduleId = body.module_id as string;
  if (env.subject_company_id !== body.publisher_company_id || env.issuer.company_id !== env.subject_company_id) {
    throw new StoreError("envelope_invalid", "subject_company_id and issuer.company_id must equal body.publisher_company_id");
  }
  const publisher = await ctx.db.query("select 1 from protocol.companies where id = $1", [env.subject_company_id]);
  if (!publisher.length) throw new StoreError("not_found", `publisher company ${env.subject_company_id} is not registered`);
  const exists = await ctx.db.query("select 1 from protocol.modules where id = $1", [moduleId]);
  if (exists.length) throw new StoreError("duplicate_record_id", `module ${moduleId} already exists`);

  const keys = body.keys as any[];
  const selfKey = keys.find((k) => k.key_id === env.issuer.key_id);
  if (env.issuer.module_id === moduleId) {
    if (!selfKey || selfKey.role !== "root" || selfKey.status !== "active") {
      throw new StoreError("forbidden", "self-certified module genesis must be signed by an active root key in body.keys");
    }
  } else if (env.issuer.module_id === null) {
    const p = ctx.principal;
    if (!p || p.kind !== "company" || p.id !== env.subject_company_id || p.role !== "root" || p.key_id !== env.issuer.key_id) {
      throw new StoreError("forbidden", "publisher-signed module genesis requires the publisher's root key bearer token");
    }
  } else {
    throw new StoreError("envelope_invalid", "issuer.module_id must be null (publisher-signed) or body.module_id (self-certified)");
  }
  for (const k of keys) {
    const taken = await ctx.db.query("select 1 from protocol.keys where key_id = $1", [k.key_id]);
    if (taken.length) throw new StoreError("forbidden", `key ${k.key_id} already belongs to another principal`);
  }
  checkTransition(info, null, env.body, rolesOf(info, env.body, { issuerCompanyId: env.issuer.company_id, subjectCompanyId: env.subject_company_id, counterpartyIds: env.counterparty_ids }));

  const minted: { key_id: string; token: string }[] = [];
  await ctx.db.transaction(async (tx) => {
    await tx.query("insert into protocol.modules (id, publisher_company_id, name, head_record_id) values ($1, $2, $3, $4)", [
      moduleId, env.subject_company_id, body.name, env.record_id,
    ]);
    for (const k of keys) {
      const token = k.status === "active" ? generateToken() : null;
      await tx.query(
        "insert into protocol.keys (key_id, public_key, owner_kind, owner_id, role, label, status, token_hash, added_by_record_id, revoked_at) values ($1,$2,'module',$3,$4,$5,$6,$7,$8,$9)",
        [k.key_id, decodeKeyId(k.key_id), moduleId, k.role, k.label ?? null, k.status, token ? await tokenHash(token) : null, env.record_id, k.revoked_at ?? null],
      );
      if (token) minted.push({ key_id: k.key_id, token });
    }
    await insertRecord(tx, v, statusFromBody(info, env.body));
    await insertEvent(tx, v, null);
  });
  const row = await fetchRecordRow(ctx.db, env.record_id);
  return { module_id: moduleId, record: rowToRecord(row!), created: true, keys: minted };
}

export async function getModule(ctx: Ctx, id: string) {
  const rows = await ctx.db.query<{ id: string; publisher_company_id: string; name: string; head_record_id: string | null }>(
    "select id, publisher_company_id, name, head_record_id from protocol.modules where id = $1",
    [id],
  );
  if (!rows.length) throw new StoreError("not_found", `module ${id} not found`);
  const head = rows[0].head_record_id ? await fetchRecordRow(ctx.db, rows[0].head_record_id) : null;
  return { module_id: id, publisher_company_id: rows[0].publisher_company_id, name: rows[0].name, record: head ? rowToRecord(head) : null };
}
