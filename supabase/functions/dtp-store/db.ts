// Minimal database interface so the store runs on postgres.js (Supabase edge) or PGlite (Node dev/tests) unchanged.
// Queries use $1..$n placeholders. Rows come back as plain objects.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` inside a transaction; the callback receives a Db bound to that transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export interface DbFactory {
  (): Db;
}

/** Adapter for postgres.js (`npm:postgres`). */
export function postgresJsDb(sql: any): Db {
  const wrap = (s: any): Db => ({
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await s.unsafe(text, params as any[]);
      return Array.from(rows) as T[];
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
      return r.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return p.transaction((tx: any) => fn(wrap(tx)));
    },
  });
  return wrap(pg);
}
