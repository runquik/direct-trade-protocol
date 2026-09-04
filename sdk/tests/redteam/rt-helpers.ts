// Shared helpers for the red-team reproductions. Reuses ../helpers.ts fixtures and adds raw HTTP + assertion utilities.
// Run one file:   node --test tests/redteam/rt01_*.test.ts
// Against live:   STORE_URL=https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store node --test tests/redteam/rt01_*.test.ts
// Every identity created here is fresh (`wb-<random>.dtp`), so runs against the shared env are non-destructive.
export * from "../helpers.ts";
import { DtpStoreClient, StoreRequestError, draft } from "../../src/client.ts";
import { signRecord } from "../../src/sign.ts";
import { nowIso, type Envelope, type UnsignedEnvelope } from "../../src/envelope.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { storeUnderTest, type Company } from "../helpers.ts";

export { DtpStoreClient, StoreRequestError, draft, signRecord, nowIso, generateKeyPair };

export interface Env { url: string; base: DtpStoreClient; close: () => Promise<void>; live: boolean }

export async function setup(): Promise<Env> {
  const s = await storeUnderTest();
  return { url: s.url, base: new DtpStoreClient(s.url), close: s.close, live: !!process.env.STORE_URL };
}

/** Raw fetch that never throws; returns {status, body}. */
export async function raw(url: string, path: string, init: { method?: string; token?: string | null; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  if (init.body !== undefined || init.rawBody !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers["authorization"] = `Bearer ${init.token}`;
  const res = await fetch(url + path, { method: init.method ?? "GET", headers, body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

/** Run a client call and return {ok, code, status, data} instead of throwing. */
export async function attempt<T>(p: Promise<T>): Promise<{ ok: boolean; code: string | null; status: number | null; data: T | null; message?: string }> {
  try {
    return { ok: true, code: null, status: null, data: await p };
  } catch (e) {
    if (e instanceof StoreRequestError) return { ok: false, code: e.code, status: e.status, data: null, message: e.message };
    throw e;
  }
}

/** Sign `unsigned` with `secret` and POST /records with `token`, returning the raw result. */
export async function post(env: Env, unsigned: UnsignedEnvelope<any>, secret: string, token: string | null) {
  const signed = await signRecord(unsigned, secret);
  return raw(env.url, "/records", { method: "POST", token, body: signed });
}

/** A superseding envelope over `prev` (a stored record) with body/envelope overrides. */
export function supersedeOf(prev: any, issuer: { key_id: string; company_id: string; module_id: string | null }, overrides: Partial<UnsignedEnvelope<any>> & { body?: any } = {}): UnsignedEnvelope<any> {
  const record_id = crypto.randomUUID();
  return {
    record_id,
    root_id: prev.root_id,
    type: prev.type,
    namespace: prev.namespace,
    schema_version: prev.schema_version,
    subject_company_id: prev.subject_company_id,
    counterparty_ids: prev.counterparty_ids,
    issuer,
    visibility: prev.visibility,
    created_at: nowIso(),
    supersedes: prev.record_id,
    ...overrides,
    body: overrides.body ?? prev.body,
  };
}

export function log(title: string, obj: unknown) {
  console.log(`\n[${title}]`, typeof obj === "string" ? obj : JSON.stringify(obj, null, 0).slice(0, 600));
}
