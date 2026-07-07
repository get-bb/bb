import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  claimAutomationScheduledRun,
  closeAutomationRun,
  createAutomation,
  createManualRun,
  getAutomation,
  listAutomationsForProject,
  listAutomationRuns,
  migrations,
  restoreAutomationAfterFailedRun,
  type Db,
} from "./data.js";
import { ingestLegacyImport } from "./legacy-import.js";
import {
  computeInitialNextRunAt,
  computeNextScheduledTime,
  validateOnceDefinition,
} from "./schedule-helpers.js";
import { isWakeAgentSuppressed, mapScriptResultToRun } from "./script-runner.js";
import { sweepDueAutomations } from "./sweep.js";
import { createAutomationService } from "./service.js";

function createTestDb(): Db {
  const db = new Database(":memory:");
  db.exec(migrations[0] ?? "");
  return db;
}

function createScheduledAutomation(
  db: Db,
  nextRunAt: number,
  id = "auto_test",
) {
  return createAutomation(db, {
    id,
    projectId: "proj_test",
    name: "Test",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "* * * * *",
      timezone: "UTC",
    },
    runMode: "agent",
    execution: {
      mode: "agent",
      prompt: "do it",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
      environment: { type: "project-default" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt,
  });
}

function createOnceAutomation(db: Db, nextRunAt: number, id = "auto_once") {
  return createAutomation(db, {
    id,
    projectId: "proj_test",
    name: "Once",
    enabled: true,
    trigger: {
      triggerType: "once",
      runAt: nextRunAt,
    },
    runMode: "agent",
    execution: {
      mode: "agent",
      prompt: "do it once",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
      environment: { type: "project-default" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt,
  });
}

describe("schedule helpers", () => {
  it("computes cron next runs with timezone", () => {
    const next = computeNextScheduledTime({
      cron: "30 9 * * *",
      timezone: "America/New_York",
      now: Date.parse("2026-01-01T13:00:00.000Z"),
    });
    expect(new Date(next).toISOString()).toBe("2026-01-01T14:30:00.000Z");
  });

  it("validates and computes once triggers", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(() => validateOnceDefinition({ runAt: now, now })).toThrow(
      "One-shot run time must be in the future",
    );
    expect(
      computeInitialNextRunAt({
        trigger: { triggerType: "once", runAt: now + 1_000 },
        enabled: true,
        now,
      }),
    ).toBe(now + 1_000);
    expect(
      computeInitialNextRunAt({
        trigger: { triggerType: "once", runAt: now + 1_000 },
        enabled: false,
        now,
      }),
    ).toBeNull();
  });
});

describe("automation data access", () => {
  it("CAS claims a scheduled run only once", () => {
    const db = createTestDb();
    createScheduledAutomation(db, 1000);
    const first = claimAutomationScheduledRun(db, {
      automationId: "auto_test",
      expectedNextRunAt: 1000,
      newNextRunAt: 2000,
      now: 1000,
    });
    const second = claimAutomationScheduledRun(db, {
      automationId: "auto_test",
      expectedNextRunAt: 1000,
      newNextRunAt: 2000,
      now: 1000,
    });
    expect(first.advanced).toBe(true);
    expect(second.advanced).toBe(false);
    expect(listAutomationRuns(db, { automationId: "auto_test", limit: 10 })).toHaveLength(1);
  });

  it("rolls schedule state back after dispatch failure", () => {
    const db = createTestDb();
    const automation = createScheduledAutomation(db, 1000);
    const claim = claimAutomationScheduledRun(db, {
      automationId: automation.id,
      expectedNextRunAt: 1000,
      newNextRunAt: 2000,
      now: 1000,
    });
    if (!claim.advanced) throw new Error("claim failed");
    restoreAutomationAfterFailedRun(db, {
      automationId: automation.id,
      runId: claim.run.id,
      triggerType: "schedule",
      advancedNextRunAt: 2000,
      restoredNextRunAt: 1000,
      expectedRunCount: 1,
      error: "dispatch failed",
      now: 1001,
    });
    const restored = getAutomation(db, automation.id);
    expect(restored?.nextRunAt).toBe(1000);
    expect(restored?.runCount).toBe(0);
    expect(restored?.lastRunStatus).toBe("failed");
  });

  it("does not re-arm one-shot automations after dispatch failure", () => {
    const db = createTestDb();
    const automation = createOnceAutomation(db, 1000);
    const claim = claimAutomationScheduledRun(db, {
      automationId: automation.id,
      expectedNextRunAt: 1000,
      newNextRunAt: null,
      now: 1000,
    });
    if (!claim.advanced) throw new Error("claim failed");
    restoreAutomationAfterFailedRun(db, {
      automationId: automation.id,
      runId: claim.run.id,
      triggerType: "once",
      advancedNextRunAt: null,
      restoredNextRunAt: 1000,
      expectedRunCount: 1,
      error: "dispatch failed",
      now: 1001,
    });
    const restored = getAutomation(db, automation.id);
    expect(restored?.enabled).toBe(false);
    expect(restored?.nextRunAt).toBeNull();
    expect(restored?.runCount).toBe(1);
    expect(restored?.lastRunStatus).toBe("failed");
  });

  it("does not claim due agent automations when no host is connected", async () => {
    const db = createTestDb();
    const automation = createScheduledAutomation(db, 1000);
    const bb = {
      sdk: {
        hosts: {
          list: async () => [
            {
              id: "host_test",
              name: "host",
              type: "persistent",
              status: "disconnected",
              lastSeenAt: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        threads: {
          get: async () => {
            throw new Error("not expected");
          },
          send: async () => {
            throw new Error("not expected");
          },
          spawn: async () => {
            throw new Error("not expected");
          },
        },
      },
      realtime: { publish: () => undefined },
      log: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    };

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      allowScriptRuns: true,
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(getAutomation(db, automation.id)?.runCount).toBe(0);
    expect(listAutomationRuns(db, { automationId: automation.id, limit: 10 })).toHaveLength(0);
  });

  it("dedupes manual runs by idempotency key", () => {
    const db = createTestDb();
    createScheduledAutomation(db, 1000);
    const first = createManualRun(db, {
      automationId: "auto_test",
      runMode: "agent",
      idempotencyKey: "same",
      now: 2000,
    });
    const second = createManualRun(db, {
      automationId: "auto_test",
      runMode: "agent",
      idempotencyKey: "same",
      now: 3000,
    });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.run.id).toBe(first.run.id);
  });

  it("records skipped script close state", () => {
    const db = createTestDb();
    createScheduledAutomation(db, 1000);
    const run = createManualRun(db, {
      automationId: "auto_test",
      runMode: "script",
      now: 1000,
    }).run;
    closeAutomationRun(db, {
      runId: run.id,
      status: "skipped",
      skipReason: "empty output",
      exitCode: 0,
      now: 1001,
    });
    const [closed] = listAutomationRuns(db, {
      automationId: "auto_test",
      limit: 1,
    });
    expect(closed?.status).toBe("skipped");
    expect(closed?.skipReason).toBe("empty output");
  });
});

describe("automation service", () => {
  it("validates project availability before creating an automation", async () => {
    const db = createTestDb();
    const bb = {
      sdk: {
        projects: {
          get: async () => {
            throw new Error("Project not found");
          },
          list: async () => [],
        },
        threads: {
          get: async () => {
            throw new Error("not expected");
          },
          send: async () => {
            throw new Error("not expected");
          },
          spawn: async () => {
            throw new Error("not expected");
          },
        },
      },
      realtime: { publish: () => undefined },
      log: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    };
    const service = createAutomationService({
      bb,
      db,
      pluginDataDir: "/tmp",
      getAllowScriptRuns: async () => true,
      serverUrl: "http://127.0.0.1:38886",
    });

    await expect(
      service.create({
        projectId: "proj_missing",
        name: "Missing project",
        enabled: true,
        trigger: { triggerType: "once", runAt: Date.now() + 60_000 },
        execution: {
          mode: "agent",
          prompt: "hello",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
          environment: { type: "project-default" },
        },
        origin: "human",
      }),
    ).rejects.toThrow("Project proj_missing is not available");
    expect(listAutomationsForProject(db, "proj_missing")).toHaveLength(0);
  });
});

describe("script wake gate", () => {
  it("suppresses only a trailing wakeAgent false object", () => {
    expect(isWakeAgentSuppressed("hello\n{\"wakeAgent\": false}\n")).toBe(true);
    expect(isWakeAgentSuppressed("{\"wakeAgent\": true}\n")).toBe(false);
    expect(isWakeAgentSuppressed("not json\n")).toBe(false);
  });

  it("maps silent successful scripts to skipped runs", () => {
    expect(
      mapScriptResultToRun({ exitCode: 0, output: "", timedOut: false }),
    ).toMatchObject({ status: "skipped", skipReason: "empty output" });
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: "nothing\n{\"wakeAgent\": false}",
        timedOut: false,
      }),
    ).toMatchObject({ status: "skipped", skipReason: "wakeAgent false" });
    expect(
      mapScriptResultToRun({ exitCode: 2, output: "bad", timedOut: false }),
    ).toMatchObject({ status: "failed", error: "Script exited with code 2" });
  });
});

describe("legacy import", () => {
  it("ingests legacy rows, moves environment into agent execution, and imports scripts once", async () => {
    const db = createTestDb();
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-plugin-"));
    await mkdir(join(pluginDataDir, "import"), { recursive: true });
    await writeFile(
      join(pluginDataDir, "import", "legacy-automations.json"),
      JSON.stringify({
        automations: [
          {
            id: "auto_legacy",
            projectId: "proj_test",
            targetThreadId: null,
            name: "Legacy",
            enabled: true,
            triggerType: "schedule",
            triggerConfig: JSON.stringify({
              triggerType: "schedule",
              cron: "* * * * *",
              timezone: "UTC",
            }),
            runMode: "agent",
            execution: JSON.stringify({
              mode: "agent",
              prompt: "legacy",
              providerId: "codex",
              model: "gpt-5",
              permissionMode: "readonly",
            }),
            environment: JSON.stringify({ type: "project-default" }),
            autoArchive: false,
            origin: "human",
            createdByThreadId: null,
            nextRunAt: 1000,
            lastRunAt: null,
            runCount: 1,
            lastRunStatus: "succeeded",
            lastRunThreadId: "thr_legacy",
            lastError: null,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        runs: [
          {
            id: "arun_legacy",
            automationId: "auto_legacy",
            runMode: "agent",
            threadId: "thr_legacy",
            status: "succeeded",
            trigger: "schedule",
            skipReason: null,
            error: null,
            output: null,
            exitCode: null,
            idempotencyKey: null,
            scheduledFor: 1000,
            startedAt: 1000,
            finishedAt: 1001,
          },
        ],
        scripts: {
          auto_legacy: { fileName: "script.sh", content: "echo ok\n" },
        },
      }),
    );
    const kv = new Map<string, unknown>();
    const bb = {
      storage: {
        kv: {
          get: async <T>(key: string) => kv.get(key) as T | undefined,
          set: async (key: string, value: unknown) => {
            kv.set(key, value);
          },
        },
      },
      log: { info: () => undefined },
    };

    await ingestLegacyImport({ bb, db, pluginDataDir });
    await ingestLegacyImport({ bb, db, pluginDataDir });

    const imported = getAutomation(db, "auto_legacy");
    expect(imported).not.toBeNull();
    expect(JSON.parse(imported?.execution ?? "{}")).toMatchObject({
      mode: "agent",
      environment: { type: "project-default" },
    });
    expect(
      listAutomationRuns(db, { automationId: "auto_legacy", limit: 10 }),
    ).toHaveLength(1);
    expect(kv.get("legacy-import-done")).toBe(true);
  });
});
