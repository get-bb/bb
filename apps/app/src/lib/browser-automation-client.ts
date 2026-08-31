import type {
  BbDesktopBrowserApi,
  BbDesktopWindowIdentity,
} from "@bb/desktop-contract";
import type {
  BrowserAutomationCancelMessage,
  BrowserAutomationCommandMessage,
  BrowserAutomationCloseMessage,
  BrowserAutomationOpenMessage,
} from "@bb/server-contract";
import { getBbDesktopInfo, getDesktopBrowserApi } from "./bb-desktop";
import {
  wsManager,
  type BrowserAutomationClientReply,
  type WebSocketConnectedEvent,
} from "./ws";

export interface BrowserAutomationTransport {
  clearCapability(): void;
  onCancel(callback: (message: BrowserAutomationCancelMessage) => void): () => void;
  onCommand(callback: (message: BrowserAutomationCommandMessage) => void): () => void;
  onClose(callback: (message: BrowserAutomationCloseMessage) => void): () => void;
  onConnected(callback: (event: WebSocketConnectedEvent) => void): () => void;
  onDisconnected(callback: () => void): () => void;
  onOpen(callback: (message: BrowserAutomationOpenMessage) => void): () => void;
  sendReply(message: BrowserAutomationClientReply): void;
  setCapability(windowId: string): void;
}

export interface BrowserAutomationThreadHost {
  closeBrowserTab(tabId: string): void;
  openBrowserTab(url: string): string | null;
  reveal(): void;
}

export interface BrowserAutomationTabUsage {
  active: boolean;
  targetId: string;
  threadId: string;
}

export interface BrowserAutomationClient {
  getTabUsage(tabId: string): BrowserAutomationTabUsage | null;
  subscribeTabUsage(callback: () => void): () => void;
  stopTab(tabId: string): void;
  registerThreadHost(
    threadId: string,
    host: BrowserAutomationThreadHost,
  ): () => void;
  reportBrowserTabs(threadId: string, tabIds: ReadonlySet<string>): void;
  start(): () => void;
}

interface CreateBrowserAutomationClientArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  resolveWindowIdentity: () => Promise<BbDesktopWindowIdentity | null>;
  transport: BrowserAutomationTransport;
}

interface AutomationTabEntry {
  cancelRequested: boolean;
  disposeWait: (() => void) | null;
  inFlightCommandId: string | null;
  observed: boolean;
  registrationStarted: boolean;
  ready: boolean;
  requestId: string;
  tabId: string;
  targetId: string;
  threadId: string;
  usage: BrowserAutomationTabUsage;
  windowId: string;
}

export function createBrowserAutomationClient(
  args: CreateBrowserAutomationClientArgs,
): BrowserAutomationClient {
  const entries = new Map<string, AutomationTabEntry>();
  const desktopBrowser = args.desktopBrowser;
  const automationSupported =
    desktopBrowser?.reserveAutomationTarget !== undefined &&
    desktopBrowser.registerAutomationTarget !== undefined &&
    desktopBrowser.unregisterAutomationTarget !== undefined &&
    desktopBrowser.runAutomationCommand !== undefined &&
    desktopBrowser.cancelAutomationCommand !== undefined;
  const threadHosts = new Map<string, BrowserAutomationThreadHost>();
  const pendingClosesByThreadId = new Map<string, Set<string>>();
  let windowId: string | null = null;
  let activeStarts = 0;
  let startGeneration = 0;
  let listenerUnsubscribers: Array<() => void> = [];
  const usageListeners = new Set<() => void>();

  function emitUsage(): void {
    for (const listener of usageListeners) listener();
  }

  function removeEntry(entry: AutomationTabEntry): void {
    entries.delete(entry.targetId);
    entry.inFlightCommandId = null;
    emitUsage();
    entry.disposeWait?.();
    entry.disposeWait = null;
    if (entry.ready) {
      void args.desktopBrowser?.unregisterAutomationTarget?.(entry.targetId);
    }
  }

  function reportEntryClosed(entry: AutomationTabEntry): void {
    if (entry.ready) {
      args.transport.sendReply({
        type: "browser-automation.target-closed",
        targetId: entry.targetId,
        windowId: entry.windowId,
        tabId: entry.tabId,
      });
      return;
    }
    args.transport.sendReply({
      type: "browser-automation.open-failed",
      requestId: entry.requestId,
      targetId: entry.targetId,
      code: "tab_unavailable",
    });
  }

  function closeEntry(entry: AutomationTabEntry): void {
    removeEntry(entry);
    const host = threadHosts.get(entry.threadId);
    if (host !== undefined) {
      host.closeBrowserTab(entry.tabId);
      return;
    }
    const pending =
      pendingClosesByThreadId.get(entry.threadId) ?? new Set<string>();
    pending.add(entry.tabId);
    pendingClosesByThreadId.set(entry.threadId, pending);
  }

  function handleOpen(message: BrowserAutomationOpenMessage): void {
    const ownWindowId = windowId;
    if (
      desktopBrowser === null ||
      !automationSupported ||
      ownWindowId === null ||
      entries.has(message.targetId)
    ) {
      return;
    }
    const host = threadHosts.get(message.threadId);
    if (host === undefined) {
      args.transport.sendReply({
        type: "browser-automation.open-failed",
        requestId: message.requestId,
        targetId: message.targetId,
        code: "thread_not_open",
      });
      return;
    }
    const tabId = host.openBrowserTab(message.url);
    if (tabId === null) {
      args.transport.sendReply({
        type: "browser-automation.open-failed",
        requestId: message.requestId,
        targetId: message.targetId,
        code: "tab_unavailable",
      });
      return;
    }
    const entry: AutomationTabEntry = {
      cancelRequested: false,
      disposeWait: null,
      inFlightCommandId: null,
      observed: false,
      registrationStarted: false,
      ready: false,
      requestId: message.requestId,
      tabId,
      targetId: message.targetId,
      threadId: message.threadId,
      usage: { active: false, targetId: message.targetId, threadId: message.threadId },
      windowId: ownWindowId,
    };
    entries.set(entry.targetId, entry);
    const reservation = desktopBrowser.reserveAutomationTarget?.({
      targetId: entry.targetId,
      tabId: entry.tabId,
    }) ?? Promise.resolve(false);
    host.reveal();
    const unsubscribe = desktopBrowser.onState((state) => {
      if (state.tabId !== entry.tabId) {
        return;
      }
      if (
        state.isLoading ||
        (state.url.length === 0 && state.errorText === null)
      ) {
        return;
      }
      if (
        entries.get(entry.targetId) !== entry ||
        entry.registrationStarted
      ) {
        return;
      }
      entry.registrationStarted = true;
      void (async () => {
        if (!(await reservation)) {
          if (entries.get(entry.targetId) === entry) {
            removeEntry(entry);
            host.closeBrowserTab(entry.tabId);
            args.transport.sendReply({
              type: "browser-automation.open-failed",
              requestId: entry.requestId,
              targetId: entry.targetId,
              code: "tab_unavailable",
            });
          }
          return;
        }
        entry.disposeWait?.();
        entry.disposeWait = null;
        const registered =
          (await desktopBrowser.registerAutomationTarget?.({
            targetId: entry.targetId,
            tabId: entry.tabId,
          })) ?? false;
        if (entries.get(entry.targetId) !== entry) {
          if (registered) {
            await desktopBrowser.unregisterAutomationTarget?.(entry.targetId);
          }
          return;
        }
        if (!registered) {
          removeEntry(entry);
          host.closeBrowserTab(entry.tabId);
          args.transport.sendReply({
            type: "browser-automation.open-failed",
            requestId: entry.requestId,
            targetId: entry.targetId,
            code: "tab_unavailable",
          });
          return;
        }
        entry.ready = true;
        emitUsage();
        args.transport.sendReply({
          type: "browser-automation.open-ready",
          requestId: entry.requestId,
          targetId: entry.targetId,
          windowId: ownWindowId,
          tabId: entry.tabId,
          url: state.url,
        });
      })();
    });
    entry.disposeWait = unsubscribe;
  }

  function handleClose(message: BrowserAutomationCloseMessage): void {
    const entry = entries.get(message.targetId);
    if (entry === undefined) {
      return;
    }
    closeEntry(entry);
  }

  function handleCommand(message: BrowserAutomationCommandMessage): void {
    const entry = entries.get(message.targetId);
    if (
      entry === undefined ||
      !entry.ready ||
      entry.windowId !== message.windowId ||
      entry.tabId !== message.tabId ||
      entry.inFlightCommandId !== null
    ) {
      return;
    }
    const run = args.desktopBrowser?.runAutomationCommand;
    if (run === undefined) return;
    entry.cancelRequested = false;
    entry.inFlightCommandId = message.commandId;
    entry.usage = { ...entry.usage, active: true };
    emitUsage();
    void run({
      targetId: entry.targetId,
      navigationEpoch: message.navigationEpoch,
      timeoutMs: message.timeoutMs,
      command: message.command,
    }).then(
      (outcome) => {
        if (entries.get(entry.targetId) !== entry || entry.inFlightCommandId !== message.commandId) return;
        entry.cancelRequested = false;
        entry.inFlightCommandId = null;
        entry.usage = { ...entry.usage, active: false };
        emitUsage();
        if (outcome.ok) {
          args.transport.sendReply({
            type: "browser-automation.command-result",
            commandId: message.commandId,
            targetId: entry.targetId,
            windowId: entry.windowId,
            tabId: entry.tabId,
            result: outcome.result,
          });
          return;
        }
        args.transport.sendReply({
          type: "browser-automation.command-failed",
          commandId: message.commandId,
          targetId: entry.targetId,
          windowId: entry.windowId,
          tabId: entry.tabId,
          code: outcome.code,
          detail: outcome.detail,
          state: outcome.state,
        });
      },
      (error: Error) => {
        if (entries.get(entry.targetId) !== entry || entry.inFlightCommandId !== message.commandId) return;
        entry.cancelRequested = false;
        entry.inFlightCommandId = null;
        entry.usage = { ...entry.usage, active: false };
        emitUsage();
        args.transport.sendReply({
          type: "browser-automation.command-failed",
          commandId: message.commandId,
          targetId: entry.targetId,
          windowId: entry.windowId,
          tabId: entry.tabId,
          code: "native_operation_failed",
          detail: error.message.slice(0, 512) || "Browser automation command failed",
        });
      },
    );
  }

  function handleCancel(message: BrowserAutomationCancelMessage): void {
    const entry = entries.get(message.targetId);
    if (
      entry === undefined ||
      entry.windowId !== message.windowId ||
      entry.tabId !== message.tabId ||
      entry.inFlightCommandId !== message.commandId
    ) return;
    if (entry.cancelRequested) return;
    entry.cancelRequested = true;
    void args.desktopBrowser?.cancelAutomationCommand?.(entry.targetId);
  }

  function handleConnected(event: WebSocketConnectedEvent): void {
    if (!event.reconnected) return;
    for (const entry of [...entries.values()]) closeEntry(entry);
  }

  function handleDisconnected(): void {
    for (const entry of [...entries.values()]) closeEntry(entry);
  }

  return {
    getTabUsage(tabId) {
      const entry = [...entries.values()].find((candidate) => candidate.tabId === tabId && candidate.ready);
      return entry?.usage ?? null;
    },
    subscribeTabUsage(callback) {
      usageListeners.add(callback);
      return () => usageListeners.delete(callback);
    },
    stopTab(tabId) {
      const entry = [...entries.values()].find((candidate) => candidate.tabId === tabId);
      const commandId = entry?.inFlightCommandId;
      if (
        entry === undefined ||
        commandId === null ||
        commandId === undefined ||
        entry.cancelRequested
      ) return;
      entry.cancelRequested = true;
      void args.desktopBrowser?.cancelAutomationCommand?.(entry.targetId);
      args.transport.sendReply({
        type: "browser-automation.cancel-request",
        commandId,
        targetId: entry.targetId,
        windowId: entry.windowId,
        tabId: entry.tabId,
      });
    },
    registerThreadHost(threadId, host) {
      threadHosts.set(threadId, host);
      const pending = pendingClosesByThreadId.get(threadId);
      if (pending !== undefined) {
        pendingClosesByThreadId.delete(threadId);
        for (const tabId of pending) {
          host.closeBrowserTab(tabId);
        }
      }
      return () => {
        if (threadHosts.get(threadId) === host) {
          threadHosts.delete(threadId);
        }
      };
    },
    reportBrowserTabs(threadId, tabIds) {
      for (const entry of [...entries.values()]) {
        if (entry.threadId !== threadId) {
          continue;
        }
        if (tabIds.has(entry.tabId)) {
          entry.observed = true;
          continue;
        }
        if (!entry.observed) {
          continue;
        }
        removeEntry(entry);
        reportEntryClosed(entry);
      }
    },
    start() {
      activeStarts += 1;
      if (activeStarts === 1) {
        const generation = ++startGeneration;
        listenerUnsubscribers = [
          args.transport.onOpen(handleOpen),
          args.transport.onClose(handleClose),
          args.transport.onCommand(handleCommand),
          args.transport.onCancel(handleCancel),
          args.transport.onConnected(handleConnected),
          args.transport.onDisconnected(handleDisconnected),
        ];
        if (automationSupported) {
          void args.resolveWindowIdentity().then((identity) => {
            if (
              activeStarts === 0 ||
              generation !== startGeneration ||
              identity === null
            ) {
              return;
            }
            windowId = identity.windowId;
            args.transport.setCapability(identity.windowId);
          });
        }
      }
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        activeStarts -= 1;
        if (activeStarts > 0) {
          return;
        }
        startGeneration += 1;
        for (const unsubscribe of listenerUnsubscribers) {
          unsubscribe();
        }
        listenerUnsubscribers = [];
        for (const entry of [...entries.values()]) {
          reportEntryClosed(entry);
          closeEntry(entry);
        }
        windowId = null;
        args.transport.clearCapability();
      };
    },
  };
}

function createWsManagerTransport(): BrowserAutomationTransport {
  return {
    clearCapability: () => wsManager.clearBrowserAutomationCapability(),
    onCancel: (callback) => wsManager.onBrowserAutomationCancel(callback),
    onCommand: (callback) => wsManager.onBrowserAutomationCommand(callback),
    onClose: (callback) => wsManager.onBrowserAutomationClose(callback),
    onConnected: (callback) => wsManager.onConnected(callback),
    onDisconnected: (callback) => wsManager.onDisconnected(callback),
    onOpen: (callback) => wsManager.onBrowserAutomationOpen(callback),
    sendReply: (message) => wsManager.sendBrowserAutomationReply(message),
    setCapability: (windowId) =>
      wsManager.setBrowserAutomationCapability(windowId),
  };
}

export const browserAutomationClient = createBrowserAutomationClient({
  desktopBrowser: getDesktopBrowserApi(),
  resolveWindowIdentity: () =>
    getBbDesktopInfo()?.getWindowIdentity?.() ?? Promise.resolve(null),
  transport: createWsManagerTransport(),
});
