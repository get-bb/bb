import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type Database from "better-sqlite3";
import { verifyDeviceClaim, type DeviceClaim } from "../registry/claims.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import { getDevice, type RegistryScope } from "../registry/store.js";
import { readRtosState, type RtosTask, type RtosTaskOptions } from "./rtos.js";
import {
  DebugBenchConfigurationError,
  type GdbServerConfig,
  type GdbServerDeps,
  type GdbServerHandle,
  type GdbServerKind,
  resolveExecutable,
  startGdbServer,
} from "./server.js";
import { GdbMiParser, type MiRecord, type MiResultRecord, type MiValue } from "./mi.js";

export interface BreakpointRef {
  id: string;
  location: string;
  delete(): Promise<void>;
}

export interface StackFrame {
  level: number;
  address: string;
  function: string | null;
  file: string | null;
  line: number | null;
}

export interface HardwareIoThrottle {
  acquire(signal: AbortSignal): Promise<void>;
}

export interface GdbSession {
  readonly deviceId: string;
  readonly serverKind: GdbServerKind;
  setBreakpoint(location: string): Promise<BreakpointRef>;
  readRegisters(): Promise<Record<string, string>>;
  readMemory(addr: string, bytes: number): Promise<Uint8Array>;
  backtrace(): Promise<StackFrame[]>;
  rtosTasks(): Promise<{ method: "server" | "symbols"; tasks: RtosTask[] }>;
  dispose(): Promise<void>;
}

export interface DebugGdbSession extends GdbSession {
  executeCommand(command: string, args?: readonly string[]): Promise<MiResultRecord>;
  halt(): Promise<void>;
  continue(): Promise<void>;
}

type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface DebugBenchDeps {
  db: Database.Database;
  registryScope: RegistryScope;
  gdbExecutablePath: string;
  gdbRemediation?: string;
  serverConfig(device: BenchDeviceRecord): Omit<GdbServerConfig, "connection">;
  releaseClaim(deviceId: string, holder: string): void | Promise<void>;
  serverDeps?: GdbServerDeps;
  startServer?: typeof startGdbServer;
  spawnProcess?: SpawnProcess;
  throttle?: HardwareIoThrottle;
  commandTimeoutMs?: number;
  rtos?: RtosTaskOptions;
}

export class GdbSessionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GdbSessionError";
  }
}

function objectValue(value: MiValue | undefined): Record<string, MiValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function listValue(value: MiValue | undefined): MiValue[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: MiValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numeric(value: MiValue | undefined): number | null {
  const text = stringValue(value);
  if (text === null || !/^\d+$/u.test(text)) return null;
  return Number.parseInt(text, 10);
}

function miQuote(value: string): string {
  if (value.length === 0 || value.length > 4096 || /[\u0000\r\n]/u.test(value)) {
    throw new GdbSessionError("INVALID_GDB_ARGUMENT", "GDB arguments must be bounded single-line strings.");
  }
  return JSON.stringify(value);
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch { child.kill("SIGTERM"); }
  const ended = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!ended) {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch { child.kill("SIGKILL"); }
    await closed;
  }
}

interface PendingCommand {
  resolve(record: MiResultRecord): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

class MiTransport {
  #nextToken = 1;
  #pending = new Map<number, PendingCommand>();
  #parser = new GdbMiParser();
  #closed = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly timeoutMs: number,
    private readonly throttle: HardwareIoThrottle | undefined,
    private readonly signal: AbortSignal,
  ) {
    child.stdout?.on("data", (chunk: Buffer) => this.#records(this.#parser.push(chunk.toString("utf8"))));
    child.once("error", (error) => this.#failAll(new GdbSessionError("GDB_PROCESS_ERROR", error.message, { cause: error })));
    child.once("close", (code) => {
      this.#records(this.#parser.finish());
      this.#failAll(new GdbSessionError("GDB_PROCESS_EXITED", `GDB exited with code ${code ?? "unknown"}.`));
    });
  }

  #records(records: readonly MiRecord[]): void {
    for (const record of records) {
      if (record.kind === "malformed") continue;
      if (record.kind !== "result" || record.token === null) continue;
      const pending = this.#pending.get(record.token);
      if (!pending) continue;
      this.#pending.delete(record.token);
      clearTimeout(pending.timer);
      if (record.class === "error") {
        const message = stringValue(record.results.msg) ?? "GDB command failed";
        pending.reject(new GdbSessionError("GDB_COMMAND_FAILED", message));
      } else pending.resolve(record);
    }
  }

  #failAll(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async command(command: string, args: readonly string[] = []): Promise<MiResultRecord> {
    this.signal.throwIfAborted();
    if (!/^-[A-Za-z0-9-]{1,127}$/u.test(command) || args.length > 64 ||
      args.some((argument) => argument.length > 4096 || /[\u0000\r\n]/u.test(argument))) {
      throw new GdbSessionError("INVALID_GDB_ARGUMENT", "GDB/MI commands and arguments must be bounded single-line values.");
    }
    if (this.#closed || !this.child.stdin?.writable) {
      throw new GdbSessionError("GDB_SESSION_CLOSED", "The GDB session is closed.");
    }
    await this.throttle?.acquire(this.signal);
    const token = this.#nextToken++;
    const wire = `${token}${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}\n`;
    return await new Promise<MiResultRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(token);
        reject(new GdbSessionError("GDB_COMMAND_TIMEOUT", `${command} timed out.`));
      }, this.timeoutMs);
      this.#pending.set(token, { resolve, reject, timer });
      this.child.stdin!.write(wire, "utf8", (error) => {
        if (!error) return;
        const pending = this.#pending.get(token);
        if (!pending) return;
        this.#pending.delete(token);
        clearTimeout(pending.timer);
        reject(new GdbSessionError("GDB_WRITE_FAILED", "Could not write the GDB command.", { cause: error }));
      });
    });
  }

  close(): void { this.#failAll(new GdbSessionError("GDB_SESSION_CLOSED", "The GDB session was disposed.")); }
}

function requireClaim(deps: DebugBenchDeps, deviceId: string, claim: DeviceClaim): BenchDeviceRecord {
  verifyDeviceClaim(deps.db, claim, deviceId);
  const device = getDevice(deps.db, deps.registryScope, deviceId);
  if (!device || device.claimedBy !== claim.holder) {
    throw new GdbSessionError("DEVICE_CLAIM_REQUIRED", `A live claim for device ${deviceId} is required.`);
  }
  if (device.kind !== "probe" || device.stale) {
    throw new GdbSessionError("DEVICE_UNAVAILABLE", `Device ${deviceId} is not a live debug probe.`);
  }
  return device;
}

function frameFrom(value: MiValue): StackFrame | null {
  const wrapper = objectValue(value);
  const frame = objectValue(wrapper?.frame) ?? wrapper;
  if (!frame) return null;
  const level = numeric(frame.level);
  const address = stringValue(frame.addr);
  if (level === null || address === null) return null;
  return {
    level,
    address,
    function: stringValue(frame.func),
    file: stringValue(frame.fullname) ?? stringValue(frame.file),
    line: numeric(frame.line),
  };
}

export async function openGdbSession(
  deps: DebugBenchDeps,
  deviceId: string,
  claim: DeviceClaim,
  signal: AbortSignal,
): Promise<DebugGdbSession> {
  signal.throwIfAborted();
  const device = requireClaim(deps, deviceId, claim);
  const holder = claim.holder;
  signal.throwIfAborted();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await deps.releaseClaim(deviceId, holder);
  };
  let gdb: string;
  let config: GdbServerConfig;
  try {
    gdb = await resolveExecutable(
      deps.gdbExecutablePath,
      "gdb",
      deps.gdbRemediation ?? "Install arm-none-eabi-gdb or gdb-multiarch and configure its absolute executable path.",
    );
    config = { ...deps.serverConfig(device), connection: device.connection };
  } catch (error) {
    await release();
    throw error;
  }
  let server: GdbServerHandle | null = null;
  let child: ChildProcess | null = null;
  let transport: MiTransport | null = null;
  let disposePromise: Promise<void> | null = null;

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      signal.removeEventListener("abort", onAbort);
      transport?.close();
      if (child) await terminate(child);
      if (server) await server.dispose();
      await release();
    })();
    return disposePromise;
  };
  const onAbort = () => { void dispose(); };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    server = await (deps.startServer ?? startGdbServer)(deps.serverDeps ?? {}, config, signal);
    child = (deps.spawnProcess ?? spawn)(gdb, ["--interpreter=mi3", "--nx", "--quiet"], {
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr?.resume();
    transport = new MiTransport(child, deps.commandTimeoutMs ?? 5_000, deps.throttle, signal);
    await transport.command("-gdb-set", ["pagination", "off"]);
    await transport.command("-target-select", ["remote", `${server.host}:${server.port}`]);
  } catch (error) {
    await dispose();
    if (error instanceof DebugBenchConfigurationError || error instanceof GdbSessionError) throw error;
    throw new GdbSessionError("GDB_SESSION_OPEN_FAILED", "Could not open the claimed GDB session.", { cause: error });
  }

  const command = (name: string, args: readonly string[] = []) => {
    if (!transport) throw new GdbSessionError("GDB_SESSION_CLOSED", "The GDB session is closed.");
    return transport.command(name, args);
  };

  const session: DebugGdbSession = {
    deviceId,
    serverKind: config.kind,
    executeCommand: command,
    async setBreakpoint(location) {
      const safe = miQuote(location);
      const result = await command("-break-insert", ["-f", safe]);
      const bkpt = objectValue(result.results.bkpt);
      const id = stringValue(bkpt?.number);
      if (!id) throw new GdbSessionError("GDB_RESPONSE_INVALID", "GDB did not return a breakpoint id.");
      return {
        id,
        location,
        delete: async () => { await command("-break-delete", [id]); },
      };
    },
    async readRegisters() {
      const [namesRecord, valuesRecord] = await Promise.all([
        command("-data-list-register-names"),
        command("-data-list-register-values", ["x"]),
      ]);
      const names = listValue(namesRecord.results["register-names"]).map(stringValue);
      const registers: Record<string, string> = {};
      for (const item of listValue(valuesRecord.results["register-values"])) {
        const row = objectValue(item);
        const number = numeric(row?.number);
        const value = stringValue(row?.value);
        if (number === null || value === null) continue;
        registers[names[number] ?? `r${number}`] = value;
      }
      return registers;
    },
    async readMemory(addr, bytes) {
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > 64 * 1024) {
        throw new GdbSessionError("MEMORY_READ_BOUND", "Memory reads must request 1 through 65536 bytes.");
      }
      const address = miQuote(addr);
      const result = await command("-data-read-memory-bytes", [address, bytes.toString()]);
      const memory = listValue(result.results.memory).map(objectValue).find(Boolean);
      const contents = stringValue(memory?.contents);
      if (!contents || !/^(?:[a-fA-F0-9]{2})+$/u.test(contents) || contents.length !== bytes * 2) {
        throw new GdbSessionError("GDB_RESPONSE_INVALID", "GDB returned invalid memory bytes.");
      }
      return Uint8Array.from(Buffer.from(contents, "hex"));
    },
    async backtrace() {
      const result = await command("-stack-list-frames");
      return listValue(result.results.stack).map(frameFrom).filter((frame): frame is StackFrame => frame !== null);
    },
    async rtosTasks() { return readRtosState(command, deps.rtos); },
    async halt() { await command("-exec-interrupt", ["--all"]); },
    async continue() { await command("-exec-continue"); },
    dispose,
  };
  return session;
}
