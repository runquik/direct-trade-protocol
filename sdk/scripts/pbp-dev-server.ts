// Local-only PBP 0.3 reference server. No production credentials or STORE_URL.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb } from "../../supabase/functions/dtp-store/db.ts";
import { handle, MAX_BYTES } from "../../supabase/functions/pbp-store/router.ts";
import { generateKeyPair, keyPairFromSecret } from "../src/keys.ts";

export async function createPbpStore(options: { port?: number; dataDir?: string; storeSecret?: string; trustedSources?: string[] } = {}) {
  if (options.dataDir && !options.storeSecret) throw new Error("persistent stores require a stable PBP_STORE_SECRET; do not generate a new migration trust key each restart");
  const pg = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  const exists = await pg.query("select 1 from information_schema.schemata where schema_name = 'pbp_v03'");
  if (!exists.rows.length) await pg.exec(readFileSync(new URL("../../spec/v0.3/store.sql", import.meta.url), "utf8"));
  const storeKey = options.storeSecret ? await keyPairFromSecret(options.storeSecret) : await generateKeyPair();
  let audience = "";
  const db = pgliteDb(pg);
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) { res.writeHead(413, { connection: "close" }); res.end(); return; }
        chunks.push(chunk);
      }
      // Never trust Host or forwarded headers to choose the signature audience.
      const request = new Request(audience + (req.url ?? "/"), { method: req.method, headers: { "content-type": "application/json" },
        body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks) });
      const response = await handle(request, { db, audience, storeKey, trustedSources: options.trustedSources ?? [] });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(400, { connection: "close" }); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no server address");
  audience = `http://127.0.0.1:${address.port}`;
  return { audience, keyId: storeKey.keyId, db, close: async () => { await new Promise<void>(r => server.close(() => r())); await pg.close(); } };
}
if (process.argv[1]?.endsWith("pbp-dev-server.ts")) {
  const store = await createPbpStore({ port: Number(process.env.PBP_PORT ?? 8788), dataDir: process.env.PBP_DATA,
    storeSecret: process.env.PBP_STORE_SECRET, trustedSources: (process.env.PBP_TRUSTED_SOURCES ?? "").split(",").filter(Boolean) });
  console.log(`PBP 0.3 reference preview at ${store.audience}/pbp-store/health`);
  console.log(`Store public key: ${store.keyId}`);
}
