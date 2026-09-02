import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import {
  mkdir as mkdirAsync,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { RappClientConfig } from "./rapp-client.js";
import {
  RAPP_BRAINSTEM_SECRET_ENV,
  RAPP_BRAINSTEM_URL_ENV,
  RAPP_BUSINESS_URL_ENV,
  RAPP_FUNCTION_KEY_ENV,
  RAPP_USER_GUID_ENV,
} from "./vocabulary.js";

const START_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 1_500;
const HEALTH_RETRY_MS = 500;
const EXISTING_HEALTH_GRACE_MS = 3_000;
const STOP_TIMEOUT_MS = 5_000;
const FORCE_STOP_TIMEOUT_MS = 1_000;
const LOCK_RETRY_MS = 100;
const LOCK_OWNER_GRACE_MS = 5_000;
const LOCK_EXPIRY_GRACE_MS = 15_000;
const LOCK_OWNER_FILE = "owner";

const healthSchema = z.object({
  status: z.enum(["ok", "unauthenticated"]),
  version: z.string(),
  agents: z.array(z.string()),
});

const scrubbedEnvironmentVariables = new Set(
  [
    RAPP_BRAINSTEM_URL_ENV,
    RAPP_BRAINSTEM_SECRET_ENV,
    RAPP_BUSINESS_URL_ENV,
    RAPP_FUNCTION_KEY_ENV,
    RAPP_USER_GUID_ENV,
  ].map((name) => name.toUpperCase()),
);

interface LocalBrainstemAddress {
  key: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
}

interface BrainstemConfig extends LocalBrainstemAddress {
  sourceDir: string;
  python: string;
  logFile: string;
  lockPath: string;
}

export interface BrainstemTimer {
  cancel(): void;
  unref(): void;
}

export interface BrainstemChildProcess {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
  onError(listener: (error: Error) => void): () => void;
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void;
}

export interface BrainstemSpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFd: number;
}

export interface BrainstemLaunchLockRequest {
  lockPath: string;
  deadlineMs: number;
  signal: AbortSignal;
}

export interface BrainstemLaunchLock {
  release(): Promise<void>;
}

export interface BrainstemProcessDependencies {
  readonly platform: NodeJS.Platform;
  environment(): NodeJS.ProcessEnv;
  homeDirectory(): string;
  now(): number;
  fileExists(filePath: string): boolean;
  makeDirectory(directoryPath: string): void;
  openLog(filePath: string): number;
  closeLog(fd: number): void;
  spawn(request: BrainstemSpawnRequest): BrainstemChildProcess;
  probeHealth(url: string, signal: AbortSignal): Promise<boolean>;
  acquireLaunchLock(
    request: BrainstemLaunchLockRequest,
  ): Promise<BrainstemLaunchLock>;
  setTimer(callback: () => void, delayMs: number): BrainstemTimer;
}

export interface BrainstemProcessTimings {
  startTimeoutMs: number;
  healthRetryMs: number;
  existingHealthGraceMs: number;
  stopTimeoutMs: number;
  forceStopTimeoutMs: number;
}

export interface BrainstemProcessManager {
  ensureLocalBrainstem(
    config: RappClientConfig,
    signal: AbortSignal,
  ): Promise<void>;
  stopManagedBrainstems(): Promise<void>;
}

interface ChildObservation {
  readonly error: Error | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface ReusedReadyState {
  phase: "ready";
  ownership: "reused";
}

interface OwnedReadyState {
  phase: "ready";
  ownership: "owned";
  child: BrainstemChildProcess;
  observation: ChildObservation;
  logFd: number;
  disposed: boolean;
}

type ReadyState = ReusedReadyState | OwnedReadyState;

interface StartContext {
  fallback: ReadyState | null;
}

interface IdleState {
  phase: "idle";
}

interface StartingState {
  phase: "starting";
  token: object;
  controller: AbortController;
  operation: Promise<void>;
}

interface StoppingState {
  phase: "stopping";
  token: object;
  operation: Promise<void>;
}

type ManagedState = IdleState | ReadyState | StartingState | StoppingState;

type HealthWaitResult =
  | { kind: "healthy" }
  | { kind: "spawn-error"; error: Error }
  | {
      kind: "terminal";
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    }
  | { kind: "timeout" };

const defaultTimings: BrainstemProcessTimings = {
  startTimeoutMs: START_TIMEOUT_MS,
  healthRetryMs: HEALTH_RETRY_MS,
  existingHealthGraceMs: EXISTING_HEALTH_GRACE_MS,
  stopTimeoutMs: STOP_TIMEOUT_MS,
  forceStopTimeoutMs: FORCE_STOP_TIMEOUT_MS,
};

class BrainstemStartupInterruptedError extends Error {
  constructor() {
    super("RAPP Brainstem startup was interrupted");
    this.name = "BrainstemStartupInterruptedError";
  }
}

function errorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return null;
  }
  return error.code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new BrainstemStartupInterruptedError();
  }
}

function setNodeTimer(callback: () => void, delayMs: number): BrainstemTimer {
  const timeout = setTimeout(callback, delayMs);
  return {
    cancel(): void {
      clearTimeout(timeout);
    },
    unref(): void {
      timeout.unref();
    },
  };
}

function waitForNodeDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: BrainstemTimer | null = null;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      timer?.cancel();
      signal.removeEventListener("abort", onAbort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onAbort = (): void => {
      finish(new BrainstemStartupInterruptedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setNodeTimer(() => finish(), delayMs);
    timer.unref();
    if (settled) {
      timer.cancel();
    }
  });
}

async function probeNodeHealth(
  url: string,
  signal: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setNodeTimer(() => controller.abort(), HEALTH_TIMEOUT_MS);
  timer.unref();
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    return healthSchema.safeParse(await response.json()).success;
  } catch {
    return false;
  } finally {
    timer.cancel();
    signal.removeEventListener("abort", onAbort);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function lockCanBeRemoved(lockPath: string): Promise<boolean> {
  const ownerPath = path.join(lockPath, LOCK_OWNER_FILE);
  try {
    const owner = await readFile(ownerPath, "utf8");
    const [pidText, expiryText] = owner.split(":");
    const pid = Number.parseInt(pidText ?? "", 10);
    const expiryMs = Number.parseInt(expiryText ?? "", 10);
    if (Number.isFinite(expiryMs) && Date.now() >= expiryMs) {
      return true;
    }
    if (Number.isInteger(pid) && pid > 0) {
      return !isPidAlive(pid);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs >= LOCK_OWNER_GRACE_MS;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function acquireNodeLaunchLock(
  request: BrainstemLaunchLockRequest,
): Promise<BrainstemLaunchLock> {
  await mkdirAsync(path.dirname(request.lockPath), { recursive: true });
  const token = `${process.pid}:${
    request.deadlineMs + LOCK_EXPIRY_GRACE_MS
  }:${randomUUID()}`;
  const ownerPath = path.join(request.lockPath, LOCK_OWNER_FILE);
  while (true) {
    throwIfAborted(request.signal);
    try {
      await mkdirAsync(request.lockPath);
      try {
        await writeFile(ownerPath, token, "utf8");
      } catch (error) {
        await rm(request.lockPath, { recursive: true, force: true });
        throw error;
      }
      let released = false;
      return {
        async release(): Promise<void> {
          if (released) {
            return;
          }
          released = true;
          try {
            const currentOwner = await readFile(ownerPath, "utf8");
            if (currentOwner === token) {
              await rm(request.lockPath, { recursive: true, force: true });
            }
          } catch (error) {
            if (errorCode(error) !== "ENOENT") {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
    }
    if (await lockCanBeRemoved(request.lockPath)) {
      await rm(request.lockPath, { recursive: true, force: true });
      continue;
    }
    const remainingMs = request.deadlineMs - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out waiting for the RAPP Brainstem startup lock at ${request.lockPath}`,
      );
    }
    await waitForNodeDelay(
      Math.min(LOCK_RETRY_MS, remainingMs),
      request.signal,
    );
  }
}

function adaptChildProcess(child: ChildProcess): BrainstemChildProcess {
  return {
    get exitCode(): number | null {
      return child.exitCode;
    },
    get signalCode(): NodeJS.Signals | null {
      return child.signalCode;
    },
    kill(signal: NodeJS.Signals): boolean {
      return child.kill(signal);
    },
    onError(listener: (error: Error) => void): () => void {
      child.on("error", listener);
      return () => child.off("error", listener);
    },
    onExit(
      listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): () => void {
      child.on("exit", listener);
      return () => child.off("exit", listener);
    },
  };
}

const nodeDependencies: BrainstemProcessDependencies = {
  platform: process.platform,
  environment: () => process.env,
  homeDirectory: homedir,
  now: () => Date.now(),
  fileExists: existsSync,
  makeDirectory: (directoryPath) => {
    mkdirSync(directoryPath, { recursive: true });
  },
  openLog: (filePath) => openSync(filePath, "a"),
  closeLog: closeSync,
  spawn(request) {
    return adaptChildProcess(
      spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", request.logFd, request.logFd],
      }),
    );
  },
  probeHealth: probeNodeHealth,
  acquireLaunchLock: acquireNodeLaunchLock,
  setTimer: setNodeTimer,
};

function isLaunchableBrainstemHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function resolveLocalBrainstemAddress(
  endpoint: URL,
): LocalBrainstemAddress | null {
  if (
    endpoint.protocol !== "http:" ||
    !isLaunchableBrainstemHostname(endpoint.hostname) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/chat" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    return null;
  }
  const port = endpoint.port === "" ? 80 : Number.parseInt(endpoint.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return null;
  }
  const canonicalEndpoint = new URL(`http://127.0.0.1:${port}`);
  return {
    key: `http-loopback:${port}`,
    port,
    baseUrl: canonicalEndpoint.origin,
    healthUrl: new URL("/health", canonicalEndpoint).toString(),
  };
}

export function canonicalLocalBrainstemKey(
  config: RappClientConfig,
): string | null {
  if (config.grail !== "consumer") {
    return null;
  }
  return resolveLocalBrainstemAddress(config.endpoint)?.key ?? null;
}

export function shouldManageLocalBrainstem(config: RappClientConfig): boolean {
  return canonicalLocalBrainstemKey(config) !== null;
}

function resolveBrainstemConfig(
  address: LocalBrainstemAddress,
  dependencies: BrainstemProcessDependencies,
): BrainstemConfig {
  const env = dependencies.environment();
  const home =
    env.BRAINSTEM_HOME?.trim() ||
    path.join(dependencies.homeDirectory(), ".brainstem");
  const sourceDir = path.join(home, "src", "rapp_brainstem");
  const python =
    dependencies.platform === "win32"
      ? path.join(home, "venv", "Scripts", "python.exe")
      : path.join(home, "venv", "bin", "python");
  return {
    ...address,
    sourceDir,
    python,
    logFile: path.join(home, "logs", "bb-brainstem.log"),
    lockPath: path.join(home, "run", `bb-brainstem-${address.port}.lock`),
  };
}

function createChildEnvironment(
  env: NodeJS.ProcessEnv,
  port: number,
): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const name of Object.keys(childEnv)) {
    if (scrubbedEnvironmentVariables.has(name.toUpperCase())) {
      delete childEnv[name];
    }
  }
  childEnv.PORT = String(port);
  childEnv.BRAINSTEM_BB_LAUNCHER = "1";
  childEnv.PYTHONUTF8 = "1";
  return childEnv;
}

function observeChild(child: BrainstemChildProcess): ChildObservation {
  let childError: Error | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  const removeErrorListener = child.onError((error) => {
    childError = error;
    notify();
  });
  const removeExitListener = child.onExit(() => notify());
  return {
    get error(): Error | null {
      return childError;
    },
    subscribe(listener: () => void): () => void {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      listeners.clear();
      removeErrorListener();
      removeExitListener();
    },
  };
}

function isChildTerminal(child: BrainstemChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function terminalDescription(
  exitCode: number | null,
  signalCode: NodeJS.Signals | null,
): string {
  if (signalCode !== null) {
    return `signal ${signalCode}`;
  }
  return `code ${exitCode ?? "unknown"}`;
}

class ManagedBrainstem {
  private state: ManagedState = { phase: "idle" };

  constructor(
    private readonly config: BrainstemConfig,
    private readonly dependencies: BrainstemProcessDependencies,
    private readonly timings: BrainstemProcessTimings,
  ) {}

  async ensureStarted(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    while (true) {
      const state = this.state;
      if (state.phase === "starting") {
        await this.waitForSharedOperation(state.operation, signal);
        return;
      }
      if (state.phase === "stopping") {
        await this.waitForSharedOperation(state.operation, signal);
        continue;
      }
      const operation = this.beginStart(state.phase === "ready" ? state : null);
      await this.waitForSharedOperation(operation, signal);
      return;
    }
  }

  async stop(): Promise<void> {
    while (true) {
      const state = this.state;
      if (state.phase === "idle") {
        return;
      }
      if (state.phase === "starting") {
        state.controller.abort();
        try {
          await state.operation;
        } catch {}
        continue;
      }
      if (state.phase === "stopping") {
        await state.operation;
        return;
      }
      if (state.ownership === "reused") {
        this.state = { phase: "idle" };
        return;
      }
      const token = {};
      const operation = this.terminateOwned(state, true).finally(() => {
        if (this.state.phase === "stopping" && this.state.token === token) {
          this.state = { phase: "idle" };
        }
      });
      this.state = { phase: "stopping", token, operation };
      await operation;
      return;
    }
  }

  private beginStart(fallback: ReadyState | null): Promise<void> {
    const controller = new AbortController();
    const context: StartContext = { fallback };
    const token = {};
    const operation = this.runStart(context, controller.signal).then(
      (ready) => {
        if (this.state.phase === "starting" && this.state.token === token) {
          this.state = ready;
        }
      },
      (error) => {
        if (this.state.phase === "starting" && this.state.token === token) {
          this.state = context.fallback ?? { phase: "idle" };
        }
        throw error;
      },
    );
    this.state = {
      phase: "starting",
      token,
      controller,
      operation,
    };
    void operation.catch(() => undefined);
    return operation;
  }

  private async runStart(
    context: StartContext,
    signal: AbortSignal,
  ): Promise<ReadyState> {
    const deadlineMs = this.dependencies.now() + this.timings.startTimeoutMs;
    const lock = await this.dependencies.acquireLaunchLock({
      lockPath: this.config.lockPath,
      deadlineMs,
      signal,
    });
    try {
      throwIfAborted(signal);
      const existing = context.fallback;
      const existingDeadlineMs = Math.min(
        deadlineMs,
        this.dependencies.now() + this.timings.existingHealthGraceMs,
      );
      const existingHealth = await this.waitForHealth(
        existingDeadlineMs,
        signal,
        existing?.ownership === "owned" ? existing : null,
      );
      if (existingHealth.kind === "healthy") {
        if (
          existing?.ownership === "owned" &&
          !isChildTerminal(existing.child) &&
          existing.observation.error === null
        ) {
          return existing;
        }
        if (existing?.ownership === "owned") {
          this.disposeOwned(existing);
        }
        context.fallback = {
          phase: "ready",
          ownership: "reused",
        };
        return context.fallback;
      }
      if (existing?.ownership === "owned") {
        if (existingHealth.kind === "spawn-error") {
          this.disposeOwned(existing);
          context.fallback = null;
          throw new Error(
            `RAPP Brainstem process error: ${existingHealth.error.message}. See ${this.config.logFile}`,
          );
        }
        if (existingHealth.kind === "terminal") {
          this.disposeOwned(existing);
          context.fallback = null;
        } else if (!isChildTerminal(existing.child)) {
          throw new Error(
            `RAPP Brainstem did not respond at ${this.config.baseUrl}, but the managed process is still running`,
          );
        } else {
          this.disposeOwned(existing);
          context.fallback = null;
        }
      } else {
        context.fallback = null;
      }
      if (this.dependencies.now() >= deadlineMs) {
        throw new Error(
          `RAPP Brainstem did not become healthy at ${this.config.baseUrl}`,
        );
      }
      this.assertLaunchFiles();
      const owned = this.spawnOwned();
      context.fallback = owned;
      const started = await this.waitForHealth(deadlineMs, signal, owned);
      if (started.kind === "healthy") {
        if (!isChildTerminal(owned.child) && owned.observation.error === null) {
          return owned;
        }
        this.disposeOwned(owned);
        context.fallback = {
          phase: "ready",
          ownership: "reused",
        };
        return context.fallback;
      }
      if (started.kind === "spawn-error") {
        this.disposeOwned(owned);
        context.fallback = null;
        throw new Error(
          `Failed to start RAPP Brainstem: ${started.error.message}. See ${this.config.logFile}`,
        );
      }
      if (started.kind === "terminal") {
        this.disposeOwned(owned);
        context.fallback = null;
        throw new Error(
          `RAPP Brainstem exited with ${terminalDescription(
            started.exitCode,
            started.signalCode,
          )}. See ${this.config.logFile}`,
        );
      }
      await this.terminateOwned(owned, false);
      context.fallback = isChildTerminal(owned.child) ? null : owned;
      throw new Error(
        `RAPP Brainstem did not become healthy at ${this.config.baseUrl}. See ${this.config.logFile}`,
      );
    } finally {
      await lock.release();
    }
  }

  private assertLaunchFiles(): void {
    const serverFile = path.join(this.config.sourceDir, "brainstem.py");
    if (!this.dependencies.fileExists(serverFile)) {
      throw new Error(
        `RAPP Brainstem is not installed at ${this.config.sourceDir}. Install it from https://github.com/kody-w/rapp-installer`,
      );
    }
    if (!this.dependencies.fileExists(this.config.python)) {
      throw new Error(
        `RAPP Brainstem Python is missing at ${this.config.python}. Re-run the RAPP installer`,
      );
    }
  }

  private spawnOwned(): OwnedReadyState {
    this.dependencies.makeDirectory(path.dirname(this.config.logFile));
    const logFd = this.dependencies.openLog(this.config.logFile);
    let child: BrainstemChildProcess;
    try {
      child = this.dependencies.spawn({
        command: this.config.python,
        args: ["brainstem.py"],
        cwd: this.config.sourceDir,
        env: createChildEnvironment(
          this.dependencies.environment(),
          this.config.port,
        ),
        logFd,
      });
    } catch (error) {
      this.dependencies.closeLog(logFd);
      throw new Error(
        `Failed to start RAPP Brainstem: ${errorMessage(error)}. See ${this.config.logFile}`,
      );
    }
    return {
      phase: "ready",
      ownership: "owned",
      child,
      observation: observeChild(child),
      logFd,
      disposed: false,
    };
  }

  private async waitForHealth(
    deadlineMs: number,
    signal: AbortSignal,
    owned: OwnedReadyState | null,
  ): Promise<HealthWaitResult> {
    while (true) {
      throwIfAborted(signal);
      const healthy = await this.dependencies.probeHealth(
        this.config.healthUrl,
        signal,
      );
      throwIfAborted(signal);
      if (healthy) {
        return { kind: "healthy" };
      }
      if (owned !== null && owned.observation.error !== null) {
        return {
          kind: "spawn-error",
          error: owned.observation.error,
        };
      }
      if (owned !== null && isChildTerminal(owned.child)) {
        return {
          kind: "terminal",
          exitCode: owned.child.exitCode,
          signalCode: owned.child.signalCode,
        };
      }
      const remainingMs = deadlineMs - this.dependencies.now();
      if (remainingMs <= 0) {
        return { kind: "timeout" };
      }
      await this.waitForWake(
        Math.min(this.timings.healthRetryMs, remainingMs),
        signal,
        owned?.observation ?? null,
      );
    }
  }

  private waitForWake(
    delayMs: number,
    signal: AbortSignal | null,
    observation: ChildObservation | null,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new BrainstemStartupInterruptedError());
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: BrainstemTimer | null = null;
      let unsubscribe = (): void => undefined;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        timer?.cancel();
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const onAbort = (): void => {
        finish(new BrainstemStartupInterruptedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      unsubscribe = observation?.subscribe(() => finish()) ?? unsubscribe;
      timer = this.dependencies.setTimer(() => finish(), delayMs);
      timer.unref();
      if (settled) {
        timer.cancel();
      }
    });
  }

  private async terminateOwned(
    owned: OwnedReadyState,
    disposeRegardless: boolean,
  ): Promise<void> {
    if (!isChildTerminal(owned.child)) {
      try {
        owned.child.kill("SIGTERM");
      } catch {}
      if (!isChildTerminal(owned.child)) {
        await this.waitForWake(
          this.timings.stopTimeoutMs,
          null,
          owned.observation,
        );
      }
    }
    if (!isChildTerminal(owned.child)) {
      try {
        owned.child.kill("SIGKILL");
      } catch {}
      if (!isChildTerminal(owned.child)) {
        await this.waitForWake(
          this.timings.forceStopTimeoutMs,
          null,
          owned.observation,
        );
      }
    }
    if (disposeRegardless || isChildTerminal(owned.child)) {
      this.disposeOwned(owned);
    }
  }

  private disposeOwned(owned: OwnedReadyState): void {
    if (owned.disposed) {
      return;
    }
    owned.disposed = true;
    owned.observation.dispose();
    this.dependencies.closeLog(owned.logFd);
  }

  private waitForSharedOperation(
    operation: Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const onAbort = (): void => {
        finish(new BrainstemStartupInterruptedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void operation.then(
        () => finish(),
        (error) => finish(error),
      );
    });
  }
}

class BrainstemProcessManagerImpl implements BrainstemProcessManager {
  private readonly managed = new Map<string, ManagedBrainstem>();
  private stopAllOperation: Promise<void> | null = null;

  constructor(
    private readonly dependencies: BrainstemProcessDependencies,
    private readonly timings: BrainstemProcessTimings,
  ) {}

  async ensureLocalBrainstem(
    config: RappClientConfig,
    signal: AbortSignal,
  ): Promise<void> {
    if (config.grail !== "consumer") {
      return;
    }
    const address = resolveLocalBrainstemAddress(config.endpoint);
    if (address === null) {
      return;
    }
    let managed = this.managed.get(address.key);
    if (managed === undefined) {
      managed = new ManagedBrainstem(
        resolveBrainstemConfig(address, this.dependencies),
        this.dependencies,
        this.timings,
      );
      this.managed.set(address.key, managed);
    }
    await managed.ensureStarted(signal);
  }

  stopManagedBrainstems(): Promise<void> {
    if (this.stopAllOperation !== null) {
      return this.stopAllOperation;
    }
    const managed = [...this.managed.values()];
    this.managed.clear();
    const operation = Promise.all(
      managed.map((brainstem) => brainstem.stop()),
    ).then(() => undefined);
    const tracked = operation.finally(() => {
      if (this.stopAllOperation === tracked) {
        this.stopAllOperation = null;
      }
    });
    this.stopAllOperation = tracked;
    return tracked;
  }
}

export function createBrainstemProcessManager(
  dependencies: BrainstemProcessDependencies,
  timings: BrainstemProcessTimings = defaultTimings,
): BrainstemProcessManager {
  return new BrainstemProcessManagerImpl(dependencies, timings);
}

const defaultManager = createBrainstemProcessManager(nodeDependencies);

export function ensureLocalBrainstem(
  config: RappClientConfig,
  signal: AbortSignal,
): Promise<void> {
  return defaultManager.ensureLocalBrainstem(config, signal);
}

export function stopManagedBrainstems(): Promise<void> {
  return defaultManager.stopManagedBrainstems();
}
