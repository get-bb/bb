import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { verifyDeviceClaim, type DeviceClaim } from "../registry/claims.js";
import type { DebugGdbSession, HardwareIoThrottle } from "../gdb/session.js";
import { DebugBenchConfigurationError, resolveExecutable } from "../gdb/server.js";
import {
  finishProbeRun,
  PROBE_CHANGED_CHANNEL,
  startProbeRun,
  type ProbeChangedHint,
  type ProbeOutcome,
  type ProbeRunRecord,
  type ProbeRunScope,
} from "./runs.js";
import {
  openProbeStore,
  writeBenchArtifact,
  type ProbeStore,
} from "./store.js";

export { PROBE_CHANGED_CHANNEL } from "./runs.js";

export interface ProbeRunRequest {
  scriptPath: string;
  deviceIds: string[];
  hypothesis: string;
  timeoutMs: number;
}

type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ProbeRuntimeDeps extends ProbeRunScope {
  db: Database.Database;
  worktreeRoot: string;
  pythonExecutablePath: string;
  store?: ProbeStore;
  releaseClaim(deviceId: string, holder: string): void | Promise<void>;
  openSession(deviceId: string, claim: DeviceClaim, signal: AbortSignal): Promise<DebugGdbSession>;
  spawnProcess?: SpawnProcess;
  throttle?: HardwareIoThrottle;
  now?: () => Date;
  createRunId?: () => string;
  writeArtifact?: typeof writeBenchArtifact;
  publishChanged?: (channel: typeof PROBE_CHANGED_CHANNEL, payload: ProbeChangedHint) => void;
  maxProtocolBytes?: number;
  maxStderrBytes?: number;
}

export class ProbeRuntimeError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "ProbeRuntimeError";
  }
}

const PYTHON_BRIDGE = String.raw`
import base64, json, runpy, sys, types, traceback
_next_id = 1
_outcome = "inconclusive"
def _request(kind, **payload):
    global _next_id
    request_id = _next_id
    _next_id += 1
    message = {"type": kind, "id": request_id, **payload}
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    response_line = sys.stdin.readline()
    if not response_line:
        raise RuntimeError("probe bridge closed")
    response = json.loads(response_line)
    if response.get("id") != request_id:
        raise RuntimeError("probe bridge response mismatch")
    if not response.get("ok"):
        raise RuntimeError(response.get("error", "probe bridge request failed"))
    return response.get("result")
class _Device:
    def __init__(self, device_id): self.device_id = device_id
    def gdb(self, command, *args):
        return _request("gdb", deviceId=self.device_id, command=command, args=list(args))
def device(device_id): return _Device(device_id)
def artifact(path, data):
    if isinstance(data, str): data = data.encode("utf-8")
    return _request("artifact", path=path, data=base64.b64encode(bytes(data)).decode("ascii"))
def outcome(value):
    global _outcome
    if value not in ("confirmed", "refuted", "inconclusive"):
        raise ValueError("invalid probe outcome")
    _outcome = value
module = types.ModuleType("fs_probe")
module.device = device
module.artifact = artifact
module.outcome = outcome
sys.modules["fs_probe"] = module
try:
    runpy.run_path(sys.argv[1], run_name="__main__", init_globals={"device": device, "artifact": artifact, "outcome": outcome})
    sys.stdout.write(json.dumps({"type":"result", "outcome":_outcome}, separators=(",", ":")) + "\n")
except BaseException as error:
    sys.stdout.write(json.dumps({"type":"error", "message":str(error), "traceback":traceback.format_exc(limit=20)}, separators=(",", ":")) + "\n")
finally:
    sys.stdout.flush()
`;

function boundedText(name: string, value: string, maximum = 4096): string {
  const text = value.trim();
  if (text.length === 0 || text.length > maximum || text.includes("\0")) {
    throw new ProbeRuntimeError("INVALID_PROBE_REQUEST", `${name} must be non-empty and bounded.`);
  }
  return text;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function appendRuntimeFailure(current: unknown, label: string, error: unknown): Error {
  const detail = `${label}: ${describeFailure(error)}`;
  if (current === null) {
    return new ProbeRuntimeError("PROBE_TEARDOWN_FAILED", detail, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  return new ProbeRuntimeError(
    "PROBE_TEARDOWN_FAILED",
    `${describeFailure(current)}\n${detail}`,
    { cause: error instanceof Error ? error : undefined },
  );
}

function validateRequest(request: ProbeRunRequest): ProbeRunRequest {
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 30 * 60_000) {
    throw new ProbeRuntimeError("INVALID_PROBE_REQUEST", "timeoutMs must be between 1 and 1800000.");
  }
  if (request.deviceIds.length < 1 || request.deviceIds.length > 16 ||
    new Set(request.deviceIds).size !== request.deviceIds.length) {
    throw new ProbeRuntimeError("INVALID_PROBE_REQUEST", "deviceIds must contain 1 through 16 unique devices.");
  }
  return {
    scriptPath: boundedText("scriptPath", request.scriptPath),
    deviceIds: request.deviceIds.map((id) => boundedText("deviceId", id, 512)),
    hypothesis: boundedText("hypothesis", request.hypothesis),
    timeoutMs: request.timeoutMs,
  };
}

function claimedDevices(request: ProbeRunRequest, claims: readonly DeviceClaim[]): Map<string, DeviceClaim> {
  const map = new Map<string, DeviceClaim>();
  for (const claim of claims) {
    if (!request.deviceIds.includes(claim.deviceId) || map.has(claim.deviceId)) {
      throw new ProbeRuntimeError("DEVICE_SCOPE_VIOLATION", "Claims must match the requested device set exactly.");
    }
    map.set(claim.deviceId, claim);
  }
  if (map.size !== request.deviceIds.length) {
    throw new ProbeRuntimeError("DEVICE_CLAIM_REQUIRED", "Every requested device requires a live caller-held claim.");
  }
  return map;
}

const NUMERIC_MI_ARGUMENT = /^(?:0[xX][0-9A-Fa-f]+|\d+)$/u;
const BREAKPOINT_LOCATION = /^[A-Za-z0-9_.$*:+/-]{1,1024}$/u;

function isAllowedProbeGdbCommand(command: string, args: readonly string[]): boolean {
  switch (command) {
    case "-break-delete":
      return args.length > 0 && args.every((argument) => /^\d{1,16}$/u.test(argument));
    case "-break-insert":
      return args.length === 1 && BREAKPOINT_LOCATION.test(args[0]!);
    case "-data-list-register-names":
      return args.every((argument) => /^\d{1,16}$/u.test(argument));
    case "-data-list-register-values":
      return args.length > 0 && /^[xotdrN]$/u.test(args[0]!) &&
        args.slice(1).every((argument) => /^\d{1,16}$/u.test(argument));
    case "-data-read-memory-bytes": {
      if (args.length !== 2 || !NUMERIC_MI_ARGUMENT.test(args[0]!) || !/^\d{1,5}$/u.test(args[1]!)) return false;
      const bytes = Number.parseInt(args[1]!, 10);
      return bytes > 0 && bytes <= 65_536;
    }
    case "-exec-continue":
    case "-exec-interrupt":
      return args.length === 0;
    case "-stack-list-frames":
      return (args.length === 0 || args.length === 2) &&
        args.every((argument) => /^\d{1,10}$/u.test(argument));
    case "-thread-info":
      return args.length === 0 || (args.length === 1 && /^\d{1,16}$/u.test(args[0]!));
    default:
      return false;
  }
}

export function isDestructiveGdbCommand(command: string, args: readonly string[] = []): boolean {
  return !isAllowedProbeGdbCommand(command, args);
}

function destroyProcessPipes(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* Process already exited. */ }
  }
}

async function terminate(child: ChildProcess, deadlineMs = 1_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    destroyProcessPipes(child);
    return;
  }
  let onExit: (() => void) | null = null;
  const exited = new Promise<true>((resolve) => {
    onExit = () => resolve(true);
    child.once("exit", onExit);
  });
  signalProcessGroup(child, "SIGTERM");
  let deadline: NodeJS.Timeout | null = null;
  const ended = await Promise.race([
    exited,
    new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), deadlineMs); }),
  ]);
  if (deadline !== null) clearTimeout(deadline);
  if (!ended) signalProcessGroup(child, "SIGKILL");
  if (onExit) child.removeListener("exit", onExit);
  destroyProcessPipes(child);
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

interface BridgeMessage {
  type: "gdb" | "artifact" | "result" | "error";
  id: number | null;
  deviceId: string | null;
  command: string | null;
  args: string[];
  path: string | null;
  data: string | null;
  outcome: ProbeOutcome | null;
  message: string | null;
  traceback: string | null;
}

function parseBridgeMessage(line: string): BridgeMessage {
  let value: unknown;
  try { value = JSON.parse(line); } catch {
    throw new ProbeRuntimeError("PROBE_PROTOCOL_INVALID", "Probe stdout contained a non-protocol line.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProbeRuntimeError("PROBE_PROTOCOL_INVALID", "Probe protocol message must be an object.");
  }
  const type = Reflect.get(value, "type");
  if (type !== "gdb" && type !== "artifact" && type !== "result" && type !== "error") {
    throw new ProbeRuntimeError("PROBE_PROTOCOL_INVALID", "Probe protocol message has an unknown type.");
  }
  const idValue = Reflect.get(value, "id");
  const argsValue = Reflect.get(value, "args");
  const outcomeValue = Reflect.get(value, "outcome");
  return {
    type,
    id: typeof idValue === "number" && Number.isSafeInteger(idValue) ? idValue : null,
    deviceId: typeof Reflect.get(value, "deviceId") === "string" ? Reflect.get(value, "deviceId") : null,
    command: typeof Reflect.get(value, "command") === "string" ? Reflect.get(value, "command") : null,
    args: Array.isArray(argsValue) && argsValue.every((item) => typeof item === "string") ? argsValue : [],
    path: typeof Reflect.get(value, "path") === "string" ? Reflect.get(value, "path") : null,
    data: typeof Reflect.get(value, "data") === "string" ? Reflect.get(value, "data") : null,
    outcome: outcomeValue === "confirmed" || outcomeValue === "refuted" || outcomeValue === "inconclusive" ? outcomeValue : null,
    message: typeof Reflect.get(value, "message") === "string" ? Reflect.get(value, "message") : null,
    traceback: typeof Reflect.get(value, "traceback") === "string" ? Reflect.get(value, "traceback") : null,
  };
}

function sendResponse(child: ChildProcess, id: number, response: { ok: true; result: unknown } | { ok: false; error: string }): void {
  child.stdin?.write(`${JSON.stringify({ id, ...response })}\n`, "utf8");
}

async function protocolLoop(
  child: ChildProcess,
  sessions: ReadonlyMap<string, DebugGdbSession>,
  deps: ProbeRuntimeDeps,
  runId: string,
  artifacts: string[],
  signal: AbortSignal,
): Promise<{ outcome: ProbeOutcome; error: string | null }> {
  if (!child.stdout) throw new ProbeRuntimeError("PROBE_PROCESS_FAILED", "Python stdout pipe is unavailable.");
  let buffer = "";
  let received = 0;
  for await (const chunk of child.stdout) {
    signal.throwIfAborted();
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.byteLength;
    if (received > (deps.maxProtocolBytes ?? 4 * 1024 * 1024)) {
      throw new ProbeRuntimeError("PROBE_OUTPUT_BOUND", "Probe protocol output exceeded its byte limit.");
    }
    buffer += bytes.toString("utf8");
    while (buffer.includes("\n")) {
      const separator = buffer.indexOf("\n");
      const line = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 1);
      if (!line) continue;
      const message = parseBridgeMessage(line);
      if (message.type === "result") {
        if (!message.outcome) throw new ProbeRuntimeError("PROBE_PROTOCOL_INVALID", "Probe result omitted its outcome.");
        return { outcome: message.outcome, error: null };
      }
      if (message.type === "error") {
        return {
          outcome: "inconclusive",
          error: [message.message ?? "Probe script failed", message.traceback].filter(Boolean).join("\n"),
        };
      }
      if (message.id === null) throw new ProbeRuntimeError("PROBE_PROTOCOL_INVALID", "Probe request omitted its id.");
      if (message.type === "gdb") {
        const session = message.deviceId ? sessions.get(message.deviceId) : undefined;
        if (!session || !message.command) {
          sendResponse(child, message.id, { ok: false, error: "DEVICE_SCOPE_VIOLATION: device is not bound to this run" });
          continue;
        }
        if (isDestructiveGdbCommand(message.command, message.args)) {
          sendResponse(child, message.id, {
            ok: false,
            error: "DESTRUCTIVE_REQUIRES_GRANT: destructive debug operations require the WP-90 debug-mode grant path",
          });
          continue;
        }
        try {
          await deps.throttle?.acquire(signal);
          const result = await session.executeCommand(message.command, message.args);
          sendResponse(child, message.id, { ok: true, result });
        } catch (error) {
          sendResponse(child, message.id, { ok: false, error: error instanceof Error ? error.message : "GDB command failed" });
        }
        continue;
      }
      if (!message.path || !message.data) {
        sendResponse(child, message.id, { ok: false, error: "INVALID_ARTIFACT: path and base64 data are required" });
        continue;
      }
      try {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(message.data)) {
          throw new ProbeRuntimeError("INVALID_ARTIFACT", "Artifact data must be canonical base64.");
        }
        const bytes = Buffer.from(message.data, "base64");
        if (bytes.byteLength > 2 * 1024 * 1024) throw new ProbeRuntimeError("ARTIFACT_BOUND", "One artifact may not exceed 2 MiB.");
        const path = await (deps.writeArtifact ?? writeBenchArtifact)(deps.worktreeRoot, runId, message.path, bytes);
        artifacts.push(path);
        sendResponse(child, message.id, { ok: true, result: path });
      } catch (error) {
        sendResponse(child, message.id, { ok: false, error: error instanceof Error ? error.message : "Artifact write failed" });
      }
    }
  }
  throw new ProbeRuntimeError("PROBE_PROTOCOL_TRUNCATED", "Probe process ended without a result record.");
}

export async function runProbe(
  deps: ProbeRuntimeDeps,
  rawRequest: ProbeRunRequest,
  claims: DeviceClaim[],
  signal: AbortSignal,
): Promise<ProbeRunRecord> {
  signal.throwIfAborted();
  const request = validateRequest(rawRequest);
  const claimMap = claimedDevices(request, claims);
  const store = deps.store ?? await openProbeStore(deps.worktreeRoot);
  const script = await store.read(request.scriptPath);
  const now = deps.now ?? (() => new Date());
  const runId = (deps.createRunId ?? (() => `probe-${randomUUID()}`))();
  const startedAt = now().toISOString();
  startProbeRun(deps.db, { ...deps, runId, scriptPath: script.path, deviceIds: request.deviceIds, hypothesis: request.hypothesis, startedAt });
  const changedHint = { projectId: deps.projectId, projectVersionId: deps.projectVersionId, runId };
  deps.publishChanged?.(PROBE_CHANGED_CHANNEL, changedHint);
  const artifacts: string[] = [];
  const sessions = new Map<string, DebugGdbSession>();
  const delegatedClaims = new Set<string>();
  let child: ChildProcess | null = null;
  let terminationPromise: Promise<void> | null = null;
  const stderr = new BoundedText(deps.maxStderrBytes ?? 64 * 1024);
  let outcome: ProbeOutcome = "inconclusive";
  let runtimeError: unknown = null;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new ProbeRuntimeError("PROBE_TIMEOUT", `Probe exceeded ${request.timeoutMs}ms.`)),
    request.timeoutMs,
  );
  try {
    const python = await resolveExecutable(
      deps.pythonExecutablePath,
      "python3",
      "Install Python 3 and configure its absolute executable path; probe helpers are not auto-installed.",
    );
    for (const deviceId of request.deviceIds) {
      const claim = claimMap.get(deviceId)!;
      verifyDeviceClaim(deps.db, claim, deviceId);
      controller.signal.throwIfAborted();
      let session: DebugGdbSession;
      try {
        session = await deps.openSession(deviceId, claim, controller.signal);
        delegatedClaims.add(deviceId);
      } catch (error) {
        try {
          await deps.releaseClaim(deviceId, claim.holder);
          delegatedClaims.add(deviceId);
        } catch { /* The finalizer retries release if this attempt fails. */ }
        throw error;
      }
      sessions.set(deviceId, session);
    }
    child = (deps.spawnProcess ?? spawn)(python, ["-u", "-c", PYTHON_BRIDGE, script.absolutePath], {
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
    const stopChild = (deadlineMs: number) => {
      if (!child) return Promise.resolve();
      terminationPromise ??= terminate(child, deadlineMs);
      return terminationPromise;
    };
    const abortChild = () => { void stopChild(0); };
    controller.signal.addEventListener("abort", abortChild, { once: true });
    const result = await protocolLoop(child, sessions, deps, runId, artifacts, controller.signal);
    controller.signal.removeEventListener("abort", abortChild);
    outcome = result.outcome;
    runtimeError = result.error;
  } catch (error) {
    runtimeError = controller.signal.aborted ? controller.signal.reason ?? error : error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    if (child) {
      terminationPromise ??= terminate(child, controller.signal.aborted ? 0 : 1_000);
      await terminationPromise;
    }
    for (const [deviceId, session] of [...sessions.entries()].reverse()) {
      try {
        await session.dispose();
      } catch (error) {
        runtimeError = appendRuntimeFailure(runtimeError, `GDB session ${deviceId} teardown failed`, error);
        const claim = claimMap.get(deviceId)!;
        try {
          await deps.releaseClaim(deviceId, claim.holder);
        } catch (releaseError) {
          runtimeError = appendRuntimeFailure(
            runtimeError,
            `Fallback release for ${deviceId} failed`,
            releaseError,
          );
        }
      }
    }
    for (const [deviceId, claim] of claimMap) {
      if (delegatedClaims.has(deviceId)) continue;
      try {
        await deps.releaseClaim(deviceId, claim.holder);
      } catch (error) {
        runtimeError = appendRuntimeFailure(runtimeError, `Claim release for ${deviceId} failed`, error);
      }
    }
  }
  if (runtimeError !== null) {
    const primary = runtimeError instanceof Error
      ? `${runtimeError.name}: ${runtimeError.message}\n`
      : typeof runtimeError === "string"
        ? `${runtimeError}\n`
        : "Probe failed with an unknown error.\n";
    const diagnosticStderr = stderr.text().trim();
    const text = diagnosticStderr.length > 0
      ? `${primary}probe stderr:\n${diagnosticStderr}\n`
      : primary;
    try {
      artifacts.push(await (deps.writeArtifact ?? writeBenchArtifact)(
        deps.worktreeRoot,
        runId,
        "runtime-error.txt",
        Buffer.from(text, "utf8"),
      ));
    } catch { /* The durable run still records inconclusive even if artifact storage is unavailable. */ }
    outcome = "inconclusive";
  }
  const record = finishProbeRun(deps.db, deps, runId, outcome, artifacts, now().toISOString());
  deps.publishChanged?.(PROBE_CHANGED_CHANNEL, changedHint);
  if (runtimeError instanceof DebugBenchConfigurationError) throw runtimeError;
  return record;
}

export const runProbeScript = runProbe;
