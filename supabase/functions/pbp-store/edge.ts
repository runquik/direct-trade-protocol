// Hosting boundary for the synthetic-data development deployment, not protocol authority.
import { handle, type Deps } from "./router.ts";
import { sha256Hex } from "../../../sdk/src/canonical.ts";

export interface EdgeOptions { accessToken: string; allowedOrigins: string[]; revision: string }
export async function handleEdge(req: Request, deps: Deps, options: EdgeOptions): Promise<Response> {
  const url = new URL(req.url);
  // Supabase can retain /functions/v1 in the forwarded path; never change signed audience.
  if (url.pathname.startsWith("/functions/v1/")) url.pathname = url.pathname.slice("/functions/v1".length);
  const origin = req.headers.get("origin");
  const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff", "vary": "Origin", "x-pbp-revision": options.revision });
  const respond = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: code } }), { status, headers });
  headers.set("content-type", "application/json");
  if (origin && !options.allowedOrigins.includes(origin)) return respond(403, "origin_not_allowed");
  if (origin) headers.set("access-control-allow-origin", origin);
  if (!["/pbp-store/health", "/pbp-store/commands"].includes(url.pathname)) return respond(404, "not_found");
  if (req.method === "OPTIONS") {
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type, x-pbp-dev-token");
    return new Response(null, { status: 204, headers });
  }
  if (!(req.method === "GET" && url.pathname === "/pbp-store/health")) {
    // The token reduces public exposure; it NEVER replaces a valid actor signature/permission.
    if (options.accessToken.length < 32) return respond(503, "development_access_unconfigured");
    const token = req.headers.get("x-pbp-dev-token") ?? "";
    if (token.length > 256 || await sha256Hex(new TextEncoder().encode(token)) !== await sha256Hex(new TextEncoder().encode(options.accessToken))) return respond(401, "development_access_required");
  }
  const response = await handle(new Request(url, req), deps);
  for (const [key, value] of headers) response.headers.set(key, value);
  return response;
}
