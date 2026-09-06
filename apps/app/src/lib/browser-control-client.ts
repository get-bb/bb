import { bbDesktopBrowserCaptureDescriptorSchema } from "@bb/desktop-contract";
import type {
  BrowserActionabilityPolicy,
  BrowserControlAction,
  BrowserOpenTabRequestMessage,
  BrowserOpenTabResponseMessage,
  BrowserControlRequestMessage,
  BrowserControlResponseMessage,
  BrowserTabDescriptor,
  BrowserTabTarget,
  BrowserFrameTarget,
  JsonValue,
} from "@bb/server-contract";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import {
  BROWSER_CAPTURE_MAX_BYTES,
  BROWSER_CAPTURE_AGGREGATE_MAX_BYTES,
  BROWSER_CONTROL_MAX_FRAMES,
  browserCapturePixelSizeSchema,
  browserWaitResultSchema,
  isAllowedBrowserNavigationUrl,
  isBrowserTransitionWaitAction,
  type BrowserPluginRequestMessage,
  type BrowserPluginResponseMessage,
} from "@bb/domain";
import { wsManager } from "./ws";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "./document-visibility";

interface RegisteredBrowserTab {
  descriptor: BrowserTabDescriptor;
  desktopBrowser: BbDesktopBrowserApi;
  openTab:
    | ((
        url: string,
        options?: { signal?: AbortSignal },
      ) => Promise<BrowserTabTarget>)
    | null;
  closeTab: (() => void) | null;
  ready: boolean;
}
interface BrowserControlOwnerTab {
  tabId: string;
  title: string | null;
  url: string;
}

interface RegisteredBrowserOwner {
  activateTab: (
    tabId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<BrowserTabTarget>;
  closeTab: (tabId: string) => void;
  active: boolean;
  openTab: (
    url: string,
    options?: { signal?: AbortSignal },
  ) => Promise<BrowserTabTarget>;
  ownerId: string;
  projectId: string | null;
  tabs: readonly BrowserControlOwnerTab[];
  threadId: string | null;
}

interface RegisterBrowserControlTabArgs {
  active: boolean;
  desktopBrowser: BbDesktopBrowserApi;
  projectId: string | null;
  state: BbDesktopBrowserState | null;
  tabId: string;
  threadId: string | null;
  url: string;
  openTab?: (url: string) => Promise<BrowserTabTarget>;
  closeTab?: () => void;
}

interface RegisterBrowserControlOwnerArgs {
  activateTab: RegisteredBrowserOwner["activateTab"];
  closeTab: (tabId: string) => void;
  active: boolean;
  openTab: RegisteredBrowserOwner["openTab"];
  ownerId: string;
  projectId: string | null;
  tabs: readonly BrowserControlOwnerTab[];
  threadId: string | null;
}
interface BrowserThreadOwnerActivation {
  projectId: string;
  signal: AbortSignal;
  threadId: string;
}

interface BrowserThreadOwnerActivator {
  activate(args: BrowserThreadOwnerActivation): Promise<void>;
}

interface BrowserOwnerRegistrationWaiter {
  projectId: string;
  threadId: string;
  resolve(owner: RegisteredBrowserOwner): void;
  reject(error: Error): void;
  unlinkAbort(): void;
}

export interface BrowserThreadOwnerActivatorRegistration {
  dispose(): void;
}

export interface BrowserControlTabRegistration {
  update(
    args: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): void;
  dispose(): void;
}

export interface BrowserControlOwnerRegistration {
  dispose(): void;
  updateTabs(tabs: readonly BrowserControlOwnerTab[]): void;
}

const registeredTabs = new Map<string, RegisteredBrowserTab>();
interface RegisteredBrowserController {
  pluginId: string;
  controllerId: string;
  tabId: string;
  registrationId: string;
  controller: AbortController;
  handler(request: {
    input: JsonValue;
    target: BrowserTabTarget;
    signal: AbortSignal;
  }): Promise<JsonValue>;
}
const controllerRequestHandlers = new Map<
  string,
  RegisteredBrowserController
>();
export type BrowserControllerDisposeReason =
  | "tab-closed"
  | "thread-removed"
  | "environment-removed"
  | "client-disconnected"
  | "plugin-disposed";
const browserControllerDisposeListenersByTab = new Map<
  string,
  Set<(reason: BrowserControllerDisposeReason) => void>
>();
const browserControllerDisposeListenersByThread = new Map<
  string,
  Set<(reason: BrowserControllerDisposeReason) => void>
>();
const browserControllerDisposeListenersByEnvironment = new Map<
  string,
  Set<(reason: BrowserControllerDisposeReason) => void>
>();
const browserControllerDisposeListenersByPlugin = new Map<
  string,
  Set<(reason: BrowserControllerDisposeReason) => void>
>();
const browserControllerReconnectListeners = new Set<() => void>();
const registeredOwners = new Map<string, RegisteredBrowserOwner>();
const activeRequestCounts = new Map<string, number>();
const activityListeners = new Set<() => void>();
const requestControllers = new Map<string, AbortController>();
interface GeneratedBrowserCapture {
  blob: Blob;
  target: BrowserTabTarget;
}
interface BrowserCaptureRegistrationWaiter {
  reject(error: Error): void;
  resolve(expiresAt: number): void;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort(): void;
}
const generatedBrowserCaptures = new Map<string, GeneratedBrowserCapture>();
const browserCaptureRegistrationWaiters = new Map<
  string,
  BrowserCaptureRegistrationWaiter
>();
const ownerRegistrationWaiters = new Set<BrowserOwnerRegistrationWaiter>();
let threadOwnerActivator: BrowserThreadOwnerActivator | null = null;
interface BrowserTabRegistrationWaiter {
  reject: (reason: Error) => void;
  resolve: (target: BrowserTabTarget) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const tabRegistrationWaiters = new Map<
  string,
  Set<BrowserTabRegistrationWaiter>
>();
interface BrowserTargetWaiter {
  target: BrowserTabTarget;
  resolve: (target: BrowserTabTarget) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const tabTargetWaiters = new Map<string, Set<BrowserTargetWaiter>>();

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function publicBrowserError(
  error: unknown,
  fallbackCode: string,
): { code: string; message: string } {
  const code = error instanceof Error ? error.name : fallbackCode;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+': Error: /u, "")
    .slice(0, 2_048);
  return { code, message };
}

const clientId = randomId();
const windowId = randomId();
export function browserControlClientIdentity(): {
  clientId: string;
  windowId: string;
} {
  return { clientId, windowId };
}
export async function registerBrowserCapture(
  blob: Blob,
  options: {
    target: BrowserTabTarget;
    pixelSize?: { width: number; height: number };
    signal?: AbortSignal;
  },
): Promise<{
  captureId: string;
  mimeType: "image/png" | "image/jpeg";
  pixelSize: { width: number; height: number };
  byteLength: number;
  target: BrowserTabTarget;
  expiresAt: number;
}> {
  options.signal?.throwIfAborted();
  const tab = registeredTabs.get(options.target.tabId);
  if (tab === undefined || !targetEquals(targetFor(tab), options.target)) {
    throw new Error(
      "Browser page changed before the capture could be registered",
    );
  }
  if (wsManager.getConnectionState() !== "connected") {
    throw new Error("Browser capture registration requires a connected client");
  }
  if (blob.size <= 0 || blob.size > BROWSER_CAPTURE_MAX_BYTES) {
    throw new Error("Browser capture exceeds the byte limit");
  }
  let retainedBytes = blob.size;
  for (const capture of generatedBrowserCaptures.values())
    retainedBytes += capture.blob.size;
  if (retainedBytes > BROWSER_CAPTURE_AGGREGATE_MAX_BYTES) {
    throw new Error("Browser capture aggregate capacity is exhausted");
  }
  const mimeType =
    blob.type === "image/png" || blob.type === "image/jpeg" ? blob.type : null;
  if (mimeType === null)
    throw new Error("Browser capture must be a PNG or JPEG image");
  const captureId = randomId();
  const requestId = randomId();
  generatedBrowserCaptures.set(captureId, { blob, target: options.target });
  let registrationSent = false;
  try {
    const bitmap = await createImageBitmap(blob);
    let pixelSize: { width: number; height: number };
    try {
      pixelSize = browserCapturePixelSizeSchema.parse({
        width: bitmap.width,
        height: bitmap.height,
      });
    } finally {
      bitmap.close();
    }
    if (
      options.pixelSize !== undefined &&
      (options.pixelSize.width !== pixelSize.width ||
        options.pixelSize.height !== pixelSize.height)
    ) {
      throw new Error("Browser image resource pixel size does not match its blob");
    }
    options.signal?.throwIfAborted();
    if (
      !generatedBrowserCaptures.has(captureId) ||
      registeredTabs.get(options.target.tabId) !== tab ||
      !targetEquals(targetFor(tab), options.target)
    ) {
      throw new Error("Browser page changed while the capture was decoded");
    }
    const expiresAt = await new Promise<number>((resolve, reject) => {
      const abort = () => {
        const waiter = browserCaptureRegistrationWaiters.get(requestId);
        if (waiter === undefined) return;
        browserCaptureRegistrationWaiters.delete(requestId);
        clearTimeout(waiter.timeout);
        waiter.unlinkAbort();
        reject(
          new DOMException(
            "Browser capture registration was cancelled",
            "AbortError",
          ),
        );
      };
      const waiter: BrowserCaptureRegistrationWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          if (browserCaptureRegistrationWaiters.get(requestId) !== waiter)
            return;
          browserCaptureRegistrationWaiters.delete(requestId);
          waiter.unlinkAbort();
          reject(new Error("Timed out registering Browser capture"));
        }, 10_000),
        unlinkAbort: () => options.signal?.removeEventListener("abort", abort),
      };
      browserCaptureRegistrationWaiters.set(requestId, waiter);
      options.signal?.addEventListener("abort", abort, { once: true });
      registrationSent = true;
      wsManager.sendBrowserCaptureRegister({
        type: "browser-capture-register",
        requestId,
        tabId: options.target.tabId,
        captureId,
        mimeType,
        pixelSize,
        byteLength: blob.size,
        expectedNavigationEpoch: options.target.navigationEpoch,
      });
    });
    options.signal?.throwIfAborted();
    if (
      registeredTabs.get(options.target.tabId) !== tab ||
      !targetEquals(targetFor(tab), options.target)
    ) {
      throw new Error("Browser page changed while the capture was registered");
    }
    return {
      captureId,
      mimeType,
      pixelSize,
      byteLength: blob.size,
      target: options.target,
      expiresAt,
    };
  } catch (error) {
    generatedBrowserCaptures.delete(captureId);
    const waiter = browserCaptureRegistrationWaiters.get(requestId);
    if (waiter !== undefined) {
      browserCaptureRegistrationWaiters.delete(requestId);
      clearTimeout(waiter.timeout);
      waiter.unlinkAbort();
    }
    if (registrationSent)
      wsManager.sendBrowserCaptureRelease({
        type: "browser-capture-release",
        requestId: randomId(),
        captureId,
        tabId: options.target.tabId,
      });
    throw error;
  }
}

function fireBrowserControllerDisposeListeners(
  listeners: Set<(reason: BrowserControllerDisposeReason) => void> | undefined,
  reason: BrowserControllerDisposeReason,
): void {
  if (listeners === undefined) return;
  for (const listener of [...listeners]) {
    listener(reason);
  }
}

/**
 * Notify every mounted Browser controller bound to the given tab that the tab
 * is genuinely gone. The host calls this only when the tab was closed or its
 * view destroyed (never on a thread switch or presentation detach).
 */
export function notifyBrowserControllerDisposed(
  tabId: string,
  reason: BrowserControllerDisposeReason,
): void {
  removeControllerRegistrations(
    (registration) => registration.tabId === tabId,
    reason,
  );
  fireBrowserControllerDisposeListeners(
    browserControllerDisposeListenersByTab.get(tabId),
    reason,
  );
}

/**
 * Notify every mounted Browser controller whose thread was deleted. The host
 * calls this before the tab tree unmounts so plugin controllers can clear
 * per-(thread, tab) records.
 */
export function notifyBrowserControllerDisposedForThread(
  threadId: string,
): void {
  fireBrowserControllerDisposeListeners(
    browserControllerDisposeListenersByThread.get(threadId),
    "thread-removed",
  );
}

/**
 * Notify every mounted Browser controller whose environment was deleted. The
 * host calls this before the tab tree unmounts.
 */
export function notifyBrowserControllerDisposedForEnvironment(
  environmentId: string,
): void {
  fireBrowserControllerDisposeListeners(
    browserControllerDisposeListenersByEnvironment.get(environmentId),
    "environment-removed",
  );
}

/**
 * Notify every mounted Browser controller owned by a plugin generation whose
 * frontend bundle was reloaded, disabled, or unloaded. In-flight contribution
 * handlers for that plugin are aborted before listeners run so the replaced
 * generation can never answer queued requests. The runtime re-mounts the
 * controller under a fresh plugin generation afterwards.
 */
export function notifyBrowserControllerDisposedForPlugin(
  pluginId: string,
): void {
  removeControllerRegistrations(
    (registration) => registration.pluginId === pluginId,
    "plugin-disposed",
  );
  for (const [key, listeners] of browserControllerDisposeListenersByPlugin) {
    if (!key.startsWith(`${pluginId}:`)) continue;
    fireBrowserControllerDisposeListeners(listeners, "plugin-disposed");
  }
}

/**
 * Notify every mounted Browser controller that the controlling realtime
 * connection dropped. Each controller tears down its exact in-flight work
 * before any plugin-disposed/unmount notification can follow a reconnect
 * replacement, so stale request-handler generations can never answer.
 */
export function notifyBrowserControllersClientDisconnected(): void {
  // Each mounted runtime subscribes once in its tab, thread, and environment
  // sets; the tab set has exactly one entry per runtime, so firing through it
  // notifies every controller exactly once.
  for (const listeners of browserControllerDisposeListenersByTab.values()) {
    fireBrowserControllerDisposeListeners(listeners, "client-disconnected");
  }
}

/**
 * Invoked after a realtime reconnect has been established and the server-side
 * registrations have been re-published (the `connected` handler sends client
 * state first). Mounted controller runtimes re-register their live request
 * handler generations with this hook, replacing the handlers torn down by
 * {@link notifyBrowserControllersClientDisconnected}.
 */
export function subscribeBrowserControllerReconnected(
  listener: () => void,
): () => void {
  browserControllerReconnectListeners.add(listener);
  return () => browserControllerReconnectListeners.delete(listener);
}

/**
 * Subscribe a mounted Browser controller runtime to disposal notifications for
 * its exact scope. Returns an unsubscribe that removes only this subscription.
 */
export function subscribeBrowserControllerDisposed(
  tabId: string,
  threadId: string,
  environmentId: string | null,
  pluginId: string,
  listener: (reason: BrowserControllerDisposeReason) => void,
): () => void {
  const tabListeners =
    browserControllerDisposeListenersByTab.get(tabId) ?? new Set();
  tabListeners.add(listener);
  browserControllerDisposeListenersByTab.set(tabId, tabListeners);
  const threadListeners =
    browserControllerDisposeListenersByThread.get(threadId) ?? new Set();
  threadListeners.add(listener);
  browserControllerDisposeListenersByThread.set(threadId, threadListeners);
  let environmentListeners:
    | Set<(reason: BrowserControllerDisposeReason) => void>
    | undefined;
  if (environmentId !== null) {
    environmentListeners =
      browserControllerDisposeListenersByEnvironment.get(environmentId) ??
      new Set();
    environmentListeners.add(listener);
    browserControllerDisposeListenersByEnvironment.set(
      environmentId,
      environmentListeners,
    );
  }
  const pluginListeners =
    browserControllerDisposeListenersByPlugin.get(`${pluginId}:${tabId}`) ??
    new Set();
  pluginListeners.add(listener);
  browserControllerDisposeListenersByPlugin.set(
    `${pluginId}:${tabId}`,
    pluginListeners,
  );
  return () => {
    const currentTab = browserControllerDisposeListenersByTab.get(tabId);
    if (currentTab !== undefined) {
      currentTab.delete(listener);
      if (currentTab.size === 0) {
        browserControllerDisposeListenersByTab.delete(tabId);
      }
    }
    const currentThread =
      browserControllerDisposeListenersByThread.get(threadId);
    if (currentThread !== undefined) {
      currentThread.delete(listener);
      if (currentThread.size === 0) {
        browserControllerDisposeListenersByThread.delete(threadId);
      }
    }
    if (environmentListeners !== undefined) {
      environmentListeners.delete(listener);
      if (environmentListeners.size === 0 && environmentId !== null) {
        browserControllerDisposeListenersByEnvironment.delete(environmentId);
      }
    }
    const currentPlugin = browserControllerDisposeListenersByPlugin.get(
      `${pluginId}:${tabId}`,
    );
    if (currentPlugin !== undefined) {
      currentPlugin.delete(listener);
      if (currentPlugin.size === 0) {
        browserControllerDisposeListenersByPlugin.delete(
          `${pluginId}:${tabId}`,
        );
      }
    }
  };
}

function sendClientState(): void {
  const tabs = new Map<
    string,
    Omit<BrowserTabDescriptor, "clientId" | "windowId">
  >();
  for (const owner of registeredOwners.values()) {
    for (const tab of owner.tabs) {
      tabs.set(tab.tabId, {
        tabId: tab.tabId,
        threadId: owner.threadId,
        projectId: owner.projectId,
        url: tab.url,
        title: tab.title,
        connected: false,
        active: false,
        navigationEpoch: 0,
      });
    }
  }
  for (const { descriptor } of registeredTabs.values()) {
    const {
      clientId: _clientId,
      windowId: _windowId,
      ...clientTab
    } = descriptor;
    tabs.set(descriptor.tabId, clientTab);
  }
  wsManager.sendBrowserClientState({
    type: "browser-client-state",
    clientId,
    windowId,
    active: isDocumentVisible(),
    canActivateThreadOwner: threadOwnerActivator !== null,
    tabs: [...tabs.values()],
    controllers: [...controllerRequestHandlers.values()]
      .filter((registration) => registeredTabs.has(registration.tabId))
      .map(({ pluginId, controllerId, tabId, registrationId }) => ({
        pluginId,
        controllerId,
        tabId,
        registrationId,
      })),
    owners: [...registeredOwners.values()].map(
      ({ active, ownerId, projectId, threadId }) => ({
        active,
        ownerId,
        projectId,
        threadId,
      }),
    ),
  });
}

function targetEquals(a: BrowserTabTarget, b: BrowserTabTarget): boolean {
  return (
    a.clientId === b.clientId &&
    a.windowId === b.windowId &&
    a.tabId === b.tabId &&
    a.navigationEpoch === b.navigationEpoch
  );
}

export function waitForBrowserControlTab(
  tabId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BrowserTabTarget> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  }
  const existing = registeredTabs.get(tabId);
  if (existing?.ready === true) {
    return Promise.resolve(targetFor(existing));
  }
  let resolve!: (target: BrowserTabTarget) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<BrowserTabTarget>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  const waiterSet = tabRegistrationWaiters.get(tabId) ?? new Set();
  const signal = options.signal;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let settled = false;
  const settle = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    waiterSet.delete(waiter);
    if (waiterSet.size === 0) tabRegistrationWaiters.delete(tabId);
    callback();
  };
  const onAbort = (): void =>
    settle(() =>
      reject(
        new DOMException("Browser tab creation was cancelled", "AbortError"),
      ),
    );
  if (signal?.aborted === true) {
    return Promise.reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    settle(() =>
      reject(new Error("The new visible Browser tab did not become available")),
    );
  }, timeoutMs);
  const waiter: BrowserTabRegistrationWaiter = {
    reject: (error) => settle(() => reject(error)),
    resolve: (target) => settle(() => resolve(target)),
    timeout,
  };
  waiterSet.add(waiter);
  tabRegistrationWaiters.set(tabId, waiterSet);
  return promise;
}

function targetFor(tab: RegisteredBrowserTab): BrowserTabTarget {
  return {
    clientId,
    windowId,
    tabId: tab.descriptor.tabId,
    navigationEpoch: tab.descriptor.navigationEpoch,
  };
}
function notifyBrowserTargetWaiters(tabId: string): void {
  const waiters = tabTargetWaiters.get(tabId);
  if (waiters === undefined) return;
  const current = registeredTabs.get(tabId);
  if (current === undefined) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("The Browser tab was detached"));
    }
    tabTargetWaiters.delete(tabId);
    return;
  }
  const observed = targetFor(current);
  for (const waiter of waiters) {
    if (
      observed.clientId !== waiter.target.clientId ||
      observed.windowId !== waiter.target.windowId ||
      observed.tabId !== waiter.target.tabId
    ) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.reject(new Error("The Browser tab target changed"));
    } else if (observed.navigationEpoch === waiter.target.navigationEpoch) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve(observed);
    } else if (observed.navigationEpoch > waiter.target.navigationEpoch) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.reject(
        new Error("A second Browser navigation overtook the wait result"),
      );
    }
  }
  if (waiters.size === 0) tabTargetWaiters.delete(tabId);
}

function waitForBrowserTarget(
  target: BrowserTabTarget,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<BrowserTabTarget> {
  const current = registeredTabs.get(target.tabId);
  if (current !== undefined) {
    const observed = targetFor(current);
    if (targetEquals(observed, target)) return Promise.resolve(observed);
    if (
      observed.clientId !== target.clientId ||
      observed.windowId !== target.windowId ||
      observed.navigationEpoch > target.navigationEpoch
    ) {
      return Promise.reject(
        new Error("A second Browser navigation overtook the wait result"),
      );
    }
  }
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Browser wait was cancelled", "AbortError"),
    );
  }
  let resolvePromise!: (target: BrowserTabTarget) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<BrowserTabTarget>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  let settled = false;
  let waiter: BrowserTargetWaiter;
  const waiters = tabTargetWaiters.get(target.tabId) ?? new Set();
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(waiter.timeout);
    signal.removeEventListener("abort", onAbort);
    waiters.delete(waiter);
    if (waiters.size === 0) tabTargetWaiters.delete(target.tabId);
    callback();
  };
  const onAbort = (): void =>
    finish(() =>
      rejectPromise(
        new DOMException("Browser wait was cancelled", "AbortError"),
      ),
    );
  waiter = {
    target,
    resolve: (observed) => finish(() => resolvePromise(observed)),
    reject: (error) => finish(() => rejectPromise(error)),
    timeout: setTimeout(
      () =>
        finish(() =>
          rejectPromise(
            new Error("The Browser tab revision was not published"),
          ),
        ),
      timeoutMs,
    ),
  };
  waiters.add(waiter);
  tabTargetWaiters.set(target.tabId, waiters);
  signal.addEventListener("abort", onAbort, { once: true });
  notifyBrowserTargetWaiters(target.tabId);
  return promise;
}

function ownerForTab(tab: RegisteredBrowserTab): RegisteredBrowserOwner | null {
  const matchingOwners = [...registeredOwners.values()].filter(
    (owner) =>
      owner.threadId === tab.descriptor.threadId &&
      owner.projectId === tab.descriptor.projectId,
  );
  const activeOwners = matchingOwners.filter((owner) => owner.active);
  const candidates = activeOwners.length > 0 ? activeOwners : matchingOwners;
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function setRequestActive(tabId: string, active: boolean): void {
  const current = activeRequestCounts.get(tabId) ?? 0;
  const next = active ? current + 1 : Math.max(0, current - 1);
  if (next === 0) activeRequestCounts.delete(tabId);
  else activeRequestCounts.set(tabId, next);
  for (const listener of activityListeners) listener();
}
function normalizeBrowserWaitResult(
  value: JsonValue,
  target: BrowserTabTarget,
  observedTarget: BrowserTabTarget,
): JsonValue {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.kind !== "string"
  ) {
    throw new Error("Browser wait returned an invalid result");
  }
  const transition =
    target.clientId !== observedTarget.clientId ||
    target.windowId !== observedTarget.windowId ||
    target.tabId !== observedTarget.tabId ||
    target.navigationEpoch !== observedTarget.navigationEpoch;
  const common = {
    target,
    ...(transition ? { originalTarget: target, observedTarget } : {}),
  };
  switch (value.kind) {
    case "locator":
    case "text":
      return browserWaitResultSchema.parse({ ...common, kind: value.kind });
    case "url":
    case "popup":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        url: value.url,
      });
    case "navigation":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        url: value.url,
        phase: value.phase,
        sameDocument: value.sameDocument,
      });
    case "load-state":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        state: value.state,
      });
    case "request":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        url: value.url,
        method: value.method,
      });
    case "response":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        url: value.url,
        method: value.method,
        status: value.status,
      });
    case "download-blocked":
      return browserWaitResultSchema.parse({
        ...common,
        kind: value.kind,
        url: value.url,
        blocked: value.blocked,
      });
    default:
      throw new Error("Browser wait returned an invalid result");
  }
}

function browserFrameForAction(
  action: BrowserControlAction,
): BrowserFrameTarget | undefined {
  const frameForPointerTarget = (
    target: Extract<
      BrowserControlAction,
      {
        kind:
          | "click"
          | "hover"
          | "right-click"
          | "middle-click"
          | "double-click";
      }
    >["target"],
  ): BrowserFrameTarget | undefined =>
    target.target === "locator" ? target.locator.frame : undefined;
  switch (action.kind) {
    case "snapshot":
      return action.frame;
    case "click":
    case "hover":
    case "right-click":
    case "middle-click":
    case "double-click":
      return frameForPointerTarget(action.target);
    case "drag": {
      const from =
        action.from.target === "locator"
          ? action.from.locator.frame
          : undefined;
      const to =
        action.to.target === "locator" ? action.to.locator.frame : undefined;
      const sameFrame =
        from === undefined
          ? to === undefined
          : to !== undefined &&
            from.frameId === to.frameId &&
            from.documentEpoch === to.documentEpoch;
      if (!sameFrame) {
        throw new Error("Browser drag endpoints must use the same frame");
      }
      return from;
    }
    case "type":
    case "select":
    case "select-multiple":
    case "upload":
    case "check":
    case "uncheck":
    case "focus":
    case "scroll-into-view":
    case "screenshot-element":
      return action.locator.frame;
    case "wait":
      return action.criteria.kind === "text"
        ? action.criteria.frame
        : action.criteria.kind === "locator"
          ? action.criteria.locator.frame
          : undefined;
    default:
      return undefined;
  }
}

const resolveLocatorSource = `
  const resolveLocator = (locator) => {
    let root = document;
    if (Array.isArray(locator.selectors)) {
      let element = null;
      for (let index = 0; index < locator.selectors.length; index += 1) {
        const matches = Array.from(root.querySelectorAll(locator.selectors[index]));
        if (matches.length === 0) throw new Error("Browser target was not found");
        if (matches.length > 1) throw new Error("Browser locator matched multiple targets");
        element = matches[0];
        if (!(element instanceof Element)) throw new Error("Browser target was not found");
        if (index < locator.selectors.length - 1) {
          if (!(element.shadowRoot instanceof ShadowRoot)) throw new Error("Browser target shadow root is unavailable");
          root = element.shadowRoot;
        }
      }
      return element;
    }
    const implicitRole = (element) => {
      if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
      if (element instanceof HTMLButtonElement) return "button";
      if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox";
      if (element instanceof HTMLTextAreaElement) return "textbox";
      if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox") return "checkbox";
        if (element.type === "radio") return "radio";
        if (["button", "reset", "submit"].includes(element.type)) return "button";
        return "textbox";
      }
      if (/^H[1-6]$/.test(element.tagName)) return "heading";
      if (element instanceof HTMLImageElement) return "img";
      return null;
    };
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => root.getElementById(id)?.textContent || "").join(" ")
        : "";
      return (element.getAttribute("aria-label") || labelledText ||
        (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent || element.value : "") ||
        element.getAttribute("alt") || element.getAttribute("title") || element.textContent || "")
        .replace(/\\s+/g, " ").trim();
    };
    const expectedRole = locator.role.toLowerCase();
    const expectedName = locator.name?.toLocaleLowerCase();
    const matches = Array.from(root.querySelectorAll("*")).filter((candidate) => {
      const role = (candidate.getAttribute("role") || implicitRole(candidate) || "").toLowerCase();
      if (role !== expectedRole) return false;
      return expectedName === undefined || accessibleName(candidate).toLocaleLowerCase() === expectedName;
    });
    if (matches.length === 0) throw new Error("Browser target was not found");
    if (matches.length > 1) throw new Error("Browser accessibility locator matched multiple targets");
    return matches[0];
  };
`;

const actionableTargetSource = `async ({ input, requireEditable }) => { ${resolveLocatorSource}
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const target = input.target?.target === "locator"
    ? resolveLocator(input.target.locator)
    : input.locator
      ? resolveLocator(input.locator)
      : document.elementFromPoint(input.target.x, input.target.y);
  if (!(target instanceof Element)) throw new Error("Browser target is not actionable");
  if (!target.isConnected) throw new Error("Browser target is detached");
  if (target.matches(":disabled,[aria-disabled='true']")) throw new Error("Browser target is disabled");
  if (requireEditable && !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) {
    throw new Error("Browser target is not editable");
  }
  target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  await nextFrame();
  const stableFrameCount = Math.max(1, Math.min(4, Number(input.stableFrameCount ?? 2)));
  let rect = target.getBoundingClientRect();
  for (let index = 1; index < stableFrameCount; index += 1) {
    await nextFrame();
    const next = target.getBoundingClientRect();
    if (
      rect.x !== next.x ||
      rect.y !== next.y ||
      rect.width !== next.width ||
      rect.height !== next.height
    ) {
      throw new Error("Browser target is moving");
    }
    rect = next;
  }
  const style = getComputedStyle(target);
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    style.pointerEvents === "none"
  ) {
    throw new Error("Browser target is not visible");
  }
  if (requireEditable) {
    target.focus();
    let active = target.ownerDocument.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== target) throw new Error("Browser target did not accept focus");
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) throw new Error("Browser target is outside the viewport");
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element) || (hit !== target && !target.contains(hit))) {
    throw new Error("Browser target is covered");
  }
  return { x, y, tag: target.localName };
}`;

const trustedClickSource = `({ input }) =>
  (${actionableTargetSource})({ input, requireEditable: false })`;

const trustedCheckSource = `async ({ input }) => { ${resolveLocatorSource}
  const point = await (${actionableTargetSource})({ input, requireEditable: false });
  const target = resolveLocator(input.locator);
  if (!(target instanceof HTMLInputElement) || (target.type !== "checkbox" && target.type !== "radio")) {
    throw new Error("Browser target is not a checkbox or radio");
  }
  if (input.kind === "uncheck" && target.type !== "checkbox") {
    throw new Error("Browser target is not a checkbox");
  }
  return {
    ...point,
    inputType: target.type,
    needsClick: input.kind === "check" ? !target.checked : target.checked,
  };
}`;

const trustedTypeSource = `({ input }) =>
  (${actionableTargetSource})({ input, requireEditable: true })`;
const keyTargetSource = `() => {
  let target = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  if (!(target instanceof HTMLElement) || target === document.body) {
    throw new Error("Browser keyboard target is not focused");
  }
  if (target.matches(":disabled,[aria-disabled='true']")) {
    throw new Error("Browser keyboard target is disabled");
  }
  const eligible =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target.isContentEditable ||
    target.tabIndex >= 0;
  if (!eligible) throw new Error("Browser keyboard target is not eligible");
  return { tag: target.localName };
}`;

const resolvePointerSource = `({ input }) => {
  const resolvePoint = ${actionableTargetSource};
  const targetFor = async (target) => {
    const point = await resolvePoint({ input: { target }, requireEditable: false });
    return {
      x: point.x,
      y: point.y,
      inViewport: point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight,
    };
  };
  return input.kind === "drag"
    ? { from: await targetFor(input.from), to: await targetFor(input.to) }
    : { target: await targetFor(input.target) };
}`;

const resolveElementRectSource = `async ({ input }) => { ${resolveLocatorSource}
  await (${actionableTargetSource})({ input, requireEditable: false });
  const element = resolveLocator(input.locator);
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
  };
}`;

function isBrowserPageRect(value: JsonValue): value is JsonValue & {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
  );
}

type BrowserPointerCoordinate = {
  x: number;
  y: number;
  inViewport: boolean;
} & JsonValue;

function isBrowserPointerCoordinate(value: JsonValue): value is JsonValue & {
  from?: BrowserPointerCoordinate;
  target?: BrowserPointerCoordinate;
  to?: BrowserPointerCoordinate;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const isCoordinate = (candidate: JsonValue | undefined): boolean =>
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.inViewport === "boolean";
  return (
    (value.target === undefined || isCoordinate(value.target)) &&
    (value.from === undefined || isCoordinate(value.from)) &&
    (value.to === undefined || isCoordinate(value.to))
  );
}
type BrowserTrustedInputPoint = JsonValue & {
  x: number;
  y: number;
  tag: string;
  inputType?: "checkbox" | "radio";
  needsClick?: boolean;
};

function isBrowserTrustedInputPoint(
  value: JsonValue,
): value is BrowserTrustedInputPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.tag === "string" &&
    (value.inputType === undefined ||
      value.inputType === "checkbox" ||
      value.inputType === "radio") &&
    (value.needsClick === undefined || typeof value.needsClick === "boolean")
  );
}
type BrowserPageScriptRunner = NonNullable<
  BbDesktopBrowserApi["experimental_runBrowserPageScript"]
>;

function isTransientActionabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "Browser target is moving" ||
    message === "Browser target is not visible" ||
    message === "Browser target is outside the viewport" ||
    message === "Browser target is covered" ||
    message === "Browser target is detached" ||
    message === "Browser target was not found" ||
    message === "Browser target shadow root is unavailable" ||
    message === "Browser pointer target must be visible in the viewport" ||
    message === "Browser drag endpoints must be visible in the viewport"
  );
}

async function resolveTrustedInputPoint(
  tab: RegisteredBrowserTab,
  action: Extract<
    BrowserControlAction,
    { kind: "click" | "type" | "check" | "uncheck" }
  >,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  run: BrowserPageScriptRunner,
): Promise<BrowserTrustedInputPoint> {
  const deadline = Date.now() + actionabilityPolicy.timeoutMs;
  let lastError: unknown = new Error("Browser target was not actionable");
  while (Date.now() <= deadline) {
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    try {
      const result = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          requestId: randomId(),
          frame: browserFrameForAction(action),
          source:
            action.kind === "type"
              ? trustedTypeSource
              : action.kind === "check" || action.kind === "uncheck"
                ? trustedCheckSource
                : trustedClickSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: remaining,
        },
        { signal },
      );
      if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
        throw new Error("Browser tab changed while resolving native input");
      }
      if (!isBrowserTrustedInputPoint(result.value)) {
        throw new Error(
          "Browser native input target resolution returned an invalid point",
        );
      }
      return result.value;
    } catch (error) {
      if (!isTransientActionabilityError(error)) throw error;
      lastError = error;
    }
    const delayMs = Math.min(
      actionabilityPolicy.pollIntervalMs,
      Math.max(0, deadline - Date.now()),
    );
    if (delayMs === 0) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Browser input was cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Browser target was not actionable before the timeout");
}
async function resolveActionablePointer(
  tab: RegisteredBrowserTab,
  action: Extract<
    BrowserControlAction,
    {
      kind: "hover" | "right-click" | "middle-click" | "double-click" | "drag";
    }
  >,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  run: BrowserPageScriptRunner,
): Promise<JsonValue> {
  const deadline = Date.now() + actionabilityPolicy.timeoutMs;
  let lastError: unknown = new Error(
    "Browser pointer target was not actionable",
  );
  while (Date.now() <= deadline) {
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    try {
      const result = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          frame: browserFrameForAction(action),
          requestId: randomId(),
          source: resolvePointerSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: remaining,
        },
        { signal },
      );
      if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
        throw new Error("Browser tab changed while resolving a pointer target");
      }
      if (!isBrowserPointerCoordinate(result.value)) {
        throw new Error(
          "Browser pointer target resolution returned an invalid result",
        );
      }
      const target = result.value.target;
      const from = result.value.from;
      const to = result.value.to;
      if (
        (target !== undefined && !target.inViewport) ||
        (from !== undefined && !from.inViewport) ||
        (to !== undefined && !to.inViewport)
      ) {
        throw new Error(
          action.kind === "drag"
            ? "Browser drag endpoints must be visible in the viewport"
            : "Browser pointer target must be visible in the viewport",
        );
      }
      return result.value;
    } catch (error) {
      if (!isTransientActionabilityError(error)) throw error;
      lastError = error;
    }
    const delayMs = Math.min(
      actionabilityPolicy.pollIntervalMs,
      Math.max(0, deadline - Date.now()),
    );
    if (delayMs === 0) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Browser input was cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Browser pointer target was not actionable before the timeout");
}

const snapshotScript = `async ({ input, signal }) => {
  const maxNodes = Math.max(1, Math.min(2000, Number(input.maxNodes ?? 500)));
  const interactiveOnly = input.mode === "interactive";
  const interactiveSelector = "a[href],button,input,select,textarea,[role],[tabindex],[contenteditable=true],summary";
  const queue = [{ root: document, shadowHosts: [] }];
  const nodes = [];
  let scanned = 0;
  let truncated = false;
  const selectorFor = (element, root) => {
    if (element.id && root.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current !== root && parts.length < 8) {
      const parent = current.parentElement;
      let part = current.localName;
      if (parent) {
        const peers = Array.from(parent.children).filter((item) => item.localName === current.localName);
        if (peers.length > 1) part += ":nth-of-type(" + (peers.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try { if (root.querySelectorAll(candidate).length === 1) return candidate; } catch {}
      current = parent;
    }
    return parts.join(" > ");
  };
  const implicitRole = (element) => {
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (["button", "reset", "submit"].includes(element.type)) return "button";
      return "textbox";
    }
    if (/^H[1-6]$/.test(element.tagName)) return "heading";
    if (element instanceof HTMLImageElement) return "img";
    return null;
  };
  while (queue.length > 0 && nodes.length < maxNodes && scanned < 10000) {
    if (signal.aborted) throw new Error("Browser snapshot cancelled");
    const scope = queue.shift();
    const walker = document.createTreeWalker(scope.root, NodeFilter.SHOW_ELEMENT);
    let element;
    while ((element = walker.nextNode()) && nodes.length < maxNodes && scanned < 10000) {
      scanned += 1;
      const rect = element.getBoundingClientRect();
      if (element.shadowRoot) queue.push({ root: element.shadowRoot, shadowHosts: [...scope.shadowHosts, selectorFor(element, scope.root)] });
      if (rect.width <= 0 || rect.height <= 0) continue;
      const interactive = element.matches(interactiveSelector);
      if (interactiveOnly && !interactive) continue;
      const editable = element.matches("input,textarea,[contenteditable]") || element.closest("[contenteditable]") !== null || element.isContentEditable || document.designMode === "on";
      const text = editable ? "" : (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
      const label = element.getAttribute("aria-label") || "";
      const role = element.getAttribute("role") || implicitRole(element) || (interactive ? element.localName : "");
      if (!interactive && !text && !label) continue;
      nodes.push({
        locator: { selectors: [...scope.shadowHosts, selectorFor(element, scope.root)] },
        tag: element.localName,
        role: role || null,
        name: label || text.slice(0, 120) || null,
        text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        interactive
      });
    }
  }
  truncated = queue.length > 0 || nodes.length >= maxNodes || scanned >= 10000;
  return { url: location.href, title: document.title || null, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, nodes, scanned, truncated };
}`;

function scriptForAction(
  action: BrowserControlAction,
  actionabilityPolicy: BrowserActionabilityPolicy,
): {
  source: string;
  input: JsonValue;
  timeoutMs: number;
  world?: "isolated" | "main";
} | null {
  switch (action.kind) {
    case "snapshot":
      return { source: snapshotScript, input: action, timeoutMs: 30_000 };
    case "select":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLSelectElement) || element.disabled) throw new Error("Browser target is not an enabled select");
          const option = Array.from(element.options).find((candidate) => candidate.value === input.value);
          if (option === undefined || option.disabled) throw new Error("Browser select option is unavailable");
          element.value = input.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: input.value };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "select-multiple":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLSelectElement) || !element.multiple || element.disabled) throw new Error("Browser target is not an enabled multiple select");
          const requested = new Set(input.values);
          const available = new Set(Array.from(element.options).filter((option) => !option.disabled).map((option) => option.value));
          for (const value of requested) if (!available.has(value)) throw new Error("Browser select option is unavailable");
          for (const option of Array.from(element.options)) option.selected = requested.has(option.value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: Array.from(element.selectedOptions).map((option) => option.value) };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "upload":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLInputElement) || element.type !== "file" || element.disabled) throw new Error("Browser target is not an enabled file input");
          const transfer = new DataTransfer();
          for (const file of input.files) {
            const binary = atob(file.base64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
          }
          element.files = transfer.files;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { uploaded: Array.from(element.files).map(({ name, size, type }) => ({ name, size, type })) };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "check":
    case "uncheck":
      return null;
    case "focus":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLElement)) throw new Error("Browser target is not focusable");
          element.focus({ preventScroll: true });
          let active = element.ownerDocument.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          if (active !== element) throw new Error("Browser target did not accept focus");
          return { focused: true, tag: element.localName };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "scroll-into-view":
      return {
        source: `({ input }) => { ${resolveLocatorSource}
          const element = resolveLocator(input.locator);
          element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
          const rect = element.getBoundingClientRect();
          return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scroll: { x: scrollX, y: scrollY } };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "scroll":
      return {
        source: `({ input }) => {
          const options = { behavior: input.behavior || "auto" };
          if (input.x !== undefined || input.y !== undefined) scrollTo({ ...options, left: input.x ?? scrollX, top: input.y ?? scrollY });
          else scrollBy({ ...options, left: input.deltaX ?? 0, top: input.deltaY ?? 0 });
          return { x: scrollX, y: scrollY };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "wait":
      return {
        source: `async ({ input, signal }) => { ${resolveLocatorSource}
          const deadline = Date.now() + input.timeoutMs;
          while (Date.now() <= deadline) {
            if (signal.aborted) throw new DOMException("Browser wait was cancelled", "AbortError");
            try {
              if (input.criteria.kind === "locator") {
                const element = resolveLocator(input.criteria.locator);
                if (element instanceof Element) return { kind: "locator" };
              } else if ((document.body?.innerText || "").includes(input.criteria.text)) {
                return { kind: "text" };
              }
            } catch {}
            const { promise, resolve } = Promise.withResolvers();
            setTimeout(resolve, 50);
            await promise;
          }
          throw new Error("Browser wait timed out");
        }`,
        input: { ...action, timeoutMs: actionabilityPolicy.timeoutMs },
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "get-storage":
      return {
        source: `() => ({
          local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean).map((key) => [key, localStorage.getItem(key)])),
          session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean).map((key) => [key, sessionStorage.getItem(key)])),
          cookies: document.cookie
        })`,
        input: null,
        timeoutMs: 10_000,
      };
    case "set-storage":
      return {
        source: `({ input }) => {
          for (const [key, value] of Object.entries(input.local)) localStorage.setItem(key, value);
          for (const [key, value] of Object.entries(input.session)) sessionStorage.setItem(key, value);
          for (const cookie of input.cookies) document.cookie = cookie;
          return { local: Object.keys(input.local).length, session: Object.keys(input.session).length, cookies: input.cookies.length };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "clear-storage":
      return {
        source: `({ input }) => {
          for (const store of input.stores) {
            if (store === "local") localStorage.clear();
            if (store === "session") sessionStorage.clear();
            if (store === "cookies") {
              for (const item of document.cookie.split(";")) {
                const name = item.split("=")[0]?.trim();
                if (name) document.cookie = name + "=; Max-Age=0; path=/";
              }
            }
          }
          return { cleared: input.stores };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "script":
      return {
        source: action.source,
        input: action.input,
        timeoutMs: action.timeoutMs,
        ...(action.world === undefined ? {} : { world: action.world }),
      };
    case "navigate":
    case "capture":
    case "screenshot":
    case "screenshot-full-page":
    case "screenshot-element":
    case "hover":
    case "right-click":
    case "middle-click":
    case "double-click":
    case "drag":
    case "back":
    case "forward":
    case "reload":
    case "set-viewport-profile":
    case "clear-viewport-profile":
    case "set-dialog-handler":
    case "set-permissions":
    case "diagnostics":
    case "list-cookie-import-sources":
    case "import-cookies-from-browser":
    case "clear-imported-cookies":
    case "activate-tab":
    case "open-tab":
    case "close-tab":
    case "list-frames":
    case "click":
    case "type":
    case "key":
      return null;
    default:
      return null;
  }
}

async function executeAction(
  tab: RegisteredBrowserTab,
  action: BrowserControlAction,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  originalTarget: BrowserTabTarget,
): Promise<JsonValue> {
  if (tab.desktopBrowser.experimental_browserControlVersion !== 2) {
    throw new Error("Browser control requires a newer BB desktop app");
  }
  if (action.kind === "activate-tab") {
    const owner = ownerForTab(tab);
    if (owner === null) {
      throw new Error("Browser tab activation is unavailable in this panel");
    }
    if (signal.aborted) {
      throw new DOMException("Browser action was cancelled", "AbortError");
    }
    return owner.activateTab(action.tabId, { signal });
  }
  if (action.kind === "open-tab") {
    const openTab = tab.openTab ?? ownerForTab(tab)?.openTab ?? null;
    if (openTab === null) {
      throw new Error("Browser tab creation is unavailable in this panel");
    }
    if (signal.aborted) {
      throw new DOMException("Browser action was cancelled", "AbortError");
    }
    return openTab(action.url, { signal });
  }
  if (action.kind === "close-tab") {
    const owner = ownerForTab(tab);
    const closeTab =
      tab.closeTab ??
      (owner === null ? null : () => owner.closeTab(tab.descriptor.tabId));
    if (closeTab === null) {
      throw new Error("Browser tab close is unavailable in this panel");
    }
    if (signal.aborted) {
      throw new DOMException("Browser action was cancelled", "AbortError");
    }
    const close = tab.desktopBrowser.experimental_closeBrowserTab;
    if (close === undefined) {
      throw new Error("Browser tab close requires a newer BB desktop app");
    }
    const result = await close({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed before it could be closed");
    }
    closeTab();
    return { closed: targetFor(tab) };
  }
  if (action.kind === "list-frames") {
    const list = tab.desktopBrowser.experimental_listBrowserFrames;
    if (list === undefined) {
      throw new Error(
        "Browser frame discovery requires a newer BB desktop app",
      );
    }
    const result = await list({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      maxFrames: action.maxFrames ?? BROWSER_CONTROL_MAX_FRAMES,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while frame discovery was running");
    }
    return result;
  }
  if (action.kind === "trust-localhost-certificate") {
    const trust = tab.desktopBrowser.experimental_trustLocalhostCertificate;
    if (trust === undefined) {
      throw new Error(
        "Browser certificate trust requires a newer BB desktop app",
      );
    }
    const result = await trust({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed before the certificate was trusted");
    }
    return { trustedOrigin: result.trustedOrigin };
  }
  if (
    action.kind === "click" ||
    action.kind === "type" ||
    action.kind === "check" ||
    action.kind === "uncheck"
  ) {
    const trustedAction = action as Extract<
      BrowserControlAction,
      { kind: "click" | "type" | "check" | "uncheck" }
    >;
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendTrusted = tab.desktopBrowser.experimental_sendBrowserTrustedInput;
    if (run === undefined || sendTrusted === undefined) {
      throw new Error("Native Browser input requires a newer BB desktop app");
    }
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const resolved = await resolveTrustedInputPoint(
      tab,
      trustedAction,
      signal,
      actionabilityPolicy,
      run,
    );
    if (
      (action.kind === "check" || action.kind === "uncheck") &&
      resolved.inputType === undefined
    ) {
      throw new Error(
        "Browser native checkbox resolution returned an invalid target",
      );
    }
    if (
      (action.kind === "check" || action.kind === "uncheck") &&
      !resolved.needsClick
    ) {
      return action.kind === "check"
        ? { checked: true, type: resolved.inputType ?? "checkbox" }
        : { checked: false };
    }
    const result = await sendTrusted(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        frame: browserFrameForAction(action),
        action:
          action.kind === "type"
            ? {
                kind: "type",
                text: action.text,
                clear: action.clear ?? false,
              }
            : {
                kind: "click",
                x: resolved.x,
                y: resolved.y,
                button: "left",
                clickCount: 1,
              },
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while native input was sent");
    }
    if (action.kind === "click") return { clicked: true };
    if (action.kind === "type") return { typed: true };
    return action.kind === "check"
      ? { checked: true, type: resolved.inputType ?? "checkbox" }
      : { checked: false };
  }
  if (action.kind === "key") {
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendTrusted = tab.desktopBrowser.experimental_sendBrowserTrustedInput;
    if (run === undefined || sendTrusted === undefined) {
      throw new Error(
        "Native Browser keyboard input requires a newer BB desktop app",
      );
    }
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const focused = await run(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        source: keyTargetSource,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      },
      { signal },
    );
    if (focused.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while checking keyboard focus");
    }
    const result = await sendTrusted(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        action: {
          kind: "key",
          key: action.key,
          code: action.code,
          modifiers: action.modifiers ?? [],
        },
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while native input was sent");
    }
    return { pressed: action.key };
  }
  if (
    action.kind === "hover" ||
    action.kind === "right-click" ||
    action.kind === "middle-click" ||
    action.kind === "double-click" ||
    action.kind === "drag"
  ) {
    const pointerAction = action as Extract<
      BrowserControlAction,
      {
        kind:
          | "hover"
          | "right-click"
          | "middle-click"
          | "double-click"
          | "drag";
      }
    >;
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendPointer = tab.desktopBrowser.experimental_sendBrowserPointerInput;
    if (run === undefined || sendPointer === undefined) {
      throw new Error(
        "Native Browser pointer actions require a newer BB desktop app",
      );
    }
    const resolvedValue = await resolveActionablePointer(
      tab,
      pointerAction,
      signal,
      actionabilityPolicy,
      run,
    );
    if (!isBrowserPointerCoordinate(resolvedValue)) {
      throw new Error(
        "Browser pointer target resolution returned an invalid result",
      );
    }
    const target = resolvedValue.target;
    const from = resolvedValue.from;
    const to = resolvedValue.to;
    const events =
      action.kind === "hover"
        ? [{ type: "mouseMove" as const, x: target!.x, y: target!.y }]
        : action.kind === "right-click" || action.kind === "middle-click"
          ? [
              { type: "mouseMove" as const, x: target!.x, y: target!.y },
              {
                type: "mouseDown" as const,
                x: target!.x,
                y: target!.y,
                button:
                  action.kind === "right-click"
                    ? ("right" as const)
                    : ("middle" as const),
                clickCount: 1,
              },
              {
                type: "mouseUp" as const,
                x: target!.x,
                y: target!.y,
                button:
                  action.kind === "right-click"
                    ? ("right" as const)
                    : ("middle" as const),
                clickCount: 1,
              },
            ]
          : action.kind === "double-click"
            ? [
                { type: "mouseMove" as const, x: target!.x, y: target!.y },
                {
                  type: "mouseDown" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                {
                  type: "mouseUp" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                {
                  type: "mouseDown" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 2,
                },
                {
                  type: "mouseUp" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 2,
                },
              ]
            : [
                { type: "mouseMove" as const, x: from!.x, y: from!.y },
                {
                  type: "mouseDown" as const,
                  x: from!.x,
                  y: from!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                { type: "mouseMove" as const, x: to!.x, y: to!.y },
                {
                  type: "mouseUp" as const,
                  x: to!.x,
                  y: to!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
              ];
    const result = await sendPointer(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        frame: browserFrameForAction(action),
        events,
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error(
        "Browser tab changed while native pointer input was sent",
      );
    }
    return result;
  }
  if (
    action.kind === "back" ||
    action.kind === "forward" ||
    action.kind === "reload"
  ) {
    if (action.kind === "back") tab.desktopBrowser.goBack(tab.descriptor.tabId);
    if (action.kind === "forward")
      tab.desktopBrowser.goForward(tab.descriptor.tabId);
    if (action.kind === "reload")
      tab.desktopBrowser.reload(tab.descriptor.tabId);
    return { accepted: true, action: action.kind };
  }
  if (
    action.kind === "set-viewport-profile" ||
    action.kind === "clear-viewport-profile"
  ) {
    const setProfile =
      tab.desktopBrowser.experimental_setBrowserViewportProfile;
    const clearProfile =
      tab.desktopBrowser.experimental_clearBrowserViewportProfile;
    if (action.kind === "clear-viewport-profile") {
      if (clearProfile === undefined) {
        throw new Error(
          "Browser viewport profiles require a newer BB desktop app",
        );
      }
      await clearProfile({ tabId: tab.descriptor.tabId });
      return { cleared: true };
    }
    if (setProfile === undefined || clearProfile === undefined) {
      throw new Error(
        "Browser viewport profiles require a newer BB desktop app",
      );
    }
    const result = await setProfile({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      profile: action.profile,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      await clearProfile({
        tabId: tab.descriptor.tabId,
        generation: result.generation,
      });
      throw new Error(
        "Browser tab changed while viewport emulation was applied",
      );
    }
    if (signal.aborted) {
      await clearProfile({
        tabId: tab.descriptor.tabId,
        generation: result.generation,
      });
      throw new DOMException(
        "Browser viewport profile was cancelled",
        "AbortError",
      );
    }
    return result;
  }
  if (action.kind === "list-cookie-import-sources") {
    const list = tab.desktopBrowser.experimental_listCookieImportSources;
    if (list === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    return list({ tabId: tab.descriptor.tabId });
  }
  if (action.kind === "import-cookies-from-browser") {
    const importCookies =
      tab.desktopBrowser.experimental_importCookiesFromBrowser;
    if (importCookies === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    if (signal.aborted) {
      throw new DOMException(
        "Browser cookie import was cancelled",
        "AbortError",
      );
    }
    const result = await importCookies({
      tabId: tab.descriptor.tabId,
      family: action.family,
      profileId: action.profileId,
    });
    return result;
  }
  if (action.kind === "clear-imported-cookies") {
    const clear = tab.desktopBrowser.experimental_clearImportedCookies;
    if (clear === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    await clear({ tabId: tab.descriptor.tabId });
    return { cleared: true };
  }
  if (
    action.kind === "set-dialog-handler" ||
    action.kind === "set-permissions" ||
    action.kind === "diagnostics" ||
    action.kind === "screenshot-full-page" ||
    action.kind === "screenshot-element"
  ) {
    const automate = tab.desktopBrowser.experimental_runBrowserAutomation;
    if (automate === undefined) {
      throw new Error("Browser automation requires a newer BB desktop app");
    }
    let desktopAction:
      | {
          kind: "set-dialog-handler";
          behavior: "accept" | "dismiss";
          promptText?: string;
        }
      | {
          kind: "set-permissions";
          decision: "allow" | "deny";
          origin: string;
          permissions: string[];
        }
      | { kind: "diagnostics" }
      | {
          kind: "capture-full-page";
          format: "png";
          quality: 100;
        }
      | {
          kind: "capture-clip";
          format: "png" | "jpeg";
          quality: number;
          x: number;
          y: number;
          width: number;
          height: number;
          frame?: BrowserFrameTarget;
        };
    if (action.kind === "screenshot-element") {
      const run = tab.desktopBrowser.experimental_runBrowserPageScript;
      if (run === undefined) {
        throw new Error(
          "Browser element screenshots require a newer BB desktop app",
        );
      }
      const rect = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          frame: browserFrameForAction(action),
          requestId: randomId(),
          source: resolveElementRectSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: actionabilityPolicy.timeoutMs,
        },
        { signal },
      );
      if (!isBrowserPageRect(rect.value)) {
        throw new Error(
          "Browser screenshot target returned an invalid rectangle",
        );
      }
      desktopAction = {
        kind: "capture-clip",
        format: action.format,
        quality: action.quality,
        x: rect.value.x,
        y: rect.value.y,
        width: rect.value.width,
        height: rect.value.height,
        ...(browserFrameForAction(action) === undefined
          ? {}
          : { frame: browserFrameForAction(action) }),
      };
    } else if (action.kind === "screenshot-full-page") {
      desktopAction = {
        kind: "capture-full-page",
        format: "png",
        quality: 100,
      };
    } else {
      desktopAction = action;
    }
    const result = await automate({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      action: desktopAction,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while automation was running");
    }
    return result.value;
  }
  if (
    action.kind === "wait" &&
    action.criteria.kind !== "locator" &&
    action.criteria.kind !== "text"
  ) {
    const wait = tab.desktopBrowser.experimental_waitBrowserEvent;
    if (wait === undefined) {
      throw new Error("Browser event waits require a newer BB desktop app");
    }
    const result = await wait(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        criteria: action.criteria,
      },
      { signal },
    );
    const transition = isBrowserTransitionWaitAction(action);
    if (
      !transition &&
      result.navigationEpoch !== originalTarget.navigationEpoch
    ) {
      throw new Error("Browser tab changed while waiting for an event");
    }
    const observedTarget = transition
      ? await waitForBrowserTarget(
          { ...originalTarget, navigationEpoch: result.navigationEpoch },
          actionabilityPolicy.timeoutMs,
          signal,
        )
      : targetFor(tab);
    if (!transition && !targetEquals(originalTarget, observedTarget)) {
      throw new Error("Browser tab changed while waiting for an event");
    }
    return normalizeBrowserWaitResult(result.value, originalTarget, observedTarget);
  }
  if (action.kind === "navigate") {
    if (!isAllowedBrowserNavigationUrl(action.url)) {
      throw new Error("Browser navigation URL is not allowed");
    }
    tab.desktopBrowser.navigate({
      tabId: tab.descriptor.tabId,
      url: action.url,
    });
    return { navigating: true, url: action.url };
  }
  if (action.kind === "screenshot") {
    const capture = tab.desktopBrowser.experimental_captureBrowserPage;
    if (capture === undefined)
      throw new Error("Browser screenshots require a newer BB desktop app");
    const result = await capture(
      {
        tabId: tab.descriptor.tabId,
        requestId: randomId(),
        format: action.format ?? "png",
        quality: action.quality ?? 85,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while the screenshot was captured");
    }
    return result;
  }
  const script = scriptForAction(action, actionabilityPolicy);
  const run = tab.desktopBrowser.experimental_runBrowserPageScript;
  if (script === null || run === undefined) {
    throw new Error("Browser page actions require a newer BB desktop app");
  }
  const locatorActionability =
    action.kind === "select" ||
    action.kind === "select-multiple" ||
    action.kind === "upload" ||
    action.kind === "focus";
  const result = await run(
    {
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      frame: browserFrameForAction(action),
      requestId: randomId(),
      ...script,
      ...(locatorActionability
        ? {
            input: {
              ...action,
              stableFrameCount: actionabilityPolicy.stableFrameCount,
            },
          }
        : {}),
    },
    { signal },
  );
  if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
    throw new Error("Browser tab changed while the action was running");
  }
  if (action.kind === "wait") {
    return normalizeBrowserWaitResult(result.value, originalTarget, targetFor(tab));
  }
  return result.value;
}

async function handlePluginRequest(
  message: BrowserPluginRequestMessage,
): Promise<void> {
  const dispatchKey = `${message.pluginId}:${message.controllerId}:${message.target.tabId}`;
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  let response: BrowserPluginResponseMessage;
  try {
    const handler = controllerRequestHandlers.get(dispatchKey);
    if (
      handler === undefined ||
      handler.registrationId !== message.registrationId
    ) {
      throw Object.assign(
        new Error(
          "The requested Browser controller is not mounted for this tab",
        ),
        { name: "browser_controller_unavailable" },
      );
    }
    const registeredTab = registeredTabs.get(message.target.tabId);
    if (
      registeredTab === undefined ||
      !targetEquals(message.target, targetFor(registeredTab))
    ) {
      throw Object.assign(
        new Error("The target Browser tab is no longer at that page revision"),
        { name: "BrowserControlTargetChangedError" },
      );
    }
    const signal = AbortSignal.any([
      controller.signal,
      handler.controller.signal,
    ]);
    signal.throwIfAborted();
    const value = await handler.handler({
      input: message.input,
      target: message.target,
      signal,
    });
    signal.throwIfAborted();
    if (
      registeredTabs.get(message.target.tabId) !== registeredTab ||
      !targetEquals(message.target, targetFor(registeredTab))
    ) {
      throw Object.assign(
        new Error("The target Browser tab changed during the contribution"),
        {
          name: "BrowserControlTargetChangedError",
        },
      );
    }
    if (controllerRequestHandlers.get(dispatchKey) !== handler) {
      throw Object.assign(
        new Error("The requested Browser controller was reloaded or disposed"),
        { name: "browser_controller_unavailable" },
      );
    }
    response = {
      type: "browser-plugin-response",
      requestId: message.requestId,
      pluginId: message.pluginId,
      controllerId: message.controllerId,
      registrationId: message.registrationId,
      ok: true,
      value,
    };
  } catch (error) {
    response = {
      type: "browser-plugin-response",
      requestId: message.requestId,
      pluginId: message.pluginId,
      controllerId: message.controllerId,
      registrationId: message.registrationId,
      ok: false,
      error: publicBrowserError(error, "BrowserPluginError"),
    };
  } finally {
    requestControllers.delete(message.requestId);
  }
  wsManager.sendBrowserPluginResponse(response);
}

function removeControllerRegistrations(
  matches: (registration: RegisteredBrowserController) => boolean,
  reason: BrowserControllerDisposeReason,
): void {
  let changed = false;
  for (const [key, registration] of controllerRequestHandlers) {
    if (!matches(registration)) continue;
    controllerRequestHandlers.delete(key);
    registration.controller.abort(new DOMException(reason, "AbortError"));
    changed = true;
  }
  if (changed) sendClientState();
}

async function handleRequest(
  message: BrowserControlRequestMessage,
): Promise<void> {
  const tab = registeredTabs.get(message.target.tabId);
  if (tab === undefined || !targetEquals(message.target, targetFor(tab))) {
    wsManager.sendBrowserControlResponse({
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(tab === undefined ? {} : { observedTarget: targetFor(tab) }),
      ok: false,
      error: {
        code: "BrowserControlTargetChangedError",
        message: "The target Browser tab is no longer at that page revision",
      },
    });
    return;
  }
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  setRequestActive(message.target.tabId, true);
  let response: BrowserControlResponseMessage;
  try {
    const value = await executeAction(
      tab,
      message.action,
      controller.signal,
      message.actionabilityPolicy,
      message.target,
    );
    const observedTarget = targetFor(tab);
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(targetEquals(observedTarget, message.target)
        ? {}
        : { observedTarget }),
      ok: true,
      value,
    };
  } catch (error) {
    const observedTarget = targetFor(tab);
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(targetEquals(observedTarget, message.target)
        ? {}
        : { observedTarget }),
      ok: false,
      error: publicBrowserError(error, "BrowserControlError"),
    };
  } finally {
    requestControllers.delete(message.requestId);
    setRequestActive(message.target.tabId, false);
  }
  wsManager.sendBrowserControlResponse(response);
}

function matchingThreadOwners(
  threadId: string,
  projectId: string,
): RegisteredBrowserOwner[] {
  const matches = [...registeredOwners.values()].filter(
    (owner) => owner.threadId === threadId && owner.projectId === projectId,
  );
  const active = matches.filter((owner) => owner.active);
  return active.length > 0 ? active : matches;
}

function resolveOwnerRegistrationWaiters(): void {
  for (const waiter of ownerRegistrationWaiters) {
    const matches = matchingThreadOwners(waiter.threadId, waiter.projectId);
    if (matches.length === 0) continue;
    ownerRegistrationWaiters.delete(waiter);
    waiter.unlinkAbort();
    const owner = matches[0];
    if (matches.length === 1 && owner !== undefined) {
      waiter.resolve(owner);
    } else {
      waiter.reject(
        new Error(
          "Multiple Browser panel owners mounted for the target thread",
        ),
      );
    }
  }
}

function waitForThreadOwner(
  threadId: string,
  projectId: string,
  signal: AbortSignal,
): Promise<RegisteredBrowserOwner> {
  const matches = matchingThreadOwners(threadId, projectId);
  const owner = matches[0];
  if (matches.length === 1 && owner !== undefined)
    return Promise.resolve(owner);
  if (matches.length > 1) {
    return Promise.reject(
      new Error("Multiple Browser panel owners mounted for the target thread"),
    );
  }
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  }
  let resolve!: (owner: RegisteredBrowserOwner) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RegisteredBrowserOwner>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let waiter: BrowserOwnerRegistrationWaiter;
  const abort = () => {
    ownerRegistrationWaiters.delete(waiter);
    reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  };
  waiter = {
    projectId,
    threadId,
    resolve,
    reject,
    unlinkAbort: () => signal.removeEventListener("abort", abort),
  };
  ownerRegistrationWaiters.add(waiter);
  signal.addEventListener("abort", abort, { once: true });
  return promise;
}

async function handleOpenRequest(
  message: BrowserOpenTabRequestMessage,
): Promise<void> {
  if (message.clientId !== clientId || message.windowId !== windowId) return;
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  let response: BrowserOpenTabResponseMessage | null = null;
  let ownerId =
    message.mode === "owner" ? message.ownerId : `thread:${message.threadId}`;
  const settle = (next: BrowserOpenTabResponseMessage): void => {
    if (response !== null) return;
    response = next;
    controller.abort("settled");
  };
  try {
    let owner: RegisteredBrowserOwner;
    if (message.mode === "owner") {
      const registeredOwner = registeredOwners.get(message.ownerId);
      if (registeredOwner === undefined) {
        throw new Error("The selected Browser panel is no longer available");
      }
      owner = registeredOwner;
    } else {
      if (threadOwnerActivator === null) {
        throw new Error(
          "This BB app cannot activate a Browser panel for another thread",
        );
      }
      await threadOwnerActivator.activate({
        projectId: message.projectId,
        signal: controller.signal,
        threadId: message.threadId,
      });
      owner = await waitForThreadOwner(
        message.threadId,
        message.projectId,
        controller.signal,
      );
      ownerId = owner.ownerId;
    }
    if (controller.signal.aborted) {
      settle({
        type: "browser-open-tab-response",
        requestId: message.requestId,
        clientId,
        windowId,
        ownerId,
        ok: false,
        error: {
          code: "AbortError",
          message: "Browser tab creation was cancelled",
        },
      });
      return;
    }
    const target = await owner.openTab(message.url, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    settle({
      type: "browser-open-tab-response",
      requestId: message.requestId,
      clientId,
      windowId,
      ownerId,
      ok: true,
      target,
    });
  } catch (error) {
    if (response !== null) return;
    settle({
      type: "browser-open-tab-response",
      requestId: message.requestId,
      clientId,
      windowId,
      ownerId,
      ok: false,
      error: publicBrowserError(error, "BrowserOpenTabError"),
    });
  } finally {
    requestControllers.delete(message.requestId);
  }
  if (response !== null) wsManager.sendBrowserOpenTabResponse(response);
}

wsManager.onBrowserOpenTabRequest((message) => void handleOpenRequest(message));

wsManager.onBrowserControlRequest((message) => void handleRequest(message));
wsManager.onBrowserPluginRequest(
  (message) => void handlePluginRequest(message),
);

wsManager.onBrowserCaptureReadRequest((message) => {
  const identity = {
    type: "browser-capture-chunk" as const,
    requestId: message.requestId,
    tabId: message.tabId,
    captureId: message.captureId,
    offset: message.offset,
  };
  void (async () => {
    try {
      const generated = generatedBrowserCaptures.get(message.captureId);
      if (generated !== undefined) {
        if (
          generated.target.tabId !== message.tabId ||
          message.offset + message.length > generated.blob.size
        ) {
          throw new Error("Browser capture read exceeds the capture bounds");
        }
        const bytes = new Uint8Array(
          await generated.blob
            .slice(message.offset, message.offset + message.length)
            .arrayBuffer(),
        );
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(
            ...bytes.subarray(index, index + 0x8000),
          );
        }
        wsManager.sendBrowserCaptureChunk({
          ...identity,
          ok: true,
          base64: btoa(binary),
          eof: message.offset + bytes.length === generated.blob.size,
        });
        return;
      }
      const tab = registeredTabs.get(message.tabId);
      const read = tab?.desktopBrowser.experimental_readBrowserCaptureChunk;
      if (read === undefined) {
        throw new Error(
          "Browser capture reads require an available current desktop tab",
        );
      }
      const chunk = await read({
        tabId: message.tabId,
        captureId: message.captureId,
        offset: message.offset,
        length: message.length,
      });
      if (
        chunk.captureId !== message.captureId ||
        chunk.offset !== message.offset
      ) {
        throw new Error("Browser capture returned a foreign chunk");
      }
      wsManager.sendBrowserCaptureChunk({ ...identity, ok: true, ...chunk });
    } catch (error) {
      wsManager.sendBrowserCaptureChunk({
        ...identity,
        ok: false,
        error: publicBrowserError(error, "BrowserCaptureReadError"),
      });
    }
  })();
});

wsManager.onBrowserCaptureRelease((message) => {
  generatedBrowserCaptures.delete(message.captureId);
  const tab = registeredTabs.get(message.tabId);
  tab?.desktopBrowser.experimental_releaseBrowserCapture?.({
    captureId: message.captureId,
    tabId: message.tabId,
  });
});
wsManager.onBrowserCaptureRegistered((message) => {
  const waiter = browserCaptureRegistrationWaiters.get(message.requestId);
  if (waiter === undefined) {
    const generated = message.ok
      ? generatedBrowserCaptures.get(message.captureId)
      : null;
    if (message.ok && generated !== null && generated !== undefined) {
      wsManager.sendBrowserCaptureRelease({
        type: "browser-capture-release",
        requestId: randomId(),
        tabId: generated.target.tabId,
        captureId: message.captureId,
      });
    }
    if (message.ok) generatedBrowserCaptures.delete(message.captureId);
    return;
  }
  browserCaptureRegistrationWaiters.delete(message.requestId);
  clearTimeout(waiter.timeout);
  waiter.unlinkAbort();
  if (message.ok) {
    waiter.resolve(message.expiresAt);
  } else {
    waiter.reject(new Error(message.error.message));
  }
});

wsManager.onBrowserCaptureCreate((message) => {
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  void (async () => {
    let ownedCaptureId: string | null = null;
    const tab = registeredTabs.get(message.tabId);
    const release = tab?.desktopBrowser.experimental_releaseBrowserCapture;
    try {
      if (
        tab === undefined ||
        tab.desktopBrowser.experimental_browserControlVersion !== 2 ||
        release === undefined
      ) {
        throw new Error(
          "Browser capture requires an available current desktop tab",
        );
      }
      if (tab.descriptor.navigationEpoch !== message.expectedNavigationEpoch) {
        throw new Error("Browser page changed before capture");
      }
      controller.signal.throwIfAborted();
      let raw: unknown;
      if (message.mode === "viewport") {
        const capture = tab.desktopBrowser.experimental_captureBrowserPage;
        if (capture === undefined)
          throw new Error("Browser capture requires a newer desktop app");
        raw = await capture(
          {
            tabId: message.tabId,
            requestId: message.requestId,
            format: message.format ?? "png",
            quality: message.quality ?? 85,
            expectedNavigationEpoch: message.expectedNavigationEpoch,
          },
          { signal: controller.signal },
        );
      } else if (message.mode === "full-page") {
        const automate = tab.desktopBrowser.experimental_runBrowserAutomation;
        if (automate === undefined)
          throw new Error("Full-page capture requires a newer desktop app");
        const result = await automate({
          tabId: message.tabId,
          expectedNavigationEpoch: message.expectedNavigationEpoch,
          action: {
            kind: "capture-full-page",
            format: message.format ?? "png",
            quality: message.quality ?? 85,
          },
        });
        raw = result.value;
      } else {
        if (message.locator === undefined)
          throw new Error("Element capture requires a locator");
        raw = await executeAction(
          tab,
          {
            kind: "screenshot-element",
            locator: message.locator,
            format: message.format ?? "png",
            quality: message.quality ?? 85,
          },
          controller.signal,
          {
            timeoutMs: 10_000,
            pollIntervalMs: 100,
            stableFrameCount: 2,
          },
          targetFor(tab),
        );
      }
      if (
        raw !== null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        "captureId" in raw &&
        typeof raw.captureId === "string"
      ) {
        ownedCaptureId = raw.captureId;
      }
      const descriptor = bbDesktopBrowserCaptureDescriptorSchema.parse(raw);
      controller.signal.throwIfAborted();
      if (
        registeredTabs.get(message.tabId) !== tab ||
        descriptor.navigationEpoch !== message.expectedNavigationEpoch ||
        tab.descriptor.navigationEpoch !== message.expectedNavigationEpoch
      ) {
        throw new Error("Browser page changed during capture");
      }
      wsManager.sendBrowserCaptureCreated({
        type: "browser-capture-created",
        requestId: message.requestId,
        ok: true,
        ...descriptor,
      });
      ownedCaptureId = null;
    } catch (error) {
      wsManager.sendBrowserCaptureCreated({
        type: "browser-capture-created",
        requestId: message.requestId,
        ok: false,
        error: publicBrowserError(error, "BrowserCaptureError"),
      });
    } finally {
      requestControllers.delete(message.requestId);
      if (ownedCaptureId !== null && release !== undefined) {
        await release({ captureId: ownedCaptureId, tabId: message.tabId });
      }
    }
  })();
});

wsManager.onBrowserControlCancel((message) => {
  requestControllers
    .get(message.requestId)
    ?.abort(new DOMException(message.reason, "AbortError"));
});
wsManager.onConnectionStateChange(() => {
  if (wsManager.getConnectionState() === "connected") return;
  generatedBrowserCaptures.clear();
  for (const waiter of browserCaptureRegistrationWaiters.values()) {
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    waiter.reject(
      new DOMException("Browser capture client disconnected", "AbortError"),
    );
  }
  browserCaptureRegistrationWaiters.clear();
  for (const controller of requestControllers.values()) {
    controller.abort(new DOMException("client-disconnected", "AbortError"));
  }
  removeControllerRegistrations(() => true, "client-disconnected");
  notifyBrowserControllersClientDisconnected();
});
wsManager.onConnected(() => {
  sendClientState();
  // The server has now re-registered this client's tabs/owners (the state
  // push above). Only now may controllers re-publish their live handler
  // generations for the fresh connection.
  for (const listener of [...browserControllerReconnectListeners]) listener();
});
subscribeToDocumentVisibility(sendClientState);

export function registerBrowserThreadOwnerActivator(
  activator: BrowserThreadOwnerActivator,
): BrowserThreadOwnerActivatorRegistration {
  if (threadOwnerActivator !== null) {
    throw new Error("A Browser thread owner activator is already registered");
  }
  threadOwnerActivator = activator;
  sendClientState();
  return {
    dispose() {
      if (threadOwnerActivator !== activator) return;
      threadOwnerActivator = null;
      sendClientState();
    },
  };
}

export function registerBrowserControlOwner(
  args: RegisterBrowserControlOwnerArgs,
): BrowserControlOwnerRegistration {
  const registration = { ...args };
  registeredOwners.set(args.ownerId, registration);
  sendClientState();
  resolveOwnerRegistrationWaiters();
  return {
    updateTabs(tabs) {
      if (registeredOwners.get(args.ownerId) !== registration) return;
      registration.tabs = tabs;
      sendClientState();
    },
    dispose() {
      if (registeredOwners.get(args.ownerId) !== registration) return;
      registeredOwners.delete(args.ownerId);
      sendClientState();
    },
  };
}

export function registerBrowserControlTab(
  args: RegisterBrowserControlTabArgs,
): BrowserControlTabRegistration {
  const descriptorFor = (
    next: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): BrowserTabDescriptor => ({
    clientId,
    windowId,
    tabId: args.tabId,
    threadId: args.threadId,
    projectId: args.projectId,
    url: next.state?.url ?? next.url,
    title: next.state?.title ?? null,
    connected: true,
    active: next.active,
    navigationEpoch: next.state?.navigationEpoch ?? 0,
  });
  const registration: RegisteredBrowserTab = {
    descriptor: descriptorFor(args),
    desktopBrowser: args.desktopBrowser,
    openTab: args.openTab ?? null,
    closeTab: args.closeTab ?? null,
    ready: (args.state?.navigationEpoch ?? 0) > 0,
  };
  registeredTabs.set(args.tabId, registration);
  if (registration.ready) {
    const waiterSet = tabRegistrationWaiters.get(args.tabId);
    if (waiterSet !== undefined) {
      tabRegistrationWaiters.delete(args.tabId);
      for (const waiter of waiterSet) {
        clearTimeout(waiter.timeout);
        waiter.resolve(targetFor(registration));
      }
    }
  }
  notifyBrowserTargetWaiters(args.tabId);
  sendClientState();
  return {
    update(next) {
      if (registeredTabs.get(args.tabId) !== registration) return;
      const descriptor = descriptorFor(next);
      const changed =
        JSON.stringify(descriptor) !== JSON.stringify(registration.descriptor);
      registration.descriptor = descriptor;
      registration.ready = (next.state?.navigationEpoch ?? 0) > 0;
      if (registration.ready) {
        const waiterSet = tabRegistrationWaiters.get(args.tabId);
        if (waiterSet !== undefined) {
          tabRegistrationWaiters.delete(args.tabId);
          for (const waiter of waiterSet) {
            clearTimeout(waiter.timeout);
            waiter.resolve(targetFor(registration));
          }
        }
      }
      notifyBrowserTargetWaiters(args.tabId);
      if (changed) sendClientState();
    },
    dispose() {
      if (registeredTabs.get(args.tabId) !== registration) return;
      registeredTabs.delete(args.tabId);
      notifyBrowserTargetWaiters(args.tabId);
      const waiterSet = tabRegistrationWaiters.get(args.tabId);
      if (waiterSet !== undefined) {
        tabRegistrationWaiters.delete(args.tabId);
        for (const waiter of [...waiterSet]) {
          clearTimeout(waiter.timeout);
          waiter.reject(new Error("The new Browser tab was disposed"));
        }
      }
      sendClientState();
    },
  };
}

export function registerBrowserControllerRequestHandler(
  pluginId: string,
  controllerId: string,
  tabId: string,
  handler: (request: {
    input: JsonValue;
    target: BrowserTabTarget;
    signal: AbortSignal;
  }) => Promise<JsonValue>,
): () => void {
  const key = `${pluginId}:${controllerId}:${tabId}`;
  const previous = controllerRequestHandlers.get(key);
  previous?.controller.abort(new DOMException("plugin-disposed", "AbortError"));
  const registration: RegisteredBrowserController = {
    pluginId,
    controllerId,
    tabId,
    handler,
    registrationId: crypto.randomUUID(),
    controller: new AbortController(),
  };
  controllerRequestHandlers.set(key, registration);
  sendClientState();
  return () => {
    if (controllerRequestHandlers.get(key) !== registration) return;
    controllerRequestHandlers.delete(key);
    registration.controller.abort(
      new DOMException("plugin-disposed", "AbortError"),
    );
    sendClientState();
  };
}

export function subscribeBrowserControlActivity(
  listener: () => void,
): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function browserControlActivitySnapshot(tabId: string): number {
  return activeRequestCounts.get(tabId) ?? 0;
}
