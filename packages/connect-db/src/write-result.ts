export function affectedRowCount(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  if ("rowCount" in result && typeof result.rowCount === "number") {
    return result.rowCount;
  }
  if ("affectedRows" in result && typeof result.affectedRows === "number") {
    return result.affectedRows;
  }
  return null;
}

export function rowsChanged(result: unknown): number {
  return affectedRowCount(result) ?? 0;
}
