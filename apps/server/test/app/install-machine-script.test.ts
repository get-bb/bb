import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = new URL(
  "../../src/assets/install-machine.sh",
  import.meta.url,
);
const createdDirectories: string[] = [];
const FIXTURE_ARTIFACT_DIGEST = createHash("sha256")
  .update("fixture-tarball")
  .digest("hex");

function createFixture(): { binDir: string; dataDir: string; homeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "bb-install-script-test-"));
  createdDirectories.push(root);
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const homeDir = join(root, "home");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(root, "package.json"), '{"type":"commonjs"}\n');
  symlinkSync(process.execPath, join(binDir, "node"));
  return { binDir, dataDir, homeDir };
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

type Fixture = ReturnType<typeof createFixture>;

function createScriptEnv(
  fixture: Fixture,
  env: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BB_DATA_DIR: fixture.dataDir,
    HOME: fixture.homeDir,
    PATH: [fixture.binDir, "/usr/bin", "/bin"].join(delimiter),
    ...env,
  };
}

function runScript(
  args: string[],
  fixture: Fixture,
  env: Record<string, string | undefined> = {},
) {
  return spawnSync("sh", [SCRIPT_PATH.pathname, ...args], {
    encoding: "utf8",
    env: createScriptEnv(fixture, env),
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
  statusServerUrl?: string;
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
const statusServerUrl = ${JSON.stringify(args.statusServerUrl)} ?? serverUrl;
fs.writeFileSync(
  path.join(dataDir, "auth.json"),
  JSON.stringify({ hostId, hostKey: "secret" }) + "\\n",
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
  response.end(JSON.stringify({ connected: true, hostId, serverUrl: statusServerUrl }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
}

function writeServerInstallTools(
  fixture: ReturnType<typeof createFixture>,
  artifactStatus: 200 | 404,
  artifactDigest = FIXTURE_ARTIFACT_DIGEST,
): void {
  const curlLog = join(fixture.dataDir, "curl.log");
  const npmLog = join(fixture.dataDir, "npm.log");
  writeExecutable(
    join(fixture.binDir, "curl"),
    `#!/bin/sh
printf '%s\n' "$*" >>"${curlLog}"
case "$*" in
  *redeem-machine*) printf '%s' '{"credential":"bbcm_durable","machineId":"machine-1"}' ;;
  *)
    output=
    headers=
    unchanged=no
    case "$*" in *'If-None-Match: "sha256-${artifactDigest}"'*) unchanged=yes ;; esac
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then output=$2; shift 2
      elif [ "$1" = --dump-header ]; then headers=$2; shift 2
      else shift
      fi
    done
    [ -z "$headers" ] || printf '%s\n' 'HTTP/1.1 ${artifactStatus}' 'x-bb-artifact-sha256: ${artifactDigest}' >"$headers"
    if [ "$unchanged" = yes ] && [ '${artifactStatus}' = 200 ]; then
      printf '%s' 304
    else
      [ -z "$output" ] || printf '%s' 'fixture-tarball' >"$output"
      printf '%s' '${artifactStatus}'
    fi
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
prefix=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then prefix=$2; shift 2; else shift; fi
done
[ -n "$prefix" ] || exit 2
mkdir -p "$prefix/bin"
cp "${bbAppTemplatePath}" "$prefix/bin/bb-app"
chmod +x "$prefix/bin/bb-app"
cp "${bbAppTemplatePath}" "$prefix/bin/bb"
chmod +x "$prefix/bin/bb"
mkdir -p "$prefix/lib/node_modules/bb-app/host-daemon/dist"
printf '%s\n' 'fixture' >"$prefix/lib/node_modules/bb-app/host-daemon/dist/daemon-bundle.mjs"
for module in node-pty @parcel/watcher; do
  mkdir -p "$prefix/lib/node_modules/bb-app/node_modules/$module"
  if [ -z "$FAKE_NPM_SKIP_NATIVE_MODULES" ]; then
    printf '%s\n' 'module.exports = {};' >"$prefix/lib/node_modules/bb-app/node_modules/$module/index.js"
  fi
done
`,
  );
}

function writeEnrollingBbApp(
  fixture: ReturnType<typeof createFixture>,
  invocationPath: string,
  hostId = "host-test",
  statusServerUrl?: string,
): void {
  writeExecutable(
    join(fixture.binDir, "bb-app"),
    createEnrollingBbAppScript({ hostId, invocationPath, statusServerUrl }),
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
  if [ "$1" = --output ]; then output=$2; shift 2; else shift; fi
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
  it.each([
    { uid: 0, unset: true },
    { uid: 501, unset: true },
    { uid: 501, unset: false },
  ])(
    "resolves an unset HOME and preserves explicit HOME: %j",
    ({ uid, unset }) => {
      const fixture = createFixture();
      const homeScript =
        'const home = require("node:os").homedir(); if (!require("node:path").isAbsolute(home)) process.exit(1); process.stdout.write(home);';
      rmSync(join(fixture.binDir, "node"));
      writeExecutable(
        join(fixture.binDir, "node"),
        `#!/bin/sh
if [ "$1" = -e ] && [ "$2" = '${homeScript}' ]; then
  : >'${join(fixture.dataDir, "resolved-home")}'
  printf '%s' '${fixture.homeDir}'
  exit 0
fi
exec '${process.execPath}' "$@"
`,
      );
      writeExecutable(join(fixture.binDir, "id"), `#!/bin/sh\necho ${uid}\n`);
      writeCurlArtifactMock(fixture, 404);
      const result = runScript(JOIN_ARGS, fixture, {
        HOME: unset ? undefined : fixture.homeDir,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("HOME");
      expect(existsSync(join(fixture.dataDir, "resolved-home"))).toBe(unset);
      expect(existsSync(join(fixture.homeDir, ".local/bin/bb"))).toBe(true);
      expect(existsSync(join(fixture.dataDir, "auth.json"))).toBe(false);
    },
  );

  it("rejects missing required flags with usage", () => {
    const fixture = createFixture();
    const result = runScript(["--join-code", "code-only"], fixture);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Usage: install.sh --join-code <code> --host-id <host-id> --server <url>",
    );
  });

  it("stops and uninstalls an owned Linux service through installer flags", () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.homeDir, ".bb-machines", "owned"), {
      recursive: true,
    });
    const dataDir = realpathSync(
      join(fixture.homeDir, ".bb-machines", "owned"),
    );
    writeJoinedState({ ...fixture, dataDir });
    writeFileSync(join(dataDir, "host-daemon-port"), "40000\n");
    const serviceDir = join(fixture.homeDir, ".config", "systemd", "user");
    const serviceName = "bb-host-daemon-machine-getbb-app-host-test.service";
    const servicePath = join(serviceDir, serviceName);
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(
      servicePath,
      `[Service]\nEnvironment="BB_DATA_DIR=${dataDir}"\n`,
    );
    writeExecutable(
      join(fixture.binDir, "uname"),
      "#!/bin/sh\nprintf '%s\\n' Linux\n",
    );
    const systemctlLog = join(fixture.homeDir, "systemctl.log");
    writeExecutable(
      join(fixture.binDir, "systemctl"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >>${JSON.stringify(systemctlLog)}\n`,
    );
    const stopped = runScript(
      ["--stop", "--host-id", "host-test", "--data-dir", dataDir],
      fixture,
    );
    expect(stopped.status, stopped.stderr).toBe(0);
    expect(existsSync(dataDir)).toBe(true);
    expect(readFileSync(systemctlLog, "utf8")).toContain(
      `--user stop ${serviceName}`,
    );
    const uninstalled = runScript(
      ["--uninstall", "--host-id", "host-test", "--data-dir", dataDir],
      fixture,
    );
    expect(uninstalled.status, uninstalled.stderr).toBe(0);
    expect(existsSync(dataDir)).toBe(false);
    expect(readFileSync(systemctlLog, "utf8")).toContain(
      `--user disable --now ${serviceName}`,
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

  it("renders an invalid server URL as an installer failure", () => {
    const fixture = createFixture();
    const result = runScript(
      [
        "--join-code",
        "join-secret",
        "--host-id",
        "host-test",
        "--server",
        "not-a-url",
      ],
      fixture,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "  ✗  Could not parse the server URL not-a-url.",
    );
    expect(result.stderr).not.toContain("TypeError");
  });

  it("prefers the newly installed CLI and honors an explicit machine directory", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "npm"), "#!/bin/sh\nexit 19\n");
    runScript(JOIN_ARGS, fixture, { BB_INSTALL_SKIP_SERVICE: "1" });
    const olderCli = join(
      fixture.homeDir,
      ".bb-machines",
      "older",
      "npm",
      "bin",
      "bb",
    );
    mkdirSync(dirname(olderCli), { recursive: true });
    writeExecutable(olderCli, "#!/bin/sh\necho wrong-installation\n");
    const installedCli = join(fixture.dataDir, "npm", "bin", "bb");
    mkdirSync(dirname(installedCli), { recursive: true });
    writeExecutable(installedCli, '#!/bin/sh\nprintf "%s" "$BB_DATA_DIR"\n');
    const shim = join(fixture.homeDir, ".local", "bin", "bb");
    const explicit = spawnSync(
      shim,
      ["machine", "uninstall", "--host-id", "host-test"],
      { env: createScriptEnv(fixture, {}), encoding: "utf8" },
    );
    expect(explicit.status).toBe(0);
    expect(explicit.stdout).toBe(fixture.dataDir);
    writeExecutable(installedCli, "#!/bin/sh\necho current-installation\n");
    const env = createScriptEnv(fixture, {});
    delete env.BB_DATA_DIR;
    const selected = spawnSync(shim, ["machine", "enroll"], {
      env,
      encoding: "utf8",
    });
    expect(selected.status).toBe(0);
    expect(selected.stdout.trim()).toBe("current-installation");
  });

  it("publishes cleanup before package installation can fail", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "npm"), "#!/bin/sh\nexit 19\n");
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not install bb-app");
    const shim = join(fixture.homeDir, ".local", "bin", "bb");
    expect(existsSync(shim)).toBe(true);
    const cleanup = spawnSync(
      shim,
      ["machine", "uninstall", "--host-id", "host-test"],
      { env: createScriptEnv(fixture, {}), encoding: "utf8" },
    );
    expect(cleanup.status, cleanup.stderr).toBe(0);
    expect(existsSync(join(fixture.dataDir, "auth.json"))).toBe(false);
    expect(existsSync(join(fixture.dataDir, "install-daemon.pid"))).toBe(false);
  });

  it.each([{ container: false }, { container: true }])(
    "enrolls privately with portable service selection (%j)",
    ({ container }) => {
      const fixture = createFixture();
      writeCurlArtifactMock(fixture, 404);
      writeEnrollingBbApp(
        fixture,
        join(fixture.dataDir, "daemon-invocation"),
        "host-test",
      );
      writeExecutable(
        join(fixture.binDir, "bb"),
        `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const bundle = JSON.parse(process.env.BB_ENROLLMENT);
fs.writeFileSync(path.join(process.env.BB_DATA_DIR, "enrollment-argv"), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(path.join(process.env.BB_DATA_DIR, "auth.json"), JSON.stringify({hostId: bundle.hostId, hostKey: "durable-test"}));
fs.writeFileSync(path.join(process.env.BB_DATA_DIR, "config.json"), JSON.stringify({serverUrl: bundle.serverUrl}));
`,
      );
      if (container) {
        writeExecutable(
          join(fixture.binDir, "uname"),
          "#!/bin/sh\necho Linux\n",
        );
        writeExecutable(join(fixture.binDir, "id"), "#!/bin/sh\necho 0\n");
        writeExecutable(
          join(fixture.binDir, "ps"),
          "#!/bin/sh\necho systemd\n",
        );
        writeExecutable(
          join(fixture.binDir, "systemd-detect-virt"),
          "#!/bin/sh\nexit 0\n",
        );
        writeExecutable(
          join(fixture.binDir, "systemctl"),
          "#!/bin/sh\nexit 1\n",
        );
      }
      const result = runScript(["--bootstrap-env", "TEST_BUNDLE"], fixture, {
        BB_INSTALL_SKIP_SERVICE: container ? "0" : "1",
        TEST_BUNDLE: JSON.stringify({
          hostId: "host-test",
          serverUrl: "https://machine.getbb.app",
          credential: "private-bootstrap-test",
          expiresAt: Date.now() + 60_000,
        }),
      });
      const pidPath = join(fixture.dataDir, "install-daemon.pid");
      try {
        expect(result.status, result.stderr).toBe(0);
        expect(
          JSON.parse(
            readFileSync(join(fixture.dataDir, "enrollment-argv"), "utf8"),
          ),
        ).toEqual(["machine", "enroll", "--bootstrap-env", "BB_ENROLLMENT"]);
        expect(result.stdout + result.stderr).not.toContain(
          "private-bootstrap-test",
        );
        expect(
          spawnSync("sh", ["-n", join(fixture.homeDir, ".local/bin/bb")])
            .status,
        ).toBe(0);
      } finally {
        if (existsSync(pidPath)) {
          try {
            process.kill(Number(readFileSync(pidPath, "utf8")), "SIGTERM");
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                "code" in error &&
                error.code === "ESRCH"
              )
            )
              throw error;
          }
        }
      }
    },
  );

  it("uses bb-app from PATH and passes the launcher join flags verbatim", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, invocationPath);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(
      result.status,
      `${result.stderr}\n${readFileSync(join(fixture.dataDir, "install-join.log"), "utf8")}`,
    ).toBe(0);
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
    expect(
      JSON.parse(readFileSync(join(fixture.dataDir, "auth.json"), "utf8")),
    ).toEqual({ hostId: "host-test", hostKey: "secret" });
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("starts the daemon for an existing enrollment when service setup is skipped", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    const daemonPidPath = join(fixture.dataDir, "install-daemon.pid");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(fixture, invocationPath);
    writeJoinedState(fixture);

    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("already joined");
    try {
      expect(existsSync(daemonPidPath)).toBe(true);
      expect(readFileSync(invocationPath, "utf8").trim().split("\n")).toEqual([
        "host-daemon",
        "--auto-update",
        "--host-daemon-port",
        readFileSync(join(fixture.dataDir, "host-daemon-port"), "utf8").trim(),
        "--server-url",
        "https://machine.getbb.app",
      ]);
    } finally {
      if (existsSync(daemonPidPath)) {
        process.kill(Number(readFileSync(daemonPidPath, "utf8")), "SIGTERM");
      }
    }
  });

  it("accepts the daemon's normalized loopback server URL", () => {
    const fixture = createFixture();
    const invocationPath = join(fixture.dataDir, "invocation");
    writeCurlArtifactMock(fixture, 404);
    writeEnrollingBbApp(
      fixture,
      invocationPath,
      "host-test",
      "http://127.0.0.1:20101",
    );
    const result = runScript(
      [
        "--join-code",
        "join-secret",
        "--host-id",
        "host-test",
        "--server",
        "http://localhost:20101",
      ],
      fixture,
      { BB_INSTALL_SKIP_SERVICE: "1" },
    );

    expect(result.status, result.stderr).toBe(0);
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("installs the server tarball even when a same-version bb-app is on PATH", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "bb-app"), "#!/bin/sh\nexit 99\n");
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    const npmInvocation = readFileSync(
      join(fixture.dataDir, "npm.log"),
      "utf8",
    );
    expect(npmInvocation).toMatch(
      /^install -g --allow-scripts=better-sqlite3,node-pty,@parcel\/watcher --prefix \/.*\/data\/npm \/.*bb-app\..*\.tgz$/mu,
    );
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
    expect(npmInvocation).toMatch(
      /^install -g --allow-scripts=better-sqlite3,node-pty,@parcel\/watcher --prefix \/.*\/data\/npm \/.*bb-app\..*\.tgz$/mu,
    );
    expect(npmInvocation).not.toContain("bb-app\n");
    expect(readFileSync(join(fixture.dataDir, "curl.log"), "utf8")).toContain(
      "--silent --show-error --location --connect-timeout 10 --max-time 300",
    );
    expect(result.stdout).toContain(
      "Setting up this machine as host-test for https://machine.getbb.app",
    );
    expect(result.stdout).toContain("\n  bb machine setup\n\n");
    expect(result.stdout).toContain(
      "  ○  Setting up this machine as host-test for https://machine.getbb.app",
    );
    expect(result.stdout).toContain(
      "Downloading the server's bb-app package (timeout: 5 minutes)",
    );
    expect(result.stdout).toContain(
      "  ✓  Downloaded the server's bb-app package",
    );
    expect(result.stdout).toContain(
      "  ○  Installing the server's bb-app build",
    );
    expect(result.stdout).toContain("  ✓  Installed the server's bb-app build");
    expect(result.stdout).toContain(
      "Waiting for the temporary host daemon to connect",
    );
    expect(result.stdout).toContain("Join progress is logged to");
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("skips downloading and installing an identical host artifact", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    const first = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });
    expect(first.status, first.stderr).toBe(0);

    const second = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain(
      "The identical server host artifact is already installed",
    );
    expect(
      readFileSync(join(fixture.dataDir, "host-artifact.sha256"), "utf8"),
    ).toBe(`${FIXTURE_ARTIFACT_DIGEST}\n`);
    expect(
      readFileSync(join(fixture.dataDir, "npm.log"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
    expect(readFileSync(join(fixture.dataDir, "curl.log"), "utf8")).toContain(
      `If-None-Match: "sha256-${FIXTURE_ARTIFACT_DIGEST}"`,
    );
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("rejects a server host artifact whose digest does not match", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200, "a".repeat(64));

    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed SHA-256 verification");
    expect(existsSync(join(fixture.dataDir, "npm.log"))).toBe(false);
    expect(existsSync(join(fixture.dataDir, "host-artifact.sha256"))).toBe(
      false,
    );
  });

  it("falls back to npm only when the server artifact returns 404", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 404);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(fixture.dataDir, "npm.log"), "utf8")).toMatch(
      /^install -g --allow-scripts=better-sqlite3,node-pty,@parcel\/watcher --prefix \/.*\/data\/npm bb-app\n$/u,
    );
    const daemonPid = Number(
      readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
    );
    process.kill(daemonPid, "SIGTERM");
  });

  it("fails loudly when npm skipped the native add-on install scripts", () => {
    const fixture = createFixture();
    writeServerInstallTools(fixture, 200);
    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
      FAKE_NPM_SKIP_NATIVE_MODULES: "1",
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "npm installed bb-app, but its host native add-ons (node-pty, @parcel/watcher) did not load.",
    );
    expect(result.stderr).toContain(
      "npm_config_allow_scripts=better-sqlite3,node-pty,@parcel/watcher",
    );
    expect(existsSync(join(fixture.dataDir, "install-daemon.pid"))).toBe(false);
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
    let occupiedByTest = false;
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", (error) => {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
        if (code === "EADDRINUSE") {
          resolve();
          return;
        }
        reject(error);
      });
      occupied.listen(38888, "127.0.0.1", () => {
        occupiedByTest = true;
        resolve();
      });
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
      const selectedPort = readFileSync(
        join(fixture.dataDir, "host-daemon-port"),
        "utf8",
      ).trim();
      expect(selectedPort).not.toBe("38888");
      expect(readFileSync(invocationPath, "utf8")).toContain(
        `--host-daemon-port\n${selectedPort}\n`,
      );
      const daemonPid = Number(
        readFileSync(join(fixture.dataDir, "install-daemon.pid"), "utf8"),
      );
      process.kill(daemonPid, "SIGTERM");
    } finally {
      if (occupiedByTest) {
        await new Promise<void>((resolve, reject) => {
          occupied.close((error) => (error ? reject(error) : resolve()));
        });
      }
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
    expect(readFileSync(join(fixture.dataDir, "curl.log"), "utf8")).toContain(
      "--connect-timeout 10 --max-time 30 -X POST",
    );
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

  it("reports periodic progress while a host daemon is still joining", () => {
    const fixture = createFixture();
    writeCurlArtifactMock(fixture, 404);
    writeExecutable(
      join(fixture.binDir, "bb-app"),
      `#!/usr/bin/env node
setInterval(() => {}, 1000);
`,
    );
    writeExecutable(join(fixture.binDir, "sleep"), "#!/bin/sh\nexit 0\n");

    const result = runScript(JOIN_ARGS, fixture, {
      BB_INSTALL_SKIP_SERVICE: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Still waiting for the temporary host daemon (5/60 checks)",
    );
    expect(result.stdout).toContain(
      "Still waiting for the temporary host daemon (60/60 checks)",
    );
    expect(result.stderr).toContain("Timed out waiting for host daemon");
  });

  it("starts a fresh macOS launch agent once and replaces it with one new process", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
if [ "$1" = bootout ] && [ -f "${join(fixture.dataDir, "service-daemon.pid")}" ]; then
  service_pid=$(sed -n '1p' "${join(fixture.dataDir, "service-daemon.pid")}")
  kill "$service_pid" 2>/dev/null || true
  attempts=0
  while kill -0 "$service_pid" 2>/dev/null && [ "$attempts" -lt 100 ]; do
    attempts=$((attempts + 1))
    sleep 0.01
  done
  rm -f "${join(fixture.dataDir, "service-daemon.pid")}"
fi
if [ "$1" = bootstrap ]; then
  port=$(sed -n '1p' "${join(fixture.dataDir, "host-daemon-port")}")
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.dataDir, "npm/bin/bb-app")}" host-daemon --host-daemon-port "$port" --server-url https://machine.getbb.app >/dev/null 2>&1 &
  echo $! >"${join(fixture.dataDir, "service-daemon.pid")}"
  printf 'start\n' >>"${join(fixture.dataDir, "launchctl-starts.log")}"
fi
if [ "$1" = kickstart ]; then
  printf '%s\n' 'unexpected kickstart' >&2
  exit 70
fi
`,
    );

    const firstResult = runScript([...JOIN_ARGS], fixture);
    const secondResult = runScript(
      [
        "--join-code",
        "unused-reinstall-code",
        "--host-id",
        "host-test",
        "--server",
        "https://machine.getbb.app",
      ],
      fixture,
    );

    expect(firstResult.status, firstResult.stderr).toBe(0);
    expect(firstResult.stdout).toContain("already joined");
    expect(firstResult.stdout).toContain(
      "Installing the persistent bb host daemon service",
    );
    expect(firstResult.stdout).toContain(
      "Waiting for the launch agent to connect",
    );
    expect(firstResult.stdout).toContain("  ●  bb machine is ready");
    expect(secondResult.status, secondResult.stderr).toBe(0);
    expect(secondResult.stdout).toContain("already joined");
    expect(secondResult.stdout).toContain("  ●  bb machine is ready");
    expect(secondResult.stdout).toContain("server  https://machine.getbb.app");
    expect(secondResult.stdout).toContain(
      "service " +
        join(
          fixture.homeDir,
          "Library/LaunchAgents/app.getbb.host-daemon.machine-getbb-app-host-test.plist",
        ),
    );
    const plist = readFileSync(
      join(
        fixture.homeDir,
        "Library/LaunchAgents/app.getbb.host-daemon.machine-getbb-app-host-test.plist",
      ),
      "utf8",
    );
    expect(plist).toContain(
      "<string>app.getbb.host-daemon.machine-getbb-app-host-test</string>",
    );
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("<string>host-daemon</string>");
    expect(plist).toContain("<string>--auto-update</string>");
    const selectedPort = readFileSync(
      join(fixture.dataDir, "host-daemon-port"),
      "utf8",
    ).trim();
    expect(plist).toContain(
      `<string>--host-daemon-port</string>\n    <string>${selectedPort}</string>`,
    );
    expect(plist).toContain("<string>https://machine.getbb.app</string>");
    expect(plist).toContain(
      `<key>BB_APP_NPM_PREFIX</key><string>${realpathSync(fixture.dataDir)}/npm</string>`,
    );
    const serviceFile = join(
      fixture.homeDir,
      "Library/LaunchAgents/app.getbb.host-daemon.machine-getbb-app-host-test.plist",
    );
    const domain = `gui/${process.getuid?.()}`;
    expect(readFileSync(join(fixture.dataDir, "launchctl.log"), "utf8")).toBe(
      `bootout ${domain} ${serviceFile}\nbootstrap ${domain} ${serviceFile}\nbootout ${domain} ${serviceFile}\nbootstrap ${domain} ${serviceFile}\n`,
    );
    expect(
      readFileSync(join(fixture.dataDir, "launchctl-starts.log"), "utf8"),
    ).toBe("start\nstart\n");
  });

  it("replaces a matching legacy macOS launch agent with exactly one host service", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    const serviceDir = join(fixture.homeDir, "Library/LaunchAgents");
    mkdirSync(serviceDir, { recursive: true });
    const legacyServiceFile = join(
      serviceDir,
      "app.getbb.host-daemon.machine-getbb-app.plist",
    );
    writeFileSync(join(fixture.dataDir, "host-daemon-port"), "45123\n");
    writeFileSync(
      legacyServiceFile,
      `<plist><dict>
<key>ProgramArguments</key><array><string>host-daemon</string><string>--host-daemon-port</string><string>45123</string></array>
<key>EnvironmentVariables</key><dict><key>BB_DATA_DIR</key><string>${fixture.dataDir}</string></dict>
</dict></plist>
`,
    );
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
if [ "$1" = bootstrap ]; then
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.dataDir, "npm/bin/bb-app")}" host-daemon --host-daemon-port 45123 --server-url https://machine.getbb.app >/dev/null 2>&1 &
  echo $! >"${join(fixture.dataDir, "service-daemon.pid")}"
fi
`,
    );

    const result = runScript(JOIN_ARGS, fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(legacyServiceFile)).toBe(false);
    expect(
      readdirSync(serviceDir).filter((file) => file.endsWith(".plist")),
    ).toEqual(["app.getbb.host-daemon.machine-getbb-app-host-test.plist"]);
    const serviceFile = join(
      serviceDir,
      "app.getbb.host-daemon.machine-getbb-app-host-test.plist",
    );
    const domain = `gui/${process.getuid?.()}`;
    expect(readFileSync(join(fixture.dataDir, "launchctl.log"), "utf8")).toBe(
      `bootout ${domain} ${legacyServiceFile}\nbootout ${domain} ${serviceFile}\nbootstrap ${domain} ${serviceFile}\n`,
    );
  });

  it("reports launchctl bootstrap failures", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
if [ "$1" = bootstrap ]; then
  printf '%s\n' 'fixture bootstrap failure' >&2
  exit 36
fi
`,
    );

    const result = runScript(JOIN_ARGS, fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Could not register the bb host-daemon launch agent app.getbb.host-daemon.machine-getbb-app-host-test.",
    );
    expect(result.stderr).toContain("launchctl: fixture bootstrap failure");
  });

  it("treats launch-agent readiness as authoritative after bootstrap", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Darwin\n");
    writeExecutable(
      join(fixture.binDir, "launchctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "launchctl.log")}"
`,
    );
    writeExecutable(join(fixture.binDir, "sleep"), "#!/bin/sh\nexit 0\n");

    const result = runScript(JOIN_ARGS, fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The bb host-daemon launch agent started but did not connect to https://machine.getbb.app.",
    );
    expect(result.stderr).toContain(
      `See ${fixture.dataDir}/logs/launchd.log for the daemon error.`,
    );
    expect(result.stdout).toContain(
      "Still waiting for the launch agent (60/60 checks)",
    );
  }, 15_000);

  it("restarts an active Linux systemd user unit after replacing it", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Linux\n");
    writeExecutable(
      join(fixture.binDir, "systemctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "systemctl.log")}"
if [ "$*" = "--user restart bb-host-daemon-machine-getbb-app-host-test.service" ]; then
  port=$(sed -n '1p' "${join(fixture.dataDir, "host-daemon-port")}")
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.dataDir, "npm/bin/bb-app")}" host-daemon --host-daemon-port "$port" --server-url https://machine.getbb.app >/dev/null 2>&1 &
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
    expect(result.stdout).toContain(
      "Waiting for the systemd service to connect",
    );
    const unit = readFileSync(
      join(
        fixture.homeDir,
        ".config/systemd/user/bb-host-daemon-machine-getbb-app-host-test.service",
      ),
      "utf8",
    );
    const selectedPort = readFileSync(
      join(fixture.dataDir, "host-daemon-port"),
      "utf8",
    ).trim();
    expect(unit).toContain(
      `host-daemon --auto-update --host-daemon-port "${selectedPort}" --server-url "https://machine.getbb.app"`,
    );
    expect(unit).toContain(
      `Environment="BB_APP_NPM_PREFIX=${realpathSync(fixture.dataDir)}/npm"`,
    );
    expect(readFileSync(join(fixture.dataDir, "systemctl.log"), "utf8")).toBe(
      "--user daemon-reload\n--user enable bb-host-daemon-machine-getbb-app-host-test.service\n--user restart bb-host-daemon-machine-getbb-app-host-test.service\n",
    );
  });

  it.each([false, true])(
    "installs a persistent root system unit (container=%s)",
    (container) => {
      const fixture = createFixture();
      writeJoinedState(fixture);
      writeServerInstallTools(fixture, 200);
      writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Linux\n");
      writeExecutable(join(fixture.binDir, "id"), "#!/bin/sh\necho 0\n");
      writeExecutable(join(fixture.binDir, "ps"), "#!/bin/sh\necho systemd\n");
      writeExecutable(
        join(fixture.binDir, "systemd-detect-virt"),
        `#!/bin/sh\nexit ${container ? 0 : 1}\n`,
      );
      const scope = container ? "--user" : "--system";
      writeExecutable(
        join(fixture.binDir, "systemctl"),
        `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "systemctl.log")}"
if [ "$*" = "${scope} restart bb-host-daemon-machine-getbb-app-host-test.service" ]; then
  port=$(sed -n '1p' "${join(fixture.dataDir, "host-daemon-port")}")
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.dataDir, "npm/bin/bb-app")}" host-daemon --host-daemon-port "$port" --server-url https://machine.getbb.app >/dev/null 2>&1 &
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
      expect(result.stdout).toContain(
        "Waiting for the systemd service to connect",
      );
      const unit = readFileSync(
        container
          ? join(
              fixture.homeDir,
              ".config/systemd/user/bb-host-daemon-machine-getbb-app-host-test.service",
            )
          : join(
              fixture.dataDir,
              "systemd/bb-host-daemon-machine-getbb-app-host-test.service",
            ),
        "utf8",
      );
      const selectedPort = readFileSync(
        join(fixture.dataDir, "host-daemon-port"),
        "utf8",
      ).trim();
      expect(unit).toContain(
        `host-daemon --auto-update --host-daemon-port "${selectedPort}" --server-url "https://machine.getbb.app"`,
      );
      expect(unit).toContain(
        `Environment="BB_APP_NPM_PREFIX=${realpathSync(fixture.dataDir)}/npm"`,
      );
      expect(unit).toContain(
        container ? "WantedBy=default.target" : "WantedBy=multi-user.target",
      );
      const enableUnit = container
        ? "bb-host-daemon-machine-getbb-app-host-test.service"
        : join(
            realpathSync(fixture.dataDir),
            "systemd/bb-host-daemon-machine-getbb-app-host-test.service",
          );
      expect(readFileSync(join(fixture.dataDir, "systemctl.log"), "utf8")).toBe(
        `${scope} daemon-reload\n${scope} enable ${enableUnit}\n${scope} restart bb-host-daemon-machine-getbb-app-host-test.service\n`,
      );
    },
  );

  it("replaces a matching legacy systemd unit with exactly one host service", () => {
    const fixture = createFixture();
    writeJoinedState(fixture);
    writeServerInstallTools(fixture, 200);
    writeExecutable(join(fixture.binDir, "uname"), "#!/bin/sh\necho Linux\n");
    const serviceDir = join(fixture.homeDir, ".config/systemd/user");
    mkdirSync(serviceDir, { recursive: true });
    const legacyServiceFile = join(
      serviceDir,
      "bb-host-daemon-machine-getbb-app.service",
    );
    writeFileSync(join(fixture.dataDir, "host-daemon-port"), "45123\n");
    writeFileSync(
      legacyServiceFile,
      `[Service]
ExecStart="node" "bb-app" host-daemon --auto-update --host-daemon-port "45123" --server-url "https://machine.getbb.app"
Environment="BB_DATA_DIR=${fixture.dataDir}"
`,
    );
    writeExecutable(
      join(fixture.binDir, "systemctl"),
      `#!/bin/sh
printf '%s\n' "$*" >>"${join(fixture.dataDir, "systemctl.log")}"
if [ "$*" = "--user restart bb-host-daemon-machine-getbb-app-host-test.service" ]; then
  BB_DATA_DIR="${fixture.dataDir}" "${join(fixture.dataDir, "npm/bin/bb-app")}" host-daemon --host-daemon-port 45123 --server-url https://machine.getbb.app >/dev/null 2>&1 &
  echo $! >"${join(fixture.dataDir, "service-daemon.pid")}"
fi
`,
    );

    const result = runScript(JOIN_ARGS, fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(legacyServiceFile)).toBe(false);
    expect(
      readdirSync(serviceDir).filter((file) => file.endsWith(".service")),
    ).toEqual(["bb-host-daemon-machine-getbb-app-host-test.service"]);
    expect(readFileSync(join(fixture.dataDir, "systemctl.log"), "utf8")).toBe(
      "--user disable --now bb-host-daemon-machine-getbb-app.service\n--user daemon-reload\n--user enable bb-host-daemon-machine-getbb-app-host-test.service\n--user restart bb-host-daemon-machine-getbb-app-host-test.service\n",
    );
  });
});
