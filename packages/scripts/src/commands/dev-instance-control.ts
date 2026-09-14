// bb-fork(windows): native Windows control for a `pnpm dev` stack, replacing the
// bb-fork(windows): screen sessions that scripts/bb-dev-app needs on POSIX hosts.
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { resolveCurrentDevInstanceConfig } from "@bb/config/runtime";
import { resolveSupervisorPidPath } from "../lib/dev-restart-utils.js";
import {
  requestDevSupervisorStop,
  resolveDevStopPath,
} from "../lib/dev-supervisor-windows.js";
import { repoRoot, runMainIfEntrypoint } from "../lib/script-entry.js";

const execFileAsync = promisify(execFile);
const SERVICE_NAMES = ["server", "host-daemon"] as const;
const STOP_WAIT_TIMEOUT_MS = 30_000;
const STOP_POLL_INTERVAL_MS = 250;
const PORT_PROBE_TIMEOUT_MS = 500;

type DevServiceName = (typeof SERVICE_NAMES)[number];

function readSupervisorPid(serviceName: DevServiceName): number | null {
  const pidPath = resolveSupervisorPidPath(serviceName);
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolvePromise(listening);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function listDevTreePids(): Promise<number[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const query = [
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'run-dev\\.ts' } |",
    'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
  ].join(" ");
  try {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", query],
      { timeout: 10_000, windowsHide: true },
    );
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(repoRoot))
      .map((line) => Number.parseInt(line.split("\t")[0] ?? "", 10))
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function terminateProcessTree(pid: number): Promise<void> {
  return new Promise((resolvePromise) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("exit", () => resolvePromise());
    killer.once("error", () => resolvePromise());
  });
}

function describeSupervisor(serviceName: DevServiceName): string {
  const pid = readSupervisorPid(serviceName);
  if (pid === null) {
    return "stopped";
  }
  return isProcessAlive(pid)
    ? `running (pid ${String(pid)})`
    : `stopped (stale pid ${String(pid)})`;
}

async function runStatus(): Promise<void> {
  const config = resolveCurrentDevInstanceConfig(repoRoot);
  process.stdout.write(
    `${[
      `[dev] Instance ${config.instanceId}`,
      `[dev] Data dir ${config.dataDir}`,
      `[dev] App http://localhost:${String(config.ports.appPort)}`,
      `[dev] Server ${config.serverUrl}`,
      `[dev] Host daemon http://127.0.0.1:${String(config.ports.hostDaemonPort)}`,
    ].join("\n")}\n`,
  );

  for (const serviceName of SERVICE_NAMES) {
    process.stdout.write(
      `[dev] ${serviceName} supervisor: ${describeSupervisor(serviceName)}\n`,
    );
  }

  for (const [label, port] of [
    ["app", config.ports.appPort],
    ["server", config.ports.serverPort],
    ["host daemon", config.ports.hostDaemonPort],
  ] as const) {
    const listening = await isPortListening(port);
    process.stdout.write(
      `[dev] ${label} port ${String(port)}: ${listening ? "listening" : "not listening"}\n`,
    );
  }
}

async function waitForSupervisorStop(
  requested: readonly DevServiceName[],
): Promise<void> {
  const deadline = Date.now() + STOP_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (requested.every((name) => readSupervisorPid(name) === null)) {
      return;
    }
    await delay(STOP_POLL_INTERVAL_MS);
  }
}

async function runStop(): Promise<void> {
  const requested = SERVICE_NAMES.filter(
    (name) => readSupervisorPid(name) !== null,
  );
  for (const serviceName of requested) {
    requestDevSupervisorStop({ serviceName });
    process.stdout.write(`[dev] Requested ${serviceName} stop.\n`);
  }

  await waitForSupervisorStop(requested);

  for (const serviceName of requested) {
    if (readSupervisorPid(serviceName) === null) {
      process.stdout.write(`[dev] ${serviceName} supervisor stopped.\n`);
      continue;
    }
    await rm(resolveDevStopPath({ serviceName }), { force: true });
    process.stderr.write(
      `[dev] ${serviceName} supervisor did not stop within ${String(STOP_WAIT_TIMEOUT_MS)}ms.\n`,
    );
    process.exitCode = 1;
  }

  const treePids = await listDevTreePids();
  for (const pid of treePids) {
    await terminateProcessTree(pid);
    process.stdout.write(
      `[dev] Stopped the pnpm dev tree (pid ${String(pid)}).\n`,
    );
  }

  if (requested.length === 0 && treePids.length === 0) {
    process.stdout.write("[dev] No running dev services for this checkout.\n");
  }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const action = argv[0];
  if (action === "status") {
    await runStatus();
    return;
  }
  if (action === "stop") {
    await runStop();
    return;
  }
  throw new Error(`Expected "status" or "stop", received ${String(action)}`);
}

runMainIfEntrypoint(import.meta.url, main);
