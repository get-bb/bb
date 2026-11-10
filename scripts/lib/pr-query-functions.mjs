const DATA_FILE = /^packages\/db\/src\/data\/[^/]+\.ts$/u;

export function untestedChangedQueryFunctions({
  changedFiles,
  queryFunctions,
  executedRows,
}) {
  const changed = new Set(changedFiles.filter((file) => DATA_FILE.test(file)));
  const executed = new Set(
    executedRows.flatMap((row) =>
      row.kind === "executed" ? row.functions : [],
    ),
  );
  return queryFunctions.filter(
    (name) => changed.has(name.split("#")[0]) && !executed.has(name),
  );
}
