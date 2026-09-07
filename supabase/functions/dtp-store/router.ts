// HTTP routing for the DTP protocol store. Web-standard Request/Response only, so it runs in
// Supabase Edge (Deno) and in a plain Node server unchanged.
import { resolvePrincipal, type Principal } from "./auth.ts";
import type { Db } from "./db.ts";
import { isStoreError, StoreError } from "./errors.ts";
import { MAX_BODY_BYTES } from "./validate.ts";
import { PROTOCOL_VERSION } from "../../../sdk/src/schemas.ts";
import { createCompany, getCompany, listCompanyGrants } from "./handlers/companies.ts";
import { createModule, getModule } from "./handlers/modules.ts";
import { listEvents } from "./handlers/events.ts";
import { getRecord, listRecords, writeRecord, type Ctx } from "./handlers/records.ts";
import { debugCanonicalize, schemaFor, schemaIndex } from "./handlers/schemas.ts";

export const STORE_VERSION = "0.2.0";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
}

/** Path relative to the function root: strips everything up to and including the "dtp-store" segment. */
export function relativePath(url: URL): string[] {
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("dtp-store");
  return (i >= 0 ? parts.slice(i + 1) : parts).map(decodeURIComponent);
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new StoreError("payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`);
  const reader = req.body?.getReader();
  if (!reader) throw new StoreError("bad_request", "empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new StoreError("payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new StoreError("bad_request", "body is not valid UTF-8"); }
  if (!text.trim()) throw new StoreError("bad_request", "empty body");
  try {
    const parsed = JSON.parse(text);
    const pending: { value: unknown; depth: number }[] = [{ value: parsed, depth: 0 }];
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      if (depth > 64) throw new StoreError("bad_request", "JSON nesting exceeds 64 levels");
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
      }
    }
    return parsed;
  } catch (e) {
    if (isStoreError(e)) throw e;
    throw new StoreError("bad_request", "body is not valid JSON");
  }
}

function intParam(url: URL, name: string): number | undefined {
  const v = url.searchParams.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < (name === "limit" ? 1 : 0)) throw new StoreError("bad_request", `${name} must be a ${name === "limit" ? "positive" : "non-negative"} safe integer`);
  return n;
}

export interface Deps {
  db: Db;
  now?: () => Date;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const url = new URL(req.url);
    let path: string[];
    try { path = relativePath(url); }
    catch { throw new StoreError("bad_request", "malformed path encoding"); }
    const now = deps.now ? deps.now() : new Date();
    let principal: Principal | null;
    try {
      principal = await resolvePrincipal(deps.db, req.headers);
    } catch (e) {
      if (isStoreError(e)) return json(e.toBody(), e.status);
      throw e;
    }
    const ctx: Ctx = { db: deps.db, principal, now };
    // Sprint reference store: serialize ALL append transactions. This makes event
    // sequence allocation commit-ordered and authorization/revocation linearizable.
    // Revisit the coarse lock before high-throughput deployment, not its guarantees.
    async function atomicWrite<T>(run: (writeCtx: Ctx) => Promise<T>): Promise<T> {
      return deps.db.transaction(async tx => {
        await tx.query("select pg_advisory_xact_lock(1146376208)");
        const current = await resolvePrincipal(tx, req.headers);
        // Handlers' inner transactions join this outer transaction (no early commit).
        const joined: Db = { query: (sql, params) => tx.query(sql, params), transaction: fn => fn(joined) };
        return run({ db: joined, principal: current, now: deps.now ? deps.now() : new Date() });
      });
    }
    const m = req.method;
    const [a, b, c] = path;

    if (m === "GET" && (a === undefined || a === "health")) {
      return json({ status: "ok", service: "dtp-store", version: STORE_VERSION, protocol_version: PROTOCOL_VERSION, time: now.toISOString() });
    }
    if (m === "GET" && a === "schemas" && b === undefined) return json(schemaIndex());
    if (m === "GET" && a === "schemas" && b !== undefined) return json(schemaFor(b));
    if (m === "POST" && a === "debug" && b === "canonicalize") return json(await debugCanonicalize(await readJson(req)));

    if (m === "GET" && a === "whoami") {
      if (!principal) throw new StoreError("auth_required", "no bearer token");
      return json({ principal });
    }

    if (a === "companies") {
      if (m === "POST" && b === undefined) {
        const input = await readJson(req);
        const r = await atomicWrite(c => createCompany(c, input));
        return json(r, r.created ? 201 : 200);
      }
      if (m === "GET" && b !== undefined && c === undefined) return json(await getCompany(ctx, b));
      if (m === "GET" && b !== undefined && c === "grants") return json({ grants: await listCompanyGrants(ctx, b) });
    }

    if (a === "modules") {
      if (m === "POST" && b === undefined) {
        const input = await readJson(req);
        const r = await atomicWrite(c => createModule(c, input));
        return json(r, r.created ? 201 : 200);
      }
      if (m === "GET" && b !== undefined) return json(await getModule(ctx, b));
    }

    if (a === "records") {
      if (m === "POST" && b === undefined) {
        const input = await readJson(req);
        const r = await atomicWrite(c => writeRecord(c, input));
        return json(r, r.created ? 201 : 200);
      }
      if (m === "GET" && b !== undefined) return json({ record: await getRecord(ctx, b) });
      if (m === "GET" && b === undefined) {
        const q = url.searchParams;
        return json(
          await listRecords(ctx, {
            subject: q.get("subject") ?? undefined,
            type: q.get("type") ?? undefined,
            namespace: q.get("namespace") ?? undefined,
            counterparty: q.get("counterparty") ?? undefined,
            root_id: q.get("root_id") ?? undefined,
            include_superseded: q.get("include_superseded") === "true",
            after: intParam(url, "after"),
            limit: intParam(url, "limit"),
          }),
        );
      }
    }

    if (m === "GET" && a === "events") {
      const q = url.searchParams;
      return json(await listEvents(ctx, { company: q.get("company") ?? undefined, after: q.get("after") ?? undefined, limit: intParam(url, "limit") }));
    }

    throw new StoreError("not_found", `no route for ${m} /${path.join("/")}`);
  } catch (e) {
    if (isStoreError(e)) return json(e.toBody(), e.status);
    console.error("dtp-store internal error:", e);
    return json({ error: { code: "internal", message: "internal error", details: {} } }, 500);
  }
}
