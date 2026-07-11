import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = new URL(
  "../../src/assets/install-machine.sh",
  import.meta.url,
);
const createdDirectories: string[] = [];

function createFixture(): { binDir: string; dataDir: string; homeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "bb-install-script-test-"));
  createdDirectories.push(root);
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const homeDir = join(root, "home");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  return { binDir, dataDir, homeDir };
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function runScript(args: string[], fixture: ReturnType<typeof createFixture>) {
  return spawnSync("sh", [SCRIPT_PATH.pathname, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BB_DATA_DIR: fixture.dataDir,
      HOME: fixture.homeDir,
      PATH: `${fixture.binDir}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

function writeJoinedState(
  fixture: ReturnType<typeof createFixture>,
  serverUrl = "https://machine.getbb.app",
  hostId = "host-test",
): void {
  writeFileSync(
    join(fixture.dataDir, "auth.json"),
    JSON.stringify({ hostId, hostKey: "secret", hostType: "persistent" }),
  );
  writeFileSync(
    join(fixture.dataDir, "config.json"),
    JSON.stringify({ serverUrl }),
  );
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("machine install script", () => {
  it("rejects missing required flags with usage", () => {
    const fixture = createFixture();
    const result = runScript(["--join-code", "code-only"], fixture);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Usage: install.sh --join-code <code> --host-id <host-id> --server <url>",
    );
  });

  it("uses bb-app from PATH and passes the launcher join flags verbatim", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeExecutable(
      join(fixture.binDir, "bb-app"),
      `#!/bin/sh
printf '%s\n' "$@" >"${invocationPath}"
printf '%s\n' '{"hostId":"host-test","hostKey":"secret","hostType":"persistent"}' >"$BB_DATA_DIR/auth.json"
printf '%s\n' '{"serverUrl":"https://machine.getbb.app"}' >"$BB_DATA_DIR/config.json"
while :; do sleep 1; done
`,
    );
    const result = spawnSync(
      "sh",
      [
        SCRIPT_PATH.pathname,
        "--join-code",
        "join-secret",
        "--host-id",
        "host-test",
        "--server",
        "https://machine.getbb.app",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BB_DATA_DIR: fixture.dataDir,
          BB_INSTALL_SKIP_SERVICE: "1",
          HOME: fixture.homeDir,
          PATH: `${fixture.binDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(invocationPath, "utf8").trim().split("\n")).toEqual([
      "host-daemon",
      "join",
      "--join-code",
      "join-secret",
      "--host-id",
      "host-test",
      "--server-url",
      "https://machine.getbb.app",
    ]);
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("redeems and persists a connect machine code before joining through the tunnel", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeExecutable(
      join(fixture.binDir, "curl"),
      '#!/bin/sh\nprintf \'%s\' \'{"credential":"bbcm_durable","machineId":"machine-1"}\'\n',
    );
    writeExecutable(
      join(fixture.binDir, "bb-app"),
      `#!/bin/sh
printf '%s\n' "$@" >"${invocationPath}"
printf '%s\n' '{"hostId":"host-test","hostKey":"secret","hostType":"persistent"}' >"$BB_DATA_DIR/auth.json"
while :; do sleep 1; done
`,
    );
    const result = spawnSync(
      "sh",
      [
        SCRIPT_PATH.pathname,
        "--join-code",
        "join-secret",
        "--host-id",
        "host-test",
        "--server",
        "https://sawyer.getbb.app",
        "--machine-code",
        "MACH-INE1",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BB_DATA_DIR: fixture.dataDir,
          BB_INSTALL_SKIP_SERVICE: "1",
          HOME: fixture.homeDir,
          PATH: `${fixture.binDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(invocationPath, "utf8")).toContain(
      "--machine-credential\nbbcm_durable",
    );
    expect(
      JSON.parse(readFileSync(join(fixture.dataDir, "config.json"), "utf8")),
    ).toEqual({
      machineCredential: "bbcm_durable",
      serverUrl: "https://sawyer.getbb.app",
    });
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("installs an idempotent macOS launch agent for joined state", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeExecutable(join(fixture.binDir, "bb-app"), "#!/bin/sh\nexit 99\n");
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
`,
    );

    const result = runScript(
      [
        "--join-code",
        "unused-fresh-code",
        "--host-id",
        "host-test",
        "--server",
        "https://machine.getbb.app",
      ],
      fixture,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already joined");
    const plist = readFileSync(
      join(fixture.homeDir, "Library/LaunchAgents/app.getbb.host-daemon.plist"),
      "utf8",
    );
    expect(plist).toContain("<string>host-daemon</string>");
    expect(plist).toContain("<string>https://machine.getbb.app</string>");
    expect(
      readFileSync(join(fixture.dataDir, "launchctl.log"), "utf8"),
    ).toContain("bootstrap");
  });

  it("installs an idempotent Linux systemd user unit for joined state", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeExecutable(join(fixture.binDir, "bb-app"), "#!/bin/sh\nexit 99\n");
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Linux\n");
    writeExecutable(
      join(fixture.binDir, "systemctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "systemctl.log")}"
`,
    );

    const result = runScript(
      [
        "--join-code",
        "unused-fresh-code",
        "--host-id",
        "host-test",
        "--server",
        "https://machine.getbb.app",
      ],
      fixture,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already joined");
    const unit = readFileSync(
      join(fixture.homeDir, ".config/systemd/user/bb-host-daemon.service"),
      "utf8",
    );
    expect(unit).toContain(
      'host-daemon --server-url "https://machine.getbb.app"',
    );
    expect(readFileSync(join(fixture.dataDir, "systemctl.log"), "utf8")).toBe(
      "--user daemon-reload\n--user enable --now bb-host-daemon.service\n",
    );
  });
});
