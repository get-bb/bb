import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppUpdateLauncherRequest,
  LauncherAppUpdateStatus,
  ServerToLauncherMessage,
  SourceUpdateCheck,
} from "@bb/config/app-update";
import type { SystemVersionResponse } from "@bb/server-contract";
import { ApiError } from "../../src/errors.js";
import { createAppUpdateService } from "../../src/services/system/app-update.js";
import {
  AUTO_UPDATE_CHECK_MS,
  AUTO_UPDATE_IDLE_MS,
  createScheduledAppUpdateService,
} from "../../src/services/system/app-update-schedule.js";
import type { ServerChangedMessage } from "../../src/ws/hub.js";
import type { AppVersionService } from "../../src/services/system/app-version.js";
import {
  createLauncherChannel,
  type LauncherChannel,
} from "../../src/services/system/launcher-channel.js";
import { testLogger } from "../helpers/test-app.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function appVersion(
  response: Partial<SystemVersionResponse>,
): AppVersionService {
  return {
    async getSystemVersion() {
      return {
        currentVersion: "1.0.0",
        isDevelopment: false,
        latestVersion: "1.1.0",
        currentCommit: null,
        installKind: "npm",
        source: "npm",
        updateAvailable: true,
        upgradeCommand: "npx bb-app@latest",
        ...response,
      };
    },
  };
}

class FakeLauncher implements LauncherChannel {
  readonly requests: AppUpdateLauncherRequest[] = [];
  private listeners = new Set<(status: LauncherAppUpdateStatus) => void>();
  private disconnectListeners = new Set<() => void>();
  respond: (request: AppUpdateLauncherRequest) => Promise<unknown> = async () =>
    null;

  dispose(): void {
    this.listeners.clear();
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  disconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }

  onStatus(listener: (status: LauncherAppUpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(request: AppUpdateLauncherRequest): Promise<unknown> {
    this.requests.push(request);
    return this.respond(request);
  }

  push(status: Partial<LauncherAppUpdateStatus>): void {
    for (const listener of this.listeners) {
      listener({
        activity: { phase: "idle" },
        current: { kind: "npm", packageRoot: "/pkg/1.0.0", version: "1.0.0" },
        lastResult: null,
        mode: "npm",
        ...status,
      });
    }
  }
}

function recordingSendHold() {
  const events: string[] = [];
  return {
    events,
    sendHold: {
      hold: () => events.push("hold"),
      release: () => events.push("release"),
    },
  };
}

function sourceCheck(
  overrides: Partial<SourceUpdateCheck> = {},
): SourceUpdateCheck {
  return {
    blocked: null,
    current: { commit: COMMIT_A, kind: "source", version: "1.0.0" },
    incoming: {
      behindSince: "2026-11-02T12:00:00.000Z",
      commit: COMMIT_B,
      commitCount: 2,
      subjects: ["Fix bug", "Add feature"],
      version: "1.0.0",
    },
    ...overrides,
  };
}

function createService(args: {
  appSurface?: "desktop" | "web";
  isDevelopment?: boolean;
  launcher?: FakeLauncher | null;
  mode?: "npm" | "source" | null;
  now?: () => number;
  runningThreads?: number;
  threadsResume?: boolean;
  version?: Partial<SystemVersionResponse>;
}) {
  const notifyChanged = vi.fn();
  const launcher =
    args.launcher === undefined ? new FakeLauncher() : args.launcher;
  const service = createAppUpdateService({
    currentCommit: null,
    appSurface: args.appSurface ?? "web",
    appVersion: appVersion(args.version ?? {}),
    config: { appVersion: "1.0.0", isDevelopment: args.isDevelopment ?? false },
    countRunningThreads: () => args.runningThreads ?? 0,
    launcher,
    logger: testLogger,
    mode: args.mode === undefined ? "npm" : args.mode,
    notifyChanged,
    ...(args.now === undefined ? {} : { now: args.now }),
    threadsResumeAfterRestart: () => args.threadsResume ?? false,
    sendHold: recordingSendHold().sendHold,
  });
  launcher?.push({});
  return { launcher, notifyChanged, service };
}

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) throw new Error("expected ApiError");
  expect(error.body.code).toBe(code);
  return error;
}

describe("app update service", () => {
  it.each([
    [{ isDevelopment: true }, "development"],
    [{ appSurface: "desktop" as const }, "desktop"],
    [{ appSurface: "desktop" as const, isDevelopment: true }, "desktop"],
    [{ mode: null }, "unmanaged"],
    [{ launcher: null }, "unmanaged"],
  ])("reports updates as unsupported for %o", async (overrides, reason) => {
    const { service } = createService(overrides);

    const status = await service.getStatus({ forceRefresh: false });

    expect(status.support).toEqual({ kind: "unsupported", reason });
    expect(status.available).toBeNull();
    await expectApiError(
      service.apply({ runningThreads: { kind: "interrupt" } }),
      "app_update_unsupported",
    );
  });

  it("keeps a failed npm lookup distinct from an up-to-date install", async () => {
    const { service } = createService({
      version: { latestVersion: null, updateAvailable: false },
    });
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.available).toBeNull();
    expect(status.blocked).toMatchObject({ reason: "fetch-failed" });
  });

  it("does not report a source checkout as current before its first check completes", async () => {
    const launcher = new FakeLauncher();
    const { service } = createService({ launcher, mode: "source" });
    const status = await service.getStatus({ forceRefresh: false });
    expect(status.available).toBeNull();
    expect(status.blocked).toMatchObject({ reason: "fetch-failed" });
  });

  it("offers the npm latest version on the stable channel", async () => {
    const { service } = createService({});

    const status = await service.getStatus({ forceRefresh: false });

    expect(status.support).toEqual({ kind: "supported", mode: "npm" });
    expect(status.available).toEqual({
      behindSince: null,
      channel: "latest",
      commit: null,
      commitCount: null,
      subjects: [],
      version: "1.1.0",
    });
  });

  it("asks before interrupting running threads and sends the target once confirmed", async () => {
    const { launcher, service } = createService({ runningThreads: 2 });

    const error = await expectApiError(
      service.apply({ runningThreads: { kind: "refuse" } }),
      "threads_running",
    );
    expect(error.body.details).toEqual({ runningThreadCount: 2 });
    expect(error.message).toBe(
      "2 threads are running. Updating restarts bb and interrupts them.",
    );
    expect(launcher?.requests).toEqual([]);

    await service.apply({ runningThreads: { kind: "interrupt" } });
    expect(launcher?.requests).toEqual([
      {
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
        type: "apply",
      },
    ]);
  });

  it("says running threads resume after the update when restarts resume them", async () => {
    const { service } = createService({
      runningThreads: 1,
      threadsResume: true,
    });

    const error = await expectApiError(
      service.apply({ runningThreads: { kind: "refuse" } }),
      "threads_running",
    );
    expect(error.message).toBe(
      "1 thread is running. Updating restarts bb, and it resumes after the update.",
    );
  });

  it("rejects an update when bb is already current", async () => {
    const { service } = createService({
      version: { latestVersion: "1.0.0", updateAvailable: false },
    });

    await expectApiError(
      service.apply({ runningThreads: { kind: "interrupt" } }),
      "app_update_unavailable",
    );
  });

  it("rejects an update while one is running", async () => {
    const { launcher, service } = createService({});
    launcher?.push({
      activity: {
        output: [],
        phase: "preparing",
        startedAt: "2026-09-23T00:00:00.000Z",
        step: "Downloading bb-app 1.1.0",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
    });
    await expectApiError(
      service.apply({ runningThreads: { kind: "interrupt" } }),
      "app_update_in_progress",
    );
  });

  it("surfaces launcher rejections as conflicts", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async () => {
      throw new Error("This bb updates through npm, not source.");
    };
    const { service } = createService({ launcher });

    const error = await expectApiError(
      service.apply({ runningThreads: { kind: "interrupt" } }),
      "app_update_rejected",
    );
    expect(error.body.message).toContain("not source");
  });

  it.each([
    { kind: "npm" as const, version: "1.1.0" },
    { kind: "source" as const, commit: "b".repeat(40) },
  ])("maps $kind launcher status into activity and result", async (target) => {
    const { launcher, notifyChanged, service } = createService({});
    notifyChanged.mockClear();

    launcher?.push({
      activity: {
        phase: "restarting",
        startedAt: "2026-09-23T00:00:00.000Z",
        target,
        targetVersion: "1.1.0",
      },
      lastResult: {
        acknowledged: false,
        finishedAt: "2026-09-23T00:00:00.000Z",
        from: { kind: "npm", packageRoot: "/pkg/0.9.0", version: "0.9.0" },
        id: "result-1",
        logTail: ["boom"],
        message: "npm install failed",
        outcome: "failed",
        phase: "install",
        to: { kind: "npm", packageRoot: "/pkg/1.0.0", version: "1.0.0" },
      },
    });
    const status = await service.getStatus({ forceRefresh: false });

    expect(notifyChanged).toHaveBeenCalledOnce();
    expect(status.activity).toEqual({
      phase: "restarting",
      startedAt: "2026-09-23T00:00:00.000Z",
      targetCommit: target.kind === "source" ? "b".repeat(40) : null,
      targetVersion: "1.1.0",
    });
    expect(status.lastResult).toMatchObject({
      from: { commit: null, version: "0.9.0" },
      outcome: "failed",
    });
  });

  it("offers origin/main in source mode and reports why it is blocked", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async () =>
      sourceCheck({
        blocked: {
          message: "The working tree has uncommitted changes.",
          reason: "uncommitted-changes",
        },
      });
    const { service } = createService({ launcher, mode: "source" });
    launcher.push({
      current: { commit: COMMIT_A, kind: "source", version: "1.0.0" },
      mode: "source",
    });

    const status = await service.getStatus({ forceRefresh: true });

    expect(status.current).toEqual({ commit: COMMIT_A, version: "1.0.0" });
    expect(status.available).toMatchObject({
      behindSince: "2026-11-02T12:00:00.000Z",
      channel: "main",
      commit: COMMIT_B,
      commitCount: 2,
    });
    expect(status.blocked?.reason).toBe("uncommitted-changes");
    await expectApiError(
      service.apply({ runningThreads: { kind: "interrupt" } }),
      "app_update_blocked",
    );
  });

  it("checks origin/main in the background without blocking unforced reads", async () => {
    const launcher = new FakeLauncher();
    let resolveCheck: (value: SourceUpdateCheck) => void = () => undefined;
    launcher.respond = () =>
      new Promise((resolvePromise) => {
        resolveCheck = resolvePromise;
      });
    let now = 0;
    const { notifyChanged, service } = createService({
      launcher,
      mode: "source",
      now: () => now,
    });
    notifyChanged.mockClear();

    const first = await service.getStatus({ forceRefresh: false });
    expect(first.available).toBeNull();
    expect(launcher.requests).toHaveLength(1);

    resolveCheck(sourceCheck());
    await vi.waitFor(() => expect(notifyChanged).toHaveBeenCalledOnce());
    const second = await service.getStatus({ forceRefresh: false });
    expect(second.available?.commit).toBe(COMMIT_B);
    expect(launcher.requests).toHaveLength(1);

    now = 61 * 60 * 1000;
    await service.getStatus({ forceRefresh: false });
    expect(launcher.requests).toHaveLength(2);
  });

  it("does not loop background checks when the launcher check keeps failing", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async () => {
      throw new Error("git fetch failed");
    };
    const { notifyChanged, service } = createService({
      launcher,
      mode: "source",
    });

    await service.getStatus({ forceRefresh: false });
    await vi.waitFor(() => expect(notifyChanged).toHaveBeenCalled());
    await service.getStatus({ forceRefresh: false });
    await service.getStatus({ forceRefresh: false });

    expect(launcher.requests).toHaveLength(1);
  });

  it("restarts a staged update once no unconfirmed threads are running", async () => {
    let runningThreads = 0;
    const launcher = new FakeLauncher();
    const service = createAppUpdateService({
      currentCommit: null,
      appSurface: "web",
      appVersion: appVersion({}),
      config: { appVersion: "1.0.0", isDevelopment: false },
      countRunningThreads: () => runningThreads,
      launcher,
      logger: testLogger,
      mode: "npm",
      notifyChanged: vi.fn(),
      threadsResumeAfterRestart: () => false,
      sendHold: recordingSendHold().sendHold,
    });
    launcher.push({});
    await service.apply({ runningThreads: { kind: "refuse" } });

    runningThreads = 1;
    launcher.push({
      activity: {
        phase: "ready",
        startedAt: "2026-09-23T00:00:00.000Z",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
    });
    launcher.push({
      activity: {
        phase: "ready",
        startedAt: "2026-09-23T00:00:00.000Z",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
    });

    expect(launcher.requests.slice(1)).toEqual([
      {
        message:
          "1 thread started while bb was downloading the update. Update again to restart.",
        type: "cancel",
      },
    ]);

    launcher.push({});
    await service.apply({ runningThreads: { kind: "interrupt" } });
    launcher.push({
      activity: {
        phase: "ready",
        startedAt: "2026-09-23T00:05:00.000Z",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
    });
    expect(launcher.requests.at(-1)).toEqual({ type: "restart" });
  });

  it("holds new sends from the restart decision until bb restarts, and releases them when it does not", async () => {
    let runningThreads = 0;
    const { events, sendHold } = recordingSendHold();
    const launcher = new FakeLauncher();
    const service = createAppUpdateService({
      currentCommit: null,
      appSurface: "web",
      appVersion: appVersion({}),
      config: { appVersion: "1.0.0", isDevelopment: false },
      countRunningThreads: () => {
        events.push("count");
        return runningThreads;
      },
      launcher,
      logger: testLogger,
      mode: "npm",
      notifyChanged: vi.fn(),
      sendHold,
      threadsResumeAfterRestart: () => false,
    });
    const ready = (startedAt: string) =>
      launcher.push({
        activity: {
          phase: "ready",
          startedAt,
          target: { kind: "npm", version: "1.1.0" },
          targetVersion: "1.1.0",
        },
      });
    launcher.push({});

    await service.apply({ runningThreads: { kind: "refuse" } });
    events.length = 0;
    ready("2026-09-23T00:00:00.000Z");
    launcher.push({
      activity: {
        phase: "restarting",
        startedAt: "2026-09-23T00:00:00.000Z",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
    });
    expect(launcher.requests.at(-1)).toEqual({ type: "restart" });
    expect(events).toEqual(["hold", "count"]);

    launcher.push({});
    expect(events).toEqual(["hold", "count", "release"]);

    await service.apply({ runningThreads: { kind: "refuse" } });
    runningThreads = 1;
    events.length = 0;
    ready("2026-09-23T00:05:00.000Z");
    expect(launcher.requests.at(-1)).toMatchObject({ type: "cancel" });
    expect(events).toEqual(["hold", "count", "release"]);

    launcher.push({});
    runningThreads = 0;
    await service.apply({
      runningThreads: { kind: "wait", shouldDefer: (count) => count > 0 },
    });
    runningThreads = 1;
    events.length = 0;
    ready("2026-09-23T00:10:00.000Z");
    expect(launcher.requests.at(-1)).toEqual({ type: "defer" });
    expect(events).toEqual(["hold", "count", "release"]);

    launcher.push({});
    runningThreads = 0;
    launcher.respond = async (request) => {
      if (request.type === "restart") throw new Error("launcher went away");
      return null;
    };
    await service.apply({ runningThreads: { kind: "refuse" } });
    events.length = 0;
    ready("2026-09-23T00:15:00.000Z");
    await vi.waitFor(() =>
      expect(events).toEqual(["hold", "count", "release"]),
    );
  });

  it("stops offering updates once the launcher disconnects", async () => {
    const { launcher, notifyChanged, service } = createService({});
    notifyChanged.mockClear();

    launcher?.disconnect();

    expect(notifyChanged).toHaveBeenCalledOnce();
    expect((await service.getStatus({ forceRefresh: false })).support).toEqual({
      kind: "unsupported",
      reason: "unmanaged",
    });
  });

  it("reports a launcher that rejects an acknowledgement as a conflict", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async () => {
      throw new Error("The bb-app launcher did not respond.");
    };
    const { service } = createService({ launcher });

    await expectApiError(
      service.acknowledgeResult({ id: "result-1" }),
      "app_update_rejected",
    );
  });

  it("re-checks origin/main before applying a source update", async () => {
    const launcher = new FakeLauncher();
    const checks = [
      sourceCheck(),
      sourceCheck({
        incoming: {
          behindSince: "2026-11-02T12:00:00.000Z",
          commit: "c".repeat(40),
          commitCount: 3,
          subjects: [],
          version: "1.0.0",
        },
      }),
    ];
    launcher.respond = async (request) =>
      request.type === "check-source" ? checks.shift() : null;
    const { service } = createService({ launcher, mode: "source" });
    await service.getStatus({ forceRefresh: true });

    await service.apply({ runningThreads: { kind: "refuse" } });

    expect(launcher.requests.at(-1)).toMatchObject({
      target: { commit: "c".repeat(40), kind: "source" },
      type: "apply",
    });
  });
});

const READY_STATUS = {
  activity: {
    phase: "ready",
    startedAt: "2026-10-23T00:00:00.000Z",
    target: { kind: "npm", version: "1.1.0" },
    targetVersion: "1.1.0",
  },
} satisfies Partial<LauncherAppUpdateStatus>;

const PREPARING_STATUS = {
  activity: {
    output: [],
    phase: "preparing",
    startedAt: "2026-10-23T00:00:00.000Z",
    step: "Downloading bb-app 1.1.0",
    target: { kind: "npm", version: "1.1.0" },
    targetVersion: "1.1.0",
  },
} satisfies Partial<LauncherAppUpdateStatus>;

function createScheduledService(args: {
  autoCheck?: boolean;
  runningThreads: number;
}) {
  const running = { count: args.runningThreads };
  const experiment = { enabled: true };
  const latest = { version: "1.1.0" };
  const skipped = { key: null as string | null };
  const auto = { enabled: args.autoCheck === true };
  const countRunningThreads = vi.fn(() => running.count);
  const listeners = new Set<(message: ServerChangedMessage) => void>();
  const launcher = new FakeLauncher();
  const inner = createAppUpdateService({
    currentCommit: null,
    appSurface: "web",
    appVersion: {
      getSystemVersion: async () =>
        await appVersion({
          latestVersion: latest.version,
          updateAvailable: latest.version !== "1.0.0",
        }).getSystemVersion({ forceRefresh: true }),
    },
    config: { appVersion: "1.0.0", isDevelopment: false },
    countRunningThreads: () => running.count,
    launcher,
    logger: testLogger,
    mode: "npm",
    notifyChanged: vi.fn(),
    threadsResumeAfterRestart: () => false,
    sendHold: recordingSendHold().sendHold,
  });
  launcher.push({});
  const notifyChanged = vi.fn();
  const service = createScheduledAppUpdateService({
    autoCheckMs: args.autoCheck === true ? AUTO_UPDATE_CHECK_MS : null,
    autoUpdate: {
      get: () => auto.enabled,
      set: (enabled) => {
        auto.enabled = enabled;
      },
    },
    countRunningThreads,
    inner,
    isEnabled: () => experiment.enabled,
    logger: testLogger,
    notifyChanged,
    now: () => new Date("2026-10-23T00:00:00.000Z"),
    onChangedMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settleMs: 5_000,
    skippedUpdate: {
      get: () => skipped.key,
      set: (key) => {
        skipped.key = key;
      },
    },
  });
  const emitThreadChange = (): void => {
    for (const listener of listeners) {
      listener({
        changes: ["status-changed"],
        entity: "thread",
        id: "thr_1",
        type: "changed",
      });
    }
  };
  const setRunningThreads = (count: number): void => {
    running.count = count;
    for (const listener of listeners) {
      listener({
        changes: ["status-changed"],
        entity: "thread",
        id: "thr_1",
        type: "changed",
      });
    }
  };
  const setExperimentEnabled = (enabled: boolean): void => {
    experiment.enabled = enabled;
    for (const listener of listeners) {
      listener({
        changes: ["config-changed"],
        entity: "system",
        type: "changed",
      });
    }
  };
  const applyRequests = () =>
    launcher.requests.filter((request) => request.type === "apply");
  return {
    applyRequests,
    auto,
    countRunningThreads,
    emitThreadChange,
    latest,
    launcher,
    notifyChanged,
    service,
    setExperimentEnabled,
    setRunningThreads,
    skipped,
  };
}

function failedResult(version: string): Partial<LauncherAppUpdateStatus> {
  return {
    lastResult: {
      acknowledged: true,
      finishedAt: "2026-10-23T00:00:00.000Z",
      from: { kind: "npm", packageRoot: "/pkg/1.0.0", version: "1.0.0" },
      id: "result-1",
      logTail: [],
      message: "npm install failed",
      outcome: "failed",
      phase: "prepare",
      to: { kind: "npm", packageRoot: `/pkg/${version}`, version },
    },
  };
}

describe("checking for bb updates automatically", () => {
  const { first, interval } = AUTO_UPDATE_CHECK_MS;
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const scheduledAt = async (
    service: ReturnType<typeof createScheduledService>["service"],
  ) => (await service.getStatus({ forceRefresh: false })).scheduled;

  it("checks 30 seconds after boot and every hour, and updates once no thread has run for 15 minutes", async () => {
    const { applyRequests, latest, launcher, service, setRunningThreads } =
      createScheduledService({ autoCheck: true, runningThreads: 1 });
    latest.version = "1.0.0";

    await vi.advanceTimersByTimeAsync(first);
    expect(await scheduledAt(service)).toBeNull();

    latest.version = "1.1.0";
    await vi.advanceTimersByTimeAsync(interval - first - 1_000);
    expect(await scheduledAt(service)).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await scheduledAt(service)).not.toBeNull();
    expect(applyRequests()).toEqual([]);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS - 1_000);
    expect(applyRequests()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(applyRequests()).toEqual([
      {
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
        type: "apply",
      },
    ]);
    launcher.push(READY_STATUS);
    expect(launcher.requests.at(-1)).toEqual({ type: "restart" });
  });

  it("restarts the 15-minute wait whenever a thread runs between turns", async () => {
    const { applyRequests, service, setRunningThreads } =
      createScheduledService({ autoCheck: true, runningThreads: 1 });
    await vi.advanceTimersByTimeAsync(first);
    expect((await scheduledAt(service))?.requiredIdleMs).toBe(
      AUTO_UPDATE_IDLE_MS,
    );

    for (let turn = 0; turn < 5; turn += 1) {
      setRunningThreads(0);
      await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS - 60_000);
      setRunningThreads(1);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(applyRequests()).toEqual([]);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS);
    expect(applyRequests()).toHaveLength(1);
  });

  it("counts idle time from when the last thread finished, not from when the update was found", async () => {
    const { applyRequests, latest, setRunningThreads } = createScheduledService(
      { autoCheck: true, runningThreads: 1 },
    );
    latest.version = "1.0.0";
    await vi.advanceTimersByTimeAsync(first);
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_MS - 60_000);

    latest.version = "1.1.0";
    await vi.advanceTimersByTimeAsync(interval - AUTO_UPDATE_IDLE_MS + 60_000);
    expect(applyRequests()).toHaveLength(1);
  });

  it("waits only a few seconds once someone asks for the waiting automatic update", async () => {
    const { applyRequests, service, setRunningThreads } =
      createScheduledService({ autoCheck: true, runningThreads: 1 });
    await vi.advanceTimersByTimeAsync(first);

    const status = await service.schedule();
    expect(status.scheduled?.requiredIdleMs).toBe(5_000);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyRequests()).toHaveLength(1);
  });

  it("does not check while the experiment is off", async () => {
    const { applyRequests, service, setExperimentEnabled } =
      createScheduledService({ autoCheck: true, runningThreads: 0 });
    setExperimentEnabled(false);

    await vi.advanceTimersByTimeAsync(first + interval);

    expect(applyRequests()).toEqual([]);
    expect(await scheduledAt(service)).toBeNull();
  });

  it("checks only while automatic updates are on, and turning them off drops the waiting update", async () => {
    const { applyRequests, auto, service, setRunningThreads } =
      createScheduledService({ autoCheck: true, runningThreads: 1 });
    auto.enabled = false;

    await vi.advanceTimersByTimeAsync(first + interval);
    expect(await scheduledAt(service)).toBeNull();

    expect((await service.setAutoUpdate(true)).autoUpdate).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(await scheduledAt(service)).not.toBeNull();

    await service.setAutoUpdate(false);
    expect(await scheduledAt(service)).toBeNull();
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(first + interval);
    expect(await scheduledAt(service)).toBeNull();
    expect(applyRequests()).toEqual([]);
  });

  it("skips a version whose update failed until a newer one appears", async () => {
    const { applyRequests, latest, launcher } = createScheduledService({
      autoCheck: true,
      runningThreads: 0,
    });
    launcher.push(failedResult("1.1.0"));

    await vi.advanceTimersByTimeAsync(first + interval);
    expect(applyRequests()).toEqual([]);

    latest.version = "1.2.0";
    await vi.advanceTimersByTimeAsync(interval);
    expect(applyRequests()).toEqual([
      expect.objectContaining({ targetVersion: "1.2.0" }),
    ]);
  });

  it("skips a cancelled version until a newer one appears", async () => {
    const { applyRequests, latest, service, skipped } = createScheduledService({
      autoCheck: true,
      runningThreads: 1,
    });

    await vi.advanceTimersByTimeAsync(first);
    expect(await scheduledAt(service)).not.toBeNull();
    await service.cancelScheduled();
    expect(skipped.key).toBe("1.1.0");

    await vi.advanceTimersByTimeAsync(2 * interval);
    expect(await scheduledAt(service)).toBeNull();

    latest.version = "1.2.0";
    await vi.advanceTimersByTimeAsync(interval);
    expect(await scheduledAt(service)).not.toBeNull();
    expect(applyRequests()).toEqual([]);
  });
});

describe("app update scheduled for when threads finish", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for running threads to stay finished before starting the update", async () => {
    const { applyRequests, service, setRunningThreads } =
      createScheduledService({ runningThreads: 2 });

    const scheduled = await service.schedule();

    expect(scheduled.scheduled).toEqual({
      requestedAt: "2026-10-23T00:00:00.000Z",
      requiredIdleMs: 5_000,
    });
    expect(applyRequests()).toEqual([]);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(4_000);
    setRunningThreads(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyRequests()).toEqual([]);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(applyRequests()).toHaveLength(1);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).toBeNull();
  });

  it("keeps reporting the schedule while its start waits on the launcher", async () => {
    const { applyRequests, launcher, service, setRunningThreads } =
      createScheduledService({ runningThreads: 1 });
    await service.schedule();
    let accept = (): void => undefined;
    launcher.respond = (request) =>
      request.type === "apply"
        ? new Promise((resolvePromise) => {
            accept = () => resolvePromise(null);
          })
        : Promise.resolve(null);

    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(applyRequests()).toHaveLength(1);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).toEqual({
      requestedAt: "2026-10-23T00:00:00.000Z",
      requiredIdleMs: 5_000,
    });
    accept();
    await vi.advanceTimersByTimeAsync(0);
    launcher.push(PREPARING_STATUS);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).not.toBeNull();
  });

  it("tells clients the running thread count changed while it waits", async () => {
    const { notifyChanged, service, setRunningThreads } =
      createScheduledService({ runningThreads: 2 });
    await service.schedule();
    notifyChanged.mockClear();

    setRunningThreads(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(notifyChanged).toHaveBeenCalled();
    expect(
      (await service.getStatus({ forceRefresh: false })).runningThreadCount,
    ).toBe(1);
  });

  it("reads the running thread count once for a burst of thread changes", async () => {
    const { countRunningThreads, emitThreadChange, service } =
      createScheduledService({ runningThreads: 3 });
    await service.schedule();
    countRunningThreads.mockClear();

    emitThreadChange();
    emitThreadChange();
    emitThreadChange();
    await vi.advanceTimersByTimeAsync(0);

    expect(countRunningThreads).toHaveBeenCalledTimes(1);
  });

  it("drops a waiting update when the experiment is turned off", async () => {
    const { applyRequests, service, setExperimentEnabled, setRunningThreads } =
      createScheduledService({ runningThreads: 1 });
    await service.schedule();

    setExperimentEnabled(false);
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(applyRequests()).toEqual([]);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).toBeNull();
  });

  it("starts at once when no thread is running", async () => {
    const { applyRequests, service } = createScheduledService({
      runningThreads: 0,
    });

    const status = await service.schedule();

    expect(status.scheduled).toBeNull();
    expect(applyRequests()).toHaveLength(1);
  });

  it("goes back to waiting when a thread starts while the update downloads", async () => {
    const { applyRequests, launcher, service, setRunningThreads } =
      createScheduledService({ runningThreads: 0 });
    await service.schedule();

    setRunningThreads(1);
    launcher.push(READY_STATUS);

    expect(launcher.requests.at(-1)).toEqual({ type: "defer" });
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).not.toBeNull();

    launcher.push({});
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyRequests()).toHaveLength(2);

    launcher.push({
      activity: {
        ...READY_STATUS.activity,
        startedAt: "2026-10-23T00:01:00.000Z",
      },
    });
    expect(launcher.requests.at(-1)).toEqual({ type: "restart" });
  });

  it("stops a scheduled update that is already downloading when cancelled", async () => {
    const { applyRequests, launcher, service, setRunningThreads } =
      createScheduledService({ runningThreads: 0 });
    await service.schedule();
    launcher.push(PREPARING_STATUS);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).not.toBeNull();

    await service.cancelScheduled();
    launcher.push(READY_STATUS);

    expect(launcher.requests.at(-1)).toEqual({ type: "defer" });
    launcher.push({});
    setRunningThreads(1);
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyRequests()).toHaveLength(1);
    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).toBeNull();
  });

  it("keeps one scheduled update when it is requested again mid-download", async () => {
    const { applyRequests, launcher, service, setRunningThreads } =
      createScheduledService({ runningThreads: 0 });
    await service.schedule();
    launcher.push(PREPARING_STATUS);

    const again = await service.schedule();
    expect(again.scheduled).not.toBeNull();
    expect(applyRequests()).toHaveLength(1);

    setRunningThreads(1);
    launcher.push(READY_STATUS);
    expect(launcher.requests.at(-1)).toEqual({ type: "defer" });
    launcher.push({});
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(applyRequests()).toHaveLength(2);
  });

  it("lets a hand-started update keep its thread policy when the schedule comes due", async () => {
    const { applyRequests, launcher, service, setRunningThreads } =
      createScheduledService({ runningThreads: 1 });
    await service.schedule();
    let accept = (): void => undefined;
    launcher.respond = (request) =>
      request.type === "apply"
        ? new Promise((resolvePromise) => {
            accept = () => resolvePromise(null);
          })
        : Promise.resolve(null);
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(4_999);

    const manual = service.apply({ confirmInterruptingThreads: true });
    await vi.advanceTimersByTimeAsync(1);
    accept();
    await manual;
    await vi.advanceTimersByTimeAsync(0);
    accept();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(applyRequests()).toHaveLength(1);
    setRunningThreads(1);
    launcher.push(READY_STATUS);
    expect(launcher.requests.at(-1)).toEqual({ type: "restart" });
  });

  it("drops the schedule once the update is applied by hand", async () => {
    const { applyRequests, service, setRunningThreads } =
      createScheduledService({ runningThreads: 1 });
    await service.schedule();

    const status = await service.apply({ confirmInterruptingThreads: true });
    setRunningThreads(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(status.scheduled).toBeNull();
    expect(applyRequests()).toHaveLength(1);
  });

  it("keeps the schedule when a hand-started update is refused for running threads", async () => {
    const { service } = createScheduledService({ runningThreads: 1 });
    await service.schedule();

    await expectApiError(
      service.apply({ confirmInterruptingThreads: false }),
      "threads_running",
    );

    expect(
      (await service.getStatus({ forceRefresh: false })).scheduled,
    ).not.toBeNull();
  });
});

class FakeProcessPort extends EventEmitter {
  channel = { unref: vi.fn() };
  readonly sent: ServerToLauncherMessage[] = [];

  send = (
    message: ServerToLauncherMessage,
    callback: (error: Error | null) => void,
  ): boolean => {
    this.sent.push(message);
    callback(null);
    return true;
  };
}

describe("launcher channel", () => {
  it("returns null without an IPC channel", () => {
    const port = new FakeProcessPort();
    expect(
      createLauncherChannel({
        off: port.off.bind(port),
        on: port.on.bind(port),
      }),
    ).toBeNull();
  });

  it("says hello, unrefs the channel, and pairs responses with requests", async () => {
    const port = new FakeProcessPort();
    const channel = createLauncherChannel(port);
    expect(port.sent).toEqual([{ channel: "bb-app-update/hello" }]);
    expect(port.channel.unref).toHaveBeenCalled();

    const first = channel?.request({ type: "check-source" });
    const second = channel?.request({ id: "r", type: "acknowledge-result" });
    const [, firstRequest, secondRequest] = port.sent;
    if (
      firstRequest?.channel !== "bb-app-update/request" ||
      secondRequest?.channel !== "bb-app-update/request"
    ) {
      throw new Error("expected two requests");
    }
    port.emit("message", {
      channel: "bb-app-update/response",
      error: "boom",
      requestId: secondRequest.requestId,
      result: null,
    });
    port.emit("message", {
      channel: "bb-app-update/response",
      error: null,
      requestId: firstRequest.requestId,
      result: { ok: true },
    });

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).rejects.toThrow("boom");
  });

  it("forwards valid status pushes and ignores malformed messages", () => {
    const port = new FakeProcessPort();
    const channel = createLauncherChannel(port);
    const statuses: LauncherAppUpdateStatus[] = [];
    channel?.onStatus((status) => statuses.push(status));

    port.emit("message", {
      channel: "bb-app-update/status",
      status: { bad: true },
    });
    port.emit("message", "not an object");
    port.emit("message", {
      channel: "bb-app-update/status",
      status: {
        activity: { phase: "idle" },
        current: { kind: "npm", packageRoot: "/pkg", version: "1.0.0" },
        lastResult: null,
        mode: "npm",
      },
    });

    expect(statuses).toHaveLength(1);
  });

  it("rejects pending requests when the launcher disconnects", async () => {
    const port = new FakeProcessPort();
    const channel = createLauncherChannel(port);

    const pending = channel?.request({ type: "check-source" });
    port.emit("disconnect");

    await expect(pending).rejects.toThrow("disconnected");
  });
});
