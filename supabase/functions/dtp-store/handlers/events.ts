// GET /events — cursor-paginated feed of record_appended events, visibility-filtered.
import { canRead, grantsForModule, readPrefilter, type GrantRow } from "../authz.ts";
import { StoreError } from "../errors.ts";
import type { Ctx } from "./records.ts";

interface EventRow {
  seq: number | string;
  event_id: string;
  kind: string;
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
  status: string | null;
  created_at: string | Date;
  recorded_at: string | Date;
  body?: Record<string, unknown> | null;
}

function cursor(seq: number | string): string {
  return String(seq).padStart(16, "0");
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export interface EventsQuery {
  company?: string;
  after?: string;
  limit?: number;
}

export async function listEvents(ctx: Ctx, q: EventsQuery) {
  const p = ctx.principal;
  if (!p) throw new StoreError("auth_required", "the event feed requires a bearer token");
  const grants: GrantRow[] = p.kind === "module" ? await grantsForModule(ctx.db, p.id) : [];
  const params: unknown[] = [];
  const where: string[] = [];
  const after = q.after ? Number(q.after) : 0;
  if (!Number.isFinite(after) || after < 0) throw new StoreError("bad_request", "after must be a non-negative cursor");
  params.push(after);
  where.push(`e.seq > $${params.length}`);
  if (q.company) {
    params.push(q.company);
    where.push(`(e.subject_company_id = $${params.length} or $${params.length} = any(e.counterparty_ids))`);
  }
  const [pre, preParams] = readPrefilter(p, grants, "e", params.length + 1);
  params.push(...preParams);
  where.push(pre);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const rows = await ctx.db.query<EventRow>(
    `select e.*, r.body from protocol.events e join protocol.records r on r.record_id = e.record_id where ${where.join(" and ")} order by e.seq asc limit ${limit + 1}`,
    params,
  );
  const visible = rows.filter((r) => canRead({ ...r, body: r.body ?? null }, p, grants, ctx.now));
  const page = visible.slice(0, limit);
  // latest_cursor is scoped to what this caller may see, so it does not leak store-wide activity volume
  const [latestPre, latestParams] = readPrefilter(p, grants, "e", 1);
  const latest = await ctx.db.query<{ seq: number | string | null }>(`select max(e.seq) as seq from protocol.events e where ${latestPre}`, latestParams);
  const events = page.map((e) => ({
    cursor: cursor(e.seq),
    event_id: e.event_id,
    kind: e.kind,
    record_id: e.record_id,
    root_id: e.root_id,
    type: e.type,
    namespace: e.namespace,
    schema_version: e.schema_version,
    subject_company_id: e.subject_company_id,
    counterparty_ids: e.counterparty_ids,
    issuer: { key_id: e.issuer_key_id, company_id: e.issuer_company_id, module_id: e.issuer_module_id },
    visibility: e.visibility,
    supersedes: e.supersedes,
    status: e.status,
    created_at: iso(e.created_at),
    recorded_at: iso(e.recorded_at),
  }));
  const scannedLast = rows.length ? rows[Math.min(rows.length, limit) - 1].seq : after;
  return {
    events,
    // next_cursor advances past everything scanned (visible or not) so pollers never stall on hidden rows
    next_cursor: rows.length > limit ? cursor(scannedLast) : null,
    latest_cursor: cursor(latest[0]?.seq ?? 0),
  };
}
