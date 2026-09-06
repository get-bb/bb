import type {
  CookiesSetDetails,
  RenderProcessGoneDetails,
  WebContentsView,
} from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bbDesktopBrowserCaptureDescriptorSchema } from "@bb/desktop-contract";
import type {
  BbDesktopBrowserImportCookiesRequest,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import {
  createDesktopBrowserViewManager as createProductionDesktopBrowserViewManager,
  isAllowedBrowserPermission,
  type CreateDesktopBrowserViewManagerArgs,
  type DesktopBrowserViewManager,
  type DesktopBrowserHostContentBounds,
  type DesktopBrowserHostContentView,
  type DesktopBrowserHostWebContents,
  type DesktopBrowserHostWebContentsPayload,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

function createDesktopBrowserViewManager(
  args: Partial<CreateDesktopBrowserViewManagerArgs> = {},
): DesktopBrowserViewManager {
  return createProductionDesktopBrowserViewManager({
    dispatchAppCommand: () => undefined,
    focusHostWebContents: () => undefined,
    resolveAppCommand: () => null,
    ...args,
  });
}

interface FakePreventableEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface FakeWebContentsEvent {}

interface FakeNavigationEvent extends FakePreventableEvent {
  initiator?: FakeWebFrameMain | null;
  isMainFrame: boolean;
  url: string;
}

type FakeVoidWebContentsListener = () => void;
type FakeConsoleMessageListener = (
  event: FakeWebContentsEvent,
  level: number,
  message: string,
  line: number,
  sourceId: string,
) => void;

type FakeWillFrameNavigateListener = (event: FakeNavigationEvent) => void;

type FakeWillRedirectListener = (
  event: FakeNavigationEvent,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void;

type FakeDidNavigateListener = (
  event: FakeWebContentsEvent,
  url: string,
) => void;

type FakeDidNavigateInPageListener = (
  event: FakeWebContentsEvent,
  url: string,
  isMainFrame: boolean,
) => void;

type FakePageTitleUpdatedListener = (
  event: FakePreventableEvent,
  title: string,
) => void;

type FakeDidFailLoadListener = (
  event: FakeWebContentsEvent,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean,
) => void;

interface FakeContextMenuParams {
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canRedo: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
  };
}

type FakeContextMenuListener = (
  event: FakeWebContentsEvent,
  params: FakeContextMenuParams,
) => void;

interface FakeInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

type FakeBeforeInputListener = (
  event: FakePreventableEvent,
  input: FakeInput,
) => void;

type FakeRenderProcessGoneDetails = Pick<
  RenderProcessGoneDetails,
  "exitCode" | "reason"
>;

type FakeRenderProcessGoneListener = (
  event: FakeWebContentsEvent,
  details: FakeRenderProcessGoneDetails,
) => void;

interface FakeFoundInPageResult {
  activeMatchOrdinal: number;
  finalUpdate: boolean;
  matches: number;
  requestId: number;
  selectionArea: { height: number; width: number; x: number; y: number };
}

type FakeFoundInPageListener = (
  event: FakeWebContentsEvent,
  result: FakeFoundInPageResult,
) => void;

interface FakeFindInPageCall {
  options: { findNext: boolean; forward: boolean };
  text: string;
}

interface FakeWebContentsEventMap {
  focus: FakeVoidWebContentsListener;
  "console-message": FakeConsoleMessageListener;
  "before-input-event": FakeBeforeInputListener;
  "will-frame-navigate": FakeWillFrameNavigateListener;
  "will-redirect": FakeWillRedirectListener;
  "dom-ready": FakeVoidWebContentsListener;
  "did-start-loading": FakeVoidWebContentsListener;
  "did-stop-loading": FakeVoidWebContentsListener;
  "did-finish-load": FakeVoidWebContentsListener;
  "did-navigate": FakeDidNavigateListener;
  "did-navigate-in-page": FakeDidNavigateInPageListener;
  "did-start-navigation": FakeVoidWebContentsListener;
  "page-title-updated": FakePageTitleUpdatedListener;
  "did-fail-load": FakeDidFailLoadListener;
  "context-menu": FakeContextMenuListener;
  "render-process-gone": FakeRenderProcessGoneListener;
  "found-in-page": FakeFoundInPageListener;
}

interface FakeWebFrameMain {
  origin: string;
}

interface FakeSessionEvent {
  preventDefault(): void;
}

type FakeSessionListener = (event: FakeSessionEvent) => void;

type FakePermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details?: { requestingUrl?: string },
) => void;

type FakePermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin?: string,
  details?: { requestingUrl?: string },
) => boolean;

interface FakeWindowOpenDetails {
  disposition: "foreground-tab" | "new-window";
  features: string;
  frameName: string;
  url: string;
}

interface FakeBrowserWindowOptions {
  alwaysOnTop?: boolean;
  center?: boolean;
  frame?: boolean;
  height?: number;
  show?: boolean;
  title?: string;
  transparent?: boolean;
  width?: number;
  webContents?: FakePopupWebContents;
  x?: number;
  y?: number;
  webPreferences?: {
    allowRunningInsecureContent?: boolean;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
    partition?: string;
    sandbox?: boolean;
    webSecurity?: boolean;
  };
}

interface FakePopupWebContents {
  emitWindowOpen(
    url: string,
    details?: Partial<Omit<FakeWindowOpenDetails, "url">>,
  ): FakeWindowOpenDecision;
}

interface FakeWindowOpenDecision {
  action: "allow" | "deny";
  createWindow?: (options: FakeBrowserWindowOptions) => FakePopupWebContents;
}

type FakeWindowOpenHandler = (
  details: FakeWindowOpenDetails,
) => FakeWindowOpenDecision;

const electronMock = vi.hoisted(() => {
  interface FakeNativeImage {
    getSize(): { height: number; width: number };
    isEmpty(): boolean;
    toJPEG(quality: number): Buffer;
    toPNG(): Buffer;
  }

  interface FakeDidFailLoadArgs {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
    validatedURL: string;
  }

  type FakeCertificateErrorListener = (
    event: FakePreventableEvent,
    webContents: { id: number },
    url: string,
    error: string,
    certificate: object,
    callback: (trusted: boolean) => void,
  ) => void;

  type FakeWebContentsListeners = {
    [TEventName in keyof FakeWebContentsEventMap]: Array<
      FakeWebContentsEventMap[TEventName]
    >;
  };

  class FakePreventableEventImpl implements FakePreventableEvent {
    public defaultPrevented = false;

    preventDefault(): void {
      this.defaultPrevented = true;
    }
  }

  class FakeNavigationEventImpl
    extends FakePreventableEventImpl
    implements FakeNavigationEvent
  {
    public readonly initiator?: FakeWebFrameMain | null;
    public readonly isMainFrame: boolean;
    public readonly url: string;

    constructor(args: {
      initiatorOrigin?: string | null;
      isMainFrame: boolean;
      url: string;
    }) {
      super();
      this.initiator =
        args.initiatorOrigin === undefined
          ? undefined
          : args.initiatorOrigin === null
            ? null
            : { origin: args.initiatorOrigin };
      this.isMainFrame = args.isMainFrame;
      this.url = args.url;
    }
  }

  const fakeWebContentsEvent: FakeWebContentsEvent = {};

  const fakeCapturedImage: FakeNativeImage = {
    getSize: () => ({ width: 1_200, height: 800 }),
    isEmpty: () => false,
    toJPEG: () => Buffer.from("jpeg-bytes"),
    toPNG: () => Buffer.from("png-bytes"),
  };

  let currentSession: object | null = null;

  interface FakeDebuggerCommand {
    method: string;
    params:
      | ({ cookies?: readonly object[] } & Record<string, unknown>)
      | undefined;
  }

  class FakeDebugger {
    public attached = false;
    public readonly attachCalls: string[] = [];
    public detachCalls = 0;
    public detachOnGate = false;
    public readonly gates = new Map<string, Promise<void>>();
    public readonly sendCommandCalls: FakeDebuggerCommand[] = [];
    public getFrameTreeResult?: object;
    private readonly messageListeners: Array<
      (
        event: FakeWebContentsEvent,
        method: string,
        params: Record<string, unknown>,
        sessionId?: string,
      ) => void
    > = [];

    on(
      eventName: "message" | "detach",
      listener: (
        event: FakeWebContentsEvent,
        method: string,
        params: Record<string, unknown>,
        sessionId?: string,
      ) => void,
    ): void {
      if (eventName === "message") this.messageListeners.push(listener);
    }

    removeListener(
      _eventName: "message",
      listener: (
        event: FakeWebContentsEvent,
        method: string,
        params: Record<string, unknown>,
        sessionId?: string,
      ) => void,
    ): void {
      const index = this.messageListeners.indexOf(listener);
      if (index !== -1) this.messageListeners.splice(index, 1);
    }

    emitMessage(
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ): void {
      for (const listener of this.messageListeners) {
        listener(fakeWebContentsEvent, method, params, sessionId);
      }
    }

    attach(protocolVersion: string): void {
      this.attached = true;
      this.attachCalls.push(protocolVersion);
    }

    detach(): void {
      this.attached = false;
      this.detachCalls += 1;
    }

    isAttached(): boolean {
      return this.attached;
    }

    async sendCommand(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ): Promise<object> {
      this.sendCommandCalls.push({ method, params });
      const gate = this.gates.get(method);
      if (gate !== undefined) {
        await gate;
        if (this.attached === false && this.detachOnGate) {
          throw new Error("debugger detached");
        }
      }
      if (method === "ServiceWorker.enable") {
        queueMicrotask(() => {
          this.emitMessage("ServiceWorker.workerRegistrationUpdated", {
            registrations: [],
          });
        });
      }
      if (method === "Page.getLayoutMetrics") {
        return { cssContentSize: { width: 1_200, height: 2_400 } };
      }
      if (method === "Page.captureScreenshot") {
        return { data: Buffer.from("full-page").toString("base64") };
      }
      if (method === "Page.getFrameTree") {
        return this.getFrameTreeResult ?? {};
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            type: "string",
            value: JSON.stringify({ ok: true, value: null }),
          },
        };
      }
      if (method === "Page.createIsolatedWorld") {
        const frameId = params?.frameId;
        if (typeof frameId === "string") {
          queueMicrotask(() => {
            this.emitMessage(
              "Runtime.executionContextCreated",
              {
                context: {
                  id: 900,
                  uniqueId: `bb-isolated-${frameId}`,
                  name: "bb-browser-frame-v1",
                  auxData: { frameId, isDefault: false, type: "isolated" },
                },
              },
              sessionId,
            );
          });
        }
        return { executionContextId: 900 };
      }
      if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
      if (method === "DOM.getBoxModel") {
        return { model: { content: [20, 30, 120, 30, 120, 80, 20, 80] } };
      }
      return {};
    }
  }

  class FakeWebContents {
    public activeHistoryIndex = 0;
    public canGoBackResult = false;
    public canGoForwardResult = false;
    public destroyed = false;
    public readonly debugger = new FakeDebugger();
    public readonly mainFrame = { framesInSubtree: [{ origin: "null" }] };
    public readonly session: object | null;
    public focusCalls = 0;
    public readonly goBackCalls: string[] = [];
    public readonly goForwardCalls: string[] = [];
    public historyEntries: Array<{ title: string; url: string }> = [];
    public readonly id: number;
    public readonly loadURLCalls: string[] = [];
    public readonly findInPageCalls: FakeFindInPageCall[] = [];
    public readonly stopFindInPageCalls: string[] = [];
    public reloadCalls = 0;
    public stopCalls = 0;
    public readonly pendingCaptureResolvers: Array<
      (image: FakeNativeImage) => void
    > = [];
    private readonly listeners: FakeWebContentsListeners = {
      "console-message": [],
      "dom-ready": [],
      focus: [],
      "before-input-event": [],
      "will-frame-navigate": [],
      "will-redirect": [],
      "did-start-loading": [],
      "did-stop-loading": [],
      "did-finish-load": [],
      "did-navigate": [],
      "did-navigate-in-page": [],
      "did-start-navigation": [],
      "page-title-updated": [],
      "did-fail-load": [],
      "context-menu": [],
      "render-process-gone": [],
      "found-in-page": [],
    };
    private title = "";
    private url = "";
    private windowOpenHandler: FakeWindowOpenHandler | null = null;

    constructor(id: number) {
      this.id = id;
      this.session = currentSession;
    }

    public readonly navigationHistory = {
      canGoBack: (): boolean => this.canGoBackResult,
      canGoForward: (): boolean => this.canGoForwardResult,
      getActiveIndex: (): number => this.activeHistoryIndex,
      getEntryAtIndex: (index: number): { title: string; url: string } | null =>
        this.historyEntries[index] ?? null,
      goBack: (): void => {
        this.goBackCalls.push("goBack");
      },
      goForward: (): void => {
        this.goForwardCalls.push("goForward");
      },
    };

    beginFrameSubscription(callback: () => void): void {
      callback();
    }

    endFrameSubscription(): void {}

    capturePage(): Promise<FakeNativeImage> {
      return new Promise((resolve) => {
        this.pendingCaptureResolvers.push(resolve);
      });
    }

    close(): void {
      this.destroyed = true;
    }

    focus(): void {
      this.focusCalls += 1;
      this.emitFocus();
    }

    findInPage(
      text: string,
      options: { findNext: boolean; forward: boolean },
    ): number {
      this.findInPageCalls.push({ text, options });
      return this.findInPageCalls.length;
    }

    stopFindInPage(action: string): void {
      this.stopFindInPageCalls.push(action);
    }

    emitFoundInPage(result: FakeFoundInPageResult): void {
      for (const listener of this.listeners["found-in-page"]) {
        listener(fakeWebContentsEvent, result);
      }
    }

    isDevToolsOpened(): boolean {
      return false;
    }

    getTitle(): string {
      return this.title;
    }

    getURL(): string {
      return this.url;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isLoadingMainFrame(): boolean {
      return false;
    }

    loadURL(url: string): Promise<void> {
      this.url = url;
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }

    on<TEventName extends keyof FakeWebContentsEventMap>(
      eventName: TEventName,
      listener: FakeWebContentsEventMap[TEventName],
    ): void {
      this.listeners[eventName].push(listener);
    }

    reload(): void {
      this.reloadCalls += 1;
    }

    setWindowOpenHandler(handler: FakeWindowOpenHandler): void {
      this.windowOpenHandler = handler;
    }

    stop(): void {
      this.stopCalls += 1;
    }

    emitDidFailLoad(args: FakeDidFailLoadArgs): void {
      for (const listener of this.listeners["did-fail-load"]) {
        listener(
          fakeWebContentsEvent,
          args.errorCode,
          args.errorDescription,
          args.validatedURL,
          args.isMainFrame,
        );
      }
    }

    emitFocus(): void {
      for (const listener of this.listeners.focus) listener();
    }

    emitRenderProcessGone(details: FakeRenderProcessGoneDetails): void {
      for (const listener of this.listeners["render-process-gone"]) {
        listener(fakeWebContentsEvent, details);
      }
    }

    emitDidFinishLoad(): void {
      for (const listener of this.listeners["did-finish-load"]) {
        listener();
      }
    }

    emitBeforeInput(
      input: Partial<FakeInput> & Pick<FakeInput, "key">,
    ): boolean {
      const event = new FakePreventableEventImpl();
      const resolvedInput: FakeInput = {
        alt: false,
        control: false,
        isAutoRepeat: false,
        isComposing: false,
        meta: false,
        shift: false,
        type: "keyDown",
        ...input,
      };
      for (const listener of this.listeners["before-input-event"]) {
        listener(event, resolvedInput);
      }
      return event.defaultPrevented;
    }

    emitDidNavigate(url: string): void {
      this.url = url;
      for (const listener of this.listeners["did-navigate"]) {
        listener(fakeWebContentsEvent, url);
      }
    }

    emitDidStartNavigation(isMainFrame = true): void {
      for (const listener of this.listeners["did-start-navigation"]) {
        (listener as (...args: unknown[]) => void)(
          fakeWebContentsEvent,
          this.url,
          false,
          isMainFrame,
        );
      }
    }

    emitPageTitleUpdated(title: string): boolean {
      const event = new FakePreventableEventImpl();
      for (const listener of this.listeners["page-title-updated"]) {
        listener(event, title);
      }
      return event.defaultPrevented;
    }
    emitWillFrameNavigate(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-frame-navigate"]) {
        listener(event);
      }
      return event.defaultPrevented;
    }

    emitWillRedirect(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-redirect"]) {
        listener(event, url, false, isMainFrame);
      }
      return event.defaultPrevented;
    }

    emitWindowOpen(
      url: string,
      details: Partial<Omit<FakeWindowOpenDetails, "url">> = {},
    ): FakeWindowOpenDecision {
      if (this.windowOpenHandler === null) {
        throw new Error("Expected a window open handler to be registered.");
      }
      return this.windowOpenHandler({
        disposition: "foreground-tab",
        features: "",
        frameName: "",
        ...details,
        url,
      });
    }
  }

  let nextWebContentsId = 1;

  class FakeWebContentsView {
    public readonly boundsCalls: BbDesktopBrowserViewBounds[] = [];
    public readonly webContents: FakeWebContents;
    public visible = false;

    constructor() {
      this.webContents = new FakeWebContents(nextWebContentsId);
      nextWebContentsId += 1;
    }

    setBounds(bounds: BbDesktopBrowserViewBounds): void {
      this.boundsCalls.push(bounds);
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  class FakeBrowserWindow {
    public readonly options: FakeBrowserWindowOptions;
    public readonly webContents: FakePopupWebContents;
    public closeCalls = 0;
    public destroyCalls = 0;
    public readonly loadURLCalls: string[] = [];
    public readonly titleCalls: string[] = [];
    private closedListener: (() => void) | null = null;
    private destroyed = false;

    constructor(options: FakeBrowserWindowOptions) {
      this.options = options;
      if (options.webContents === undefined) {
        this.webContents = new FakeWebContents(nextWebContentsId);
        nextWebContentsId += 1;
      } else {
        this.webContents = options.webContents;
      }
    }

    close(): void {
      this.closeCalls += 1;
    }

    destroy(): void {
      this.destroyCalls += 1;
      this.destroyed = true;
      this.closedListener?.();
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    loadURL(url: string): Promise<void> {
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }

    once(_eventName: "closed", listener: () => void): void {
      this.closedListener = listener;
    }

    setTitle(title: string): void {
      this.titleCalls.push(title);
    }
  }

  class FakeSession {
    public clearCacheCalls = 0;
    public readonly clearStorageDataCalls: Array<
      { storages: string[] } | undefined
    > = [];
    public flushStoreCalls = 0;
    public failNextCookieSets = 0;
    public readonly cookieSetCalls: CookiesSetDetails[] = [];
    public readonly cookieGetResults: Array<{
      domain?: string;
      expirationDate?: number | null;
      hostOnly?: boolean;
      httpOnly?: boolean;
      name: string;
      path?: string;
      sameSite?: string;
      secure?: boolean;
      value?: string;
    }> = [];
    public readonly cookieRemoveCalls: Array<{ name: string; url: string }> =
      [];
    public readonly cookies = {
      flushStore: async (): Promise<void> => {
        this.flushStoreCalls += 1;
      },
      get: async (): Promise<typeof this.cookieGetResults> =>
        this.cookieGetResults.map((cookie) => ({ ...cookie })),
      remove: async (url: string, name: string): Promise<void> => {
        this.cookieRemoveCalls.push({ name, url });
        const target = new URL(url);
        for (
          let index = this.cookieGetResults.length - 1;
          index >= 0;
          index -= 1
        ) {
          const cookie = this.cookieGetResults[index];
          if (
            cookie?.name === name &&
            cookie.domain?.replace(/^\./u, "") === target.hostname &&
            target.pathname.startsWith(cookie.path ?? "/")
          ) {
            this.cookieGetResults.splice(index, 1);
          }
        }
      },
      set: async (details: CookiesSetDetails): Promise<void> => {
        if (this.failNextCookieSets > 0) {
          this.failNextCookieSets -= 1;
          throw new Error("simulated cookie write failure");
        }
        this.cookieSetCalls.push(details);
        const url = new URL(details.url);
        const cookie = {
          domain:
            details.domain === undefined
              ? url.hostname
              : `.${details.domain.replace(/^\./u, "")}`,
          hostOnly: details.domain === undefined,
          name: details.name ?? "",
          value: details.value ?? "",
          path: details.path ?? "/",
          httpOnly: details.httpOnly ?? false,
          secure: details.secure ?? false,
          sameSite: details.sameSite ?? "unspecified",
          ...(details.expirationDate === undefined
            ? {}
            : { expirationDate: details.expirationDate }),
        };
        const index = this.cookieGetResults.findIndex(
          (stored) =>
            stored.domain === cookie.domain &&
            stored.name === cookie.name &&
            stored.path === cookie.path,
        );
        if (index === -1) this.cookieGetResults.push(cookie);
        else this.cookieGetResults.splice(index, 1, cookie);
      },
    };
    async clearCache(): Promise<void> {
      this.clearCacheCalls += 1;
    }
    async clearStorageData(options?: { storages: string[] }): Promise<void> {
      this.clearStorageDataCalls.push(options);
      if (options === undefined || options.storages.includes("cookies")) {
        this.cookieGetResults.length = 0;
      }
    }
    public readonly serviceWorkers = {
      getAllRunning: (): Record<string, never> => ({}),
    };
    public readonly webRequest = {
      onBeforeRequest: (
        listener: (
          details: {
            id: number;
            method: string;
            url: string;
            resourceType?: string;
            webContentsId?: number;
          },
          callback: (response: Record<string, never>) => void,
        ) => void,
      ): void => {
        this.onBeforeRequestListener = listener;
      },
      onCompleted: (
        listener: (details: {
          id: number;
          method: string;
          statusCode: number;
          url: string;
          webContentsId?: number;
        }) => void,
      ): void => {
        this.onCompletedListener = listener;
      },
      onBeforeRedirect: (
        listener: (details: {
          id: number;
          method: string;
          statusCode: number;
          url: string;
          webContentsId?: number;
        }) => void,
      ): void => {
        this.onBeforeRedirectListener = listener;
      },
      onErrorOccurred: (
        listener: (details: {
          id: number;
          error: string;
          method: string;
          url: string;
          webContentsId?: number;
        }) => void,
      ): void => {
        this.onErrorOccurredListener = listener;
      },
    };
    public onBeforeRequestListener:
      | ((
          details: {
            id: number;
            method: string;
            url: string;
            resourceType?: string;
            webContentsId?: number;
          },
          callback: (response: Record<string, never>) => void,
        ) => void)
      | null = null;
    public onCompletedListener:
      | ((details: {
          id: number;
          method: string;
          statusCode: number;
          url: string;
          webContentsId?: number;
        }) => void)
      | null = null;
    public onBeforeRedirectListener:
      | ((details: {
          id: number;
          method: string;
          statusCode: number;
          url: string;
          webContentsId?: number;
        }) => void)
      | null = null;
    public onErrorOccurredListener:
      | ((details: {
          id: number;
          error: string;
          method: string;
          url: string;
          webContentsId?: number;
        }) => void)
      | null = null;
    public readonly willDownloadListeners: FakeSessionListener[] = [];
    public permissionCheckHandler: FakePermissionCheckHandler | null = null;
    public permissionRequestHandler: FakePermissionRequestHandler | null = null;
    public certificateVerifyProc:
      | ((
          request: { hostname: string },
          callback: (result: number) => void,
        ) => void)
      | null = null;
    on(eventName: "will-download", listener: FakeSessionListener): void {
      this.willDownloadListeners.push(listener);
    }

    setPermissionCheckHandler(handler: FakePermissionCheckHandler): void {
      this.permissionCheckHandler = handler;
    }

    setPermissionRequestHandler(handler: FakePermissionRequestHandler): void {
      this.permissionRequestHandler = handler;
    }

    setCertificateVerifyProc(
      handler: (
        request: { hostname: string },
        callback: (result: number) => void,
      ) => void,
    ): void {
      this.certificateVerifyProc = handler;
    }
  }

  const fakeSessions: FakeSession[] = [];
  const fakeViews: FakeWebContentsView[] = [];
  const certificateErrorListeners: FakeCertificateErrorListener[] = [];
  const fakeWindows: FakeBrowserWindow[] = [];

  return {
    app: {
      on(event: string, listener: FakeCertificateErrorListener): void {
        if (event !== "certificate-error") {
          throw new Error(`Unexpected native application event: ${event}`);
        }
        certificateErrorListeners.push(listener);
      },
    },
    fakeCapturedImage,
    certificateErrorListeners,
    fakeSessions,
    fakeViews,
    fakeWindows,
    createFakeWebContents() {
      const contents = new FakeWebContents(nextWebContentsId);
      nextWebContentsId += 1;
      return contents;
    },
    FakeBaseWindow: class {
      private destroyed = false;
      readonly contentView = {
        addChildView(_view: FakeWebContentsView): void {},
        removeChildView(_view: FakeWebContentsView): void {},
      };
      destroy(): void {
        this.destroyed = true;
      }
      isDestroyed(): boolean {
        return this.destroyed;
      }
      getOpacity(): number {
        return 0;
      }
      isFocusable(): boolean {
        return false;
      }
      setContentSize(_width: number, _height: number): void {}
      showInactive(): void {}
    },
    FakeBrowserWindow: class extends FakeBrowserWindow {
      constructor(options: FakeBrowserWindowOptions) {
        super(options);
        fakeWindows.push(this);
      }
    },
    FakeWebContentsView: class extends FakeWebContentsView {
      constructor() {
        super();
        fakeViews.push(this);
      }
    },
    session: {
      fromPartition() {
        const fakeSession = new FakeSession();
        currentSession = fakeSession;
        fakeSessions.push(fakeSession);
        return fakeSession;
      },
    },
    webContents: {
      getAllWebContents: () => fakeViews.map((view) => view.webContents),
    },
  };
});

vi.mock("electron", () => ({
  BaseWindow: electronMock.FakeBaseWindow,
  BrowserWindow: electronMock.FakeBrowserWindow,
  WebContentsView: electronMock.FakeWebContentsView,
  app: electronMock.app,
  session: electronMock.session,
  webContents: electronMock.webContents,
}));

interface FakeHostWindowArgs {
  contentBounds: DesktopBrowserHostContentBounds;
  webContentsId: number;
}

class FakeHostWebContents implements DesktopBrowserHostWebContents {
  public destroyed = false;
  public readonly sentPayloads: DesktopBrowserHostWebContentsPayload[] = [];
  public readonly sentChannels: string[] = [];
  public readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void {
    this.sentChannels.push(channel);
    this.sentPayloads.push(payload);
  }
}

class FakeContentView implements DesktopBrowserHostContentView {
  public readonly addedViews: WebContentsView[] = [];
  public readonly addCalls: Array<{
    index: number | undefined;
    view: WebContentsView;
  }> = [];
  public readonly removedViews: WebContentsView[] = [];

  addChildView(view: WebContentsView, index?: number): void {
    this.addedViews.push(view);
    this.addCalls.push({ index, view });
  }

  removeChildView(view: WebContentsView): void {
    this.removedViews.push(view);
  }
}

class FakeHostWindow implements DesktopBrowserHostWindow {
  public contentBounds: DesktopBrowserHostContentBounds;
  public destroyed = false;
  public readonly contentView = new FakeContentView();
  public readonly webContents: FakeHostWebContents;

  constructor({ contentBounds, webContentsId }: FakeHostWindowArgs) {
    this.contentBounds = contentBounds;
    this.webContents = new FakeHostWebContents(webContentsId);
  }

  getContentBounds(): DesktopBrowserHostContentBounds {
    return this.contentBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

beforeEach(() => {
  vi.useRealTimers();
  electronMock.certificateErrorListeners.length = 0;
  electronMock.fakeSessions.length = 0;
  electronMock.fakeViews.length = 0;
  electronMock.fakeWindows.length = 0;
});

async function settlePendingCaptures(
  view: (typeof electronMock.fakeViews)[number],
): Promise<void> {
  for (const resolve of view.webContents.pendingCaptureResolvers.splice(0)) {
    resolve(electronMock.fakeCapturedImage);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function snapshotPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; dataUrl: string | null }> {
  const pushes: Array<{ tabId: string; dataUrl: string | null }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("dataUrl" in payload) {
      pushes.push(payload);
    }
  }
  return pushes;
}

function findResultPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; requestId: number }> {
  const pushes: Array<{ tabId: string; requestId: number }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("requestId" in payload) {
      pushes.push(payload);
    }
  }
  return pushes;
}

interface AttachBrowserTabArgs {
  hostWindow: FakeHostWindow;
  manager: DesktopBrowserViewManager;
  tabId: string;
  url: string;
}

function attachBrowserTab(args: AttachBrowserTabArgs): void {
  args.manager.attach({
    hostWindow: args.hostWindow,
    request: {
      tabId: args.tabId,
      url: args.url,
      bounds: { x: 100, y: 50, width: 500, height: 350 },
      visible: true,
    },
  });
}

function requireFakeView(
  index: number,
): (typeof electronMock.fakeViews)[number] {
  const view = electronMock.fakeViews[index];
  expect(view).toBeDefined();
  if (view === undefined) {
    throw new Error("Expected the browser view to be created.");
  }
  return view;
}

function requireFakeSession(
  index: number,
): (typeof electronMock.fakeSessions)[number] {
  const fakeSession = electronMock.fakeSessions[index];
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected the browser session to be created.");
  }
  return fakeSession;
}

function createRendererRecoveryFixture(webContentsId: number) {
  const manager = createDesktopBrowserViewManager({
    partition: "persist:test",
  });
  const hostWindow = new FakeHostWindow({
    contentBounds: { width: 700, height: 450 },
    webContentsId,
  });
  attachBrowserTab({
    manager,
    hostWindow,
    tabId: "browser:a",
    url: "https://example.com/original",
  });
  return { manager, hostWindow, view: requireFakeView(0) };
}

function openTabPushesOf(hostWindow: FakeHostWindow): string[] {
  const pushes: string[] = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && !("tabId" in payload)) {
      pushes.push(payload.url);
    }
  }
  return pushes;
}

function scopedOpenTabPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; url: string }> {
  const pushes: Array<{ tabId: string; url: string }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && "tabId" in payload && !("title" in payload)) {
      pushes.push(payload);
    }
  }
  return pushes;
}

describe("DesktopBrowserViewManager", () => {
  it("places browser content below the host renderer", () => {
    const manager = createDesktopBrowserViewManager();
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 48,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });

    expect(hostWindow.contentView.addCalls).toEqual([
      { index: 0, view: requireFakeView(0) },
    ]);
  });

  it("removes hidden native views from the host input tree and restores them on show", () => {
    const manager = createDesktopBrowserViewManager();
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 49,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });
    expect(hostWindow.contentView.removedViews).toEqual([view]);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(hostWindow.contentView.addCalls).toEqual([
      { index: 0, view },
      { index: 0, view },
    ]);
    expect(view.visible).toBe(true);
  });

  it("imports cookies atomically across live tabs and clears them", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 49,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });
    const otherHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });
    attachBrowserTab({
      manager,
      hostWindow: otherHostWindow,
      tabId: "browser:b",
      url: "about:blank",
    });
    await requireFakeView(0).webContents.loadURL("about:blank");
    await requireFakeView(1).webContents.loadURL("about:blank");
    const request = {
      tabId: "browser:a",
      cookies: [
        {
          domain: "example.com",
          expirationDate: null,
          httpOnly: true,
          name: "__Host-session",
          path: "/",
          sameSite: "lax",
          secure: true,
          value: "host-value",
        },
        {
          domain: ".example.com",
          expirationDate: null,
          httpOnly: true,
          name: "__Host-invalid",
          path: "/",
          sameSite: "lax",
          secure: true,
          value: "invalid-value",
        },
        {
          domain: ".example.com",
          expirationDate: null,
          httpOnly: true,
          name: "__Secure-session",
          path: "/",
          sameSite: "strict",
          secure: true,
          value: "secure-value",
        },
        {
          domain: ".example.com",
          expirationDate: null,
          httpOnly: true,
          name: "overlap",
          path: "/",
          sameSite: "lax",
          secure: true,
          value: "secure-overlap",
        },
        {
          domain: "sub.example.com",
          expirationDate: null,
          httpOnly: false,
          name: "overlap",
          path: "/account",
          sameSite: "lax",
          secure: false,
          value: "insecure-overlap",
        },
      ],
    } satisfies BbDesktopBrowserImportCookiesRequest;

    await expect(
      manager.importCookies({ hostWindow, request }),
    ).rejects.toBeInstanceOf(Error);
    const browserSession = requireFakeSession(0);
    expect(await browserSession.cookies.get()).toEqual([]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(0);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(0);
    const validRequest = {
      tabId: "browser:a",
      cookies: request.cookies.filter(
        (cookie) => cookie.name !== "__Host-invalid",
      ),
    } satisfies BbDesktopBrowserImportCookiesRequest;
    await expect(
      manager.importCookies({ hostWindow, request: validRequest }),
    ).resolves.toEqual({ importedCookies: 4 });
    const stored = await browserSession.cookies.get();
    expect(stored).toEqual([
      expect.objectContaining({
        domain: "example.com",
        hostOnly: true,
        name: "__Host-session",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        value: "host-value",
      }),
      expect.objectContaining({
        domain: ".example.com",
        hostOnly: false,
        name: "__Secure-session",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        value: "secure-value",
      }),
      expect.objectContaining({
        domain: ".example.com",
        hostOnly: false,
        name: "overlap",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        value: "secure-overlap",
      }),
      expect.objectContaining({
        domain: "sub.example.com",
        hostOnly: true,
        name: "overlap",
        path: "/account",
        httpOnly: false,
        secure: false,
        sameSite: "lax",
        value: "insecure-overlap",
      }),
    ]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(1);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(1);

    await expect(
      manager.importCookies({ hostWindow, request: validRequest }),
    ).resolves.toEqual({ importedCookies: 4 });
    expect(await browserSession.cookies.get()).toEqual(stored);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(2);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(2);
    await manager.clearImportedCookies({ hostWindow, tabId: "browser:a" });
    expect(await browserSession.cookies.get()).toEqual([]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(3);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(3);
    await expect(
      manager.importCookies({
        hostWindow,
        request: { tabId: "browser:a", cookies: [] },
      }),
    ).resolves.toEqual({ importedCookies: 0 });
    expect(await browserSession.cookies.get()).toEqual([]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(4);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(4);
  });

  it("removes existing HttpOnly cookies before importing replacements", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });
    const browserSession = requireFakeSession(0);
    browserSession.cookieGetResults.push({
      domain: ".github.com",
      name: "user_session",
      path: "/",
      secure: true,
    });

    await expect(
      manager.importCookies({
        hostWindow,
        request: {
          tabId: "browser:a",
          cookies: [
            {
              domain: ".github.com",
              expirationDate: null,
              httpOnly: true,
              name: "user_session",
              path: "/",
              sameSite: "lax",
              secure: true,
              value: "replacement",
            },
          ],
        },
      }),
    ).resolves.toEqual({ importedCookies: 1 });

    expect(await browserSession.cookies.get()).toEqual([
      expect.objectContaining({
        domain: ".github.com",
        httpOnly: true,
        name: "user_session",
        value: "replacement",
      }),
    ]);
  });

  it("preserves host-only and domain cookies Electron distinguishes", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 54,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });

    await expect(
      manager.importCookies({
        hostWindow,
        request: {
          tabId: "browser:a",
          cookies: [
            {
              domain: "github.com",
              expirationDate: null,
              httpOnly: true,
              name: "user_session",
              path: "/",
              sameSite: "lax",
              secure: true,
              value: "host-only",
            },
            {
              domain: ".github.com",
              expirationDate: null,
              httpOnly: true,
              name: "user_session",
              path: "/",
              sameSite: "lax",
              secure: true,
              value: "domain",
            },
            {
              domain: ".github.com",
              expirationDate: null,
              httpOnly: false,
              name: "user_session",
              path: "/",
              sameSite: "lax",
              secure: true,
              value: "domain-duplicate",
            },
          ],
        },
      }),
    ).resolves.toEqual({ importedCookies: 2 });

    expect(await requireFakeSession(0).cookies.get()).toEqual([
      expect.objectContaining({
        domain: "github.com",
        hostOnly: true,
        value: "host-only",
      }),
      expect.objectContaining({
        domain: ".github.com",
        hostOnly: false,
        value: "domain",
      }),
    ]);
  });

  it("rolls back to the exact prior cookies when a commit write fails", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 55,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });
    const browserSession = requireFakeSession(0);
    browserSession.cookieGetResults.push(
      {
        domain: "github.com",
        name: "prior",
        path: "/",
        secure: true,
        httpOnly: true,
        value: "prior-value",
        sameSite: "lax",
      },
      {
        domain: ".github.com",
        name: "prior-domain",
        path: "/",
        secure: true,
        httpOnly: false,
        value: "prior-domain-value",
        sameSite: "lax",
      },
    );

    browserSession.failNextCookieSets = 1;
    await expect(
      manager.importCookies({
        hostWindow,
        request: {
          tabId: "browser:a",
          cookies: [
            {
              domain: ".github.com",
              expirationDate: null,
              httpOnly: true,
              name: "replacement",
              path: "/",
              sameSite: "lax",
              secure: true,
              value: "replacement-value",
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(await browserSession.cookies.get()).toEqual([
      expect.objectContaining({
        domain: "github.com",
        hostOnly: true,
        name: "prior",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        value: "prior-value",
      }),
      expect.objectContaining({
        domain: ".github.com",
        hostOnly: false,
        name: "prior-domain",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "lax",
        value: "prior-domain-value",
      }),
    ]);
  });

  it("serializes cookie imports across Browser windows", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const firstHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });
    const secondHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });
    attachBrowserTab({
      manager,
      hostWindow: firstHostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });
    attachBrowserTab({
      manager,
      hostWindow: secondHostWindow,
      tabId: "browser:b",
      url: "about:blank",
    });
    await requireFakeView(0).webContents.loadURL("about:blank");
    await requireFakeView(1).webContents.loadURL("about:blank");
    const firstImport = manager.importCookies({
      hostWindow: firstHostWindow,
      request: {
        tabId: "browser:a",
        cookies: [
          {
            domain: ".example.com",
            expirationDate: null,
            httpOnly: true,
            name: "first",
            path: "/",
            sameSite: "lax",
            secure: true,
            value: "first-value",
          },
        ],
      },
    });
    const secondImport = manager.importCookies({
      hostWindow: secondHostWindow,
      request: {
        tabId: "browser:b",
        cookies: [
          {
            domain: ".example.org",
            expirationDate: null,
            httpOnly: true,
            name: "second",
            path: "/",
            sameSite: "lax",
            secure: true,
            value: "second-value",
          },
        ],
      },
    });

    await expect(Promise.all([firstImport, secondImport])).resolves.toEqual([
      { importedCookies: 1 },
      { importedCookies: 1 },
    ]);
    const browserSession = requireFakeSession(0);
    expect(await browserSession.cookies.get()).toEqual([
      expect.objectContaining({
        domain: ".example.org",
        name: "second",
        value: "second-value",
      }),
    ]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(2);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(2);
  });

  it("batches large cookie imports through the native session", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "about:blank",
    });
    const request = {
      tabId: "browser:a",
      cookies: Array.from({ length: 251 }, (_, index) => ({
        domain: ".example.com",
        expirationDate: null,
        httpOnly: true,
        name: `session-${index}`,
        path: "/",
        sameSite: "lax" as const,
        secure: true,
        value: `value-${index}`,
      })),
    } satisfies BbDesktopBrowserImportCookiesRequest;

    await expect(
      manager.importCookies({ hostWindow, request }),
    ).resolves.toEqual({ importedCookies: 251 });
    const browserSession = requireFakeSession(0);
    expect(
      (await browserSession.cookies.get()).map(({ name, value }) => ({
        name,
        value,
      })),
    ).toEqual(request.cookies.map(({ name, value }) => ({ name, value })));
  });

  it("binds page captures to the exact navigation epoch", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 49,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);

    const capture = manager.capturePage({
      hostWindow,
      request: {
        tabId: "browser:a",
        requestId: "capture-1",
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 0,
      },
    });
    await vi.waitUntil(
      () => view.webContents.pendingCaptureResolvers.length > 0,
    );
    view.webContents.pendingCaptureResolvers.shift()?.(
      electronMock.fakeCapturedImage,
    );
    await expect(capture).resolves.toMatchObject({
      navigationEpoch: 0,
      format: "png",
      pixelSize: { width: 1_200, height: 800 },
    });
    const captureResult = await capture;

    const chunk = await manager.readCaptureChunk({
      hostWindow,
      request: {
        captureId: captureResult.captureId,
        tabId: "browser:a",
        offset: 0,
        length: 262_144,
      },
    });
    expect(chunk).toMatchObject({
      captureId: captureResult.captureId,
      offset: 0,
      eof: true,
    });
    expect(Buffer.from(chunk.base64, "base64")).toEqual(
      Buffer.from("png-bytes"),
    );
    manager.releaseCapture({
      hostWindow,
      request: { captureId: captureResult.captureId, tabId: "browser:a" },
    });
    await expect(
      manager.readCaptureChunk({
        hostWindow,
        request: {
          captureId: captureResult.captureId,
          tabId: "browser:a",
          offset: 0,
          length: 100,
        },
      }),
    ).rejects.toThrow("Browser capture is not available");

    const invalidatedCapture = manager.capturePage({
      hostWindow,
      request: {
        tabId: "browser:a",
        requestId: "capture-2",
        format: "jpeg",
        quality: 75,
        expectedNavigationEpoch: 0,
      },
    });
    const invalidatedCaptureFailed = expect(
      invalidatedCapture,
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitUntil(
      () => view.webContents.pendingCaptureResolvers.length > 0,
    );
    view.webContents.emitDidStartNavigation();
    view.webContents.pendingCaptureResolvers.shift()?.(
      electronMock.fakeCapturedImage,
    );
    await invalidatedCaptureFailed;
    await expect(
      manager.capturePage({
        hostWindow,
        request: {
          tabId: "browser:a",
          requestId: "capture-3",
          format: "png",
          quality: 85,
          expectedNavigationEpoch: 0,
        },
      }),
    ).rejects.toThrow("Browser page changed before capture");
  });
  it("aborts an in-flight capture when explicit navigation supersedes it", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 79,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:capture-cancel",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    const capture = manager.capturePage({
      hostWindow,
      request: {
        tabId: "browser:capture-cancel",
        requestId: "capture-cancel",
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 0,
      },
    });
    await vi.waitUntil(
      () => view.webContents.pendingCaptureResolvers.length === 1,
    );
    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:capture-cancel",
        url: "https://next.example.com",
      },
    });
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    view.webContents.pendingCaptureResolvers.shift()?.(
      electronMock.fakeCapturedImage,
    );
  });
  it("captures full pages and scopes dialogs, permissions, and diagnostics to one tab", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    const fakeSession = electronMock.fakeSessions.at(-1);
    if (
      fakeSession?.permissionCheckHandler === null ||
      fakeSession?.permissionCheckHandler === undefined ||
      fakeSession.permissionRequestHandler === null
    ) {
      throw new Error("Expected Browser permission handlers");
    }

    await expect(
      manager.runAutomation({
        hostWindow,
        request: {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          action: {
            kind: "set-permissions",
            decision: "allow",
            origin: "https://example.com",
            permissions: ["media"],
          },
        },
      }),
    ).resolves.toMatchObject({
      navigationEpoch: 0,
      value: { decision: "allow", permissions: ["media"] },
    });
    expect(
      fakeSession.permissionCheckHandler(
        view.webContents,
        "media",
        "https://example.com",
        { requestingUrl: "https://example.com/" },
      ),
    ).toBe(true);
    const permissionDecisions: boolean[] = [];
    fakeSession.permissionRequestHandler(
      view.webContents,
      "media",
      (allowed) => permissionDecisions.push(allowed),
      { requestingUrl: "https://example.com/" },
    );
    expect(permissionDecisions).toEqual([true]);
    expect(
      fakeSession.permissionCheckHandler(
        view.webContents,
        "media",
        "https://other.example",
        { requestingUrl: "https://other.example/" },
      ),
    ).toBe(false);
    await manager.runAutomation({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        action: {
          kind: "set-permissions",
          decision: "deny",
          origin: "https://example.com",
          permissions: ["clipboard-sanitized-write"],
        },
      },
    });
    expect(
      fakeSession.permissionCheckHandler(
        view.webContents,
        "clipboard-sanitized-write",
        "https://example.com",
        { requestingUrl: "https://example.com/" },
      ),
    ).toBe(false);
    expect(
      fakeSession.permissionCheckHandler(
        view.webContents,
        "clipboard-sanitized-write",
        "https://example.org",
        { requestingUrl: "https://example.org/" },
      ),
    ).toBe(true);

    await manager.runAutomation({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        action: {
          kind: "set-dialog-handler",
          behavior: "accept",
          promptText: "approved",
        },
      },
    });
    view.webContents.debugger.emitMessage("Page.javascriptDialogOpening", {
      message: "Continue?",
      type: "prompt",
    });
    expect(view.webContents.debugger.sendCommandCalls).toContainEqual({
      method: "Page.handleJavaScriptDialog",
      params: { accept: true, promptText: "approved" },
    });

    const captured = await manager.runAutomation({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        action: { kind: "capture-full-page", format: "png", quality: 100 },
      },
    });
    const descriptor = bbDesktopBrowserCaptureDescriptorSchema.parse(
      captured.value,
    );
    expect(descriptor).toMatchObject({
      navigationEpoch: 0,
      pixelSize: { width: 1_200, height: 2_400 },
    });
    await expect(
      manager.readCaptureChunk({
        hostWindow,
        request: {
          tabId: "browser:a",
          captureId: descriptor.captureId,
          offset: 0,
          length: descriptor.byteLength,
        },
      }),
    ).resolves.toMatchObject({
      base64: Buffer.from("full-page").toString("base64"),
      eof: true,
    });

    await expect(
      manager.runAutomation({
        hostWindow,
        request: {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          action: { kind: "diagnostics" },
        },
      }),
    ).resolves.toMatchObject({
      value: {
        dialogs: [
          expect.objectContaining({
            behavior: "accept",
            message: "Continue?",
          }),
        ],
        permissions: [
          expect.objectContaining({
            decision: "allow",
            permission: "media",
          }),
        ],
      },
    });
  });

  it("never synthesizes the main world from an isolated world for a frame", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:c",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:c", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const child = listed.frames[0];
    if (child === undefined) throw new Error("Expected a child frame.");
    const target = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };

    // Only an isolated context has surfaced for the first child; a
    // main-world request must not create a synthetic world. It fails fast.
    view.webContents.debugger.emitMessage("Runtime.executionContextCreated", {
      context: {
        id: 21,
        uniqueId: "isolated-child-21",
        name: "bb-browser-frame-v1",
        auxData: { frameId: "child", isDefault: false, type: "isolated" },
      },
    });
    const createCallsBefore = view.webContents.debugger.sendCommandCalls.filter(
      (command) => command.method === "Page.createIsolatedWorld",
    ).length;

    await expect(
      manager.runPageScript({
        hostWindow,
        request: {
          tabId: "browser:c",
          expectedNavigationEpoch: 0,
          requestId: "req-main-missing",
          frame: target,
          world: "main",
          source: "() => ({ w: 2 })",
          input: null,
          timeoutMs: 1000,
        },
      }),
    ).rejects.toThrow("The Browser frame target changed");
    const createCallsAfter = view.webContents.debugger.sendCommandCalls.filter(
      (command) => command.method === "Page.createIsolatedWorld",
    );
    expect(createCallsAfter).toHaveLength(createCallsBefore);

    // A second child frame has no isolated context yet: requesting the
    // isolated world must create it, and only with the BB world name.
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
            childFrames: [
              {
                frame: {
                  id: "grandchild",
                  loaderId: "grandchild-loader",
                  name: "",
                  url: "https://grand.example.com",
                },
              },
            ],
          },
        ],
      },
    };
    const relisted = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:c", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const grandchild = relisted.frames.find((frame) => frame.depth === 2);
    if (grandchild === undefined) {
      throw new Error("Expected a grandchild frame.");
    }
    const grandchildTarget = {
      frameId: grandchild.frameId,
      documentEpoch: grandchild.documentEpoch,
    };
    await expect(
      manager.runPageScript({
        hostWindow,
        request: {
          tabId: "browser:c",
          expectedNavigationEpoch: 0,
          requestId: "req-iso-create",
          frame: grandchildTarget,
          world: "isolated",
          source: "() => ({ w: 1 })",
          input: null,
          timeoutMs: 1000,
        },
      }),
    ).resolves.toMatchObject({ requestId: "req-iso-create" });
    const created = [...view.webContents.debugger.sendCommandCalls]
      .reverse()
      .find((command) => command.method === "Page.createIsolatedWorld");
    expect(created?.params?.worldName).toBe("bb-browser-frame-v1");
    expect(created?.params?.frameId).toBe("grandchild");
  });

  it("never adopts an unrelated non-default world as the BB isolated world", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 55,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:worlds",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "browser:worlds",
        expectedNavigationEpoch: 0,
        maxFrames: 8,
      },
    });
    const child = listed.frames[0];
    if (child === undefined)
      throw new Error("Expected a discovered child frame.");
    const target = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };
    // An extension/content-script world without the BB world name arrives.
    view.webContents.debugger.emitMessage("Runtime.executionContextCreated", {
      context: {
        id: 71,
        uniqueId: "extension-child-71",
        name: "chrome-extension://abc",
        auxData: { frameId: "child", isDefault: false, type: "isolated" },
      },
    });
    // A default context arrives too (must still be adopted as main).
    view.webContents.debugger.emitMessage("Runtime.executionContextCreated", {
      context: {
        id: 70,
        uniqueId: "main-child-70",
        auxData: { frameId: "child", isDefault: true, type: "default" },
      },
    });
    const isolated = await manager.runPageScript({
      hostWindow,
      request: {
        tabId: "browser:worlds",
        expectedNavigationEpoch: 0,
        requestId: "req-world-iso",
        frame: target,
        world: "isolated",
        source: "() => ({ w: 1 })",
        input: null,
        timeoutMs: 1000,
      },
    });
    expect(isolated).toMatchObject({ requestId: "req-world-iso" });
    const created = view.webContents.debugger.sendCommandCalls.find(
      (command) => command.method === "Page.createIsolatedWorld",
    );
    expect(created).toBeDefined();
    expect(created?.params?.frameId).toBe("child");
    const isolatedEvaluate = [...view.webContents.debugger.sendCommandCalls]
      .reverse()
      .find((command) => command.method === "Runtime.evaluate");
    // The evaluation must not use the unrelated world's context (71).
    expect(isolatedEvaluate?.params?.contextId).not.toBe(71);
  });

  it("creates the isolated world once for concurrent frame scripts", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 54,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:e",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "fresh-child",
              loaderId: "fresh-loader",
              name: "",
              url: "https://fresh.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:e", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const child = listed.frames[0];
    if (child === undefined) throw new Error("Expected a child frame.");
    const target = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };

    let openCreateGate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      openCreateGate = resolve;
    });
    view.webContents.debugger.gates.set("Page.createIsolatedWorld", createGate);

    const first = manager.runPageScript({
      hostWindow,
      request: {
        tabId: "browser:e",
        expectedNavigationEpoch: 0,
        requestId: "req-dedupe-1",
        frame: target,
        world: "isolated",
        source: "() => ({ w: 1 })",
        input: null,
        timeoutMs: 1000,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = manager.runPageScript({
      hostWindow,
      request: {
        tabId: "browser:e",
        expectedNavigationEpoch: 0,
        requestId: "req-dedupe-2",
        frame: target,
        world: "isolated",
        source: "() => ({ w: 2 })",
        input: null,
        timeoutMs: 1000,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      view.webContents.debugger.sendCommandCalls.filter(
        (command) => command.method === "Page.createIsolatedWorld",
      ),
    ).toHaveLength(1);
    openCreateGate();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { requestId: "req-dedupe-1" },
      { requestId: "req-dedupe-2" },
    ]);
    expect(
      view.webContents.debugger.sendCommandCalls.filter(
        (command) => command.method === "Page.createIsolatedWorld",
      ),
    ).toHaveLength(1);
  });
  it("cancels a frame script while its isolated-world setup is pending", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:cancelled-frame",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const frames = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "browser:cancelled-frame",
        expectedNavigationEpoch: 0,
        maxFrames: 8,
      },
    });
    const child = frames.frames[0];
    if (child === undefined) throw new Error("Expected a child frame.");
    const frame = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };
    const worldCreation = Promise.withResolvers<void>();
    view.webContents.debugger.gates.set(
      "Page.createIsolatedWorld",
      worldCreation.promise,
    );
    const running = manager.runPageScript({
      hostWindow,
      request: {
        tabId: "browser:cancelled-frame",
        expectedNavigationEpoch: 0,
        requestId: "cancelled-frame-script",
        frame,
        world: "isolated",
        source: "() => ({ value: 1 })",
        input: null,
        timeoutMs: 1_000,
      },
    });
    const rejection = expect(running).rejects.toMatchObject({
      name: "NavigationError",
    });
    await vi.waitFor(() =>
      expect(
        view.webContents.debugger.sendCommandCalls.some(
          (command) => command.method === "Page.createIsolatedWorld",
        ),
      ).toBe(true),
    );
    view.webContents.emitDidStartNavigation();
    worldCreation.resolve();
    await rejection;
    expect(
      view.webContents.debugger.sendCommandCalls.filter(
        (command) => command.method === "Runtime.evaluate",
      ),
    ).toEqual([]);
  });

  it("retains a discovered child frame through a same-loader navigation event", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const first = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:a", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const child = first.frames[0];
    if (child === undefined)
      throw new Error("Expected a discovered child frame.");
    const target = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };

    view.webContents.debugger.emitMessage("Page.frameNavigated", {
      frame: { id: "child", loaderId: "child-loader" },
    });

    await expect(
      manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          frame: target,
          requestId: "req-child-click",
          action: {
            kind: "click",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
        },
      }),
    ).resolves.toEqual({
      navigationEpoch: 0,
      frame: target,
      dispatched: 2,
    });

    view.webContents.debugger.emitMessage("Page.frameNavigated", {
      frame: { id: "child", loaderId: "next-child-loader" },
    });

    await expect(
      manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          frame: target,
          requestId: "req-child-click-stale",
          action: {
            kind: "click",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
        },
      }),
    ).rejects.toThrow("The Browser frame target changed");
  });

  it("aborts pointer input before dispatch when cancelled during frame offset resolution", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 62,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:a", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const child = listed.frames[0];
    if (child === undefined) throw new Error("Expected a child frame.");
    const frame = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };

    let openOwnerGate!: () => void;
    const ownerGate = new Promise<void>((resolve) => {
      openOwnerGate = resolve;
    });
    view.webContents.debugger.gates.set("DOM.getFrameOwner", ownerGate);

    const input = manager.sendPointerInput({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        requestId: "req-pointer-abort",
        frame,
        events: [
          {
            type: "mouseDown",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
          {
            type: "mouseUp",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancelPointerInput({
      hostWindow,
      tabId: "browser:a",
      requestId: "req-pointer-abort",
    });
    openOwnerGate();
    await expect(input).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns the dispatched pointer count when cancellation lands after dispatch", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 63,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });

    const dispatched = await manager.sendPointerInput({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        requestId: "req-pointer-done",
        events: [
          {
            type: "mouseDown",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
          {
            type: "mouseUp",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
        ],
      },
    });
    expect(dispatched).toEqual({ navigationEpoch: 0, dispatched: 2 });
    // A late cancel must not surface as an error once dispatch completed.
    manager.cancelPointerInput({
      hostWindow,
      tabId: "browser:a",
      requestId: "req-pointer-done",
    });
    expect(dispatched).toEqual({ navigationEpoch: 0, dispatched: 2 });
  });

  it("cancels trusted input without cancelling same-ID pointer input", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 64,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: { tabId: "browser:a", expectedNavigationEpoch: 0, maxFrames: 8 },
    });
    const child = listed.frames[0];
    if (child === undefined) throw new Error("Expected a child frame.");
    const frame = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };

    let openOwnerGate!: () => void;
    const ownerGate = new Promise<void>((resolve) => {
      openOwnerGate = resolve;
    });
    view.webContents.debugger.gates.set("DOM.getFrameOwner", ownerGate);
    const focusCallsAtStart = view.webContents.focusCalls;

    const input = manager.sendTrustedInput({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        requestId: "req-trusted-abort",
        frame,
        action: {
          kind: "click",
          x: 10,
          y: 20,
          button: "left",
          clickCount: 1,
        },
      },
    });
    const pointer = manager.sendPointerInput({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        requestId: "req-trusted-abort",
        frame,
        events: [{ type: "mouseMove", x: 10, y: 20 }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancelTrustedInput({
      hostWindow,
      tabId: "browser:a",
      requestId: "req-trusted-abort",
    });
    openOwnerGate();
    await expect(input).rejects.toMatchObject({ name: "AbortError" });
    await expect(pointer).resolves.toMatchObject({ dispatched: 1 });
    expect(view.webContents.focusCalls).toBe(focusCallsAtStart);
  });

  it("returns the dispatched trusted count when cancellation lands after dispatch", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 65,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });

    const result = await manager.sendTrustedInput({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        requestId: "req-trusted-done",
        action: {
          kind: "click",
          x: 10,
          y: 20,
          button: "left",
          clickCount: 1,
        },
      },
    });
    expect(result).toEqual({ navigationEpoch: 0, dispatched: 2 });
    // Cancel after dispatch resolves must not surface as an error.
    manager.cancelTrustedInput({
      hostWindow,
      tabId: "browser:a",
      requestId: "req-trusted-done",
    });
    expect(result).toEqual({ navigationEpoch: 0, dispatched: 2 });
  });

  it("settles network-idle only after redirect-chain request identity completes", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 60,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:c",
      url: "https://example.com",
    });
    const fakeSession = requireFakeSession(0);
    const view = requireFakeView(0);
    const idle = manager.waitForBrowserEvent({
      hostWindow,
      request: {
        tabId: "browser:c",
        expectedNavigationEpoch: 0,
        requestId: "idle-req",
        criteria: {
          kind: "load-state",
          document: "next",
          state: "networkidle",
        },
      },
    });
    const emitRequest = (id: number, url: string): void => {
      fakeSession.onBeforeRequestListener?.(
        { id, method: "GET", url, webContentsId: view.webContents.id },
        () => ({}),
      );
    };
    const emitComplete = (id: number, url: string, statusCode = 200): void => {
      fakeSession.onCompletedListener?.({
        id,
        method: "GET",
        statusCode,
        url,
        webContentsId: view.webContents.id,
      });
    };
    emitRequest(1, "https://example.com/redirect-a");
    emitRequest(1, "https://example.com/redirect-b");
    emitRequest(2, "https://example.com/final.js");
    emitRequest(1, "https://example.com/final");
    emitComplete(2, "https://example.com/final.js");
    emitComplete(1, "https://example.com/final");
    view.webContents.emitDidFinishLoad();
    await expect(idle).resolves.toMatchObject({
      value: { kind: "load-state", state: "networkidle" },
    });
  });

  it("keeps a handed-off navigation request active through a main-frame navigation", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 63,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:handoff",
      url: "https://example.com",
    });
    const fakeSession = requireFakeSession(0);
    const view = requireFakeView(0);
    const idle = manager.waitForBrowserEvent({
      hostWindow,
      request: {
        tabId: "browser:handoff",
        expectedNavigationEpoch: 0,
        requestId: "idle-handoff",
        criteria: {
          kind: "load-state",
          document: "next",
          state: "networkidle",
        },
      },
    });
    // A main-frame navigation request for the *next* document is tracked by
    // webRequest under the current (previous) epoch before the navigation
    // transition fires; the transition must reassign it to the new generation
    // instead of deleting it as stale while it is still in flight.
    fakeSession.onBeforeRequestListener?.(
      {
        id: 61,
        method: "GET",
        url: "https://example.com/next",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      },
      () => ({}),
    );
    await view.webContents.loadURL("https://example.com/next");
    view.webContents.emitDidStartNavigation(true);
    view.webContents.emitDidFinishLoad();
    // The new document finished loading but its navigation request is still
    // in flight: idle must not settle early.
    // The new document finished loading but its navigation request is still
    // in flight: idle must not settle early.
    await expect(
      Promise.race([
        idle.then(() => "idle"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 700)),
      ]),
    ).resolves.toBe("pending");
    fakeSession.onCompletedListener?.({
      id: 61,
      method: "GET",
      statusCode: 200,
      url: "https://example.com/next",
      webContentsId: view.webContents.id,
    });
    await expect(idle).resolves.toMatchObject({
      value: { kind: "load-state", state: "networkidle" },
    });
  });

  it("ignores late completions from a previous navigation generation for idle", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 61,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:d",
      url: "https://example.com",
    });
    const fakeSession = requireFakeSession(0);
    const view = requireFakeView(0);
    {
      const idle = manager.waitForBrowserEvent({
        hostWindow,
        request: {
          tabId: "browser:d",
          expectedNavigationEpoch: 0,
          requestId: "idle-late",
          criteria: {
            kind: "load-state",
            document: "next",
            state: "networkidle",
          },
        },
      });
      fakeSession.onBeforeRequestListener?.(
        {
          id: 10,
          method: "GET",
          url: "https://example.com/old.js",
          webContentsId: view.webContents.id,
        },
        () => ({}),
      );
      await view.webContents.loadURL("https://example.com/next");
      view.webContents.emitDidStartNavigation(true);
      fakeSession.onCompletedListener?.({
        id: 10,
        method: "GET",
        statusCode: 200,
        url: "https://example.com/old.js",
        webContentsId: view.webContents.id,
      });
      fakeSession.onBeforeRequestListener?.(
        {
          id: 11,
          method: "GET",
          url: "https://example.com/next.js",
          webContentsId: view.webContents.id,
        },
        () => ({}),
      );
      fakeSession.onCompletedListener?.({
        id: 11,
        method: "GET",
        statusCode: 200,
        url: "https://example.com/next.js",
        webContentsId: view.webContents.id,
      });
      view.webContents.emitDidFinishLoad();
      await expect(idle).resolves.toMatchObject({
        value: { kind: "load-state", state: "networkidle" },
      });
    }
  });

  it("discovers frames and waits for events on a live hidden tab without focusing", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 66,
    });
    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:hidden",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });
    const view = requireFakeView(0);
    expect(view.visible).toBe(false);
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "browser:hidden",
        expectedNavigationEpoch: 0,
        maxFrames: 8,
      },
    });
    expect(listed.frames).toHaveLength(1);

    view.webContents.emitDidFinishLoad();
    const waited = await manager.waitForBrowserEvent({
      hostWindow,
      request: {
        tabId: "browser:hidden",
        expectedNavigationEpoch: 0,
        requestId: "hidden-wait",
        criteria: { kind: "load-state", document: "current", state: "load" },
      },
    });
    expect(waited.value).toEqual({ kind: "load-state", state: "load" });
    expect(view.visible).toBe(false);
    expect(view.webContents.focusCalls).toBe(0);
  });

  it("dispatches pointer input to a live hidden tab without focusing it", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 67,
    });
    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:hidden-pointer",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });
    const view = requireFakeView(0);
    const result = await manager.sendPointerInput({
      hostWindow,
      request: {
        tabId: "browser:hidden-pointer",
        expectedNavigationEpoch: 0,
        requestId: "hidden-pointer-req",
        events: [
          {
            type: "mouseDown",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
          {
            type: "mouseUp",
            x: 10,
            y: 20,
            button: "left",
            clickCount: 1,
          },
        ],
      },
    });
    expect(result).toEqual({ navigationEpoch: 0, dispatched: 2 });
    expect(view.webContents.focusCalls).toBe(0);
  });

  it("dispatches trusted input to a hidden background tab without focusing it", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 68,
    });
    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:hidden-trusted",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });
    const view = requireFakeView(0);
    const focusCallsBefore = view.webContents.focusCalls;
    const result = await manager.sendTrustedInput({
      hostWindow,
      request: {
        tabId: "browser:hidden-trusted",
        expectedNavigationEpoch: 0,
        requestId: "hidden-trusted-req",
        action: {
          kind: "click",
          x: 10,
          y: 20,
          button: "left",
          clickCount: 1,
        },
      },
    });
    expect(result).toEqual({ navigationEpoch: 0, dispatched: 2 });
    expect(view.webContents.focusCalls).toBe(focusCallsBefore);
  });

  it("dispatches trusted input to a tab hidden during frame offset resolution without focusing", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 69,
    });
    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:vis-race",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });
    const view = requireFakeView(0);
    const focusCallsAfterAttach = view.webContents.focusCalls;
    view.webContents.debugger.getFrameTreeResult = {
      frameTree: {
        frame: {
          id: "root",
          loaderId: "root-loader",
          name: "",
          url: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "child",
              loaderId: "child-loader",
              name: "",
              url: "https://child.example.com",
            },
          },
        ],
      },
    };
    const listed = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "browser:vis-race",
        expectedNavigationEpoch: 0,
        maxFrames: 8,
      },
    });
    const child = listed.frames[0];
    if (child === undefined)
      throw new Error("Expected a discovered child frame.");
    const frame = {
      frameId: child.frameId,
      documentEpoch: child.documentEpoch,
    };
    let openOwnerGate!: () => void;
    const ownerGate = new Promise<void>((resolve) => {
      openOwnerGate = resolve;
    });
    view.webContents.debugger.gates.set("DOM.getFrameOwner", ownerGate);
    const input = manager.sendTrustedInput({
      hostWindow,
      request: {
        tabId: "browser:vis-race",
        expectedNavigationEpoch: 0,
        requestId: "vis-race-req",
        frame,
        action: {
          kind: "click",
          x: 10,
          y: 20,
          button: "left",
          clickCount: 1,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The tab becomes hidden while the frame offset is still resolving; the
    // dispatch must still complete without taking native focus.
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:vis-race", visible: false },
    });
    openOwnerGate();
    const result = await input;
    expect(result).toEqual({
      navigationEpoch: 0,
      frame,
      dispatched: 2,
    });
    expect(view.webContents.focusCalls).toBe(focusCallsAfterAttach);
  });

  it("forwards resolved browser shortcuts and suppresses the untrusted page", () => {
    const dispatchAppCommand = vi.fn();
    const focusHostWebContents = vi.fn();
    const resolveAppCommand = vi.fn(
      (input: { key: string; metaKey: boolean }) =>
        input.key === "l" && input.metaKey
          ? ("browser.focusLocation" as const)
          : null,
    );
    const manager = createDesktopBrowserViewManager({
      dispatchAppCommand,
      focusHostWebContents,
      partition: "persist:test",
      resolveAppCommand,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    expect(webContents.emitBeforeInput({ key: "l", meta: true })).toBe(true);
    expect(focusHostWebContents).toHaveBeenCalledWith(50);
    expect(dispatchAppCommand).toHaveBeenCalledWith({
      command: "browser.focusLocation",
      hostWebContentsId: 50,
    });
    expect(
      webContents.emitBeforeInput({
        isAutoRepeat: true,
        key: "l",
        meta: true,
      }),
    ).toBe(false);
    expect(dispatchAppCommand).toHaveBeenCalledTimes(1);
  });

  it("takes host focus for the find command so the find bar can receive typing", () => {
    const dispatchAppCommand = vi.fn();
    const focusHostWebContents = vi.fn();
    const manager = createDesktopBrowserViewManager({
      dispatchAppCommand,
      focusHostWebContents,
      partition: "persist:test",
      resolveAppCommand: (input) =>
        input.key === "f" && input.metaKey ? "browser.find" : null,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    expect(webContents.emitBeforeInput({ key: "f", meta: true })).toBe(true);
    expect(focusHostWebContents).toHaveBeenCalledWith(51);
    expect(dispatchAppCommand).toHaveBeenCalledWith({
      command: "browser.find",
      hostWebContentsId: 51,
    });
  });

  it("drives webContents find-in-page and relays results to the host renderer", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:a",
        text: "needle",
        forward: true,
        newSession: true,
      },
    });
    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:a",
        text: "needle",
        forward: false,
        newSession: false,
      },
    });
    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:missing",
        text: "needle",
        forward: true,
        newSession: true,
      },
    });
    manager.stopFindInPage({
      hostWindow,
      request: { tabId: "browser:a", action: "clearSelection" },
    });

    expect(webContents.findInPageCalls).toEqual([
      { text: "needle", options: { forward: true, findNext: true } },
      { text: "needle", options: { forward: false, findNext: false } },
    ]);
    expect(webContents.stopFindInPageCalls).toEqual(["clearSelection"]);

    webContents.emitFoundInPage({
      requestId: 7,
      activeMatchOrdinal: 2,
      matches: 9,
      finalUpdate: true,
      selectionArea: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(findResultPushesOf(hostWindow)).toEqual([]);
  });

  it("relays only results of the latest find request and none after stop", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;
    const findRequest = {
      tabId: "browser:a",
      text: "needle",
      forward: true,
      newSession: true,
    };
    const resultArea = { x: 0, y: 0, width: 10, height: 10 };

    manager.findInPage({ hostWindow, request: findRequest });
    manager.findInPage({
      hostWindow,
      request: { ...findRequest, text: "nee" },
    });
    webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
      selectionArea: resultArea,
    });
    webContents.emitFoundInPage({
      requestId: 2,
      activeMatchOrdinal: 1,
      matches: 12,
      finalUpdate: false,
      selectionArea: resultArea,
    });
    expect(findResultPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        requestId: 2,
        activeMatchOrdinal: 1,
        matches: 12,
        finalUpdate: false,
      },
    ]);

    manager.stopFindInPage({
      hostWindow,
      request: { tabId: "browser:a", action: "clearSelection" },
    });
    webContents.emitFoundInPage({
      requestId: 2,
      activeMatchOrdinal: 1,
      matches: 12,
      finalUpdate: true,
      selectionArea: resultArea,
    });
    expect(findResultPushesOf(hostWindow)).toHaveLength(1);
  });

  it("surfaces a loopback popup as an in-panel tab, never a native window", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 58,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    expect(
      view.webContents.emitWindowOpen("http://localhost:38886/", {
        frameName: "_blank",
      }),
    ).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual(["http://localhost:38886/"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      { tabId: "browser:a", url: "http://localhost:38886/" },
    ]);
  });

  it("surfaces public popups with their source browser tab id", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 61,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    expect(
      view.webContents.emitWindowOpen("https://example.com/docs", {
        frameName: "_blank",
      }),
    ).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual(["https://example.com/docs"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        url: "https://example.com/docs",
      },
    ]);
  });

  it("keeps noopener blank links in the browser panel", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 63,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    expect(
      view.webContents.emitWindowOpen("https://example.com/docs", {
        disposition: "foreground-tab",
        features: "noopener,noreferrer",
        frameName: "_blank",
      }),
    ).toEqual({ action: "deny" });
    expect(electronMock.fakeWindows).toEqual([]);
    expect(openTabPushesOf(hostWindow)).toEqual(["https://example.com/docs"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        url: "https://example.com/docs",
      },
    ]);
  });

  it("opens popup dispositions in a hardened native window", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 62,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://www.notion.so/",
    });
    const view = requireFakeView(0);
    const decision = view.webContents.emitWindowOpen(
      "https://accounts.google.com/o/oauth2/auth",
      {
        disposition: "new-window",
        features: "width=520,height=700",
        frameName: "oauth",
      },
    );

    expect(decision.action).toBe("allow");
    expect(openTabPushesOf(hostWindow)).toEqual([]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([]);
    if (decision.createWindow === undefined) {
      throw new Error("Expected the popup decision to create a window.");
    }

    const childContents = electronMock.createFakeWebContents();
    const popupContents = decision.createWindow({
      alwaysOnTop: true,
      frame: false,
      height: 4_000,
      show: false,
      title: "bb sign in",
      transparent: true,
      width: 10,
      webContents: childContents,
      x: 0,
      y: 0,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        partition: "persist:untrusted",
        sandbox: false,
        webSecurity: false,
      },
    });
    const popupWindow = electronMock.fakeWindows[0];
    if (popupWindow === undefined) {
      throw new Error("Expected a popup window to be created.");
    }

    expect(popupContents).toBe(childContents);
    expect(popupWindow.loadURLCalls).toEqual([]);
    expect(popupWindow.options).toEqual({
      center: true,
      frame: true,
      height: 900,
      show: true,
      transparent: false,
      width: 320,
      webContents: childContents,
      webPreferences: {
        allowRunningInsecureContent: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:test",
        sandbox: true,
        webSecurity: true,
      },
    });
    expect(popupWindow.titleCalls).toEqual(["bb browser popup"]);
    childContents.emitDidNavigate("https://accounts.google.com/oauth2/auth");
    expect(popupWindow.titleCalls.at(-1)).toBe(
      "bb browser — https://accounts.google.com",
    );
    expect(childContents.emitPageTitleUpdated("Google Sign In")).toBe(true);
    expect(popupWindow.titleCalls.at(-1)).toBe(
      "bb browser — https://accounts.google.com",
    );
    expect(popupContents.emitWindowOpen("https://example.com/nested")).toEqual({
      action: "deny",
    });
    manager.destroyAll();
    expect(popupWindow.closeCalls).toBe(0);
    expect(popupWindow.destroyCalls).toBe(1);
  });

  it("loads the URL itself when Electron supplies no child webContents", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 66,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    const decision = view.webContents.emitWindowOpen(
      "https://example.com/docs",
      { disposition: "new-window" },
    );

    expect(decision.action).toBe("allow");
    if (decision.createWindow === undefined) {
      throw new Error("Expected the popup decision to create a window.");
    }
    decision.createWindow({});
    expect(electronMock.fakeWindows[0]?.loadURLCalls).toEqual([
      "https://example.com/docs",
    ]);
  });

  it("supports blank-first OAuth navigation with secure remote URLs", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 64,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    const decision = view.webContents.emitWindowOpen("about:blank", {
      disposition: "new-window",
      features: "width=520,height=700",
      frameName: "oauth",
    });

    expect(decision.action).toBe("allow");
    if (decision.createWindow === undefined) {
      throw new Error("Expected the blank OAuth popup to create a window.");
    }
    const childContents = electronMock.createFakeWebContents();
    decision.createWindow({ webContents: childContents });

    expect(
      childContents.emitWillFrameNavigate(
        "https://accounts.google.com/o/oauth2/auth",
        true,
      ),
    ).toBe(false);
    expect(
      childContents.emitWillFrameNavigate(
        "http://accounts.google.com/oauth2/auth",
        true,
      ),
    ).toBe(true);
    expect(
      childContents.emitWillRedirect("http://evil.example/steal", true),
    ).toBe(true);
    expect(
      childContents.emitWillFrameNavigate(
        "http://127.0.0.1:38886/callback",
        true,
      ),
    ).toBe(false);
  });

  it("caps live native popups across successive rate windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 65,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    const openPopup = (): FakeWindowOpenDecision => {
      const decision = view.webContents.emitWindowOpen(
        "https://accounts.google.com/o/oauth2/auth",
        {
          disposition: "new-window",
          features: "width=520,height=700",
          frameName: "oauth",
        },
      );
      if (decision.createWindow !== undefined) {
        decision.createWindow({
          webContents: electronMock.createFakeWebContents(),
        });
      }
      return decision;
    };

    expect(openPopup().action).toBe("allow");
    expect(openPopup().action).toBe("allow");
    expect(openPopup().action).toBe("allow");
    vi.advanceTimersByTime(10_001);
    expect(openPopup()).toEqual({ action: "deny" });

    electronMock.fakeWindows[0]?.destroy();
    expect(openPopup().action).toBe("allow");
    manager.destroyAll();
  });

  it("snapshots then hides visible views on resize, revealing them clamped to the shrunken window", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 41,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }
    expect(view.boundsCalls[0]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    expect(view.visible).toBe(false);
    expect(snapshotPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`,
      },
    ]);

    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 250,
    });
    expect(view.visible).toBe(true);
    expect(snapshotPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dataUrl: null,
    });

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 700, height: 450 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[2]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);
  });

  it("drops a capture that resolves after the resize burst already ended", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 46,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    manager.endWindowResize(hostWindow);
    await settlePendingCaptures(view);

    const bitmapPushes = snapshotPushesOf(hostWindow).filter(
      (push) => push.dataUrl !== null,
    );
    expect(bitmapPushes).toHaveLength(0);
    expect(view.visible).toBe(true);
  });

  it("never grows a view past its renderer-desired rect on a native window grow", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 43,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 900, height: 640 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
  });

  it("applies renderer pushes that land mid-resize on the reveal", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 44,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 500, height: 300 };
    manager.setBounds({
      hostWindow,
      request: {
        tabId: "browser:a",
        bounds: { x: 200, y: 90, width: 400, height: 300 },
      },
    });
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls.at(-1)).toEqual({
      x: 200,
      y: 90,
      width: 300,
      height: 210,
    });
    expect(view.visible).toBe(true);
  });

  it("defers renderer visibility changes made during a resize burst to the reveal", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 45,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.visible).toBe(false);

    manager.endWindowResize(hostWindow);
    expect(view.visible).toBe(true);
  });

  it("keeps hidden views hidden and untouched across a resize burst", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 42,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls).toHaveLength(1);
    expect(view.visible).toBe(false);
  });

  it("focuses a freshly-attached active tab so Cmd+C targets its webContents", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 70,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("reports user focus but suppresses programmatic focus used for restoration", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 79,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });
    const view = requireFakeView(0);
    expect(hostWindow.webContents.sentChannels).not.toContain(
      "bb-desktop:browser:focused",
    );

    manager.focus({ hostWindow, tabId: "browser:a" });
    expect(hostWindow.webContents.sentChannels).not.toContain(
      "bb-desktop:browser:focused",
    );

    view.webContents.emitFocus();
    expect(hostWindow.webContents.sentChannels).toContain(
      "bb-desktop:browser:focused",
    );
    expect(hostWindow.webContents.sentPayloads.at(-1)).toEqual({
      tabId: "browser:a",
    });
  });

  it("defers hidden memory-eviction recovery until the panel shows the current page", () => {
    vi.useFakeTimers();
    const { hostWindow, manager, view } = createRendererRecoveryFixture(75);
    view.webContents.emitDidNavigate("https://example.com/current");
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });

    view.webContents.emitRenderProcessGone({
      exitCode: 0,
      reason: "memory-eviction",
    });

    expect(view.webContents.reloadCalls).toBe(0);
    expect(view.visible).toBe(false);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.visible).toBe(false);
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(1);
    expect(view.webContents.getURL()).toBe("https://example.com/current");
    expect(electronMock.fakeViews).toHaveLength(1);
    expect(view.visible).toBe(true);
  });

  it("stops automatic recovery after two repeated renderer crashes", () => {
    vi.useFakeTimers();
    const { hostWindow, view } = createRendererRecoveryFixture(76);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      view.webContents.emitRenderProcessGone({
        exitCode: 1,
        reason: "crashed",
      });
      expect(view.visible).toBe(false);
      vi.runOnlyPendingTimers();
      expect(view.webContents.reloadCalls).toBe(attempt);
      expect(view.visible).toBe(true);
    }

    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(2);
    expect(view.visible).toBe(false);
    expect(hostWindow.webContents.sentPayloads.at(-1)).toMatchObject({
      tabId: "browser:a",
      errorText: "The page renderer stopped repeatedly",
    });
  });

  it.each(["launch-failed", "integrity-failure"] as const)(
    "does not automatically retry a %s renderer failure",
    (reason) => {
      vi.useFakeTimers();
      const { hostWindow, view } = createRendererRecoveryFixture(77);

      view.webContents.emitRenderProcessGone({ exitCode: 1, reason });
      vi.runOnlyPendingTimers();

      expect(view.webContents.reloadCalls).toBe(0);
      expect(view.visible).toBe(false);
      expect(hostWindow.webContents.sentPayloads.at(-1)).toMatchObject({
        tabId: "browser:a",
        errorText: "The page renderer could not start",
      });
    },
  );

  it("resets the renderer recovery limit after a page finishes loading", () => {
    vi.useFakeTimers();
    const { view } = createRendererRecoveryFixture(78);

    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();
    view.webContents.emitDidFinishLoad();
    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(2);
    expect(view.visible).toBe(true);
  });

  it("does not focus a freshly-attached inactive tab", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 71,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);
  });

  it("focuses on a real hidden → visible setVisible transition only once", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 72,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("re-focuses after a hide → show cycle", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 73,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(2);
  });

  it("does not let an unfocused split view steal focus on mount or restore", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 80,
    });

    for (const [tabId, x] of [
      ["browser:focused", 0],
      ["browser:sibling", 450],
    ] as const) {
      manager.attach({
        hostWindow,
        request: {
          tabId,
          url: `https://example.com/${tabId}`,
          bounds: { x, y: 0, width: 450, height: 600 },
          visible: true,
        },
      });
    }
    const focusedView = requireFakeView(0);
    const siblingView = requireFakeView(1);
    expect(focusedView.webContents.focusCalls).toBe(1);
    expect(siblingView.webContents.focusCalls).toBe(0);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:sibling", visible: false },
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:sibling", visible: true },
    });

    expect(focusedView.webContents.focusCalls).toBe(1);
    expect(siblingView.webContents.focusCalls).toBe(0);
  });

  it("shows a browser beside a focused non-browser pane without stealing focus", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 82,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:sibling",
        url: "https://example.com/browser",
        bounds: { x: 450, y: 0, width: 450, height: 600 },
        visible: false,
      },
    });
    const browserView = requireFakeView(0);

    manager.setVisibleWithoutFocus({
      hostWindow,
      request: { tabId: "browser:sibling", visible: true },
    });
    expect(browserView.visible).toBe(true);
    expect(browserView.webContents.focusCalls).toBe(0);

    manager.setVisibleWithoutFocus({
      hostWindow,
      request: { tabId: "browser:sibling", visible: false },
    });
    manager.setVisibleWithoutFocus({
      hostWindow,
      request: { tabId: "browser:sibling", visible: true },
    });
    expect(browserView.visible).toBe(true);
    expect(browserView.webContents.focusCalls).toBe(0);
  });

  it("lets logical focus override first-visible mount order", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 81,
    });

    for (const [tabId, x] of [
      ["browser:sibling", 0],
      ["browser:focused", 450],
    ] as const) {
      manager.attach({
        hostWindow,
        request: {
          tabId,
          url: `https://example.com/${tabId}`,
          bounds: { x, y: 0, width: 450, height: 600 },
          visible: true,
        },
      });
    }
    const siblingView = requireFakeView(0);
    const focusedView = requireFakeView(1);
    expect(siblingView.webContents.focusCalls).toBe(1);
    expect(focusedView.webContents.focusCalls).toBe(0);

    manager.focus({ hostWindow, tabId: "browser:focused" });

    expect(focusedView.webContents.focusCalls).toBe(1);
  });

  it("hides only the reloading window's browser views until they reattach", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const reloadingWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 83,
    });
    const otherWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 84,
    });
    attachBrowserTab({
      manager,
      hostWindow: reloadingWindow,
      tabId: "browser:reloading",
      url: "https://example.com/reloading",
    });
    attachBrowserTab({
      manager,
      hostWindow: otherWindow,
      tabId: "browser:other",
      url: "https://example.com/other",
    });
    const reloadingView = requireFakeView(0);
    const otherView = requireFakeView(1);

    manager.prepareWindowReload(reloadingWindow);

    expect(reloadingView.visible).toBe(false);
    expect(otherView.visible).toBe(true);
    manager.attach({
      hostWindow: reloadingWindow,
      request: {
        tabId: "browser:reloading",
        url: "https://example.com/reloading",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });
    expect(electronMock.fakeViews).toHaveLength(2);
    expect(reloadingView.visible).toBe(true);
  });

  it("allows clipboard-sanitized-write but denies clipboard-read and device permissions", () => {
    expect(isAllowedBrowserPermission("clipboard-sanitized-write")).toBe(true);
    expect(isAllowedBrowserPermission("clipboard-read")).toBe(false);
    expect(isAllowedBrowserPermission("media")).toBe(false);
    expect(isAllowedBrowserPermission("notifications")).toBe(false);
    expect(isAllowedBrowserPermission("geolocation")).toBe(false);

    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 74,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    const fakeSession = electronMock.fakeSessions.at(-1);
    expect(fakeSession).toBeDefined();
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    const checkHandler = fakeSession.permissionCheckHandler;
    const requestHandler = fakeSession.permissionRequestHandler;
    expect(checkHandler).not.toBeNull();
    expect(requestHandler).not.toBeNull();
    if (checkHandler === null || requestHandler === null) {
      throw new Error("Expected permission handlers to be registered.");
    }

    expect(checkHandler(null, "clipboard-sanitized-write")).toBe(false);
    expect(checkHandler(null, "clipboard-read")).toBe(false);
    expect(checkHandler(null, "media")).toBe(false);

    const requestGrants: boolean[] = [];
    requestHandler(null, "clipboard-sanitized-write", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "clipboard-read", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "media", (granted) => {
      requestGrants.push(granted);
    });
    expect(requestGrants).toEqual([false, false, false]);
    expect(
      checkHandler(view.webContents, "clipboard-sanitized-write", undefined, {
        requestingUrl: "https://example.com/",
      }),
    ).toBe(true);
    // A requester without requesting-origin evidence must be denied even when
    // the webContents belongs to a Browser entry: it must not inherit the
    // top-level origin's grants.
    expect(
      checkHandler(
        view.webContents,
        "clipboard-sanitized-write",
        undefined,
        {},
      ),
    ).toBe(false);
    const opaqueGrants: boolean[] = [];
    requestHandler(view.webContents, "clipboard-sanitized-write", (granted) => {
      opaqueGrants.push(granted);
    });
    expect(opaqueGrants).toEqual([false]);
  });
  it("trusts only the current loopback HTTPS certificate for this Browser session", async () => {
    const manager = createDesktopBrowserViewManager();
    const hostWindow = new FakeHostWindow({
      contentBounds: { height: 700, width: 900 },
      webContentsId: 75,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://localhost:8443/",
    });

    const trustPromise = manager.trustLocalhostCertificate({
      hostWindow,
      request: { tabId: "browser:a", expectedNavigationEpoch: 0 },
    });
    await expect(trustPromise).resolves.toMatchObject({
      trustedOrigin: "https://localhost:8443",
    });

    const verifyProc = requireFakeSession(0).certificateVerifyProc;
    expect(verifyProc).not.toBeNull();
    if (verifyProc === null) {
      throw new Error("Expected a certificate verification handler.");
    }
    const certificateErrorListener =
      electronMock.certificateErrorListeners.at(-1);
    expect(certificateErrorListener).toBeDefined();
    if (certificateErrorListener === undefined) {
      throw new Error("Expected a certificate error listener.");
    }
    const certificateEvent: FakePreventableEvent = {
      defaultPrevented: false,
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };
    let certificateAccepted = false;
    certificateErrorListener(
      certificateEvent,
      requireFakeView(0).webContents,
      "https://localhost:8443/",
      "ERR_CERT_AUTHORITY_INVALID",
      {},
      (trusted) => {
        certificateAccepted = trusted;
      },
    );

    expect(certificateEvent.defaultPrevented).toBe(true);
    expect(certificateAccepted).toBe(true);
    const results: number[] = [];
    verifyProc({ hostname: "localhost" }, (result) => results.push(result));
    verifyProc({ hostname: "example.com" }, (result) => results.push(result));

    expect(results).toEqual([0, -3]);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(1);
  });
});
