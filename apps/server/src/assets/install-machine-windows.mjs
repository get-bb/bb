import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PACKAGE_DOWNLOAD_TIMEOUT_MS = 300_000;
const DAEMON_WAIT_ATTEMPTS = 120;
const WAIT_PROGRESS_EVERY_ATTEMPTS = 15;
const FIRST_HOST_DAEMON_PORT = 38888;
const NATIVE_MODULES = "better-sqlite3,node-pty,@parcel/watcher";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const INSTALLER_FILE_NAME = "install-machine-windows.mjs";
const SERVICE_FILE_NAME = "machine-service.json";
const PID_FILE_NAME = "install-daemon.pid";
const USAGE = [
  "Usage:",
  "  node install-machine-windows.mjs --bootstrap-env <NAME> [--host-daemon-port <port>]",
  "  node install-machine-windows.mjs --start --host-id <id> [--data-dir <path>]",
  "  node install-machine-windows.mjs --stop --host-id <id> [--data-dir <path>]",
  "  node install-machine-windows.mjs --uninstall --host-id <id> [--data-dir <path>]",
].join("\n");

class InstallError extends Error {
  constructor(message, details = []) {
    super(message);
    this.details = details;
  }
}

function step(text) {
  process.stdout.write(`  > ${text}\n`);
}

function done(text) {
  process.stdout.write(`  ok ${text}\n`);
}

function warn(text) {
  process.stdout.write(`  !  ${text}\n`);
}

function detail(text) {
  process.stdout.write(`     ${text}\n`);
}

export function parseArguments(argv) {
  const options = {
    action: null,
    bootstrapEnv: null,
    dataDir: null,
    hostDaemonPort: null,
    hostId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new InstallError(USAGE);
      }
      index += 1;
      return next;
    };
    if (argument === "--bootstrap-env") options.bootstrapEnv = value();
    else if (argument === "--host-daemon-port")
      options.hostDaemonPort = value();
    else if (argument === "--host-id") options.hostId = value();
    else if (argument === "--data-dir") options.dataDir = value();
    else if (
      argument === "--start" ||
      argument === "--run" ||
      argument === "--stop" ||
      argument === "--uninstall"
    ) {
      if (options.action !== null) throw new InstallError(USAGE);
      options.action = argument.slice(2);
    } else throw new InstallError(USAGE);
  }
  if (options.action === null) {
    if (
      options.bootstrapEnv === null ||
      options.hostId !== null ||
      options.dataDir !== null
    ) {
      throw new InstallError(USAGE);
    }
  } else if (
    options.hostId === null ||
    options.bootstrapEnv !== null ||
    options.hostDaemonPort !== null
  ) {
    throw new InstallError(USAGE);
  }
  return options;
}

export function parseBootstrap(raw) {
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new InstallError("The enrollment bundle is not valid JSON.");
  }
  if (
    bundle === null ||
    typeof bundle !== "object" ||
    typeof bundle.hostId !== "string" ||
    bundle.hostId.length === 0 ||
    typeof bundle.serverUrl !== "string"
  ) {
    throw new InstallError("The enrollment bundle is incomplete.");
  }
  let url;
  try {
    url = new URL(bundle.serverUrl);
  } catch {
    throw new InstallError("The enrollment bundle has an invalid server URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new InstallError("The enrollment bundle has an invalid server URL.");
  }
  const headers = {};
  if (bundle.headers !== null && typeof bundle.headers === "object") {
    for (const [name, value] of Object.entries(bundle.headers)) {
      if (typeof value === "string") headers[name] = value;
    }
  }
  return {
    dataDir: typeof bundle.dataDir === "string" ? bundle.dataDir : null,
    headers,
    hostId: bundle.hostId,
    reconnect: bundle.reconnect === true,
    serverUrl: url.href.replace(/\/$/u, ""),
  };
}

export function serverHostSlug(serverUrl) {
  return new URL(serverUrl).host.replace(/[^a-zA-Z0-9.-]/gu, "-");
}

export function serviceName(serverUrl, hostId) {
  const hostSlug = hostId.replace(/[^a-zA-Z0-9_.-]/gu, "-");
  return `bb-host-daemon-${`${serverHostSlug(serverUrl)}-${hostSlug}`.replaceAll(".", "-")}`;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function startupCommand({ dataDir, hostId, nodePath }) {
  const command = [
    "&",
    quotePowerShell(nodePath),
    quotePowerShell(join(dataDir, INSTALLER_FILE_NAME)),
    "--start",
    "--host-id",
    quotePowerShell(hostId),
    "--data-dir",
    quotePowerShell(dataDir),
  ].join(" ");
  return `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "${command.replaceAll('"', '\\"')}"`;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeFileAtomic(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function installedHostId(dataDir) {
  const recorded = readText(join(dataDir, "host-id")).trim();
  if (recorded.length > 0) return recorded;
  try {
    const hostId = JSON.parse(readText(join(dataDir, "auth.json"))).hostId;
    return typeof hostId === "string" ? hostId : "";
  } catch {
    return "";
  }
}

function normalizeServerUrl(value) {
  const url = new URL(String(value));
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.href.replace(/\/$/u, "");
}

async function daemonStatusMatches({
  hostId,
  port,
  requireConnected,
  serverUrl,
}) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const status = await response.json();
    return (
      status !== null &&
      typeof status === "object" &&
      status.hostId === hostId &&
      normalizeServerUrl(status.serverUrl) === normalizeServerUrl(serverUrl) &&
      (!requireConnected || status.connected === true)
    );
  } catch {
    return false;
  }
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ exclusive: true, host: "127.0.0.1", port }, () => {
      server.close((error) => resolve(error === undefined));
    });
  });
}

function validPort(raw) {
  const port = Number(raw);
  return String(port) === raw &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
    ? port
    : null;
}

async function chooseHostDaemonPort({ dataDir, hostId, requested, serverUrl }) {
  const portFile = join(dataDir, "host-daemon-port");
  const matches = (port) =>
    daemonStatusMatches({ hostId, port, requireConnected: false, serverUrl });
  let chosen = null;
  if (requested !== null) {
    const port = validPort(requested);
    if (port === null) {
      throw new InstallError(
        "--host-daemon-port must be an integer between 1 and 65535.",
      );
    }
    if (!(await portIsAvailable(port)) && !(await matches(port))) {
      throw new InstallError(
        `Host daemon local API port ${port} is already in use.`,
        [
          "Choose another value for --host-daemon-port and run this command again.",
        ],
      );
    }
    chosen = port;
  } else {
    const stored = validPort(readText(portFile).split(/\r?\n/u)[0] ?? "");
    if (stored !== null) {
      if ((await portIsAvailable(stored)) || (await matches(stored))) {
        chosen = stored;
      } else {
        warn(
          `Stored host-daemon port ${stored} is unavailable; assigning a new port.`,
        );
      }
    }
  }
  for (
    let port = FIRST_HOST_DAEMON_PORT;
    chosen === null && port <= 65535;
    port += 1
  ) {
    if (await portIsAvailable(port)) chosen = port;
  }
  if (chosen === null) {
    throw new InstallError("Could not find an available host-daemon port.");
  }
  writeFileAtomic(portFile, `${chosen}\n`);
  done(`Using local host-daemon port ${chosen}`);
  return chosen;
}

function npmLaunch(args) {
  const npmCli = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (existsSync(npmCli)) {
    return {
      args: [npmCli, ...args],
      command: process.execPath,
      verbatim: false,
    };
  }
  const commandLine = ["npm", ...args].map((part) => `"${part}"`).join(" ");
  return {
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    command: process.env.ComSpec ?? "cmd.exe",
    verbatim: true,
  };
}

function runInherited(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function installPackage({ dataDir, npmPrefix, source }) {
  const launch = npmLaunch([
    "install",
    "-g",
    `--allow-scripts=${NATIVE_MODULES}`,
    "--prefix",
    npmPrefix,
    source,
  ]);
  rmSync(join(dataDir, "host-artifact.sha256"), { force: true });
  const code = await runInherited(launch.command, launch.args, {
    windowsVerbatimArguments: launch.verbatim,
  });
  if (code !== 0) {
    throw new InstallError(
      "Could not install bb-app for this machine. Check the npm error above, then run this command again.",
    );
  }
}

export function packageRoot(npmPrefix) {
  return join(npmPrefix, "node_modules", "bb-app");
}

async function downloadPackage({ bootstrap, dataDir, npmPrefix }) {
  const root = packageRoot(npmPrefix);
  const digestFile = join(dataDir, "host-artifact.sha256");
  const installedDigest =
    existsSync(join(root, "dist", "bb-app.js")) &&
    existsSync(join(root, "host-daemon", "dist", "daemon-bundle.mjs"))
      ? readText(digestFile).trim()
      : "";
  const knownDigest = /^[a-f0-9]{64}$/u.test(installedDigest)
    ? installedDigest
    : "";
  const packageUrl = `${bootstrap.serverUrl}/install/bb-app.tgz`;
  step("Downloading the server's bb-app package (timeout: 5 minutes)");
  let response;
  try {
    response = await fetch(packageUrl, {
      headers: {
        ...bootstrap.headers,
        ...(knownDigest === ""
          ? {}
          : { "if-none-match": `"sha256-${knownDigest}"` }),
      },
      signal: AbortSignal.timeout(PACKAGE_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new InstallError(
      `Could not download the server's bb-app package from ${packageUrl}.`,
      [error instanceof Error ? error.message : String(error)],
    );
  }
  if (response.status === 304 && knownDigest !== "") {
    done("The identical server host artifact is already installed");
    return;
  }
  if (response.status === 404) {
    warn("The server does not provide its bb-app package");
    step("Installing bb-app from the npm registry");
    await installPackage({ dataDir, npmPrefix, source: "bb-app" });
    done("Installed bb-app from the npm registry");
    return;
  }
  if (!response.ok) {
    const details = [];
    try {
      const body = await response.json();
      if (body !== null && typeof body.message === "string") {
        details.push(
          `Server: ${body.message.replace(/[\x00-\x1f\x7f-\x9f]/gu, " ").slice(0, 2000)}`,
        );
      }
    } catch {}
    throw new InstallError(
      `Could not download the server's bb-app package from ${packageUrl} (HTTP ${response.status}).`,
      details,
    );
  }
  const tarball = Buffer.from(await response.arrayBuffer());
  const expectedDigest = response.headers.get("x-bb-artifact-sha256") ?? "";
  const downloadedDigest = createHash("sha256").update(tarball).digest("hex");
  if (
    /^[a-f0-9]{64}$/u.test(expectedDigest) &&
    expectedDigest !== downloadedDigest
  ) {
    throw new InstallError(
      "The downloaded bb host artifact failed SHA-256 verification.",
      [`Expected ${expectedDigest} but received ${downloadedDigest}.`],
    );
  }
  done("Downloaded the server's bb-app package");
  const packageDir = mkdtempSync(join(tmpdir(), "bb-app-"));
  const packageFile = join(packageDir, "bb-app.tgz");
  try {
    writeFileSync(packageFile, tarball);
    step("Installing the server's bb-app build");
    await installPackage({ dataDir, npmPrefix, source: packageFile });
  } finally {
    rmSync(packageDir, { force: true, recursive: true });
  }
  if (/^[a-f0-9]{64}$/u.test(expectedDigest)) {
    writeFileAtomic(digestFile, `${expectedDigest}\n`);
  }
  done("Installed the server's bb-app build");
}

async function verifyNativeModules(root) {
  try {
    await execFileAsync(process.execPath, [
      "-e",
      'const root = process.argv[1]; require(root + "/node_modules/node-pty"); require(root + "/node_modules/@parcel/watcher");',
      root,
    ]);
  } catch {
    throw new InstallError(
      "npm installed bb-app, but its host native add-ons (node-pty, @parcel/watcher) did not load.",
      [
        "npm did not run their install scripts. Check the npm warnings above. If they mention allowScripts or ignore-scripts, set npm_config_allow_scripts and run this command again.",
        `npm_config_allow_scripts=${NATIVE_MODULES}`,
      ],
    );
  }
}

function daemonEnvironment({ dataDir, npmPrefix }) {
  return { ...process.env, BB_APP_NPM_PREFIX: npmPrefix, BB_DATA_DIR: dataDir };
}

function spawnDaemon({ args, dataDir, logFile, npmPrefix, root }) {
  const log = openSync(logFile, "a");
  try {
    const child = spawn(
      process.execPath,
      [join(root, "dist", "bb-app.js"), "host-daemon", ...args],
      {
        cwd: dataDir,
        detached: true,
        env: daemonEnvironment({ dataDir, npmPrefix }),
        stdio: ["ignore", log, log],
        windowsHide: true,
      },
    );
    child.unref();
    return child;
  } finally {
    closeSync(log);
  }
}

async function stopProcessTree(pid) {
  await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
    windowsHide: true,
  }).catch(() => undefined);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processCommandLine(pid) {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ],
      { windowsHide: true },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function waitForConnection({ hostId, port, serverUrl, subject }) {
  step(`Waiting for ${subject} to connect (up to about 2 minutes)`);
  for (let attempt = 1; attempt <= DAEMON_WAIT_ATTEMPTS; attempt += 1) {
    if (
      await daemonStatusMatches({
        hostId,
        port,
        requireConnected: true,
        serverUrl,
      })
    ) {
      return true;
    }
    if (attempt % WAIT_PROGRESS_EVERY_ATTEMPTS === 0) {
      step(
        `Still waiting for ${subject} (${attempt}/${DAEMON_WAIT_ATTEMPTS} checks)`,
      );
    }
    await delay(1_000);
  }
  return false;
}

function authMatchesHost(dataDir, hostId) {
  try {
    return JSON.parse(readText(join(dataDir, "auth.json"))).hostId === hostId;
  } catch {
    return false;
  }
}

function alreadyJoined({ dataDir, hostId, serverUrl }) {
  if (!existsSync(join(dataDir, "auth.json"))) return false;
  if (!authMatchesHost(dataDir, hostId)) {
    throw new InstallError(
      `${dataDir} already holds credentials for a different host, not ${hostId}.`,
      [
        `If this machine was removed from the server, delete ${dataDir} and run this command again.`,
      ],
    );
  }
  try {
    const config = JSON.parse(readText(join(dataDir, "config.json")));
    const normalize = (value) => String(value).replace(/\/+$/u, "");
    return normalize(config.serverUrl) === normalize(serverUrl);
  } catch {
    return false;
  }
}

async function joinServer({ bootstrap, dataDir, npmPrefix, port, root }) {
  if (
    alreadyJoined({
      dataDir,
      hostId: bootstrap.hostId,
      serverUrl: bootstrap.serverUrl,
    })
  ) {
    done(
      `This machine is already joined to ${bootstrap.serverUrl} as ${bootstrap.hostId}`,
    );
    return;
  }
  const joinLog = join(dataDir, "install-join.log");
  step(`Joining ${bootstrap.serverUrl} as ${bootstrap.hostId}`);
  detail(`Join progress is logged to ${joinLog}`);
  const child = spawnDaemon({
    args: [
      "join",
      "--auto-update",
      "--host-daemon-port",
      String(port),
      "--host-id",
      bootstrap.hostId,
      "--server-url",
      bootstrap.serverUrl,
    ],
    dataDir,
    logFile: joinLog,
    npmPrefix,
    root,
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  step(
    "Waiting for the temporary host daemon to connect (up to about 2 minutes)",
  );
  let joined = false;
  for (let attempt = 1; attempt <= DAEMON_WAIT_ATTEMPTS; attempt += 1) {
    if (
      authMatchesHost(dataDir, bootstrap.hostId) &&
      (await daemonStatusMatches({
        hostId: bootstrap.hostId,
        port,
        requireConnected: true,
        serverUrl: bootstrap.serverUrl,
      }))
    ) {
      joined = true;
      break;
    }
    if (exited) {
      throw new InstallError(
        `bb host daemon exited before it connected to ${bootstrap.serverUrl}.`,
        [`See ${joinLog}`],
      );
    }
    await delay(1_000);
  }
  if (child.pid !== undefined) await stopProcessTree(child.pid);
  if (!joined) {
    throw new InstallError(
      `Timed out waiting for host daemon ${bootstrap.hostId} to connect to ${bootstrap.serverUrl}.`,
      [`See ${joinLog}`],
    );
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      !(await daemonStatusMatches({
        hostId: bootstrap.hostId,
        port,
        requireConnected: false,
        serverUrl: bootstrap.serverUrl,
      }))
    ) {
      break;
    }
    await delay(500);
  }
  done("Joined successfully");
}

function readService(dataDir) {
  try {
    const service = JSON.parse(readText(join(dataDir, SERVICE_FILE_NAME)));
    if (
      service !== null &&
      typeof service === "object" &&
      typeof service.hostId === "string" &&
      typeof service.serverUrl === "string" &&
      typeof service.npmPrefix === "string" &&
      Number.isInteger(service.hostDaemonPort)
    ) {
      return service;
    }
  } catch {}
  return null;
}

function removeRetiredPackages(npmPrefix) {
  const modulesDir = join(npmPrefix, "node_modules");
  let names = [];
  try {
    names = readdirSync(modulesDir);
  } catch {}
  for (const name of names) {
    if (name.startsWith(".bb-app-")) {
      try {
        rmSync(join(modulesDir, name), { force: true, recursive: true });
      } catch {}
    }
  }
}

function runDaemon(dataDir, service) {
  mkdirSync(join(dataDir, "logs"), { recursive: true });
  removeRetiredPackages(service.npmPrefix);
  const child = spawnDaemon({
    args: [
      "--auto-update",
      "--supervise",
      "--host-daemon-port",
      String(service.hostDaemonPort),
      "--server-url",
      service.serverUrl,
    ],
    dataDir,
    logFile: join(dataDir, "logs", "machine-service.log"),
    npmPrefix: service.npmPrefix,
    root: packageRoot(service.npmPrefix),
  });
  if (child.pid === undefined) {
    throw new InstallError("Could not start the bb host daemon.");
  }
  writeFileAtomic(join(dataDir, PID_FILE_NAME), `${child.pid}\n`);
}

export function detachedRunCommandLine({
  dataDir,
  hostId,
  installerPath,
  nodePath,
}) {
  return [
    nodePath,
    installerPath,
    "--run",
    "--host-id",
    hostId,
    "--data-dir",
    dataDir,
  ]
    .map((part) => `"${part}"`)
    .join(" ");
}

const START_DETACHED_PROCESS_SCRIPT = [
  "$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
  "$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:MACHINE_SERVICE_COMMAND; CurrentDirectory = $env:MACHINE_SERVICE_DIRECTORY; ProcessStartupInformation = $startup }",
  "if ($result.ReturnValue -ne 0) { exit 1 }",
].join("; ");

async function startService(dataDir, service) {
  const status = {
    hostId: service.hostId,
    port: service.hostDaemonPort,
    serverUrl: service.serverUrl,
  };
  if (await daemonStatusMatches({ ...status, requireConnected: false })) {
    done("The host daemon is already running");
    return;
  }
  rmSync(join(dataDir, PID_FILE_NAME), { force: true });
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        START_DETACHED_PROCESS_SCRIPT,
      ],
      {
        env: {
          ...process.env,
          MACHINE_SERVICE_COMMAND: detachedRunCommandLine({
            dataDir,
            hostId: service.hostId,
            installerPath: join(dataDir, INSTALLER_FILE_NAME),
            nodePath: process.execPath,
          }),
          MACHINE_SERVICE_DIRECTORY: dataDir,
        },
        windowsHide: true,
      },
    );
  } catch {
    throw new InstallError("Could not start the bb host daemon.", [
      "Windows refused to create the daemon process through WMI.",
    ]);
  }
  if (!(await waitForConnection({ ...status, subject: "the host daemon" }))) {
    throw new InstallError(
      `The bb host daemon did not connect to ${service.serverUrl}.`,
      [`See ${join(dataDir, "logs", "machine-service.log")}`],
    );
  }
  done("Host daemon connected");
}

async function stopService(dataDir, service) {
  const pid = Number(readText(join(dataDir, PID_FILE_NAME)).trim());
  const running = Number.isInteger(pid) && pid > 1 && processIsRunning(pid);
  if (running) {
    const commandLine = await processCommandLine(pid);
    if (
      !commandLine.includes("host-daemon") ||
      !commandLine.includes(`--host-daemon-port ${service.hostDaemonPort}`)
    ) {
      throw new InstallError(
        `Process ${pid} recorded in ${join(dataDir, PID_FILE_NAME)} is not this machine's host daemon.`,
      );
    }
    await stopProcessTree(pid);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      !(await daemonStatusMatches({
        hostId: service.hostId,
        port: service.hostDaemonPort,
        requireConnected: false,
        serverUrl: service.serverUrl,
      }))
    ) {
      rmSync(join(dataDir, PID_FILE_NAME), { force: true });
      done("Stopped the host daemon");
      return;
    }
    await delay(500);
  }
  throw new InstallError(
    "A bb host daemon that this installer did not start is still running on this machine's port.",
    [
      `Stop the process listening on port ${service.hostDaemonPort}, then run this command again.`,
    ],
  );
}

async function registerStartup(dataDir, service) {
  await execFileAsync(
    "reg.exe",
    [
      "add",
      RUN_KEY,
      "/v",
      serviceName(service.serverUrl, service.hostId),
      "/t",
      "REG_SZ",
      "/d",
      startupCommand({
        dataDir,
        hostId: service.hostId,
        nodePath: process.execPath,
      }),
      "/f",
    ],
    { windowsHide: true },
  );
}

async function unregisterStartup(service) {
  await execFileAsync(
    "reg.exe",
    [
      "delete",
      RUN_KEY,
      "/v",
      serviceName(service.serverUrl, service.hostId),
      "/f",
    ],
    { windowsHide: true },
  ).catch(() => undefined);
}

function findInstallation(hostId, requestedDataDir) {
  const candidates =
    requestedDataDir !== null
      ? [requestedDataDir]
      : (() => {
          const machinesDir = join(homedir(), ".bb-machines");
          try {
            return readdirSync(machinesDir).map((name) =>
              join(machinesDir, name),
            );
          } catch {
            return [];
          }
        })();
  for (const dataDir of candidates) {
    const service = readService(dataDir);
    if (service !== null && service.hostId === hostId) {
      return { dataDir, service };
    }
  }
  throw new InstallError(
    `Machine ${hostId} is not installed on this computer.`,
  );
}

async function runLifecycle(options) {
  const { dataDir, service } = findInstallation(
    options.hostId,
    options.dataDir,
  );
  if (options.action === "run") {
    runDaemon(dataDir, service);
    return;
  }
  if (options.action === "start") {
    await startService(dataDir, service);
    return;
  }
  await stopService(dataDir, service);
  if (options.action === "uninstall") {
    await unregisterStartup(service);
    rmSync(dataDir, {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 250,
    });
    done(`Removed machine ${options.hostId} from this computer`);
  }
}

async function runInstall(options) {
  const rawBootstrap = process.env[options.bootstrapEnv];
  delete process.env[options.bootstrapEnv];
  if (rawBootstrap === undefined) {
    throw new InstallError(`${options.bootstrapEnv} is not set.`);
  }
  const bootstrap = parseBootstrap(rawBootstrap);
  process.stdout.write("\n  bb machine setup\n\n");
  step(
    `Setting up this machine as ${bootstrap.hostId} for ${bootstrap.serverUrl}`,
  );

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new InstallError(
      `Node.js ${process.versions.node} is too old; bb-app requires Node.js 22.19 or newer (22.19, 24, and 26 are tested).`,
    );
  }

  const configuredDataDir = process.env.BB_DATA_DIR?.trim();
  const dataDir =
    configuredDataDir !== undefined && configuredDataDir.length > 0
      ? configuredDataDir
      : (bootstrap.dataDir ??
        join(homedir(), ".bb-machines", serverHostSlug(bootstrap.serverUrl)));
  if (!isAbsolute(dataDir)) {
    throw new InstallError("BB_DATA_DIR must be an absolute path.");
  }
  const existingHostId = installedHostId(dataDir);
  if (existingHostId !== "" && existingHostId !== bootstrap.hostId) {
    throw new InstallError(
      `${dataDir} on this computer belongs to machine ${existingHostId}, not ${bootstrap.hostId}.`,
      [
        bootstrap.reconnect
          ? `Run this command on the computer where machine ${bootstrap.hostId} runs.`
          : "To add another machine on this computer, set BB_DATA_DIR to a new directory and run the command again.",
      ],
    );
  }
  if (bootstrap.reconnect && existingHostId !== bootstrap.hostId) {
    throw new InstallError(
      `Machine ${bootstrap.hostId} is not installed in ${dataDir} on this computer.`,
      [
        `Run this command on the computer where machine ${bootstrap.hostId} runs.`,
      ],
    );
  }

  mkdirSync(join(dataDir, "logs"), { recursive: true });
  rmSync(join(dataDir, "machine-suspended"), { force: true });
  const canonicalDataDir = realpathSync(dataDir);
  const npmPrefix = join(canonicalDataDir, "npm");
  const root = packageRoot(npmPrefix);

  const previousService = readService(canonicalDataDir);
  if (previousService !== null) {
    step("Stopping the host daemon before updating it");
    await stopService(canonicalDataDir, previousService);
  }

  const port = await chooseHostDaemonPort({
    dataDir: canonicalDataDir,
    hostId: bootstrap.hostId,
    requested: options.hostDaemonPort,
    serverUrl: bootstrap.serverUrl,
  });
  await downloadPackage({ bootstrap, dataDir: canonicalDataDir, npmPrefix });
  if (!existsSync(join(root, "dist", "bb-app.js"))) {
    throw new InstallError(
      `npm installed bb-app, but did not create the expected package at ${root}.`,
    );
  }
  await verifyNativeModules(root);

  const enrollCode = await runInherited(
    process.execPath,
    [
      join(root, "dist", "bb.js"),
      "machine",
      "enroll",
      "--bootstrap-env",
      "BB_ENROLLMENT",
    ],
    {
      env: {
        ...process.env,
        BB_DATA_DIR: canonicalDataDir,
        BB_ENROLLMENT: rawBootstrap,
      },
    },
  );
  if (enrollCode !== 0) {
    throw new InstallError("Could not enroll this machine with the server.");
  }

  await joinServer({
    bootstrap,
    dataDir: canonicalDataDir,
    npmPrefix,
    port,
    root,
  });

  const service = {
    hostDaemonPort: port,
    hostId: bootstrap.hostId,
    npmPrefix,
    serverUrl: bootstrap.serverUrl,
  };
  writeFileAtomic(
    join(canonicalDataDir, SERVICE_FILE_NAME),
    `${JSON.stringify(service, null, 2)}\n`,
  );
  const installerCopy = join(canonicalDataDir, INSTALLER_FILE_NAME);
  const installerSource = fileURLToPath(import.meta.url);
  if (installerSource !== installerCopy) {
    copyFileSync(installerSource, installerCopy);
  }
  step("Starting the host daemon");
  await startService(canonicalDataDir, service);
  await registerStartup(canonicalDataDir, service);
  done("The host daemon starts when you sign in to Windows");
  detail(`bb CLI for this machine: ${join(npmPrefix, "bb.cmd")}`);
  detail(
    `To remove this machine: node "${installerCopy}" --uninstall --host-id ${bootstrap.hostId}`,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (process.platform !== "win32") {
    throw new InstallError(
      "This installer supports Windows only. Use install.sh on macOS and Linux.",
    );
  }
  if (options.action === null) {
    await runInstall(options);
  } else {
    await runLifecycle(options);
  }
}

function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(process.argv[1]).toLowerCase()
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(
      `  x  ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (error instanceof InstallError) {
      for (const line of error.details) process.stderr.write(`     ${line}\n`);
    }
    process.exitCode = 1;
  });
}
