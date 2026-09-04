// Minimal database interface so the store runs on postgres.js (Supabase edge) or PGlite (Node dev/tests) unchanged.
// Queries use $1..$n placeholders. Rows come back as plain objects with json/jsonb parsed and arrays as JS arrays.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` inside a transaction; the callback receives a Db bound to that transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

// Postgres type OIDs
const OID_JSON = 114;
const OID_JSONB = 3802;
const OID_TEXT_ARRAY = 1009;
const OID_VARCHAR_ARRAY = 1015;
const OID_UUID_ARRAY = 2951;

/** Parse a Postgres array literal like {a,"b c",NULL} into a JS array of strings. */
export function parsePgTextArray(s: string): (string | null)[] {
  if (s === "{}") return [];
  const inner = s.slice(1, -1);
  const out: (string | null)[] = [];
  let cur = "";
  let quoted = false;
  let had = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quoted) {
      if (c === "\\") { cur += inner[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
    } else if (c === '"') {
      quoted = true; had = true;
    } else if (c === ",") {
      out.push(!had && cur === "NULL" ? null : cur); cur = ""; had = false;
    } else {
      cur += c;
    }
  }
  out.push(!had && cur === "NULL" ? null : cur);
  return out;
}

/** Coerce string-typed json/jsonb/text[] values (as some drivers return them) into parsed values, using column OIDs. */
function normalizeRows<T>(rows: any[], columns: { name: string; type: number }[] | undefined): T[] {
  if (!columns || rows.length === 0) return rows as T[];
  const jsonCols = columns.filter((c) => c.type === OID_JSON || c.type === OID_JSONB).map((c) => c.name);
  const arrCols = columns.filter((c) => c.type === OID_TEXT_ARRAY || c.type === OID_VARCHAR_ARRAY || c.type === OID_UUID_ARRAY).map((c) => c.name);
  if (jsonCols.length === 0 && arrCols.length === 0) return rows as T[];
  for (const row of rows) {
    for (const c of jsonCols) if (typeof row[c] === "string") row[c] = JSON.parse(row[c]);
    for (const c of arrCols) if (typeof row[c] === "string") row[c] = parsePgTextArray(row[c]);
  }
  return rows as T[];
}

/** Adapter for postgres.js (`npm:postgres`). */
export function postgresJsDb(sql: any): Db {
  const wrap = (s: any): Db => ({
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await s.unsafe(text, params as any[]);
      const rows = Array.from(result) as any[];
      return normalizeRows<T>(rows, (result as any).columns);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return s.begin((tx: any) => fn(wrap(tx)));
    },
  });
  return wrap(sql);
}

/** Adapter for PGlite (`@electric-sql/pglite`). */
export function pgliteDb(pg: any): Db {
  const wrap = (p: any): Db => ({
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const r = await p.query(text, params);
      return normalizeRows<T>(r.rows as any[], (r.fields as { name: string; dataTypeID: number }[] | undefined)?.map((f) => ({ name: f.name, type: f.dataTypeID })));
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return p.transaction((tx: any) => fn(wrap(tx)));
    },
  });
  return wrap(pg);
}
