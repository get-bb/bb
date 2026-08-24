import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough, Writable, type Readable } from "node:stream";
import {
  experimental_isProviderBridgeRecording,
  experimental_readBoundedLines,
  experimental_recordProviderChildIo,
  sanitizeInheritedChildProcessEnv,
  withoutBridgeRuntimeEnv,
} from "@get-bb/plugin-sdk/provider-bridge";

/**
 * One `pi --mode rpc` child: JSON lines in on stdin (commands), JSON lines
 * out on stdout (responses, raw AgentSessionEvents, extension UI requests),
 * stderr captured
 * for the construction error, and the bb extension's private channel on
 * fd 3 (child → bridge) / fd 4 (bridge → child).
 *
 * LF-only framing, like pi's own `jsonl` reader: a line is one message,
 * read by the bridge kit's bounded line reader. Never `readline`: it also
 * splits on U+2028/U+2029, which pi emits raw inside JSON strings (tool
 * results, file contents), and a fragmented event line is dropped on both
 * halves.
 */

export const PI_BRIDGE_COMMAND_ENV = "BB_PI_BRIDGE_COMMAND";
export const PI_BRIDGE_ARGS_ENV = "BB_PI_BRIDGE_ARGS";

/**
 * How the extension channel appears in a bridge recording. The recorder
 * tees a child's stdin and stdout; the channel (fd 3 / fd 4) is a third
 * pair, so each channel message is recorded on the same two provider lanes
 * wrapped as `{ "bbChannel": <message> }`, which no pi RPC line ever is.
 * The parity replay child (`pi-rpc` dialect) unwraps them onto fd 3 and
 * wraps what it reads on fd 4.
 */
export const PI_CHANNEL_RECORDING_KEY = "bbChannel";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** `request(..., NO_REQUEST_TIMEOUT)`: the caller owns the wait. */
export const NO_REQUEST_TIMEOUT = 0;
const STDERR_TAIL_BYTES = 4_096;
const SIGTERM_GRACE_MS = 4_000;
const SIGKILL_ESCALATION_MS = 4_000;

export interface PiRpcChildExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  /** True when no response ever arrived: the child failed to start. */
  beforeFirstResponse: boolean;
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
  /** The bb thread this child serves, for record mode. */
  recordThreadId: string | null;
}

export class PiRpcChildExitedError extends Error {
  readonly info: PiRpcChildExitInfo;

  constructor(info: PiRpcChildExitInfo) {
    super(
      `pi exited (code ${info.code ?? "null"}, signal ${info.signal ?? "null"})${
        info.stderrTail ? `: ${info.stderrTail.trim()}` : ""
      }`,
    );
    this.name = "PiRpcChildExitedError";
    this.info = info;
  }
}

interface PendingRequest {
  resolve: (response: PiRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** The pi launch: the test seam first, `pi` on PATH otherwise. */
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

/** The environment a pi child runs in: the host's, minus bb's own wiring. */
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
  private sawResponse = false;
  private exitInfo: PiRpcChildExitInfo | null = null;
  private readonly channelWriter: Writable | null;
  private readonly channelRecorder: ChannelRecorder | null;
  private killEscalation: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly args: SpawnPiRpcChildArgs) {
    const launch = resolvePiLaunch(process.env);
    this.child = spawn(launch.command, [...launch.args, ...args.args], {
      cwd: args.cwd,
      env: args.env,
      // fd 3: child → bridge, fd 4: bridge → child.
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    experimental_recordProviderChildIo(this.child, {
      threadId: args.recordThreadId,
    });
    this.channelRecorder = createChannelRecorder(args.recordThreadId);
    const stdout = this.child.stdout;
    const stderr = this.child.stderr;
    const channelIn = this.child.stdio[3] as Readable | null | undefined;
    this.channelWriter = (this.child.stdio[4] as Writable | null) ?? null;
    // A write to a child that just died is EPIPE on the writer, never an
    // uncaught exception that takes the whole bridge (every pi thread) down.
    this.child.stdin?.on("error", () => undefined);
    this.channelWriter?.on("error", () => undefined);
    if (stdout) {
      experimental_readBoundedLines({
        input: stdout,
        onLine: (line) => this.handleStdoutLine(line),
        onOverflow: (bytes) => {
          process.stderr.write(`pi bridge: dropped a ${bytes}-byte stdout line\n`);
        },
      });
    }
    if (stderr) {
      stderr.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES);
        // Pi's diagnostics (model resolution, extension load errors) are
        // the bridge's diagnostics too; the runtime logs bridge stderr.
        process.stderr.write(`pi[${String(this.child.pid ?? "?")}]: ${text}`);
      });
    }
    if (channelIn) {
      experimental_readBoundedLines({
        input: channelIn,
        onLine: (line) => this.handleChannelLine(line),
        onOverflow: (bytes) => {
          process.stderr.write(`pi bridge: dropped a ${bytes}-byte channel line\n`);
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
      const info: PiRpcChildExitInfo = {
        code,
        signal,
        stderrTail: this.stderrTail,
        beforeFirstResponse: !this.sawResponse,
      };
      this.exitInfo = info;
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
    // A spawn failure (ENOENT, EACCES) emits `error` and `close` but never
    // `exit`: settle on close so a missing executable is an immediate exit
    // with the spawn error, not a readiness timeout.
    this.child.on("close", (code, signal) => settleExit(code, signal));
  }

  get exited(): boolean {
    return this.exitInfo !== null;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Send one RPC command and wait for its response (success or error). */
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
              reject(new Error(`pi did not answer ${String(command.type)} in time`));
            }, timeoutMs);
      timer?.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.writeStdin(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  /** Like `request`, but a `success: false` response rejects. */
  async requestOk(
    command: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    const response = await this.request(command, timeoutMs);
    if (!response.success) {
      throw new Error(
        response.error ?? `pi rejected ${String(command.type)}`,
      );
    }
    return response.data;
  }

  /** Write one message to the extension's channel (fd 4). */
  sendChannel(message: Record<string, unknown>): void {
    const writer = this.channelWriter;
    if (!writer || writer.destroyed || writer.writableEnded) {
      return;
    }
    this.channelRecorder?.toChild(message);
    writer.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * Close stdin and the channel writer (pi exits on stdin EOF; the
   * extension's fd-4 reader needs its EOF too, or pi's exit would wait on
   * it), then SIGTERM after the grace period, SIGKILL after another.
   */
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

  /** SIGTERM now, SIGKILL if the child is still there after the grace. */
  kill(): void {
    if (this.exitInfo !== null) {
      return;
    }
    this.endWriters();
    if (this.killEscalation === null) {
      this.killEscalation = setTimeout(() => {
        this.killEscalation = null;
        if (this.exitInfo === null) {
          this.child.kill("SIGKILL");
        }
      }, SIGKILL_ESCALATION_MS);
      this.killEscalation.unref?.();
    }
    this.child.kill("SIGTERM");
  }

  private endWriters(): void {
    try {
      this.child.stdin?.end();
    } catch {
      // Already closed.
    }
    try {
      this.channelWriter?.end();
    } catch {
      // Already closed.
    }
  }

  private writeStdin(line: string): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) {
      return;
    }
    stdin.write(line);
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
      // Pi writes only JSON lines on stdout in RPC mode; anything else is a
      // stray log line.
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const message = parsed as Record<string, unknown>;
    if (message.type === "response") {
      this.sawResponse = true;
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
      // Headless: every dialog another extension raises is cancelled, the
      // way the in-process bridge's rpc mode binding answered them.
      this.writeStdin(
        `${JSON.stringify({
          type: "extension_ui_response",
          id: message.id,
          cancelled: true,
        })}\n`,
      );
      return;
    }
    if (typeof message.type === "string") {
      // Pi writes each AgentSessionEvent as its own JSON line, unwrapped:
      // everything that is not a response or a UI request is the stream.
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
    } catch {
      // A malformed channel line is the extension's bug; ignore it.
    }
  }
}

interface ChannelRecorder {
  fromChild(message: unknown): void;
  toChild(message: unknown): void;
}

/**
 * Tee the channel into the recording through the same recorder entry the
 * child's stdio uses, on a synthetic stream pair: lines pushed into
 * `stdout` are the child's, lines written to `stdin` are the bridge's.
 * Null when the process does not record, so nothing buffers.
 */
function createChannelRecorder(threadId: string | null): ChannelRecorder | null {
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
