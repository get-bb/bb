import { execFile, spawn } from "node:child_process";
import { access, appendFile, chmod, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startModelServer } from "./first-run-model-server.mjs";
import { prepareUpdate } from "./first-run-update-fixture.mjs";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Run first-run agents only in disposable GitHub Actions runners");
const execFileAsync = promisify(execFile);
const windows = process.platform === "win32";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcherEntry = join(packageRoot, "dist", "bb-app.js");
const cliEntry = join(packageRoot, "dist", "bb.js");
const resultsDir = resolve(process.env.FIRST_RUN_RESULTS ?? "first-run-results");
const startedAt = Date.now();
const providers = ["claude-code", "codex", "pi"];
const steps = ["clean", "detect", "install", "signin", "turn", "relaunch", "update", "piInstall"];
const report = {
  os: windows ? "Windows" : "macOS",
  sha: process.env.GITHUB_SHA ?? "unknown",
  startedAt: new Date(startedAt).toISOString(),
  durationMs: 0,
  cells: Object.fromEntries(providers.map((provider) => [provider, Object.fromEntries(steps.map((step) => [step, { status: "fail", reason: "Not reached" }]))])),
  evidence: {},
  limitations: [
    "OAuth browser completion and live inference are not exercised; credentials and model responses are fixtures.",
    "Relaunch restarts the bundled server and daemon with the same isolated data directory.",
    "Sign-in output is inspected only in memory; URLs and authorization codes are never persisted.",
    "Fresh HOME and per-process PATH hide existing user agents; detection fails if a system installation remains visible.",
    "The isolated bb machine-environment PATH setting overrides daemon shell/registry discovery; host OS settings are unchanged.",
    "The OS account and macOS keychain remain those of the disposable CI runner.",
  ],
};
let launcher;
let launcherOutput = "";
let modelServer;
let serverUrl;
let hostId;
let projectId;
let env;
let cliEnv;
let isolatedHome;
let minimalPath;
let dataDir;
let serverPort;
let daemonPort;

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function sanitize(value) {
  return String(value)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/https?:\/\/[^\s"'<>]+/gu, "[URL omitted]")
    .replace(/(?:sk-[A-Za-z0-9_-]+|first-run-fixture)/gu, "[fixture credential]")
    .replace(/((?:token|secret|authorization|api[_-]?key)\s*[=:]\s*)[^\s,}]+/giu, "$1[redacted]")
    .replace(/[\r\n]+/gu, " ")
    .slice(-1600);
}

function cell(provider, step, status, reason) {
  report.cells[provider][step] = { status, reason: sanitize(reason) };
  process.stdout.write(`${provider} ${step}: ${status} — ${sanitize(reason)}\n`);
}

async function attempt(provider, step, run) {
  const start = Date.now();
  try {
    await run();
  } catch (error) {
    cell(provider, step, "fail", error instanceof Error ? error.message : error);
  }
  report.cells[provider][step].durationMs = Date.now() - start;
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port allocated");
  await new Promise((done) => server.close(done));
  return address.port;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function inventory(environment) {
  const found = {};
  for (const name of ["node", "npm", "claude", "codex"]) {
    const command = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe") : "/usr/bin/which";
    const result = await execFileAsync(command, [name], { env: environment, timeout: 10_000, windowsHide: true }).catch(() => ({ stdout: "" }));
    found[name] = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  }
  return found;
}

async function prepareTooling(image) {
  const directory = join(isolatedHome, "CI tools");
  await mkdir(directory, { recursive: true });
  const node = join(directory, windows ? "node.exe" : "node");
  if (windows) await copyFile(process.execPath, node);
  else await symlink(process.execPath, node);
  const npmCandidates = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ...await Promise.all(image.npm.map((path) => realpath(path).catch(() => path))),
  ];
  let npmCli;
  for (const candidate of npmCandidates) {
    if (candidate.endsWith("npm-cli.js") && await exists(candidate)) {
      npmCli = candidate;
      break;
    }
  }
  if (!npmCli) throw new Error("Cannot locate setup-node npm-cli.js for isolated tooling");
  const shim = join(directory, windows ? "npm.cmd" : "npm");
  await writeFile(shim, windows
    ? `@"${node}" "${npmCli}" %*\r\n`
    : `#!/bin/sh\nexec '${node.replaceAll("'", "'\\''")}' '${npmCli.replaceAll("'", "'\\''")}' "$@"\n`);
  if (!windows) await chmod(shim, 0o755);
  return directory;
}

async function api(path, options = {}) {
  const response = await fetch(`${serverUrl}/api/v1${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${sanitize(text)}`);
  return options.ndjson ? text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : JSON.parse(text);
}

async function cli(args, timeout = 60_000) {
  try {
    const result = await execFileAsync(process.execPath, [cliEntry, ...args], { env: cliEnv, cwd: isolatedHome, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`bb ${args.slice(0, 2).join(" ")}: ${sanitize(error.stderr || error.message)}`);
  }
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (windows) {
    await execFileAsync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], { timeout: 15_000, windowsHide: true }).catch(() => undefined);
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
  const deadline = Date.now() + 15_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && child.signalCode === null) {
    if (!windows) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
    throw new Error("Owned child process did not stop within 15 seconds");
  }
}

async function boot() {
  launcherOutput = "";
  launcher = spawn(process.execPath, [launcherEntry, "--data-dir", dataDir, "--server-port", String(serverPort), "--host-daemon-port", String(daemonPort), "--bundled"], {
    env: { ...env, BB_TELEMETRY: "false", NODE_ENV: "production" },
    detached: !windows,
    cwd: isolatedHome,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  launcher.on("error", (error) => { launcherOutput += `spawn: ${error.code}`; });
  for (const stream of [launcher.stdout, launcher.stderr]) stream.on("data", (data) => { launcherOutput = (launcherOutput + data.toString()).slice(-64_000); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`Bundled app exited ${launcher.exitCode}: ${sanitize(launcherOutput)}`);
    try {
      const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const hosts = await cli(["machine", "list", "--json"], 15_000);
        const connected = hosts.filter((host) => host.status === "connected");
        if (connected.length === 1) {
          hostId = connected[0].id;
          const plugins = await cli(["plugin", "list", "--json"], 15_000);
          if (providers.every((provider) => plugins.plugins.some((plugin) => plugin.id === `provider-${provider}` && plugin.status === "running"))) {
            await api("/settings/machine-environment", { method: "POST", body: JSON.stringify({ name: "PATH", value: env.PATH, note: "CI first-run process isolation" }) });
            await delay(1_000);
            return;
          }
        }
      }
    } catch {}
    await delay(1_000);
  }
  throw new Error(`Bundled app did not connect its daemon/providers: ${sanitize(launcherOutput)}`);
}

async function health(provider) {
  const states = await api(`/system/providers/state?hostId=${encodeURIComponent(hostId)}`);
  const state = states.providers.find((entry) => entry.providerId === provider);
  if (!state) throw new Error(`${provider} absent from provider health response`);
  return state;
}

async function installation(provider) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const statuses = await api(`/hosts/${encodeURIComponent(hostId)}/provider-clis/status`);
    if (statuses[provider]) return statuses[provider];
    report.evidence.statusOmissions ??= [];
    report.evidence.statusOmissions.push({ provider, attempt });
    if (attempt < 3) await delay(1_000);
  }
  throw new Error(`${provider} absent from three installation status responses`);
}

async function installedStatus(provider) {
  const deadline = Date.now() + 40_000;
  let status;
  do {
    status = await installation(provider);
    if (status.installed) return status;
    await delay(1_000);
  } while (Date.now() < deadline);
  return status;
}

async function installAction(provider, actionKind) {
  const events = await api(`/hosts/${encodeURIComponent(hostId)}/provider-clis/install`, {
    method: "POST", body: JSON.stringify({ provider, actionKind }), ndjson: true, timeoutMs: 600_000,
  });
  const completed = events.findLast((event) => event.type === "completed");
  const errors = events.filter((event) => event.type === "error").map((event) => event.message);
  report.evidence[`${provider}.${actionKind}`] = {
    started: events.some((event) => event.type === "started"), command: sanitize(events.find((event) => event.type === "started")?.command ?? ""), completed: completed ?? null,
    errors: errors.map(sanitize),
    output: sanitize(events.filter((event) => event.type === "output").map((event) => event.text).join("")),
  };
  return { success: completed?.success === true && errors.length === 0, errors, completed };
}

async function launchLogin(command) {
  if (!command) return { status: "fail", reason: "Provider health returned no sign-in command" };
  const executable = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "/bin/sh";
  const args = windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command] : ["-c", command];
  let output = "";
  let spawnError;
  const loginEnv = { ...env };
  delete loginEnv.ANTHROPIC_BASE_URL;
  delete loginEnv.CODEX_OPENAI_BASE_URL;
  delete loginEnv.CODEX_POOL_AUTH_TOKEN;
  const child = spawn(executable, args, { env: loginEnv, cwd: isolatedHome, detached: !windows, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.on("error", (error) => { spawnError = error.code; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data.toString()).slice(-32_000); });
  let challenge = false;
  const challengePattern = /https:\/\/[^\s]*(?:oauth|authorize|auth\/|device|login)|(?:one.time|device|verification)\s+code\s*:/iu;
  const deadline = Date.now() + 45_000;
  try {
    while (Date.now() < deadline && child.exitCode === null && !spawnError) {
      challenge = challengePattern.test(output);
      if (challenge) break;
      await delay(250);
    }
    challenge ||= challengePattern.test(output);
    const reason = challenge ? "Real CLI printed an OAuth URL/code; stopped before authorization" : /not recognized|not found|ENOENT/iu.test(output) ? "Sign-in command could not find executable" : /ParserError|Unexpected token/iu.test(output) ? "PowerShell rejected sign-in syntax" : spawnError ? `Sign-in spawn failed (${spawnError})` : `No OAuth URL/code observed (exit ${child.exitCode ?? "timeout"}); output withheld`;
    return { status: challenge ? "pass" : "fail", reason };
  } finally {
    await stop(child);
  }
}

async function stubCredentials(provider) {
  if (provider === "claude-code") {
    await mkdir(join(isolatedHome, ".claude"), { recursive: true });
    await writeFile(join(isolatedHome, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "first-run-fixture", expiresAt: 4_102_444_800_000, subscriptionType: "max", scopes: ["user:inference", "user:profile"] } }), { mode: 0o600 });
    await writeFile(join(isolatedHome, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, oauthAccount: { emailAddress: "first-run@example.invalid", accountUuid: "11111111-1111-4111-8111-111111111111" } }), { mode: 0o600 });
  } else {
    await mkdir(env.CODEX_HOME, { recursive: true });
    await writeFile(join(env.CODEX_HOME, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "first-run-fixture" }), { mode: 0o600 });
  }
}

async function firstTurn(provider) {
  const requestStart = modelServer.requests.length;
  const thread = await cli(["thread", "spawn", "--project", projectId, "--machine", hostId, "--environment", join(isolatedHome, "workspace"), "--provider", provider, "--permission-mode", "full", "--title", `First run ${provider}`, "--prompt", "Reply with one short greeting. Do not use tools.", "--json"], 120_000);
  report.evidence[`${provider}.threadId`] = thread.id;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const events = await cli(["thread", "log", thread.id, "--json", "--limit", "1000"], 20_000);
    const completed = events.findLast((event) => event.type === "turn/completed");
    if (completed) {
      const output = await cli(["thread", "output", thread.id, "--json"], 20_000);
      const data = completed.data ?? completed;
      const requests = modelServer.requests.slice(requestStart);
      report.evidence[`${provider}.turn`] = { status: data.status, replyMatched: output.output?.includes(modelServer.reply) === true, requests };
      if (data.status === "completed" && output.output?.includes(modelServer.reply) && requests.some((request) => request.method === "POST")) {
        cell(provider, "turn", "pass", "Real CLI/bb thread completed with canned local SSE reply; inference stubbed");
      } else {
        cell(provider, "turn", "fail", `Turn ended ${data.status ?? "unknown"}; canned reply ${output.output?.includes(modelServer.reply) ? "present" : "missing"}; ${requests.length} fixture requests${data.error?.message ? `; ${data.error.message}` : ""}`);
      }
      return;
    }
    await delay(1_000);
  }
  await cli(["thread", "stop", thread.id, "--json"], 15_000).catch(() => undefined);
  const requests = modelServer.requests.slice(requestStart);
  report.evidence[`${provider}.turn`] = { status: "timeout", requests };
  cell(provider, "turn", "fail", `No completed turn within 120 seconds; ${requests.length} fixture requests`);
}

async function updateProvider(provider) {
  const installed = await installation(provider);
  if (!installed.executablePath) throw new Error("No installed executable for update fixture");
  const fixture = await prepareUpdate({ provider, executable: installed.executablePath, env, cwd: isolatedHome });
  report.evidence[`${provider}.updateFixture`] = fixture;
  let before = await installation(provider);
  const refreshDeadline = Date.now() + 45_000;
  while (before.currentVersion !== fixture.version && Date.now() < refreshDeadline) {
    await delay(2_000);
    before = await installation(provider);
  }
  if (before.currentVersion !== fixture.version) throw new Error(`bb did not detect downgraded version ${fixture.version}`);
  if (before.installAction?.kind !== "update") throw new Error(`Update fixture precondition unavailable at ${before.currentVersion}; latest ${before.latestVersion}; update executor not exercised`);
  const result = await installAction(provider, "update");
  let after = await installation(provider);
  const updatedDeadline = Date.now() + 45_000;
  while (result.success && after.currentVersion === before.currentVersion && Date.now() < updatedDeadline) {
    await delay(2_000);
    after = await installation(provider);
  }
  report.evidence[`${provider}.updateVersions`] = { before: before.currentVersion, after: after.currentVersion };
  const parts = (version) => String(version).split(".").map(Number);
  const previous = parts(before.currentVersion);
  const current = parts(after.currentVersion);
  const changed = current.findIndex((part, index) => part !== previous[index]);
  const advanced = changed >= 0 && current[changed] > previous[changed];
  if (result.success && after.installed && advanced) {
    cell(provider, "update", "pass", `bb update route verified ${before.currentVersion} → ${after.currentVersion}`);
  } else {
    throw new Error(`bb update failed: ${before.currentVersion} → ${after.currentVersion}; ${result.errors.join("; ") || `exit ${result.completed?.exitCode ?? "none"}`}`);
  }
}

async function saveReport() {
  report.durationMs = Date.now() - startedAt;
  await mkdir(resultsDir, { recursive: true });
  await writeFile(join(resultsDir, `${process.platform}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const rows = [["1. Clean launch", "clean"], ["2. Detect", "detect"], ["3. Install", "install"], ["4. Sign in", "signin"], ["5. First turn", "turn"], ["6a. Relaunch", "relaunch"], ["6b. Update", "update"], ["7. Pi without system npm", "piInstall"]];
  const md = [`## First run: ${report.os}`, "", "Sign-in credentials and model responses are stubbed. Installers, CLI login startup, bb routes and agent processes are real.", "", "| Step | Claude Code | Codex | Pi |", "| --- | --- | --- | --- |", ...rows.map(([label, step]) => `| ${label} | ${providers.map((provider) => { const value = report.cells[provider][step]; return `${value.status}: ${value.reason.replaceAll("|", "\\|")}`; }).join(" | ")} |`), "", `Runtime: ${(report.durationMs / 60_000).toFixed(1)} minutes.`, "", ...report.limitations.map((limitation) => `- ${limitation}`), ""].join("\n");
  await writeFile(join(resultsDir, `${process.platform}.md`), md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}

try {
  await mkdir(resultsDir, { recursive: true });
  report.evidence.imageExecutables = await inventory(process.env);
  isolatedHome = await mkdtemp(join(tmpdir(), "bb first run "));
  dataDir = join(isolatedHome, "bb data");
  await mkdir(join(isolatedHome, "workspace"), { recursive: true });
  const toolPath = await prepareTooling(report.evidence.imageExecutables);
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  minimalPath = windows ? [join(systemRoot, "System32"), systemRoot, join(systemRoot, "System32", "WindowsPowerShell", "v1.0"), join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd")].join(delimiter) : "/usr/bin:/bin:/usr/sbin:/sbin";
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:OS|SystemRoot|WINDIR|COMSPEC|PATHEXT|ProgramFiles|ProgramFiles\(x86\)|ProgramData|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|TEMP|TMP|TMPDIR|LANG|LC_ALL|TERM)$/iu.test(key)));
  Object.assign(env, { HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: join(isolatedHome, "AppData", "Roaming"), LOCALAPPDATA: join(isolatedHome, "AppData", "Local"), CODEX_HOME: join(isolatedHome, ".codex"), PATH: `${toolPath}${delimiter}${minimalPath}`, SHELL: windows ? "powershell.exe" : "/bin/sh", NO_COLOR: "1", CI: "true" });
  if (windows) {
    const bash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
    if (await exists(bash)) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
    report.limitations.push("Windows uses the runner's Git Bash as Claude Code's required shell dependency.");
  }
  await mkdir(env.APPDATA, { recursive: true });
  await mkdir(env.LOCALAPPDATA, { recursive: true });
  modelServer = await startModelServer();
  Object.assign(env, { ANTHROPIC_BASE_URL: modelServer.url, CODEX_OPENAI_BASE_URL: `${modelServer.url}/v1`, CODEX_POOL_AUTH_TOKEN: "first-run-fixture" });
  serverPort = await freePort();
  daemonPort = await freePort();
  serverUrl = `http://127.0.0.1:${serverPort}`;
  cliEnv = { ...env, BB_DATA_DIR: dataDir, BB_SERVER_URL: serverUrl, BB_HOST_DAEMON_PORT: String(daemonPort), BB_TELEMETRY: "false" };
  report.evidence.isolatedExecutables = await inventory(env);
  await boot();
  for (const provider of providers) cell(provider, "clean", "pass", "Bundled app started with spaced HOME, isolated PATH and no inherited agent credentials");
  for (const provider of providers) await attempt(provider, "detect", async () => {
    const state = await health(provider);
    if (state.status !== "not_installed") throw new Error(`Expected not_installed; got ${state.status}`);
    cell(provider, "detect", "pass", "Provider health reports not_installed");
  });
  for (const provider of ["claude-code", "codex"]) {
    await attempt(provider, "install", async () => {
      const result = await installAction(provider, "install");
      const status = await installedStatus(provider);
      const state = await health(provider);
      report.evidence[`${provider}.installedVersion`] = status.currentVersion;
      if (!result.success || !status.installed || state.status !== "unauthenticated") throw new Error(`Install verified=${result.success}; installed=${status.installed}; health=${state.status}; ${result.errors.join("; ")}`);
      cell(provider, "install", "pass", `bb route verified ${status.currentVersion}; health unauthenticated`);
    });
    await attempt(provider, "signin", async () => {
      const state = await health(provider);
      const launch = await launchLogin(state.localLoginCommand ?? state.loginCommand);
      report.evidence[`${provider}.loginLaunch`] = launch;
      await stubCredentials(provider);
      const ready = await health(provider);
      if (launch.status !== "pass" || ready.status !== "ready") throw new Error(`${launch.reason}; stubbed credential health=${ready.status}`);
      cell(provider, "signin", "stubbed", "Real login printed OAuth URL/code; file credentials stubbed and health ready");
    });
  }
  const project = await cli(["project", "create", "--name", "First run", "--root", join(isolatedHome, "workspace"), "--machine", hostId, "--json"]);
  projectId = project.id;
  for (const provider of ["claude-code", "codex"]) await attempt(provider, "turn", () => firstTurn(provider));
  await stop(launcher);
  await boot();
  for (const provider of ["claude-code", "codex"]) {
    await attempt(provider, "relaunch", async () => {
      const state = await health(provider);
      if (state.status !== "ready") throw new Error(`Health after relaunch ${state.status}`);
      cell(provider, "relaunch", "pass", "Health ready after server/daemon restart with stubbed credentials");
    });
  }
  if (windows) {
    const nativeDirectories = [join(isolatedHome, ".local", "bin"), join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin")];
    const updatePath = [...nativeDirectories, env.PATH].join(delimiter);
    await api("/settings/machine-environment", { method: "POST", body: JSON.stringify({ name: "PATH", value: updatePath, note: "CI native updater PATH after opening a new terminal" }) });
    await stop(launcher);
    env.PATH = updatePath;
    cliEnv.PATH = updatePath;
    await boot();
    report.evidence.updateExecutables = await inventory(env);
    report.limitations.push("Windows updates run after adding the actual native install directories to PATH and restarting, exercising bare-command resolution as in a new terminal.");
  }
  for (const provider of ["claude-code", "codex"]) await attempt(provider, "update", () => updateProvider(provider));
  await writeFile(join(isolatedHome, ".npmrc"), "foreground-scripts=true\n");
  await api("/settings/machine-environment", { method: "POST", body: JSON.stringify({ name: "PATH", value: minimalPath, note: "CI first-run Pi without system npm" }) });
  await stop(launcher);
  env.PATH = minimalPath;
  cliEnv.PATH = minimalPath;
  report.evidence.piExecutables = await inventory(env);
  if (report.evidence.piExecutables.npm.length || report.evidence.piExecutables.node.length) throw new Error("Pi fixture still exposes system npm/node");
  await boot();
  await attempt("pi", "piInstall", async () => {
    report.evidence.piBeforeInstall = await installation("pi");
    const result = await installAction("pi", "install");
    const status = await installedStatus("pi");
    if (!result.success || !status.installed) throw new Error(`No-npm Pi install verified=${result.success}; installed=${status.installed}; ${result.errors.join("; ")}`);
    const lifecycleRan = />\s+protobufjs@[\d.]+\s+postinstall\s+>\s+node\s+scripts\/postinstall/u.test(report.evidence["pi.install"].output);
    report.evidence.piNodeLifecycle = lifecycleRan;
    cell("pi", "piInstall", lifecycleRan ? "pass" : "fail", `bb installed and verified Pi ${status.currentVersion} without system node/npm; ${lifecycleRan ? "real dependency node postinstall ran" : "dependency node lifecycle not observed, so the node shim is unproven"}`);
  });
  cell("pi", "install", report.cells.pi.piInstall.status, report.cells.pi.piInstall.reason);
  for (const step of ["signin", "turn", "relaunch", "update"]) cell("pi", step, "stubbed", "Pi scope covers installation without system npm only");
  for (const provider of ["claude-code", "codex"]) cell(provider, "piInstall", "stubbed", "Pi-only scenario");
} catch (error) {
  report.harnessError = sanitize(error instanceof Error ? error.message : error);
  process.stderr.write(`First-run harness: ${report.harnessError}\n`);
  process.exitCode = 1;
} finally {
  try { await stop(launcher); } catch (error) { report.cleanupError = sanitize(error.message); process.exitCode = 1; }
  await modelServer?.close();
  if (isolatedHome) await rm(isolatedHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => { report.cleanupError = "Could not fully remove isolated runner home"; });
  await saveReport();
}

if (Object.values(report.cells).some((provider) => Object.values(provider).some((result) => result.status === "fail"))) process.exitCode = 1;
