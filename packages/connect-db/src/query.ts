export async function first<Row>(
  rows: PromiseLike<readonly Row[]>,
): Promise<Row | undefined> {
  return (await rows)[0];
}

export function executedRows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null) return [];
  const rows: unknown = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}
