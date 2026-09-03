// Thin fetch client for the DTP protocol store. Web-standard; works in Node, Deno, browsers.
import type { Envelope, StoredRecord, UnsignedEnvelope, Visibility } from "./envelope.ts";
import { namespaceOf, newRecordId, nowIso } from "./envelope.ts";
import { signRecord } from "./sign.ts";

export interface StoreErrorBody {
  error: { code: string; message: string; details: unknown };
}

export class StoreRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, body: StoreErrorBody) {
    super(`${body.error.code}: ${body.error.message}`);
    this.name = "StoreRequestError";
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

export interface WriteResponse {
  record: StoredRecord;
  created: boolean;
  keys?: { key_id: string; token: string }[];
}

export interface DraftOptions<T> {
  type: string;
  subject_company_id: string;
  issuer: { key_id: string; company_id: string; module_id: string | null };
  body: T;
  counterparty_ids?: string[];
  visibility?: Visibility;
  supersedes?: string | null;
  root_id?: string;
  record_id?: string;
  created_at?: string;
  schema_version?: string;
}

/** Build an unsigned envelope with sensible defaults (new record_id, root_id = record_id for genesis). */
export function draft<T>(o: DraftOptions<T>): UnsignedEnvelope<T> {
  const record_id = o.record_id ?? newRecordId();
  return {
    record_id,
    root_id: o.root_id ?? (o.supersedes ? (() => { throw new Error("root_id is required when supersedes is set"); })() : record_id),
    type: o.type,
    namespace: namespaceOf(o.type),
    schema_version: o.schema_version ?? "0.2",
    subject_company_id: o.subject_company_id,
    counterparty_ids: o.counterparty_ids ?? [],
    issuer: o.issuer,
    visibility: o.visibility ?? "counterparties",
    created_at: o.created_at ?? nowIso(),
    supersedes: o.supersedes ?? null,
    body: o.body,
  };
}

export class DtpStoreClient {
  readonly baseUrl: string;
  token: string | null;
  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  with(token: string | null): DtpStoreClient {
    return new DtpStoreClient(this.baseUrl, token);
  }

  async request<T>(method: string, path: string, body?: unknown, token: string | null = this.token): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new StoreRequestError(res.status, data as StoreErrorBody);
    return { status: res.status, data: data as T };
  }

  health() { return this.request<{ status: string; version: string; protocol_version: string }>("GET", "/health").then((r) => r.data); }
  schemas() { return this.request<any>("GET", "/schemas").then((r) => r.data); }
  schema(type: string) { return this.request<any>("GET", `/schemas/${encodeURIComponent(type)}`).then((r) => r.data); }
  canonicalize(env: unknown) { return this.request<any>("POST", "/debug/canonicalize", env).then((r) => r.data); }
  whoami() { return this.request<{ principal: any }>("GET", "/whoami").then((r) => r.data.principal); }

  createCompany(env: Envelope) { return this.request<WriteResponse & { company_id: string }>("POST", "/companies", env, null).then((r) => r.data); }
  getCompany(id: string) { return this.request<any>("GET", `/companies/${encodeURIComponent(id)}`).then((r) => r.data); }
  companyGrants(id: string) { return this.request<{ grants: any[] }>("GET", `/companies/${encodeURIComponent(id)}/grants`).then((r) => r.data.grants); }
  createModule(env: Envelope) { return this.request<WriteResponse & { module_id: string }>("POST", "/modules", env).then((r) => r.data); }
  getModule(id: string) { return this.request<any>("GET", `/modules/${encodeURIComponent(id)}`).then((r) => r.data); }

  write(env: Envelope) { return this.request<WriteResponse>("POST", "/records", env).then((r) => r.data); }
  /** Sign and write in one step. */
  async sign<T>(unsigned: UnsignedEnvelope<T>, secretKey: string): Promise<WriteResponse> {
    const env = await signRecord(unsigned, secretKey);
    return this.write(env as Envelope);
  }
  getRecord(id: string) { return this.request<{ record: StoredRecord }>("GET", `/records/${id}`).then((r) => r.data.record); }
  listRecords(q: Record<string, string | number | boolean | undefined> = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
    const qs = p.toString();
    return this.request<{ records: StoredRecord[]; next_cursor: string | null }>("GET", `/records${qs ? "?" + qs : ""}`).then((r) => r.data);
  }
  events(q: { company?: string; after?: string; limit?: number } = {}) {
    const p = new URLSearchParams();
    if (q.company) p.set("company", q.company);
    if (q.after) p.set("after", q.after);
    if (q.limit) p.set("limit", String(q.limit));
    const qs = p.toString();
    return this.request<{ events: any[]; next_cursor: string | null; latest_cursor: string }>("GET", `/events${qs ? "?" + qs : ""}`).then((r) => r.data);
  }
}
