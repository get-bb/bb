import { readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readServerConnectHoldFile,
  readServerImportFile,
  readServerMovedFile,
  writeServerConnectHoldFile,
  writeServerImportFile,
  writeServerMovedFile,
} from "@bb/server-archive";
import { describe, expect, it } from "vitest";
import { writeIncomingMoveState } from "./move-state.js";
import { isProcessGroupAlive } from "./pending-server.js";
import {
  ACTIVATION_TOKEN,
  createFixture,
  exists,
  freePort,
  HOST_KEY,
  LAUNCHER_ENTRY_PATH,
  launcherProcessOps,
  listen,
  MOVE_ID,
  prepareCommand,
  readJson,
  registerServerMoveFixtureCleanup,
  writeBbAppRuntime,
  writeFileWithDirs,
  writeLauncherMovedMode,
  type Fixture,
} from "./test-fixture.js";

registerServerMoveFixtureCleanup();

describe("ServerMoveService.prepare", () => {
  it("installs bb-app, imports the archive, keeps this machine's credentials, starts the pending server, and answers a repeated prepare with the same server", async () => {
    const installed: Buffer[] = [];
    const fixture = await createFixture({
      installBbApp: async (tarballPath) => {
        installed.push(await readFile(tarballPath));
      },
    });
    await writeFile(
      join(fixture.dataDir, "host-artifact.sha256"),
      "a".repeat(64),
    );
    await writeFile(
      join(fixture.dataDir, "config.json"),
      JSON.stringify({
        serverUrl: "https://bb.example.test",
        serverHeaders: { "x-bb-connect-machine": "bbcm_target" },
        machineCredential: "bbcm_target",
        connectMachineId: "machine-target",
      }),
    );
    const command = await prepareCommand(fixture, {
      bbApp: {
        downloadPath: `/internal/server-move/${MOVE_ID}/bb-app.tgz`,
        sha256: fixture.source.bbAppSha256,
        version: "1.0.0",
      },
    });

    const result = await fixture.service.prepare(command);

    expect(result).toEqual({
      localServerUrl: `http://127.0.0.1:${command.serverPort}`,
      pid: expect.any(Number),
    });
    expect(isProcessGroupAlive(result.pid)).toBe(true);
    expect(installed.map((bytes) => bytes.toString("utf8"))).toEqual([
      "full bb-app package",
    ]);
    expect(await exists(join(fixture.dataDir, "host-artifact.sha256"))).toBe(
      false,
    );
    expect(await readFile(join(fixture.dataDir, "bb.db"), "utf8")).toBe(
      "sqlite database bytes",
    );
    expect(
      await readFile(
        join(fixture.dataDir, "attachments", "project", "a.txt"),
        "utf8",
      ),
    ).toBe("attachment");
    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: "https://bb.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_target" },
      machineCredential: "bbcm_target",
      connectMachineId: "machine-target",
    });
    expect(await readServerImportFile(fixture.dataDir)).toEqual({
      version: 1,
      kind: "move",
      moveId: MOVE_ID,
      activationToken: ACTIVATION_TOKEN,
      sourceDataDir: "/Users/me/.bb",
      sourceServerHostId: "host-source",
      targetHostId: "host-target",
      serverUrl: "https://bb.example.test",
      importedEntries: expect.arrayContaining([
        "bb.db",
        "config.json",
        "attachments/project/a.txt",
        "plugins/tasks/data.db",
      ]),
      createdAt: expect.any(Number),
      fixupsAppliedAt: null,
    });
    expect(await readServerConnectHoldFile(fixture.dataDir)).toBeNull();
    expect(fixture.launches).toEqual([
      {
        bbServerEntry: join(fixture.packageRoot, "dist", "bb-server.js"),
        dataDir: fixture.dataDir,
        serverPort: command.serverPort,
        bindHost: null,
        hostDaemonPort: 38_887,
        env: expect.objectContaining({ BB_HOST_DAEMON_PORT: "38887" }),
        logPath: join(
          fixture.dataDir,
          "logs",
          "server-move-pending-server.log",
        ),
      },
    ]);
    expect(fixture.source.archiveRequests[0]?.headers).toMatchObject({
      authorization: `Bearer ${HOST_KEY}`,
      "x-test-access": "opaque",
    });
    const steps = fixture.progress.map((message) => message.step);
    expect(steps[0]).toBe("update-target");
    expect(steps.indexOf("transfer")).toBeGreaterThan(
      steps.lastIndexOf("update-target"),
    );
    expect(fixture.progress.at(-1)).toEqual({
      type: "server_move.progress",
      moveId: MOVE_ID,
      step: "start-target",
      message: "The imported server is running",
    });
    expect(
      await readdir(join(fixture.dataDir, "server-move-incoming", MOVE_ID)),
    ).toEqual(["state.json"]);

    await expect(fixture.service.prepare(command)).resolves.toEqual(result);
    expect(fixture.source.archiveRequests).toHaveLength(1);
    expect(fixture.launches).toHaveLength(1);
  });

  it("fails on a digest mismatch and leaves the target data dir untouched", async () => {
    const fixture = await createFixture();
    const originalConfig = JSON.stringify({
      serverUrl: "https://bb.example.test",
    });
    await writeFile(join(fixture.dataDir, "config.json"), originalConfig);
    const command = await prepareCommand(fixture);

    await expect(
      fixture.service.prepare({
        ...command,
        archive: { ...command.archive, sha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "server_move_digest_mismatch" });

    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(false);
    expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
      false,
    );
    expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
      false,
    );
    expect(await readFile(join(fixture.dataDir, "config.json"), "utf8")).toBe(
      originalConfig,
    );
    expect(fixture.launches).toEqual([]);
  });

  it("abort stops the pending server, restores config backups, and un-archives standalone data", async () => {
    const fixture = await createFixture();
    const originalConfig = {
      config: { BB_LOG_LEVEL: "debug" },
      serverUrl: "https://bb.example.test",
      machineCredential: "bbcm_target",
    };
    await writeFile(
      join(fixture.dataDir, "config.json"),
      JSON.stringify(originalConfig),
    );
    await writeFileWithDirs(
      join(fixture.homeDir, ".bb", "bb.db"),
      "standalone server",
    );
    const command = await prepareCommand(fixture, {
      archiveExistingServerData: true,
    });

    const result = await fixture.service.prepare(command);
    expect(await exists(join(fixture.homeDir, ".bb"))).toBe(false);
    expect(
      (await readdir(fixture.homeDir)).some((name) =>
        name.startsWith(".bb.before-move-"),
      ),
    ).toBe(true);

    await expect(
      fixture.service.abort({ type: "server_move.abort", moveId: MOVE_ID }),
    ).resolves.toEqual({ ok: true });

    expect(isProcessGroupAlive(result.pid)).toBe(false);
    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual(
      originalConfig,
    );
    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(false);
    expect(await exists(join(fixture.dataDir, "attachments"))).toBe(false);
    expect(await exists(join(fixture.dataDir, "server-import-backup"))).toBe(
      false,
    );
    expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
      false,
    );
    expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
      false,
    );
    expect(await readFile(join(fixture.homeDir, ".bb", "bb.db"), "utf8")).toBe(
      "standalone server",
    );
    await expect(
      fixture.service.abort({ type: "server_move.abort", moveId: MOVE_ID }),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses to archive ~/.bb while bb is running from it", async () => {
    const fixture = await createFixture();
    await writeFileWithDirs(
      join(fixture.homeDir, ".bb", "bb.db"),
      "standalone server",
    );
    await writeBbAppRuntime({
      dataDir: join(fixture.homeDir, ".bb"),
      serverPort: 38_886,
    });
    const command = await prepareCommand(fixture, {
      archiveExistingServerData: true,
    });

    await expect(fixture.service.prepare(command)).rejects.toMatchObject({
      code: "server_move_rejected",
      message: `bb is running from ${join(fixture.homeDir, ".bb")} on this machine (pid ${process.pid}). Quit bb there first, then start the move again.`,
    });
    expect(fixture.source.archiveRequests).toEqual([]);
    expect(await readFile(join(fixture.homeDir, ".bb", "bb.db"), "utf8")).toBe(
      "standalone server",
    );

    const stopped = await createFixture({
      processOps: {
        isRunning: () => false,
        readCommand: async () => `node ${LAUNCHER_ENTRY_PATH} start`,
      },
    });
    await writeFileWithDirs(
      join(stopped.homeDir, ".bb", "bb.db"),
      "standalone server",
    );
    await writeBbAppRuntime({
      dataDir: join(stopped.homeDir, ".bb"),
      serverPort: 38_886,
    });
    await expect(
      stopped.service.prepare(
        await prepareCommand(stopped, { archiveExistingServerData: true }),
      ),
    ).resolves.toMatchObject({ pid: expect.any(Number) });
    expect(await exists(join(stopped.homeDir, ".bb"))).toBe(false);
  });
});

describe("ServerMoveService in launcher-managed moved mode", () => {
  it("reports the launcher's own responder port as available and other busy ports as in use", async () => {
    const fixture = await createFixture({
      checkPortAvailable: async () => false,
    });
    await writeLauncherMovedMode({
      dataDir: fixture.dataDir,
      serverPort: 38_886,
    });

    const inspect = (port: number) =>
      fixture.service.inspect({ type: "server_move.inspect", paths: [], port });

    expect((await inspect(38_886)).portAvailable).toBe(true);
    expect((await inspect(39_886)).portAvailable).toBe(false);
    expect((await inspect(38_886)).dataDirHasServerData).toBe(false);
  });

  it.each([
    {
      name: "the launcher pid is not running",
      processOps: {
        isRunning: () => false,
        readCommand: async () => `node ${LAUNCHER_ENTRY_PATH} start`,
      },
      movedFile: true,
    },
    {
      name: "the recorded pid is not bb-app",
      processOps: {
        isRunning: () => true,
        readCommand: async () => "/usr/bin/python3 http.server 38886",
      },
      movedFile: true,
    },
    {
      name: "the data dir has no moved-server lock",
      processOps: launcherProcessOps,
      movedFile: false,
    },
  ])(
    "does not treat the port as the launcher's when $name",
    async ({ processOps, movedFile }) => {
      const fixture = await createFixture({
        checkPortAvailable: async () => false,
        processOps,
      });
      await writeLauncherMovedMode({
        dataDir: fixture.dataDir,
        serverPort: 38_886,
      });
      if (!movedFile) {
        await rm(join(fixture.dataDir, "server-moved.json"));
      }

      const result = await fixture.service.inspect({
        type: "server_move.inspect",
        paths: [],
        port: 38_886,
      });

      expect(result.portAvailable).toBe(false);
    },
  );

  it("waits for the launcher to release the old server port after writing server-import.json", async () => {
    const portChecks: boolean[] = [];
    let busyChecks = 3;
    let fixture: Fixture | null = null;
    fixture = await createFixture({
      portReleaseTimeoutMs: 10_000,
      checkPortAvailable: async () => {
        if (fixture === null) {
          throw new Error("Expected the fixture");
        }
        portChecks.push(
          await exists(join(fixture.dataDir, "server-import.json")),
        );
        busyChecks -= 1;
        return busyChecks < 0;
      },
    });
    const command = await prepareCommand(fixture);
    await writeLauncherMovedMode({
      dataDir: fixture.dataDir,
      serverPort: command.serverPort,
    });

    const result = await fixture.service.prepare(command);

    expect(result.localServerUrl).toBe(
      `http://127.0.0.1:${command.serverPort}`,
    );
    expect(portChecks).toEqual([true, true, true, true]);
    expect(fixture.launches).toHaveLength(1);
    expect(fixture.progress.map((message) => message.message)).toContain(
      `Waiting for this machine's old server address on port ${command.serverPort} to close`,
    );
  });

  it("fails and cleans up when the old server port stays busy", async () => {
    const fixture = await createFixture({
      checkPortAvailable: async () => false,
    });
    const command = await prepareCommand(fixture);
    await writeLauncherMovedMode({
      dataDir: fixture.dataDir,
      serverPort: command.serverPort,
    });

    await expect(fixture.service.prepare(command)).rejects.toMatchObject({
      code: "server_move_start_failed",
      message: expect.stringContaining(
        `Port ${command.serverPort} is still in use on this machine`,
      ),
    });

    expect(fixture.launches).toEqual([]);
    expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
      false,
    );
    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(false);
    expect(await exists(join(fixture.dataDir, "server-moved.json"))).toBe(true);
    expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
      false,
    );
  });
});

describe("ServerMoveService own data dir guards", () => {
  it("blocks while an old server copy is still listed, then clears after delete_old_copy", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.dataDir, "bb.db"), "old server");
    await writeFileWithDirs(
      join(fixture.dataDir, "attachments", "a.txt"),
      "old attachment",
    );
    await writeLauncherMovedMode({
      dataDir: fixture.dataDir,
      serverPort: 38_886,
      oldCopyEntries: ["bb.db", "attachments"],
    });
    const inspect = () =>
      fixture.service.inspect({
        type: "server_move.inspect",
        paths: [],
        port: 38_886,
      });

    expect((await inspect()).dataDirHasServerData).toBe(true);
    await rm(join(fixture.dataDir, "bb.db"));
    expect((await inspect()).dataDirHasServerData).toBe(true);

    await expect(fixture.service.deleteOldCopy()).resolves.toEqual({
      deleted: true,
    });
    expect((await inspect()).dataDirHasServerData).toBe(false);
  });

  it("reports a leftover server-import-backup as server data when no move is in progress", async () => {
    const fixture = await createFixture();
    await writeFileWithDirs(
      join(fixture.dataDir, "server-import-backup", "config.json"),
      "{}",
    );
    const inspect = () =>
      fixture.service.inspect({
        type: "server_move.inspect",
        paths: [],
        port: 38_886,
      });

    expect((await inspect()).dataDirHasServerData).toBe(true);
    await writeFileWithDirs(
      join(fixture.dataDir, "server-move-incoming", "move-other", "state.json"),
      "{}",
    );
    expect((await inspect()).dataDirHasServerData).toBe(false);
  });

  it("rolls back an import that crashed before the move recorded it, so the next prepare succeeds", async () => {
    const fixture = await createFixture();
    const { dataDir } = fixture;
    const originalConfig = {
      config: { BB_LOG_LEVEL: "debug" },
      serverUrl: "https://bb.example.test",
      machineCredential: "bbcm_target",
    };
    await writeFileWithDirs(join(dataDir, "bb.db"), "crashed import database");
    await writeFileWithDirs(
      join(dataDir, "attachments", "crashed", "a.txt"),
      "crashed attachment",
    );
    await writeFileWithDirs(
      join(dataDir, "config.json"),
      JSON.stringify({
        config: { BB_LOG_LEVEL: "info" },
        serverUrl: "http://127.0.0.1:39999",
      }),
    );
    await writeFileWithDirs(
      join(dataDir, "server-import-backup", "config.json"),
      JSON.stringify(originalConfig),
    );
    await writeFileWithDirs(
      join(dataDir, "server-import-journal.json"),
      JSON.stringify({
        version: 1,
        entries: ["attachments/crashed/a.txt", "config.json", "bb.db"],
        preexistingEntries: ["config.json"],
      }),
    );
    await writeIncomingMoveState(dataDir, {
      version: 1,
      moveId: "move-crashed",
      activationToken: ACTIVATION_TOKEN,
      serverPort: 39_999,
      bindHost: null,
      importedEntries: null,
      archivedServerData: null,
      pendingServer: null,
      preparedAt: null,
      activation: null,
    });

    const inspected = await fixture.service.inspect({
      type: "server_move.inspect",
      paths: [],
      port: 38_886,
    });
    expect(inspected.dataDirHasServerData).toBe(false);

    await expect(
      fixture.service.prepare(await prepareCommand(fixture)),
    ).resolves.toMatchObject({ pid: expect.any(Number) });

    expect(await readdir(join(dataDir, "server-move-incoming"))).toEqual([
      MOVE_ID,
    ]);
    expect(await exists(join(dataDir, "attachments", "crashed"))).toBe(false);
    expect(await exists(join(dataDir, "server-import-journal.json"))).toBe(
      false,
    );
    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "sqlite database bytes",
    );
    expect(
      await readJson(join(dataDir, "server-import-backup", "config.json")),
    ).toEqual(originalConfig);
    expect(await readJson(join(dataDir, "config.json"))).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: "https://bb.example.test",
      machineCredential: "bbcm_target",
    });
  });

  it("rolls back a crashed manual import in this data directory so it doesn't block a move", async () => {
    const fixture = await createFixture();
    const { dataDir } = fixture;
    await writeFileWithDirs(join(dataDir, "bb.db"), "half-imported database");
    await writeFileWithDirs(
      join(dataDir, "attachments", "project", "a.txt"),
      "half-imported attachment",
    );
    await writeFileWithDirs(
      join(dataDir, "server-import-journal.json"),
      JSON.stringify({
        version: 1,
        entries: ["attachments/project/a.txt", "bb.db"],
        preexistingEntries: [],
      }),
    );

    const inspected = await fixture.service.inspect({
      type: "server_move.inspect",
      paths: [],
      port: 38_886,
    });
    expect(inspected.dataDirHasServerData).toBe(false);

    await expect(
      fixture.service.prepare(await prepareCommand(fixture)),
    ).resolves.toMatchObject({ pid: expect.any(Number) });

    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "sqlite database bytes",
    );
    expect(
      await readFile(join(dataDir, "attachments", "project", "a.txt"), "utf8"),
    ).toBe("attachment");
    expect(await exists(join(dataDir, "server-import-journal.json"))).toBe(
      false,
    );
  });

  it("keeps a finished manual import whose journal outlived its marker and refuses the move", async () => {
    const fixture = await createFixture();
    const { dataDir } = fixture;
    const importedEntries = ["attachments/project/a.txt", "bb.db"];
    await writeFileWithDirs(join(dataDir, "bb.db"), "imported database");
    await writeFileWithDirs(
      join(dataDir, "attachments", "project", "a.txt"),
      "imported attachment",
    );
    await writeFileWithDirs(
      join(dataDir, "server-import-journal.json"),
      JSON.stringify({
        version: 1,
        entries: importedEntries,
        preexistingEntries: [],
      }),
    );
    await writeServerImportFile(dataDir, {
      version: 1,
      kind: "manual",
      moveId: null,
      activationToken: null,
      sourceDataDir: "/Users/me/.bb",
      sourceServerHostId: "host-source",
      targetHostId: null,
      serverUrl: null,
      importedEntries,
      createdAt: 1,
      fixupsAppliedAt: null,
    });
    await writeServerConnectHoldFile(dataDir, {
      version: 1,
      reason: "manual-import",
      createdAt: 1,
    });

    const inspected = await fixture.service.inspect({
      type: "server_move.inspect",
      paths: [],
      port: 38_886,
    });
    expect(inspected.dataDirHasServerData).toBe(true);

    await expect(
      fixture.service.prepare(await prepareCommand(fixture)),
    ).rejects.toMatchObject({ code: "server_move_archive_server_data_exists" });

    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "imported database",
    );
    expect(
      await readFile(join(dataDir, "attachments", "project", "a.txt"), "utf8"),
    ).toBe("imported attachment");
    expect(await readServerImportFile(dataDir)).toMatchObject({
      kind: "manual",
      importedEntries,
    });
    expect(await readServerConnectHoldFile(dataDir)).not.toBeNull();
    expect(await exists(join(dataDir, "server-import-journal.json"))).toBe(
      false,
    );
    expect(fixture.launches).toEqual([]);
  });

  it("hides ~/.bb when it is this daemon's data dir and refuses to archive it", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.dataDir, "bb.db"), "old server");
    await symlink(fixture.dataDir, join(fixture.homeDir, ".bb"));

    const result = await fixture.service.inspect({
      type: "server_move.inspect",
      paths: [],
      port: 38_886,
    });

    expect(result.existingServerData).toBeNull();
    expect(result.dataDirHasServerData).toBe(true);
    const command = await prepareCommand(fixture, {
      archiveExistingServerData: true,
    });
    await expect(fixture.service.prepare(command)).rejects.toMatchObject({
      code: "server_move_rejected",
      message: "The target's own data directory cannot be archived",
    });
    expect(fixture.source.archiveRequests).toEqual([]);
    expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
      false,
    );
    expect(
      (await readdir(fixture.homeDir)).filter((name) =>
        name.startsWith(".bb.before-move-"),
      ),
    ).toEqual([]);
    expect(await readFile(join(fixture.dataDir, "bb.db"), "utf8")).toBe(
      "old server",
    );
  });
});

describe("ServerMoveService.deleteOldCopy", () => {
  it("deletes only the listed old server entries and keeps the lock", async () => {
    const fixture = await createFixture();
    const { dataDir } = fixture;
    for (const file of [
      "bb.db",
      "bb.db-wal",
      "attachments/project/a.txt",
      "plugins/tasks/data.db",
      "plugins/tasks/host-data/cache.json",
      "skills/review/SKILL.md",
      "host-id",
      "auth.json",
      "thread-storage/thread-1/notes.md",
      "config.json",
    ]) {
      await writeFileWithDirs(
        join(dataDir, ...file.split("/")),
        file === "config.json" ? "{}" : "content",
      );
    }
    const marker = {
      version: 1 as const,
      moveId: MOVE_ID,
      movedAt: 1_700_000_000_000,
      fromHostId: "host-source",
      toHostId: "host-target",
      toHostName: "studio",
      serverUrl: "https://studio.example.test",
      mode: "direct" as const,
      connectHandle: null,
      oldCopyEntries: ["bb.db", "attachments", "plugins/tasks/data.db"],
    };
    await writeServerMovedFile(dataDir, marker);

    await expect(fixture.service.deleteOldCopy()).resolves.toEqual({
      deleted: true,
    });

    for (const removed of [
      "bb.db",
      "bb.db-wal",
      "attachments",
      "plugins/tasks/data.db",
    ]) {
      expect(await exists(join(dataDir, ...removed.split("/")))).toBe(false);
    }
    for (const kept of [
      "plugins/tasks/host-data/cache.json",
      "skills/review/SKILL.md",
      "host-id",
      "auth.json",
      "thread-storage/thread-1/notes.md",
      "config.json",
    ]) {
      expect(await exists(join(dataDir, ...kept.split("/")))).toBe(true);
    }
    expect(await readServerMovedFile(dataDir)).toEqual({
      ...marker,
      oldCopyEntries: [],
    });
    await expect(fixture.service.deleteOldCopy()).resolves.toEqual({
      deleted: true,
    });
  });

  it("reports nothing deleted when this data dir has no moved-server lock", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.dataDir, "bb.db"), "content");

    await expect(fixture.service.deleteOldCopy()).resolves.toEqual({
      deleted: false,
    });
    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(true);
  });
});

describe("ServerMoveService.inspect and probe", () => {
  it("reports the target machine's server-move readiness", async () => {
    const fixture = await createFixture({
      env: { BB_SERVER_MOVE_SERVICE_MANAGER: "none", BB_APP_VERSION: "1.2.3" },
    });
    await writeFileWithDirs(join(fixture.homeDir, ".bb", "bb.db"), "12345");
    await writeFileWithDirs(join(fixture.homeDir, ".codex", "auth.json"), "{}");
    await writeFileWithDirs(join(fixture.homeDir, "tools", "bin", "gh"), "");

    const result = await fixture.service.inspect({
      type: "server_move.inspect",
      paths: [
        fixture.dataDir,
        join(fixture.root, "missing"),
        "~",
        "~/tools/bin/gh",
        "~/tools/bin/missing",
        "~other/tools",
      ],
      port: 38_886,
    });

    expect(result).toEqual({
      dataDir: fixture.dataDir,
      platform: "linux",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      bbAppVersion: "1.2.3",
      serverEntryAvailable: true,
      serviceManager: "none",
      existingServerData: { path: join(fixture.homeDir, ".bb"), sizeBytes: 5 },
      dataDirHasServerData: false,
      portAvailable: true,
      ghAuthenticated: null,
      codexCredentialsPresent: true,
      pathsExist: {
        [fixture.dataDir]: true,
        [join(fixture.root, "missing")]: false,
        "~": true,
        "~/tools/bin/gh": true,
        "~/tools/bin/missing": false,
        "~other/tools": false,
      },
      diskFreeBytes: expect.any(Number),
    });
  });

  it("requires the new address to answer for this move and reports its state", async () => {
    const fixture = await createFixture();
    const health = { state: "pending" };
    const { url } = await listen((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          serverMove: { state: health.state, moveId: MOVE_ID },
        }),
      );
    });
    const closedPort = await freePort();

    await expect(
      fixture.service.probe({
        type: "server_move.probe",
        url,
        moveId: MOVE_ID,
      }),
    ).resolves.toEqual({ reachable: true, message: null, state: "pending" });
    health.state = "ready";
    await expect(
      fixture.service.probe({
        type: "server_move.probe",
        url,
        moveId: MOVE_ID,
      }),
    ).resolves.toEqual({ reachable: true, message: null, state: "ready" });
    await expect(
      fixture.service.probe({
        type: "server_move.probe",
        url,
        moveId: "other-move",
      }),
    ).resolves.toEqual({
      reachable: false,
      message: `${url} answered for a different server move`,
      state: null,
    });
    const unreachable = await fixture.service.probe({
      type: "server_move.probe",
      url: `http://127.0.0.1:${closedPort}`,
      moveId: MOVE_ID,
    });
    expect(unreachable.reachable).toBe(false);
    expect(unreachable.state).toBeNull();
    expect(unreachable.message).toContain(
      `Could not reach http://127.0.0.1:${closedPort}`,
    );
  });
});
