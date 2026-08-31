import { describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
  BbDesktopWindowIdentity,
} from "@bb/desktop-contract";
import type {
  BrowserAutomationCancelMessage,
  BrowserAutomationCommandMessage,
  BrowserAutomationCommandResult,
  BrowserAutomationCloseMessage,
  BrowserAutomationOpenMessage,
} from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import {
  createBrowserAutomationClient,
  type BrowserAutomationClient,
  type BrowserAutomationThreadHost,
  type BrowserAutomationTransport,
} from "./browser-automation-client";
import type {
  BrowserAutomationClientReply,
  WebSocketConnectedEvent,
} from "./ws";

interface FakeTransport extends BrowserAutomationTransport {
  capabilities: Array<string | null>;
  emitCancel(message: BrowserAutomationCancelMessage): void;
  emitCommand(message: BrowserAutomationCommandMessage): void;
  emitClose(message: BrowserAutomationCloseMessage): void;
  emitConnected(event: WebSocketConnectedEvent): void;
  emitDisconnected(): void;
  emitOpen(message: BrowserAutomationOpenMessage): void;
  replies: BrowserAutomationClientReply[];
}

interface FakeDesktopBrowser {
  api: BbDesktopBrowserApi;
  emitState(state: BbDesktopBrowserState): void;
  stateListenerCount(): number;
}

interface FakeThreadHost extends BrowserAutomationThreadHost {
  closedTabIds: string[];
  openedUrls: string[];
  reveals: number;
}

interface Harness {
  client: BrowserAutomationClient;
  desktop: FakeDesktopBrowser;
  host: FakeThreadHost;
  stop: () => void;
  transport: FakeTransport;
  unregisterHost: () => void;
}

interface CreateHarnessOptions {
  desktopBrowser?: BbDesktopBrowserApi | null;
  identity?: BbDesktopWindowIdentity | null;
  registerHost?: boolean;
  transport?: FakeTransport;
}

function createFakeTransport(): FakeTransport {
  const openListeners = new Set<
    (message: BrowserAutomationOpenMessage) => void
  >();
  const closeListeners = new Set<
    (message: BrowserAutomationCloseMessage) => void
  >();
  const commandListeners = new Set<
    (message: BrowserAutomationCommandMessage) => void
  >();
  const cancelListeners = new Set<
    (message: BrowserAutomationCancelMessage) => void
  >();
  const connectedListeners = new Set<
    (event: WebSocketConnectedEvent) => void
  >();
  const disconnectedListeners = new Set<() => void>();
  const replies: BrowserAutomationClientReply[] = [];
  const capabilities: Array<string | null> = [];
  return {
    capabilities,
    replies,
    clearCapability() {
      capabilities.push(null);
    },
    onCancel(callback) {
      cancelListeners.add(callback);
      return () => {
        cancelListeners.delete(callback);
      };
    },
    onCommand(callback) {
      commandListeners.add(callback);
      return () => {
        commandListeners.delete(callback);
      };
    },
    onOpen(callback) {
      openListeners.add(callback);
      return () => {
        openListeners.delete(callback);
      };
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => {
        closeListeners.delete(callback);
      };
    },
    onConnected(callback) {
      connectedListeners.add(callback);
      return () => {
        connectedListeners.delete(callback);
      };
    },
    onDisconnected(callback) {
      disconnectedListeners.add(callback);
      return () => {
        disconnectedListeners.delete(callback);
      };
    },
    sendReply(message) {
      replies.push(message);
    },
    setCapability(windowId) {
      capabilities.push(windowId);
    },
    emitCancel(message) {
      for (const listener of cancelListeners) {
        listener(message);
      }
    },
    emitCommand(message) {
      for (const listener of commandListeners) {
        listener(message);
      }
    },
    emitOpen(message) {
      for (const listener of openListeners) {
        listener(message);
      }
    },
    emitClose(message) {
      for (const listener of closeListeners) {
        listener(message);
      }
    },
    emitConnected(event) {
      for (const listener of connectedListeners) listener(event);
    },
    emitDisconnected() {
      for (const listener of disconnectedListeners) listener();
    },
  };
}

function createFakeDesktopBrowser(): FakeDesktopBrowser {
  const listeners = new Set<(state: BbDesktopBrowserState) => void>();
  return {
    api: {
      ...createNoopDesktopBrowserApi(),
      onState(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emitState(state) {
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
    stateListenerCount() {
      return listeners.size;
    },
  };
}

function createFakeThreadHost(): FakeThreadHost {
  let nextTab = 0;
  const host: FakeThreadHost = {
    closedTabIds: [],
    openedUrls: [],
    reveals: 0,
    openBrowserTab(url) {
      host.openedUrls.push(url);
      nextTab += 1;
      return `browser:fresh-${nextTab}`;
    },
    closeBrowserTab(tabId) {
      host.closedTabIds.push(tabId);
    },
    reveal() {
      host.reveals += 1;
    },
  };
  return host;
}

function browserState(
  tabId: string,
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId,
    url: "https://example.test/",
    title: "Example",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

function openMessage(
  overrides: Partial<BrowserAutomationOpenMessage> = {},
): BrowserAutomationOpenMessage {
  return {
    type: "browser-automation.open",
    requestId: "req-1",
    targetId: "bt_1",
    threadId: "thr_1",
    url: "https://example.test/",
    ...overrides,
  };
}

async function createHarness(
  options: CreateHarnessOptions = {},
): Promise<Harness> {
  const transport = options.transport ?? createFakeTransport();
  const desktop = createFakeDesktopBrowser();
  const host = createFakeThreadHost();
  const client = createBrowserAutomationClient({
    desktopBrowser:
      options.desktopBrowser === undefined ? desktop.api : options.desktopBrowser,
    resolveWindowIdentity: () =>
      Promise.resolve(
        options.identity === undefined
          ? { windowId: "window-a" }
          : options.identity,
      ),
    transport,
  });
  const stop = client.start();
  const unregisterHost =
    options.registerHost === false
      ? () => {}
      : client.registerThreadHost("thr_1", host);
  await Promise.resolve();
  return { client, desktop, host, stop, transport, unregisterHost };
}

describe("browser automation renderer client", () => {
  it("advertises the desktop window identity once it resolves", async () => {
    const harness = await createHarness();
    expect(harness.transport.capabilities).toEqual(["window-a"]);
    harness.stop();
  });

  it("never advertises without a compatible desktop automation API or window identity", async () => {
    const withoutIdentity = await createHarness({ identity: null });
    expect(withoutIdentity.transport.capabilities).toEqual([]);
    withoutIdentity.transport.emitOpen(openMessage());
    expect(withoutIdentity.host.openedUrls).toEqual([]);
    expect(withoutIdentity.transport.replies).toEqual([]);
    withoutIdentity.stop();

    const withoutDesktop = await createHarness({ desktopBrowser: null });
    expect(withoutDesktop.transport.capabilities).toEqual([]);
    withoutDesktop.stop();

    const legacyDesktop = createNoopDesktopBrowserApi();
    legacyDesktop.registerAutomationTarget = undefined;
    legacyDesktop.unregisterAutomationTarget = undefined;
    legacyDesktop.runAutomationCommand = undefined;
    legacyDesktop.cancelAutomationCommand = undefined;
    const withoutAutomation = await createHarness({
      desktopBrowser: legacyDesktop,
    });
    expect(withoutAutomation.transport.capabilities).toEqual([]);
    withoutAutomation.transport.emitOpen(openMessage());
    expect(withoutAutomation.host.openedUrls).toEqual([]);
    withoutAutomation.stop();
  });

  it("creates a fresh tab, reveals it, and acknowledges only after matching native state arrives", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());

    expect(harness.host.openedUrls).toEqual(["https://example.test/"]);
    expect(harness.host.reveals).toBe(1);
    expect(harness.transport.replies).toEqual([]);

    harness.desktop.emitState(browserState("browser:user-tab"));
    harness.desktop.emitState(browserState("browser:fresh-1", { url: "" }));
    harness.desktop.emitState(
      browserState("browser:fresh-1", {
        isLoading: true,
        url: "https://example.test/landing",
      }),
    );
    expect(harness.transport.replies).toEqual([]);

    harness.desktop.emitState(
      browserState("browser:fresh-1", {
        url: "https://example.test/landing",
      }),
    );
    await vi.waitFor(() => {
      expect(harness.transport.replies).toEqual([
        {
          type: "browser-automation.open-ready",
          requestId: "req-1",
          targetId: "bt_1",
          windowId: "window-a",
          tabId: "browser:fresh-1",
          url: "https://example.test/landing",
        },
      ]);
    });

    harness.desktop.emitState(
      browserState("browser:fresh-1", { url: "https://example.test/next" }),
    );
    expect(harness.transport.replies).toHaveLength(1);
    expect(harness.desktop.stateListenerCount()).toBe(0);
    harness.stop();
  });

  it("treats a failed page load as native state so the target still becomes usable", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());
    harness.desktop.emitState(
      browserState("browser:fresh-1", {
        url: "",
        errorText: "ERR_CONNECTION_REFUSED",
      }),
    );
    await vi.waitFor(() => {
      expect(harness.transport.replies).toEqual([
        expect.objectContaining({
          type: "browser-automation.open-ready",
          tabId: "browser:fresh-1",
          url: "",
        }),
      ]);
    });
    harness.stop();
  });

  it("reports thread_not_open for threads this window is not showing and ignores duplicate requests", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(
      openMessage({ requestId: "req-2", targetId: "bt_2", threadId: "thr_9" }),
    );
    expect(harness.host.openedUrls).toEqual([]);
    expect(harness.transport.replies).toEqual([
      {
        type: "browser-automation.open-failed",
        requestId: "req-2",
        targetId: "bt_2",
        code: "thread_not_open",
      },
    ]);

    harness.transport.emitOpen(openMessage());
    harness.transport.emitOpen(openMessage({ requestId: "req-late" }));
    expect(harness.host.openedUrls).toEqual(["https://example.test/"]);
    expect(harness.desktop.stateListenerCount()).toBe(1);
    harness.stop();
  });

  it("reports tab_unavailable when the thread host cannot create a tab", async () => {
    const harness = await createHarness();
    harness.host.openBrowserTab = () => null;
    harness.transport.emitOpen(openMessage());
    expect(harness.transport.replies).toEqual([
      {
        type: "browser-automation.open-failed",
        requestId: "req-1",
        targetId: "bt_1",
        code: "tab_unavailable",
      },
    ]);
    expect(harness.host.reveals).toBe(0);
    harness.stop();
  });

  it("closes only the automation tab and stops a pending acknowledgement", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());
    harness.transport.emitClose({
      type: "browser-automation.close",
      targetId: "bt_unknown",
    });
    expect(harness.host.closedTabIds).toEqual([]);

    harness.transport.emitClose({
      type: "browser-automation.close",
      targetId: "bt_1",
    });
    expect(harness.host.closedTabIds).toEqual(["browser:fresh-1"]);
    expect(harness.desktop.stateListenerCount()).toBe(0);

    harness.desktop.emitState(browserState("browser:fresh-1"));
    expect(harness.transport.replies).toEqual([]);

    harness.transport.emitClose({
      type: "browser-automation.close",
      targetId: "bt_1",
    });
    expect(harness.host.closedTabIds).toEqual(["browser:fresh-1"]);
    harness.stop();
  });

  it("applies a close that arrives while the thread is unmounted once it mounts again", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());
    harness.desktop.emitState(browserState("browser:fresh-1"));
    harness.unregisterHost();

    harness.transport.emitClose({
      type: "browser-automation.close",
      targetId: "bt_1",
    });
    expect(harness.host.closedTabIds).toEqual([]);

    const remountedHost = createFakeThreadHost();
    harness.client.registerThreadHost("thr_1", remountedHost);
    expect(remountedHost.closedTabIds).toEqual(["browser:fresh-1"]);
    harness.stop();
  });

  it("reports an observed tab closed before native readiness as an open failure", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());

    harness.client.reportBrowserTabs(
      "thr_1",
      new Set(["browser:user-tab", "browser:fresh-1"]),
    );
    harness.client.reportBrowserTabs("thr_1", new Set(["browser:user-tab"]));

    expect(harness.transport.replies).toEqual([
      {
        type: "browser-automation.open-failed",
        requestId: "req-1",
        targetId: "bt_1",
        code: "tab_unavailable",
      },
    ]);
    expect(harness.desktop.stateListenerCount()).toBe(0);
    harness.stop();
  });

  it("reports a ready automation tab user-closed exactly once and only after it was observed", async () => {
    const harness = await createHarness();
    harness.transport.emitOpen(openMessage());
    harness.desktop.emitState(browserState("browser:fresh-1"));
    await vi.waitFor(() => {
      expect(harness.transport.replies).toHaveLength(1);
    });
    harness.transport.replies.length = 0;

    harness.client.reportBrowserTabs("thr_1", new Set(["browser:user-tab"]));
    expect(harness.transport.replies).toEqual([]);

    harness.client.reportBrowserTabs(
      "thr_1",
      new Set(["browser:user-tab", "browser:fresh-1"]),
    );
    harness.client.reportBrowserTabs("thr_9", new Set());
    expect(harness.transport.replies).toEqual([]);

    harness.client.reportBrowserTabs("thr_1", new Set(["browser:user-tab"]));
    harness.client.reportBrowserTabs("thr_1", new Set(["browser:user-tab"]));
    expect(harness.transport.replies).toEqual([
      {
        type: "browser-automation.target-closed",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "browser:fresh-1",
      },
    ]);
    harness.stop();
  });

  it("closes and reports owned tabs, withdraws capability, and restarts safely", async () => {
    const transport = createFakeTransport();
    const harness = await createHarness({ transport });
    harness.transport.emitOpen(openMessage());
    harness.desktop.emitState(browserState("browser:fresh-1"));
    await vi.waitFor(() => {
      expect(harness.transport.replies).toHaveLength(1);
    });
    harness.transport.replies.length = 0;

    const secondStop = harness.client.start();
    harness.stop();
    expect(harness.host.closedTabIds).toEqual([]);
    expect(harness.transport.capabilities).toEqual(["window-a"]);

    secondStop();
    secondStop();
    expect(harness.host.closedTabIds).toEqual(["browser:fresh-1"]);
    expect(harness.transport.replies).toEqual([
      {
        type: "browser-automation.target-closed",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "browser:fresh-1",
      },
    ]);
    expect(harness.transport.capabilities).toEqual(["window-a", null]);

    const stopRestarted = harness.client.start();
    await Promise.resolve();
    harness.transport.emitOpen(
      openMessage({ requestId: "req-2", targetId: "bt_2" }),
    );
    expect(harness.host.openedUrls).toHaveLength(2);
    stopRestarted();
    expect(harness.host.closedTabIds).toEqual([
      "browser:fresh-1",
      "browser:fresh-2",
    ]);
    expect(harness.transport.replies.at(-1)).toMatchObject({
      type: "browser-automation.open-failed",
      requestId: "req-2",
      targetId: "bt_2",
      code: "tab_unavailable",
    });
    expect(harness.transport.capabilities).toEqual([
      "window-a",
      null,
      "window-a",
      null,
    ]);
  });

  it("maps exact correlated server commands to native automation and Stop cancels both seams once", async () => {
    const native = createFakeDesktopBrowser();
    let resolveCommand: (result: BrowserAutomationCommandResult) => void = () => {};
    const runAutomationCommand = vi.fn(() => new Promise<{
      ok: true;
      result: BrowserAutomationCommandResult;
    }>((resolve) => {
      resolveCommand = (result) => resolve({ ok: true, result });
    }));
    const cancelAutomationCommand = vi.fn(async () => {});
    native.api.runAutomationCommand = runAutomationCommand;
    native.api.cancelAutomationCommand = cancelAutomationCommand;
    const harness = await createHarness({ desktopBrowser: native.api });
    harness.transport.emitOpen(openMessage());
    native.emitState(browserState("browser:fresh-1"));
    await vi.waitFor(() => expect(harness.transport.replies).toHaveLength(1));
    harness.transport.replies.length = 0;

    const command: BrowserAutomationCommandMessage = {
      type: "browser-automation.command",
      commandId: "bc_1",
      targetId: "bt_1",
      windowId: "window-a",
      tabId: "browser:fresh-1",
      navigationEpoch: 3,
      timeoutMs: 1_000,
      command: { kind: "press", key: "Enter" },
    };
    harness.transport.emitCommand({ ...command, windowId: "window-other" });
    expect(runAutomationCommand).not.toHaveBeenCalled();
    harness.transport.emitCommand(command);
    expect(runAutomationCommand).toHaveBeenCalledWith({
      targetId: "bt_1",
      navigationEpoch: 3,
      timeoutMs: 1_000,
      command: { kind: "press", key: "Enter" },
    });
    expect(harness.client.getTabUsage("browser:fresh-1")).toMatchObject({ active: true, threadId: "thr_1" });

    harness.client.stopTab("browser:fresh-1");
    harness.client.stopTab("browser:fresh-1");
    expect(cancelAutomationCommand).toHaveBeenCalledOnce();
    expect(harness.transport.replies).toEqual([{
      type: "browser-automation.cancel-request",
      commandId: "bc_1",
      targetId: "bt_1",
      windowId: "window-a",
      tabId: "browser:fresh-1",
    }]);
    expect(harness.client.getTabUsage("browser:fresh-1")).toMatchObject({ active: true });
    resolveCommand({ kind: "state", navigationEpoch: 3, ready: true, url: "https://example.test/" });
    await Promise.resolve();
    expect(harness.client.getTabUsage("browser:fresh-1")).toMatchObject({ active: false });
    expect(harness.transport.replies).toHaveLength(2);
    harness.stop();
  });

  it("reports renderer IPC rejection without fabricating empty page state", async () => {
    const native = createFakeDesktopBrowser();
    native.api.runAutomationCommand = vi.fn(async () => {
      throw new Error("IPC unavailable");
    });
    const harness = await createHarness({ desktopBrowser: native.api });
    harness.transport.emitOpen(openMessage());
    native.emitState(browserState("browser:fresh-1"));
    await vi.waitFor(() => expect(harness.transport.replies).toHaveLength(1));
    harness.transport.replies.length = 0;

    harness.transport.emitCommand({
      type: "browser-automation.command",
      commandId: "bc_rejected",
      targetId: "bt_1",
      windowId: "window-a",
      tabId: "browser:fresh-1",
      navigationEpoch: 4,
      timeoutMs: 1_000,
      command: { kind: "snapshot" },
    });
    await vi.waitFor(() => {
      expect(harness.transport.replies).toEqual([{
        type: "browser-automation.command-failed",
        commandId: "bc_rejected",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "browser:fresh-1",
        code: "native_operation_failed",
        detail: "IPC unavailable",
      }]);
    });
    harness.stop();
  });

  it("immediately unregisters and closes every automation tab when the socket is lost", async () => {
    const native = createFakeDesktopBrowser();
    const unregisterAutomationTarget = vi.fn(async () => {});
    native.api.unregisterAutomationTarget = unregisterAutomationTarget;
    const harness = await createHarness({ desktopBrowser: native.api });
    harness.transport.emitOpen(openMessage());
    native.emitState(browserState("browser:fresh-1"));
    await vi.waitFor(() => expect(harness.transport.replies).toHaveLength(1));

    harness.transport.emitDisconnected();
    expect(native.stateListenerCount()).toBe(0);
    expect(unregisterAutomationTarget).toHaveBeenCalledWith("bt_1");
    expect(harness.host.closedTabIds).toEqual(["browser:fresh-1"]);

    harness.transport.emitClose({
      type: "browser-automation.close",
      targetId: "bt_1",
    });
    expect(harness.host.closedTabIds).toEqual(["browser:fresh-1"]);
    harness.stop();
  });
});
