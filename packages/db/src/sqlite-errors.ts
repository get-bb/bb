interface SqliteUniqueConstraintColumnsArgs {
  columnNames: readonly string[];
  indexName: string;
  tableName: string;
}

function getSqliteErrorCode(error: Error): string | null {
  const code = "code" in error ? error.code : null;
  return typeof code === "string" && code.startsWith("SQLITE_") ? code : null;
}

function findSqliteError(error: Error): Error | null {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    if (getSqliteErrorCode(current) !== null) {
      return current;
    }
    current = current.cause;
  }
  return null;
}

export function isSqliteUniqueConstraintOnColumns(
  error: Error,
  args: SqliteUniqueConstraintColumnsArgs,
): boolean {
  const sqliteError = findSqliteError(error);
  if (
    sqliteError === null ||
    getSqliteErrorCode(sqliteError) !== "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    return false;
  }

  const qualifiedColumns = args.columnNames
    .map((columnName) => `${args.tableName}.${columnName}`)
    .join(", ");
  return (
    sqliteError.message === `UNIQUE constraint failed: ${qualifiedColumns}` ||
    sqliteError.message.includes(args.indexName)
  );
}

export function isSqliteForeignKeyConstraint(error: Error): boolean {
  const sqliteError = findSqliteError(error) ?? error;
  return (
    getSqliteErrorCode(sqliteError) === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    sqliteError.message.includes("FOREIGN KEY constraint failed")
  );
}

export function isSqliteBusyError(error: Error): boolean {
  const code = getSqliteErrorCode(findSqliteError(error) ?? error);
  return code !== null && code.startsWith("SQLITE_BUSY");
}
