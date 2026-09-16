import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeServerMovedFile } from "@bb/server-archive";
import { describe, expect, it } from "vitest";
import type { ServerMovedNotice } from "../server-connection-support.js";
import {
  createFixture,
  MOVE_ID,
  PARENT_PID,
  readJson,
  registerServerMoveFixtureCleanup,
  writeSystemdUnit,
} from "./test-fixture.js";

registerServerMoveFixtureCleanup();

const DAEMON_ONLY_EXEC_START =
  '"/usr/bin/node" "/opt/npm/bin/bb-app" host-daemon --auto-update --host-daemon-port "38887" --server-url "http://old-server:38886"';

describe("ServerMoveService.handleServerMoved", () => {
  it("rewrites config.json and the unit's normalized --server-url, then restarts the unit once", async () => {
    const fixture = await createFixture({
      env: {},
      serverUrl: "http://old-server:38886",
    });
    await writeFile(
      join(fixture.dataDir, "config.json"),
      JSON.stringify({
        serverUrl: "http://old-server:38886",
        machineCredential: "bbcm_old",
        connectMachineId: "machine-1",
      }),
    );
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: DAEMON_ONLY_EXEC_START,
    });
    const notice = {
      source: "message" as const,
      serverUrl: "https://studio.example.test/",
      headers: { "x-bb-connect-machine": "bbcm_new" },
    };

    await fixture.service.handleServerMoved(notice);
    await fixture.service.handleServerMoved(notice);

    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      serverUrl: "https://studio.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_new" },
    });
    expect(await readFile(unitPath, "utf8")).toContain(
      '"--server-url" "https://studio.example.test"',
    );
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
    expect(fixture.shutdownRequests).toEqual([]);
  });

  it("keeps existing machine headers on a 410 without headers and replaces them on an explicit headers object", async () => {
    const fixture = await createFixture({
      serverUrl: "http://127.0.0.1:38886",
    });
    const machineConfig = {
      serverHeaders: { "x-bb-connect-machine": "bbcm_machine" },
      machineCredential: "bbcm_machine",
      connectMachineId: "machine-1",
    };
    await writeFile(
      join(fixture.dataDir, "config.json"),
      JSON.stringify({ serverUrl: "http://127.0.0.1:38886", ...machineConfig }),
    );

    await fixture.service.handleServerMoved({
      source: "session-open",
      serverUrl: "https://studio.example.test",
      headers: null,
      toHostName: "studio",
      movedAt: 1_700_000_000_000,
    });

    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      serverUrl: "https://studio.example.test",
      ...machineConfig,
    });
    expect(fixture.shutdownRequests).toEqual([["server-moved", 0]]);

    const explicit = await createFixture({
      serverUrl: "http://127.0.0.1:38886",
    });
    await writeFile(
      join(explicit.dataDir, "config.json"),
      JSON.stringify({ serverUrl: "http://127.0.0.1:38886", ...machineConfig }),
    );
    await explicit.service.handleServerMoved({
      source: "message",
      serverUrl: "https://studio.example.test",
      headers: {},
    });
    expect(await readJson(join(explicit.dataDir, "config.json"))).toEqual({
      serverUrl: "https://studio.example.test",
    });
  });

  it.each<{ name: string; notice: ServerMovedNotice }>([
    {
      name: "a URL with a newline",
      notice: {
        source: "message" as const,
        serverUrl:
          "http://studio.example.test:38886\nExecStartPre=/bin/rm -rf /",
        headers: {},
      },
    },
    {
      name: "a URL with credentials",
      notice: {
        source: "message" as const,
        serverUrl: "https://user:secret@studio.example.test",
        headers: {},
      },
    },
    {
      name: "a non-http URL",
      notice: {
        source: "message" as const,
        serverUrl: "file:///etc/passwd",
        headers: {},
      },
    },
    {
      name: "a header name with a line break",
      notice: {
        source: "message" as const,
        serverUrl: "https://studio.example.test",
        headers: { "x-bb\r\nExecStart": "value" },
      },
    },
    {
      name: "a header value with a line break",
      notice: {
        source: "message" as const,
        serverUrl: "https://studio.example.test",
        headers: { "x-bb-connect-machine": "bbcm\nExecStart=/bin/sh" },
      },
    },
  ])(
    "rejects $name without touching config or the unit",
    async ({ notice }) => {
      const fixture = await createFixture({
        env: {},
        serverUrl: "http://old-server:38886",
      });
      const config = JSON.stringify({ serverUrl: "http://old-server:38886" });
      await writeFile(join(fixture.dataDir, "config.json"), config);
      const unitPath = await writeSystemdUnit({
        homeDir: fixture.homeDir,
        dataDir: fixture.dataDir,
        execStart: DAEMON_ONLY_EXEC_START,
      });
      const unit = await readFile(unitPath, "utf8");

      await expect(
        fixture.service.handleServerMoved(notice),
      ).rejects.toMatchObject({ code: "server_move_invalid_address" });

      expect(await readFile(join(fixture.dataDir, "config.json"), "utf8")).toBe(
        config,
      );
      expect(await readFile(unitPath, "utf8")).toBe(unit);
      expect(fixture.commands).toEqual([]);
      expect(fixture.shutdownRequests).toEqual([]);
    },
  );

  it("leaves a bb-app start unit alone and exits so the launcher switches", async () => {
    const fixture = await createFixture({
      env: {},
      serverUrl: "http://127.0.0.1:38886",
    });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: `"/usr/bin/node" "/opt/npm/bin/bb-app" "start" "--data-dir" "${fixture.dataDir}" "--server-port" "38886" "--host-daemon-port" "38887"`,
    });
    const unit = await readFile(unitPath, "utf8");

    await fixture.service.handleServerMoved({
      source: "message",
      serverUrl: "https://third.example.test",
      headers: {},
    });

    expect(await readFile(unitPath, "utf8")).toBe(unit);
    expect(fixture.commands).toEqual([]);
    expect(fixture.shutdownRequests).toEqual([["server-moved", 0]]);
  });

  it("spawns the replacement host daemon through the npm prefix launcher with the normalized address", async () => {
    const fixture = await createFixture({
      serverUrl: "http://old-server.example.test:38886",
      autoUpdate: true,
    });
    const service = fixture.createService({
      env: {
        BB_SERVER_MOVE_SERVICE_MANAGER: "none",
        BB_APP_NPM_PREFIX: fixture.npmPrefix,
        INVOCATION_ID: "inherited-from-a-terminal",
      },
    });
    await writeFile(
      join(fixture.dataDir, "install-daemon.pid"),
      `${PARENT_PID}\n`,
    );

    await service.handleServerMoved({
      source: "session-open",
      serverUrl: "http://studio.example.test:38886/",
      headers: null,
      toHostName: "studio",
      movedAt: 1_700_000_000_000,
    });

    expect(fixture.detachedRequests).toEqual([
      {
        command: process.execPath,
        args: [
          join(fixture.npmPrefix, "bin", "bb-app"),
          "host-daemon",
          "--auto-update",
          "--host-daemon-port",
          "38887",
          "--server-url",
          "http://studio.example.test:38886",
        ],
        env: expect.objectContaining({
          BB_DATA_DIR: fixture.dataDir,
          BB_APP_NPM_PREFIX: fixture.npmPrefix,
        }),
        logPath: join(fixture.dataDir, "logs", "server-move.log"),
      },
    ]);
    expect(fixture.shutdownRequests).toEqual([["server-moved", 0]]);
    expect(
      await readFile(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    ).toBe("999999\n");
  });

  it.each([
    { name: "systemd", env: { INVOCATION_ID: "0123456789abcdef" } },
    {
      name: "launchd",
      env: { XPC_SERVICE_NAME: "com.example.custom-bb-daemon" },
    },
  ])(
    "only rewrites config.json and exits under an unrecognized $name supervisor",
    async ({ env }) => {
      const fixture = await createFixture({
        env: { BB_SERVER_MOVE_SERVICE_MANAGER: "none", ...env },
        serverUrl: "http://old-server.example.test:38886",
      });

      await fixture.service.handleServerMoved({
        source: "message",
        serverUrl: "http://studio.example.test:38886",
        headers: {},
      });

      expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
        serverUrl: "http://studio.example.test:38886",
      });
      expect(fixture.detachedRequests).toEqual([]);
      expect(fixture.shutdownRequests).toEqual([["server-moved", 0]]);
    },
  );

  it("exits for the moved-mode launcher when this data dir holds the old server copy", async () => {
    const fixture = await createFixture({
      serverUrl: "http://studio.example.test:38886",
    });
    await writeServerMovedFile(fixture.dataDir, {
      version: 1,
      moveId: MOVE_ID,
      movedAt: 1_700_000_000_000,
      fromHostId: "host-source",
      toHostId: "host-target",
      toHostName: "studio",
      serverUrl: "http://studio.example.test:38886",
      mode: "direct",
      connectHandle: null,
      oldCopyEntries: ["bb.db"],
    });

    await fixture.service.handleServerMoved({
      source: "message",
      serverUrl: "http://third.example.test:38886",
      headers: {},
    });

    expect(await readJson(join(fixture.dataDir, "config.json"))).toEqual({
      serverUrl: "http://third.example.test:38886",
    });
    expect(fixture.detachedRequests).toEqual([]);
    expect(fixture.shutdownRequests).toEqual([["server-moved", 0]]);
  });
});
