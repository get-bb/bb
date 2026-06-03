import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonAppDataChangePayload } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import { AppDataChangeReporter } from "./app-data-change-reporter.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJsonFile(filePath: string, value: object): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createLogger(): HostDaemonLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("AppDataChangeReporter", () => {
  it("posts changed app data values and suppresses duplicate versions", async () => {
    const rootPath = await makeTempDir("bb-app-data-reporter-");
    const appDataPath = path.join(rootPath, "apps", "status", "data");
    const statePath = path.join(appDataPath, "state.json");
    const posted: HostDaemonAppDataChangePayload[] = [];
    const reporter = new AppDataChangeReporter({
      logger: createLogger(),
      postAppDataChange: async (payload) => {
        posted.push(payload);
      },
      postAppDataResync: async () => undefined,
    });

    await reporter.replaceTrackedApplications({
      targets: [{ applicationId: "status", appDataPath }],
    });
    await writeJsonFile(statePath, { workers: [] });
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      applicationId: "status",
      path: "state.json",
      deleted: false,
      value: { workers: [] },
    });
    expect(posted[0]?.version).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("posts deleted events after observed files are removed", async () => {
    const rootPath = await makeTempDir("bb-app-data-reporter-delete-");
    const appDataPath = path.join(rootPath, "apps", "status", "data");
    const statePath = path.join(appDataPath, "state.json");
    const posted: HostDaemonAppDataChangePayload[] = [];
    const reporter = new AppDataChangeReporter({
      logger: createLogger(),
      postAppDataChange: async (payload) => {
        posted.push(payload);
      },
      postAppDataResync: async () => undefined,
    });

    await writeJsonFile(statePath, { workers: [] });
    await reporter.replaceTrackedApplications({
      targets: [{ applicationId: "status", appDataPath }],
    });
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });
    await fs.rm(statePath);
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      applicationId: "status",
      path: "state.json",
      deleted: true,
      value: null,
      version: null,
    });
  });

  it("re-primes tracked threads and posts resync hints after reconnect", async () => {
    const rootPath = await makeTempDir("bb-app-data-reporter-reprime-");
    const appDataPath = path.join(rootPath, "apps", "status", "data");
    const statePath = path.join(appDataPath, "state.json");
    const posted: HostDaemonAppDataChangePayload[] = [];
    const resyncs: Array<{ applicationId: string }> = [];
    const reporter = new AppDataChangeReporter({
      logger: createLogger(),
      postAppDataChange: async (payload) => {
        posted.push(payload);
      },
      postAppDataResync: async (payload) => {
        resyncs.push(payload);
      },
    });

    await writeJsonFile(statePath, { workers: [] });
    await reporter.replaceTrackedApplications({
      targets: [{ applicationId: "status", appDataPath }],
    });
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });

    expect(resyncs).toEqual([{ applicationId: "status" }]);
    expect(posted).toHaveLength(0);

    await writeJsonFile(statePath, { workers: [{ id: "worker-1" }] });
    await reporter.observe({
      applicationId: "status",
      appDataPath,
      path: "state.json",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      applicationId: "status",
      path: "state.json",
      deleted: false,
      value: { workers: [{ id: "worker-1" }] },
    });
  });

  it("posts resync hints for apps whose data disappeared while disconnected", async () => {
    const rootPath = await makeTempDir("bb-app-data-reporter-delete-resync-");
    const appDataPath = path.join(rootPath, "apps", "status", "data");
    const statePath = path.join(appDataPath, "state.json");
    const resyncs: Array<{ applicationId: string }> = [];
    const reporter = new AppDataChangeReporter({
      logger: createLogger(),
      postAppDataChange: async () => undefined,
      postAppDataResync: async (payload) => {
        resyncs.push(payload);
      },
    });

    await writeJsonFile(statePath, { workers: [] });
    await reporter.replaceTrackedApplications({
      targets: [{ applicationId: "status", appDataPath }],
    });
    await fs.rm(statePath);
    await reporter.replaceTrackedApplications({
      targets: [{ applicationId: "status", appDataPath }],
    });

    expect(resyncs).toEqual([
      { applicationId: "status" },
      { applicationId: "status" },
    ]);
  });

  it("posts requested app data resync hints", async () => {
    const resyncs: Array<{ applicationId: string }> = [];
    const reporter = new AppDataChangeReporter({
      logger: createLogger(),
      postAppDataChange: async () => undefined,
      postAppDataResync: async (payload) => {
        resyncs.push(payload);
      },
    });

    await reporter.requestResync({
      applicationId: "status",
    });

    expect(resyncs).toEqual([{ applicationId: "status" }]);
  });
});
