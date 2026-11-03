const CONFLICT_TARGET = /\bon conflict \(([^)]*)\)/giu;
const QUALIFIED_COLUMN = /"[^"]+"\.("[^"]+")/gu;

export function sqliteToPg(sql: string): string {
  return sqliteToPgPlaceholders(
    sql.replace(
      CONFLICT_TARGET,
      (_match, columns: string) =>
        `on conflict (${columns.replace(QUALIFIED_COLUMN, "$1")})`,
    ),
  );
}

export function sqliteToPgPlaceholders(sql: string): string {
  let out = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote !== null) {
      out += char;
      if (char === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char === "?") {
      if (/\d/u.test(sql[i + 1] ?? "")) {
        throw new Error("numbered SQLite parameters are not portable");
      }
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

export type WriteKind = "insert" | "update" | "delete";

export interface StatementShape {
  kind: WriteKind | "read";
  table: string | null;
}

const WRITE_PATTERN = /^\s*(insert\s+into|update|delete\s+from)\s+"([^"]+)"/iu;

export function statementShape(sql: string): StatementShape {
  const match = WRITE_PATTERN.exec(sql);
  if (match === null) return { kind: "read", table: null };
  const verb = (match[1] ?? "").toLowerCase();
  const kind: WriteKind = verb.startsWith("insert")
    ? "insert"
    : verb.startsWith("update")
      ? "update"
      : "delete";
  return { kind, table: match[2] ?? null };
}
