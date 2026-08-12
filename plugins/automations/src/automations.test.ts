import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
import {
  bbBinaryCandidates,
  isWakeAgentSuppressed,
  mapScriptResultToRun,
  scriptPathEnv,
} from "./script-runner.js";
import { sweepDueAutomations } from "./sweep.js";
import { createAutomationService } from "./service.js";
import { automationScriptDir } from "./script-files.js";

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
      permissionMode: "accept-edits",
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
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt,
  });
}

function oneShotTrigger() {
  return { triggerType: "once" as const, runAt: Date.now() + 60_000 };
}

function createAutomationServiceBb() {
  return {
    sdk: {
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          kind: "standard" as const,
          name: "Test Project",
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [],
        }),
        list: async () => [],
      },
      providers: {
        list: async () =>
          [
            {
              id: "codex",
              capabilities: {
                supportedPermissionModes: ["accept-edits", "auto", "full"],
              },
            },
          ] as never,
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
}

describe("data migrations", () => {
  it("migrates stored agent automations to current permission modes", () => {
    const db = createTestDb();
    const insert = db.prepare(
      `INSERT INTO automations (
         id, project_id, name, enabled, trigger_type, trigger_config,
         run_mode, execution, origin, created_at, updated_at
       ) VALUES (?, 'proj_test', ?, 1, 'schedule', ?, 'agent', ?, 'human', 1, 1)`,
    );
    const trigger = JSON.stringify({
      triggerType: "schedule",
      cron: "* * * * *",
      timezone: "UTC",
    });
    for (const mode of ["workspace-write", "readonly"]) {
      insert.run(
        `auto_${mode}`,
        mode,
        trigger,
        JSON.stringify({
          mode: "agent",
          prompt: "legacy",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: mode,
          environment: { type: "project-default" },
        }),
      );
    }

    db.exec(migrations[1] ?? "");

    const modes = db
      .prepare<[], { permissionMode: string }>(
        `SELECT json_extract(execution, '$.permissionMode') AS permissionMode
         FROM automations ORDER BY id`,
      )
      .all()
      .map((row) => row.permissionMode);
    expect(modes).toEqual(["accept-edits", "accept-edits"]);
  });
});

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
    expect(
      listAutomationRuns(db, { automationId: "auto_test", limit: 10 }),
    ).toHaveLength(1);
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
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(getAutomation(db, automation.id)?.runCount).toBe(0);
    expect(
      listAutomationRuns(db, { automationId: automation.id, limit: 10 }),
    ).toHaveLength(0);
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
        providers: {
          list: async () => [],
        },
        threadSections: {
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
          permissionMode: "accept-edits",
          environment: { type: "project-default" },
        },
        origin: "human",
      }),
    ).rejects.toThrow("Project proj_missing is not available");
    expect(listAutomationsForProject(db, "proj_missing")).toHaveLength(0);
  });

  it("removes a stored script directory after switching to agent execution", async () => {
    const db = createTestDb();
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-service-"));
    const automation = createAutomation(db, {
      id: "auto_script_to_agent",
      projectId: "proj_test",
      name: "Script to agent",
      enabled: true,
      trigger: oneShotTrigger(),
      runMode: "script",
      execution: {
        mode: "script",
        scriptFile: "old.sh",
        timeoutMs: 120_000,
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: Date.now() + 60_000,
    });
    const scriptDir = automationScriptDir(pluginDataDir, automation.id);
    await mkdir(scriptDir, { recursive: true });
    await writeFile(join(scriptDir, "old.sh"), "echo old\n");
    const service = createAutomationService({
      bb: createAutomationServiceBb(),
      db,
      pluginDataDir,
      serverUrl: "http://127.0.0.1:38886",
    });

    try {
      await service.update({
        projectId: "proj_test",
        automationId: automation.id,
        execution: {
          mode: "agent",
          prompt: "do it",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "accept-edits",
          environment: { type: "project-default" },
        },
      });

      await expect(access(scriptDir)).rejects.toThrow();
    } finally {
      await rm(pluginDataDir, { recursive: true, force: true });
    }
  });

  it("removes only a superseded stored script file after a filename change", async () => {
    const db = createTestDb();
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-service-"));
    const automation = createAutomation(db, {
      id: "auto_script_rename",
      projectId: "proj_test",
      name: "Script rename",
      enabled: true,
      trigger: oneShotTrigger(),
      runMode: "script",
      execution: {
        mode: "script",
        scriptFile: "old.sh",
        timeoutMs: 120_000,
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: Date.now() + 60_000,
    });
    const scriptDir = automationScriptDir(pluginDataDir, automation.id);
    await mkdir(scriptDir, { recursive: true });
    await writeFile(join(scriptDir, "old.sh"), "echo old\n");
    await writeFile(join(scriptDir, "keep.txt"), "keep\n");
    const service = createAutomationService({
      bb: createAutomationServiceBb(),
      db,
      pluginDataDir,
      serverUrl: "http://127.0.0.1:38886",
    });

    try {
      await service.update({
        projectId: "proj_test",
        automationId: automation.id,
        execution: {
          mode: "script",
          script: "echo new\n",
          scriptFile: "new.sh",
          timeoutMs: 120_000,
        },
      });

      await expect(access(join(scriptDir, "old.sh"))).rejects.toThrow();
      await expect(readFile(join(scriptDir, "new.sh"), "utf8")).resolves.toBe(
        "echo new\n",
      );
      await expect(readFile(join(scriptDir, "keep.txt"), "utf8")).resolves.toBe(
        "keep\n",
      );
    } finally {
      await rm(pluginDataDir, { recursive: true, force: true });
    }
  });

  it("removes a newly staged filename when the database update fails", async () => {
    const db = createTestDb();
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-service-"));
    const automation = createAutomation(db, {
      id: "auto_script_rollback",
      projectId: "proj_test",
      name: "Script rollback",
      enabled: true,
      trigger: oneShotTrigger(),
      runMode: "script",
      execution: {
        mode: "script",
        scriptFile: "old.sh",
        timeoutMs: 120_000,
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: Date.now() + 60_000,
    });
    const scriptDir = automationScriptDir(pluginDataDir, automation.id);
    await mkdir(scriptDir, { recursive: true });
    await writeFile(join(scriptDir, "old.sh"), "echo old\n");
    db.exec(`CREATE TRIGGER reject_automation_update
      BEFORE UPDATE ON automations
      BEGIN
        SELECT RAISE(ABORT, 'update rejected');
      END`);
    const service = createAutomationService({
      bb: createAutomationServiceBb(),
      db,
      pluginDataDir,
      serverUrl: "http://127.0.0.1:38886",
    });

    try {
      await expect(
        service.update({
          projectId: "proj_test",
          automationId: automation.id,
          execution: {
            mode: "script",
            script: "echo new\n",
            scriptFile: "new.sh",
            timeoutMs: 120_000,
          },
        }),
      ).rejects.toThrow("update rejected");
      await expect(readFile(join(scriptDir, "old.sh"), "utf8")).resolves.toBe(
        "echo old\n",
      );
      await expect(access(join(scriptDir, "new.sh"))).rejects.toThrow();
    } finally {
      await rm(pluginDataDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite the active filename when the database update fails", async () => {
    const db = createTestDb();
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-service-"));
    const automation = createAutomation(db, {
      id: "auto_script_same_name_rollback",
      projectId: "proj_test",
      name: "Script same-name rollback",
      enabled: true,
      trigger: oneShotTrigger(),
      runMode: "script",
      execution: {
        mode: "script",
        scriptFile: "old.sh",
        timeoutMs: 120_000,
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: Date.now() + 60_000,
    });
    const scriptDir = automationScriptDir(pluginDataDir, automation.id);
    await mkdir(scriptDir, { recursive: true });
    await writeFile(join(scriptDir, "old.sh"), "echo old\n");
    db.exec(`CREATE TRIGGER reject_automation_update
      BEFORE UPDATE ON automations
      BEGIN
        SELECT RAISE(ABORT, 'update rejected');
      END`);
    const service = createAutomationService({
      bb: createAutomationServiceBb(),
      db,
      pluginDataDir,
      serverUrl: "http://127.0.0.1:38886",
    });

    try {
      await expect(
        service.update({
          projectId: "proj_test",
          automationId: automation.id,
          execution: {
            mode: "script",
            script: "echo replacement\n",
            scriptFile: "old.sh",
            timeoutMs: 120_000,
          },
        }),
      ).rejects.toThrow("update rejected");
      await expect(readFile(join(scriptDir, "old.sh"), "utf8")).resolves.toBe(
        "echo old\n",
      );
      await expect(readdir(scriptDir)).resolves.toEqual(["old.sh"]);
    } finally {
      await rm(pluginDataDir, { recursive: true, force: true });
    }
  });
});

describe("bb CLI injection for script runs", () => {
  it("prefers the env pointers over PATH and macOS install locations", () => {
    expect(
      bbBinaryCandidates({
        BB_CLI: "/daemon/bundle/bb",
        BB_CLI_DIR: "/other/dir",
      })[0],
    ).toBe("/daemon/bundle/bb");
    // The server process gets BB_CLI_DIR, not BB_CLI, from the launcher.
    expect(bbBinaryCandidates({ BB_CLI_DIR: "/daemon/bundle" })[0]).toBe(
      "/daemon/bundle/bb",
    );
  });

  it("expands PATH itself so every candidate is absolute", () => {
    // The resolved value is handed to scripts as BB_CLI, which is documented
    // as absolute; a bare "bb" would re-resolve if a script edits PATH.
    expect(bbBinaryCandidates({ PATH: "/usr/bin:/opt/tools" })).toEqual([
      "/usr/bin/bb",
      "/opt/tools/bb",
      "/opt/homebrew/bin/bb",
      "/usr/local/bin/bb",
    ]);
    expect(
      bbBinaryCandidates({ PATH: "/usr/bin" }).every((c) => c.startsWith("/")),
    ).toBe(true);
  });

  it("drops entries that would resolve against the wrong directory", () => {
    // An empty PATH entry means the cwd, which for a script run is the
    // automation scripts directory — a `bb` dropped there is not the CLI.
    expect(bbBinaryCandidates({ PATH: "/usr/bin::/bin" })).toEqual([
      "/usr/bin/bb",
      "/bin/bb",
      "/opt/homebrew/bin/bb",
      "/usr/local/bin/bb",
    ]);
    // Blank or relative env pointers are skipped, not resolved against cwd.
    expect(
      bbBinaryCandidates({ BB_CLI: "  ", BB_CLI_DIR: "", PATH: "" }),
    ).toEqual(["/opt/homebrew/bin/bb", "/usr/local/bin/bb"]);
    expect(
      bbBinaryCandidates({ BB_CLI: "./bb", BB_CLI_DIR: "rel/dir", PATH: "" }),
    ).toEqual(["/opt/homebrew/bin/bb", "/usr/local/bin/bb"]);
  });

  it("prepends bb's directory to PATH only when it is absolute", () => {
    expect(scriptPathEnv("/daemon/bundle/bb", "/usr/bin:/bin")).toBe(
      "/daemon/bundle:/usr/bin:/bin",
    );
    // Guard against a relative path ever reaching here: dirname() would be "."
    // and would put the scripts directory ahead of the system PATH.
    expect(scriptPathEnv("bb", "/usr/bin:/bin")).toBe("/usr/bin:/bin");
    expect(scriptPathEnv(null, "/usr/bin:/bin")).toBe("/usr/bin:/bin");
    expect(scriptPathEnv("/daemon/bundle/bb", undefined)).toBe(
      "/daemon/bundle",
    );
  });
});

describe("script wake gate", () => {
  it("suppresses only a trailing wakeAgent false object", () => {
    expect(isWakeAgentSuppressed('hello\n{"wakeAgent": false}\n')).toBe(true);
    expect(isWakeAgentSuppressed('{"wakeAgent": true}\n')).toBe(false);
    expect(isWakeAgentSuppressed("not json\n")).toBe(false);
  });

  it("maps silent successful scripts to skipped runs", () => {
    expect(
      mapScriptResultToRun({ exitCode: 0, output: "", timedOut: false }),
    ).toMatchObject({ status: "skipped", skipReason: "empty output" });
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: 'nothing\n{"wakeAgent": false}',
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
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
    });
    expect(
      listAutomationRuns(db, { automationId: "auto_legacy", limit: 10 }),
    ).toHaveLength(1);
    expect(kv.get("legacy-import-done")).toBe(true);
  });
});
