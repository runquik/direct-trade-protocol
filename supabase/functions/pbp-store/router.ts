// v0.3 reference HTTP entry, deliberately independent of dtp-store's credentials.
import type { Db } from "../dtp-store/db.ts";
import { execute, type EngineOptions } from "../../../sdk/src/v03/engine.ts";
import { PbpError } from "../../../sdk/src/v03/wire.ts";
import type { State } from "../../../sdk/src/v03/model.ts";
import { FloatNotAllowedError, CanonicalizationError } from "../../../sdk/src/canonical.ts";

export const MAX_BYTES = 1024 * 1024;
export interface Deps extends Omit<EngineOptions, "now"> { db: Db; now?: () => number; maxStateBytes?: number }
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new PbpError("invalid", "empty body", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); throw new PbpError("payload_too_large", "body exceeds 1 MiB", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const queue = [{ value: parsed, depth: 0 }];
    while (queue.length) {
      const { value, depth } = queue.pop()!;
      if (depth > 48) throw new Error("too deep");
      if (value && typeof value === "object") for (const child of Object.values(value)) queue.push({ value: child, depth: depth + 1 });
    }
    return parsed;
  } catch { throw new PbpError("invalid", "invalid UTF-8 JSON or excessive nesting", 400); }
}
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/pbp-store/health") return json({ service: "Portable Business Protocol", protocol_version: "0.3", profile: "reference-preview", audience: deps.audience, store_key_id: deps.storeKey.keyId });
    if (req.method !== "POST" || path !== "/pbp-store/commands") return json({ error: { code: "not_found", message: "route not found" } }, 404);
    const input = await body(req);
    const result = await deps.db.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(1346523187)");
      const rows = await tx.query<{ body: State }>("select body from pbp_v03.state where singleton = true for update");
      if (!rows[0]) throw new Error("store uninitialized");
      const state = structuredClone(rows[0].body);
      // Authorization and clock freshness are evaluated after acquiring the write lock.
      const out = await execute(state, input, { ...deps, now: deps.now?.() ?? Date.now() });
      const serialized = JSON.stringify(state);
      if (deps.maxStateBytes && new TextEncoder().encode(serialized).length > deps.maxStateBytes) throw new PbpError("development_capacity", "development store capacity reached", 507);
      await tx.query("update pbp_v03.state set body = $1::jsonb, revision = revision + 1 where singleton = true", [serialized]);
      return out;
    });
    return json({ result });
  } catch (error) {
    if (error instanceof FloatNotAllowedError || error instanceof CanonicalizationError) return json({ error: { code: "invalid", message: "command must be canonicalizable integer-only JSON" } }, 400);
    if (error instanceof PbpError) return json({ error: { code: error.code, message: error.message } }, error.status);
    // Shared v0.2 pure body/transition validators also throw typed store errors.
    if ((error as any)?.name === "StoreError") return json({ error: { code: (error as any).code, message: (error as Error).message } }, (error as any).status);
    console.error("PBP v0.3 request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: { code: "internal", message: "internal error" } }, 500);
  }
}
