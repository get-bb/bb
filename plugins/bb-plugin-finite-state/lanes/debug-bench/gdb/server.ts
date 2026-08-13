import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { connect } from "node:net";
import { isAbsolute } from "node:path";

export type GdbServerKind = "openocd" | "jlink";

export interface GdbServerConfig {
  kind: GdbServerKind;
  executablePath: string;
  targetConfig: string;
  connection: string;
  gdbPort: number;
  interface?: "swd" | "jtag";
  rtos?: "freertos" | "zephyr";
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  maxOutputBytes?: number;
}

export interface GdbServerHandle {
  readonly kind: GdbServerKind;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly argv: readonly string[];
  diagnostics(): { stdout: string; stderr: string };
  dispose(): Promise<void>;
}

type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface GdbServerDeps {
  spawnProcess?: SpawnProcess;
  healthProbe?: (port: number, signal: AbortSignal) => Promise<void>;
}

export class DebugBenchConfigurationError extends Error {
  readonly needsConfiguration = true;

  constructor(
    readonly tool: "gdb" | "openocd" | "jlink" | "python3" | "renode",
    readonly remediation: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NeedsConfigurationError";
  }
}

export class GdbServerError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GdbServerError";
  }
}

export interface DebugBenchPrerequisite {
  tool: DebugBenchConfigurationError["tool"];
  configured: boolean;
  executablePath: string | null;
  remediation: string;
}

export interface DebugBenchPrerequisiteReport {
  needsConfiguration: boolean;
  tools: DebugBenchPrerequisite[];
}

class BoundedText {
  #value = Buffer.alloc(0);

  constructor(private readonly limit: number) {}

  append(chunk: Buffer): void {
    const combined = Buffer.concat([this.#value, chunk]);
    this.#value = combined.byteLength <= this.limit
      ? combined
      : combined.subarray(combined.byteLength - this.limit);
  }

  text(): string { return this.#value.toString("utf8"); }
}

function positivePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new GdbServerError("INVALID_GDB_PORT", "GDB server port must be an integer from 1 to 65535.");
  }
  return value;
}

function boundedText(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 1024 || /[\u0000\r\n]/u.test(trimmed)) {
    throw new GdbServerError("INVALID_GDB_SERVER_CONFIG", `${name} must be a bounded single-line value.`);
  }
  return trimmed;
}

function probeSerial(connection: string): string {
  const value = boundedText("connection", connection);
  const parts = value.split(":");
  const serial = value.startsWith("usb:") ? parts.at(-1)?.trim() ?? "" : value;
  if (value.startsWith("usb:") && (parts.length < 4 || serial.length === 0)) {
    throw new GdbServerError("INVALID_GDB_SERVER_CONFIG", "USB probe connections must include the registry serial number.");
  }
  if (!/^[A-Za-z0-9._-]{1,256}$/u.test(serial)) {
    throw new GdbServerError("INVALID_GDB_SERVER_CONFIG", "The registry probe serial has unsafe characters.");
  }
  return serial;
}

export function gdbServerArgv(config: GdbServerConfig): string[] {
  const port = positivePort(config.gdbPort).toString();
  const connection = probeSerial(config.connection);
  const target = boundedText("targetConfig", config.targetConfig);
  if (config.kind === "openocd") {
    return [
      "-f", target,
      "-c", `gdb_port ${port}`,
      "-c", `adapter serial ${connection}`,
      ...(config.rtos ? ["-c", `$_TARGETNAME configure -rtos ${config.rtos}`] : []),
      "-c", "init",
    ];
  }
  return [
    "-select", `USB=${connection}`,
    "-device", target,
    "-if", (config.interface ?? "swd").toUpperCase(),
    "-port", port,
    "-noir",
    ...(config.rtos ? ["-rtos", config.rtos] : []),
  ];
}

export async function resolveExecutable(
  path: string,
  tool: DebugBenchConfigurationError["tool"],
  remediation: string,
): Promise<string> {
  if (!isAbsolute(path)) {
    throw new DebugBenchConfigurationError(
      tool,
      remediation,
      `${tool} must be configured with an absolute executable path.`,
    );
  }
  try {
    const canonical = await realpath(path);
    const stat = await lstat(canonical);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular executable");
    await access(canonical, constants.X_OK);
    return canonical;
  } catch (error) {
    throw new DebugBenchConfigurationError(
      tool,
      remediation,
      `${tool} is missing or is not executable at the configured path.`,
      { cause: error },
    );
  }
}

export async function inspectDebugBenchPrerequisites(input: {
  python3: string | null;
  gdb: string | null;
  openocd: string | null;
  jlink: string | null;
}): Promise<DebugBenchPrerequisiteReport> {
  const descriptors = [
    { tool: "python3" as const, path: input.python3, remediation: "Install Python 3 and configure its absolute executable path." },
    { tool: "gdb" as const, path: input.gdb, remediation: "Install arm-none-eabi-gdb or gdb-multiarch and configure its absolute executable path." },
    { tool: "openocd" as const, path: input.openocd, remediation: "Install OpenOCD and configure its absolute executable path." },
    { tool: "jlink" as const, path: input.jlink, remediation: "Install SEGGER J-Link tools and configure the absolute JLinkGDBServer path." },
  ];
  const tools = await Promise.all(descriptors.map(async (descriptor): Promise<DebugBenchPrerequisite> => {
    if (descriptor.path === null) {
      return { tool: descriptor.tool, configured: false, executablePath: null, remediation: descriptor.remediation };
    }
    try {
      return {
        tool: descriptor.tool,
        configured: true,
        executablePath: await resolveExecutable(descriptor.path, descriptor.tool, descriptor.remediation),
        remediation: descriptor.remediation,
      };
    } catch {
      return { tool: descriptor.tool, configured: false, executablePath: descriptor.path, remediation: descriptor.remediation };
    }
  }));
  const requiredConfigured = (tool: DebugBenchConfigurationError["tool"]) =>
    tools.find((entry) => entry.tool === tool)?.configured === true;
  return {
    needsConfiguration: !requiredConfigured("python3") || !requiredConfigured("gdb") ||
      (!requiredConfigured("openocd") && !requiredConfigured("jlink")),
    tools,
  };
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

async function defaultHealthProbe(port: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const abort = () => socket.destroy(signal.reason instanceof Error ? signal.reason : undefined);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => { signal.removeEventListener("abort", abort); socket.destroy(); resolve(); });
    socket.once("error", (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function stopProcess(child: ChildProcess, timeoutMs: number): Promise<void> {
  const destroyPipes = () => {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  if (child.exitCode !== null || child.signalCode !== null) {
    destroyPipes();
    return;
  }
  const signalGroup = (processSignal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, processSignal);
      else child.kill(processSignal);
    } catch {
      try { child.kill(processSignal); } catch { /* Process already exited. */ }
    }
  };
  let onExit: (() => void) | null = null;
  const exited = new Promise<true>((resolve) => {
    onExit = () => resolve(true);
    child.once("exit", onExit);
  });
  signalGroup("SIGTERM");
  let deadline: NodeJS.Timeout | null = null;
  const stopped = await Promise.race([
    exited,
    new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  if (deadline !== null) clearTimeout(deadline);
  if (!stopped) signalGroup("SIGKILL");
  if (onExit) child.removeListener("exit", onExit);
  destroyPipes();
}

export async function startGdbServer(
  deps: GdbServerDeps,
  config: GdbServerConfig,
  signal: AbortSignal,
): Promise<GdbServerHandle> {
  signal.throwIfAborted();
  const tool = config.kind === "openocd" ? "openocd" : "jlink";
  const executable = await resolveExecutable(
    config.executablePath,
    tool,
    config.kind === "openocd"
      ? "Install OpenOCD and configure its absolute executable path and target .cfg."
      : "Install SEGGER J-Link tools and configure the absolute JLinkGDBServer path.",
  );
  const argv = gdbServerArgv(config);
  const maxOutput = config.maxOutputBytes ?? 32 * 1024;
  const stdout = new BoundedText(maxOutput);
  const stderr = new BoundedText(maxOutput);
  const child = (deps.spawnProcess ?? spawn)(executable, argv, {
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
  let spawnError: Error | null = null;
  child.once("error", (error) => { spawnError = error; });
  let disposePromise: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      signal.removeEventListener("abort", onAbort);
      await stopProcess(child, config.stopTimeoutMs ?? 2_000);
    })();
    return disposePromise;
  };
  const onAbort = () => { void dispose(); };
  signal.addEventListener("abort", onAbort, { once: true });

  const healthController = new AbortController();
  const startupTimer = setTimeout(
    () => healthController.abort(new GdbServerError("GDB_SERVER_START_TIMEOUT", "GDB server did not become healthy in time.")),
    config.startupTimeoutMs ?? 10_000,
  );
  const abortHealth = () => healthController.abort(signal.reason);
  signal.addEventListener("abort", abortHealth, { once: true });
  try {
    let lastError: unknown;
    while (!healthController.signal.aborted) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) {
        throw new GdbServerError(
          "GDB_SERVER_EXITED",
          `${tool} exited with code ${child.exitCode}: ${stderr.text().trim() || stdout.text().trim() || "no diagnostics"}`,
        );
      }
      try {
        await (deps.healthProbe ?? defaultHealthProbe)(config.gdbPort, healthController.signal);
        break;
      } catch (error) {
        lastError = error;
        await sleep(25, healthController.signal).catch(() => undefined);
      }
    }
    if (healthController.signal.aborted) {
      throw healthController.signal.reason ?? lastError ?? new Error("GDB server health probe aborted");
    }
  } catch (error) {
    await dispose();
    if (error instanceof GdbServerError || error instanceof DebugBenchConfigurationError) throw error;
    throw new GdbServerError("GDB_SERVER_START_FAILED", `${tool} could not start: ${stderr.text().trim() || "health probe failed"}`, { cause: error });
  } finally {
    clearTimeout(startupTimer);
    signal.removeEventListener("abort", abortHealth);
  }

  return {
    kind: config.kind,
    host: "127.0.0.1",
    port: config.gdbPort,
    argv,
    diagnostics: () => ({ stdout: stdout.text(), stderr: stderr.text() }),
    dispose,
  };
}
