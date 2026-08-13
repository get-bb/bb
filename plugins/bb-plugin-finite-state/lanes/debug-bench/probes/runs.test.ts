import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { finishProbeRun, listBenchDevelopmentRuns, startProbeRun } from "./runs.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function database(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.transaction(() => { for (const migration of MIGRATIONS) db.exec(migration); })();
  return db;
}

describe("probe runs", () => {
  it("persists lifecycle fields and pages the frozen development-run projection", () => {
    const db = database();
    const scope = { projectId: "project-1", projectVersionId: "pv-1" };
    for (const [index, runId] of ["probe-2", "probe-1"].entries()) {
      startProbeRun(db, {
        ...scope, runId, scriptPath: `.fs/bench/probes/${runId}.py`, deviceIds: ["probe-rs:serial"],
        hypothesis: `hypothesis ${runId}`, startedAt: `2026-08-13T10:00:0${index}.000Z`,
      });
      finishProbeRun(db, scope, runId, index === 0 ? "confirmed" : "refuted", [`.fs-bench/${runId}/capture.csv`], `2026-08-13T10:01:0${index}.000Z`);
    }
    const first = listBenchDevelopmentRuns(db, {
      ...scope, pageSize: 1, cursor: null, kinds: ["probe"], statuses: ["succeeded"],
    });
    expect(first).toMatchObject({ total: 2, items: [{ runId: "probe-1", kind: "probe", status: "succeeded" }] });
    expect(first.cursor).toEqual(expect.any(String));
    const second = listBenchDevelopmentRuns(db, {
      ...scope, pageSize: 1, cursor: first.cursor, kinds: ["probe"], statuses: ["succeeded"],
    });
    expect(second).toMatchObject({ total: 2, items: [{ runId: "probe-2" }], cursor: null });
  });
});
