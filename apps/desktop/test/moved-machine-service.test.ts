import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  keepMovedMachineConnected,
  runMachineInstaller,
  type MachineInstallResult,
} from "../src/moved-machine-service.js";
import {
  createServerMoveNoticeStore,
  type DesktopServerMove,
  type ServerMovedNotice,
} from "../src/server-moved.js";

const tempDirs: string[] = [];

const MOVE: DesktopServerMove = {
  moveId: "move-1",
  target: {
    kind: "connect",
    server: {
      handle: "desk",
      name: "Studio desktop",
      url: "https://desk.getbb.app",
    },
  },
  toHostName: "Studio desktop",
};

const FAKE_INSTALLER = `#!/bin/sh
printf 'args %s\\n' "$*"
if [ "\${FAKE_INSTALLER_FAIL:-}" = 1 ]; then
  printf '  %s  %s\\n' '✗' 'Node.js 20.18.1 is too old; bb-app requires Node.js 22.19 or newer.' >&2
  exit 1
fi
printf '  %s  %s\\n' '●' 'bb machine is ready'
`;

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-desktop-machine-service-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFakeInstaller(dir: string): Promise<string> {
  const installerPath = join(dir, "install-machine.sh");
  await writeFile(installerPath, FAKE_INSTALLER);
  return installerPath;
}

function createHarness(args: {
  dir: string;
  install: () => Promise<MachineInstallResult>;
  service: string | null;
}) {
  const events: string[] = [];
  const notices: ServerMovedNotice[] = [];
  return {
    events,
    notices,
    keep: () =>
      keepMovedMachineConnected({
        findService: async () => args.service,
        install: async () => {
          events.push("install");
          return args.install();
        },
        logInfo: () => undefined,
        logPath: join(args.dir, "install-machine-service.log"),
        move: MOVE,
        noticeStore: createServerMoveNoticeStore({
          storagePath: join(args.dir, "machine-service-notice.json"),
        }),
        showNotice: (notice) => {
          notices.push(notice);
        },
        stopLocalRuntime: async () => {
          events.push("stop");
        },
      }),
  };
}

describe("runMachineInstaller", () => {
  it("adopts the data directory and appends the installer output to its log", async () => {
    const dir = await createTempDir();
    const logPath = join(dir, "logs", "install-machine-service.log");

    await expect(
      runMachineInstaller({
        dataDir: join(dir, "data"),
        env: process.env,
        installerPath: await writeFakeInstaller(dir),
        logPath,
      }),
    ).resolves.toEqual({ ok: true });

    expect(await readFile(logPath, "utf8")).toBe(
      `args --adopt --data-dir ${join(dir, "data")}\n  ●  bb machine is ready\n`,
    );
  });

  it("reports this run's installer failure line", async () => {
    const dir = await createTempDir();
    const logPath = join(dir, "install-machine-service.log");
    await writeFile(logPath, "  ✗  An earlier failure.\n");

    await expect(
      runMachineInstaller({
        dataDir: join(dir, "data"),
        env: { ...process.env, FAKE_INSTALLER_FAIL: "1" },
        installerPath: await writeFakeInstaller(dir),
        logPath,
      }),
    ).resolves.toEqual({
      ok: false,
      reason:
        "Node.js 20.18.1 is too old; bb-app requires Node.js 22.19 or newer.",
    });
  });

  it("describes an installer that exits without a failure line", async () => {
    const dir = await createTempDir();
    const installerPath = join(dir, "install-machine.sh");
    await writeFile(
      installerPath,
      "printf '%s\\n' 'npm ERR! network'\nexit 3\n",
    );

    await expect(
      runMachineInstaller({
        dataDir: join(dir, "data"),
        env: process.env,
        installerPath,
        logPath: join(dir, "install-machine-service.log"),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "The installer exited with code 3.",
    });
  });
});

describe("keepMovedMachineConnected", () => {
  it("leaves an installed service alone", async () => {
    const dir = await createTempDir();
    const harness = createHarness({
      dir,
      install: async () => ({ ok: true }),
      service: "/Users/me/Library/LaunchAgents/app.getbb.host-daemon.me.plist",
    });

    await expect(harness.keep()).resolves.toBe("existing-service");
    expect(harness.events).toEqual([]);
  });

  it("stops the app's own runtime before installing the service", async () => {
    const dir = await createTempDir();
    const harness = createHarness({
      dir,
      install: async () => ({ ok: true }),
      service: null,
    });

    await expect(harness.keep()).resolves.toBe("installed");
    expect(harness.events).toEqual(["stop", "install"]);
    expect(harness.notices).toEqual([]);
  });

  it("explains a failed install once per move", async () => {
    const dir = await createTempDir();
    const harness = createHarness({
      dir,
      install: async () => ({
        ok: false,
        reason: "Node.js 20.18.1 is too old.",
      }),
      service: null,
    });

    await expect(harness.keep()).resolves.toBe("install-failed");
    await expect(harness.keep()).resolves.toBe("install-failed");

    expect(harness.events).toEqual(["stop", "install", "stop", "install"]);
    expect(harness.notices).toEqual([
      {
        detail: `bb couldn't install the background service that keeps this computer connected and up to date: Node.js 20.18.1 is too old. bb tries again the next time it opens. The installer log is ${join(dir, "install-machine-service.log")}.`,
        message:
          "This computer stays connected to Studio desktop only while bb is open",
      },
    ]);
  });
});
