import { sqliteToPg } from "./sqlite-to-pg.js";

export type QueryMethod = "run" | "all" | "get" | "values";

export interface SqlResult {
  rows: unknown[][];
  changes: number;
}

export type BackendKind = "d1" | "pg";

export interface SqlBackend {
  readonly kind: BackendKind;
  execute(
    sql: string,
    params: readonly unknown[],
    method: QueryMethod,
  ): Promise<SqlResult>;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{
    results?: Record<string, unknown>[];
    meta: { changes?: number };
  }>;
  raw(): Promise<unknown[][]>;
}

export interface D1Like {
  prepare(query: string): D1StatementLike;
}

export function d1Backend(d1: D1Like): SqlBackend {
  return {
    kind: "d1",
    async execute(sql, params, method) {
      const statement = d1.prepare(sql).bind(...params);
      if (method === "run") {
        const result = await statement.run();
        return {
          rows: (result.results ?? []).map((row) => Object.values(row)),
          changes: result.meta.changes ?? 0,
        };
      }
      const rows = await statement.raw();
      return { rows, changes: 0 };
    },
  };
}

export interface PgQueryResult {
  rows: unknown[][];
  rowCount: number | null;
}

export interface PgQueryable {
  queryArrays(text: string, params: readonly unknown[]): Promise<PgQueryResult>;
}

export function pgBackend(pg: PgQueryable): SqlBackend {
  return {
    kind: "pg",
    async execute(sql, params, method) {
      const result = await pg.queryArrays(sqliteToPg(sql), params);
      return {
        rows: result.rows,
        changes: method === "run" ? (result.rowCount ?? 0) : 0,
      };
    },
  };
}
