import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../src/assets/install-machine.ps1", import.meta.url),
);
const FIXTURE_ARTIFACT_DIGEST = createHash("sha256")
  .update("fixture-tarball")
  .digest("hex");

function resolvePowerShell(): string | null {
  const candidates =
    process.platform === "win32"
      ? ["powershell", "pwsh"]
      : ["pwsh", "powershell"];
  for (const candidate of candidates) {
    try {
      const probed = spawnSync(
        candidate,
        ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
        { encoding: "utf8", timeout: 15000 },
      );
      if (probed.status === 0) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

const POWERSHELL_BIN = resolvePowerShell();
const POWERSHELL_UNAVAILABLE_MEASURED = POWERSHELL_BIN === null;

const INTERACTIVE_TOKEN_LAUNCH_REFUSED_RESULT_MEASURED = 2147946720;

function queryTaskLastResult(taskName: string): number | null {
  const queried = spawnSync(
    "schtasks",
    ["/Query", "/TN", taskName, "/FO", "LIST", "/V"],
    { encoding: "utf8", timeout: 30000 },
  );
  if (queried.status !== 0) {
    return null;
  }
  const line = (queried.stdout ?? "")
    .split(/\r?\n/u)
    .find((entry) => entry.trimStart().startsWith("Last Result"));
  if (line === undefined) {
    return null;
  }
  const parsed = Number(line.split(":").at(-1)?.trim());
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed >>> 0;
}

async function probeInteractiveTokenLaunchMeasured(): Promise<boolean> {
  if (POWERSHELL_BIN === null) {
    return false;
  }
  const root = mkdtempSync(join(tmpdir(), "bb-ps1-task-probe-"));
  createdDirectories.push(root);
  const taskName = `bb-task-probe-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const marker = join(root, "marker.txt");
    const logPath = join(root, "probe.log");
    const systemCmd = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`;
    const xml =
      '<?xml version="1.0" encoding="UTF-16"?>' +
      '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
      "<Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>" +
      '<Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>' +
      "<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><Enabled>true</Enabled><Hidden>false</Hidden></Settings>" +
      '<Actions Context="Author"><Exec>' +
      `<Command>${systemCmd}</Command>` +
      `<Arguments>/c echo probe &gt; "${marker}" 2&gt;&amp;1 &gt;&gt; "${logPath}"</Arguments>` +
      `<WorkingDirectory>${root}</WorkingDirectory>` +
      "</Exec></Actions></Task>";
    const xmlPath = join(root, "probe.xml");
    writeFileSync(xmlPath, `\uFEFF${xml}`, "utf16le");
    const created = spawnSync(
      "schtasks",
      ["/Create", "/TN", taskName, "/XML", xmlPath, "/F"],
      { encoding: "utf8", timeout: 30000 },
    );
    if (created.status !== 0) {
      return false;
    }
    createdTaskNames.push(taskName);
    const started = spawnSync("schtasks", ["/Run", "/TN", taskName], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (started.status !== 0) {
      return false;
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (existsSync(marker)) {
        return true;
      }
      if (
        queryTaskLastResult(taskName) ===
        INTERACTIVE_TOKEN_LAUNCH_REFUSED_RESULT_MEASURED
      ) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return existsSync(marker);
  } catch {
    return false;
  } finally {
    try {
      deleteScheduledTask(taskName);
    } catch {}
    const index = createdTaskNames.indexOf(taskName);
    if (index !== -1) {
      createdTaskNames.splice(index, 1);
    }
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {}
  }
}

const createdDirectories: string[] = [];
const createdTaskNames: string[] = [];
const createdRunValues: string[] = [];

function readScriptText(): string {
  return readFileSync(SCRIPT_PATH, "utf8");
}

describe("machine install powershell script static content", () => {
  it("documents the Windows installer flags", () => {
    const text = readScriptText();
    expect(text).toContain(
      "Usage: install.ps1 -JoinCode <code> -HostId <host-id> -Server <url> [-MachineCode <code>] [-HostDaemonPort <port>]",
    );
  });

  it("resolves npm through its Windows command shim", () => {
    const text = readScriptText();
    expect(text).toContain("npm.cmd");
  });

  it("downloads through curl.exe rather than the curl alias", () => {
    const text = readScriptText();
    expect(text).toContain("curl.exe");
  });

  it("persists through a logon scheduled task with restart on failure", () => {
    const text = readScriptText();
    expect(text).toContain("LogonTrigger");
    expect(text).toContain("RestartOnFailure");
    expect(text).toContain("InteractiveToken");
    expect(text).toContain("schtasks");
  });

  it("falls back to the per-user Run key when task registration is denied", () => {
    const text = readScriptText();
    expect(text).toContain("CurrentVersion\\Run");
    expect(text).toContain("HKCU");
  });

  it("detaches leave-running daemons so the installer pipes never hold them", () => {
    const text = readScriptText();
    expect(text).toContain("Win32_Process");
  });

  it("bakes the user PATH into the launcher for provider CLIs", () => {
    const text = readScriptText();
    expect(text).toContain('set `"PATH=');
  });

  it("keeps the per-server data dir and port registry layout", () => {
    const text = readScriptText();
    expect(text).toContain(".bb-machines");
    expect(text).toContain("host-daemon-ports");
    expect(text).toContain("host-artifact.sha256");
    expect(text).toContain("host-daemon-port");
  });

  it("honors the service-skip escape hatch for tests and smoke runs", () => {
    const text = readScriptText();
    expect(text).toContain("BB_INSTALL_SKIP_SERVICE");
  });

  it("never fakes POSIX file modes on NTFS", () => {
    const text = readScriptText();
    expect(text).not.toContain("chmod");
    expect(text).not.toContain("launchctl");
    expect(text).not.toContain("systemctl");
    expect(text).not.toContain("nohup");
    expect(text).not.toContain("mktemp");
    expect(text).not.toContain("#!/bin/sh");
  });

  it("stays pure ASCII so Windows PowerShell never decodes it as ANSI", () => {
    const text = readScriptText();
    expect(text).not.toMatch(/[^\x00-\x7F]/u);
  });
});

interface Ps1Fixture {
  binDir: string;
  curlFixture: string;
  curlLog: string;
  dataDir: string;
  homeDir: string;
  npmLog: string;
  root: string;
}

const CURL_FIXTURE_PS1 = [
  "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CurlArgs)",
  "$logFile = $env:BB_PS1_TEST_CURL_LOG",
  "Add-Content -Path $logFile -Value ($CurlArgs -join ' ') -Encoding utf8",
  "$url = $CurlArgs[-1]",
  "$status = [int]$env:BB_PS1_TEST_ARTIFACT_STATUS",
  "$headerDigest = $env:BB_PS1_TEST_HEADER_DIGEST",
  "if ($url -match 'redeem-machine') {",
  "  $bodyFile = ''",
  "  for ($i = 0; $i -lt $CurlArgs.Count; $i++) {",
  "    if ($CurlArgs[$i] -eq '--data' -and ($i + 1) -lt $CurlArgs.Count) { $bodyFile = $CurlArgs[$i + 1] }",
  "  }",
  "  if ($bodyFile.StartsWith('@')) {",
  "    $redeemBody = Get-Content -Raw -Path $bodyFile.Substring(1)",
  "    Add-Content -Path $logFile -Value ('redeem-body: ' + $redeemBody.Trim()) -Encoding utf8",
  "  }",
  "  Write-Output '{\"credential\":\"bbcm_durable\",\"machineId\":\"machine-1\"}'",
  "  exit 0",
  "}",
  "$output = ''",
  "$headers = ''",
  "$config = ''",
  "for ($i = 0; $i -lt $CurlArgs.Count; $i++) {",
  "  if ($CurlArgs[$i] -eq '--output' -and ($i + 1) -lt $CurlArgs.Count) { $output = $CurlArgs[$i + 1] }",
  "  if ($CurlArgs[$i] -eq '--dump-header' -and ($i + 1) -lt $CurlArgs.Count) { $headers = $CurlArgs[$i + 1] }",
  "  if ($CurlArgs[$i] -eq '-K' -and ($i + 1) -lt $CurlArgs.Count) { $config = $CurlArgs[$i + 1] }",
  "}",
  "$wantsNoneMatch = $false",
  "if ($config -ne '' -and (Test-Path -LiteralPath $config)) {",
  "  $configText = Get-Content -Raw -Path $config",
  "  if ($configText.Contains($headerDigest)) {",
  "    $wantsNoneMatch = $true",
  "    Add-Content -Path $logFile -Value ('if-none-match: ' + $headerDigest) -Encoding utf8",
  "  }",
  "}",
  "if ($headers -ne '') {",
  "  Set-Content -Path $headers -Value ('HTTP/1.1 ' + $status + \"`r`n\" + 'x-bb-artifact-sha256: ' + $headerDigest + \"`r`n\") -Encoding ascii",
  "}",
  "if ($wantsNoneMatch -and ($status -eq 200)) {",
  "  Write-Output '304'",
  "} else {",
  "  if ($output -ne '') { [IO.File]::WriteAllBytes($output, [Text.Encoding]::ASCII.GetBytes('fixture-tarball')) }",
  "  Write-Output ([string]$status)",
  "}",
  "exit 0",
].join("\n");

const NPM_FIXTURE_JS = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const args = process.argv.slice(2);",
  "fs.appendFileSync(process.env.BB_PS1_TEST_NPM_LOG, args.join(' ') + '\\n');",
  "if (process.env.BB_PS1_TEST_NPM_FAIL === '1') process.exit(1);",
  "let prefix = null;",
  "for (let i = 0; i < args.length; i++) { if (args[i] === '--prefix') prefix = args[i + 1]; }",
  "if (!prefix) process.exit(2);",
  "const template = fs.readFileSync(process.env.BB_PS1_TEST_BBAPP_TEMPLATE, 'utf8');",
  "fs.mkdirSync(path.join(prefix, 'node_modules', 'bb-app', 'host-daemon', 'dist'), { recursive: true });",
  "fs.mkdirSync(path.join(prefix, 'node_modules', 'bb-app', 'dist'), { recursive: true });",
  "fs.writeFileSync(path.join(prefix, 'bb-app.cmd'), '@echo off\\r\\nnode \"%~dp0node_modules\\\\bb-app\\\\dist\\\\bb-app.js\" %*\\r\\n');",
  "fs.writeFileSync(path.join(prefix, 'bb.cmd'), '@echo off\\r\\nnode \"%~dp0node_modules\\\\bb-app\\\\dist\\\\bb.js\" %*\\r\\n');",
  "fs.writeFileSync(path.join(prefix, 'node_modules', 'bb-app', 'dist', 'bb-app.js'), template);",
  "fs.writeFileSync(path.join(prefix, 'node_modules', 'bb-app', 'dist', 'bb.js'), template);",
  "fs.writeFileSync(path.join(prefix, 'node_modules', 'bb-app', 'host-daemon', 'dist', 'daemon-bundle.mjs'), 'fixture\\n');",
  "if (!process.env.BB_PS1_TEST_NPM_SKIP_NATIVE) {",
  "  for (const name of ['node-pty', '@parcel/watcher']) {",
  "    fs.mkdirSync(path.join(prefix, 'node_modules', 'bb-app', 'node_modules', name), { recursive: true });",
  "    fs.writeFileSync(path.join(prefix, 'node_modules', 'bb-app', 'node_modules', name, 'index.js'), 'module.exports = {};\\n');",
  "  }",
  "}",
].join("\n");

const NPM_CMD_SHIM = '@echo off\r\nnode "%~dp0npm-fixture.js" %*\r\n';

function createEnrollingBbAppScript(): string {
  return [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const path = require('node:path');",
    "const cliArgs = process.argv.slice(2);",
    "const option = (name) => { const i = cliArgs.indexOf(name); return i === -1 ? undefined : cliArgs[i + 1]; };",
    "const dataDir = process.env.BB_DATA_DIR;",
    "fs.writeFileSync(path.join(dataDir, 'last-invocation'), cliArgs.join('\\n') + '\\n');",
    "const hostId = process.env.BB_PS1_TEST_HOST_ID || 'host-test';",
    "const port = Number(option('--host-daemon-port'));",
    "const serverUrl = option('--server-url');",
    "const statusServerUrl = process.env.BB_PS1_TEST_STATUS_URL || serverUrl;",
    "fs.writeFileSync(path.join(dataDir, 'auth.json'), JSON.stringify({ hostId: hostId, hostKey: 'secret', hostType: 'persistent' }) + '\\n');",
    "const configPath = path.join(dataDir, 'config.json');",
    "if (!fs.existsSync(configPath)) { fs.writeFileSync(configPath, JSON.stringify({ serverUrl: serverUrl }) + '\\n'); }",
    "const server = http.createServer((req, res) => {",
    "  if (req.url !== '/status') { res.writeHead(404).end(); return; }",
    "  res.writeHead(200, { 'content-type': 'application/json' });",
    "  res.end(JSON.stringify({ connected: true, hostId: hostId, serverUrl: statusServerUrl }));",
    "});",
    "server.listen(port, '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join("\n");
}

const HANG_BB_APP_SCRIPT = "setInterval(() => {}, 1000);\n";
const EXIT_BB_APP_SCRIPT =
  "setTimeout(() => process.exit(1), 9000);\nsetInterval(() => {}, 1000);\n";

function createFixture(): Ps1Fixture {
  const root = mkdtempSync(join(tmpdir(), "bb-ps1-install-test-"));
  createdDirectories.push(root);
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const homeDir = join(root, "home");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  const curlFixture = join(root, "curl-fixture.ps1");
  const curlLog = join(dataDir, "curl.log");
  const npmLog = join(dataDir, "npm.log");
  writeFileSync(curlFixture, CURL_FIXTURE_PS1);
  writeFileSync(join(binDir, "npm-fixture.js"), NPM_FIXTURE_JS);
  writeFileSync(join(binDir, "npm.cmd"), NPM_CMD_SHIM);
  writeFileSync(
    join(root, "bb-app-template.js"),
    createEnrollingBbAppScript(),
  );
  return { binDir, curlFixture, curlLog, dataDir, homeDir, npmLog, root };
}

function createScriptEnv(
  fixture: Ps1Fixture,
  env: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BB_DATA_DIR: fixture.dataDir,
    BB_INSTALL_CURL_EXE: fixture.curlFixture,
    BB_PS1_TEST_ARTIFACT_STATUS: "200",
    BB_PS1_TEST_BBAPP_TEMPLATE: join(fixture.root, "bb-app-template.js"),
    BB_PS1_TEST_CURL_LOG: fixture.curlLog,
    BB_PS1_TEST_HEADER_DIGEST: FIXTURE_ARTIFACT_DIGEST,
    BB_PS1_TEST_HOST_ID: "host-test",
    BB_PS1_TEST_NPM_LOG: fixture.npmLog,
    HOMEDRIVE: "C:",
    HOMEPATH: fixture.homeDir.slice(2),
    USERPROFILE: fixture.homeDir,
    APPDATA: join(fixture.homeDir, "AppData", "Roaming"),
    LOCALAPPDATA: join(fixture.homeDir, "AppData", "Local"),
    PATH: [fixture.binDir, ...(process.env.PATH ?? "").split(delimiter)].join(
      delimiter,
    ),
    ...env,
  };
}

interface InstallerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runInstaller(
  args: string[],
  fixture: Ps1Fixture,
  env: Record<string, string> = {},
  spawnTimeoutMs = 55_000,
): InstallerResult {
  const result = spawnSync(
    POWERSHELL_BIN ?? "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT_PATH,
      ...args,
    ],
    {
      encoding: "utf8",
      env: createScriptEnv(fixture, env),
      timeout: spawnTimeoutMs,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

function runInstallerAsync(
  args: string[],
  fixture: Ps1Fixture,
  env: Record<string, string> = {},
): Promise<InstallerResult> {
  const child = spawn(
    POWERSHELL_BIN ?? "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT_PATH,
      ...args,
    ],
    { env: createScriptEnv(fixture, env) },
  );
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  return new Promise<InstallerResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => {
      setImmediate(() => resolve({ status, stdout, stderr }));
    });
  });
}

function selectedPort(fixture: Ps1Fixture): string {
  return readFileSync(join(fixture.dataDir, "host-daemon-port"), "utf8").trim();
}

function holderCommandLine(pid: number): string {
  if (POWERSHELL_BIN === null) {
    return "";
  }
  const probed = spawnSync(
    POWERSHELL_BIN,
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  return (probed.stdout ?? "").toString();
}

function killProcessOnPort(port: string, ownerRoot?: string): void {
  const pid = daemonPidOnPort(port);
  if (pid === 0) {
    return;
  }
  if (ownerRoot !== undefined && !holderCommandLine(pid).includes(ownerRoot)) {
    return;
  }
  spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
    encoding: "utf8",
    timeout: 30000,
  });
  waitForPortFree(port, 15000);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function daemonPidOnPort(port: string): number {
  if (POWERSHELL_BIN === null) {
    return 0;
  }
  const probed = spawnSync(
    POWERSHELL_BIN,
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1`,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  const pid = Number((probed.stdout ?? "").toString().trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function waitForPortFree(port: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (daemonPidOnPort(port) !== 0 && Date.now() < deadline) {
    sleepSync(250);
  }
}

function waitForPidGone(pid: number, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    sleepSync(250);
  }
}

async function claimParallelRunSafeLoopbackPort(): Promise<string> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("could not claim an unused loopback port");
  }
  return String(port);
}

function scheduledTaskExists(taskName: string): boolean {
  const queried = spawnSync("schtasks", ["/Query", "/TN", taskName, "/FO", "LIST"], {
    encoding: "utf8",
    timeout: 30000,
  });
  return queried.status === 0;
}

function deleteScheduledTask(taskName: string): void {
  spawnSync("schtasks", ["/Delete", "/TN", taskName, "/F"], {
    encoding: "utf8",
    timeout: 30000,
  });
}

function readRunKeyValue(valueName: string): string | null {
  const queried = spawnSync(
    "reg",
    [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      valueName,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (queried.status !== 0) {
    return null;
  }
  const line = (queried.stdout ?? "")
    .split(/\r?\n/u)
    .find((entry) => entry.includes(valueName));
  return line === undefined ? null : line.trim();
}

function deleteRunKeyValue(valueName: string): void {
  spawnSync(
    "reg",
    [
      "delete",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      valueName,
      "/f",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
}

async function childFetchDaemonStatus(
  port: string,
  hostId: string,
): Promise<{ connected: boolean; detail: string }> {
  const probed = spawnSync(
    process.execPath,
    [
      "-e",
      `fetch('http://127.0.0.1:${port}/status').then((r) => r.json()).then((b) => console.log('childpoll:' + b.connected + ':' + b.hostId)).catch((e) => console.log('childpoll-err:' + (e.cause ?? e.message)))`,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  const detail = ((probed.stdout ?? "").toString().trim() || "empty").slice(0, 120);
  return { connected: detail === `childpoll:true:${hostId}`, detail };
}

async function waitForDaemonStatus(
  port: string,
  hostId: string,
  timeoutMs: number,
): Promise<{ connected: boolean; lastError: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "none";
  while (Date.now() < deadline) {
    const probed = await childFetchDaemonStatus(port, hostId);
    if (probed.connected) {
      return { connected: true, lastError };
    }
    lastError = probed.detail;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { connected: false, lastError };
}

function writeJoinedState(
  fixture: Ps1Fixture,
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

function writePathBbApp(fixture: Ps1Fixture, script?: string): void {
  writeFileSync(
    join(fixture.binDir, "bb-app-path.js"),
    script ?? createEnrollingBbAppScript(),
  );
  writeFileSync(
    join(fixture.binDir, "bb-app.cmd"),
    '@echo off\r\nnode "%~dp0bb-app-path.js" %*\r\n',
  );
}

function cleanupFixtureProcesses(fixture: Ps1Fixture): void {
for (const pidFile of ["install-daemon.pid"]) {
    try {
      const pid = Number(readFileSync(join(fixture.dataDir, pidFile), "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
        waitForPidGone(pid, 15000);
      }
    } catch {}
  }
  try {
    const port = selectedPort(fixture);
    killProcessOnPort(port, fixture.root);
    waitForPortFree(port, 15000);
  } catch {}
}

afterEach(() => {
for (const taskName of createdTaskNames.splice(0)) {
    try {
      deleteScheduledTask(taskName);
    } catch {}
  }
  for (const valueName of createdRunValues.splice(0)) {
    try {
      deleteRunKeyValue(valueName);
    } catch {}
  }
  for (const directory of createdDirectories.splice(0)) {
    try {
      const dataDir = join(directory, "data");
      for (const pidFile of ["install-daemon.pid"]) {
        try {
          const pid = Number(readFileSync(join(dataDir, pidFile), "utf8"));
          if (Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
            waitForPidGone(pid, 15000);
          }
        } catch {}
      }
      try {
        const port = readFileSync(
          join(dataDir, "host-daemon-port"),
          "utf8",
        ).trim();
        if (/^\d+$/u.test(port)) {
          killProcessOnPort(port, directory);
          waitForPortFree(port, 15000);
        }
      } catch {}
    } catch {}
    rmSync(directory, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  }
});

const JOIN_ARGS = [
  "-JoinCode",
  "join-secret",
  "-HostId",
  "host-test",
  "-Server",
  "https://machine.getbb.app",
];

describe.skipIf(POWERSHELL_UNAVAILABLE_MEASURED)(
  "machine install powershell script",
  () => {
    it("refuses missing required flags with usage", () => {
      const fixture = createFixture();
      const result = runInstaller(["-JoinCode", "code-only"], fixture);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "Usage: install.ps1 -JoinCode <code> -HostId <host-id> -Server <url>",
      );
    });

    it("refuses an unknown option with usage", () => {
      const fixture = createFixture();
      const result = runInstaller([...JOIN_ARGS, "-Bogus", "x"], fixture);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Unknown option: -Bogus");
    });

    it("refuses an invalid explicit host-daemon port", () => {
      const fixture = createFixture();
      const zero = runInstaller(
        [...JOIN_ARGS, "-HostDaemonPort", "0"],
        fixture,
      );

      expect(zero.status).toBe(2);
      expect(zero.stderr).toContain(
        "--host-daemon-port must be an integer between 1 and 65535",
      );

      const huge = runInstaller(
        [...JOIN_ARGS, "-HostDaemonPort", "99999"],
        fixture,
      );
      expect(huge.status).toBe(2);
    });

    it("renders an invalid server URL as an installer failure", () => {
      const fixture = createFixture();
      const result = runInstaller(
        [
          "-JoinCode",
          "join-secret",
          "-HostId",
          "host-test",
          "-Server",
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

    it("uses bb-app from PATH and passes the launcher join flags verbatim", () => {
      const fixture = createFixture();
      const invocationPath = join(fixture.dataDir, "last-invocation");
      writePathBbApp(fixture);
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      try {
        expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
        const port = selectedPort(fixture);
        expect(
          readFileSync(invocationPath, "utf8").trim().split("\n"),
        ).toEqual([
          "host-daemon",
          "join",
          "--auto-update",
          "--host-daemon-port",
          port,
          "--join-code",
          "join-secret",
          "--host-id",
          "host-test",
          "--server-url",
          "https://machine.getbb.app",
        ]);
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("starts the daemon for an existing enrollment when service setup is skipped", () => {
      const fixture = createFixture();
      const invocationPath = join(fixture.dataDir, "last-invocation");
      writePathBbApp(fixture);
      writeJoinedState(fixture);

      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("already joined");
        expect(
          readFileSync(invocationPath, "utf8").trim().split("\n"),
        ).toEqual([
          "host-daemon",
          "--auto-update",
          "--host-daemon-port",
          selectedPort(fixture),
          "--server-url",
          "https://machine.getbb.app",
        ]);
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("accepts the daemon's normalized loopback server URL", () => {
      const fixture = createFixture();
      writePathBbApp(fixture);
      const result = runInstaller(
        [
          "-JoinCode",
          "join-secret",
          "-HostId",
          "host-test",
          "-Server",
          "http://localhost:20101",
        ],
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_PS1_TEST_STATUS_URL: "http://127.0.0.1:20101",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("installs the server tarball even when a same-version bb-app is on PATH", () => {
      const fixture = createFixture();
      writePathBbApp(fixture, "process.exit(99);\n");
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        { BB_INSTALL_SKIP_SERVICE: "1" },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
        const npmInvocation = readFileSync(fixture.npmLog, "utf8");
        expect(npmInvocation).toContain(
          "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        );
        expect(npmInvocation).toContain(`${join(fixture.dataDir, "npm")}`);
        expect(npmInvocation).toMatch(/bb-app\..*\.tgz/u);
        expect(npmInvocation).not.toContain(" bb-app\n");
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("prefers the server-matched tarball when bb-app is absent", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        { BB_INSTALL_SKIP_SERVICE: "1" },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
        const npmInvocation = readFileSync(fixture.npmLog, "utf8");
        expect(npmInvocation).toContain(
          "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        );
        expect(npmInvocation).toContain(`${join(fixture.dataDir, "npm")}`);
        expect(npmInvocation).toMatch(/bb-app\..*\.tgz/u);
        expect(npmInvocation).not.toContain(" bb-app\n");
        expect(readFileSync(fixture.curlLog, "utf8")).toContain(
          "--silent --show-error --location --connect-timeout 10 --max-time 300",
        );
        expect(result.stdout).toContain(
          "Setting up this machine as host-test for https://machine.getbb.app",
        );
        expect(result.stdout).toContain("  bb machine setup");
        expect(result.stdout).toContain(
          "Downloading the server's bb-app package (timeout: 5 minutes)",
        );
        expect(result.stdout).toContain(
          "  ✓  Downloaded the server's bb-app package",
        );
        expect(result.stdout).toContain(
          "  ✓  Installed the server's bb-app build",
        );
        expect(result.stdout).toContain(
          "Waiting for the temporary host daemon to connect",
        );
        expect(result.stdout).toContain("Join progress is logged to");
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("skips downloading and installing an identical host artifact", () => {
      const fixture = createFixture();
      const first = runInstaller(
        JOIN_ARGS,
        fixture,
        { BB_INSTALL_SKIP_SERVICE: "1" },
        55_000,
      );
      expect(first.status, first.stderr).toBe(0);
      cleanupFixtureProcesses(fixture);

      const second = runInstaller(
        JOIN_ARGS,
        fixture,
        { BB_INSTALL_SKIP_SERVICE: "1" },
        55_000,
      );

      try {
        expect(second.status, second.stderr).toBe(0);
        expect(second.stdout).toContain(
          "The identical server host artifact is already installed",
        );
        expect(
          readFileSync(join(fixture.dataDir, "host-artifact.sha256"), "utf8"),
        ).toBe(`${FIXTURE_ARTIFACT_DIGEST}\n`);
        expect(
          readFileSync(fixture.npmLog, "utf8").trim().split("\n"),
        ).toHaveLength(1);
        expect(readFileSync(fixture.curlLog, "utf8")).toContain(
          `if-none-match: ${FIXTURE_ARTIFACT_DIGEST}`,
        );
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("rejects a server host artifact whose digest does not match", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_HEADER_DIGEST: "a".repeat(64),
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("failed SHA-256 verification");
      expect(existsSync(fixture.npmLog)).toBe(false);
      expect(
        existsSync(join(fixture.dataDir, "host-artifact.sha256")),
      ).toBe(false);
    });

    it("falls back to npm only when the server artifact returns 404", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(fixture.npmLog, "utf8")).toContain(
          `--prefix ${join(fixture.dataDir, "npm")} bb-app`,
        );
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("fails loudly when npm skipped the native add-on install scripts", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_NPM_SKIP_NATIVE: "1",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "npm installed bb-app, but its host native add-ons (node-pty, @parcel/watcher) did not load.",
      );
      expect(result.stderr).toContain(
        "npm_config_allow_scripts=better-sqlite3,node-pty,@parcel/watcher",
      );
      expect(
        existsSync(join(fixture.dataDir, "install-daemon.pid")),
      ).toBe(false);
    });

    it("fails loudly when npm itself fails", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_NPM_FAIL: "1",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Could not install bb-app for this machine");
    });

    it("fails loudly when the server artifact is unavailable", () => {
      const fixture = createFixture();
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "500",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Could not download the server's bb-app package",
      );
      expect(result.stderr).toContain("HTTP 500");
    });

    it("defaults the data dir to a per-server directory under the home profile", () => {
      const fixture = createFixture();
      const env = createScriptEnv(fixture, { BB_INSTALL_SKIP_SERVICE: "1" });
      delete env.BB_DATA_DIR;
      const result = spawnSync(
        POWERSHELL_BIN ?? "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          SCRIPT_PATH,
          ...JOIN_ARGS,
        ],
        { encoding: "utf8", env, timeout: 55_000 },
      );
      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";

      try {
        expect(result.status, stderr).toBe(0);
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
        expect(Number.isInteger(daemonPid)).toBe(true);
        killProcessOnPort(
          readFileSync(join(defaultDataDir, "host-daemon-port"), "utf8").trim(),
          fixture.root,
        );
        try {
          process.kill(daemonPid, "SIGKILL");
        } catch {}
      } finally {
        try {
          const port = readFileSync(
            join(
              fixture.homeDir,
              ".bb-machines/machine.getbb.app/host-daemon-port",
            ),
            "utf8",
          ).trim();
          killProcessOnPort(port, fixture.root);
        } catch {}
      }
      expect(stdout).toContain("Using local host-daemon port");
    });

    it("refuses a data dir enrolled for a different host instead of faking success", () => {
      const fixture = createFixture();
      writePathBbApp(fixture, "process.exit(99);\n");
      writeJoinedState(fixture, "https://machine.getbb.app", "host-other");
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

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
      const invocationPath = join(fixture.dataDir, "last-invocation");
      writePathBbApp(fixture);

      try {
        const result = runInstaller(
          JOIN_ARGS,
          fixture,
          {
            BB_PS1_TEST_ARTIFACT_STATUS: "404",
              BB_INSTALL_SKIP_SERVICE: "1",
          },
          55_000,
        );

        expect(result.status, result.stderr).toBe(0);
        const port = selectedPort(fixture);
        expect(port).not.toBe("38888");
        expect(readFileSync(invocationPath, "utf8")).toContain(
          `--host-daemon-port\n${port}\n`,
        );
      } finally {
        cleanupFixtureProcesses(fixture);
        if (occupiedByTest) {
          await new Promise<void>((resolve, reject) => {
            occupied.close((error) => (error ? reject(error) : resolve()));
          });
        }
      }
    });

    it("atomically reserves different ports for concurrent custom data directories", async () => {
      const fixture = createFixture();
      const firstDataDir = join(fixture.homeDir, "custom-machine-one");
      const secondDataDir = join(fixture.homeDir, "custom-machine-two");
      mkdirSync(firstDataDir, { recursive: true });
      mkdirSync(secondDataDir, { recursive: true });
      const firstFixture = { ...fixture, dataDir: firstDataDir };
      const secondFixture = { ...fixture, dataDir: secondDataDir };
      writeJoinedState(firstFixture);
      writeJoinedState(secondFixture);
      writePathBbApp(fixture);

      const [firstResult, secondResult] = await Promise.all([
        runInstallerAsync(JOIN_ARGS, firstFixture, {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        }),
        runInstallerAsync(JOIN_ARGS, secondFixture, {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        }),
      ]);

      try {
        expect(firstResult.status, firstResult.stderr).toBe(0);
        expect(secondResult.status, secondResult.stderr).toBe(0);
        const firstPort = readFileSync(
          join(firstDataDir, "host-daemon-port"),
          "utf8",
        ).trim();
        const secondPort = readFileSync(
          join(secondDataDir, "host-daemon-port"),
          "utf8",
        ).trim();
        expect(firstPort).not.toBe(secondPort);
        const registryDir = join(
          fixture.homeDir,
          ".bb-machines/host-daemon-ports",
        );
        expect(
          new Set([
            readFileSync(join(registryDir, firstPort, "data-dir"), "utf8").trim(),
            readFileSync(join(registryDir, secondPort, "data-dir"), "utf8").trim(),
          ]),
        ).toEqual(
          new Set([realpathSync(firstDataDir), realpathSync(secondDataDir)]),
        );
      } finally {
        for (const dataDir of [firstDataDir, secondDataDir]) {
          try {
            const pid = Number(
              readFileSync(join(dataDir, "install-daemon.pid"), "utf8"),
            );
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          } catch {}
          try {
            killProcessOnPort(
              readFileSync(join(dataDir, "host-daemon-port"), "utf8").trim(),
              fixture.root,
            );
          } catch {}
        }
      }
    });

    it("redeems and persists a connect machine code before joining through the tunnel", () => {
      const fixture = createFixture();
      const invocationPath = join(fixture.dataDir, "last-invocation");
      writePathBbApp(fixture);
      const result = runInstaller(
        [
          "-JoinCode",
          "join-secret",
          "-HostId",
          "host-test",
          "-Server",
          "https://sawyer.getbb.app",
          "-MachineCode",
          "MACH-INE1",
        ],
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      try {
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(fixture.curlLog, "utf8")).toContain(
          "--connect-timeout 10 --max-time 30 -X POST",
        );
        expect(readFileSync(fixture.curlLog, "utf8")).toContain(
          'redeem-body: {"code":"MACH-INE1"}',
        );
        expect(readFileSync(invocationPath, "utf8")).not.toContain(
          "bbcm_durable",
        );
        expect(
          JSON.parse(readFileSync(join(fixture.dataDir, "config.json"), "utf8")),
        ).toMatchObject({
          connectMachineId: "machine-1",
          machineCredential: "bbcm_durable",
          serverUrl: "https://sawyer.getbb.app",
        });
      } finally {
        cleanupFixtureProcesses(fixture);
      }
    });

    it("reports periodic progress while a host daemon is still joining", () => {
      const fixture = createFixture();
      writePathBbApp(fixture, EXIT_BB_APP_SCRIPT);
      const result = runInstaller(
        JOIN_ARGS,
        fixture,
        {
          BB_PS1_TEST_ARTIFACT_STATUS: "404",
          BB_INSTALL_SKIP_SERVICE: "1",
        },
        55_000,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "Still waiting for the temporary host daemon (5/60 checks)",
      );
      expect(result.stderr).toContain(
        "bb host daemon exited before it connected to https://machine.getbb.app.",
      );
    });

    it(
      "times out loudly when a host daemon never connects",
      () => {
        const fixture = createFixture();
        writePathBbApp(fixture, HANG_BB_APP_SCRIPT);
        const result = runInstaller(
          JOIN_ARGS,
          fixture,
          {
            BB_PS1_TEST_ARTIFACT_STATUS: "404",
            BB_INSTALL_SKIP_SERVICE: "1",
          },
          170_000,
        );

        try {
          expect(result.status).toBe(1);
          expect(result.stdout).toContain(
            "Still waiting for the temporary host daemon (60/60 checks)",
          );
          expect(result.stderr).toContain(
            "Timed out waiting for host daemon host-test to connect to https://machine.getbb.app.",
          );
        } finally {
          cleanupFixtureProcesses(fixture);
        }
      },
      175_000,
    );

    it(
      "installs a restartable scheduled task once and replaces it with one",
      async (ctx) => {
        if (!(await probeInteractiveTokenLaunchMeasured())) {
          ctx.skip();
        }
        const fixture = createFixture();
        const serverUrl = `https://${Math.random().toString(36).slice(2, 8)}.getbb.app`;
        const taskName = `bb-host-daemon-${serverUrl.replace("https://", "").replace(/\./gu, "-")}`;
        createdTaskNames.push(taskName);
        writeJoinedState(fixture, serverUrl);
        const claimedPort = await claimParallelRunSafeLoopbackPort();

        const first = runInstaller(
          ["-JoinCode", "unused-first-code", "-HostId", "host-test", "-Server", serverUrl, "-HostDaemonPort", claimedPort],
          fixture,
          { BB_PS1_TEST_ARTIFACT_STATUS: "404" },
          115_000,
        );
        expect(first.status, `${first.stderr}\n${first.stdout}`).toBe(0);
        expect(first.stdout).toContain("already joined");
        expect(first.stdout).toContain(
          "Installing the persistent bb host daemon service",
        );
        expect(first.stdout).toContain("  ●  bb machine is ready");
        expect(first.stdout).toContain(`Scheduled task \\${taskName}`);
        expect(scheduledTaskExists(taskName)).toBe(true);
        expect(readRunKeyValue(taskName)).toBeNull();

        const wrapperCmd = join(fixture.dataDir, `${taskName}.cmd`);
        expect(existsSync(wrapperCmd)).toBe(true);
        const wrapper = readFileSync(wrapperCmd, "utf8");
        expect(wrapper).toContain("BB_APP_NPM_PREFIX=");
        expect(wrapper).toContain(`BB_DATA_DIR=${fixture.dataDir}`);
        expect(wrapper).toContain("host-daemon --auto-update");

        const port = selectedPort(fixture);
        expect(port).toBe(claimedPort);
        expect(
          (await waitForDaemonStatus(port, "host-test", 30_000)).connected,
        ).toBe(true);
        expect(existsSync(join(fixture.dataDir, "logs", "host-daemon.log"))).toBe(
          true,
        );
        const daemonPidBefore = daemonPidOnPort(port);
        expect(daemonPidBefore).toBeGreaterThan(0);

        killProcessOnPort(port, fixture.root);
        expect(
          (await waitForDaemonStatus(port, "host-test", 5_000)).connected,
        ).toBe(false);
        const restarted = spawnSync("schtasks", ["/Run", "/TN", taskName], {
          encoding: "utf8",
          timeout: 30000,
        });
        expect(restarted.status).toBe(0);
        expect(
          (await waitForDaemonStatus(port, "host-test", 60_000)).connected,
        ).toBe(true);

        const second = runInstaller(
          ["-JoinCode", "unused-second-code", "-HostId", "host-test", "-Server", serverUrl, "-HostDaemonPort", claimedPort],
          fixture,
          { BB_PS1_TEST_ARTIFACT_STATUS: "404" },
          115_000,
        );
        expect(second.status, `${second.stderr}\n${second.stdout}`).toBe(0);
        expect(second.stdout).toContain("  ●  bb machine is ready");
        expect(scheduledTaskExists(taskName)).toBe(true);
        expect(readRunKeyValue(taskName)).toBeNull();
        expect(
          (await waitForDaemonStatus(port, "host-test", 60_000)).connected,
        ).toBe(true);
        expect(daemonPidOnPort(port)).not.toBe(daemonPidBefore);

        deleteScheduledTask(taskName);
        expect(scheduledTaskExists(taskName)).toBe(false);
        createdTaskNames.splice(createdTaskNames.indexOf(taskName), 1);
        killProcessOnPort(port, fixture.root);
        waitForPortFree(port, 15000);
      },
      240_000,
    );

    it(
      "persists through the per-user Run key when forced",
      async () => {
        const fixture = createFixture();
        const serverUrl = `https://winkey${Math.random().toString(36).slice(2, 8)}.getbb.app`;
        const valueName = `bb-host-daemon-${serverUrl.replace("https://", "").replace(/\./gu, "-")}`;
        createdRunValues.push(valueName);
        writeJoinedState(fixture, serverUrl);
        const claimedPort = await claimParallelRunSafeLoopbackPort();

        const first = runInstaller(
          ["-JoinCode", "unused-first-code", "-HostId", "host-test", "-Server", serverUrl, "-HostDaemonPort", claimedPort],
          fixture,
          {
            BB_PS1_TEST_ARTIFACT_STATUS: "404",
            BB_INSTALL_FORCE_RUNKEY: "1",
          },
          115_000,
        );
        try {
          expect(first.status, `${first.stderr}\n${first.stdout}`).toBe(0);
          expect(first.stdout).toContain("  ●  bb machine is ready");
          const stored = readRunKeyValue(valueName);
          expect(stored).not.toBeNull();
          expect(stored).toContain(`${valueName}.cmd`);
          expect(scheduledTaskExists(valueName)).toBe(false);
          const port = selectedPort(fixture);
          expect(port).toBe(claimedPort);
          return waitForDaemonStatus(port, "host-test", 30_000).then(
            (status) => {
              expect(
                status.connected,
                `daemon never connected; lastError=${status.lastError}; installer said:\n${first.stdout}\n${first.stderr}`,
              ).toBe(true);
              const second = runInstaller(
                ["-JoinCode", "unused-second-code", "-HostId", "host-test", "-Server", serverUrl, "-HostDaemonPort", claimedPort],
                fixture,
                {
                  BB_PS1_TEST_ARTIFACT_STATUS: "404",
                  BB_INSTALL_FORCE_RUNKEY: "1",
                },
                115_000,
              );
              expect(second.status, `${second.stderr}\n${second.stdout}`).toBe(0);
              const again = readRunKeyValue(valueName);
              expect(again).not.toBeNull();
              expect(again).toBe(stored);
            },
          );
        } finally {
          cleanupFixtureProcesses(fixture);
        }
      },
      240_000,
    );
  },
  240_000,
);
