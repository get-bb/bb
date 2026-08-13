import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import {
  attachProbeRunArtifact,
  finishProbeRun,
  listBenchDevelopmentRuns,
  startProbeRun,
} from "./runs.js";

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
      finishProbeRun(db, scope, runId, index === 0 ? "confirmed" : "refuted", [`.fs-bench/probe-runs/${runId}/capture.csv`], `2026-08-13T10:01:0${index}.000Z`);
    }
    startProbeRun(db, {
      ...scope,
      runId: "probe-inconclusive",
      scriptPath: ".fs/bench/probes/probe-inconclusive.py",
      deviceIds: ["probe-rs:serial"],
      hypothesis: "timeout fixture",
      startedAt: "2026-08-13T10:00:02.000Z",
    });
    finishProbeRun(
      db,
      scope,
      "probe-inconclusive",
      "inconclusive",
      [".fs-bench/probe-runs/probe-inconclusive/runtime-error.txt"],
      "2026-08-13T10:01:02.000Z",
    );
    const first = listBenchDevelopmentRuns(db, {
      ...scope, pageSize: 1, cursor: null, kinds: ["probe"], statuses: ["succeeded"],
    });
    expect(first).toMatchObject({ total: 2, items: [{ runId: "probe-1", kind: "probe", status: "succeeded" }] });
    expect(first.cursor).toEqual(expect.any(String));
    const second = listBenchDevelopmentRuns(db, {
      ...scope, pageSize: 1, cursor: first.cursor, kinds: ["probe"], statuses: ["succeeded"],
    });
    expect(second).toMatchObject({ total: 2, items: [{ runId: "probe-2" }], cursor: null });
    expect(listBenchDevelopmentRuns(db, {
      ...scope,
      pageSize: 10,
      cursor: null,
      kinds: ["probe"],
      statuses: ["failed"],
    })).toMatchObject({
      total: 1,
      items: [{ runId: "probe-inconclusive", status: "failed" }],
    });
  });

  it("preserves artifacts attached by instrument producers when the run finishes", () => {
    const db = database();
    const scope = { projectId: "project-1", projectVersionId: "pv-1" };
    startProbeRun(db, {
      ...scope,
      runId: "probe-with-instrument",
      scriptPath: ".fs/bench/probes/capture.py",
      deviceIds: ["probe-rs:serial"],
      hypothesis: "capture aligns with the fault",
      startedAt: "2026-08-13T10:00:00.000Z",
    });
    const instrumentPath = ".fs-bench/probe-runs/probe-with-instrument/logic/capture.json";
    expect(attachProbeRunArtifact(db, scope, "probe-with-instrument", instrumentPath)).toBe(true);
    expect(attachProbeRunArtifact(db, scope, "probe-with-instrument", instrumentPath)).toBe(false);

    const record = finishProbeRun(
      db,
      scope,
      "probe-with-instrument",
      "confirmed",
      [".fs-bench/probe-runs/probe-with-instrument/runtime.csv"],
      "2026-08-13T10:01:00.000Z",
    );

    expect(record.artifacts).toEqual([
      instrumentPath,
      ".fs-bench/probe-runs/probe-with-instrument/runtime.csv",
    ]);
    expect(JSON.parse(db.prepare("SELECT artifacts FROM probe_run WHERE run_id = ?").pluck().get("probe-with-instrument") as string))
      .toEqual(record.artifacts);
  });

  it("accepts an in-flight legacy authoring cursor without a kind", () => {
    const db = database();
    const scope = { projectId: "project-1", projectVersionId: "pv-1" };
    const legacyCursor = Buffer.from(JSON.stringify({
      startedAt: "2026-08-13T10:00:00.000Z",
      runId: "build-1",
    }), "utf8").toString("base64url");
    expect(() => listBenchDevelopmentRuns(db, {
      ...scope,
      pageSize: 10,
      cursor: legacyCursor,
    })).not.toThrow();
  });
});
