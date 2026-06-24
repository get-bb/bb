interface SqliteUniqueConstraintColumnsArgs {
  columnNames: readonly string[];
  indexName: string;
  tableName: string;
}

function getSqliteErrorCode(error: Error): string | null {
  const code = "code" in error ? error.code : null;
  return typeof code === "string" ? code : null;
}

function isSqliteUniqueConstraintError(error: Error): boolean {
  return getSqliteErrorCode(error) === "SQLITE_CONSTRAINT_UNIQUE";
}

export function isSqliteUniqueConstraintOnColumns(
  error: Error,
  args: SqliteUniqueConstraintColumnsArgs,
): boolean {
  if (!isSqliteUniqueConstraintError(error)) {
    return false;
  }

  const qualifiedColumns = args.columnNames
    .map((columnName) => `${args.tableName}.${columnName}`)
    .join(", ");
  return (
    error.message === `UNIQUE constraint failed: ${qualifiedColumns}` ||
    error.message.includes(args.indexName)
  );
}

export function isSqliteForeignKeyConstraint(error: Error): boolean {
  return (
    getSqliteErrorCode(error) === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    error.message.includes("FOREIGN KEY constraint failed")
  );
}
