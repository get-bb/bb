import { describe, expect, it } from "vitest";
import type { RappClientConfig } from "./rapp-client.js";
import {
  canonicalLocalBrainstemKey,
  createBrainstemProcessManager,
  shouldManageLocalBrainstem,
  type BrainstemChildProcess,
  type BrainstemLaunchLock,
  type BrainstemLaunchLockRequest,
  type BrainstemProcessDependencies,
  type BrainstemProcessTimings,
  type BrainstemSpawnRequest,
  type BrainstemTimer,
} from "./brainstem-process.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface FakeLockWaiter {
  active: boolean;
  signal: AbortSignal;
  onAbort(): void;
  resolve(lock: BrainstemLaunchLock): void;
  reject(error: Error): void;
}

const fastTimings: BrainstemProcessTimings = {
  startTimeoutMs: 50,
  healthRetryMs: 5,
  existingHealthGraceMs: 0,
  stopTimeoutMs: 10,
  forceStopTimeoutMs: 5,
};

const recoveryTimings: BrainstemProcessTimings = {
  ...fastTimings,
  existingHealthGraceMs: 10,
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (resolvePromise === null) {
        throw new Error("Deferred promise was not initialized");
      }
      resolvePromise(value);
    },
  };
}

function config(
  endpoint: string,
  grail: RappClientConfig["grail"] = "consumer",
): RappClientConfig {
  const url = new URL(endpoint);
  return {
    grail,
    endpoint: url,
    modelListEndpoint: null,
    modelSetEndpoint: null,
    displayEndpoint: url.toString(),
    headers: {},
    userGuid: null,
    timeoutMs: 1_000,
  };
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(message);
}

function captureRejection(promise: Promise<void>): Promise<Error> {
  return promise.then(
    () => new Error("Expected promise to reject"),
    (error) => (error instanceof Error ? error : new Error(String(error))),
  );
}

class FakeTimer implements BrainstemTimer {
  private active = true;

  constructor(
    private readonly dependencies: FakeDependencies,
    private readonly callback: () => void,
    private readonly delayMs: number,
    autoRun: boolean,
  ) {
    dependencies.addTimer(this);
    if (autoRun) {
      queueMicrotask(() => this.run());
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  cancel(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.dependencies.removeTimer(this);
  }

  unref(): void {}

  run(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.dependencies.removeTimer(this);
    this.dependencies.advanceTime(this.delayMs);
    this.callback();
  }
}

class FakeChild implements BrainstemChildProcess {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killSignals: NodeJS.Signals[] = [];
  autoExitOnKill = true;

  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    if (this.autoExitOnKill) {
      this.emitExit(null, signal);
    }
    return true;
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }
}

class FakeDependencies implements BrainstemProcessDependencies {
  readonly platform: NodeJS.Platform = "darwin";
  readonly spawnRequests: BrainstemSpawnRequest[] = [];
  readonly children: FakeChild[] = [];
  readonly closedLogs: number[] = [];
  readonly openedLogs: string[] = [];
  readonly madeDirectories: string[] = [];
  readonly lockRequests: BrainstemLaunchLockRequest[] = [];
  readonly probeUrls: string[] = [];
  readonly probeSignals: AbortSignal[] = [];
  readonly env: NodeJS.ProcessEnv = {
    BRAINSTEM_HOME: "/brainstem-test",
    HOME: "/home/test",
    PATH: "/usr/bin",
  };
  autoRunTimers = true;
  spawnFailure: Error | null = null;

  private currentTimeMs = 0;
  private nextFd = 20;
  private readonly healthResults: Array<boolean | Promise<boolean>> = [];
  private readonly timers = new Set<FakeTimer>();
  private readonly heldLocks = new Set<string>();
  private readonly lockWaiters = new Map<string, FakeLockWaiter[]>();

  environment(): NodeJS.ProcessEnv {
    return this.env;
  }

  homeDirectory(): string {
    return "/home/test";
  }

  now(): number {
    return this.currentTimeMs;
  }

  advanceTime(delayMs: number): void {
    this.currentTimeMs += delayMs;
  }

  fileExists(): boolean {
    return true;
  }

  makeDirectory(directoryPath: string): void {
    this.madeDirectories.push(directoryPath);
  }

  openLog(filePath: string): number {
    this.openedLogs.push(filePath);
    const fd = this.nextFd;
    this.nextFd += 1;
    return fd;
  }

  closeLog(fd: number): void {
    this.closedLogs.push(fd);
  }

  spawn(request: BrainstemSpawnRequest): BrainstemChildProcess {
    this.spawnRequests.push(request);
    if (this.spawnFailure !== null) {
      throw this.spawnFailure;
    }
    const child = new FakeChild();
    this.children.push(child);
    return child;
  }

  async probeHealth(url: string, signal: AbortSignal): Promise<boolean> {
    this.probeUrls.push(url);
    this.probeSignals.push(signal);
    if (signal.aborted) {
      throw new Error("probe aborted");
    }
    const result = this.healthResults.shift();
    if (result === undefined) {
      throw new Error("No fake health result was queued");
    }
    return result;
  }

  acquireLaunchLock(
    request: BrainstemLaunchLockRequest,
  ): Promise<BrainstemLaunchLock> {
    this.lockRequests.push(request);
    if (request.signal.aborted) {
      return Promise.reject(new Error("lock aborted"));
    }
    if (!this.heldLocks.has(request.lockPath)) {
      this.heldLocks.add(request.lockPath);
      return Promise.resolve(this.createLock(request.lockPath));
    }
    return new Promise<BrainstemLaunchLock>((resolve, reject) => {
      const waiter: FakeLockWaiter = {
        active: true,
        signal: request.signal,
        onAbort: () => {
          if (!waiter.active) {
            return;
          }
          waiter.active = false;
          reject(new Error("lock aborted"));
        },
        resolve,
        reject,
      };
      request.signal.addEventListener("abort", waiter.onAbort, {
        once: true,
      });
      const waiters = this.lockWaiters.get(request.lockPath) ?? [];
      waiters.push(waiter);
      this.lockWaiters.set(request.lockPath, waiters);
    });
  }

  setTimer(callback: () => void, delayMs: number): BrainstemTimer {
    return new FakeTimer(this, callback, delayMs, this.autoRunTimers);
  }

  queueHealth(...results: Array<boolean | Promise<boolean>>): void {
    this.healthResults.push(...results);
  }

  addTimer(timer: FakeTimer): void {
    this.timers.add(timer);
  }

  removeTimer(timer: FakeTimer): void {
    this.timers.delete(timer);
  }

  get activeTimerCount(): number {
    return [...this.timers].filter((timer) => timer.isActive).length;
  }

  private createLock(lockPath: string): BrainstemLaunchLock {
    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) {
          return;
        }
        released = true;
        this.heldLocks.delete(lockPath);
        const waiters = this.lockWaiters.get(lockPath) ?? [];
        while (waiters.length > 0) {
          const waiter = waiters.shift();
          if (waiter === undefined || !waiter.active) {
            continue;
          }
          waiter.active = false;
          waiter.signal.removeEventListener("abort", waiter.onAbort);
          this.heldLocks.add(lockPath);
          waiter.resolve(this.createLock(lockPath));
          break;
        }
        if (waiters.length === 0) {
          this.lockWaiters.delete(lockPath);
        } else {
          this.lockWaiters.set(lockPath, waiters);
        }
      },
    };
  }
}

describe("local Brainstem process lifecycle", () => {
  it("manages only launchable plain-http loopback chat endpoints", async () => {
    const dependencies = new FakeDependencies();
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    expect(
      shouldManageLocalBrainstem(config("http://localhost:7071/chat")),
    ).toBe(true);
    expect(
      shouldManageLocalBrainstem(config("http://127.0.0.1:7071/chat")),
    ).toBe(true);

    const rejected = [
      config("https://localhost:7071/chat"),
      config("http://10.0.0.1:7071/chat"),
      config("http://localhost:7071/custom/chat"),
      config("http://localhost:7071/chat?tenant=test"),
      config("http://user:secret@localhost:7071/chat"),
      config("http://localhost:0/chat"),
      config("http://localhost:7071/chat", "business"),
    ];
    for (const item of rejected) {
      expect(shouldManageLocalBrainstem(item)).toBe(false);
      await manager.ensureLocalBrainstem(item, new AbortController().signal);
    }

    expect(dependencies.lockRequests).toEqual([]);
    expect(dependencies.spawnRequests).toEqual([]);
    expect(dependencies.probeUrls).toEqual([]);
  });

  it("does not auto-manage IPv6 loopback endpoints", async () => {
    const dependencies = new FakeDependencies();
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    const ipv6 = config("http://[::1]:7071/chat");

    expect(canonicalLocalBrainstemKey(ipv6)).toBeNull();
    expect(shouldManageLocalBrainstem(ipv6)).toBe(false);
    await manager.ensureLocalBrainstem(
      ipv6,
      new AbortController().signal,
    );

    expect(dependencies.lockRequests).toEqual([]);
    expect(dependencies.spawnRequests).toEqual([]);
    expect(dependencies.probeUrls).toEqual([]);
  });

  it("canonicalizes launcher-served aliases and shares their concurrent startup", async () => {
    const dependencies = new FakeDependencies();
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    const localhost = config("http://localhost:7071/chat");
    const ipv4 = config("http://127.0.0.1:7071/chat");
    expect(canonicalLocalBrainstemKey(localhost)).toBe(
      canonicalLocalBrainstemKey(ipv4),
    );

    const healthy = createDeferred<boolean>();
    dependencies.queueHealth(false, healthy.promise);
    const first = manager.ensureLocalBrainstem(
      localhost,
      new AbortController().signal,
    );
    const second = manager.ensureLocalBrainstem(
      ipv4,
      new AbortController().signal,
    );
    await waitUntil(
      () => dependencies.children.length === 1,
      "Brainstem child was not spawned",
    );

    expect(dependencies.lockRequests).toHaveLength(1);
    expect(dependencies.spawnRequests).toHaveLength(1);
    healthy.resolve(true);
    await Promise.all([first, second]);
    expect(dependencies.probeUrls).toEqual([
      "http://127.0.0.1:7071/health",
      "http://127.0.0.1:7071/health",
    ]);
    await manager.stopManagedBrainstems();
  });

  it("reuses an already healthy process without taking ownership", async () => {
    const dependencies = new FakeDependencies();
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    dependencies.queueHealth(true);

    await manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      new AbortController().signal,
    );
    await manager.stopManagedBrainstems();

    expect(dependencies.spawnRequests).toEqual([]);
    expect(dependencies.children).toEqual([]);
    expect(dependencies.closedLogs).toEqual([]);
  });

  it("lets each startup waiter abort without cancelling shared startup", async () => {
    const dependencies = new FakeDependencies();
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    const healthy = createDeferred<boolean>();
    dependencies.queueHealth(false, healthy.promise);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      firstController.signal,
    );
    const firstError = captureRejection(first);
    const second = manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      secondController.signal,
    );
    await waitUntil(
      () => dependencies.children.length === 1,
      "Brainstem child was not spawned",
    );

    firstController.abort();
    expect((await firstError).message).toBe(
      "RAPP Brainstem startup was interrupted",
    );
    expect(dependencies.children[0]?.killSignals).toEqual([]);
    expect(
      dependencies.probeSignals.every(
        (signal) => signal !== firstController.signal,
      ),
    ).toBe(true);

    healthy.resolve(true);
    await second;
    expect(dependencies.spawnRequests).toHaveLength(1);
    await manager.stopManagedBrainstems();
  });

  it("preserves living owned and reused processes across transient health misses", async () => {
    const ownedDependencies = new FakeDependencies();
    const ownedManager = createBrainstemProcessManager(
      ownedDependencies,
      recoveryTimings,
    );
    ownedDependencies.queueHealth(false, false, false, true, false, true);
    const ownedConfig = config("http://127.0.0.1:7071/chat");
    await ownedManager.ensureLocalBrainstem(
      ownedConfig,
      new AbortController().signal,
    );
    await ownedManager.ensureLocalBrainstem(
      ownedConfig,
      new AbortController().signal,
    );

    expect(ownedDependencies.spawnRequests).toHaveLength(1);
    expect(ownedDependencies.children[0]?.killSignals).toEqual([]);

    const reusedDependencies = new FakeDependencies();
    const reusedManager = createBrainstemProcessManager(
      reusedDependencies,
      recoveryTimings,
    );
    reusedDependencies.queueHealth(true, false, true);
    const reusedConfig = config("http://127.0.0.1:7072/chat");
    await reusedManager.ensureLocalBrainstem(
      reusedConfig,
      new AbortController().signal,
    );
    await reusedManager.ensureLocalBrainstem(
      reusedConfig,
      new AbortController().signal,
    );

    expect(reusedDependencies.spawnRequests).toEqual([]);
    await Promise.all([
      ownedManager.stopManagedBrainstems(),
      reusedManager.stopManagedBrainstems(),
    ]);
  });

  it("re-probes under the launch lock and reuses a winning process", async () => {
    const dependencies = new FakeDependencies();
    const firstManager = createBrainstemProcessManager(
      dependencies,
      fastTimings,
    );
    const secondManager = createBrainstemProcessManager(
      dependencies,
      fastTimings,
    );
    const winnerHealthy = createDeferred<boolean>();
    dependencies.queueHealth(false, winnerHealthy.promise, true);
    const localConfig = config("http://127.0.0.1:7071/chat");
    const first = firstManager.ensureLocalBrainstem(
      localConfig,
      new AbortController().signal,
    );
    await waitUntil(
      () => dependencies.children.length === 1,
      "Winning Brainstem child was not spawned",
    );
    const second = secondManager.ensureLocalBrainstem(
      localConfig,
      new AbortController().signal,
    );
    await waitUntil(
      () => dependencies.lockRequests.length === 2,
      "Losing manager did not wait for the launch lock",
    );

    winnerHealthy.resolve(true);
    await Promise.all([first, second]);

    expect(dependencies.lockRequests).toHaveLength(2);
    expect(dependencies.spawnRequests).toHaveLength(1);
    await Promise.all([
      firstManager.stopManagedBrainstems(),
      secondManager.stopManagedBrainstems(),
    ]);
  });

  it("scrubs remote RAPP settings while preserving Copilot environment", async () => {
    const dependencies = new FakeDependencies();
    Object.assign(dependencies.env, {
      GH_TOKEN: "gh-token",
      GITHUB_TOKEN: "github-token",
      COPILOT_TOKEN: "copilot-token",
      RAPP_BRAINSTEM_URL: "https://remote.example/chat",
      RAPP_BRAINSTEM_SECRET: "brainstem-secret",
      RAPP_BUSINESS_URL: "https://business.example/api",
      RAPP_FUNCTION_KEY: "function-key",
      RAPP_USER_GUID: "user-guid",
    });
    dependencies.queueHealth(false, true);
    const manager = createBrainstemProcessManager(dependencies, fastTimings);

    await manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      new AbortController().signal,
    );

    const request = dependencies.spawnRequests[0];
    expect(request?.env).toMatchObject({
      BRAINSTEM_HOME: "/brainstem-test",
      HOME: "/home/test",
      PATH: "/usr/bin",
      GH_TOKEN: "gh-token",
      GITHUB_TOKEN: "github-token",
      COPILOT_TOKEN: "copilot-token",
      PORT: "7071",
      BRAINSTEM_BB_LAUNCHER: "1",
      PYTHONUTF8: "1",
    });
    expect(request?.env.RAPP_BRAINSTEM_URL).toBeUndefined();
    expect(request?.env.RAPP_BRAINSTEM_SECRET).toBeUndefined();
    expect(request?.env.RAPP_BUSINESS_URL).toBeUndefined();
    expect(request?.env.RAPP_FUNCTION_KEY).toBeUndefined();
    expect(request?.env.RAPP_USER_GUID).toBeUndefined();
    expect(dependencies.env.RAPP_FUNCTION_KEY).toBe("function-key");
    await manager.stopManagedBrainstems();
  });

  it("handles asynchronous spawn errors and closes owned resources", async () => {
    const dependencies = new FakeDependencies();
    const pendingHealth = createDeferred<boolean>();
    dependencies.queueHealth(false, pendingHealth.promise);
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    const startup = manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      new AbortController().signal,
    );
    const startupError = captureRejection(startup);
    await waitUntil(
      () => dependencies.children.length === 1,
      "Brainstem child was not spawned",
    );

    dependencies.children[0]?.emitError(new Error("spawn EACCES"));
    pendingHealth.resolve(false);
    expect((await startupError).message).toContain("spawn EACCES");
    expect(dependencies.children[0]?.killSignals).toEqual([]);
    expect(dependencies.closedLogs).toEqual([20]);
    expect(dependencies.activeTimerCount).toBe(0);
    await manager.stopManagedBrainstems();
  });

  it("closes the log when spawning throws synchronously", async () => {
    const dependencies = new FakeDependencies();
    dependencies.spawnFailure = new Error("spawn failed");
    dependencies.queueHealth(false);
    const manager = createBrainstemProcessManager(dependencies, fastTimings);

    await expect(
      manager.ensureLocalBrainstem(
        config("http://127.0.0.1:7071/chat"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("spawn failed");
    expect(dependencies.children).toEqual([]);
    expect(dependencies.closedLogs).toEqual([20]);
    await manager.stopManagedBrainstems();
  });

  it("recognizes signal exits and cancels pending wait timers", async () => {
    const dependencies = new FakeDependencies();
    dependencies.autoRunTimers = false;
    dependencies.queueHealth(false, false, false);
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    const startup = manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      new AbortController().signal,
    );
    const startupError = captureRejection(startup);
    await waitUntil(
      () => dependencies.activeTimerCount === 1,
      "Health retry timer was not scheduled",
    );

    dependencies.children[0]?.emitExit(null, "SIGTERM");
    const error = await startupError;
    expect(error.message).toContain("signal SIGTERM");
    expect(dependencies.activeTimerCount).toBe(0);
    expect(dependencies.closedLogs).toEqual([20]);
  });

  it("stops only owned children and remains idempotent", async () => {
    const dependencies = new FakeDependencies();
    dependencies.queueHealth(true, false, true);
    const manager = createBrainstemProcessManager(dependencies, fastTimings);
    await manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7071/chat"),
      new AbortController().signal,
    );
    await manager.ensureLocalBrainstem(
      config("http://127.0.0.1:7072/chat"),
      new AbortController().signal,
    );

    await Promise.all([
      manager.stopManagedBrainstems(),
      manager.stopManagedBrainstems(),
    ]);
    await manager.stopManagedBrainstems();

    expect(dependencies.spawnRequests).toHaveLength(1);
    expect(dependencies.children[0]?.killSignals).toEqual(["SIGTERM"]);
    expect(dependencies.closedLogs).toEqual([20]);
    expect(dependencies.activeTimerCount).toBe(0);
  });
});
