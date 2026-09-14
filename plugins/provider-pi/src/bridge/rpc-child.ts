import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { extname } from "node:path";
import { PassThrough, Writable, type Readable } from "node:stream";
import {
  experimental_isProviderBridgeRecording,
  experimental_readBoundedLines,
  experimental_recordProviderChildIo,
  sanitizeInheritedChildProcessEnv,
  withoutBridgeRuntimeEnv,
} from "@get-bb/plugin-sdk/provider-bridge";

export const PI_BRIDGE_COMMAND_ENV = "BB_PI_BRIDGE_COMMAND";
export const PI_BRIDGE_ARGS_ENV = "BB_PI_BRIDGE_ARGS";
export const PI_CHANNEL_PIPE_ENV = "BB_PI_BRIDGE_CHANNEL_PIPE";

export const PI_CHANNEL_RECORDING_KEY = "bbChannel";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const NO_REQUEST_TIMEOUT = 0;
const STDERR_TAIL_BYTES = 4_096;
const SIGTERM_GRACE_MS = 4_000;
const SIGKILL_ESCALATION_MS = 4_000;
const MAX_CHANNEL_PIPE_PENDING_WRITES = 10_000;

export interface PiRpcChildExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface PiRpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SpawnPiRpcChildArgs {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: readonly string[];
  onEvent: (event: Record<string, unknown>) => void;
  onChannelMessage: (message: Record<string, unknown>) => void;
  onExit: (info: PiRpcChildExitInfo) => void;
  recordThreadId: string | null;
  onExtensionUiRequest?: (request: Record<string, unknown>) => void;
}

export class PiRpcChildExitedError extends Error {
  constructor(info: PiRpcChildExitInfo) {
    super(
      `pi exited (code ${info.code ?? "null"}, signal ${info.signal ?? "null"})${
        info.stderrTail ? `: ${info.stderrTail.trim()}` : ""
      }`,
    );
    this.name = "PiRpcChildExitedError";
  }
}

interface PendingRequest {
  resolve: (response: PiRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function resolvePiLaunch(env: NodeJS.ProcessEnv): {
  command: string;
  args: string[];
} {
  const command = env[PI_BRIDGE_COMMAND_ENV];
  if (!command) {
    return { command: "pi", args: [] };
  }
  const rawArgs = env[PI_BRIDGE_ARGS_ENV];
  if (!rawArgs) {
    return { command, args: [] };
  }
  const parsed: unknown = JSON.parse(rawArgs);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new Error(`${PI_BRIDGE_ARGS_ENV} must be a JSON array of strings`);
  }
  return { command, args: parsed };
}

const WINDOWS_BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);

export function piLaunchRequiresWindowsShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    return false;
  }
  const extension = extname(command).toLowerCase();
  return extension === "" || WINDOWS_BATCH_EXTENSIONS.has(extension);
}

export function planPiChildKill(args: {
  windowsShellChild: boolean;
  platform: NodeJS.Platform;
}): { signal: NodeJS.Signals | null; escalateImmediately: boolean } {
  if (args.windowsShellChild) {
    return { signal: null, escalateImmediately: true };
  }
  return {
    signal: args.platform === "win32" ? null : "SIGTERM",
    escalateImmediately: false,
  };
}

export interface WindowsShellKillSpawn {
  (
    command: string,
    args: readonly string[],
    options: { stdio: "ignore"; windowsHide: boolean },
  ): { on(event: "error", listener: (error: Error) => void): unknown };
}

export function escalateWindowsShellChildKill(args: {
  pid: number | undefined;
  killFallback: (signal: NodeJS.Signals) => unknown;
  spawnProcess?: WindowsShellKillSpawn;
}): void {
  const { pid } = args;
  if (pid === undefined) {
    return;
  }
  const spawnProcess = args.spawnProcess ?? spawn;
  try {
    const taskkill = spawnProcess(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    taskkill.on("error", () => {
      args.killFallback("SIGKILL");
    });
  } catch {
    args.killFallback("SIGKILL");
  }
}

class WindowsChannelPipe {
  readonly pipePath: string;
  private readonly server: Server;
  private socket: Socket | null = null;
  private readonly pendingWrites: string[] = [];

  constructor(onLine: (line: string) => void) {
    this.pipePath = `\\\\.\\pipe\\bb-pi-${process.pid}-${randomUUID()}`;
    this.server = createServer((socket) => {
      if (this.socket !== null) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      socket.on("error", () => undefined);
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
      experimental_readBoundedLines({
        input: socket,
        onLine,
        onOverflow: (bytes) => {
          process.stderr.write(
            `pi bridge: dropped a ${bytes}-byte channel line\n`,
          );
        },
      });
      for (const line of this.pendingWrites.splice(0)) {
        socket.write(line);
      }
    });
    this.server.on("error", () => undefined);
    this.server.listen(this.pipePath);
    this.server.unref();
  }

  write(line: string): void {
    const socket = this.socket;
    if (socket === null || socket.destroyed || socket.writableEnded) {
      if (this.pendingWrites.length >= MAX_CHANNEL_PIPE_PENDING_WRITES) {
        process.stderr.write(
          `pi bridge: dropped a channel line; ${MAX_CHANNEL_PIPE_PENDING_WRITES} pending writes buffered\n`,
        );
        return;
      }
      this.pendingWrites.push(line);
      return;
    }
    socket.write(line);
  }

  endWrites(): void {
    const socket = this.socket;
    if (socket !== null && !socket.destroyed && !socket.writableEnded) {
      socket.end();
    }
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.server.close();
  }
}

export function buildPiChildEnv(
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...withoutBridgeRuntimeEnv(
      sanitizeInheritedChildProcessEnv({ env: process.env }),
    ),
    ...overrides,
  };
}

export class PiRpcChild {
  readonly child: ChildProcess;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;
  private stderrTail = "";
  private exitInfo: PiRpcChildExitInfo | null = null;
  private readonly settledExit: Promise<PiRpcChildExitInfo>;
  private readonly channelWriter: Writable | null;
  private readonly channelRecorder: ChannelRecorder | null;
  private killEscalation: ReturnType<typeof setTimeout> | null = null;
  private readonly windowsChannel: WindowsChannelPipe | null;
  private readonly windowsShellChild: boolean;
  private readonly stdoutLines: string[] = [];
  private stdoutDraining = false;

  constructor(private readonly args: SpawnPiRpcChildArgs) {
    let resolveSettledExit: (info: PiRpcChildExitInfo) => void = () =>
      undefined;
    this.settledExit = new Promise((resolve) => {
      resolveSettledExit = resolve;
    });
    const launch = resolvePiLaunch(process.env);
    let childEnv = args.env;
    this.windowsShellChild = piLaunchRequiresWindowsShell(launch.command);
    this.windowsChannel = this.windowsShellChild
      ? new WindowsChannelPipe((line) => this.handleChannelLine(line))
      : null;
    if (this.windowsChannel !== null) {
      childEnv = {
        ...args.env,
        [PI_CHANNEL_PIPE_ENV]: this.windowsChannel.pipePath,
      };
    }
    this.child = spawn(launch.command, [...launch.args, ...args.args], {
      cwd: args.cwd,
      env: childEnv,
      stdio: this.windowsShellChild
        ? ["pipe", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe", "pipe", "pipe"],
      shell: this.windowsShellChild,
      windowsHide: process.platform === "win32",
    });
    experimental_recordProviderChildIo(this.child, {
      threadId: args.recordThreadId,
    });
    this.channelRecorder = createChannelRecorder(args.recordThreadId);
    const stdout = this.child.stdout;
    const stderr = this.child.stderr;
    const channelIn = this.child.stdio[3] as Readable | null | undefined;
    this.channelWriter = (this.child.stdio[4] as Writable | null) ?? null;
    this.child.stdin?.on("error", () => undefined);
    this.channelWriter?.on("error", () => undefined);
    if (stdout) {
      experimental_readBoundedLines({
        input: stdout,
        onLine: (line) => this.queueStdoutLine(line),
        onOverflow: (bytes) => {
          process.stderr.write(
            `pi bridge: dropped a ${bytes}-byte stdout line\n`,
          );
        },
      });
    }
    if (stderr) {
      stderr.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES);
        process.stderr.write(`pi[${String(this.child.pid ?? "?")}]: ${text}`);
      });
    }
    if (channelIn) {
      experimental_readBoundedLines({
        input: channelIn,
        onLine: (line) => this.handleChannelLine(line),
        onOverflow: (bytes) => {
          process.stderr.write(
            `pi bridge: dropped a ${bytes}-byte channel line\n`,
          );
        },
      });
    }
    const settleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.exitInfo !== null) {
        return;
      }
      if (this.killEscalation !== null) {
        clearTimeout(this.killEscalation);
        this.killEscalation = null;
      }
      this.windowsChannel?.close();
      const info: PiRpcChildExitInfo = {
        code,
        signal,
        stderrTail: this.stderrTail,
      };
      this.exitInfo = info;
      resolveSettledExit(info);
      for (const [, pending] of this.pending) {
        if (pending.timer !== null) clearTimeout(pending.timer);
        pending.reject(new PiRpcChildExitedError(info));
      }
      this.pending.clear();
      args.onExit(info);
    };
    this.child.on("error", (error) => {
      this.stderrTail = `${this.stderrTail}${error.message}`;
    });
    this.child.on("exit", settleExit);
    this.child.on("close", (code, signal) => settleExit(code, signal));
  }

  get exited(): boolean {
    return this.exitInfo !== null;
  }

  waitForExit(): Promise<PiRpcChildExitInfo> {
    return this.settledExit;
  }

  request(
    command: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<PiRpcResponse> {
    if (this.exitInfo !== null) {
      return Promise.reject(new PiRpcChildExitedError(this.exitInfo));
    }
    this.nextRequestId += 1;
    const id = `bb-${this.nextRequestId}`;
    return new Promise<PiRpcResponse>((resolve, reject) => {
      const timer =
        timeoutMs === NO_REQUEST_TIMEOUT
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(`pi did not answer ${String(command.type)} in time`),
              );
            }, timeoutMs);
      timer?.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.writeStdin(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  async requestOk(
    command: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    const response = await this.request(command, timeoutMs);
    if (!response.success) {
      throw new Error(response.error ?? `pi rejected ${String(command.type)}`);
    }
    return response.data;
  }

  sendChannel(message: Record<string, unknown>): void {
    if (this.windowsChannel !== null) {
      this.channelRecorder?.toChild(message);
      this.windowsChannel.write(`${JSON.stringify(message)}\n`);
      return;
    }
    const writer = this.channelWriter;
    if (!writer || writer.destroyed || writer.writableEnded) {
      return;
    }
    this.channelRecorder?.toChild(message);
    writer.write(`${JSON.stringify(message)}\n`);
  }

  closeGracefully(): void {
    if (this.exitInfo !== null) {
      return;
    }
    this.endWriters();
    const timer = setTimeout(() => {
      if (this.exitInfo === null) {
        this.kill();
      }
    }, SIGTERM_GRACE_MS);
    timer.unref?.();
  }

  kill(): void {
    if (this.exitInfo !== null) {
      return;
    }
    this.endWriters();
    const plan = planPiChildKill({
      windowsShellChild: this.windowsShellChild,
      platform: process.platform,
    });
    if (plan.escalateImmediately) {
      this.escalateKill();
      return;
    }
    if (this.killEscalation === null) {
      this.killEscalation = setTimeout(() => {
        this.killEscalation = null;
        if (this.exitInfo === null) {
          this.escalateKill();
        }
      }, SIGKILL_ESCALATION_MS);
      this.killEscalation.unref?.();
    }
    if (plan.signal !== null) {
      this.child.kill(plan.signal);
    }
  }

  private escalateKill(): void {
    if (!this.windowsShellChild) {
      this.child.kill("SIGKILL");
      return;
    }
    escalateWindowsShellChildKill({
      pid: this.child.pid,
      killFallback: (signal) => this.child.kill(signal),
    });
  }

  respondToExtensionUi(
    id: string | number,
    fields: Record<string, unknown>,
  ): void {
    this.writeStdin(
      `${JSON.stringify({ type: "extension_ui_response", id, ...fields })}\n`,
    );
  }

  private endWriters(): void {
    try {
      this.child.stdin?.end();
    } catch {}
    try {
      this.channelWriter?.end();
    } catch {}
    this.windowsChannel?.endWrites();
  }

  private writeStdin(line: string): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) {
      return;
    }
    stdin.write(line);
  }

  private queueStdoutLine(line: string): void {
    this.stdoutLines.push(line);
    if (!this.stdoutDraining) {
      this.stdoutDraining = true;
      this.drainStdoutLine();
    }
  }

  private drainStdoutLine(): void {
    const line = this.stdoutLines.shift();
    if (line === undefined) {
      this.stdoutDraining = false;
      return;
    }
    try {
      this.handleStdoutLine(line);
    } finally {
      setImmediate(() => this.drainStdoutLine());
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const message = parsed as Record<string, unknown>;
    if (message.type === "response") {
      const id = typeof message.id === "string" ? message.id : undefined;
      const pending = id === undefined ? undefined : this.pending.get(id);
      if (pending && id !== undefined) {
        this.pending.delete(id);
        if (pending.timer !== null) clearTimeout(pending.timer);
        pending.resolve(message as unknown as PiRpcResponse);
      }
      return;
    }
    if (message.type === "extension_ui_request") {
      if (this.args.onExtensionUiRequest) {
        this.args.onExtensionUiRequest(message);
      } else {
        this.writeStdin(
          `${JSON.stringify({
            type: "extension_ui_response",
            id: message.id,
            cancelled: true,
          })}\n`,
        );
      }
      return;
    }
    if (typeof message.type === "string") {
      this.args.onEvent(message);
    }
  }

  private handleChannelLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        this.channelRecorder?.fromChild(parsed);
        this.args.onChannelMessage(parsed as Record<string, unknown>);
      }
    } catch {}
  }
}

interface ChannelRecorder {
  fromChild(message: unknown): void;
  toChild(message: unknown): void;
}

function createChannelRecorder(
  threadId: string | null,
): ChannelRecorder | null {
  if (!experimental_isProviderBridgeRecording()) {
    return null;
  }
  const fromChild = new PassThrough();
  const toChild = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  experimental_recordProviderChildIo(
    { stdin: toChild, stdout: fromChild },
    { threadId },
  );
  const wrap = (message: unknown): string =>
    `${JSON.stringify({ [PI_CHANNEL_RECORDING_KEY]: message })}\n`;
  return {
    fromChild: (message) => {
      fromChild.push(wrap(message));
    },
    toChild: (message) => {
      toChild.write(wrap(message));
    },
  };
}
