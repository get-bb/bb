import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  closeAutomationRun,
  createAutomation,
  createManualRun,
  listAutomationRuns,
  migrations,
  type Db,
} from "./data.js";
import { mapScriptResultToRun } from "./script-runner.js";
import { extractTerminalToken } from "./terminal-token.js";

function migrateByIndex(db: Db, statements: readonly string[]): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare<[], { id: number }>("SELECT id FROM _bb_migrations")
      .all()
      .map((row) => row.id),
  );
  const record = db.prepare(
    "INSERT INTO _bb_migrations (id, applied_at) VALUES (?, ?)",
  );
  db.transaction(() => {
    statements.forEach((statement, index) => {
      if (applied.has(index)) return;
      db.exec(statement);
      record.run(index, 1);
    });
  })();
}

function createMigratedDb(): Db {
  const db = new Database(":memory:");
  migrateByIndex(db, migrations);
  return db;
}

function createAgentAutomation(db: Db): void {
  createAutomation(db, {
    id: "auto_status",
    projectId: "proj_test",
    name: "Status",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "* * * * *",
      timezone: "UTC",
    },
    runMode: "agent",
    execution: {
      mode: "agent",
      prompt: "Run",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "auto",
      environment: { type: "project-default" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 1_000,
  });
}

describe("terminal token extraction", () => {
  it("extracts only a generic strict final non-empty line", () => {
    expect(extractTerminalToken("work\nTASK_COMPLETE\n\n")).toBe(
      "TASK_COMPLETE",
    );
    expect(extractTerminalToken("work\r\nDOMAIN_42\r\n  \r\n")).toBe(
      "DOMAIN_42",
    );
    expect(extractTerminalToken("TASK_COMPLETE\nmore output")).toBeNull();
    expect(extractTerminalToken("work\ntask_complete")).toBeNull();
    expect(extractTerminalToken("work\nTASK-COMPLETE")).toBeNull();
    expect(extractTerminalToken(`work\n${"A".repeat(129)}`)).toBeNull();
    expect(extractTerminalToken(null)).toBeNull();
  });

  it("stores a token only for successful script transport", () => {
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: "detail\nTASK_COMPLETE\n",
        timedOut: false,
      }),
    ).toMatchObject({ status: "succeeded", terminalToken: "TASK_COMPLETE" });
    expect(
      mapScriptResultToRun({
        exitCode: 2,
        output: "detail\nTASK_COMPLETE\n",
        timedOut: false,
      }),
    ).toMatchObject({ status: "failed", terminalToken: null });
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: "detail\nTASK_COMPLETE\n",
        timedOut: true,
      }),
    ).toMatchObject({ status: "failed", terminalToken: null });
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: 'detail\n{"wakeAgent": false}\n',
        timedOut: false,
      }),
    ).toMatchObject({ status: "skipped", terminalToken: null });
  });
});

describe("terminal token storage", () => {
  it("suppresses non-success tokens and keeps running and legacy values null", () => {
    const db = createMigratedDb();
    createAgentAutomation(db);
    const running = createManualRun(db, {
      automationId: "auto_status",
      runMode: "agent",
      now: 1,
    }).run;
    const failed = createManualRun(db, {
      automationId: "auto_status",
      runMode: "agent",
      now: 2,
    }).run;
    const skipped = createManualRun(db, {
      automationId: "auto_status",
      runMode: "agent",
      now: 3,
    }).run;

    closeAutomationRun(db, {
      runId: failed.id,
      status: "failed",
      terminalToken: "TASK_COMPLETE",
      now: 4,
    });
    closeAutomationRun(db, {
      runId: skipped.id,
      status: "skipped",
      terminalToken: "TASK_COMPLETE",
      now: 5,
    });

    expect(
      listAutomationRuns(db, { automationId: "auto_status", limit: 10 }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: running.id, terminalToken: null }),
        expect.objectContaining({ id: failed.id, terminalToken: null }),
        expect.objectContaining({ id: skipped.id, terminalToken: null }),
      ]),
    );
  });

  it("makes close idempotent and preserves the first final state", () => {
    const db = createMigratedDb();
    createAgentAutomation(db);
    const run = createManualRun(db, {
      automationId: "auto_status",
      runMode: "agent",
      now: 1,
    }).run;

    const first = closeAutomationRun(db, {
      runId: run.id,
      status: "succeeded",
      terminalToken: "TASK_COMPLETE",
      now: 2,
    });
    const duplicate = closeAutomationRun(db, {
      runId: run.id,
      status: "failed",
      error: "late failure",
      terminalToken: "LATE_FAILURE",
      now: 3,
    });

    expect(first?.run).toMatchObject({
      status: "succeeded",
      terminalToken: "TASK_COMPLETE",
      finishedAt: 2,
    });
    expect(duplicate?.run).toEqual(first?.run);
  });
});
