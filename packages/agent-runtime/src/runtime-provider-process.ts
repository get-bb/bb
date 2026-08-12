import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
} from "@bb/process-utils";
import type {
  ProviderAdapter,
  ProviderAdapterFactory,
} from "./provider-adapter.js";
import { createProviderForId } from "./provider-registry.js";
import { filterSkillRootsForProvider } from "./runtime-skill-roots.js";
import {
  ignoredJsonRpcResultSchema,
  type PendingJsonRpcRequest,
  sendJsonRpcRequest,
} from "./runtime-json-rpc.js";
import type { RuntimeProviderIdentityState } from "./runtime-thread-identity.js";
import type {
  AgentRuntimeOptions,
  AgentRuntimeProcessExitThreadState,
  AgentRuntimeSkillRoot,
} from "./types.js";

export interface RuntimeProviderProcess {
  adapter: ProviderAdapter;
  child: ChildProcess;
  expectedShutdownExpectations: number;
  exitFinalized: Promise<void>;
  identity: RuntimeProviderIdentityState;
  interactiveRequestScope: string;
  pending: Map<string | number, PendingJsonRpcRequest>;
  processKey: string;
  providerId: string;
  stderrLineTail: Buffer;
  stderrTail: Buffer;
}

export interface RuntimeProviderProcessLineArgs {
  line: string;
  providerProcess: RuntimeProviderProcess;
}

export interface RuntimeProviderProcessManagerArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  adapterFactory?: ProviderAdapterFactory;
  bridgeBundleDir: string | undefined;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
  /**
   * Snapshots a thread's turn/provider state for the process-exit
   * notification. Invoked before `onProviderThreadDetached` clears the
   * state, so exit consumers still see what the dead process was running.
   */
  captureThreadExitState: (
    threadId: string,
  ) => AgentRuntimeProcessExitThreadState;
  createProviderIdentityState: (
    providerId: string,
  ) => RuntimeProviderIdentityState;
  env: Record<string, string> | undefined;
  getNextRequestId: () => number;
  handleStdoutLine: (args: RuntimeProviderProcessLineArgs) => void;
  onProcessExit: AgentRuntimeOptions["onProcessExit"];
  onProviderIdentityWaitersInterrupted: (
    providerProcess: RuntimeProviderProcess,
  ) => void;
  onProviderThreadDetached: (
    threadId: string,
    providerProcess: RuntimeProviderProcess,
  ) => void;
  onStderr: AgentRuntimeOptions["onStderr"];
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

export interface EnsureRuntimeProviderArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  processKey: string;
  providerId: string;
}

export interface RequireRuntimeProviderProcessArgs {
  processKey: string;
  providerId: string;
}

export interface ShutdownRuntimeProviderArgs {
  processKey: string;
  providerId: string;
  timeoutMs?: number;
}

interface CleanupFailedStartupArgs {
  processKey: string;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  startupError: Error;
}

interface TerminateProviderProcessArgs {
  providerProcess: RuntimeProviderProcess;
  timeoutMs?: number;
}

interface SpawnProviderArgs {
  adapter: ProviderAdapter;
  processKey: string;
  providerId: string;
}

interface ProviderProcessExitStatus {
  code: number | null;
  signal: string | null;
}

interface ProviderProcessExitedErrorArgs {
  providerId: string;
  status: ProviderProcessExitStatus;
  stderrTail: Buffer;
}

const PROVIDER_STDERR_TAIL_MAX_BYTES = 4_000;
const PROVIDER_PROCESS_CLOSE_GRACE_MS = 1_000;

function createAdapterTurnIdPrefix(): string {
  const adapterId = randomUUID().replaceAll("-", "").slice(0, 16);
  return `turn_${adapterId}_`;
}

export class ProviderProcessExitedError extends Error {
  constructor(args: ProviderProcessExitedErrorArgs) {
    const stderr = formatProviderStderr(args.stderrTail);
    super(
      `Provider "${args.providerId}" exited unexpectedly (${formatProviderProcessExitStatus(args.status)})` +
        (stderr ? `\nstderr: ${stderr}` : ""),
    );
    this.name = "ProviderProcessExitedError";
  }
}

export class RuntimeProviderProcessManager {
  private readonly args: RuntimeProviderProcessManagerArgs;
  private readonly processes = new Map<string, RuntimeProviderProcess>();
  private readonly providerStarting = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(args: RuntimeProviderProcessManagerArgs) {
    this.args = args;
  }

  async ensureProvider(args: EnsureRuntimeProviderArgs): Promise<void> {
    const existing = this.providerStarting.get(args.processKey);
    if (existing) {
      await existing;
      return;
    }

    const existingProcess = this.processes.get(args.processKey);
    if (existingProcess !== undefined) {
      if (!hasChildProcessExited(existingProcess.child)) return;
      await existingProcess.exitFinalized;

      // Another caller may have started the replacement while this caller
      // waited for the exited process to finish draining its stdio.
      const concurrentStart = this.providerStarting.get(args.processKey);
      if (concurrentStart !== undefined) {
        await concurrentStart;
        return;
      }
      if (this.processes.has(args.processKey)) return;
    }

    const startPromise = (async () => {
      const adapter = this.getAdapter(args.providerId, args.acpLaunchSpec);
      const providerProcess = this.spawnProvider({
        adapter,
        processKey: args.processKey,
        providerId: args.providerId,
      });

      try {
        if (hasChildProcessExited(providerProcess.child)) {
          const stderr = formatProviderStderr(
            providerProcess.stderrTail,
          )?.slice(0, 500);
          throw new Error(
            `Provider "${args.providerId}" exited during startup with ${formatChildProcessExitStatus(providerProcess.child)}` +
              (stderr ? `\nstderr: ${stderr}` : ""),
          );
        }

        const initCmd = adapter.buildCommandPlan({ type: "initialize" });
        if (initCmd.kind === "request") {
          await sendJsonRpcRequest({
            child: providerProcess.child,
            message: initCmd,
            pending: providerProcess.pending,
            getNextId: this.args.getNextRequestId,
            resultSchema: ignoredJsonRpcResultSchema,
          });
        }

        for (const request of adapter.buildPostInitializeRequests?.() ?? []) {
          try {
            const result = await sendJsonRpcRequest({
              child: providerProcess.child,
              message: request.plan,
              pending: providerProcess.pending,
              getNextId: this.args.getNextRequestId,
              resultSchema: ignoredJsonRpcResultSchema,
            });
            request.onResult(result);
          } catch (error) {
            if (request.required) throw error;
          }
        }

        const providerSkillRoots = filterSkillRootsForProvider({
          providerId: args.providerId,
          skillRoots: this.args.skillRoots,
        });
        if (providerSkillRoots.length > 0) {
          const skillRootsCmd = adapter.buildCommandPlan({
            type: "skills/configure",
            skillRoots: providerSkillRoots,
          });
          if (skillRootsCmd.kind === "request") {
            await sendJsonRpcRequest({
              child: providerProcess.child,
              message: skillRootsCmd,
              pending: providerProcess.pending,
              getNextId: this.args.getNextRequestId,
              resultSchema: ignoredJsonRpcResultSchema,
            });
          }
        }
      } catch (startupError) {
        await this.cleanupFailedStartup({
          processKey: args.processKey,
          providerId: args.providerId,
          providerProcess,
          startupError:
            startupError instanceof Error
              ? startupError
              : new Error(String(startupError)),
        });
        throw startupError;
      }
    })();

    this.providerStarting.set(args.processKey, startPromise);
    try {
      await startPromise;
    } finally {
      if (this.providerStarting.get(args.processKey) === startPromise) {
        this.providerStarting.delete(args.processKey);
      }
    }
  }

  requireProviderProcess(
    args: RequireRuntimeProviderProcessArgs,
  ): RuntimeProviderProcess {
    const providerProcess = this.processes.get(args.processKey);
    if (!providerProcess) {
      throw new Error(`Provider "${args.providerId}" is not running`);
    }
    if (hasChildProcessExited(providerProcess.child)) {
      throw new Error(
        `Provider "${args.providerId}" has exited (${formatChildProcessExitStatus(providerProcess.child)})`,
      );
    }
    return providerProcess;
  }

  listRunningProviders(): string[] {
    return [
      ...new Set(
        [...this.processes.values()]
          .filter((proc) => !hasChildProcessExited(proc.child))
          .map((proc) => proc.providerId),
      ),
    ];
  }

  async shutdownProvider(args: ShutdownRuntimeProviderArgs): Promise<void> {
    const providerProcess = this.processes.get(args.processKey);
    if (!providerProcess) {
      return;
    }

    if (hasChildProcessExited(providerProcess.child)) {
      await providerProcess.exitFinalized;
      return;
    }

    providerProcess.expectedShutdownExpectations += 1;
    await this.terminateProviderProcess({
      providerProcess,
      timeoutMs: args.timeoutMs,
    });
    if (hasChildProcessExited(providerProcess.child)) {
      await providerProcess.exitFinalized;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const shutdownPromises: Promise<void>[] = [];

    for (const [processKey, providerProcess] of this.processes) {
      if (!hasChildProcessExited(providerProcess.child)) {
        shutdownPromises.push(
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              providerProcess.child.kill("SIGKILL");
              resolve();
            }, 5000);

            providerProcess.child.on("exit", () => {
              clearTimeout(timer);
              resolve();
            });

            providerProcess.child.kill("SIGTERM");
          }),
        );
      }
      for (const [, pending] of providerProcess.pending) {
        pending.reject(new Error("Runtime shutting down"));
      }
      providerProcess.pending.clear();
      this.args.onProviderIdentityWaitersInterrupted(providerProcess);

      for (const threadId of providerProcess.identity.threadIds) {
        this.args.onProviderThreadDetached(threadId, providerProcess);
      }
      this.processes.delete(processKey);
    }

    await Promise.all(shutdownPromises);
  }

  private getAdapter(
    providerId: string,
    acpLaunchSpec: HostDaemonAcpLaunchSpec | undefined,
  ): ProviderAdapter {
    const adapterOptions = {
      additionalWorkspaceWriteRoots: this.args.additionalWorkspaceWriteRoots,
      ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
      bridgeBundleDir: this.args.bridgeBundleDir,
      ...(this.args.bridgeNodeEnv !== undefined
        ? { bridgeNodeEnv: this.args.bridgeNodeEnv }
        : {}),
      ...(this.args.bridgeNodeExecutablePath !== undefined
        ? { bridgeNodeExecutablePath: this.args.bridgeNodeExecutablePath }
        : {}),
      turnIdPrefix: createAdapterTurnIdPrefix(),
    };

    if (this.args.adapterFactory) {
      return this.args.adapterFactory(providerId, adapterOptions);
    }
    return createProviderForId(providerId, adapterOptions);
  }

  private spawnProvider(args: SpawnProviderArgs): RuntimeProviderProcess {
    const processConfig = args.adapter.process;
    const env: NodeJS.ProcessEnv = {
      ...sanitizeInheritedChildProcessEnv({ env: process.env }),
      ...this.args.env,
      ...processConfig.env,
    };

    const child = spawnPortablePipedProcess({
      command: processConfig.command,
      args: processConfig.args,
      cwd: this.args.workspacePath,
      env,
    });
    let finalizeExit: () => void = () => undefined;
    const exitFinalized = new Promise<void>((resolve) => {
      finalizeExit = resolve;
    });

    const providerProcess: RuntimeProviderProcess = {
      child,
      adapter: args.adapter,
      expectedShutdownExpectations: 0,
      exitFinalized,
      interactiveRequestScope: randomUUID(),
      identity: this.args.createProviderIdentityState(args.providerId),
      pending: new Map(),
      processKey: args.processKey,
      providerId: args.providerId,
      stderrLineTail: Buffer.alloc(0),
      stderrTail: Buffer.alloc(0),
    };

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (
        this.shuttingDown ||
        !this.isCurrentProviderProcess({ providerProcess })
      ) {
        return;
      }
      this.args.handleStdoutLine({
        line,
        providerProcess,
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (
        this.shuttingDown ||
        !this.isCurrentProviderProcess({ providerProcess })
      ) {
        return;
      }
      consumeProviderStderrChunk({
        chunk,
        onLine: this.args.onStderr,
        providerProcess,
      });
    });
    child.stderr.on("end", () => {
      if (
        this.shuttingDown ||
        !this.isCurrentProviderProcess({ providerProcess }) ||
        providerProcess.stderrLineTail.length === 0
      ) {
        return;
      }
      this.args.onStderr?.(decodeStderrLine(providerProcess.stderrLineTail));
      providerProcess.stderrLineTail = Buffer.alloc(0);
    });

    child.on("error", (err) => {
      this.handleProviderProcessError({
        err,
        providerId: args.providerId,
        providerProcess,
      });
    });
    let exitStatus: ProviderProcessExitStatus | null = null;
    let closeGraceTimer: NodeJS.Timeout | null = null;
    let exitHandled = false;
    const handleExit = (status: ProviderProcessExitStatus): void => {
      if (exitHandled) return;
      exitHandled = true;
      if (closeGraceTimer !== null) {
        clearTimeout(closeGraceTimer);
      }
      try {
        this.handleProviderProcessExit({
          code: status.code,
          providerId: args.providerId,
          providerProcess,
          signal: status.signal,
        });
      } finally {
        finalizeExit();
      }
    };

    child.on("exit", (code, signal) => {
      const status = {
        code: code ?? null,
        signal: signal ?? null,
      };
      exitStatus = status;
      // `exit` can precede the final stdout/stderr data events. Prefer
      // `close`, which fires after stdio closes, so final provider output is
      // consumed before pending requests and diagnostics are settled. Bound
      // the wait because a descendant can inherit and hold a pipe open.
      closeGraceTimer = setTimeout(() => {
        // Stop an inherited pipe from outliving its provider entry. Otherwise
        // a descendant can emit stale protocol messages after the replacement
        // process has become current, and the unread streams remain retained.
        stdout.close();
        child.stdout.destroy();
        child.stderr.destroy();
        handleExit(status);
      }, PROVIDER_PROCESS_CLOSE_GRACE_MS);
      closeGraceTimer.unref();
    });
    child.on("close", (code, signal) => {
      handleExit(
        exitStatus ?? {
          code: code ?? null,
          signal: signal ?? null,
        },
      );
    });

    this.processes.set(args.processKey, providerProcess);
    return providerProcess;
  }

  private async cleanupFailedStartup(
    args: CleanupFailedStartupArgs,
  ): Promise<void> {
    if (this.processes.get(args.processKey) !== args.providerProcess) {
      return;
    }

    this.processes.delete(args.processKey);
    args.providerProcess.expectedShutdownExpectations += 1;
    for (const [, pending] of args.providerProcess.pending) {
      pending.reject(args.startupError);
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    await this.terminateProviderProcess({
      providerProcess: args.providerProcess,
    });
  }

  private async terminateProviderProcess(
    args: TerminateProviderProcessArgs,
  ): Promise<void> {
    if (hasChildProcessExited(args.providerProcess.child)) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeoutMs = args.timeoutMs ?? 5000;
      const softTimer = setTimeout(() => {
        if (!hasChildProcessExited(args.providerProcess.child)) {
          args.providerProcess.child.kill("SIGKILL");
        }
      }, timeoutMs);
      const hardTimer = setTimeout(resolve, timeoutMs + 1000);

      args.providerProcess.child.once("exit", () => {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        resolve();
      });

      args.providerProcess.child.kill("SIGTERM");
    });
  }

  private handleProviderProcessError(args: ProviderProcessErrorArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerProcess.processKey);
    const message = args.err.message;
    for (const [, pending] of args.providerProcess.pending) {
      pending.reject(
        new Error(`Provider "${args.providerId}" failed to start: ${message}`),
      );
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    this.args.onProcessExit?.({
      providerId: args.providerId,
      threads: [...args.providerProcess.identity.threadIds].map((threadId) =>
        this.args.captureThreadExitState(threadId),
      ),
      code: null,
      expected,
      signal: null,
      stderr: null,
    });
  }

  private handleProviderProcessExit(args: ProviderProcessExitArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerProcess.processKey);
    const threadIds = [...args.providerProcess.identity.threadIds];
    // Snapshot per-thread state before detaching clears it; the exit
    // notification below is the last place this state is observable.
    const threads = threadIds.map((threadId) =>
      this.args.captureThreadExitState(threadId),
    );
    for (const threadId of threadIds) {
      this.args.onProviderThreadDetached(threadId, args.providerProcess);
    }
    for (const [, pending] of args.providerProcess.pending) {
      pending.reject(
        new ProviderProcessExitedError({
          providerId: args.providerId,
          status: { code: args.code, signal: args.signal },
          stderrTail: args.providerProcess.stderrTail,
        }),
      );
    }
    args.providerProcess.pending.clear();
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    this.args.onProcessExit?.({
      providerId: args.providerId,
      threads,
      code: args.code,
      expected,
      signal: args.signal,
      stderr: formatProviderStderr(args.providerProcess.stderrTail),
    });
  }

  private isCurrentProviderProcess(
    args: Pick<ProviderProcessExitArgs, "providerProcess">,
  ): boolean {
    return (
      this.processes.get(args.providerProcess.processKey) ===
      args.providerProcess
    );
  }
}

/**
 * Whether a child process has terminated, covering both normal exits
 * (`exitCode`) and signal terminations (`signalCode`). Node reports a
 * signal-killed child with a null `exitCode` and a set `signalCode`.
 */
export function hasChildProcessExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function getChildProcessExitStatus(
  child: ChildProcess,
): ProviderProcessExitStatus {
  return { code: child.exitCode, signal: child.signalCode };
}

function formatChildProcessExitStatus(child: ChildProcess): string {
  return formatProviderProcessExitStatus(getChildProcessExitStatus(child));
}

function formatProviderProcessExitStatus(
  status: ProviderProcessExitStatus,
): string {
  if (status.code !== null) {
    return `code ${status.code}`;
  }
  if (status.signal !== null) {
    return `signal ${status.signal}`;
  }
  return "unknown status";
}

function formatProviderStderr(stderrTail: Buffer): string | null {
  const stderr = stderrTail.toString("utf8").trim();
  if (stderr.length === 0) {
    return null;
  }
  return stderr;
}

function appendBoundedStderrBytes(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= PROVIDER_STDERR_TAIL_MAX_BYTES) {
    return Buffer.from(
      chunk.subarray(chunk.length - PROVIDER_STDERR_TAIL_MAX_BYTES),
    );
  }
  const currentBytesToKeep = Math.min(
    current.length,
    PROVIDER_STDERR_TAIL_MAX_BYTES - chunk.length,
  );
  return Buffer.concat([
    current.subarray(current.length - currentBytesToKeep),
    chunk,
  ]);
}

function decodeStderrLine(line: Buffer): string {
  const end = line.at(-1) === 0x0d ? line.length - 1 : line.length;
  return line.toString("utf8", 0, end);
}

function consumeProviderStderrChunk(args: {
  chunk: Buffer;
  onLine: AgentRuntimeOptions["onStderr"];
  providerProcess: RuntimeProviderProcess;
}): void {
  args.providerProcess.stderrTail = appendBoundedStderrBytes(
    args.providerProcess.stderrTail,
    args.chunk,
  );

  let offset = 0;
  let newline = args.chunk.indexOf(0x0a, offset);
  while (newline !== -1) {
    args.providerProcess.stderrLineTail = appendBoundedStderrBytes(
      args.providerProcess.stderrLineTail,
      args.chunk.subarray(offset, newline),
    );
    args.onLine?.(decodeStderrLine(args.providerProcess.stderrLineTail));
    args.providerProcess.stderrLineTail = Buffer.alloc(0);
    offset = newline + 1;
    newline = args.chunk.indexOf(0x0a, offset);
  }

  if (offset < args.chunk.length) {
    args.providerProcess.stderrLineTail = appendBoundedStderrBytes(
      args.providerProcess.stderrLineTail,
      args.chunk.subarray(offset),
    );
  }
}

function consumeExpectedProviderProcessShutdown(
  providerProcess: RuntimeProviderProcess,
): boolean {
  // One process exit consumes all outstanding explicit shutdown requests.
  const expected = providerProcess.expectedShutdownExpectations > 0;
  providerProcess.expectedShutdownExpectations = 0;
  return expected;
}

interface ProviderProcessErrorArgs {
  err: Error;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
}

interface ProviderProcessExitArgs {
  code: number | null;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  signal: string | null;
}
