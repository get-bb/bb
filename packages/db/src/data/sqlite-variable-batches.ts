import { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { DbConnection } from "../connection.js";

const SQLITE_MAX_VARIABLE_NUMBER = 32_766;

interface QueryInSqliteVariableBatchesArgs<TValue, TRow> {
  dedupeKey: (value: TValue) => string;
  fixedVariableCount: number;
  maximumValueCount?: number;
  queryBatch: (values: readonly TValue[]) => readonly TRow[];
  values: readonly TValue[];
  variableCountPerValue: number;
}

export function queryInSqliteVariableBatches<TValue, TRow>(
  args: QueryInSqliteVariableBatchesArgs<TValue, TRow>,
): TRow[] {
  const values = [
    ...new Map(
      args.values.map((value) => [args.dedupeKey(value), value]),
    ).values(),
  ];
  if (values.length === 0) {
    return [];
  }
  const variableBatchSize = Math.floor(
    (SQLITE_MAX_VARIABLE_NUMBER - args.fixedVariableCount) /
      args.variableCountPerValue,
  );
  const batchSize = Math.min(
    variableBatchSize,
    args.maximumValueCount ?? variableBatchSize,
  );
  if (batchSize < 1) {
    throw new Error("The fixed SQL variables exceed the SQLite limit");
  }

  const rows: TRow[] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    rows.push(...args.queryBatch(values.slice(offset, offset + batchSize)));
  }
  return rows;
}

interface RenderedSqliteQuery {
  toSQL(): { sql: string; params: unknown[] };
}

const sqliteDialect = new SQLiteSyncDialect();

function renderSqliteQuery(query: SQL | RenderedSqliteQuery): {
  sql: string;
  params: unknown[];
} {
  return query instanceof SQL ? sqliteDialect.sqlToQuery(query) : query.toSQL();
}

export function queryRawRowsInSqliteVariableBatches<TRow>(
  db: DbConnection,
  values: readonly string[],
  buildQuery: (batch: readonly string[]) => SQL | RenderedSqliteQuery,
): TRow[] {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) {
    return [];
  }
  const run = (query: { sql: string; params: unknown[] }) =>
    db.$client.prepare<unknown[], TRow>(query.sql).all(...query.params);
  const whole = renderSqliteQuery(buildQuery(uniqueValues));
  if (whole.params.length <= SQLITE_MAX_VARIABLE_NUMBER) {
    return run(whole);
  }
  return queryInSqliteVariableBatches({
    dedupeKey: (value) => value,
    fixedVariableCount: whole.params.length - uniqueValues.length,
    queryBatch: (batch) => run(renderSqliteQuery(buildQuery(batch))),
    values: uniqueValues,
    variableCountPerValue: 1,
  });
}
