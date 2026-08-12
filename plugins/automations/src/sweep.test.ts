import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  createAutomation,
  getAutomation,
  listAutomationRuns,
  migrations,
  type Db,
} from "./data.js";
import { sweepDueAutomations } from "./sweep.js";

function createTestDb(): Db {
  const db = new Database(":memory:");
  db.exec(migrations[0] ?? "");
  return db;
}

function createScheduledAgentAutomation(
  db: Db,
  nextRunAt: number,
  id = "auto_agent",
) {
  return createAutomation(db, {
    id,
    projectId: "proj_test",
    name: "Agent",
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

function createScheduledScriptAutomation(
  db: Db,
  nextRunAt: number,
  id = "auto_script",
) {
  return createAutomation(db, {
    id,
    projectId: "proj_test",
    name: "Script",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "* * * * *",
      timezone: "UTC",
    },
    runMode: "script",
    execution: {
      mode: "script",
      scriptFile: "run.sh",
      timeoutMs: 120_000,
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt,
  });
}

function createSweepHarness(
  hostsList: () => Promise<unknown> = async () => [],
) {
  const hostsListMock = vi.fn(hostsList);
  const warn = vi.fn();
  const bb = {
    sdk: {
      hosts: { list: hostsListMock },
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
      warn,
    },
  };
  return { bb, hostsListMock, warn };
}

describe("sweepDueAutomations host probe", () => {
  it("does not call hosts.list when the due batch is empty", async () => {
    const db = createTestDb();
    const { bb, hostsListMock } = createSweepHarness();

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(hostsListMock).not.toHaveBeenCalled();
  });

  it("does not call hosts.list when the due batch is script-only", async () => {
    const db = createTestDb();
    createScheduledScriptAutomation(db, 1000);
    const { bb, hostsListMock } = createSweepHarness();

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(hostsListMock).not.toHaveBeenCalled();
    expect(getAutomation(db, "auto_script")?.runCount).toBe(1);
    expect(
      listAutomationRuns(db, { automationId: "auto_script", limit: 10 }),
    ).toHaveLength(1);
  });

  it("treats hosts.list HTTP 404 as fail-closed without warning", async () => {
    const db = createTestDb();
    createScheduledAgentAutomation(db, 1000);
    const notFound = Object.assign(new Error("HTTP 404: Not found"), {
      status: 404,
      code: "not_found",
    });
    const { bb, hostsListMock, warn } = createSweepHarness(async () => {
      throw notFound;
    });

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(hostsListMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(getAutomation(db, "auto_agent")?.runCount).toBe(0);
    expect(
      listAutomationRuns(db, { automationId: "auto_agent", limit: 10 }),
    ).toHaveLength(0);
  });

  it("treats hosts.list not_found code as fail-closed without warning", async () => {
    const db = createTestDb();
    createScheduledAgentAutomation(db, 1000);
    const notFound = Object.assign(new Error("not_found"), {
      code: "not_found",
    });
    const { bb, warn } = createSweepHarness(async () => {
      throw notFound;
    });

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(getAutomation(db, "auto_agent")?.runCount).toBe(0);
  });

  it("does not repeat warnings across sweeps when hosts.list keeps returning 404", async () => {
    const db = createTestDb();
    createScheduledAgentAutomation(db, 1000);
    const notFound = Object.assign(new Error("HTTP 404: Not found"), {
      status: 404,
    });
    const { bb, warn } = createSweepHarness(async () => {
      throw notFound;
    });

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });
    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns exactly once per sweep for other hosts.list failures", async () => {
    const db = createTestDb();
    createScheduledAgentAutomation(db, 1000);
    const { bb, warn } = createSweepHarness(async () => {
      throw new Error("HTTP 500: Internal Server Error");
    });

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "Failed to list hosts for automation sweep",
    );
    expect(getAutomation(db, "auto_agent")?.runCount).toBe(0);
  });

  it("still runs script due work when the agent host probe is denied", async () => {
    const db = createTestDb();
    createScheduledScriptAutomation(db, 1000, "auto_script");
    createScheduledAgentAutomation(db, 1000, "auto_agent");
    const notFound = Object.assign(new Error("HTTP 404: Not found"), {
      status: 404,
    });
    const { bb, warn } = createSweepHarness(async () => {
      throw notFound;
    });

    await sweepDueAutomations(bb, db, {
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
      now: 1000,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(getAutomation(db, "auto_agent")?.runCount).toBe(0);
    expect(getAutomation(db, "auto_script")?.runCount).toBe(1);
    expect(
      listAutomationRuns(db, { automationId: "auto_script", limit: 10 }),
    ).toHaveLength(1);
  });
});
