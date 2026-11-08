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

interface BuiltSqliteQuery<TRow> {
  all(): TRow[];
  toSQL(): { params: unknown[] };
}

export function queryBuiltInSqliteVariableBatches<TRow>(
  values: readonly string[],
  buildQuery: (batch: readonly string[]) => BuiltSqliteQuery<TRow>,
): TRow[] {
  return queryInSqliteVariableBatches({
    dedupeKey: (value) => value,
    fixedVariableCount: buildQuery([]).toSQL().params.length,
    queryBatch: (batch) => buildQuery(batch).all(),
    values,
    variableCountPerValue: 1,
  });
}
