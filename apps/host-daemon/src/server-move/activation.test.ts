import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readLastServerMoveFile } from "@bb/server-archive";
import { describe, expect, it } from "vitest";
import { readIncomingMoveState, writeIncomingMoveState } from "./move-state.js";
import { isProcessGroupAlive } from "./pending-server.js";
import {
  activateCommand,
  createFixture,
  exists,
  lastMove,
  MOVE_ID,
  PARENT_PID,
  prepareCommand,
  readJson,
  registerServerMoveFixtureCleanup,
  writeLauncherMovedMode,
  writeSystemdUnit,
  type Fixture,
} from "./test-fixture.js";

registerServerMoveFixtureCleanup();

const DAEMON_ONLY_EXEC_START =
  '"/usr/bin/node" "/opt/npm/bin/bb-app" host-daemon --auto-update --host-daemon-port "38887" --server-url "http://old-server:38886"';

async function prepareMove(
  fixture: Fixture,
  overrides: Parameters<typeof prepareCommand>[1] = {},
) {
  await writeFile(
    join(fixture.dataDir, "config.json"),
    JSON.stringify({
      serverUrl: "https://bb.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_target" },
      machineCredential: "bbcm_target",
    }),
  );
  const command = await prepareCommand(fixture, overrides);
  const prepared = await fixture.service.prepare(command);
  return { command, prepared };
}

async function expectMarkersRemoved(fixture: Fixture): Promise<void> {
  expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(false);
  expect(await exists(join(fixture.dataDir, "server-import-backup"))).toBe(
    false,
  );
  expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
    false,
  );
  expect(await readLastServerMoveFile(fixture.dataDir)).toEqual({
    version: 1,
    ...lastMove,
  });
}

describe("server_move.activate pre-validation", () => {
  it.each([
    {
      name: "the service definition cannot run bb-app start",
      setup: async (fixture: Fixture) => {
        await writeSystemdUnit({
          homeDir: fixture.homeDir,
          dataDir: fixture.dataDir,
          execStart: '"/usr/local/bin/custom-daemon" --port 38887',
        });
      },
      fixtureArgs: { env: {} },
      message: "to run the bb server",
    },
    {
      name: "the host daemon port is unknown",
      setup: async () => undefined,
      fixtureArgs: { hostDaemonPort: null },
      message: "host daemon port is unknown",
    },
    {
      name: "the bb server package is missing",
      setup: async (fixture: Fixture) => {
        await rm(join(fixture.packageRoot, "server", "dist", "index.js"));
      },
      fixtureArgs: {},
      message: "does not include the bb server",
    },
    {
      name: "an unrecognized supervisor runs the daemon",
      setup: async () => undefined,
      fixtureArgs: {
        env: {
          BB_SERVER_MOVE_SERVICE_MANAGER: "none",
          INVOCATION_ID: "0123456789abcdef",
        },
      },
      message: "runs under systemd",
    },
  ])(
    "refuses before replying when $name",
    async ({ setup, fixtureArgs, message }) => {
      const fixture = await createFixture(fixtureArgs);
      const { prepared } = await prepareMove(fixture);
      await setup(fixture);

      await expect(
        fixture.service.activate(activateCommand),
      ).rejects.toMatchObject({
        code: "server_move_activation_rejected",
        message: expect.stringContaining(message),
      });

      expect(
        (await readIncomingMoveState(fixture.dataDir, MOVE_ID))?.activation,
      ).toBeNull();
      expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
        true,
      );
      expect(isProcessGroupAlive(prepared.pid)).toBe(true);
      expect(fixture.shutdownRequests).toEqual([]);
    },
  );

  it("rejects a mismatched token", async () => {
    const fixture = await createFixture();
    await prepareMove(fixture);

    await expect(
      fixture.service.activate({
        ...activateCommand,
        activationToken: "wrong-token-0123456789",
      }),
    ).rejects.toMatchObject({ code: "server_move_activation_rejected" });
  });
});

describe("server_move.activate sequencing", () => {
  it("persists the activation, waits for the old session to close, swaps the unit, and removes markers after the swap", async () => {
    const fixture = await createFixture({ env: {} });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: DAEMON_ONLY_EXEC_START,
    });
    const { command, prepared } = await prepareMove(fixture);
    const atDaemonReload: {
      unit: string;
      importExists: boolean;
      stateExists: boolean;
    }[] = [];
    const service = fixture.createService({
      runCommand: async (commandName, args) => {
        fixture.commands.push([commandName, ...args]);
        if (args.includes("daemon-reload")) {
          atDaemonReload.push({
            unit: await readFile(unitPath, "utf8"),
            importExists: await exists(
              join(fixture.dataDir, "server-import.json"),
            ),
            stateExists: await exists(
              join(fixture.dataDir, "server-move-incoming", MOVE_ID),
            ),
          });
        }
      },
    });
    fixture.session.open = true;

    await expect(service.activate(activateCommand)).resolves.toEqual({
      ok: true,
    });
    expect(
      (await readIncomingMoveState(fixture.dataDir, MOVE_ID))?.activation,
    ).toEqual({
      lastMove,
      plan: "service",
      requestedAt: expect.any(Number),
    });
    await expect(service.activate(activateCommand)).resolves.toEqual({
      ok: true,
    });
    await expect(
      service.abort({ type: "server_move.abort", moveId: MOVE_ID }),
    ).rejects.toMatchObject({ code: "server_move_already_activated" });
    await expect(service.prepare(command)).rejects.toMatchObject({
      code: "server_move_already_activated",
    });
    await sleep(600);
    expect(isProcessGroupAlive(prepared.pid)).toBe(true);
    expect(fixture.commands).toEqual([]);
    expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
      true,
    );

    fixture.session.open = false;
    await service.resumeActivation();

    expect(isProcessGroupAlive(prepared.pid)).toBe(false);
    expect(fixture.commands).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      [
        "systemctl",
        "--user",
        "restart",
        "--no-block",
        "bb-host-daemon-old-server-studio.service",
      ],
    ]);
    expect(atDaemonReload).toEqual([
      {
        unit: expect.stringContaining(
          `ExecStart="/usr/bin/node" "/opt/npm/bin/bb-app" "start" "--data-dir" "${fixture.dataDir}" "--server-port" "${command.serverPort}" "--host-daemon-port" "38887"`,
        ),
        importExists: false,
        stateExists: true,
      },
    ]);
    await expectMarkersRemoved(fixture);
    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: `http://127.0.0.1:${command.serverPort}`,
    });
    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(true);
    expect(fixture.shutdownRequests).toEqual([]);
  });

  it("starts bb-app start through the npm prefix launcher when no service manager runs the daemon", async () => {
    const fixture = await createFixture();
    const service = fixture.createService({
      env: {
        BB_SERVER_MOVE_SERVICE_MANAGER: "none",
        BB_APP_NPM_PREFIX: fixture.npmPrefix,
      },
    });
    await writeFile(
      join(fixture.dataDir, "install-daemon.pid"),
      `${PARENT_PID}\n`,
    );
    const command = await prepareCommand(fixture, { bindHost: "0.0.0.0" });
    const prepared = await service.prepare(command);

    await service.activate(activateCommand);
    await service.resumeActivation();

    expect(fixture.shutdownRequests).toEqual([["server-move-activated", 0]]);
    expect(isProcessGroupAlive(prepared.pid)).toBe(false);
    expect(fixture.detachedRequests).toEqual([
      {
        command: process.execPath,
        args: [
          join(fixture.npmPrefix, "bin", "bb-app"),
          "start",
          "--data-dir",
          fixture.dataDir,
          "--server-port",
          String(command.serverPort),
          "--host-daemon-port",
          "38887",
          "--server-bind-host",
          "0.0.0.0",
        ],
        env: expect.objectContaining({
          BB_DATA_DIR: fixture.dataDir,
          BB_APP_NPM_PREFIX: fixture.npmPrefix,
          BB_SERVER_MOVE_SERVICE_MANAGER: "none",
        }),
        logPath: join(fixture.dataDir, "logs", "server-move.log"),
      },
    ]);
    expect(
      await readFile(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    ).toBe("999999\n");
    await expectMarkersRemoved(fixture);
  });

  it("releases the port before removing the lock and exits for the launcher without touching services", async () => {
    const observations: {
      pendingAlive: boolean;
      importExists: boolean;
      lockExists: boolean;
    }[] = [];
    let fixture: Fixture | null = null;
    let pendingPid = 0;
    let busyChecks = 1;
    fixture = await createFixture({
      env: {},
      portReleaseTimeoutMs: 10_000,
      checkPortAvailable: async () => {
        if (fixture === null) {
          throw new Error("Expected the fixture");
        }
        if (pendingPid !== 0) {
          observations.push({
            pendingAlive: isProcessGroupAlive(pendingPid),
            importExists: await exists(
              join(fixture.dataDir, "server-import.json"),
            ),
            lockExists: await exists(
              join(fixture.dataDir, "server-moved.json"),
            ),
          });
          busyChecks -= 1;
          return busyChecks < 0;
        }
        return true;
      },
    });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: `"/usr/bin/node" "/opt/npm/bin/bb-app" "start" "--data-dir" "${fixture.dataDir}" "--server-port" "38886" "--host-daemon-port" "38887"`,
    });
    const unit = await readFile(unitPath, "utf8");
    const command = await prepareCommand(fixture);
    await writeLauncherMovedMode({
      dataDir: fixture.dataDir,
      serverPort: command.serverPort,
    });
    const prepared = await fixture.service.prepare(command);
    pendingPid = prepared.pid;

    await fixture.service.activate(activateCommand);
    await fixture.service.resumeActivation();

    expect(observations).toEqual([
      { pendingAlive: false, importExists: true, lockExists: true },
      { pendingAlive: false, importExists: true, lockExists: true },
    ]);
    expect(fixture.shutdownRequests).toEqual([["server-move-activated", 0]]);
    expect(await exists(join(fixture.dataDir, "server-moved.json"))).toBe(
      false,
    );
    await expectMarkersRemoved(fixture);
    expect(await exists(join(fixture.dataDir, "bb.db"))).toBe(true);
    expect(await readFile(unitPath, "utf8")).toBe(unit);
    expect(fixture.commands).toEqual([]);
    expect(fixture.detachedRequests).toEqual([]);
  });

  it("exits with the markers kept when the imported server's port does not free up", async () => {
    let checks = 0;
    const fixture = await createFixture({
      checkPortAvailable: async () => {
        checks += 1;
        return false;
      },
    });
    await prepareMove(fixture);

    await fixture.service.activate(activateCommand);
    await fixture.service.resumeActivation();

    expect(checks).toBeGreaterThan(0);
    expect(fixture.shutdownRequests).toEqual([
      ["server-move-activation-port-busy", 1],
    ]);
    expect(await exists(join(fixture.dataDir, "server-import.json"))).toBe(
      true,
    );
    expect(
      (await readIncomingMoveState(fixture.dataDir, MOVE_ID))?.activation,
    ).not.toBeNull();
    expect(fixture.detachedRequests).toEqual([]);
  });
});

describe("activation resume", () => {
  it("finishes an activation that was persisted before the daemon restarted", async () => {
    const fixture = await createFixture();
    const { command, prepared } = await prepareMove(fixture);
    const state = await readIncomingMoveState(fixture.dataDir, MOVE_ID);
    if (state === null) {
      throw new Error("Expected the prepared state");
    }
    await writeIncomingMoveState(fixture.dataDir, {
      ...state,
      activation: { lastMove, plan: "replacement", requestedAt: 1 },
    });
    const restarted = fixture.createService();

    await restarted.resumeActivation();

    expect(isProcessGroupAlive(prepared.pid)).toBe(false);
    expect(fixture.detachedRequests.map((request) => request.args[1])).toEqual([
      "start",
    ]);
    expect(fixture.shutdownRequests).toEqual([["server-move-activated", 0]]);
    await expectMarkersRemoved(fixture);
    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: `http://127.0.0.1:${command.serverPort}`,
    });
  });

  it("only drops the activation record when this daemon already runs next to the activated server", async () => {
    const fixture = await createFixture();
    const serverPort = 39_123;
    await writeIncomingMoveState(fixture.dataDir, {
      version: 1,
      moveId: MOVE_ID,
      activationToken: "activation-token-0123456789",
      serverPort,
      bindHost: null,
      importedEntries: ["bb.db"],
      archivedServerData: null,
      pendingServer: { pid: 999_998, localServerUrl: "http://127.0.0.1:1" },
      preparedAt: 1,
      activation: { lastMove, plan: "service", requestedAt: 1 },
    });
    const colocated = fixture.createService({
      serverUrl: `http://127.0.0.1:${serverPort}`,
    });

    await colocated.resumeActivation();

    expect(await exists(join(fixture.dataDir, "server-move-incoming"))).toBe(
      false,
    );
    expect(fixture.commands).toEqual([]);
    expect(fixture.shutdownRequests).toEqual([]);
    expect(fixture.detachedRequests).toEqual([]);
  });
});

describe("server move redirects during a move", () => {
  it("finishes activation on a 410 for this move's address even without the activate command", async () => {
    const fixture = await createFixture();
    const { command, prepared } = await prepareMove(fixture);

    await fixture.service.handleServerMoved({
      source: "session-open",
      serverUrl: "https://bb.example.test/",
      headers: null,
      toHostName: "studio",
      movedAt: 1_700_000_200_000,
    });
    await fixture.service.resumeActivation();

    expect(isProcessGroupAlive(prepared.pid)).toBe(false);
    expect(await readLastServerMoveFile(fixture.dataDir)).toEqual({
      version: 1,
      moveId: MOVE_ID,
      fromHostId: "host-source",
      fromHostName: "host-source",
      toHostId: "host-target",
      toHostName: "studio",
      completedAt: 1_700_000_200_000,
      oldCopyDeletedAt: null,
    });
    expect(fixture.detachedRequests.map((request) => request.args[1])).toEqual([
      "start",
    ]);
    expect(fixture.shutdownRequests).toEqual([["server-move-activated", 0]]);
    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: `http://127.0.0.1:${command.serverPort}`,
    });
  });

  it("ignores redirects that do not match a prepared move", async () => {
    const fixture = await createFixture();
    const { prepared } = await prepareMove(fixture);
    const configBefore = await readFile(
      join(fixture.dataDir, "config.json"),
      "utf8",
    );

    await fixture.service.handleServerMoved({
      source: "session-open",
      serverUrl: "https://elsewhere.example.test",
      headers: null,
      toHostName: "elsewhere",
      movedAt: 1_700_000_200_000,
    });
    await fixture.service.handleServerMoved({
      source: "message",
      serverUrl: "https://bb.example.test",
      headers: {},
    });

    expect(await readFile(join(fixture.dataDir, "config.json"), "utf8")).toBe(
      configBefore,
    );
    expect(
      (await readIncomingMoveState(fixture.dataDir, MOVE_ID))?.activation,
    ).toBeNull();
    expect(isProcessGroupAlive(prepared.pid)).toBe(true);
    expect(fixture.shutdownRequests).toEqual([]);
    expect(fixture.detachedRequests).toEqual([]);
    expect(fixture.commands).toEqual([]);
  });

  it("ignores server.moved while an activation is in progress", async () => {
    const fixture = await createFixture({ env: {} });
    await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: DAEMON_ONLY_EXEC_START,
    });
    await prepareMove(fixture);
    fixture.session.open = true;
    await fixture.service.activate(activateCommand);
    const configBefore = await readFile(
      join(fixture.dataDir, "config.json"),
      "utf8",
    );

    await fixture.service.handleServerMoved({
      source: "message",
      serverUrl: "https://somewhere.example.test",
      headers: {},
    });
    await rm(join(fixture.dataDir, "server-import.json"));
    const restarted = fixture.createService();
    await restarted.handleServerMoved({
      source: "session-open",
      serverUrl: "https://somewhere.example.test",
      headers: null,
      toHostName: "somewhere",
      movedAt: 1_700_000_300_000,
    });

    expect(await readFile(join(fixture.dataDir, "config.json"), "utf8")).toBe(
      configBefore,
    );
    expect(fixture.commands).toEqual([]);
    expect(fixture.shutdownRequests).toEqual([]);
    fixture.session.open = false;
    await fixture.service.resumeActivation();
    expect(fixture.commands.map((entry) => entry[2])).toEqual([
      "daemon-reload",
      "restart",
    ]);
  });

  it("does not self-activate from an unverified import", async () => {
    const fixture = await createFixture();
    await prepareMove(fixture);
    const state = await readIncomingMoveState(fixture.dataDir, MOVE_ID);
    if (state === null) {
      throw new Error("Expected the prepared state");
    }
    await writeIncomingMoveState(fixture.dataDir, {
      ...state,
      preparedAt: null,
    });

    await fixture.service.handleServerMoved({
      source: "session-open",
      serverUrl: "https://bb.example.test",
      headers: null,
      toHostName: "studio",
      movedAt: 1_700_000_200_000,
    });

    expect(fixture.shutdownRequests).toEqual([]);
    expect(await exists(join(fixture.dataDir, "last-server-move.json"))).toBe(
      false,
    );
  });
});
