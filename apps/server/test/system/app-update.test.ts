import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AppUpdateLauncherRequest,
  LauncherAppUpdateStatus,
  ServerToLauncherMessage,
  SourceUpdateCheck,
} from "@bb/config/app-update";
import type { SystemVersionResponse } from "@bb/server-contract";
import { ApiError } from "../../src/errors.js";
import { createAppUpdateService } from "../../src/services/system/app-update.js";
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
        probation: false,
        ...status,
      });
    }
  }
}

function sourceCheck(
  overrides: Partial<SourceUpdateCheck> = {},
): SourceUpdateCheck {
  return {
    blocked: null,
    current: { commit: COMMIT_A, kind: "source", version: "1.0.0" },
    incoming: {
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
  version?: Partial<SystemVersionResponse>;
}) {
  const notifyChanged = vi.fn();
  const launcher =
    args.launcher === undefined ? new FakeLauncher() : args.launcher;
  const service = createAppUpdateService({
    appSurface: args.appSurface ?? "web",
    appVersion: appVersion(args.version ?? {}),
    config: { appVersion: "1.0.0", isDevelopment: args.isDevelopment ?? false },
    countRunningThreads: () => args.runningThreads ?? 0,
    launcher,
    logger: testLogger,
    mode: args.mode === undefined ? "npm" : args.mode,
    notifyChanged,
    ...(args.now === undefined ? {} : { now: args.now }),
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
      service.apply({ confirmInterruptingThreads: true }),
      "app_update_unsupported",
    );
  });

  it("offers the npm latest version on the stable channel", async () => {
    const { service } = createService({});

    const status = await service.getStatus({ forceRefresh: false });

    expect(status.support).toEqual({ kind: "supported", mode: "npm" });
    expect(status.available).toEqual({
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
      service.apply({ confirmInterruptingThreads: false }),
      "threads_running",
    );
    expect(error.body.details).toEqual({ runningThreadCount: 2 });
    expect(launcher?.requests).toEqual([]);

    await service.apply({ confirmInterruptingThreads: true });
    expect(launcher?.requests).toEqual([
      {
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
        type: "apply",
      },
    ]);
  });

  it("rejects an update when bb is already current", async () => {
    const { service } = createService({
      version: { latestVersion: "1.0.0", updateAvailable: false },
    });

    await expectApiError(
      service.apply({ confirmInterruptingThreads: true }),
      "app_update_unavailable",
    );
  });

  it("rejects an update while one is running or confirming", async () => {
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
      service.apply({ confirmInterruptingThreads: true }),
      "app_update_in_progress",
    );

    launcher?.push({ probation: true });
    await expectApiError(
      service.apply({ confirmInterruptingThreads: true }),
      "app_update_confirming",
    );
  });

  it("surfaces launcher rejections as conflicts", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async () => {
      throw new Error("This bb updates through npm, not source.");
    };
    const { service } = createService({ launcher });

    const error = await expectApiError(
      service.apply({ confirmInterruptingThreads: true }),
      "app_update_rejected",
    );
    expect(error.body.message).toContain("not source");
  });

  it("maps launcher status into activity, result, and probation", async () => {
    const { launcher, notifyChanged, service } = createService({});
    notifyChanged.mockClear();

    launcher?.push({
      activity: {
        phase: "restarting",
        startedAt: "2026-09-23T00:00:00.000Z",
        target: { kind: "npm", version: "1.1.0" },
        targetVersion: "1.1.0",
      },
      lastResult: {
        acknowledged: false,
        finishedAt: "2026-09-23T00:00:00.000Z",
        from: { kind: "npm", packageRoot: "/pkg/0.9.0", version: "0.9.0" },
        id: "result-1",
        logTail: ["boom"],
        message: "Server failed to start",
        outcome: "rolled-back",
        phase: "startup",
        to: { kind: "npm", packageRoot: "/pkg/1.0.0", version: "1.0.0" },
      },
    });
    const status = await service.getStatus({ forceRefresh: false });

    expect(notifyChanged).toHaveBeenCalledOnce();
    expect(status.activity).toEqual({
      phase: "restarting",
      startedAt: "2026-09-23T00:00:00.000Z",
      targetVersion: "1.1.0",
    });
    expect(status.lastResult).toMatchObject({
      from: { commit: null, version: "0.9.0" },
      outcome: "rolled-back",
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
      channel: "main",
      commit: COMMIT_B,
      commitCount: 2,
    });
    expect(status.blocked?.reason).toBe("uncommitted-changes");
    await expectApiError(
      service.apply({ confirmInterruptingThreads: true }),
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
      appSurface: "web",
      appVersion: appVersion({}),
      config: { appVersion: "1.0.0", isDevelopment: false },
      countRunningThreads: () => runningThreads,
      launcher,
      logger: testLogger,
      mode: "npm",
      notifyChanged: vi.fn(),
    });
    launcher.push({});
    await service.apply({ confirmInterruptingThreads: false });

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
    await service.apply({ confirmInterruptingThreads: true });
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

    await service.apply({ confirmInterruptingThreads: false });

    expect(launcher.requests.at(-1)).toMatchObject({
      target: { commit: "c".repeat(40), kind: "source" },
      type: "apply",
    });
  });

  it("targets the checked commit when applying a source update", async () => {
    const launcher = new FakeLauncher();
    launcher.respond = async (request) =>
      request.type === "check-source" ? sourceCheck() : null;
    const { service } = createService({ launcher, mode: "source" });
    await service.getStatus({ forceRefresh: true });

    await service.apply({ confirmInterruptingThreads: false });

    expect(launcher.requests.at(-1)).toEqual({
      target: { commit: COMMIT_B, kind: "source" },
      targetVersion: "1.0.0",
      type: "apply",
    });
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
        probation: false,
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
