import { spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import {
  readServerMovedFile,
  type ServerMovedFile,
  writeServerMovedFile,
} from "@bb/server-archive";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";

const tempDirs: string[] = [];
const children: ChildProcess[] = [];

const register: CommandRegistrar = (program) =>
  registerServerCommands(
    program.enablePositionalOptions(),
    () => "http://server",
  );

const FAKE_INSTALLER = `#!/bin/sh
printf '%s\\n' "$@" >"$FAKE_INSTALLER_LOG"
data_dir=$3
case "$(uname -s)" in
  Darwin)
    mkdir -p "$HOME/Library/LaunchAgents"
    printf '<plist><dict><key>EnvironmentVariables</key><dict><key>BB_DATA_DIR</key><string>%s</string></dict></dict></plist>\\n' "$data_dir" >"$HOME/Library/LaunchAgents/app.getbb.host-daemon.test.plist"
    ;;
  *)
    mkdir -p "$HOME/.config/systemd/user"
    printf '[Service]\\nEnvironment="BB_DATA_DIR=%s"\\n' "$data_dir" >"$HOME/.config/systemd/user/bb-host-daemon-test.service"
    ;;
esac
exit "\${FAKE_INSTALLER_EXIT:-0}"
`;

interface Fixture {
  dataDir: string;
  homeDir: string;
  installerLog: string;
  root: string;
}

function movedLock(): ServerMovedFile {
  return {
    version: 1,
    moveId: "move-1",
    movedAt: 1_700_000_000_000,
    fromHostId: "host-laptop",
    toHostId: "host-desktop",
    toHostName: "desktop",
    serverUrl: "https://me.getbb.app",
    mode: "connect",
    connectHandle: "me",
    oldCopyEntries: ["bb.db"],
  };
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "bb-cli-machine-service-"));
  tempDirs.push(root);
  const dataDir = join(root, "data");
  const homeDir = join(root, "home");
  await mkdir(dataDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeServerMovedFile(dataDir, movedLock());
  await writeFile(
    join(dataDir, "auth.json"),
    JSON.stringify({ hostId: "host-laptop", hostKey: "secret" }),
  );
  await writeFile(
    join(dataDir, "config.json"),
    JSON.stringify({
      serverUrl: "https://me.getbb.app",
      serverHeaders: { "x-bb-connect-machine": "grant-secret" },
    }),
  );
  const installerPath = join(root, "install-machine.sh");
  await writeFile(installerPath, FAKE_INSTALLER);
  const installerLog = join(root, "installer.log");
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("BB_MACHINE_INSTALLER", installerPath);
  vi.stubEnv("FAKE_INSTALLER_LOG", installerLog);
  return { dataDir, homeDir, installerLog, root };
}

async function startRecordedBb(fixture: Fixture): Promise<ChildProcess> {
  const entryPath = join(fixture.root, "bb-app.js");
  await writeFile(entryPath, "setInterval(() => {}, 1000);\n");
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [entryPath], { stdio: "ignore" });
  children.push(child);
  await writeFile(
    join(fixture.dataDir, "bb-app-runtime.json"),
    JSON.stringify({
      entryPath,
      pid: child.pid,
      serverUrl: "http://127.0.0.1:38886",
      startedAt,
      surface: "desktop",
      version: "0.43.4",
    }),
  );
  return child;
}

afterAll(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("bb server install-machine-service", () => {
  setupCommandOutputTestEnvironment();

  it("stops the bb running from the data directory and installs the service for it", async () => {
    const fixture = await createFixture();
    const bb = await startRecordedBb(fixture);
    const bbExit = new Promise<NodeJS.Signals | null>((resolvePromise) => {
      bb.once("exit", (_code, signal) => resolvePromise(signal));
    });

    await runCommand(
      [
        "server",
        "install-machine-service",
        "--data-dir",
        fixture.dataDir,
        "--yes",
        "--json",
      ],
      register,
    );

    await expect(bbExit).resolves.toBe("SIGTERM");
    await expect(readBbAppRuntimeFile(fixture.dataDir)).resolves.toBeNull();
    expect(
      (await readFile(fixture.installerLog, "utf8")).trim().split("\n"),
    ).toEqual(["--adopt", "--data-dir", fixture.dataDir]);
    const result = JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!);
    expect(result).toEqual({
      dataDir: fixture.dataDir,
      serverUrl: "https://me.getbb.app",
      serviceFile: expect.stringContaining(fixture.homeDir),
      toHostName: "desktop",
    });
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Stopped bb on this computer (pid ${String(bb.pid)}).`,
    ]);
    expect(await readServerMovedFile(fixture.dataDir)).toEqual(movedLock());
  });

  it("refuses a data directory that no server moved away from", async () => {
    const fixture = await createFixture();
    await rm(join(fixture.dataDir, "server-moved.json"));

    await expect(
      runCommand(
        [
          "server",
          "install-machine-service",
          "--data-dir",
          fixture.dataDir,
          "--yes",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: ${fixture.dataDir} is not locked by a server move. This command keeps a computer connected as a machine after its bb server moved to another machine.`,
    ]);
    await expect(readFile(fixture.installerLog, "utf8")).rejects.toThrow();
  });

  it("leaves bb running when node on the PATH is too old for the service", async () => {
    const fixture = await createFixture();
    const bb = await startRecordedBb(fixture);
    const binDir = join(fixture.root, "bin");
    await mkdir(binDir);
    await writeFile(
      join(binDir, "node"),
      "#!/bin/sh\nprintf '%s\\n' 20.18.1\n",
    );
    await chmod(join(binDir, "node"), 0o755);
    vi.stubEnv("PATH", [binDir, "/usr/bin", "/bin"].join(delimiter));

    await expect(
      runCommand(
        [
          "server",
          "install-machine-service",
          "--data-dir",
          fixture.dataDir,
          "--yes",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The background service runs bb with the node on your PATH, which is Node.js 20.18.1. Install Node.js 22.19 or newer, then run this command again.",
    ]);
    expect(bb.exitCode).toBeNull();
    expect(bb.signalCode).toBeNull();
    await expect(readFile(fixture.installerLog, "utf8")).rejects.toThrow();
  });

  it("reports an installer failure", async () => {
    const fixture = await createFixture();
    vi.stubEnv("FAKE_INSTALLER_EXIT", "1");
    readlineMocks.question.mockResolvedValue("y");

    await expect(
      runCommand(
        ["server", "install-machine-service", "--data-dir", fixture.dataDir],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Stop bb on this computer and install a background service that keeps it connected to desktop? [y/N] ",
    );
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The background service install failed; see the installer output above. Until it succeeds, this computer stays connected only while the bb desktop app or npx bb-app runs, so start one of them to reconnect it now.",
    ]);
  });
});

describe("bb server unlock with a machine service", () => {
  setupCommandOutputTestEnvironment();

  it("refuses while a background service runs this computer as a machine", async () => {
    const fixture = await createFixture();
    await runCommand(
      [
        "server",
        "install-machine-service",
        "--data-dir",
        fixture.dataDir,
        "--yes",
        "--json",
      ],
      register,
    );
    const { serviceFile } = JSON.parse(
      collectLogPayloads(vi.mocked(console.log))[0]!,
    );
    vi.mocked(console.error).mockClear();

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", fixture.dataDir, "--yes", "--force"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))[0]).toContain(
      `Error: A background service (${serviceFile}) runs this computer as a machine from ${fixture.dataDir}.`,
    );
    expect(await readServerMovedFile(fixture.dataDir)).toEqual(movedLock());
  });
});
