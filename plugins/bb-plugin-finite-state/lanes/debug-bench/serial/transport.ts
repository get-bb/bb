import { spawn, type ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";

export interface SerialPortRef {
  /** Stable registry identity. Public callers never supply a host path. */
  deviceId: string;
  /** Resolved from the claimed WP-88 registry record. */
  portPath: string;
}

export interface SerialTransport {
  open(port: SerialPortRef, options: { baud: number }): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  onData(handler: (chunk: Uint8Array) => void): void;
  onClosed(handler: (reason: string) => void): void;
}

export type SerialTransportErrorCode =
  | "SERIAL_HELPER_UNCONFIGURED"
  | "SERIAL_HELPER_PROTOCOL"
  | "SERIAL_HELPER_TIMEOUT"
  | "SERIAL_TRANSPORT_CLOSED";

export class SerialTransportError extends Error {
  constructor(
    readonly code: SerialTransportErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "SerialTransportError";
  }
}

export interface SerialHelperStatus {
  configured: boolean;
  message: string | null;
}

export interface HelperSerialTransportOptions {
  pythonCommand?: string;
  helperSource?: string;
  openTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxFrameBytes?: number;
  maxStderrBytes?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_OPEN_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;

export const SERIAL_HELPER_SOURCE = String.raw`
import base64, json, os, sys, threading

write_lock = threading.Lock()
serial_port = None
stopping = threading.Event()

def emit(value):
    with write_lock:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()

try:
    import serial
except Exception as exc:
    emit({"event":"error","code":"unconfigured","message":str(exc)})
    raise SystemExit(78)

def read_serial():
    global serial_port
    try:
        while not stopping.is_set() and serial_port is not None:
            data = serial_port.read(4096)
            if data:
                emit({"event":"data","data":base64.b64encode(data).decode("ascii")})
    except Exception as exc:
        if not stopping.is_set():
            emit({"event":"closed","reason":str(exc)})
            stopping.set()
            try:
                serial_port.close()
            except Exception:
                pass
            serial_port = None
            os._exit(1)

for raw in sys.stdin:
    try:
        command = json.loads(raw)
        operation = command.get("op")
        if operation == "open":
            if serial_port is not None:
                raise RuntimeError("serial port is already open")
            serial_port = serial.Serial(
                port=command["port"],
                baudrate=int(command["baud"]),
                timeout=0.1,
                write_timeout=1.0,
            )
            threading.Thread(target=read_serial, daemon=True).start()
            emit({"event":"opened"})
        elif operation == "write":
            if serial_port is None:
                raise RuntimeError("serial port is not open")
            serial_port.write(base64.b64decode(command["data"], validate=True))
            serial_port.flush()
        elif operation == "close":
            stopping.set()
            if serial_port is not None:
                serial_port.close()
                serial_port = None
            emit({"event":"closed","reason":"closed"})
            break
        else:
            raise RuntimeError("unknown helper operation")
    except Exception as exc:
        emit({"event":"error","code":"transport","message":str(exc)})
        if operation == "open":
            raise SystemExit(1)

stopping.set()
if serial_port is not None:
    serial_port.close()
`;

type HelperEvent =
  | { event: "opened" }
  | { event: "data"; data: string }
  | { event: "closed"; reason: string }
  | { event: "error"; code: string; message: string };

function parseHelperEvent(frame: string): HelperEvent {
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    throw new SerialTransportError("SERIAL_HELPER_PROTOCOL", "helper emitted invalid JSON");
  }
  if (value === null || typeof value !== "object") {
    throw new SerialTransportError("SERIAL_HELPER_PROTOCOL", "helper event must be an object");
  }
  const event = Reflect.get(value, "event");
  if (event === "opened") return { event };
  if (event === "data" && typeof Reflect.get(value, "data") === "string") {
    return { event, data: Reflect.get(value, "data") as string };
  }
  if (event === "closed" && typeof Reflect.get(value, "reason") === "string") {
    return { event, reason: Reflect.get(value, "reason") as string };
  }
  if (
    event === "error" &&
    typeof Reflect.get(value, "code") === "string" &&
    typeof Reflect.get(value, "message") === "string"
  ) {
    return {
      event,
      code: Reflect.get(value, "code") as string,
      message: Reflect.get(value, "message") as string,
    };
  }
  throw new SerialTransportError("SERIAL_HELPER_PROTOCOL", "helper emitted an unknown event");
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || child.killed) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The helper already exited.
    }
  }
}

function writeFrame(child: ChildProcess, frame: object): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.stdin || child.stdin.destroyed) {
      reject(new SerialTransportError("SERIAL_TRANSPORT_CLOSED", "helper stdin is closed"));
      return;
    }
    child.stdin.write(`${JSON.stringify(frame)}\n`, "utf8", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class HelperSerialTransport implements SerialTransport {
  private readonly options: Required<Pick<
    HelperSerialTransportOptions,
    "pythonCommand" | "helperSource" | "openTimeoutMs" | "closeTimeoutMs" |
      "maxFrameBytes" | "maxStderrBytes"
  >> & Pick<HelperSerialTransportOptions, "env">;
  private child: ChildProcess | null = null;
  private dataHandler: (chunk: Uint8Array) => void = () => undefined;
  private closedHandler: (reason: string) => void = () => undefined;
  private closing = false;
  private closedSignaled = false;

  constructor(options: HelperSerialTransportOptions = {}) {
    this.options = {
      pythonCommand: options.pythonCommand ?? "python3",
      helperSource: options.helperSource ?? SERIAL_HELPER_SOURCE,
      openTimeoutMs: options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS,
      closeTimeoutMs: options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
      maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
      env: options.env,
    };
  }

  onData(handler: (chunk: Uint8Array) => void): void {
    this.dataHandler = handler;
  }

  onClosed(handler: (reason: string) => void): void {
    this.closedHandler = handler;
  }

  private signalClosed(reason: string): void {
    if (this.closedSignaled || this.closing) return;
    this.closedSignaled = true;
    this.closedHandler(reason.slice(0, 1000));
  }

  async open(port: SerialPortRef, options: { baud: number }): Promise<void> {
    if (this.child) {
      throw new SerialTransportError("SERIAL_HELPER_PROTOCOL", "transport is already open");
    }
    if (!port.deviceId || !port.portPath) {
      throw new SerialTransportError("SERIAL_HELPER_PROTOCOL", "registry port identity is incomplete");
    }
    if (!Number.isSafeInteger(options.baud) || options.baud < 1) {
      throw new RangeError("Serial baud must be a positive safe integer.");
    }
    this.closing = false;
    this.closedSignaled = false;
    const child = spawn(
      this.options.pythonCommand,
      ["-u", "-c", this.options.helperSource],
      {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        detached: process.platform !== "win32",
        env: this.options.env ?? process.env,
      },
    );
    this.child = child;
    let stdoutBuffer = Buffer.alloc(0);
    let stderrBytes = 0;
    let stderr = "";
    let settleOpen: ((error?: Error) => void) | null = null;
    const opened = new Promise<void>((resolve, reject) => {
      settleOpen = (error) => error ? reject(error) : resolve();
    });
    let openSettled = false;
    const settle = (error?: Error) => {
      if (openSettled) return;
      openSettled = true;
      settleOpen?.(error);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      if (stdoutBuffer.length > this.options.maxFrameBytes * 2) {
        const error = new SerialTransportError(
          "SERIAL_HELPER_PROTOCOL",
          "helper output buffer exceeded its bound",
        );
        settle(error);
        this.signalClosed(error.message);
        terminateProcessTree(child);
        return;
      }
      let newline = stdoutBuffer.indexOf(0x0a);
      while (newline >= 0) {
        const frame = stdoutBuffer.subarray(0, newline);
        stdoutBuffer = stdoutBuffer.subarray(newline + 1);
        if (frame.length > this.options.maxFrameBytes) {
          const error = new SerialTransportError(
            "SERIAL_HELPER_PROTOCOL",
            "helper frame exceeded its bound",
          );
          settle(error);
          this.signalClosed(error.message);
          terminateProcessTree(child);
          return;
        }
        try {
          const event = parseHelperEvent(frame.toString("utf8"));
          if (event.event === "opened") settle();
          else if (event.event === "data") {
            const data = Buffer.from(event.data, "base64");
            this.dataHandler(data);
          } else if (event.event === "closed") {
            settle(new SerialTransportError("SERIAL_TRANSPORT_CLOSED", event.reason));
            this.signalClosed(event.reason);
          } else {
            const code = event.code === "unconfigured"
              ? "SERIAL_HELPER_UNCONFIGURED"
              : "SERIAL_TRANSPORT_CLOSED";
            const error = new SerialTransportError(code, event.message.slice(0, 1000));
            settle(error);
            this.signalClosed(error.message);
          }
        } catch (error) {
          const parsed = error instanceof Error ? error : new Error("unknown helper protocol error");
          settle(parsed);
          this.signalClosed(parsed.message);
          terminateProcessTree(child);
          return;
        }
        newline = stdoutBuffer.indexOf(0x0a);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= this.options.maxStderrBytes) return;
      const remaining = this.options.maxStderrBytes - stderrBytes;
      const bounded = chunk.subarray(0, remaining);
      stderr += bounded.toString("utf8");
      stderrBytes += bounded.length;
    });
    child.once("error", (error) => {
      settle(new SerialTransportError("SERIAL_HELPER_UNCONFIGURED", error.message));
      this.signalClosed(error.message);
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      const reason = stderr.trim() || `helper exited (${signal ?? code ?? "unknown"})`;
      settle(new SerialTransportError("SERIAL_TRANSPORT_CLOSED", reason.slice(0, 1000)));
      this.signalClosed(reason);
    });
    const timer = setTimeout(() => {
      const error = new SerialTransportError(
        "SERIAL_HELPER_TIMEOUT",
        `helper did not open within ${this.options.openTimeoutMs}ms`,
      );
      settle(error);
      terminateProcessTree(child);
    }, this.options.openTimeoutMs);
    try {
      await writeFrame(child, { op: "open", port: port.portPath, baud: options.baud });
      await opened;
    } finally {
      clearTimeout(timer);
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const child = this.child;
    if (!child) {
      throw new SerialTransportError("SERIAL_TRANSPORT_CLOSED", "transport is not open");
    }
    await writeFrame(child, { op: "write", data: Buffer.from(data).toString("base64") });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    await writeFrame(child, { op: "close" }).catch(() => undefined);
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        terminateProcessTree(child);
        resolve();
      }, this.options.closeTimeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.child === child) this.child = null;
  }
}

export function createSerialTransport(
  options: HelperSerialTransportOptions = {},
): SerialTransport {
  return new HelperSerialTransport(options);
}

export async function detectSerialHelper(options: {
  pythonCommand?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<SerialHelperStatus> {
  const pythonCommand = options.pythonCommand ?? "python3";
  const timeoutMs = options.timeoutMs ?? 2_000;
  return new Promise((resolve) => {
    const child = spawn(pythonCommand, ["-c", "import serial"], {
      stdio: "ignore",
      shell: false,
      detached: process.platform !== "win32",
      env: options.env ?? process.env,
    });
    let settled = false;
    const finish = (status: SerialHelperStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish({ configured: false, message: `Serial helper probe timed out after ${timeoutMs}ms.` });
    }, timeoutMs);
    child.once("error", (error) => finish({ configured: false, message: error.message.slice(0, 1000) }));
    child.once("exit", (code) => finish({
      configured: code === 0,
      message: code === 0 ? null : "Python with pyserial is required for serial sessions.",
    }));
  });
}
