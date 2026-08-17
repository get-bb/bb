import { createHash, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import type { HostPathWatchChange, HostWatcher } from "@bb/host-watcher";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import type { HostDaemonLogger } from "./logger.js";

type PluginHostCallCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "plugin.host.call" }
>;
type PluginHostCancelCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "plugin.host.cancel" }
>;
type PluginHostDisposeCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "plugin.host.dispose" }
>;
type PluginHostCallResult = HostDaemonOnlineRpcResult<"plugin.host.call">;

interface PendingCall {
  resolve: (result: PluginHostCallResult) => void;
  reject: (error: Error) => void;
  deadlineTimer: NodeJS.Timeout;
  forceTimer: NodeJS.Timeout | null;
  cancellationError: Error | null;
}

interface WorkerState {
  pluginId: string;
  generation: string;
  digest: string;
  child: ChildProcess;
  closed: Promise<void>;
  dataDir: string;
  tempDir: string;
  pending: Map<string, PendingCall>;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  disposing: boolean;
  activeCallCount: number;
  retainedLeaseIds: Set<string>;
  idleTimer: NodeJS.Timeout | null;
  watches: Map<string, WorkerWatchState>;
}

interface WorkerWatchState {
  watchId: string;
  worker: WorkerState;
  stop: () => void | Promise<void>;
  stopped: boolean;
  inFlightSequence: number | null;
  nextSequence: number;
  pendingChanges: Map<string, HostPathWatchChange["type"]>;
  pendingRescan: boolean;
  pendingError: string | null;
  debounceMs: number;
  maxWaitMs: number;
  debounceTimer: NodeJS.Timeout | null;
  maxWaitTimer: NodeJS.Timeout | null;
}

interface ActiveCallState {
  cancelled: boolean;
}

export interface PluginHostManagerOptions {
  dataDir: string;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
  fetchArtifact: (args: {
    pluginId: string;
    digest: string;
    expectedByteLength: number;
  }) => Promise<Uint8Array>;
  onWorkerExit?: (args: { pluginId: string; generation: string }) => void;
  onSignal?: (args: {
    pluginId: string;
    generation: string;
    signal: string;
    payload: JsonValue;
  }) => void;
  workerEntryPath?: string;
  /** User shell additions used for executable discovery by host plugins. */
  shellEnv?: () => NodeJS.ProcessEnv;
  /** Native path observation shared by core and host plugins. */
  hostWatcher?: Pick<HostWatcher, "watchPathRoot">;
  /** Test override for the daemon-owned worker idle timeout. */
  workerIdleTimeoutMs?: number;
}

const START_TIMEOUT_MS = 10_000;
const CANCEL_GRACE_MS = 5_000;
const HOST_WORKER_PROTOCOL_VERSION = 2;
const DEFAULT_WORKER_IDLE_TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING_CALLS_PER_WORKER = 256;
const MAX_WATCHES_PER_WORKER = 256;
const MAX_WATCH_CHANGED_PATHS = 4_096;
const MAX_WATCH_BATCH_BYTES = 1024 * 1024;
const MAX_WATCH_IGNORE_ENTRIES = 4_096;
const MAX_WATCH_PATH_BYTES = 16 * 1024;
const MIN_WATCH_DEBOUNCE_MS = 10;
const MAX_WATCH_DEBOUNCE_MS = 5_000;
const MAX_WATCH_WAIT_MS = 30_000;
const HOST_DIAGNOSTIC_LINE_MAX_BYTES = 16 * 1024;
const HOST_DIAGNOSTIC_MAX_LINES = 1_000;

function safePluginSegment(pluginId: string): string {
  return encodeURIComponent(pluginId);
}

function defaultWorkerEntryPath(): string {
  const compiled = fileURLToPath(
    new URL("./plugin-host-worker.js", import.meta.url),
  );
  if (existsSync(compiled)) return compiled;
  return fileURLToPath(new URL("./plugin-host-worker.ts", import.meta.url));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observeBoundedStderr(
  source: Readable,
  onLine: (line: string) => void,
): void {
  let tail = Buffer.alloc(0);
  let emittedLines = 0;
  let truncated = false;
  const append = (chunk: Buffer): void => {
    if (chunk.length >= HOST_DIAGNOSTIC_LINE_MAX_BYTES) {
      tail = Buffer.from(
        chunk.subarray(chunk.length - HOST_DIAGNOSTIC_LINE_MAX_BYTES),
      );
      return;
    }
    const retained = Math.min(
      tail.length,
      HOST_DIAGNOSTIC_LINE_MAX_BYTES - chunk.length,
    );
    tail = Buffer.concat([tail.subarray(tail.length - retained), chunk]);
  };
  const emit = (): void => {
    if (truncated || tail.length === 0) return;
    if (emittedLines >= HOST_DIAGNOSTIC_MAX_LINES) {
      truncated = true;
      onLine("[host plugin stderr truncated]");
      tail = Buffer.alloc(0);
      return;
    }
    emittedLines += 1;
    onLine(tail.toString("utf8").replace(/\r$/u, ""));
    tail = Buffer.alloc(0);
  };
  source.on("data", (chunk: Buffer) => {
    if (truncated) return;
    let remaining = chunk;
    while (remaining.length > 0 && !truncated) {
      const newline = remaining.indexOf(0x0a);
      if (newline === -1) {
        append(remaining);
        return;
      }
      append(remaining.subarray(0, newline));
      emit();
      remaining = remaining.subarray(newline + 1);
    }
  });
  source.on("end", emit);
}

/** Keep an expected teardown race from becoming an unhandled IPC error. */
function sendToWorker(child: ChildProcess, message: object): boolean {
  if (!child.connected) return false;
  try {
    child.send(message, () => {});
    return true;
  } catch {
    return false;
  }
}

/** Remove daemon-only BB variables while retaining the user's executable PATH. */
export function pluginHostProcessEnv(
  inherited: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (key.startsWith("BB_")) delete env[key];
  }
  if (shellEnv.PATH !== undefined) env.PATH = shellEnv.PATH;
  return env;
}

export class PluginHostManager {
  private readonly workers = new Map<string, WorkerState>();
  private readonly activeCalls = new Map<string, ActiveCallState>();
  private readonly retiredGenerations = new Map<string, Set<string>>();
  private readonly workerMutationTails = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(private readonly options: PluginHostManagerOptions) {}

  async call(command: PluginHostCallCommand): Promise<PluginHostCallResult> {
    if (this.shuttingDown) {
      throw new Error("host plugin manager is shutting down");
    }
    if (Date.now() >= command.deadlineUnixMs) {
      throw new Error(
        `host plugin call ${command.callId} reached its deadline before dispatch`,
      );
    }
    const callKey = this.callKey(command);
    if (this.activeCalls.has(callKey)) {
      throw new Error(`duplicate host plugin call ${command.callId}`);
    }
    const callState: ActiveCallState = { cancelled: false };
    this.activeCalls.set(callKey, callState);
    let activeWorker: WorkerState | undefined;
    try {
      const worker = await this.ensureWorker(command);
      activeWorker = worker;
      worker.activeCallCount += 1;
      await worker.ready;
      if (callState.cancelled) throw this.cancelledCallError(command.callId);
      if (Date.now() >= command.deadlineUnixMs) {
        throw new Error(
          `host plugin call ${command.callId} reached its deadline before dispatch`,
        );
      }
      if (worker.pending.has(command.callId)) {
        throw new Error(`duplicate host plugin call ${command.callId}`);
      }
      if (worker.pending.size >= MAX_PENDING_CALLS_PER_WORKER) {
        throw new Error(
          `host plugin ${command.pluginId} has too many pending calls`,
        );
      }
      return await new Promise<PluginHostCallResult>((resolve, reject) => {
        const deadlineTimer = setTimeout(
          () =>
            this.cancelPendingCall(
              worker,
              command.callId,
              new Error(
                `host plugin call ${command.callId} exceeded its deadline`,
              ),
            ),
          Math.max(1, command.deadlineUnixMs - Date.now()),
        );
        deadlineTimer.unref?.();
        worker.pending.set(command.callId, {
          resolve,
          reject,
          deadlineTimer,
          forceTimer: null,
          cancellationError: null,
        });
        if (
          !sendToWorker(worker.child, {
            type: "call",
            callId: command.callId,
            method: command.method,
            input: command.input,
          })
        ) {
          worker.pending.delete(command.callId);
          clearTimeout(deadlineTimer);
          reject(
            new Error(`host plugin ${command.pluginId} worker is unavailable`),
          );
        }
      });
    } finally {
      if (activeWorker !== undefined) {
        activeWorker.activeCallCount -= 1;
        this.scheduleWorkerIdle(activeWorker);
      }
      this.activeCalls.delete(callKey);
    }
  }

  cancel(command: PluginHostCancelCommand): { cancelled: boolean } {
    const callState = this.activeCalls.get(this.callKey(command));
    if (callState === undefined) return { cancelled: false };
    callState.cancelled = true;
    const worker = this.workers.get(command.pluginId);
    if (
      worker !== undefined &&
      worker.generation === command.generation &&
      worker.pending.has(command.callId)
    ) {
      this.cancelPendingCall(
        worker,
        command.callId,
        this.cancelledCallError(command.callId),
      );
    }
    return { cancelled: true };
  }

  async dispose(
    command: PluginHostDisposeCommand,
  ): Promise<{ disposed: boolean }> {
    return this.enqueueWorkerMutation(command.pluginId, async () => {
      this.retireGeneration(command.pluginId, command.generation);
      const worker = this.workers.get(command.pluginId);
      if (worker === undefined || worker.generation !== command.generation) {
        return { disposed: false };
      }
      await this.stopWorker(worker, "plugin disposed");
      return { disposed: true };
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.allSettled([...this.workerMutationTails.values()]);
    await Promise.all(
      [...this.workers.values()].map((worker) =>
        this.stopWorker(worker, "host daemon shutting down"),
      ),
    );
  }

  /** Retire workers missing from the server's authoritative reconnect snapshot. */
  async reconcileGenerations(
    activeGenerations: readonly {
      pluginId: string;
      generation: string;
    }[],
  ): Promise<void> {
    const activeByPlugin = new Map(
      activeGenerations.map((entry) => [entry.pluginId, entry.generation]),
    );
    await Promise.all(
      [...this.workers.keys()].map((pluginId) =>
        this.enqueueWorkerMutation(pluginId, async () => {
          const worker = this.workers.get(pluginId);
          if (
            worker === undefined ||
            activeByPlugin.get(pluginId) === worker.generation
          ) {
            return;
          }
          this.retireGeneration(pluginId, worker.generation);
          await this.stopWorker(
            worker,
            "host generation is no longer active after reconnect",
          );
        }),
      ),
    );
  }

  private ensureWorker(command: PluginHostCallCommand): Promise<WorkerState> {
    return this.enqueueWorkerMutation(command.pluginId, () =>
      this.ensureWorkerNow(command),
    );
  }

  private async ensureWorkerNow(
    command: PluginHostCallCommand,
  ): Promise<WorkerState> {
    if (
      this.retiredGenerations.get(command.pluginId)?.has(command.generation)
    ) {
      throw new Error(
        `host plugin ${command.pluginId} generation ${command.generation} is retired`,
      );
    }
    const current = this.workers.get(command.pluginId);
    if (
      current !== undefined &&
      current.generation === command.generation &&
      current.digest === command.artifact.digest &&
      !current.disposing
    ) {
      this.cancelWorkerIdleTimer(current);
      return current;
    }
    if (
      current !== undefined &&
      current.generation === command.generation &&
      current.digest !== command.artifact.digest
    ) {
      throw new Error(
        `host plugin ${command.pluginId} generation ${command.generation} changed artifact digest`,
      );
    }
    if (current !== undefined) {
      this.retireGeneration(command.pluginId, current.generation);
      await this.stopWorker(current, "host artifact generation replaced");
    }

    const artifactPath = await this.materializeArtifact(command);
    const pluginSegment = safePluginSegment(command.pluginId);
    const dataDir = join(
      this.options.dataDir,
      "plugins",
      pluginSegment,
      "host-data",
    );
    await mkdir(dataDir, { recursive: true });
    const tempDir = await mkdtemp(join(tmpdir(), `bb-host-${pluginSegment}-`));
    let child: ChildProcess;
    try {
      child = fork(
        this.options.workerEntryPath ?? defaultWorkerEntryPath(),
        [artifactPath, command.pluginId, command.generation, dataDir, tempDir],
        {
          env: pluginHostProcessEnv(
            process.env,
            this.options.shellEnv?.() ?? {},
          ),
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
    const closed = new Promise<void>((resolve) => child.once("close", resolve));
    void closed
      .then(() => rm(tempDir, { recursive: true, force: true }))
      .catch((error) => {
        this.options.logger.warn(
          { pluginId: command.pluginId, err: error },
          "Failed to remove host plugin temporary directory",
        );
      });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const worker: WorkerState = {
      pluginId: command.pluginId,
      generation: command.generation,
      digest: command.artifact.digest,
      child,
      closed,
      dataDir,
      tempDir,
      pending: new Map(),
      ready,
      resolveReady,
      rejectReady,
      disposing: false,
      activeCallCount: 0,
      retainedLeaseIds: new Set(),
      idleTimer: null,
      watches: new Map(),
    };
    let unexpectedExitReported = false;
    const failWorker = (reason: string): void => {
      this.cancelWorkerIdleTimer(worker);
      if (!worker.disposing && !unexpectedExitReported) {
        unexpectedExitReported = true;
        this.options.onWorkerExit?.({
          pluginId: worker.pluginId,
          generation: worker.generation,
        });
      }
      worker.rejectReady(new Error(reason));
      this.rejectPendingCalls(worker, reason);
      void this.stopAllWorkerWatches(worker);
      if (this.workers.get(worker.pluginId) === worker) {
        this.workers.delete(worker.pluginId);
      }
    };

    this.workers.set(command.pluginId, worker);
    const startTimer = setTimeout(() => {
      failWorker(`host plugin ${command.pluginId} startup timed out`);
      child.kill("SIGKILL");
    }, START_TIMEOUT_MS);
    startTimer.unref?.();
    if (child.stderr !== null) {
      observeBoundedStderr(child.stderr, (line) => {
        this.options.logger.warn(
          { pluginId: worker.pluginId, origin: "host", stderr: line },
          "Host plugin stderr",
        );
      });
    }
    child.once("error", (error) => {
      clearTimeout(startTimer);
      failWorker(`host plugin worker failed: ${errorMessage(error)}`);
    });
    child.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const record = Object.fromEntries(Object.entries(message));
      if (
        record.type === "ready" &&
        record.protocolVersion === HOST_WORKER_PROTOCOL_VERSION &&
        record.pluginId === worker.pluginId &&
        record.generation === worker.generation
      ) {
        clearTimeout(startTimer);
        worker.resolveReady();
        return;
      }
      if (record.type === "ready") {
        clearTimeout(startTimer);
        failWorker(`host plugin ${worker.pluginId} worker identity mismatch`);
        worker.child.kill("SIGKILL");
        return;
      }
      if (record.type === "startup-error" && typeof record.error === "string") {
        clearTimeout(startTimer);
        failWorker(record.error);
        return;
      }
      if (
        record.type === "result" &&
        typeof record.callId === "string" &&
        typeof record.ok === "boolean"
      ) {
        this.finishPendingCall(worker, record.callId, record);
        return;
      }
      if (record.type === "signal" && typeof record.signal === "string") {
        const payload = jsonValueSchema.safeParse(record.payload);
        if (!payload.success) return;
        this.options.onSignal?.({
          pluginId: worker.pluginId,
          generation: worker.generation,
          signal: record.signal,
          payload: payload.data,
        });
        return;
      }
      if (
        record.type === "lease-acquire" &&
        typeof record.leaseId === "string" &&
        record.leaseId.length > 0
      ) {
        if (!worker.disposing && this.workers.get(worker.pluginId) === worker) {
          worker.retainedLeaseIds.add(record.leaseId);
          this.cancelWorkerIdleTimer(worker);
        }
        return;
      }
      if (
        record.type === "lease-release" &&
        typeof record.leaseId === "string"
      ) {
        worker.retainedLeaseIds.delete(record.leaseId);
        this.scheduleWorkerIdle(worker);
        return;
      }
      if (record.type === "watch-start") {
        void this.startWorkerWatch(worker, record);
        return;
      }
      if (record.type === "watch-stop" && typeof record.watchId === "string") {
        void this.stopWorkerWatch(worker, record.watchId);
        return;
      }
      if (
        record.type === "watch-ack" &&
        typeof record.watchId === "string" &&
        typeof record.sequence === "number"
      ) {
        this.ackWorkerWatch(worker, record.watchId, record.sequence);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(startTimer);
      failWorker(`host plugin worker exited (${code ?? signal ?? "unknown"})`);
    });
    try {
      await ready;
      return worker;
    } catch (error) {
      await this.stopWorker(worker, errorMessage(error));
      throw error;
    }
  }

  private async startWorkerWatch(
    worker: WorkerState,
    message: Record<string, unknown>,
  ): Promise<void> {
    const watchId = message.watchId;
    const rootPath = message.rootPath;
    const ignoredPaths = message.ignoredPaths;
    const debounceMs = message.debounceMs;
    const maxWaitMs = message.maxWaitMs;
    const invalid =
      typeof watchId !== "string" ||
      watchId.length === 0 ||
      typeof rootPath !== "string" ||
      !isAbsolute(rootPath) ||
      Buffer.byteLength(rootPath) > MAX_WATCH_PATH_BYTES ||
      !Array.isArray(ignoredPaths) ||
      ignoredPaths.length > MAX_WATCH_IGNORE_ENTRIES ||
      ignoredPaths.some(
        (entry) =>
          typeof entry !== "string" ||
          Buffer.byteLength(entry) > MAX_WATCH_PATH_BYTES,
      ) ||
      typeof debounceMs !== "number" ||
      !Number.isInteger(debounceMs) ||
      debounceMs < MIN_WATCH_DEBOUNCE_MS ||
      debounceMs > MAX_WATCH_DEBOUNCE_MS ||
      typeof maxWaitMs !== "number" ||
      !Number.isInteger(maxWaitMs) ||
      maxWaitMs < debounceMs ||
      maxWaitMs > MAX_WATCH_WAIT_MS;
    if (invalid) {
      this.sendWorkerWatchStartError(
        worker,
        typeof watchId === "string" ? watchId : "",
        "invalid host watch options",
      );
      return;
    }
    if (worker.disposing || this.workers.get(worker.pluginId) !== worker) {
      this.sendWorkerWatchStartError(
        worker,
        watchId,
        "host worker is disposing",
      );
      return;
    }
    if (worker.watches.has(watchId)) {
      this.sendWorkerWatchStartError(
        worker,
        watchId,
        "duplicate host watch id",
      );
      return;
    }
    if (worker.watches.size >= MAX_WATCHES_PER_WORKER) {
      this.sendWorkerWatchStartError(
        worker,
        watchId,
        `host plugin has too many watches (maximum ${MAX_WATCHES_PER_WORKER})`,
      );
      return;
    }
    const watchPathRoot = this.options.hostWatcher?.watchPathRoot;
    if (watchPathRoot === undefined) {
      this.sendWorkerWatchStartError(
        worker,
        watchId,
        "host filesystem watch service is unavailable",
      );
      return;
    }
    const validIgnoredPaths = ignoredPaths.filter(
      (entry): entry is string => typeof entry === "string",
    );
    const state: WorkerWatchState = {
      watchId,
      worker,
      stop: () => undefined,
      stopped: false,
      inFlightSequence: null,
      nextSequence: 1,
      pendingChanges: new Map(),
      pendingRescan: false,
      pendingError: null,
      debounceMs,
      maxWaitMs,
      debounceTimer: null,
      maxWaitTimer: null,
    };
    worker.watches.set(watchId, state);
    this.cancelWorkerIdleTimer(worker);
    try {
      state.stop = watchPathRoot({
        rootPath,
        ignoredPaths: validIgnoredPaths,
        onChange: (changes) => this.queueWorkerWatchChanges(state, changes),
        onReady: () => {
          if (!state.stopped) {
            sendToWorker(worker.child, { type: "watch-ready", watchId });
          }
        },
        onRescanRequired: () => {
          if (state.stopped) return;
          state.pendingChanges.clear();
          state.pendingRescan = true;
          this.flushWorkerWatch(state);
        },
        onWatchError: ({ message: watchError }) => {
          if (state.stopped) return;
          state.pendingError = watchError;
          this.flushWorkerWatch(state);
        },
      });
    } catch (error) {
      worker.watches.delete(watchId);
      state.stopped = true;
      this.sendWorkerWatchStartError(worker, watchId, errorMessage(error));
      this.scheduleWorkerIdle(worker);
    }
  }

  private sendWorkerWatchStartError(
    worker: WorkerState,
    watchId: string,
    error: string,
  ): void {
    sendToWorker(worker.child, { type: "watch-start-error", watchId, error });
  }

  private queueWorkerWatchChanges(
    state: WorkerWatchState,
    changes: readonly HostPathWatchChange[],
  ): void {
    if (state.stopped) return;
    for (const change of changes) {
      if (Buffer.byteLength(change.path) > MAX_WATCH_PATH_BYTES) {
        state.pendingChanges.clear();
        state.pendingRescan = true;
        break;
      }
      state.pendingChanges.set(change.path, change.type);
      if (state.pendingChanges.size > MAX_WATCH_CHANGED_PATHS) {
        state.pendingChanges.clear();
        state.pendingRescan = true;
        break;
      }
    }
    if (state.inFlightSequence !== null) return;
    if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(
      () => this.flushWorkerWatch(state),
      state.debounceMs,
    );
    state.debounceTimer.unref?.();
    if (state.maxWaitTimer === null) {
      state.maxWaitTimer = setTimeout(
        () => this.flushWorkerWatch(state),
        state.maxWaitMs,
      );
      state.maxWaitTimer.unref?.();
    }
  }

  private clearWorkerWatchTimers(state: WorkerWatchState): void {
    if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
    if (state.maxWaitTimer !== null) clearTimeout(state.maxWaitTimer);
    state.debounceTimer = null;
    state.maxWaitTimer = null;
  }

  private flushWorkerWatch(state: WorkerWatchState): void {
    if (state.stopped || state.inFlightSequence !== null) return;
    this.clearWorkerWatchTimers(state);
    let event: object | null = null;
    if (state.pendingError !== null) {
      event = { kind: "watch-error", message: state.pendingError };
      state.pendingError = null;
    } else if (state.pendingRescan) {
      event = { kind: "rescan-required" };
      state.pendingRescan = false;
      state.pendingChanges.clear();
    } else if (state.pendingChanges.size > 0) {
      const changes: HostPathWatchChange[] = [];
      let batchBytes = 0;
      for (const [path, type] of state.pendingChanges) {
        const nextBytes = Buffer.byteLength(path) + 32;
        if (
          changes.length > 0 &&
          batchBytes + nextBytes > MAX_WATCH_BATCH_BYTES
        ) {
          break;
        }
        batchBytes += nextBytes;
        changes.push({ path, type });
        state.pendingChanges.delete(path);
      }
      event = { kind: "changed", changes };
    }
    if (event === null) return;
    const sequence = state.nextSequence;
    state.nextSequence += 1;
    state.inFlightSequence = sequence;
    if (
      !sendToWorker(state.worker.child, {
        type: "watch-event",
        watchId: state.watchId,
        sequence,
        event,
      })
    ) {
      state.inFlightSequence = null;
    }
  }

  private ackWorkerWatch(
    worker: WorkerState,
    watchId: string,
    sequence: number,
  ): void {
    const state = worker.watches.get(watchId);
    if (state === undefined || state.inFlightSequence !== sequence) return;
    state.inFlightSequence = null;
    this.flushWorkerWatch(state);
  }

  private async stopWorkerWatch(
    worker: WorkerState,
    watchId: string,
  ): Promise<void> {
    const state = worker.watches.get(watchId);
    if (state === undefined) return;
    worker.watches.delete(watchId);
    state.stopped = true;
    this.clearWorkerWatchTimers(state);
    state.pendingChanges.clear();
    try {
      await state.stop();
    } catch (error) {
      this.options.logger.warn(
        { pluginId: worker.pluginId, watchId, err: error },
        "Failed to stop host plugin filesystem watch",
      );
    } finally {
      this.scheduleWorkerIdle(worker);
    }
  }

  private async stopAllWorkerWatches(worker: WorkerState): Promise<void> {
    await Promise.all(
      [...worker.watches.keys()].map((watchId) =>
        this.stopWorkerWatch(worker, watchId),
      ),
    );
  }

  private finishPendingCall(
    worker: WorkerState,
    callId: string,
    result: Record<string, unknown>,
  ): void {
    const pending = worker.pending.get(callId);
    if (pending === undefined) return;
    worker.pending.delete(callId);
    clearTimeout(pending.deadlineTimer);
    if (pending.forceTimer !== null) clearTimeout(pending.forceTimer);
    if (pending.cancellationError !== null) {
      pending.reject(pending.cancellationError);
    } else if (result.ok) {
      const output = jsonValueSchema.safeParse(result.output);
      if (output.success) pending.resolve({ output: output.data });
      else pending.reject(new Error("host handler returned invalid JSON"));
    } else {
      pending.reject(
        new Error(
          typeof result.error === "string"
            ? result.error
            : "host handler failed",
        ),
      );
    }
  }

  private rejectPendingCalls(worker: WorkerState, reason: string): void {
    for (const pending of worker.pending.values()) {
      clearTimeout(pending.deadlineTimer);
      if (pending.forceTimer !== null) clearTimeout(pending.forceTimer);
      pending.reject(pending.cancellationError ?? new Error(reason));
    }
    worker.pending.clear();
  }

  private async materializeArtifact(
    command: PluginHostCallCommand,
  ): Promise<string> {
    const directory = join(
      this.options.dataDir,
      "plugin-host-artifacts",
      safePluginSegment(command.pluginId),
      command.artifact.digest,
    );
    const artifactPath = join(directory, "host.js");
    try {
      const current = await readFile(artifactPath);
      if (
        current.byteLength === command.artifact.byteLength &&
        createHash("sha256").update(current).digest("hex") ===
          command.artifact.digest
      ) {
        return artifactPath;
      }
    } catch {
      // Download below.
    }
    const bytes = await this.options.fetchArtifact({
      pluginId: command.pluginId,
      digest: command.artifact.digest,
      expectedByteLength: command.artifact.byteLength,
    });
    if (bytes.byteLength !== command.artifact.byteLength) {
      throw new Error(`host artifact length mismatch for ${command.pluginId}`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== command.artifact.digest) {
      throw new Error(`host artifact digest mismatch for ${command.pluginId}`);
    }
    await mkdir(directory, { recursive: true });
    const staged = join(directory, `.host-${randomUUID()}.tmp`);
    await writeFile(staged, bytes, { mode: 0o600 });
    await rename(staged, artifactPath);
    return artifactPath;
  }

  private async stopWorker(worker: WorkerState, reason: string): Promise<void> {
    if (worker.disposing) return worker.closed;
    worker.disposing = true;
    this.cancelWorkerIdleTimer(worker);
    if (this.workers.get(worker.pluginId) === worker) {
      this.workers.delete(worker.pluginId);
    }
    await this.stopAllWorkerWatches(worker);
    sendToWorker(worker.child, { type: "dispose" });
    const forceTimer = setTimeout(
      () => worker.child.kill("SIGKILL"),
      CANCEL_GRACE_MS,
    );
    forceTimer.unref?.();
    await worker.closed;
    clearTimeout(forceTimer);
    this.rejectPendingCalls(worker, reason);
    await rm(worker.tempDir, { recursive: true, force: true });
  }

  private cancelWorkerIdleTimer(worker: WorkerState): void {
    if (worker.idleTimer === null) return;
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }

  private scheduleWorkerIdle(worker: WorkerState): void {
    if (
      worker.disposing ||
      this.shuttingDown ||
      this.workers.get(worker.pluginId) !== worker ||
      worker.activeCallCount > 0 ||
      worker.watches.size > 0 ||
      worker.retainedLeaseIds.size > 0 ||
      worker.idleTimer !== null
    ) {
      return;
    }
    worker.idleTimer = setTimeout(() => {
      worker.idleTimer = null;
      void this.enqueueWorkerMutation(worker.pluginId, async () => {
        if (
          worker.disposing ||
          this.workers.get(worker.pluginId) !== worker ||
          worker.activeCallCount > 0 ||
          worker.watches.size > 0 ||
          worker.retainedLeaseIds.size > 0
        ) {
          return;
        }
        await this.stopWorker(worker, "host plugin worker became idle");
      });
    }, this.options.workerIdleTimeoutMs ?? DEFAULT_WORKER_IDLE_TIMEOUT_MS);
    worker.idleTimer.unref?.();
  }

  private callKey(command: {
    pluginId: string;
    generation: string;
    callId: string;
  }): string {
    return `${command.pluginId}\0${command.generation}\0${command.callId}`;
  }

  private enqueueWorkerMutation<T>(
    pluginId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.workerMutationTails.get(pluginId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.workerMutationTails.set(pluginId, tail);
    void tail.then(() => {
      if (this.workerMutationTails.get(pluginId) === tail) {
        this.workerMutationTails.delete(pluginId);
      }
    });
    return next;
  }

  private retireGeneration(pluginId: string, generation: string): void {
    const generations = this.retiredGenerations.get(pluginId) ?? new Set();
    generations.add(generation);
    if (generations.size > 32) {
      const oldest = generations.values().next().value;
      if (oldest !== undefined) generations.delete(oldest);
    }
    this.retiredGenerations.set(pluginId, generations);
  }

  private cancelPendingCall(
    worker: WorkerState,
    callId: string,
    error: Error,
  ): void {
    const pending = worker.pending.get(callId);
    if (pending === undefined) return;
    sendToWorker(worker.child, { type: "cancel", callId });
    pending.cancellationError ??= error;
    if (pending.forceTimer === null) {
      pending.forceTimer = setTimeout(() => {
        if (worker.pending.has(callId)) worker.child.kill("SIGKILL");
      }, CANCEL_GRACE_MS);
      pending.forceTimer.unref?.();
    }
  }

  private cancelledCallError(callId: string): Error {
    return Object.assign(
      new Error(`host plugin call ${callId} was cancelled`),
      { name: "AbortError" },
    );
  }
}
