import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceDefinition } from "./service-definition.js";
import {
  LAUNCHD_RESTART_SCRIPT,
  restartService,
  type DetachedSpawnRequest,
  type ServerMoveCommandRunner,
} from "./service-manager.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function definition(
  manager: ServiceDefinition["manager"],
  unitName: string,
): ServiceDefinition {
  return {
    manager,
    path: `/services/${unitName}`,
    unitName,
    programArguments: ["node", "bb-app", "start"],
    environment: { BB_DATA_DIR: "/data" },
    content: "",
  };
}

describe("restartService", () => {
  it.each([
    ["systemd-user", "--user"],
    ["systemd-system", "--system"],
  ] as const)(
    "reloads and restarts a %s unit without blocking on its own stop",
    async (manager, scope) => {
      const commands: string[][] = [];
      const runCommand: ServerMoveCommandRunner = async (command, args) => {
        commands.push([command, ...args]);
      };
      const spawnDetached = vi.fn(async () => 1);

      await restartService({
        definition: definition(manager, "bb-host-daemon-old-me.service"),
        runCommand,
        spawnDetached,
        uid: 1000,
        env: {},
        logPath: "/data/logs/server-move.log",
      });

      expect(commands).toEqual([
        ["systemctl", scope, "daemon-reload"],
        [
          "systemctl",
          scope,
          "restart",
          "--no-block",
          "bb-host-daemon-old-me.service",
        ],
      ]);
      expect(spawnDetached).not.toHaveBeenCalled();
    },
  );

  it("does not restart when daemon-reload fails", async () => {
    const commands: string[][] = [];
    const runCommand: ServerMoveCommandRunner = async (command, args) => {
      commands.push([command, ...args]);
      throw new Error("Failed to connect to bus");
    };

    await expect(
      restartService({
        definition: definition("systemd-user", "bb-host-daemon-x.service"),
        runCommand,
        spawnDetached: vi.fn(async () => 1),
        uid: 1000,
        env: {},
        logPath: "/data/logs/server-move.log",
      }),
    ).rejects.toThrow("Failed to connect to bus");
    expect(commands).toEqual([["systemctl", "--user", "daemon-reload"]]);
  });

  it("hands a launch agent restart to a detached helper that boots out then bootstraps", async () => {
    const requests: DetachedSpawnRequest[] = [];
    const runCommand = vi.fn<ServerMoveCommandRunner>(async () => undefined);

    await restartService({
      definition: {
        ...definition("launchd", "app.getbb.host-daemon.old-me"),
        path: "/Users/me/Library/LaunchAgents/app.getbb.host-daemon.old-me.plist",
      },
      runCommand,
      spawnDetached: async (request) => {
        requests.push(request);
        return 4242;
      },
      uid: 501,
      env: { HOME: "/Users/me" },
      logPath: "/data/logs/server-move.log",
    });

    expect(runCommand).not.toHaveBeenCalled();
    expect(requests).toEqual([
      {
        command: "/bin/sh",
        args: [
          "-c",
          LAUNCHD_RESTART_SCRIPT,
          "bb-server-move-restart",
          "gui/501",
          "/Users/me/Library/LaunchAgents/app.getbb.host-daemon.old-me.plist",
        ],
        env: { HOME: "/Users/me" },
        logPath: "/data/logs/server-move.log",
      },
    ]);
  });

  it("runs launchctl bootout before bootstrap in the helper script", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-launchd-helper-test-"));
    roots.push(root);
    const callsPath = join(root, "calls.log");
    const launchctlPath = join(root, "launchctl");
    await writeFile(
      launchctlPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${callsPath}"\n`,
    );
    await chmod(launchctlPath, 0o755);

    await execFileAsync(
      "/bin/sh",
      [
        "-c",
        LAUNCHD_RESTART_SCRIPT,
        "bb-server-move-restart",
        "gui/501",
        "/Users/me/Library/LaunchAgents/app.plist",
      ],
      { env: { PATH: `${root}${delimiter}${process.env.PATH ?? ""}` } },
    );

    expect((await readFile(callsPath, "utf8")).trim().split("\n")).toEqual([
      "bootout gui/501 /Users/me/Library/LaunchAgents/app.plist",
      "bootstrap gui/501 /Users/me/Library/LaunchAgents/app.plist",
    ]);
  });
});
