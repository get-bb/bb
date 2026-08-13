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

export type InstrumentErrorCode =
  | "CAPTURE_CONFIG_INVALID"
  | "CLAIM_VERIFIER_NOT_CONFIGURED"
  | "DEVICE_LOST"
  | "INSTRUMENT_NOT_FOUND"
  | "INSTRUMENT_NOT_CONFIGURED"
  | "INSTRUMENT_PROTOCOL_ERROR"
  | "SESSION_CLOSED";

/** Shared runtime error hierarchy for every instrument category. */
export class InstrumentError extends Error {
  constructor(
    readonly code: InstrumentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`, options);
    this.name = "InstrumentError";
  }
}

export interface CaptureArtifact {
  path: string;
  format: string;
  durationMs: number;
  channels: number;
}

export class DeviceLostError extends InstrumentError {
  constructor(
    message: string,
    readonly partialArtifact: CaptureArtifact | null,
    options?: ErrorOptions,
  ) {
    super("DEVICE_LOST", message, options);
    this.name = "DeviceLostError";
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
    let settled = false;
    let exitCode: number | null | undefined;
    let stdoutEnded = false;
    let stderrEnded = false;
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timeout: NodeJS.Timeout | null = null;
    let drainTimeout: NodeJS.Timeout | null = null;
    const closePipes = () => {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      if (drainTimeout !== null) clearTimeout(drainTimeout);
      signal.removeEventListener("abort", onAbort);
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      closePipes();
    };
    const rejectNow = (error: TransportError, terminate: boolean) => {
      if (settled) return;
      settled = true;
      if (terminate) {
        terminateProcessGroup(child);
        const escalation = setTimeout(() => terminateProcessGroup(child, true), 1_000);
        escalation.unref();
      }
      cleanup();
      rejectResult(error);
    };
    const resolveNow = () => {
      if (settled || exitCode === undefined) return;
      settled = true;
      cleanup();
      resolveResult({
        code: exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    };
    const finishAfterExit = () => {
      if (exitCode === undefined || settled) return;
      if (stdoutEnded && stderrEnded) resolveNow();
      else {
        drainTimeout ??= setTimeout(resolveNow, 100);
        drainTimeout.unref();
      }
    };
    const stop = (error: TransportError) => {
      if (settled) return;
      rejectNow(error, true);
    };
    const onAbort = () => stop(new TransportError(
      "PROCESS_ABORTED",
      "Instrument subprocess was aborted.",
      { cause: signal.reason },
    ));
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => stop(new TransportError(
      "PROCESS_TIMEOUT",
      `Instrument subprocess exceeded ${request.timeoutMs} ms.`,
    )), request.timeoutMs);
    timeout.unref();

    const append = (chunks: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      const remaining = Math.max(0, request.maxOutputBytes - outputBytes);
      if (chunk.length > remaining) {
        stop(new TransportError(
          "PROCESS_OUTPUT_LIMIT",
          `Instrument subprocess exceeded ${request.maxOutputBytes} output bytes.`,
        ));
        return;
      }
      if (remaining > 0) chunks.push(Buffer.from(chunk.subarray(0, remaining)));
      outputBytes += chunk.length;
    };
    stdoutEnded = child.stdout === null;
    stderrEnded = child.stderr === null;
    child.stdout?.on("data", (chunk: Buffer) => { append(stdoutChunks, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { append(stderrChunks, chunk); });
    child.stdout?.once("end", () => {
      stdoutEnded = true;
      finishAfterExit();
    });
    child.stderr?.once("end", () => {
      stderrEnded = true;
      finishAfterExit();
    });
    child.once("error", (error) => rejectNow(new TransportError(
      "PROCESS_START_FAILED",
      `Could not start ${request.command}.`,
      { cause: error },
    ), false));
    // `close` waits for inherited pipes. A detached grandchild can hold them
    // indefinitely, so lifecycle completion is keyed to the direct child's exit.
    child.once("exit", (code) => {
      exitCode = code;
      finishAfterExit();
    });
    // Close the small race between the caller's initial check and listener setup.
    if (signal.aborted) onAbort();
  });
}
