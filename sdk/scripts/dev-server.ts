// Local dev/test server: the same store router over an embedded PGlite Postgres, no Docker needed.
//   node scripts/dev-server.ts            -> http://127.0.0.1:8787/dtp-store
//   DTP_DEV_PORT=9000 node scripts/dev-server.ts
//   DTP_DEV_DATA=./.pglite node scripts/dev-server.ts   (persist between runs; default is in-memory)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb } from "../../supabase/functions/dtp-store/db.ts";
import { handle } from "../../supabase/functions/dtp-store/router.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migration = resolve(here, "../../supabase/migrations/20260903000000_protocol_store.sql");

export async function createDevStore(dataDir?: string) {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const applied = await pg.query("select 1 from information_schema.schemata where schema_name = 'protocol'");
  if (applied.rows.length === 0) await pg.exec(readFileSync(migration, "utf8"));
  const db = pgliteDb(pg);
  const port = Number(process.env.DTP_DEV_PORT ?? 8787);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request(url, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
    const response = await handle(request, { db });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}/dtp-store`,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await pg.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("dev-server.ts")) {
  const store = await createDevStore(process.env.DTP_DEV_DATA);
  console.log(`dtp-store (PGlite dev) listening at ${store.url}`);
}
