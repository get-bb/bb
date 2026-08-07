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
import { createServer as createNetServer } from "node:net";
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

function runScript(
  args: string[],
  fixture: ReturnType<typeof createFixture>,
  env: Record<string, string> = {},
) {
  return spawnSync("sh", [SCRIPT_PATH.pathname, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BB_DATA_DIR: fixture.dataDir,
      HOME: fixture.homeDir,
      PATH: `${fixture.binDir}${delimiter}${process.env.PATH ?? ""}`,
      ...env,
    },
  });
}

const JOIN_ARGS = [
  "--join-code",
  "join-secret",
  "--host-id",
  "host-test",
  "--server",
  "https://machine.getbb.app",
];

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

function createEnrollingBbAppScript(args: {
  hostId: string;
  invocationPath?: string;
}): string {
  const recordInvocation =
    args.invocationPath === undefined
      ? ""
      : `fs.writeFileSync(${JSON.stringify(args.invocationPath)}, cliArgs.join("\\n") + "\\n");`;
  return `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const cliArgs = process.argv.slice(2);
const option = (name) => {
  const index = cliArgs.indexOf(name);
  return index === -1 ? undefined : cliArgs[index + 1];
};
${recordInvocation}
const dataDir = process.env.BB_DATA_DIR;
const hostId = ${JSON.stringify(args.hostId)};
const port = Number(option("--host-daemon-port"));
const serverUrl = option("--server-url");
fs.writeFileSync(
  path.join(dataDir, "auth.json"),
  JSON.stringify({ hostId, hostKey: "secret", hostType: "persistent" }) + "\\n",
);
const configPath = path.join(dataDir, "config.json");
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ serverUrl }) + "\\n");
}
const server = http.createServer((request, response) => {
  if (request.url !== "/status") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ connected: true, hostId, serverUrl }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
}

// Mocks curl to serve the redeem endpoint and answer the bb-app tarball
// download with the given status; npm records invocations and fabricates a
// bb-app that enrolls into whatever BB_DATA_DIR the script hands it.
function writeServerInstallTools(
  fixture: ReturnType<typeof createFixture>,
  artifactStatus: 200 | 404,
): void {
  const npmLog = join(fixture.dataDir, "npm.log");
  const bbAppPath = join(fixture.binDir, "bb-app");
  writeExecutable(
    join(fixture.binDir, "curl"),
    `#!/bin/sh
case "$*" in
  *redeem-machine*) printf '%s' '{"credential":"bbcm_durable","machineId":"machine-1"}' ;;
  *)
    output=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then output=$2; shift 2; else shift; fi
    done
    [ -z "$output" ] || printf '%s' 'fixture-tarball' >"$output"
    printf '%s' '${artifactStatus}'
    ;;
esac
`,
  );
  const bbAppTemplatePath = join(fixture.dataDir, "bb-app-template");
  writeExecutable(
    bbAppTemplatePath,
    createEnrollingBbAppScript({ hostId: "host-test" }),
  );
  writeExecutable(
    join(fixture.binDir, "npm"),
    `#!/bin/sh
printf '%s\n' "$*" >>"${npmLog}"
cp "${bbAppTemplatePath}" "${bbAppPath}"
chmod +x "${bbAppPath}"
`,
  );
}

function writeEnrollingBbApp(
  fixture: ReturnType<typeof createFixture>,
  invocationPath: string,
  hostId = "host-test",
): void {
  writeExecutable(
    join(fixture.binDir, "bb-app"),
    createEnrollingBbAppScript({ hostId, invocationPath }),
  );
}

function writeCurlArtifactMock(
  fixture: ReturnType<typeof createFixture>,
  artifactStatus: number,
): void {
  writeExecutable(
    join(fixture.binDir, "curl"),
    `#!/bin/sh
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output=$2; shift 2; else shift; fi
done
[ -z "$output" ] || printf '%s' 'fixture-tarball' >"$output"
printf '%s' '${artifactStatus}'
`,
  );
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    try {
      const servicePid = Number(
        readFileSync(join(directory, "data/service-daemon.pid"), "utf8"),
      );
      process.kill(servicePid, "SIGTERM");
    } catch {}
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

  it("rejects an invalid explicit host-daemon port", () => {
    const fixture = createFixture();
    const result = runScript(
      [...JOIN_ARGS, "--host-daemon-port", "0"],
      fixture,
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "--host-daemon-port must be an integer between 1 and 65535",
    );
  });

  it("uses bb-app from PATH and passes the launcher join flags verbatim", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, invocationPath);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    const selectedPort = readFileSync(
      join(fixture.dataDir, "host-daemon-port"),
      "utf8",
    ).trim();
    expect(readFileSync(invocationPath, "utf8").trim().split("\n")).toEqual([
      "host-daemon",
      "join",
      "--auto-update",
      "--host-daemon-port",
      selectedPort,
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

  it("installs the server tarball even when a same-version bb-app is on PATH", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    // A stale build with the same version string must not be reused.
    writeExecutable(join(fixture.binDir, "bb-app"), "#!/bin/sh\nexit 99\n");
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    const npmInvocation = readFileSync(
      join(fixture.dataDir, "npm.log"),
      "utf8",
    );
    expect(npmInvocation).toMatch(/^install -g \/.*bb-app\..*\.tgz$/mu);
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("prefers the server-matched tarball when bb-app is absent", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    const npmInvocation = readFileSync(
      join(fixture.dataDir, "npm.log"),
      "utf8",
    );
    expect(npmInvocation).toMatch(/^install -g \/.*bb-app\..*\.tgz$/mu);
    expect(npmInvocation).not.toContain("bb-app\n");
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("falls back to npm only when the server artifact returns 404", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 404);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(fixture.dataDir, "npm.log"), "utf8")).toBe(
      "install -g bb-app\n",
    );
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("defaults the data dir to a per-server directory under ~/.bb-machines", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_DATA_DIR: "",
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    const defaultDataDir = join(
      fixture.homeDir,
      ".bb-machines/machine.getbb.app",
    );
    expect(
      JSON.parse(readFileSync(join(defaultDataDir, "auth.json"), "utf8")),
    ).toMatchObject({ hostId: "host-test" });
    const daemonPid = Number(
      readFileSync(join(defaultDataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("refuses a data dir enrolled for a different host instead of faking success", () => {
    const fixture = createFixture();
    writeCurlArtifactMock(fixture, 404);
    writeExecutable(join(fixture.binDir, "bb-app"), "#!/bin/sh\nexit 99\n");
    writeJoinedState(fixture, "https://machine.getbb.app", "host-other");
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("credentials for a different host");
    expect(result.stdout).not.toContain("Joined successfully");
  });

  it("assigns a different port when the first enrolled-daemon port is occupied", async () => {
    const occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(38888, "127.0.0.1", resolve);
    });
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, invocationPath);

    try {
      const result = runScript(JOIN_ARGS, fixture, {
        BB_INSTALL_SKIP_SERVICE: "1",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(
        readFileSync(join(fixture.dataDir, "host-daemon-port"), "utf8"),
      ).toBe("38889\n");
      expect(readFileSync(invocationPath, "utf8")).toContain(
        "--host-daemon-port\n38889\n",
      );
      const daemonPid = Number(
        readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
      );
      process.kill(daemonPid, "SIGTERM");
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("redeems and persists a connect machine code before joining through the tunnel", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeServerInstallTools(fixture, 404);
    writeEnrollingBbApp(fixture, invocationPath);
    const result = runScript(
      [
        "--join-code",
        "join-secret",
        "--host-id",
        "host-test",
        "--server",
        "https://sawyer.getbb.app",
        "--machine-code",
        "MACH-INE1",
      ],
      fixture,
      { BB_INSTALL_SKIP_SERVICE: "1" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(invocationPath, "utf8")).not.toContain("bbcm_durable");
    expect(readFileSync(invocationPath, "utf8")).not.toContain(
      "--machine-credential",
    );
    expect(
      JSON.parse(readFileSync(join(fixture.dataDir, "config.json"), "utf8")),
    ).toMatchObject({
      connectMachineId: "machine-1",
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
    writeFileSync(join(fixture.dataDir, "host-daemon-port"), "42111\n");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, join(fixture.dataDir, "service-invocation"));
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
if [ "$1" = kickstart ]; then
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.binDir, "bb-app")}" host-daemon --host-daemon-port 42111 --server-url https://machine.getbb.app >/dev/null 2>&1 &
  echo $! >"${join(fixture.dataDir, "service-daemon.pid")}"
fi
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

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("already joined");
    const plist = readFileSync(
      join(
        fixture.homeDir,
        "Library/LaunchAgents/app.getbb.host-daemon.machine-getbb-app.plist",
      ),
      "utf8",
    );
    expect(plist).toContain(
      "<string>app.getbb.host-daemon.machine-getbb-app</string>",
    );
    expect(plist).toContain("<string>host-daemon</string>");
    expect(plist).toContain("<string>--auto-update</string>");
    expect(plist).toContain(
      "<string>--host-daemon-port</string>\n    <string>42111</string>",
    );
    expect(plist).toContain("<string>https://machine.getbb.app</string>");
    expect(
      readFileSync(join(fixture.dataDir, "launchctl.log"), "utf8"),
    ).toContain("bootstrap");
  });

  it("installs an idempotent Linux systemd user unit for joined state", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeFileSync(join(fixture.dataDir, "host-daemon-port"), "42112\n");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, join(fixture.dataDir, "service-invocation"));
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Linux\n");
    writeExecutable(
      join(fixture.binDir, "systemctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "systemctl.log")}"
if [ "$*" = "--user enable --now bb-host-daemon-machine-getbb-app.service" ]; then
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.binDir, "bb-app")}" host-daemon --host-daemon-port 42112 --server-url https://machine.getbb.app >/dev/null 2>&1 &
  echo $! >"${join(fixture.dataDir, "service-daemon.pid")}"
fi
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

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("already joined");
    const unit = readFileSync(
      join(
        fixture.homeDir,
        ".config/systemd/user/bb-host-daemon-machine-getbb-app.service",
      ),
      "utf8",
    );
    expect(unit).toContain(
      'host-daemon --auto-update --host-daemon-port "42112" --server-url "https://machine.getbb.app"',
    );
    expect(readFileSync(join(fixture.dataDir, "systemctl.log"), "utf8")).toBe(
      "--user daemon-reload\n--user enable --now bb-host-daemon-machine-getbb-app.service\n",
    );
  });
});
