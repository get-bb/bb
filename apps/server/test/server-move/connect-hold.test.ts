import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  removeServerConnectHoldFile,
  SERVER_CONNECT_HOLD_FILE_NAME,
  writeServerConnectHoldFile,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginStartOptions } from "../../src/services/plugins/plugin-service.js";
import {
  CONNECT_HOLD_DETAIL,
  createConnectHold,
} from "../../src/services/server-move/connect-hold.js";
import { startServerPlugins } from "../../src/start-server.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function makeDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-connect-hold-"));
  tempDirs.push(dataDir);
  return dataDir;
}

async function writeHold(dataDir: string): Promise<void> {
  await writeServerConnectHoldFile(dataDir, {
    version: 1,
    reason: "manual-import",
    createdAt: 1,
  });
}

describe("bb connect hold", () => {
  it("holds the builtin connect and bb account plugins while server-connect-hold.json exists, even when it can't be read", async () => {
    const dataDir = await makeDataDir();
    const logger = { warn: vi.fn() };
    const hold = createConnectHold({ dataDir, logger });

    expect(hold).toMatchObject({
      sources: ["builtin:connect", "builtin:bb-account"],
      detail: CONNECT_HOLD_DETAIL,
    });
    expect(await hold.isActive()).toBe(false);

    await writeHold(dataDir);
    expect(await hold.isActive()).toBe(true);

    await writeFile(join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME), "not json");
    expect(await hold.isActive()).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await removeServerConnectHoldFile(dataDir);
    expect(await hold.isActive()).toBe(false);
  });

  it("starts the server's plugins with the data directory's connect hold, then settles registrations and update checks", async () => {
    const dataDir = await makeDataDir();
    await writeHold(dataDir);
    const logger = { error: vi.fn(), warn: vi.fn() };
    const events: string[] = [];
    const starts: Array<PluginStartOptions | undefined> = [];

    await startServerPlugins({
      dataDir,
      logger,
      pluginService: {
        start: async (options) => {
          starts.push(options);
          events.push("start");
        },
        startPeriodicUpdateChecks: () => {
          events.push("update-checks");
        },
      },
      providerRegistry: {
        markRegistrationsSettled: () => {
          events.push("registrations-settled");
        },
      },
    });

    expect(events).toEqual(["start", "registrations-settled", "update-checks"]);
    const hold = starts[0]?.hold;
    expect(hold).toMatchObject({
      sources: ["builtin:connect", "builtin:bb-account"],
      detail: CONNECT_HOLD_DETAIL,
    });
    expect(await hold?.isActive()).toBe(true);
    await removeServerConnectHoldFile(dataDir);
    expect(await hold?.isActive()).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
