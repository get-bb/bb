import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import { z } from "zod";
import { action } from "../action.js";
import { outputJson } from "./helpers.js";

const exec = promisify(execFile);
const identitySchema = z.object({ hostId: z.string().min(1) });
const configSchema = z.object({ serverUrl: z.url() });
const statusSchema = z.object({
  hostId: z.string().nullable(),
  serverUrl: z.string(),
});

interface LifecycleOptions {
  hostId: string;
  serverUrl?: string;
  dataDir?: string;
}

interface LifecycleRuntime {
  homeDir: string;
  platform: NodeJS.Platform;
  uid: number;
  run(command: string, args: string[]): Promise<string>;
  status(port: number): Promise<unknown | null>;
  kill(pid: number): void;
  start(command: string, args: string[], dataDir: string): Promise<number>;
  sleep(): Promise<void>;
}

const runtime: LifecycleRuntime = {
  homeDir: homedir(),
  platform: process.platform,
  uid: process.getuid?.() ?? 0,
  async run(command, args) {
    return (await exec(command, args, { timeout: 15_000 })).stdout;
  },
  async status(port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok)
        throw new Error(`Daemon status returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.name === "TimeoutError")
      )
        return null;
      throw error;
    }
  },
  kill: (pid) => process.kill(pid, "SIGTERM"),
  async start(command, args, dataDir) {
    const log = openSync(join(dataDir, "install-daemon.log"), "a", 0o600);
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          BB_DATA_DIR: dataDir,
          BB_APP_NPM_PREFIX: join(dataDir, "npm"),
        },
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      if (child.pid === undefined) throw new Error("Daemon did not start.");
      return child.pid;
    } finally {
      closeSync(log);
    }
  },
  sleep: () => new Promise((resolve) => setTimeout(resolve, 250)),
};

async function optionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

function normalizedUrl(value: string): string {
  return new URL(value).href.replace(/\/+$/u, "");
}

async function installation(options: LifecycleOptions, deps: LifecycleRuntime) {
  const root = join(deps.homeDir, ".bb-machines");
  let candidates: string[];
  if (options.dataDir !== undefined) candidates = [resolve(options.dataDir)];
  else {
    try {
      candidates = (await readdir(root, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.name !== "host-daemon-ports" &&
            (entry.isDirectory() || entry.isSymbolicLink()),
        )
        .map((entry) => join(root, entry.name));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  const matches: Array<{ dataDir: string; serverUrl: string }> = [];
  for (const candidate of candidates) {
    const auth = await optionalText(join(candidate, "auth.json"));
    if (auth === null) continue;
    const identity = identitySchema.parse(JSON.parse(auth));
    if (identity.hostId !== options.hostId) {
      if (options.dataDir !== undefined)
        throw new Error("Machine data directory belongs to another host.");
      continue;
    }
    const dataDir = await realpath(candidate);
    const canonicalRoot = await realpath(root);
    if (
      dirname(dataDir) !== canonicalRoot ||
      basename(dataDir) === "host-daemon-ports" ||
      (await lstat(candidate)).isSymbolicLink()
    ) {
      throw new Error(
        "Refusing a machine data directory outside its installer-owned root.",
      );
    }
    const config = configSchema.parse(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    );
    if (
      options.serverUrl !== undefined &&
      normalizedUrl(config.serverUrl) !== normalizedUrl(options.serverUrl)
    ) {
      throw new Error("Machine data directory belongs to another server.");
    }
    matches.push({ dataDir, serverUrl: config.serverUrl });
  }
  if (matches.length > 1)
    throw new Error(
      "Host identity matches multiple machine installations; specify --data-dir.",
    );
  return matches[0] ?? null;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdEscape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
}

export async function runMachineLifecycle(
  operation: "start" | "stop" | "uninstall",
  options: LifecycleOptions,
  deps: LifecycleRuntime = runtime,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/u.test(options.hostId))
    throw new Error("Invalid machine host ID.");
  const installed = await installation(options, deps);
  if (installed === null) {
    if (operation === "start")
      throw new Error("Machine installation was not found.");
    return;
  }
  const { dataDir, serverUrl } = installed;
  const rawPort = (
    await readFile(join(dataDir, "host-daemon-port"), "utf8")
  ).trim();
  const port = Number(rawPort);
  if (
    !Number.isInteger(port) ||
    String(port) !== rawPort ||
    port < 1024 ||
    port === 38886 ||
    port === 38887 ||
    port > 65535
  )
    throw new Error("Refusing an invalid or default daemon port.");
  const serverHost = new URL(serverUrl).host.replace(/[^a-zA-Z0-9.-]/gu, "-");
  const slug = `${serverHost}-${options.hostId}`.replaceAll(".", "-");
  const serviceName =
    deps.platform === "darwin"
      ? `app.getbb.host-daemon.${slug}`
      : `bb-host-daemon-${slug}.service`;
  let servicePath =
    deps.platform === "darwin"
      ? join(deps.homeDir, "Library", "LaunchAgents", `${serviceName}.plist`)
      : join(deps.homeDir, ".config", "systemd", "user", serviceName);
  let systemdScope = "--user";
  const systemServicePath = join(dataDir, "systemd", serviceName);
  if (
    deps.platform === "linux" &&
    (await optionalText(systemServicePath)) !== null
  ) {
    if (deps.uid !== 0) throw new Error("Machine system service requires root.");
    if ((await optionalText(servicePath)) !== null)
      throw new Error("Machine has both user and system services.");
    if (
      (await realpath(dirname(systemServicePath))) !== dirname(systemServicePath)
    )
      throw new Error("Refusing a symlinked machine system service directory.");
    servicePath = systemServicePath;
    systemdScope = "--system";
  }
  const service = await optionalText(servicePath);
  if (service !== null) {
    const expected =
      deps.platform === "darwin"
        ? `<key>BB_DATA_DIR</key><string>${xmlEscape(dataDir)}</string>`
        : `Environment="BB_DATA_DIR=${systemdEscape(dataDir)}"`;
    if (
      !service.includes(expected) ||
      (await lstat(servicePath)).isSymbolicLink()
    )
      throw new Error("Machine service belongs to another installation.");
  }
  if (service !== null && systemdScope === "--system") {
    const expectedCommand = `host-daemon --auto-update --host-daemon-port "${port}" --server-url "${systemdEscape(serverUrl)}"`;
    const expectedLauncher = `"${systemdEscape(join(dataDir, "npm", "bin", "bb-app"))}"`;
    if (!service.includes(expectedCommand) || !service.includes(expectedLauncher)) {
      throw new Error(
        "Machine system service command belongs to another installation.",
      );
    }
  }
  let serviceRegistered = true;
  if (service !== null && systemdScope === "--system") {
    const loadedPath = (await deps.run("systemctl", [
      "--system", "show", "--property=FragmentPath", "--value", serviceName,
    ])).trim();
    serviceRegistered = loadedPath.length > 0;
    if (loadedPath && (await realpath(loadedPath)) !== (await realpath(servicePath)))
      throw new Error("Systemd loaded another machine service.");
  }
  async function connected() {
    const raw = await deps.status(port);
    if (raw === null) return false;
    const status = statusSchema.parse(raw);
    if (
      status.hostId !== options.hostId ||
      normalizedUrl(status.serverUrl) !== normalizedUrl(serverUrl)
    )
      throw new Error("Daemon port belongs to another host or server.");
    return true;
  }
  const active = await connected();
  const pidPath = join(dataDir, "install-daemon.pid");
  const pidText = await optionalText(pidPath);
  const pid = pidText === null ? null : Number(pidText.trim());
  if (pid !== null && (!Number.isInteger(pid) || pid <= 1))
    throw new Error("Invalid installed daemon PID.");
  const launcher = join(dataDir, "npm", "bin", "bb-app");
  async function ownedPid() {
    if (pid === null) return false;
    let command: string;
    try {
      command = await deps.run("ps", ["-p", String(pid), "-o", "command="]);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 1)
        return false;
      throw error;
    }
    if (command.trim().length === 0) return false;
    const canonicalLauncher = await realpath(launcher);
    const words = ` ${command.trim()} `;
    if (
      (!words.includes(` ${launcher} `) &&
        !words.includes(` ${canonicalLauncher} `)) ||
      !words.includes(" host-daemon ") ||
      !words.includes(` --host-daemon-port ${port} `) ||
      !words.includes(` --server-url ${serverUrl} `)
    )
      throw new Error("Recorded daemon PID belongs to another process.");
    return true;
  }
  const livePid = await ownedPid();
  const reservation = join(
    deps.homeDir,
    ".bb-machines",
    "host-daemon-ports",
    rawPort,
  );
  const reservationOwner = (
    await optionalText(join(reservation, "data-dir"))
  )?.trim();
  if (operation === "start") {
    if (active) return;
    if (service !== null) {
      if (deps.platform === "darwin")
        await deps.run("launchctl", [
          "bootstrap",
          `gui/${deps.uid}`,
          servicePath,
        ]);
      else {
        if (!serviceRegistered)
          await deps.run("systemctl", [systemdScope, "enable", servicePath]);
        await deps.run("systemctl", [systemdScope, "start", serviceName]);
      }
    } else if (!livePid) {
      const newPid = await deps.start(
        launcher,
        [
          "host-daemon",
          "--auto-update",
          "--host-daemon-port",
          rawPort,
          "--server-url",
          serverUrl,
        ],
        dataDir,
      );
      await writeFile(pidPath, `${newPid}\n`, { mode: 0o600 });
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await connected()) return;
      await deps.sleep();
    }
    throw new Error("Machine daemon did not start within 20 seconds.");
  }
  if (service !== null && serviceRegistered) {
    if (deps.platform === "darwin") {
      let loaded = true;
      try {
        await deps.run("launchctl", [
          "print",
          `gui/${deps.uid}/${serviceName}`,
        ]);
      } catch {
        loaded = false;
      }
      if (loaded)
        await deps.run("launchctl", [
          "bootout",
          `gui/${deps.uid}`,
          servicePath,
        ]);
    } else
      await deps.run("systemctl", [
        systemdScope,
        operation === "uninstall" ? "disable" : "stop",
        ...(operation === "uninstall" ? ["--now"] : []),
        serviceName,
      ]);
  }
  if (livePid && pid !== null && (await ownedPid())) deps.kill(pid);
  for (let attempt = 0; attempt < 80; attempt++) {
    if (!(await connected()) && !(await ownedPid())) break;
    if (attempt === 79)
      throw new Error("Machine daemon did not stop within 20 seconds.");
    await deps.sleep();
  }
  await rm(pidPath, { force: true });
  if (operation === "stop") return;
  if (service !== null) {
    await rm(servicePath);
    if (deps.platform === "linux")
      await deps.run("systemctl", [systemdScope, "daemon-reload"]);
  }
  if (reservationOwner === dataDir) {
    if ((await realpath(reservation)) !== reservation)
      throw new Error("Refusing a symlinked port reservation.");
    await rm(join(reservation, "data-dir"));
    await rmdir(reservation);
  }
  await rm(dataDir, { recursive: true });
}

export function registerMachineLifecycleCommands(machine: Command): void {
  for (const operation of ["start", "stop", "uninstall"] as const) {
    machine
      .command(operation)
      .description(
        `${operation === "start" ? "Start" : operation === "stop" ? "Stop" : "Uninstall"} an owned local machine daemon`,
      )
      .requiredOption("--host-id <id>", "Expected enrolled host identity")
      .option(
        "--server-url <url>",
        "Assert the installation belongs to this server",
      )
      .option(
        "--data-dir <path>",
        "Select an installer-owned machine directory",
      )
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (options: LifecycleOptions & { json?: boolean }) => {
          await runMachineLifecycle(operation, {
            ...options,
            dataDir: options.dataDir ?? process.env.BB_DATA_DIR,
          });
          if (
            !outputJson(options, {
              hostId: options.hostId,
              operation,
              status: "complete",
            })
          ) {
            console.log(`Machine ${options.hostId}: ${operation} complete.`);
          }
        }),
      );
  }
}
