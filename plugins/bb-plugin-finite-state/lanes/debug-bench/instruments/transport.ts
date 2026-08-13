import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type InstrumentTransport =
  | { kind: "usb"; serial: string | null; path: string | null }
  | { kind: "lan"; host: string; port: number }
  | { kind: "bb-host"; hostId: string; remotePath: string };

export type TransportErrorCode =
  | "TRANSPORT_INVALID"
  | "TRANSPORT_NOT_IMPLEMENTED"
  | "PROCESS_ABORTED"
  | "PROCESS_OUTPUT_LIMIT"
  | "PROCESS_START_FAILED"
  | "PROCESS_TIMEOUT";

export class TransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`, options);
    this.name = "TransportError";
  }
}

export type ResolvedInstrumentTransport =
  | { kind: "usb"; serial: string | null; path: string | null }
  | { kind: "lan"; host: string; port: number };

export function resolveInstrumentTransport(
  transport: InstrumentTransport,
): ResolvedInstrumentTransport {
  if (transport.kind === "bb-host") {
    throw new TransportError(
      "TRANSPORT_NOT_IMPLEMENTED",
      `Remote instrument invocation on bb host ${transport.hostId} is represented but not implemented in v1.`,
    );
  }
  if (transport.kind === "usb") {
    const serial = transport.serial?.trim() || null;
    const path = transport.path?.trim() || null;
    if (serial === null && path === null) {
      throw new TransportError(
        "TRANSPORT_INVALID",
        "USB instrument transport requires a serial number or device path.",
      );
    }
    return { kind: "usb", serial, path };
  }
  const host = transport.host.trim();
  if (host.length === 0 || !Number.isInteger(transport.port) ||
      transport.port < 1 || transport.port > 65_535) {
    throw new TransportError(
      "TRANSPORT_INVALID",
      "LAN instrument transport requires a host and a port between 1 and 65535.",
    );
  }
  return { kind: "lan", host, port: transport.port };
}

export interface ProcessRequest {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  request: ProcessRequest,
  signal: AbortSignal,
) => Promise<ProcessResult>;

function terminateProcessGroup(child: ChildProcess, force = false): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* Process already exited. */ }
  }
}

export async function runInstrumentProcess(
  request: ProcessRequest,
  signal: AbortSignal,
): Promise<ProcessResult> {
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 ||
      !Number.isInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) {
    throw new TransportError(
      "TRANSPORT_INVALID",
      "Process timeout and output limit must be positive integers.",
    );
  }
  signal.throwIfAborted();
  return await new Promise<ProcessResult>((resolveResult, rejectResult) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let failure: TransportError | null = null;
    let spawnError: Error | null = null;
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forceKill = () => terminateProcessGroup(child, true);
    let escalation: NodeJS.Timeout | null = null;
    const stop = (error: TransportError) => {
      if (failure === null) failure = error;
      terminateProcessGroup(child);
      escalation ??= setTimeout(forceKill, 1_000);
      escalation.unref();
    };
    const onAbort = () => stop(new TransportError(
      "PROCESS_ABORTED",
      "Instrument subprocess was aborted.",
      { cause: signal.reason },
    ));
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => stop(new TransportError(
      "PROCESS_TIMEOUT",
      `Instrument subprocess exceeded ${request.timeoutMs} ms.`,
    )), request.timeoutMs);
    timeout.unref();

    const append = (chunks: Buffer[], chunk: Buffer): void => {
      const remaining = Math.max(0, request.maxOutputBytes - outputBytes);
      if (chunk.length > remaining) {
        stop(new TransportError(
          "PROCESS_OUTPUT_LIMIT",
          `Instrument subprocess exceeded ${request.maxOutputBytes} output bytes.`,
        ));
      }
      if (remaining > 0) chunks.push(Buffer.from(chunk.subarray(0, remaining)));
      outputBytes += chunk.length;
    };
    child.stdout?.on("data", (chunk: Buffer) => { append(stdoutChunks, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { append(stderrChunks, chunk); });
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (escalation !== null) clearTimeout(escalation);
      signal.removeEventListener("abort", onAbort);
      if (failure !== null) {
        rejectResult(failure);
        return;
      }
      if (spawnError !== null) {
        rejectResult(new TransportError(
          "PROCESS_START_FAILED",
          `Could not start ${request.command}.`,
          { cause: spawnError },
        ));
        return;
      }
      resolveResult({
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}
