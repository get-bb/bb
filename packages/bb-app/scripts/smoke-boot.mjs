import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcherEntry = join(packageRoot, "dist", "bb-app.js");
const cliEntry = join(packageRoot, "dist", "bb.js");

const EXPECTED_RUNNING_BUILTIN_PLUGINS = [
  "automations",
  "connect",
  "environment-git-worktree",
  "environment-project-checkout",
  "provider-acp",
  "provider-claude-code",
  "provider-codex",
  "secrets",
];
const HEALTH_TIMEOUT_MS = 120_000;
const PLUGIN_LOAD_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const STOP_TIMEOUT_MS = 15_000;

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function reserveFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Expected a TCP address with a port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function isHealthy(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok && (await response.json()).ok === true;
  } catch {
    return false;
  }
}

async function runCli(args, env) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliEntry, ...args],
    {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    },
  );
  return stdout;
}

async function waitForBuiltinPlugins(cliEnv) {
  const deadline = Date.now() + PLUGIN_LOAD_TIMEOUT_MS;
  let lastSummary = "no plugin list output yet";
  while (Date.now() <= deadline) {
    const plugins =
      JSON.parse(await runCli(["plugin", "list", "--json"], cliEnv)).plugins ??
      [];
    const failed = plugins.filter(
      (plugin) =>
        plugin.status === "error" && plugin.statusDetail !== "not loaded",
    );
    if (failed.length > 0) {
      throw new Error(
        `Builtin plugins failed to load:\n${failed
          .map((plugin) => `- ${plugin.id}: ${plugin.statusDetail}`)
          .join("\n")}`,
      );
    }
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    const pending = EXPECTED_RUNNING_BUILTIN_PLUGINS.filter(
      (id) => byId.get(id)?.status !== "running",
    );
    if (pending.length === 0) {
      return plugins.length;
    }
    lastSummary = pending
      .map((id) => `${id}=${byId.get(id)?.status ?? "missing"}`)
      .join(", ");
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for builtin plugins: ${lastSummary}`);
}

async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    }).catch(() => undefined);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    exited,
    delay(STOP_TIMEOUT_MS).then(() => {
      throw new Error("bb-app did not exit after it was stopped");
    }),
  ]);
}

async function removeDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(directory, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt === 19) {
        throw error;
      }
      await delay(250);
    }
  }
}

const dataDir = await mkdtemp(join(tmpdir(), "bb-app-boot-smoke-"));
const serverPort = await reserveFreePort();
const daemonPort = await reserveFreePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const cliEnv = {
  BB_DATA_DIR: dataDir,
  BB_HOST_DAEMON_PORT: String(daemonPort),
  BB_SERVER_URL: serverUrl,
  BB_TELEMETRY: "false",
};
let output = "";
const launcher = spawn(
  process.execPath,
  [
    launcherEntry,
    "--data-dir",
    dataDir,
    "--server-port",
    String(serverPort),
    "--host-daemon-port",
    String(daemonPort),
    "--bundled",
  ],
  {
    detached: process.platform !== "win32",
    env: { ...process.env, BB_TELEMETRY: "false", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
launcher.stdout.on("data", (chunk) => (output += chunk.toString("utf8")));
launcher.stderr.on("data", (chunk) => (output += chunk.toString("utf8")));

try {
  const healthDeadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (!(await isHealthy(serverUrl))) {
    if (launcher.exitCode !== null) {
      throw new Error(`bb-app exited with ${launcher.exitCode} before /health`);
    }
    if (Date.now() > healthDeadline) {
      throw new Error("Timed out waiting for the bb server /health");
    }
    await delay(POLL_INTERVAL_MS);
  }
  process.stdout.write(`bb-app boot smoke: server healthy at ${serverUrl}\n`);

  const status = await runCli(["status"], cliEnv);
  if (!status.includes(dataDir)) {
    throw new Error(`bb status did not report the data dir:\n${status}`);
  }
  process.stdout.write("bb-app boot smoke: bundled bb CLI answered status\n");

  const pluginCount = await waitForBuiltinPlugins(cliEnv);
  process.stdout.write(
    `bb-app boot smoke: ${pluginCount} plugins listed, expected builtins running\n`,
  );

  const hosts = JSON.parse(await runCli(["machine", "list", "--json"], cliEnv));
  if (hosts.length !== 1 || hosts[0].status !== "connected") {
    throw new Error(
      `Expected one connected machine, got ${JSON.stringify(hosts)}`,
    );
  }
  process.stdout.write("bb-app boot smoke: host daemon connected\n");
} catch (error) {
  process.stderr.write(`bb-app output:\n${output}\n`);
  throw error;
} finally {
  await stopProcessTree(launcher);
  await removeDirectory(dataDir);
}

if (await isHealthy(serverUrl)) {
  throw new Error("The bb server kept answering after bb-app was stopped");
}
process.stdout.write("bb-app boot smoke: passed\n");
