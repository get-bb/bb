import Database from "better-sqlite3";
import type { CpuClock } from "./cpu-clock.js";

const CALIBRATION_ROWS = 20_000;
const CALIBRATION_ATTEMPTS = 15;

export const REFERENCE_CALIBRATION_MS = 6.5;

export function measureCalibrationMs(clock: CpuClock): number {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(
      "CREATE TABLE calibration (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL)",
    );
    sqlite.exec("CREATE INDEX calibration_kind_idx ON calibration (kind)");
    const insert = sqlite.prepare(
      "INSERT INTO calibration (kind, data) VALUES (?, ?)",
    );
    sqlite.transaction(() => {
      for (let index = 0; index < CALIBRATION_ROWS; index += 1) {
        insert.run(
          `kind-${index % 8}`,
          JSON.stringify({
            requestId: `request-${index}`,
            text: "calibration ".repeat(20),
          }),
        );
      }
    })();
    const scan = sqlite.prepare(
      "SELECT count(*) AS count FROM calibration WHERE kind = ? AND json_extract(data, '$.requestId') LIKE ?",
    );
    let fastest = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < CALIBRATION_ATTEMPTS; attempt += 1) {
      const started = clock.nowMs();
      for (let kind = 0; kind < 8; kind += 1) {
        scan.get(`kind-${kind}`, "%9");
      }
      fastest = Math.min(fastest, clock.nowMs() - started);
    }
    return fastest;
  } finally {
    sqlite.close();
  }
}
