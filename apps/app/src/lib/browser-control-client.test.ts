import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserCaptureRegisteredMessage,
  BrowserControlCancelMessage,
  BrowserControlRequestMessage,
  BrowserOpenTabRequestMessage,
  BrowserOpenTabResponseMessage,
  BrowserPluginRequestMessage,
  BrowserPluginResponseMessage,
} from "@bb/server-contract";

const socket = vi.hoisted(() => ({
  captureRegistered: null as
    | ((message: BrowserCaptureRegisteredMessage) => void)
    | null,
  sendBrowserCaptureRegister: vi.fn(),
  sendBrowserCaptureRelease: vi.fn(),
  cancel: null as ((message: BrowserControlCancelMessage) => void) | null,
  captureChunkResponse: null as
    | ((message: {
        type: "browser-capture-chunk";
        requestId: string;
        tabId: string;
        captureId: string;
        offset: number;
        base64: string;
        eof: boolean;
      }) => void)
    | null,
  captureReadRequest: null as
    | ((message: {
        type: "browser-capture-read";
        requestId: string;
        tabId: string;
        captureId: string;
        offset: number;
        length: number;
      }) => void)
    | null,
  captureRelease: null as
    | ((message: {
        type: "browser-capture-release";
        requestId: string;
        tabId: string;
        captureId: string;
      }) => void)
    | null,
  connected: null as (() => void) | null,
  connectionState: "connected" as "connected" | "connecting" | "reconnecting",
  connectionStateChanged: null as (() => void) | null,
  captureCreate: null as
    | ((message: {
        type: "browser-capture-create";
        requestId: string;
        tabId: string;
        format?: "png" | "jpeg";
        quality?: number;
        expectedNavigationEpoch: number;
        mode: "viewport" | "full-page" | "element";
        locator?: unknown;
      }) => void)
    | null,
  openRequest: null as ((message: BrowserOpenTabRequestMessage) => void) | null,
  pluginRequest: null as
    | ((message: BrowserPluginRequestMessage) => void)
    | null,
  request: null as ((message: BrowserControlRequestMessage) => void) | null,
  sendBrowserCaptureChunk: vi.fn(),
  sendBrowserCaptureCreated: vi.fn(),
  sendBrowserClientState: vi.fn(),
  sendBrowserControlResponse: vi.fn(),
  sendBrowserOpenTabResponse:
    vi.fn<(message: BrowserOpenTabResponseMessage) => void>(),
  sendBrowserPluginResponse:
    vi.fn<(message: BrowserPluginResponseMessage) => void>(),
}));

vi.mock("./ws", () => ({
  wsManager: {
    onBrowserCaptureRegistered(
      listener: (message: BrowserCaptureRegisteredMessage) => void,
    ) {
      socket.captureRegistered = listener;
      return () => undefined;
    },
    sendBrowserCaptureRegister: socket.sendBrowserCaptureRegister,
    sendBrowserCaptureRelease: socket.sendBrowserCaptureRelease,
    onBrowserControlCancel(
      listener: (message: BrowserControlCancelMessage) => void,
    ) {
      socket.cancel = listener;
      return () => undefined;
    },
    onBrowserOpenTabRequest(
      listener: (message: BrowserOpenTabRequestMessage) => void,
    ) {
      socket.openRequest = listener;
      return () => undefined;
    },
    onBrowserControlRequest(
      listener: (message: BrowserControlRequestMessage) => void,
    ) {
      socket.request = listener;
      return () => undefined;
    },
    onConnected(listener: () => void) {
      socket.connected = listener;
      return () => undefined;
    },
    onConnectionStateChange(listener: () => void) {
      socket.connectionStateChanged = listener;
      return () => undefined;
    },
    getConnectionState() {
      return socket.connectionState;
    },
    onBrowserPluginRequest(
      listener: (message: BrowserPluginRequestMessage) => void,
    ) {
      socket.pluginRequest = listener;
      return () => undefined;
    },
    onBrowserCaptureReadRequest(
      listener: (message: {
        type: "browser-capture-read";
        requestId: string;
        tabId: string;
        captureId: string;
        offset: number;
        length: number;
      }) => void,
    ) {
      socket.captureReadRequest = listener;
      return () => undefined;
    },
    onBrowserCaptureCreate(
      listener: (message: {
        type: "browser-capture-create";
        requestId: string;
        tabId: string;
        format?: "png" | "jpeg";
        quality?: number;
        expectedNavigationEpoch: number;
        mode: "viewport" | "full-page" | "element";
        locator?: unknown;
      }) => void,
    ) {
      socket.captureCreate = listener;
      return () => undefined;
    },
    onBrowserCaptureRelease(
      listener: (message: {
        type: "browser-capture-release";
        requestId: string;
        tabId: string;
        captureId: string;
      }) => void,
    ) {
      socket.captureRelease = listener;
      return () => undefined;
    },
    onBrowserCaptureChunk(
      listener: (message: {
        type: "browser-capture-chunk";
        requestId: string;
        tabId: string;
        captureId: string;
        offset: number;
        base64: string;
        eof: boolean;
      }) => void,
    ) {
      socket.captureChunkResponse = listener;
      return () => undefined;
    },
    sendBrowserClientState: socket.sendBrowserClientState,
    sendBrowserCaptureChunk: socket.sendBrowserCaptureChunk,
    sendBrowserCaptureCreated: socket.sendBrowserCaptureCreated,
    sendBrowserControlResponse: socket.sendBrowserControlResponse,
    sendBrowserOpenTabResponse: socket.sendBrowserOpenTabResponse,
    sendBrowserPluginResponse: socket.sendBrowserPluginResponse,
  },
}));

import {
  type BrowserControlOwnerRegistration,
  browserControlActivitySnapshot,
  registerBrowserCapture,
  registerBrowserControllerRequestHandler,
  registerBrowserControlOwner,
  registerBrowserControlTab,
  registerBrowserThreadOwnerActivator,
  subscribeBrowserControlActivity,
  waitForBrowserControlTab,
} from "./browser-control-client";

function request(overrides: Partial<BrowserControlRequestMessage> = {}) {
  const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
  const tab = state.tabs[0];
  return {
    type: "browser-control-request" as const,
    requestId: overrides.requestId ?? "request-a",
    target: {
      clientId: state.clientId,
      windowId: state.windowId,
      tabId: tab.tabId,
      navigationEpoch: tab.navigationEpoch,
    },
    action: overrides.action ?? {
      kind: "snapshot" as const,
      mode: "interactive" as const,
    },
    actionabilityPolicy: overrides.actionabilityPolicy ?? {
      timeoutMs: 1_000,
      pollIntervalMs: 50,
      stableFrameCount: 2,
    },
  };
}

describe("Browser control client", () => {
  beforeEach(() => {
    socket.connectionState = "connected";
    socket.sendBrowserClientState.mockClear();
    socket.sendBrowserControlResponse.mockClear();
    socket.sendBrowserOpenTabResponse.mockClear();
    socket.sendBrowserCaptureRegister.mockClear();
    socket.sendBrowserCaptureRelease.mockClear();
    socket.sendBrowserPluginResponse.mockClear();
    socket.sendBrowserCaptureChunk.mockClear();
    socket.sendBrowserCaptureCreated.mockClear();
  });

  it("opens the first Browser tab through a registered panel owner", async () => {
    const stateBefore = socket.sendBrowserClientState.mock.calls.length;
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-first",
      navigationEpoch: 0,
    }));
    const registration = registerBrowserControlOwner({
      activateTab: vi.fn(async () => ({
        clientId: "client-a",
        windowId: "window-a",
        tabId: "tab-first",
        navigationEpoch: 0,
      })),
      closeTab: vi.fn(),
      active: true,
      openTab,
      ownerId: "owner-a",
      projectId: "project-a",
      threadId: "thread-a",
      tabs: [],
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    expect(socket.sendBrowserClientState.mock.calls.length).toBe(
      stateBefore + 1,
    );
    expect(state).toMatchObject({
      tabs: [],
      owners: [
        {
          active: true,
          ownerId: "owner-a",
          projectId: "project-a",
          threadId: "thread-a",
        },
      ],
    });

    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "owner",
      requestId: "open-a",
      clientId: state.clientId,
      windowId: state.windowId,
      ownerId: "owner-a",
      url: "file:///Users/test/page.html",
    });

    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith({
        type: "browser-open-tab-response",
        requestId: "open-a",
        clientId: state.clientId,
        windowId: state.windowId,
        ownerId: "owner-a",
        ok: true,
        target: {
          clientId: "client-a",
          windowId: "window-a",
          tabId: "tab-first",
          navigationEpoch: 0,
        },
      }),
    );
    expect(openTab).toHaveBeenCalledWith("file:///Users/test/page.html", {
      signal: expect.any(AbortSignal),
    });

    registration.dispose();
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({ owners: [] }),
    );
  });

  it("activates and mounts a requested thread before creating its first tab", async () => {
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-first",
      navigationEpoch: 0,
    }));
    let ownerRegistration: BrowserControlOwnerRegistration | undefined;
    const activate = vi.fn(async ({ projectId, threadId }) => {
      ownerRegistration = registerBrowserControlOwner({
        activateTab: vi.fn(),
        active: true,
        closeTab: vi.fn(),
        openTab,
        ownerId: `thread:${threadId}`,
        projectId,
        tabs: [],
        threadId,
      });
    });
    const activatorRegistration = registerBrowserThreadOwnerActivator({
      activate,
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];

    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "thread",
      requestId: "open-thread-a",
      clientId: state.clientId,
      windowId: state.windowId,
      threadId: "thread-a",
      projectId: "project-a",
      url: "https://example.test/thread-a",
    });

    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith({
        type: "browser-open-tab-response",
        requestId: "open-thread-a",
        clientId: state.clientId,
        windowId: state.windowId,
        ownerId: "thread:thread-a",
        ok: true,
        target: {
          clientId: "client-a",
          windowId: "window-a",
          tabId: "tab-first",
          navigationEpoch: 0,
        },
      }),
    );
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        threadId: "thread-a",
      }),
    );
    expect(openTab).toHaveBeenCalledWith("https://example.test/thread-a", {
      signal: expect.any(AbortSignal),
    });

    ownerRegistration?.dispose();
    activatorRegistration.dispose();
  });

  it("cancels thread activation before a late owner can create a tab", async () => {
    const openTab = vi.fn();
    const activatorRegistration = registerBrowserThreadOwnerActivator({
      activate: vi.fn(async () => undefined),
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "thread",
      requestId: "open-cancelled",
      clientId: state.clientId,
      windowId: state.windowId,
      threadId: "thread-late",
      projectId: "project-a",
      url: "https://example.test/late",
    });
    await vi.waitFor(() => expect(socket.cancel).not.toBeNull());
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "open-cancelled",
      reason: "timeout",
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "open-cancelled",
          ok: false,
          error: expect.objectContaining({ code: "AbortError" }),
        }),
      ),
    );

    const lateOwner = registerBrowserControlOwner({
      activateTab: vi.fn(),
      active: true,
      closeTab: vi.fn(),
      openTab,
      ownerId: "thread:thread-late",
      projectId: "project-a",
      tabs: [],
      threadId: "thread-late",
    });
    await Promise.resolve();
    expect(openTab).not.toHaveBeenCalled();

    lateOwner.dispose();
    activatorRegistration.dispose();
  });

  it("advertises inactive owner tabs without making them actionable", () => {
    const registration = registerBrowserControlOwner({
      activateTab: vi.fn(),
      active: true,
      closeTab: vi.fn(),
      openTab: vi.fn(),
      ownerId: "owner-inactive",
      projectId: "project-a",
      tabs: [],
      threadId: "thread-a",
    });
    registration.updateTabs([
      {
        tabId: "tab-inactive",
        title: "Inactive",
        url: "https://inactive.example.test/",
      },
    ]);
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            tabId: "tab-inactive",
            connected: false,
            active: false,
            navigationEpoch: 0,
          }),
        ],
      }),
    );
    registration.dispose();
  });

  it("settles concurrent tab registration waiters independently of a sibling timeout", async () => {
    const first = waitForBrowserControlTab("tab-concurrent");
    const second = waitForBrowserControlTab("tab-concurrent");
    const firstSettled = { done: false };
    const secondSettled = { done: false };
    void first.then(() => {
      firstSettled.done = true;
    });
    void second.then(() => {
      secondSettled.done = true;
    });
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-concurrent",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-concurrent",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    await Promise.resolve();
    expect(firstSettled.done).toBe(false);
    expect(secondSettled.done).toBe(false);
    registration.update({
      active: true,
      state: {
        navigationEpoch: 1,
        tabId: "tab-concurrent",
        title: "Ready",
        url: "https://example.test/",
      } as never,
      url: "https://example.test/",
    });
    await expect(first).resolves.toMatchObject({
      tabId: "tab-concurrent",
      navigationEpoch: 1,
    });
    await expect(second).resolves.toMatchObject({
      tabId: "tab-concurrent",
      navigationEpoch: 1,
    });
    registration.dispose();
  });

  it("rejects only the aborted registration waiter and keeps its sibling pending", async () => {
    const controller = new AbortController();
    const aborted = waitForBrowserControlTab("tab-sibling", {
      signal: controller.signal,
    });
    const pending = waitForBrowserControlTab("tab-sibling");
    const pendingSettled = { done: false };
    void pending.then(() => {
      pendingSettled.done = true;
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(pendingSettled.done).toBe(false);
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-sibling",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-sibling",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    registration.update({
      active: true,
      state: {
        navigationEpoch: 2,
        tabId: "tab-sibling",
        title: "Ready",
        url: "https://example.test/",
      } as never,
      url: "https://example.test/",
    });
    await expect(pending).resolves.toMatchObject({
      tabId: "tab-sibling",
      navigationEpoch: 2,
    });
    registration.dispose();
  });

  it("waits for native navigation state before returning a new target", async () => {
    const targetPromise = waitForBrowserControlTab("tab-ready");
    let settled = false;
    void targetPromise.then(() => {
      settled = true;
    });
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-ready",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-ready",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    registration.update({
      active: true,
      state: {
        navigationEpoch: 1,
        tabId: "tab-ready",
        title: "Ready",
        url: "https://example.test/",
      } as never,
      url: "https://example.test/",
    });
    await expect(targetPromise).resolves.toMatchObject({
      tabId: "tab-ready",
      navigationEpoch: 1,
    });
    registration.dispose();
  });

  it("runs tab lifecycle actions through a background thread owner", async () => {
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-sibling",
      navigationEpoch: 0,
    }));
    const activateTab = vi.fn(async (tabId: string) => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId,
      navigationEpoch: 9,
    }));
    const closeTab = vi.fn();
    const ownerRegistration = registerBrowserControlOwner({
      activateTab,
      active: false,
      closeTab,
      openTab,
      ownerId: "owner-a",
      projectId: "project-a",
      threadId: "thread-a",
      tabs: [],
    });
    const tabRegistration = registerBrowserControlTab({
      active: false,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_closeBrowserTab: vi.fn(async () => ({
          navigationEpoch: 7,
        })),
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "open-sibling",
        action: { kind: "open-tab", url: "https://second.example.test/" },
      }),
    );

    await vi.waitFor(() =>
      expect(openTab).toHaveBeenCalledWith("https://second.example.test/", {
        signal: expect.any(AbortSignal),
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "open-sibling",
          ok: true,
          value: expect.objectContaining({ tabId: "tab-sibling" }),
        }),
      ),
    );
    socket.request?.(
      request({
        requestId: "activate-previous",
        action: { kind: "activate-tab", tabId: "tab-previous" },
      }),
    );
    await vi.waitFor(() =>
      expect(activateTab).toHaveBeenCalledWith("tab-previous", {
        signal: expect.any(AbortSignal),
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "activate-previous",
          ok: true,
          value: expect.objectContaining({
            tabId: "tab-previous",
            navigationEpoch: 9,
          }),
        }),
      ),
    );
    socket.request?.(
      request({
        requestId: "close-active",
        action: { kind: "close-tab" },
      }),
    );
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "close-active",
          ok: true,
          value: expect.objectContaining({
            closed: expect.objectContaining({ tabId: "tab-a" }),
          }),
        }),
      ),
    );

    tabRegistration.dispose();
    ownerRegistration.dispose();
  });

  it("publishes an exact tab target and runs a request through the isolated runtime", async () => {
    const run = vi.fn(
      async (_request: unknown, _options: { signal?: AbortSignal }) => ({
        requestId: "page-request",
        navigationEpoch: 7,
        value: { nodes: [{ name: "Invite member" }] },
      }),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://fallback.test/",
    });

    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "browser-client-state",
        tabs: [
          expect.objectContaining({
            tabId: "tab-a",
            threadId: "thread-a",
            projectId: "project-a",
            navigationEpoch: 7,
          }),
        ],
      }),
    );

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      tabId: "tab-a",
      input: { kind: "snapshot", mode: "interactive" },
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "request-a",
          ok: true,
          value: { nodes: [{ name: "Invite member" }] },
        }),
      ),
    );

    registration.update({
      active: false,
      state: {
        tabId: "tab-a",
        url: "https://example.test/next",
        title: "Next",
        navigationEpoch: 8,
      } as never,
      url: "https://example.test/next",
    });
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            url: "https://example.test/next",
            active: false,
            navigationEpoch: 8,
          }),
        ],
      }),
    );
    expect(
      socket.sendBrowserClientState.mock.calls
        .slice(0, -1)
        .some(
          (call) =>
            (call as unknown as [{ tabs: unknown[] }])[0].tabs.length === 0,
        ),
    ).toBe(false);

    registration.dispose();
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabs: [] }),
    );
  });
  it("rejects blocked navigation before invoking the desktop bridge", async () => {
    const navigate = vi.fn();
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    socket.request?.(
      request({
        requestId: "blocked-navigation",
        action: { kind: "navigate", url: "javascript:alert(1)" },
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "blocked-navigation",
          ok: false,
          error: expect.objectContaining({
            message: "Browser navigation URL is not allowed",
          }),
        }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("lists, imports, and explicitly clears native browser profile cookies", async () => {
    const listCookieImportSources = vi.fn(async () => ({
      sources: [
        {
          family: "chrome",
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    }));
    const importCookiesFromBrowser = vi.fn(async () => ({
      importedCookies: 12,
    }));
    const clearImportedCookies = vi.fn(async () => undefined);
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_clearImportedCookies: clearImportedCookies,
        experimental_importCookiesFromBrowser: importCookiesFromBrowser,
        experimental_listCookieImportSources: listCookieImportSources,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "list-cookie-sources",
        action: { kind: "list-cookie-import-sources" },
      }),
    );
    await vi.waitFor(() =>
      expect(listCookieImportSources).toHaveBeenCalledOnce(),
    );
    socket.request?.(
      request({
        requestId: "import-profile-cookies",
        action: {
          kind: "import-cookies-from-browser",
          family: "chrome",
          profileId: "Default",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(importCookiesFromBrowser).toHaveBeenCalledWith({
        tabId: "tab-a",
        family: "chrome",
        profileId: "Default",
      }),
    );
    socket.request?.(
      request({
        requestId: "clear-profile-cookies",
        action: { kind: "clear-imported-cookies", confirm: true },
      }),
    );
    await vi.waitFor(() =>
      expect(clearImportedCookies).toHaveBeenCalledWith({ tabId: "tab-a" }),
    );
    await vi.waitFor(() => {
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "import-profile-cookies",
          ok: true,
          value: { importedCookies: 12 },
        }),
      );
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "clear-profile-cookies",
          ok: true,
          value: { cleared: true },
        }),
      );
    });
    registration.dispose();
  });

  it("cancels one concurrent request and exposes visible per-tab activity", async () => {
    let observedSignal: AbortSignal | undefined;
    const run = vi.fn(
      async (_request: unknown, options: { signal?: AbortSignal }) => {
        observedSignal = options.signal;
        await new Promise((_resolve, reject) =>
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        );
        return null as never;
      },
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    const activity = vi.fn();
    const unsubscribe = subscribeBrowserControlActivity(activity);

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(browserControlActivitySnapshot("tab-a")).toBe(1);
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "request-a",
      reason: "cancelled",
    });
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );
    expect(activity).toHaveBeenCalled();
    expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-a",
        ok: false,
        error: expect.objectContaining({ code: "AbortError" }),
      }),
    );

    unsubscribe();
    registration.dispose();
  });

  it("cancels active work when the Browser client disconnects", async () => {
    let observedSignal: AbortSignal | undefined;
    const run = vi.fn(
      async (_request: unknown, options: { signal?: AbortSignal }) => {
        observedSignal = options.signal;
        await new Promise((_resolve, reject) =>
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("disconnected", "AbortError")),
            { once: true },
          ),
        );
        return null as never;
      },
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    socket.connectionState = "reconnecting";
    socket.connectionStateChanged?.();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );

    registration.dispose();
  });

  it("binds screenshots and explicit main-world scripts to one page revision", async () => {
    const run = vi.fn(async () => ({
      requestId: "page-request",
      navigationEpoch: 7,
      value: { component: "InviteButton" },
    }));
    const capture = vi.fn(async () => ({
      captureId: "capture-screenshot",
      navigationEpoch: 7,
      format: "png" as const,
      pixelSize: { width: 1200, height: 800 },
      byteLength: 4,
    }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
        experimental_captureBrowserPage: capture,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "script-request",
        action: {
          kind: "script",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
          input: null,
          timeoutMs: 1_000,
        },
      }),
    );
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "tab-a",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
        }),
        { signal: expect.any(AbortSignal) },
      ),
    );

    socket.request?.(
      request({
        requestId: "screenshot-request",
        action: { kind: "screenshot", format: "png" },
      }),
    );
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith(
        {
          tabId: "tab-a",
          requestId: expect.any(String),
          format: "png",
          quality: 85,
          expectedNavigationEpoch: 7,
        },
        { signal: expect.any(AbortSignal) },
      ),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "screenshot-request",
          ok: true,
          value: expect.objectContaining({ navigationEpoch: 7 }),
        }),
      ),
    );

    registration.dispose();
  });

  it("checks through trusted native input without a DOM click fallback", async () => {
    const run = vi.fn(async () => ({
      requestId: "check-request",
      navigationEpoch: 7,
      value: {
        x: 120,
        y: 48,
        tag: "input",
        inputType: "checkbox",
        needsClick: true,
      },
    }));
    const sendTrusted = vi.fn(async () => ({ navigationEpoch: 7 }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
        experimental_sendBrowserTrustedInput: sendTrusted,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "check-request",
        action: {
          kind: "check",
          locator: { selectors: ["input[type=checkbox]"] },
        },
      }),
    );

    await vi.waitFor(() =>
      expect(sendTrusted).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "tab-a",
          expectedNavigationEpoch: 7,
          action: expect.objectContaining({ kind: "click", x: 120, y: 48 }),
        }),
        { signal: expect.any(AbortSignal) },
      ),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "check-request",
          ok: true,
          value: { checked: true, type: "checkbox" },
        }),
      ),
    );
    registration.dispose();
  });

  it.each(["clientId", "windowId", "navigationEpoch"] as const)(
    "rejects a request for a stale %s target field",
    async (field) => {
      const run = vi.fn();
      const registration = registerBrowserControlTab({
        active: true,
        desktopBrowser: {
          experimental_browserControlVersion: 2,
          navigate: vi.fn(),
          experimental_runBrowserPageScript: run,
        } as never,
        projectId: null,
        state: {
          tabId: "tab-a",
          url: "https://example.test/",
          title: "Example",
          navigationEpoch: 7,
        } as never,
        tabId: "tab-a",
        threadId: null,
        url: "https://example.test/",
      });
      const stale = request();
      const observedTarget = { ...stale.target, navigationEpoch: 7 };
      if (field === "clientId") stale.target.clientId = "other-client";
      else if (field === "windowId") stale.target.windowId = "other-window";
      else stale.target.navigationEpoch = 6;
      socket.request?.(stale);
      await vi.waitFor(() =>
        expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith({
          type: "browser-control-response",
          requestId: "request-a",
          target: stale.target,
          observedTarget,
          ok: false,
          error: {
            code: "BrowserControlTargetChangedError",
            message: "The target Browser tab is no longer at that page revision",
          },
        }),
      );
      expect(run).not.toHaveBeenCalled();
      registration.dispose();
    },
  );

  it("rejects all registration waiters exactly once when a provisional tab is disposed", async () => {
    const first = waitForBrowserControlTab("tab-provisional");
    const second = waitForBrowserControlTab("tab-provisional");
    const firstSettled = { count: 0 };
    const secondSettled = { count: 0 };
    void first.catch(() => {
      firstSettled.count += 1;
    });
    void second.catch(() => {
      secondSettled.count += 1;
    });
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-provisional",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-provisional",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    registration.dispose();
    await expect(first).rejects.toThrow("disposed");
    await expect(second).rejects.toThrow("disposed");
    expect(firstSettled.count).toBe(1);
    expect(secondSettled.count).toBe(1);
    const unrelated = waitForBrowserControlTab("tab-unrelated");
    const sibling = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-unrelated",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-unrelated",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    sibling.update({
      active: true,
      state: {
        navigationEpoch: 1,
        tabId: "tab-unrelated",
        title: "Ready",
        url: "https://example.test/",
      } as never,
      url: "https://example.test/",
    });
    await expect(unrelated).resolves.toMatchObject({
      tabId: "tab-unrelated",
      navigationEpoch: 1,
    });
    sibling.dispose();
  });

  it("keeps a sibling waiter when one waiter is aborted before tab disposal", async () => {
    const controller = new AbortController();
    const aborted = waitForBrowserControlTab("tab-abort-sibling", {
      signal: controller.signal,
    });
    const kept = waitForBrowserControlTab("tab-abort-sibling");
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
      } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-abort-sibling",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-abort-sibling",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    registration.dispose();
    await expect(kept).rejects.toThrow("disposed");
  });

  it("aborts an in-flight owner open without a ghost tab and with one failure response", async () => {
    let openStarted: (() => void) | undefined;
    const openTab = vi.fn(
      (_url: string, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
          openStarted?.();
        }),
    );
    const registration = registerBrowserControlOwner({
      activateTab: vi.fn(),
      active: true,
      closeTab: vi.fn(),
      openTab,
      ownerId: "owner-abort",
      projectId: "project-a",
      tabs: [],
      threadId: "thread-a",
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "owner",
      requestId: "open-abort",
      clientId: state.clientId,
      windowId: state.windowId,
      ownerId: "owner-abort",
      url: "https://example.test/slow",
    });
    await vi.waitFor(() => {
      expect(openTab).toHaveBeenCalledTimes(1);
    });
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "open-abort",
      reason: "cancelled",
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledTimes(1),
    );
    expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "open-abort",
        ok: false,
      }),
    );
    expect(
      (socket.sendBrowserOpenTabResponse.mock.calls[0]?.[0] as { ok?: boolean })
        .ok,
    ).toBe(false);
    registration.dispose();
  });

  it("cancels an in-flight native capture create and releases the late capture", async () => {
    const release = vi.fn();
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        experimental_browserControlVersion: 2,
        navigate: vi.fn(),
        experimental_captureBrowserPage: vi.fn(async () => ({
          captureId: "capture-late",
          navigationEpoch: 7,
          format: "png",
          pixelSize: { width: 1, height: 1 },
          byteLength: 4,
        })),
        experimental_releaseBrowserCapture: release,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    socket.captureCreate?.({
      type: "browser-capture-create",
      requestId: "capture-abort",
      tabId: "tab-a",
      mode: "viewport",
      expectedNavigationEpoch: 7,
    });
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "capture-abort",
      reason: "cancelled",
    });
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    registration.dispose();
  });
  it("rejects queued and running requests from a replaced controller generation", async () => {
    const tab = registerBrowserControlTab({
      active: true,
      desktopBrowser: { experimental_browserControlVersion: 2 } as never,
      projectId: "project-a",
      threadId: "thread-a",
      tabId: "generation-tab",
      url: "https://example.test/",
      state: {
        tabId: "generation-tab",
        navigationEpoch: 7,
        title: "Example",
        url: "https://example.test/",
      } as never,
    });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const old = vi.fn(async (_request: { signal: AbortSignal }) => {
      await pending;
      return "old";
    });
    const unregisterOld = registerBrowserControllerRequestHandler(
      "plugin-a",
      "controller",
      "generation-tab",
      old,
    );
    const first = socket.sendBrowserClientState.mock.calls.at(-1)![0];
    const original = first.controllers.find(
      (entry: { controllerId: string }) => entry.controllerId === "controller",
    );
    const target = {
      clientId: first.clientId,
      windowId: first.windowId,
      tabId: "generation-tab",
      navigationEpoch: 7,
    };
    const message: BrowserPluginRequestMessage = {
      type: "browser-plugin-request",
      requestId: "running-old",
      pluginId: "plugin-a",
      controllerId: "controller",
      registrationId: original.registrationId,
      target,
      input: null,
    };
    socket.pluginRequest?.(message);
    await vi.waitFor(() => expect(old).toHaveBeenCalledTimes(1));
    const next = vi.fn(async () => "new");
    const unregisterNext = registerBrowserControllerRequestHandler(
      "plugin-a",
      "controller",
      "generation-tab",
      next,
    );
    try {
      expect(old.mock.calls[0]![0].signal.aborted).toBe(true);
      socket.pluginRequest?.({ ...message, requestId: "queued-old" });
      finish();
      await vi.waitFor(() =>
        expect(socket.sendBrowserPluginResponse).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "running-old", ok: false }),
        ),
      );
      expect(socket.sendBrowserPluginResponse).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "queued-old", ok: false }),
      );
      expect(next).not.toHaveBeenCalled();
      unregisterOld();
      const current = socket.sendBrowserClientState.mock.calls
        .at(-1)![0]
        .controllers.find(
          (entry: { controllerId: string }) =>
            entry.controllerId === "controller",
        );
      socket.pluginRequest?.({
        ...message,
        requestId: "current",
        registrationId: current.registrationId,
      });
      await vi.waitFor(() =>
        expect(socket.sendBrowserPluginResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId: "current",
            ok: true,
            value: "new",
          }),
        ),
      );
    } finally {
      finish();
      unregisterOld();
      unregisterNext();
      tab.dispose();
    }
  });

  it("releases cancelled generated captures and rejects reads after a late acknowledgement", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 3, close: vi.fn() })),
    );
    const tab = registerBrowserControlTab({
      active: true,
      desktopBrowser: { experimental_browserControlVersion: 2 } as never,
      projectId: "project-a",
      threadId: "thread-a",
      tabId: "generated-tab",
      url: "https://example.test/",
      state: {
        tabId: "generated-tab",
        navigationEpoch: 7,
        title: "Example",
        url: "https://example.test/",
      } as never,
    });
    try {
      const state = socket.sendBrowserClientState.mock.calls.at(-1)![0];
      const controller = new AbortController();
      const result = registerBrowserCapture(
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        {
          target: {
            clientId: state.clientId,
            windowId: state.windowId,
            tabId: "generated-tab",
            navigationEpoch: 7,
          },
          signal: controller.signal,
        },
      );
      const rejected = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.waitFor(() =>
        expect(socket.sendBrowserCaptureRegister).toHaveBeenCalledTimes(1),
      );
      const sent = socket.sendBrowserCaptureRegister.mock.calls[0]![0];
      controller.abort();
      await rejected;
      expect(socket.sendBrowserCaptureRelease).toHaveBeenCalledTimes(1);
      socket.captureRegistered?.({
        type: "browser-capture-registered",
        requestId: sent.requestId,
        captureId: sent.captureId,
        ok: true,
        expiresAt: 2_100_000_000_000,
      });
      socket.captureReadRequest?.({
        type: "browser-capture-read",
        requestId: "released-read",
        tabId: "generated-tab",
        captureId: sent.captureId,
        offset: 0,
        length: 3,
      });
      await vi.waitFor(() =>
        expect(socket.sendBrowserCaptureChunk).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "released-read", ok: false }),
        ),
      );
      expect(socket.sendBrowserCaptureRelease).toHaveBeenCalledTimes(1);
    } finally {
      tab.dispose();
      vi.unstubAllGlobals();
    }
  });
});
