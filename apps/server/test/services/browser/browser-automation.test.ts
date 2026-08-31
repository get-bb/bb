import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
  BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD,
  BROWSER_AUTOMATION_MAX_TIMEOUT_MS,
  browserAutomationCloseMessageSchema,
  browserAutomationCommandMessageSchema,
  browserAutomationOpenMessageSchema,
  type BrowserAutomationCommand,
  type BrowserAutomationCommandMessage,
  type BrowserAutomationOpenMessage,
} from "@bb/domain";
import { BrowserAutomationService } from "../../../src/services/browser/browser-automation.js";
import { NotificationHub } from "../../../src/ws/hub.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { createTestDb, testLogger } from "../../helpers/test-app.js";

type MockHubSocket = ReturnType<typeof createMockHubSocket>;

interface Fixture {
  detachedThreadId: string;
  hostId: string;
  hub: NotificationHub;
  otherHostThreadId: string;
  otherThreadId: string;
  service: BrowserAutomationService;
  threadId: string;
}

interface ConnectDesktopArgs {
  threadId: string;
  windowId?: string;
}

function createFixture(): Fixture {
  const db = createTestDb();
  const hub = new NotificationHub();
  const deps = { db, hub };
  const host = seedHost(deps, { id: "host_browser" });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  const otherThread = seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  const detachedThread = seedThread(deps, {
    projectId: project.id,
    environmentId: null,
  });
  const otherHost = seedHost(deps, { id: "host_browser_other" });
  const { project: otherHostProject } = seedProjectWithSource(deps, { hostId: otherHost.id });
  const otherHostEnvironment = seedEnvironment(deps, {
    hostId: otherHost.id,
    projectId: otherHostProject.id,
  });
  const otherHostThread = seedThread(deps, {
    projectId: otherHostProject.id,
    environmentId: otherHostEnvironment.id,
  });
  return {
    detachedThreadId: detachedThread.id,
    hostId: host.id,
    hub,
    otherHostThreadId: otherHostThread.id,
    otherThreadId: otherThread.id,
    service: new BrowserAutomationService({ db, hub, logger: testLogger }),
    threadId: thread.id,
  };
}

function connectDesktop(
  fixture: Fixture,
  args: ConnectDesktopArgs,
): MockHubSocket {
  const socket = createMockHubSocket();
  fixture.hub.subscribe(socket, {
    kind: "thread-detail",
    threadId: args.threadId,
  });
  fixture.service.registerConnection(socket, {
    type: "browser-automation.capability",
    windowId: args.windowId ?? "window-a",
  });
  return socket;
}

function sentMessages(socket: MockHubSocket): unknown[] {
  return socket.messages.map((message) => JSON.parse(message));
}

function lastOpenMessage(socket: MockHubSocket): BrowserAutomationOpenMessage {
  return browserAutomationOpenMessageSchema.parse(
    JSON.parse(socket.messages.at(-1) ?? "null"),
  );
}

function openTarget(
  fixture: Fixture,
  overrides: Partial<{ threadId: string; timeoutMs: number; url: string }> = {},
) {
  return fixture.service.open({
    threadId: overrides.threadId ?? fixture.threadId,
    timeoutMs: overrides.timeoutMs ?? BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
    url: overrides.url ?? "https://example.test/",
  });
}

async function readyTarget(fixture: Fixture, socket: MockHubSocket) {
  const opening = openTarget(fixture);
  const request = lastOpenMessage(socket);
  acknowledge(fixture, socket, request);
  await opening;
  return request;
}

function lastCommandMessage(socket: MockHubSocket): BrowserAutomationCommandMessage {
  return browserAutomationCommandMessageSchema.parse(
    JSON.parse(socket.messages.at(-1) ?? "null"),
  );
}

function acknowledge(
  fixture: Fixture,
  socket: MockHubSocket,
  request: BrowserAutomationOpenMessage,
  overrides: Partial<{
    requestId: string;
    tabId: string;
    targetId: string;
    windowId: string;
  }> = {},
): void {
  fixture.service.recordOpenReady(socket, {
    type: "browser-automation.open-ready",
    requestId: overrides.requestId ?? request.requestId,
    targetId: overrides.targetId ?? request.targetId,
    windowId: overrides.windowId ?? "window-a",
    tabId: overrides.tabId ?? "tab-fresh",
    url: "https://example.test/landing",
  });
}

function settled<T>(
  promise: Promise<T>,
): Promise<
  { status: "resolved"; value: T } | { status: "rejected"; error: unknown }
> {
  return promise.then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BrowserAutomationService", () => {
  it("derives host ownership server-side and accepts only the exactly correlated fresh-tab acknowledgement", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const strangerSocket = connectDesktop(fixture, {
      threadId: fixture.threadId,
      windowId: "window-stranger",
    });

    const opening = openTarget(fixture);
    const request = lastOpenMessage(socket);
    expect(request).toMatchObject({
      type: "browser-automation.open",
      threadId: fixture.threadId,
      url: "https://example.test/",
    });
    expect(request.targetId).toMatch(/^bt_/);
    expect(request.requestId).not.toBe(request.targetId);
    expect(strangerSocket.messages).toHaveLength(0);
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([
      expect.objectContaining({
        targetId: request.targetId,
        hostId: fixture.hostId,
        threadId: fixture.threadId,
        status: "opening",
      }),
    ]);

    acknowledge(fixture, socket, request, { targetId: "existing-user-tab" });
    acknowledge(fixture, socket, request, { requestId: "guessed-request" });
    acknowledge(fixture, socket, request, { windowId: "window-other" });
    acknowledge(fixture, strangerSocket, request, {
      windowId: "window-stranger",
    });
    expect(
      fixture.service.list({ threadId: fixture.threadId })[0]?.status,
    ).toBe("opening");

    acknowledge(fixture, socket, request);
    await expect(opening).resolves.toEqual({
      targetId: request.targetId,
      threadId: fixture.threadId,
      hostId: fixture.hostId,
      status: "ready",
      navigationEpoch: 0,
      navigating: false,
      visible: true,
      url: "https://example.test/landing",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([
      expect.objectContaining({ targetId: request.targetId, status: "ready" }),
    ]);
  });

  it("refuses targets for threads without an available environment or that do not exist", async () => {
    const fixture = createFixture();
    connectDesktop(fixture, { threadId: fixture.detachedThreadId });

    await expect(
      openTarget(fixture, { threadId: fixture.detachedThreadId }),
    ).rejects.toMatchObject({
      body: { code: "thread_environment_unavailable" },
    });
    await expect(
      openTarget(fixture, { threadId: "thr_missing" }),
    ).rejects.toMatchObject({ body: { code: "thread_not_found" } });
    expect(() => fixture.service.list({ threadId: "thr_missing" })).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "thread_not_found" }),
      }),
    );
  });

  it("distinguishes no desktop client from an incompatible one and selects connections per thread", async () => {
    const fixture = createFixture();

    await expect(openTarget(fixture)).rejects.toMatchObject({
      status: 503,
      body: {
        code: "browser_client_unavailable",
        details: { reason: "no_client" },
      },
    });

    const legacySocket = createMockHubSocket();
    fixture.hub.subscribe(legacySocket, {
      kind: "thread-detail",
      threadId: fixture.threadId,
    });
    await expect(openTarget(fixture)).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "incompatible" },
        message: expect.stringContaining("Update the bb desktop app"),
      },
    });
    expect(legacySocket.messages).toHaveLength(0);

    const otherThreadSocket = connectDesktop(fixture, {
      threadId: fixture.otherThreadId,
    });
    await expect(openTarget(fixture)).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "incompatible" },
      },
    });
    expect(otherThreadSocket.messages).toHaveLength(0);
  });

  it("keeps listing and closing scoped to the owning thread", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const opening = openTarget(fixture);
    const request = lastOpenMessage(socket);
    acknowledge(fixture, socket, request);
    await opening;

    expect(fixture.service.list({ threadId: fixture.otherThreadId })).toEqual(
      [],
    );
    expect(() =>
      fixture.service.close({
        threadId: fixture.otherThreadId,
        targetId: request.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_not_found" }),
      }),
    );
    expect(fixture.service.list({ threadId: fixture.threadId })).toHaveLength(
      1,
    );
    expect(() =>
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: "bt_unknown",
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_not_found" }),
      }),
    );

    const closed = fixture.service.close({
      threadId: fixture.threadId,
      targetId: request.targetId,
    });
    expect(closed.status).toBe("closed");
    expect(
      browserAutomationCloseMessageSchema.parse(sentMessages(socket).at(-1)),
    ).toEqual({
      type: "browser-automation.close",
      targetId: request.targetId,
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(() =>
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: request.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_closed" }),
      }),
    );
    expect(() =>
      fixture.service.close({
        threadId: fixture.otherThreadId,
        targetId: request.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_not_found" }),
      }),
    );
  });

  it("bounds recent closed-target ownership history", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });

    const firstOpening = openTarget(fixture);
    const firstRequest = lastOpenMessage(socket);
    acknowledge(fixture, socket, firstRequest);
    await firstOpening;
    fixture.service.close({
      threadId: fixture.threadId,
      targetId: firstRequest.targetId,
    });

    for (let index = 0; index < 64; index += 1) {
      const opening = openTarget(fixture);
      const request = lastOpenMessage(socket);
      acknowledge(fixture, socket, request);
      await opening;
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: request.targetId,
      });
    }

    expect(() =>
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: firstRequest.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_not_found" }),
      }),
    );
  });

  it("rejects the fifth live target for a thread", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const pending: Promise<unknown>[] = [];
    for (
      let index = 0;
      index < BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD;
      index += 1
    ) {
      pending.push(settled(openTarget(fixture)));
    }
    expect(socket.messages).toHaveLength(
      BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD,
    );

    await expect(openTarget(fixture)).rejects.toMatchObject({
      status: 409,
      body: {
        code: "browser_target_limit",
        details: { limit: BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD },
      },
    });
    expect(socket.messages).toHaveLength(
      BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD,
    );

    const firstTarget = fixture.service.list({ threadId: fixture.threadId })[0];
    if (firstTarget === undefined) {
      throw new Error("expected a live target");
    }
    fixture.service.close({
      threadId: fixture.threadId,
      targetId: firstTarget.targetId,
    });
    const reopened = settled(openTarget(fixture));
    expect(socket.messages).toHaveLength(
      BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD + 2,
    );
    fixture.service.releaseConnection(socket);
    await Promise.all([...pending, reopened]);
  });

  it("settles a timed-out open once and tells the renderer to drop the late tab", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const opening = settled(openTarget(fixture, { timeoutMs: 1_000 }));
    const request = lastOpenMessage(socket);

    await vi.advanceTimersByTimeAsync(999);
    expect(
      fixture.service.list({ threadId: fixture.threadId })[0]?.status,
    ).toBe("opening");
    await vi.advanceTimersByTimeAsync(1);
    await expect(opening).resolves.toMatchObject({
      status: "rejected",
      error: {
        status: 504,
        body: {
          code: "browser_open_timeout",
          details: { timeoutMs: 1_000 },
        },
      },
    });
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "browser-automation.close",
      targetId: request.targetId,
    });

    acknowledge(fixture, socket, request);
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(() =>
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: request.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_closed" }),
      }),
    );
    expect(socket.messages).toHaveLength(2);
  });

  it("closes a target that is still opening exactly once", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const opening = settled(openTarget(fixture));
    const request = lastOpenMessage(socket);

    const closed = fixture.service.close({
      threadId: fixture.threadId,
      targetId: request.targetId,
    });
    expect(closed.status).toBe("closed");
    await expect(opening).resolves.toMatchObject({
      status: "rejected",
      error: { body: { code: "browser_target_closed" } },
    });
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "browser-automation.close",
      targetId: request.targetId,
    });

    acknowledge(fixture, socket, request);
    fixture.service.recordOpenFailed(socket, {
      type: "browser-automation.open-failed",
      requestId: request.requestId,
      targetId: request.targetId,
      code: "thread_not_open",
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(socket.messages).toHaveLength(2);
  });

  it("retires every target on disconnect and never resurrects them for a reconnected window", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const readyOpening = openTarget(fixture);
    acknowledge(fixture, socket, lastOpenMessage(socket));
    await readyOpening;
    const pendingOpening = settled(openTarget(fixture));
    expect(fixture.service.list({ threadId: fixture.threadId })).toHaveLength(
      2,
    );

    fixture.service.releaseConnection(socket);
    await expect(pendingOpening).resolves.toMatchObject({
      status: "rejected",
      error: {
        body: {
          code: "browser_client_unavailable",
          details: { reason: "disconnected" },
        },
      },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);

    const reconnected = connectDesktop(fixture, {
      threadId: fixture.threadId,
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(reconnected.messages).toHaveLength(0);

    const nextOpening = settled(openTarget(fixture));
    fixture.service.registerConnection(reconnected, {
      type: "browser-automation.capability",
      windowId: "window-replaced",
    });
    await expect(nextOpening).resolves.toMatchObject({
      status: "rejected",
      error: { body: { details: { reason: "disconnected" } } },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
  });

  it("honours renderer-reported closes only from the owning connection", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const otherSocket = connectDesktop(fixture, {
      threadId: fixture.threadId,
      windowId: "window-b",
    });
    const opening = openTarget(fixture);
    const request = lastOpenMessage(socket);
    acknowledge(fixture, socket, request);
    await opening;

    fixture.service.recordTargetClosed(otherSocket, {
      type: "browser-automation.target-closed",
      targetId: request.targetId,
      windowId: "window-b",
      tabId: "tab-fresh",
    });
    fixture.service.recordTargetClosed(socket, {
      type: "browser-automation.target-closed",
      targetId: request.targetId,
      windowId: "window-b",
      tabId: "tab-fresh",
    });
    fixture.service.recordTargetClosed(socket, {
      type: "browser-automation.target-closed",
      targetId: request.targetId,
      windowId: "window-a",
      tabId: "browser:user-tab",
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toHaveLength(
      1,
    );

    fixture.service.recordTargetClosed(socket, {
      type: "browser-automation.target-closed",
      targetId: request.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(() =>
      fixture.service.close({
        threadId: fixture.threadId,
        targetId: request.targetId,
      }),
    ).toThrow(
      expect.objectContaining({
        body: expect.objectContaining({ code: "browser_target_closed" }),
      }),
    );
    expect(socket.messages).toHaveLength(1);
  });

  it("maps renderer open failures to actionable errors", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const opening = openTarget(fixture);
    const request = lastOpenMessage(socket);

    fixture.service.recordOpenFailed(socket, {
      type: "browser-automation.open-failed",
      requestId: request.requestId,
      targetId: request.targetId,
      code: "tab_unavailable",
    });
    await expect(opening).rejects.toMatchObject({
      status: 409,
      body: {
        code: "browser_open_failed",
        details: { reason: "tab_unavailable" },
        message: expect.stringContaining("could not create a Browser tab"),
      },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
  });

  it("validates URLs and timeouts before contacting the desktop app", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });

    await expect(
      openTarget(fixture, { url: "file:///etc/hosts" }),
    ).rejects.toMatchObject({ status: 400, body: { code: "invalid_request" } });
    await expect(openTarget(fixture, { timeoutMs: 0 })).rejects.toMatchObject({
      status: 400,
      body: { code: "invalid_request" },
    });
    await expect(
      openTarget(fixture, { timeoutMs: BROWSER_AUTOMATION_MAX_TIMEOUT_MS + 1 }),
    ).rejects.toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(socket.messages).toHaveLength(0);
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
  });

  it("coordinates every command with exact target, socket, window, tab, command, and revision correlation", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const otherSocket = connectDesktop(fixture, { threadId: fixture.threadId, windowId: "window-b" });
    const target = await readyTarget(fixture, socket);
    const commands: BrowserAutomationCommand[] = [
      { kind: "navigate", url: "https://example.test/next" },
      { kind: "wait", text: "Saved" },
      { kind: "snapshot" },
      { kind: "click", ref: "e0g1r1", snapshotGeneration: 1 },
      { kind: "type", ref: "e0g1r1", snapshotGeneration: 1, text: "hello" },
      { kind: "press", key: "Enter" },
      { kind: "select", ref: "e0g1r1", snapshotGeneration: 1, value: "Admin" },
      { kind: "screenshot" },
    ];
    let epoch = 0;
    for (const command of commands) {
      const running = fixture.service.run({ threadId: fixture.threadId, targetId: target.targetId, command });
      const request = lastCommandMessage(socket);
      expect(request).toMatchObject({
        targetId: target.targetId,
        windowId: "window-a",
        tabId: "tab-fresh",
        navigationEpoch: epoch,
        command,
      });
      expect(
        fixture.service.list({ threadId: fixture.threadId })[0]?.navigating,
      ).toBe(command.kind === "navigate");
      fixture.service.recordCommandResult(otherSocket, {
        type: "browser-automation.command-result",
        commandId: request.commandId,
        targetId: request.targetId,
        windowId: "window-b",
        tabId: request.tabId,
        result: { kind: "state", navigationEpoch: epoch, ready: true, url: "https://ignored.test/" },
      });
      epoch += command.kind === "navigate" ? 1 : 0;
      fixture.service.recordCommandResult(socket, {
        type: "browser-automation.command-result",
        commandId: request.commandId,
        targetId: request.targetId,
        windowId: request.windowId,
        tabId: request.tabId,
        result: { kind: "state", navigationEpoch: epoch, ready: true, url: "https://example.test/next" },
      });
      await expect(running).resolves.toMatchObject({ navigationEpoch: epoch, ready: true });
    }
    expect(fixture.service.list({ threadId: fixture.threadId })[0]).toMatchObject({
      navigationEpoch: 1,
      url: "https://example.test/next",
    });
  });

  it("preserves authoritative URL across non-authoritative failures and accepts later recovery", async () => {
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const target = await readyTarget(fixture, socket);
    const failed = fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    });
    const failedRequest = lastCommandMessage(socket);
    fixture.service.recordCommandFailed(socket, {
      type: "browser-automation.command-failed",
      commandId: failedRequest.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      code: "native_operation_failed",
      detail: "Renderer IPC rejected",
    });
    await expect(failed).rejects.toMatchObject({
      body: { code: "browser_native_operation_failed" },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })[0]).toMatchObject({
      navigationEpoch: 0,
      url: "https://example.test/landing",
    });

    const recovered = fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    });
    const recoveredRequest = lastCommandMessage(socket);
    fixture.service.recordCommandResult(socket, {
      type: "browser-automation.command-result",
      commandId: recoveredRequest.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      result: {
        kind: "state",
        navigationEpoch: 2,
        ready: true,
        url: "https://example.test/recovered",
      },
    });
    await expect(recovered).resolves.toMatchObject({ navigationEpoch: 2 });
    expect(fixture.service.list({ threadId: fixture.threadId })[0]?.url).toBe(
      "https://example.test/recovered",
    );
  });

  it("bounds command recovery, retires lost cancellations fail-closed, and clears recovery timers on races", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const target = await readyTarget(fixture, socket);

    const first = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "wait", text: "never" },
      timeoutMs: 20,
    }));
    const firstRequest = lastCommandMessage(socket);
    await vi.advanceTimersByTimeAsync(20);
    await expect(first).resolves.toMatchObject({
      status: "rejected",
      error: { body: { code: "browser_command_timeout" } },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toHaveLength(1);
    fixture.service.recordCommandFailed(socket, {
      type: "browser-automation.command-failed",
      commandId: firstRequest.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      code: "cancelled",
      detail: "cancelled",
      state: {
        navigationEpoch: 1,
        ready: true,
        url: "https://example.test/after-race",
      },
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(fixture.service.list({ threadId: fixture.threadId })).toHaveLength(1);

    const second = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "wait", text: "lost" },
      timeoutMs: 20,
    }));
    const secondRequest = lastCommandMessage(socket);
    await vi.advanceTimersByTimeAsync(20);
    await second;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);
    expect(sentMessages(socket).at(-1)).toEqual({
      type: "browser-automation.close",
      targetId: target.targetId,
    });
    expect(vi.getTimerCount()).toBe(0);
    fixture.service.recordCommandResult(socket, {
      type: "browser-automation.command-result",
      commandId: secondRequest.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      result: {
        kind: "state",
        navigationEpoch: 2,
        ready: true,
        url: "https://example.test/late",
      },
    });
    expect(fixture.service.list({ threadId: fixture.threadId })).toEqual([]);

    const closeTarget = await readyTarget(fixture, socket);
    const closeRunning = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: closeTarget.targetId,
      command: { kind: "wait", text: "cancel" },
    }));
    fixture.service.cancel({
      threadId: fixture.threadId,
      targetId: closeTarget.targetId,
    });
    await closeRunning;
    fixture.service.close({
      threadId: fixture.threadId,
      targetId: closeTarget.targetId,
    });
    expect(vi.getTimerCount()).toBe(0);

    const disconnectTarget = await readyTarget(fixture, socket);
    const disconnectRunning = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: disconnectTarget.targetId,
      command: { kind: "wait", text: "cancel" },
    }));
    fixture.service.cancel({
      threadId: fixture.threadId,
      targetId: disconnectTarget.targetId,
    });
    await disconnectRunning;
    fixture.service.releaseConnection(socket);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces thread and host isolation, one-command busy rejection, cancellation, timeout, and disconnect settlement", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const socket = connectDesktop(fixture, { threadId: fixture.threadId });
    const target = await readyTarget(fixture, socket);
    const running = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "wait", text: "later" },
      timeoutMs: 1_000,
    }));
    const request = lastCommandMessage(socket);
    await expect(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    })).rejects.toMatchObject({ body: { code: "browser_target_busy" } });
    await expect(fixture.service.run({
      threadId: fixture.otherThreadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    })).rejects.toMatchObject({ body: { code: "browser_target_not_found" } });
    await expect(fixture.service.run({
      threadId: fixture.otherHostThreadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    })).rejects.toMatchObject({ body: { code: "browser_target_not_found" } });

    expect(fixture.service.cancel({ threadId: fixture.threadId, targetId: target.targetId })).toBe(true);
    await expect(running).resolves.toMatchObject({ status: "rejected", error: { body: { code: "browser_command_cancelled" } } });
    expect(sentMessages(socket).at(-1)).toMatchObject({
      type: "browser-automation.cancel",
      commandId: request.commandId,
      targetId: target.targetId,
    });
    fixture.service.recordCommandFailed(socket, {
      type: "browser-automation.command-failed",
      commandId: request.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      code: "cancelled",
      detail: "cancelled after navigation committed",
      state: { navigationEpoch: 1, ready: true, url: "https://after-cancel.test/" },
    });

    const timed = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "wait", text: "never" },
      timeoutMs: 20,
    }));
    const timedRequest = lastCommandMessage(socket);
    expect(timedRequest.navigationEpoch).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    await expect(timed).resolves.toMatchObject({ status: "rejected", error: { body: { code: "browser_command_timeout" } } });
    fixture.service.recordCommandFailed(socket, {
      type: "browser-automation.command-failed",
      commandId: timedRequest.commandId,
      targetId: target.targetId,
      windowId: "window-a",
      tabId: "tab-fresh",
      code: "cancelled",
      detail: "timed out",
      state: { navigationEpoch: 1, ready: true, url: "https://after-cancel.test/" },
    });

    const disconnected = settled(fixture.service.run({
      threadId: fixture.threadId,
      targetId: target.targetId,
      command: { kind: "snapshot" },
    }));
    fixture.service.releaseConnection(socket);
    await expect(disconnected).resolves.toMatchObject({ status: "rejected", error: { body: { code: "browser_client_unavailable" } } });
  });
});
