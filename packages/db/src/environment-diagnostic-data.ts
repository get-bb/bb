import { providerEnvironmentDiagnosticDataSchema } from "@bb/domain";
import type { DbConnection } from "./connection.js";

export function serializeEnvironmentDiagnosticData(data: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new Error("Invalid provider environment diagnostic data");
  }
  const diagnostic = providerEnvironmentDiagnosticDataSchema.safeParse(payload);
  if (!diagnostic.success) {
    throw new Error("Invalid provider environment diagnostic data");
  }
  return JSON.stringify(diagnostic.data);
}

export function sanitizeEnvironmentDiagnosticSnapshot(
  sqlite: DbConnection["$client"],
  mode: "dry-run" | "apply" = "dry-run",
): number {
  const select = sqlite.prepare<[number], { rowid: number; data: string }>(
    "SELECT rowid, data FROM events WHERE type = 'provider.env-resolved' AND rowid > ? ORDER BY rowid LIMIT 256",
  );
  const update =
    mode === "apply"
      ? sqlite.prepare("UPDATE events SET data = ? WHERE rowid = ?")
      : undefined;
  const processRows = () => {
    let cursor = 0;
    let changed = 0;
    for (;;) {
      const rows = select.all(cursor);
      if (rows.length === 0) return changed;
      for (const { rowid, data } of rows) {
        const safe = serializeEnvironmentDiagnosticData(data);
        if (safe !== data) {
          update?.run(safe, rowid);
          changed += 1;
        }
        cursor = rowid;
      }
    }
  };

  if (mode === "dry-run") return sqlite.transaction(processRows)();
  sqlite.pragma("journal_mode = DELETE");
  sqlite.pragma("secure_delete = ON");
  const changed = sqlite.transaction(processRows).immediate();
  sqlite.exec("VACUUM");
  return changed;
}
