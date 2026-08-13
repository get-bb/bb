import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../../lib/store/schema.js";
import {
  buildDigestForRun,
  validateEventMarks,
  windowBetweenMarks,
} from "./correlate.js";

const databases: Database.Database[] = [];

function createConnection(path = ":memory:"): Database.Database {
  const db = new Database(path);
  databases.push(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("power measurement correlation", () => {
  it("joins the flashed digest from a real build_run row and returns null honestly", () => {
    const db = createConnection();
    migrate(db);
    const insert = db.prepare(
      `INSERT INTO build_run
        (project_id, project_version_id, run_id, kind, target, toolchain,
         status, artifact, digest, log_path, started_at)
       VALUES (?, ?, ?, 'flash', 'board', 'gcc', 'completed', ?, ?, ?, ?)`,
    );
    insert.run("project-1", "version-1", "flash-1", "firmware.bin", "sha256:exact-image", null,
      "2026-08-13T20:00:00.000Z");
    insert.run("project-1", "version-1", "flash-2", "firmware.bin", null, null,
      "2026-08-13T20:01:00.000Z");
    expect(buildDigestForRun(db, {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "flash-1",
    })).toBe("sha256:exact-image");
    expect(buildDigestForRun(db, {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "flash-2",
    })).toBeNull();
    expect(() => buildDigestForRun(db, {
      projectId: "project-1",
      projectVersionId: "version-1",
      runId: "missing",
    })).toThrow("BUILD_RUN_NOT_FOUND");
  });

  it("round-trips manual marks and selects the intended ordered window", () => {
    const marks = validateEventMarks([
      { atMs: 10, label: "boot_done", source: "serial" },
      { atMs: 20, label: "manual_check", source: "manual" },
      { atMs: 30, label: "radio_on", source: "gdb" },
    ]);
    expect(marks[1]).toEqual({ atMs: 20, label: "manual_check", source: "manual" });
    expect(windowBetweenMarks(marks, "boot_done", "radio_on"))
      .toEqual({ fromMs: 10, toMs: 30 });
  });

  it("rejects unordered or duplicate event marks", () => {
    expect(() => validateEventMarks([
      { atMs: 20, label: "second", source: "serial" },
      { atMs: 10, label: "first", source: "gdb" },
    ])).toThrow("INVALID_MARKS");
    expect(() => validateEventMarks([
      { atMs: 10, label: "same", source: "serial" },
      { atMs: 20, label: "same", source: "manual" },
    ])).toThrow("INVALID_MARKS");
  });
});
