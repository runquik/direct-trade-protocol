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
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new StoreError("payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`);
  if (!text.trim()) throw new StoreError("bad_request", "empty body");
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreError("bad_request", "body is not valid JSON");
  }
}

function intParam(url: URL, name: string): number | undefined {
  const v = url.searchParams.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new StoreError("bad_request", `${name} must be a number`);
  return n;
}

export interface Deps {
  db: Db;
  now?: () => Date;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = relativePath(url);
  const now = deps.now ? deps.now() : new Date();

  try {
    let principal: Principal | null;
    try {
      principal = await resolvePrincipal(deps.db, req.headers);
    } catch (e) {
      if (isStoreError(e)) return json(e.toBody(), e.status);
      throw e;
    }
    const ctx: Ctx = { db: deps.db, principal, now };
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
        const r = await createCompany(ctx, await readJson(req));
        return json(r, 201);
      }
      if (m === "GET" && b !== undefined && c === undefined) return json(await getCompany(ctx, b));
      if (m === "GET" && b !== undefined && c === "grants") return json({ grants: await listCompanyGrants(ctx, b) });
    }

    if (a === "modules") {
      if (m === "POST" && b === undefined) {
        const r = await createModule(ctx, await readJson(req));
        return json(r, 201);
      }
      if (m === "GET" && b !== undefined) return json(await getModule(ctx, b));
    }

    if (a === "records") {
      if (m === "POST" && b === undefined) {
        const r = await writeRecord(ctx, await readJson(req));
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
    return json({ error: { code: "internal", message: (e as Error)?.message ?? "internal error", details: {} } }, 500);
  }
}
