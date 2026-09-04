// POST /records write pipeline, plus record reads.
import type { Envelope, StoredRecord } from "../../../../sdk/src/envelope.ts";
import type { TypeInfo } from "../../../../sdk/src/registry.ts";
import { grantCovers, type GrantLike } from "../../../../sdk/src/scopes.ts";
import { generateToken, tokenHash, type Principal } from "../auth.ts";
import { canRead, grantsForModule, readPrefilter, type GrantRow } from "../authz.ts";
import type { Db } from "../db.ts";
import { StoreError, uniqueViolation } from "../errors.ts";
import { checkRoleContinuity, checkTransition, rolesOf } from "../transitions.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
import { statusFromBody, validateSignedEnvelope, type ValidatedRecord } from "../validate.ts";
import { decodeKeyId } from "../../../../sdk/src/keys.ts";

export interface Ctx {
  db: Db;
  principal: Principal | null;
  now: Date;
}

export interface RecordRow {
  record_id: string;
  root_id: string;
  type: string;
  namespace: string;
  schema_version: string;
  subject_company_id: string;
  counterparty_ids: string[];
  issuer_key_id: string;
  issuer_company_id: string;
  issuer_module_id: string | null;
  visibility: string;
  supersedes: string | null;
  is_head: boolean;
  status: string | null;
  created_at: string | Date;
  received_at: string | Date;
  body: Record<string, unknown>;
  envelope: Envelope<Record<string, unknown>>;
  payload_hash: string;
  signature: string;
  seq: number | string | null;
  superseded_by?: string | null;
}

const RECORD_SELECT = `select r.*, s.record_id as superseded_by
  from protocol.records r left join protocol.records s on s.supersedes = r.record_id`;

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function rowToRecord(r: RecordRow): StoredRecord {
  return {
    ...(r.envelope as Envelope<Record<string, unknown>>),
    seq: r.seq === null ? -1 : Number(r.seq),
    received_at: iso(r.received_at),
    payload_hash: r.payload_hash,
    is_head: r.is_head,
    superseded_by: r.superseded_by ?? null,
  };
}

export async function fetchRecordRow(db: Db, recordId: string): Promise<RecordRow | null> {
  if (!isUuid(recordId)) return null;
  const rows = await db.query<RecordRow>(`${RECORD_SELECT} where r.record_id = $1`, [recordId]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface WriteResult {
  record: StoredRecord;
  created: boolean;
  /** Tokens for newly added keys (core.company / core.module writes only). Shown once. */
  keys?: { key_id: string; token: string }[];
}

async function companyExists(db: Db, id: string): Promise<boolean> {
  const rows = await db.query("select 1 from protocol.companies where id = $1", [id]);
  return rows.length > 0;
}

interface KeyRow {
  key_id: string;
  owner_kind: string;
  owner_id: string;
  role: string;
  status: string;
}

/**
 * Authorization for a validated envelope against the caller's principal.
 * `prev` is the head being superseded (null for genesis): party membership is judged against the PREVIOUS
 * record's subject and counterparties, never against lists the writer just supplied.
 * Returns the grants used (for modules) so callers need not re-query.
 */
async function authorizeWrite(ctx: Ctx, v: ValidatedRecord, prev: RecordRow | null): Promise<GrantRow[]> {
  const { env, info } = v;
  const p = ctx.principal;
  if (!p) throw new StoreError("auth_required", "writes require a bearer token for the signing key");
  if (env.issuer.key_id !== p.key_id) {
    throw new StoreError("issuer_mismatch", "issuer.key_id must be the key the bearer token belongs to", { token_key: p.key_id, issuer_key: env.issuer.key_id });
  }
  // 1. the key must belong to the principal the envelope claims
  if (p.kind === "company") {
    if (env.issuer.module_id !== null) throw new StoreError("issuer_mismatch", "a company key signed this record but issuer.module_id is set");
    if (env.issuer.company_id !== p.id) throw new StoreError("issuer_mismatch", `key belongs to ${p.id}, not ${env.issuer.company_id}`);
    if (info.namespace === "core" && p.role !== "root") {
      throw new StoreError("forbidden", "core.* records must be signed by a root key");
    }
  } else {
    if (env.issuer.module_id !== p.id) throw new StoreError("issuer_mismatch", `key belongs to module ${p.id}, not ${env.issuer.module_id}`);
    if (!info.writable_by.includes("module")) throw new StoreError("forbidden", `${env.type} cannot be written by a module`);
    if (info.namespace === "core") throw new StoreError("forbidden", "modules cannot write core.* records");
  }

  // 2. the issuing company must be a party to the record — the record as it EXISTS, for a supersede
  const parties = prev ? [prev.subject_company_id, ...prev.counterparty_ids] : [env.subject_company_id, ...env.counterparty_ids];
  if (!parties.includes(env.issuer.company_id)) {
    throw new StoreError("issuer_not_party", "issuer.company_id must be the subject or a counterparty of the record");
  }
  if (p.kind === "company") return [];

  // 3. a module needs a live write grant from the company it acts for
  const grants = await grantsForModule(ctx.db, p.id);
  const ok = grants.some((g) => g.grantor_company_id === env.issuer.company_id && grantCovers(g as GrantLike, env.type, "write", ctx.now));
  if (!ok) {
    throw new StoreError("grant_missing", `module ${p.id} has no active write grant for ${env.type} from ${env.issuer.company_id}`);
  }
  return grants;
}

/** Type-specific side effects, run inside the write transaction after the record row exists. */
async function runHooks(tx: Db, ctx: Ctx, v: ValidatedRecord, prev: RecordRow | null): Promise<{ key_id: string; token: string }[]> {
  const { env, info } = v;
  const body = env.body as Record<string, any>;
  const minted: { key_id: string; token: string }[] = [];

  if (env.type === "core.company") {
    if (env.subject_company_id !== env.issuer.company_id || env.issuer.module_id !== null) {
      throw new StoreError("forbidden", "core.company may only be written by the company itself");
    }
    minted.push(...(await syncKeys(tx, "company", env.subject_company_id, body.keys, env.record_id, prev?.body?.keys as any[] | undefined, ctx.principal!)));
    await tx.query("update protocol.companies set display_name = $2, legal_name = $3, head_record_id = $4 where id = $1", [
      env.subject_company_id, body.display_name, body.legal_name ?? null, env.record_id,
    ]);
  } else if (env.type === "core.module") {
    const moduleId = body.module_id as string;
    if (prev && prev.body.module_id !== moduleId) throw new StoreError("schema_invalid", "module_id cannot change");
    minted.push(...(await syncKeys(tx, "module", moduleId, body.keys, env.record_id, prev?.body?.keys as any[] | undefined, ctx.principal!)));
    await tx.query("update protocol.modules set name = $2, head_record_id = $3 where id = $1", [moduleId, body.name, env.record_id]);
  } else if (env.type === "core.grant") {
    if (env.subject_company_id !== env.issuer.company_id) throw new StoreError("forbidden", "core.grant must be issued by the granting company");
    const mod = await tx.query("select 1 from protocol.modules where id = $1", [body.module_id]);
    if (mod.length === 0) throw new StoreError("not_found", `module ${body.module_id} is not registered`);
    if (prev && prev.body.module_id !== body.module_id) throw new StoreError("schema_invalid", "a grant chain cannot change module_id");
    await tx.query(
      `insert into protocol.grants (grant_root_id, grant_record_id, grantor_company_id, grantee_module_id, scopes, status, expires_at, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
       on conflict (grant_root_id) do update set grant_record_id = excluded.grant_record_id, scopes = excluded.scopes, status = excluded.status, expires_at = excluded.expires_at, updated_at = now()`,
      [env.root_id, env.record_id, env.subject_company_id, body.module_id, JSON.stringify(body.scopes), body.status, body.expires_at ?? null],
    );
  }
  return minted;
}

/** Reconcile keys[] in a core.company / core.module body with protocol.keys. Mints tokens for new active keys. */
async function syncKeys(
  tx: Db,
  ownerKind: "company" | "module",
  ownerId: string,
  keys: any[],
  recordId: string,
  prevKeys: any[] | undefined,
  principal: Principal,
): Promise<{ key_id: string; token: string }[]> {
  const minted: { key_id: string; token: string }[] = [];
  const changed = JSON.stringify(prevKeys ?? null) !== JSON.stringify(keys);
  if (prevKeys && changed && principal.role !== "root") {
    throw new StoreError("forbidden", "only a root key may change keys[]");
  }
  const existing = await tx.query<KeyRow>("select key_id, owner_kind, owner_id, role, status from protocol.keys where owner_kind = $1 and owner_id = $2", [ownerKind, ownerId]);
  const byId = new Map(existing.map((k) => [k.key_id, k]));
  for (const k of keys) {
    const cur = byId.get(k.key_id);
    if (!cur) {
      const foreign = await tx.query("select owner_kind, owner_id from protocol.keys where key_id = $1", [k.key_id]);
      if (foreign.length) throw new StoreError("forbidden", `key ${k.key_id} already belongs to another principal`);
      const token = k.status === "active" ? generateToken() : null;
      await tx.query(
        "insert into protocol.keys (key_id, public_key, owner_kind, owner_id, role, label, status, token_hash, added_by_record_id, revoked_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [k.key_id, decodeKeyId(k.key_id), ownerKind, ownerId, k.role, k.label ?? null, k.status, token ? await tokenHash(token) : null, recordId, k.revoked_at ?? null],
      );
      if (token) minted.push({ key_id: k.key_id, token });
    } else if (cur.status === "active" && k.status === "revoked") {
      await tx.query("update protocol.keys set status = 'revoked', revoked_at = coalesce($2::timestamptz, now()) where key_id = $1", [k.key_id, k.revoked_at ?? null]);
    } else if (cur.status === "revoked" && k.status === "active") {
      throw new StoreError("forbidden", `key ${k.key_id} was revoked and cannot be reactivated; add a new key instead`);
    }
    if (cur && cur.role !== k.role) await tx.query("update protocol.keys set role = $2 where key_id = $1", [k.key_id, k.role]);
  }
  // keys removed from the list are treated as revoked
  const listed = new Set(keys.map((k) => k.key_id));
  for (const k of existing) {
    if (!listed.has(k.key_id) && k.status === "active") {
      await tx.query("update protocol.keys set status = 'revoked', revoked_at = now() where key_id = $1", [k.key_id]);
    }
  }
  return minted;
}

/** The general write pipeline for POST /records. Genesis core.company / core.module go through companies.ts / modules.ts. */
export async function writeRecord(ctx: Ctx, input: unknown): Promise<WriteResult> {
  const v = await validateSignedEnvelope(input);
  const { env, info } = v;

  // Genesis of identities is a special flow (self-certifying): route callers there.
  if (env.supersedes === null && (env.type === "core.company" || env.type === "core.module")) {
    throw new StoreError("bad_request", `create a new ${env.type} via POST /${env.type === "core.company" ? "companies" : "modules"}`);
  }

  // subject binding: the body field the schema names as the subject must equal the envelope's subject
  if (info.subject !== "self") {
    const bound = (env.body as Record<string, unknown>)[info.subject];
    if (bound !== env.subject_company_id) {
      throw new StoreError("schema_invalid", `body.${info.subject} must equal subject_company_id for ${env.type}`, { field: info.subject, value: bound });
    }
  }

  // supersession target is resolved first: authorization and roles are judged against the existing record
  let prev: RecordRow | null = null;
  if (env.supersedes) {
    prev = await fetchRecordRow(ctx.db, env.supersedes);
    if (!prev) throw new StoreError("supersedes_conflict", `supersedes target ${env.supersedes} does not exist`);
    if (!prev.is_head) throw new StoreError("supersedes_conflict", `record ${env.supersedes} is already superseded by ${prev.superseded_by}`, { head: prev.superseded_by });
    if (prev.type !== env.type) throw new StoreError("supersedes_conflict", "superseding record must have the same type");
    if (prev.subject_company_id !== env.subject_company_id) throw new StoreError("supersedes_conflict", "superseding record must have the same subject");
    if (prev.root_id !== env.root_id) throw new StoreError("supersedes_conflict", `root_id must be ${prev.root_id}`, { root_id: prev.root_id });
    // continuity: parties and visibility are locked for the life of a chain
    if (!sameSet(prev.counterparty_ids, env.counterparty_ids)) {
      throw new StoreError("supersedes_conflict", "counterparty_ids cannot change across a supersede", { counterparty_ids: prev.counterparty_ids });
    }
    if (prev.visibility !== env.visibility) {
      throw new StoreError("supersedes_conflict", "visibility cannot change across a supersede", { visibility: prev.visibility });
    }
  }

  await authorizeWrite(ctx, v, prev);

  if (!(await companyExists(ctx.db, env.subject_company_id))) {
    throw new StoreError("not_found", `subject company ${env.subject_company_id} is not registered`);
  }
  for (const c of env.counterparty_ids) {
    if (!(await companyExists(ctx.db, c))) throw new StoreError("not_found", `counterparty ${c} is not registered`);
  }

  // idempotency
  const existing = await fetchRecordRow(ctx.db, env.record_id);
  if (existing) {
    if (existing.payload_hash === v.payload_hash) return { record: rowToRecord(existing), created: false };
    throw new StoreError("duplicate_record_id", `record_id ${env.record_id} already exists with a different payload`);
  }

  // roles come from the record being superseded (or the new body for genesis), then continuity + state machine
  const party = { issuerCompanyId: env.issuer.company_id, subjectCompanyId: env.subject_company_id, counterpartyIds: env.counterparty_ids };
  const roles = rolesOf(info, prev ? prev.body : env.body, party);
  checkRoleContinuity(info, prev ? prev.body : null, env.body, party);
  checkTransition(info, prev ? prev.body : null, env.body, roles);

  const status = statusFromBody(info, env.body);

  let result: { seq: number; keys: { key_id: string; token: string }[] };
  try {
    result = await ctx.db.transaction(async (tx) => {
      await insertRecord(tx, v, status);
      if (prev) await tx.query("update protocol.records set is_head = false where record_id = $1", [prev.record_id]);
      const seq = await insertEvent(tx, v, status);
      const keys = await runHooks(tx, ctx, v, prev);
      return { seq, keys };
    });
  } catch (e) {
    // Concurrent writers: the DB's unique constraints are the arbiter. Translate them into the spec's answers.
    const constraint = uniqueViolation(e);
    if (constraint) {
      if (constraint.includes("records_pkey")) {
        const now = await fetchRecordRow(ctx.db, env.record_id);
        if (now && now.payload_hash === v.payload_hash) return { record: rowToRecord(now), created: false };
        throw new StoreError("duplicate_record_id", `record_id ${env.record_id} already exists with a different payload`);
      }
      if (constraint.includes("records_one_successor")) {
        const head = env.supersedes ? await fetchRecordRow(ctx.db, env.supersedes) : null;
        throw new StoreError("supersedes_conflict", `record ${env.supersedes} was superseded concurrently`, { head: head?.superseded_by ?? null });
      }
    }
    throw e;
  }

  const row = await fetchRecordRow(ctx.db, env.record_id);
  const out: WriteResult = { record: rowToRecord(row!), created: true };
  if (result.keys.length) out.keys = result.keys;
  return out;
}

export async function insertRecord(tx: Db, v: ValidatedRecord, status: string | null): Promise<void> {
  const { env } = v;
  await tx.query(
    `insert into protocol.records
      (record_id, root_id, type, namespace, schema_version, subject_company_id, counterparty_ids, issuer_key_id, issuer_company_id, issuer_module_id,
       visibility, supersedes, is_head, status, created_at, body, envelope, payload_hash, signature)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15::jsonb,$16::jsonb,$17,$18)`,
    [
      env.record_id, env.root_id, env.type, env.namespace, env.schema_version, env.subject_company_id, env.counterparty_ids,
      env.issuer.key_id, env.issuer.company_id, env.issuer.module_id, env.visibility, env.supersedes, status, env.created_at,
      JSON.stringify(env.body), JSON.stringify(env), v.payload_hash, env.signature,
    ],
  );
}

export async function insertEvent(tx: Db, v: ValidatedRecord, status: string | null): Promise<number> {
  const { env } = v;
  const rows = await tx.query<{ seq: number | string }>(
    `insert into protocol.events
      (record_id, root_id, type, namespace, schema_version, subject_company_id, counterparty_ids, issuer_key_id, issuer_company_id, issuer_module_id, visibility, supersedes, status, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning seq`,
    [
      env.record_id, env.root_id, env.type, env.namespace, env.schema_version, env.subject_company_id, env.counterparty_ids,
      env.issuer.key_id, env.issuer.company_id, env.issuer.module_id, env.visibility, env.supersedes, status, env.created_at,
    ],
  );
  const seq = Number(rows[0].seq);
  await tx.query("update protocol.records set seq = $2 where record_id = $1", [env.record_id, seq]);
  return seq;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function grantsFor(ctx: Ctx): Promise<GrantRow[]> {
  return ctx.principal?.kind === "module" ? grantsForModule(ctx.db, ctx.principal.id) : [];
}

export async function getRecord(ctx: Ctx, recordId: string): Promise<StoredRecord> {
  if (!isUuid(recordId)) throw new StoreError("not_found", `record ${recordId} not found`);
  const row = await fetchRecordRow(ctx.db, recordId);
  if (!row) throw new StoreError("not_found", `record ${recordId} not found`);
  const grants = await grantsFor(ctx);
  if (!canRead(row, ctx.principal, grants, ctx.now)) {
    // do not reveal existence
    throw new StoreError("not_found", `record ${recordId} not found`);
  }
  return rowToRecord(row);
}

export interface ListQuery {
  subject?: string;
  type?: string;
  namespace?: string;
  counterparty?: string;
  root_id?: string;
  include_superseded?: boolean;
  after?: number;
  limit?: number;
}

export async function listRecords(ctx: Ctx, q: ListQuery): Promise<{ records: StoredRecord[]; next_cursor: string | null }> {
  if (q.root_id !== undefined && !isUuid(q.root_id)) return { records: [], next_cursor: null };
  const grants = await grantsFor(ctx);
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (q.subject) add("r.subject_company_id = ?", q.subject);
  if (q.type) add("r.type = ?", q.type);
  if (q.namespace) add("r.namespace = ?", q.namespace);
  if (q.counterparty) add("? = any(r.counterparty_ids)", q.counterparty);
  if (q.root_id) add("r.root_id = ?", q.root_id);
  if (!q.include_superseded) where.push("r.is_head = true");
  if (q.after !== undefined) add("r.seq > ?", q.after);
  const [pre, preParams] = readPrefilter(ctx.principal, grants, "r", params.length + 1);
  params.push(...preParams);
  where.push(pre);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const rows = await ctx.db.query<RecordRow>(
    `${RECORD_SELECT} where ${where.join(" and ")} order by r.seq asc limit ${limit + 1}`,
    params,
  );
  const visible = rows.filter((r) => canRead(r, ctx.principal, grants, ctx.now));
  const page = visible.slice(0, limit);
  const next = rows.length > limit && page.length ? String(page[page.length - 1].seq) : null;
  return { records: page.map(rowToRecord), next_cursor: next };
}
