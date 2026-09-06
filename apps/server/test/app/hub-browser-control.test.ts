import { describe, expect, it, vi } from "vitest";
import type {
  BrowserControlRequestMessage,
  BrowserOpenTabRequestMessage,
  BrowserTabTarget,
} from "@bb/domain";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

const target: BrowserTabTarget = {
  clientId: "client-a",
  windowId: "window-a",
  tabId: "tab-a",
  navigationEpoch: 3,
};

const controller = {
  pluginId: "plugin-a",
  controllerId: "controller-a",
  tabId: target.tabId,
  registrationId: "00000000-0000-4000-8000-000000000001",
};

function registerTab(
  hub: NotificationHub,
  controllers: (typeof controller)[] = [],
) {
  const socket = createMockHubSocket();
  hub.updateBrowserClient(socket, {
    type: "browser-client-state",
    clientId: target.clientId,
    windowId: target.windowId,
    active: true,
    canActivateThreadOwner: true,
    controllers,
    owners: [
      {
        ownerId: "owner-a",
        threadId: "thread-a",
        projectId: "project-a",
        active: true,
      },
    ],
    tabs: [
      {
        tabId: target.tabId,
        threadId: "thread-a",
        projectId: "project-a",
        url: "https://example.test/",
        title: "Example",
        connected: true,
        active: true,
        navigationEpoch: target.navigationEpoch,
      },
    ],
  });
  return socket;
}

function latestRequest(
  socket: ReturnType<typeof createMockHubSocket>,
): BrowserControlRequestMessage {
  return JSON.parse(
    socket.messages.at(-1) ?? "null",
  ) as BrowserControlRequestMessage;
}

describe("NotificationHub Browser control broker", () => {
  it("lists registered tabs deterministically and resolves an exact response", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);

    expect(hub.listBrowserTabs()).toEqual([
      expect.objectContaining({ ...target, title: "Example" }),
    ]);

    const result = hub.runBrowserControl({
      target,
      action: { kind: "snapshot", mode: "interactive" },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    expect(request).toMatchObject({
      type: "browser-control-request",
      target,
      action: { kind: "snapshot", mode: "interactive" },
    });
    expect(
      hub.recordBrowserControlResponse(socket, {
        type: "browser-control-response",
        requestId: request.requestId,
        target,
        ok: true,
        value: { nodes: 4 },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ nodes: 4 });
  });
  it("cancels an exact controller generation when its registration is replaced", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub, [controller]);
    const result = hub.requestBrowserPluginContribution({
      pluginId: controller.pluginId,
      controllerId: controller.controllerId,
      target,
      input: { action: "run" },
      timeoutMs: 1_000,
    });
    const request = JSON.parse(socket.messages.at(-1) ?? "null");
    expect(request).toMatchObject({
      type: "browser-plugin-request",
      registrationId: controller.registrationId,
    });

    const replacement = {
      ...controller,
      registrationId: "00000000-0000-4000-8000-000000000002",
    };
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [replacement],
      owners: [
        {
          ownerId: "owner-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: target.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/",
          title: "Example",
          connected: true,
          active: true,
          navigationEpoch: target.navigationEpoch,
        },
      ],
    });
    await expect(result).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });
    expect(
      hub.recordBrowserPluginResponse(socket, {
        type: "browser-plugin-response",
        requestId: request.requestId,
        pluginId: controller.pluginId,
        controllerId: controller.controllerId,
        registrationId: controller.registrationId,
        ok: true,
        value: { stale: true },
      }),
    ).toBe(false);
  });

  it("rejects an activate action when its source tab is removed", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: { kind: "activate-tab", tabId: "tab-previous" },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "owner-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: "tab-previous",
          threadId: "thread-a",
          projectId: "project-a",
          url: "file:///Users/test/page.html",
          title: "Previous",
          connected: true,
          active: true,
          navigationEpoch: 9,
        },
      ],
    });
    await expect(result).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });
    expect(JSON.parse(socket.messages.at(-1) ?? "null")).toMatchObject({
      type: "browser-control-cancel",
      requestId: request.requestId,
      reason: "target-changed",
    });
  });

  it("creates the first and subsequent tabs through a tabless panel owner", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      tabs: [],
      owners: [
        {
          ownerId: "owner-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
    });

    const open = (tabId: string) => {
      const result = hub.openBrowserTab({
        url: `file:///Users/test/${tabId}.html`,
        threadId: "thread-a",
        timeoutMs: 1_000,
      });
      const request = JSON.parse(
        socket.messages.at(-1) ?? "null",
      ) as BrowserOpenTabRequestMessage;
      const openedTarget = {
        clientId: target.clientId,
        windowId: target.windowId,
        tabId,
        navigationEpoch: 0,
      };
      expect(request).toMatchObject({
        type: "browser-open-tab-request",
        mode: "owner",
        ownerId: "owner-a",
        url: `file:///Users/test/${tabId}.html`,
      });
      hub.updateBrowserClient(socket, {
        type: "browser-client-state",
        clientId: target.clientId,
        windowId: target.windowId,
        active: true,
        canActivateThreadOwner: true,
        controllers: [],
        owners: [
          {
            ownerId: "owner-a",
            threadId: "thread-a",
            projectId: "project-a",
            active: true,
          },
        ],
        tabs: [
          {
            tabId,
            threadId: "thread-a",
            projectId: "project-a",
            url: `file:///Users/test/${tabId}.html`,
            title: tabId,
            connected: true,
            active: true,
            navigationEpoch: 0,
          },
        ],
      });
      hub.recordBrowserOpenTabResponse(socket, {
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: target.clientId,
        windowId: target.windowId,
        ownerId: "owner-a",
        ok: true,
        target: openedTarget,
      });
      return { result, openedTarget };
    };

    expect(hub.listBrowserTabs()).toEqual([]);
    expect(hub.listBrowserTabOwners()).toEqual([
      expect.objectContaining({ ownerId: "owner-a", threadId: "thread-a" }),
    ]);
    const first = open("tab-first");
    await expect(first.result).resolves.toEqual(first.openedTarget);
    const second = open("tab-second");
    await expect(second.result).resolves.toEqual(second.openedTarget);
  });

  it("activates the requested thread instead of using another thread owner", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "owner-b",
          threadId: "thread-b",
          projectId: "project-b",
          active: true,
        },
      ],
      tabs: [],
    });

    const result = hub.openBrowserTab({
      url: "https://example.test/thread-a",
      threadId: "thread-a",
      projectId: "project-a",
      timeoutMs: 1_000,
    });
    const request = JSON.parse(
      socket.messages.at(-1) ?? "null",
    ) as BrowserOpenTabRequestMessage;
    expect(request).toMatchObject({
      type: "browser-open-tab-request",
      mode: "thread",
      threadId: "thread-a",
      projectId: "project-a",
    });
    expect(request).not.toHaveProperty("ownerId");

    const openedTarget = { ...target, tabId: "tab-first", navigationEpoch: 0 };
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "thread:thread-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: openedTarget.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/thread-a",
          title: "Thread A",
          connected: true,
          active: true,
          navigationEpoch: 0,
        },
      ],
    });
    expect(
      hub.recordBrowserOpenTabResponse(socket, {
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: target.clientId,
        windowId: target.windowId,
        ownerId: "thread:thread-a",
        ok: true,
        target: openedTarget,
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual(openedTarget);
  });

  it("requires an exact window when multiple active apps can mount the thread", async () => {
    const hub = new NotificationHub();
    for (const suffix of ["a", "b"]) {
      const socket = createMockHubSocket();
      hub.updateBrowserClient(socket, {
        type: "browser-client-state",
        clientId: `client-${suffix}`,
        windowId: `window-${suffix}`,
        active: true,
        canActivateThreadOwner: true,
        controllers: [],
        owners: [],
        tabs: [],
      });
    }

    await expect(
      hub.openBrowserTab({
        url: "https://example.test/",
        threadId: "thread-a",
        projectId: "project-a",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(
      "Multiple active BB app windows can open this thread; specify client and window",
    );
  });

  it("accepts a same-tab navigation transition when waiting for the next document", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: {
        kind: "wait",
        criteria: {
          kind: "navigation",
          phase: "commit",
          sameDocument: false,
        },
      },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "owner-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: target.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/next",
          title: "Next",
          connected: true,
          active: true,
          navigationEpoch: target.navigationEpoch + 1,
        },
      ],
    });
    expect(
      hub.recordBrowserControlResponse(socket, {
        type: "browser-control-response",
        requestId: request.requestId,
        target,
        observedTarget: {
          ...target,
          navigationEpoch: target.navigationEpoch + 1,
        },
        ok: true,
        value: {
          url: "https://example.test/next",
          kind: "navigation",
          phase: "commit",
          sameDocument: false,
          target,
          observedTarget: {
            ...target,
            navigationEpoch: target.navigationEpoch + 1,
          },
        },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      url: "https://example.test/next",
      kind: "navigation",
      phase: "commit",
      sameDocument: false,
      target,
      observedTarget: {
        ...target,
        navigationEpoch: target.navigationEpoch + 1,
      },
    });
  });

  it("rejects a transition wait when the target tab is replaced in another window", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: {
        kind: "wait",
        criteria: { kind: "url", url: "https://next.test/", match: "exact" },
      },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: "window-other",
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [],
      tabs: [
        {
          tabId: target.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://next.test/",
          title: "Next",
          connected: true,
          active: true,
          navigationEpoch: target.navigationEpoch + 1,
        },
      ],
    });
    await expect(result).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });
    expect(request).toBeDefined();
  });

  it("keeps concurrent requests independent", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const first = hub.runBrowserControl({
      target,
      action: { kind: "scroll", deltaY: 100 },
      timeoutMs: 1_000,
    });
    const firstRequest = latestRequest(socket);
    const second = hub.runBrowserControl({
      target,
      action: { kind: "key", key: "Enter" },
      timeoutMs: 1_000,
    });
    const secondRequest = latestRequest(socket);

    hub.recordBrowserControlResponse(socket, {
      type: "browser-control-response",
      requestId: secondRequest.requestId,
      target,
      ok: true,
      value: { pressed: "Enter" },
    });
    hub.recordBrowserControlResponse(socket, {
      type: "browser-control-response",
      requestId: firstRequest.requestId,
      target,
      ok: true,
      value: { y: 100 },
    });

    await expect(first).resolves.toEqual({ y: 100 });
    await expect(second).resolves.toEqual({ pressed: "Enter" });
  });

  it("invalidates pending work on navigation and client disconnect", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const navigating = hub.runBrowserControl({
      target,
      action: { kind: "snapshot", mode: "dom" },
      timeoutMs: 1_000,
    });
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "owner-a",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: target.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/next",
          title: "Next",
          connected: true,
          active: true,
          navigationEpoch: target.navigationEpoch + 1,
        },
      ],
    });
    await expect(navigating).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });

    const nextTarget = {
      ...target,
      navigationEpoch: target.navigationEpoch + 1,
    };
    const disconnecting = hub.runBrowserControl({
      target: nextTarget,
      action: { kind: "snapshot", mode: "dom" },
      timeoutMs: 1_000,
    });
    hub.unregisterClient(socket);
    await expect(disconnecting).rejects.toThrow("disconnected");
  });

  it("forwards abort and timeout cancellation to the owning client", async () => {
    vi.useFakeTimers();
    try {
      const hub = new NotificationHub();
      const socket = registerTab(hub);
      const controller = new AbortController();
      const aborted = hub.runBrowserControl({
        target,
        action: { kind: "snapshot", mode: "dom" },
        timeoutMs: 1_000,
        signal: controller.signal,
      });
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
      expect(JSON.parse(socket.messages.at(-1) ?? "null")).toMatchObject({
        type: "browser-control-cancel",
        reason: "cancelled",
      });

      const timedOut = hub.runBrowserControl({
        target,
        action: { kind: "snapshot", mode: "dom" },
        timeoutMs: 100,
      });
      const rejection = expect(timedOut).rejects.toThrow(
        "Timed out waiting for Browser action",
      );
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(JSON.parse(socket.messages.at(-1) ?? "null")).toMatchObject({
        type: "browser-control-cancel",
        reason: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects stale targets before sending a request", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    await expect(
      hub.runBrowserControl({
        target: { ...target, navigationEpoch: 2 },
        action: { kind: "snapshot", mode: "dom" },
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ name: "BrowserControlUnavailableError" });
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects a forged wait response that claims a foreign epoch", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: {
        kind: "wait",
        criteria: { kind: "url", url: "https://next.test/", match: "exact" },
      },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    const forged = {
      type: "browser-control-response" as const,
      requestId: request.requestId,
      target,
      ok: true,
      value: { blocked: false },
    };
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: "evil",
      windowId: "foreign",
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "evil-owner",
          threadId: "thread-a",
          projectId: "project-a",
          active: true,
        },
      ],
      tabs: [
        {
          tabId: target.tabId,
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://next.test/",
          title: "Next",
          connected: true,
          active: true,
          navigationEpoch: 99,
        },
      ],
    });
    expect(
      hub.recordBrowserControlResponse(createMockHubSocket(), forged),
    ).toBe(false);
    await expect(result).rejects.toBeInstanceOf(Error);
    const cancels = socket.messages
      .map(
        (message) => JSON.parse(message) as { type?: string; reason?: string },
      )
      .filter((message) => message.type === "browser-control-cancel");
    expect(cancels.length).toBeGreaterThan(0);
    expect(cancels.at(-1)?.reason).not.toBe("timeout");
  });

  it.each([false, true])(
    "validates navigation wait result identity (forged: %s)",
    async (forged) => {
      const hub = new NotificationHub();
      const socket = registerTab(hub);
      const result = hub.runBrowserControl({
        target,
        action: {
          kind: "wait",
          criteria: {
            kind: "navigation",
            phase: "commit",
            sameDocument: false,
          },
        },
        timeoutMs: 1_000,
      });
      const request = latestRequest(socket);
      const nextTarget = {
        ...target,
        navigationEpoch: target.navigationEpoch + 1,
      };
      hub.updateBrowserClient(socket, {
        type: "browser-client-state",
        clientId: target.clientId,
        windowId: target.windowId,
        active: true,
        canActivateThreadOwner: true,
        controllers: [],
        owners: [
          {
            ownerId: "owner-a",
            threadId: "thread-a",
            projectId: "project-a",
            active: true,
          },
        ],
        tabs: [
          {
            tabId: target.tabId,
            threadId: "thread-a",
            projectId: "project-a",
            url: "https://example.test/next",
            title: "Next",
            connected: true,
            active: true,
            navigationEpoch: nextTarget.navigationEpoch,
          },
        ],
      });
      const observedTarget = forged
        ? { ...nextTarget, tabId: "foreign-tab" }
        : nextTarget;
      const outcome = forged
        ? expect(result).rejects.toMatchObject({
            name: "BrowserControlTargetChangedError",
          })
        : expect(result).resolves.toMatchObject({
            kind: "navigation",
            target,
            originalTarget: target,
            observedTarget: nextTarget,
          });
      expect(
        hub.recordBrowserControlResponse(socket, {
          type: "browser-control-response",
          requestId: request.requestId,
          target,
          observedTarget: nextTarget,
          ok: true,
          value: {
            kind: "navigation",
            url: "https://example.test/next",
            phase: "commit",
            sameDocument: false,
            target,
            originalTarget: target,
            observedTarget,
          },
        }),
      ).toBe(!forged);
      await outcome;
    },
  );

  it("rejects a wait result with the right kind but a URL outside its criteria", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: {
        kind: "wait",
        criteria: {
          kind: "url",
          url: "https://expected.test/*",
          match: "glob",
        },
      },
      timeoutMs: 1_000,
    });
    const outcome = expect(result).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });
    const request = latestRequest(socket);
    hub.recordBrowserControlResponse(socket, {
      type: "browser-control-response",
      requestId: request.requestId,
      target,
      ok: true,
      value: { kind: "url", target, url: "https://foreign.test/" },
    });
    await outcome;
  });
  it("rejects a malformed typed wait result", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const result = hub.runBrowserControl({
      target,
      action: {
        kind: "wait",
        criteria: { kind: "url", url: "https://example.test/", match: "exact" },
      },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    expect(
      hub.recordBrowserControlResponse(socket, {
        type: "browser-control-response",
        requestId: request.requestId,
        target,
        ok: true,
        value: { kind: "url", target },
      }),
    ).toBe(false);
    await expect(result).rejects.toMatchObject({
      name: "BrowserControlTargetChangedError",
    });
  });

  it("preserves nullable root ownership while running Browser control", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.updateBrowserClient(socket, {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      controllers: [],
      owners: [
        {
          ownerId: "root-owner",
          threadId: null,
          projectId: null,
          active: true,
        },
      ],
      tabs: [
        {
          tabId: target.tabId,
          threadId: null,
          projectId: null,
          url: "https://example.test/",
          title: "Example",
          connected: true,
          active: true,
          navigationEpoch: target.navigationEpoch,
        },
      ],
    });
    const result = hub.runBrowserControl({
      target,
      action: { kind: "snapshot", mode: "dom" },
      timeoutMs: 1_000,
    });
    const request = latestRequest(socket);
    expect(
      hub.recordBrowserControlResponse(socket, {
        type: "browser-control-response",
        requestId: request.requestId,
        target,
        ok: true,
        value: { html: "<main />" },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ html: "<main />" });
  });

  it("creates, reads, and releases a bounded native capture", async () => {
    const hub = new NotificationHub();
    const socket = registerTab(hub);
    const creating = hub.createBrowserCapture({
      clientId: target.clientId,
      windowId: target.windowId,
      tabId: target.tabId,
      mode: "viewport",
      expectedNavigationEpoch: target.navigationEpoch,
      timeoutMs: 1_000,
    });
    const createRequest = JSON.parse(socket.messages.at(-1) ?? "null") as {
      requestId: string;
    };
    expect(
      hub.recordBrowserCaptureCreated(socket, {
        type: "browser-capture-created",
        requestId: createRequest.requestId,
        ok: true,
        captureId: "capture-a",
        format: "png",
        pixelSize: { width: 1, height: 1 },
        byteLength: 4,
        navigationEpoch: target.navigationEpoch,
      }),
    ).toBe(true);
    const descriptor = await creating;
    const reading = hub.readBrowserCapture({
      clientId: target.clientId,
      windowId: target.windowId,
      tabId: target.tabId,
      captureId: descriptor.captureId,
      offset: 0,
      length: 4,
      timeoutMs: 1_000,
    });
    const readRequest = JSON.parse(socket.messages.at(-1) ?? "null") as {
      requestId: string;
    };
    expect(
      hub.recordBrowserCaptureChunk(socket, {
        type: "browser-capture-chunk",
        requestId: readRequest.requestId,
        tabId: target.tabId,
        captureId: descriptor.captureId,
        offset: 0,
        base64: "AQIDBA==",
        eof: true,
        ok: true,
      }),
    ).toBe(true);
    await expect(reading).resolves.toEqual({
      captureId: descriptor.captureId,
      offset: 0,
      base64: "AQIDBA==",
      eof: true,
    });
    hub.releaseBrowserCapture({
      clientId: target.clientId,
      windowId: target.windowId,
      tabId: target.tabId,
      captureId: descriptor.captureId,
    });
    expect(JSON.parse(socket.messages.at(-1) ?? "null")).toMatchObject({
      type: "browser-capture-release",
      tabId: target.tabId,
      captureId: descriptor.captureId,
    });
  });
});
