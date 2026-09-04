import type { RenderProcessGoneDetails, WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
) => void;

type FakePermissionCheckHandler = (
  webContents: unknown,
  permission: string,
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
    public readonly sendCommandCalls: FakeDebuggerCommand[] = [];
    public getFrameTreeResult?: object;
    private readonly messageListeners: Array<
      (
        event: FakeWebContentsEvent,
        method: string,
        params: Record<string, unknown>,
      ) => void
    > = [];

    on(
      _eventName: "message",
      listener: (
        event: FakeWebContentsEvent,
        method: string,
        params: Record<string, unknown>,
      ) => void,
    ): void {
      this.messageListeners.push(listener);
    }

    emitMessage(method: string, params: Record<string, unknown>): void {
      for (const listener of this.messageListeners) {
        listener(fakeWebContentsEvent, method, params);
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
    ): Promise<object> {
      this.sendCommandCalls.push({ method, params });
      if (method === "Page.getLayoutMetrics") {
        return { cssContentSize: { width: 1_200, height: 2_400 } };
      }
      if (method === "Page.captureScreenshot") {
        return { data: Buffer.from("full-page").toString("base64") };
      }
      if (method === "Page.getFrameTree") {
        return this.getFrameTreeResult ?? {};
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
    public focusCalls = 0;
    public readonly goBackCalls: string[] = [];
    public readonly goForwardCalls: string[] = [];
    public historyEntries: Array<{ title: string; url: string }> = [];
    public readonly id: number;
    public readonly loadURLCalls: string[] = [];
    public readonly findInPageCalls: FakeFindInPageCall[] = [];
    public readonly stopFindInPageCalls: string[] = [];
    public reloadCalls = 0;
    public readonly sentInputEvents: Array<Record<string, unknown>> = [];
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
    sendInputEvent(event: Record<string, unknown>): void {
      this.sentInputEvents.push(event);
    }

    setWindowOpenHandler(handler: FakeWindowOpenHandler): void {
      this.windowOpenHandler = handler;
    }

    stop(): void {}

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
    public readonly cookieSetCalls: Record<string, unknown>[] = [];
    public readonly cookieGetResults: Array<{
      domain?: string;
      name: string;
      path?: string;
      secure?: boolean;
    }> = [];
    public readonly cookieRemoveCalls: Array<{ name: string; url: string }> = [];
    public readonly cookies = {
      flushStore: async (): Promise<void> => {
        this.flushStoreCalls += 1;
      },
      get: async (): Promise<typeof this.cookieGetResults> =>
        this.cookieGetResults,
      remove: async (url: string, name: string): Promise<void> => {
        this.cookieRemoveCalls.push({ name, url });
      },
      set: async (details: Record<string, unknown>): Promise<void> => {
        this.cookieSetCalls.push(details);
      },
    };
    async clearCache(): Promise<void> {
      this.clearCacheCalls += 1;
    }
    async clearStorageData(options?: { storages: string[] }): Promise<void> {
      this.clearStorageDataCalls.push(options);
    }
    public readonly webRequest = {
      onBeforeRequest: (
        _listener: (
          details: { url: string; method: string; webContentsId?: number },
          callback: (response: Record<string, never>) => void,
        ) => void,
      ): void => {},
      onCompleted: (
        _listener: (details: {
          method: string;
          statusCode: number;
          url: string;
          webContentsId?: number;
        }) => void,
      ): void => {},
      onErrorOccurred: (
        _listener: (details: {
          error: string;
          method: string;
          url: string;
          webContentsId?: number;
        }) => void,
      ): void => {},
    };
    public readonly willDownloadListeners: FakeSessionListener[] = [];
    public permissionCheckHandler: FakePermissionCheckHandler | null = null;
    public permissionRequestHandler: FakePermissionRequestHandler | null = null;
    public certificateVerifyProc:
      | ((request: { hostname: string }, callback: (result: number) => void) => void)
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
        fakeSessions.push(fakeSession);
        return fakeSession;
      },
    },
    app: {
      on(_eventName: "certificate-error", listener: FakeCertificateErrorListener): void {
        certificateErrorListeners.push(listener);
      },
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.FakeBrowserWindow,
  WebContentsView: electronMock.FakeWebContentsView,
  app: electronMock.app,
  session: electronMock.session,
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

  it("replaces the global Browser session and reloads every live tab", async () => {
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
    const otherHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });
    attachBrowserTab({
      manager,
      hostWindow: otherHostWindow,
      tabId: "browser:b",
      url: "https://example.org",
    });
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
    ).resolves.toEqual({ importedCookies: 4 });
    const browserSession = requireFakeSession(0);
    expect(browserSession.cookieSetCalls).toEqual([
      {
        httpOnly: true,
        name: "__Host-session",
        path: "/",
        sameSite: "lax",
        secure: true,
        url: "https://example.com/",
        value: "host-value",
      },
      {
        domain: "example.com",
        httpOnly: true,
        name: "__Secure-session",
        path: "/",
        sameSite: "strict",
        secure: true,
        url: "https://example.com/",
        value: "secure-value",
      },
      {
        domain: "example.com",
        httpOnly: true,
        name: "overlap",
        path: "/",
        sameSite: "lax",
        secure: true,
        url: "https://example.com/",
        value: "secure-overlap",
      },
      {
        httpOnly: false,
        name: "overlap",
        path: "/account",
        sameSite: "lax",
        secure: false,
        url: "https://sub.example.com/account",
        value: "insecure-overlap",
      },
    ]);
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
    ]);
    expect(browserSession.flushStoreCalls).toBe(1);
    expect(browserSession.clearCacheCalls).toBe(0);
    expect(electronMock.fakeSessions).toHaveLength(1);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(1);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(1);

    await expect(
      manager.importCookies({ hostWindow, request }),
    ).resolves.toEqual({ importedCookies: 4 });
    expect(browserSession.cookieSetCalls).toHaveLength(8);
    expect(browserSession.flushStoreCalls).toBe(2);
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
      { storages: ["cookies"] },
    ]);
    expect(browserSession.clearCacheCalls).toBe(0);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(2);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(2);
    await manager.clearImportedCookies({ hostWindow, tabId: "browser:a" });
    expect(browserSession.flushStoreCalls).toBe(3);
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
      { storages: ["cookies"] },
      undefined,
    ]);
    expect(browserSession.clearCacheCalls).toBe(1);
    expect(requireFakeView(0).webContents.reloadCalls).toBe(3);
    expect(requireFakeView(1).webContents.reloadCalls).toBe(3);
    await expect(
      manager.importCookies({
        hostWindow,
        request: { tabId: "browser:a", cookies: [] },
      }),
    ).resolves.toEqual({ importedCookies: 0 });
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
      { storages: ["cookies"] },
      undefined,
      { storages: ["cookies"] },
    ]);
    expect(browserSession.clearCacheCalls).toBe(1);
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
      url: "https://github.com",
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

    expect(browserSession.cookieRemoveCalls).toEqual([
      { name: "user_session", url: "https://github.com/" },
    ]);
    expect(browserSession.cookieSetCalls).toEqual([
      expect.objectContaining({
        domain: "github.com",
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
      url: "https://github.com",
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

    expect(requireFakeSession(0).cookieSetCalls).toEqual([
      expect.objectContaining({ value: "host-only" }),
      expect.objectContaining({ domain: "github.com", value: "domain" }),
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
      url: "https://example.com",
    });
    attachBrowserTab({
      manager,
      hostWindow: secondHostWindow,
      tabId: "browser:b",
      url: "https://example.org",
    });
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
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
      { storages: ["cookies"] },
    ]);
    expect(browserSession.cookieSetCalls).toEqual([
      expect.objectContaining({ name: "first", value: "first-value" }),
      expect.objectContaining({ name: "second", value: "second-value" }),
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
      url: "https://example.com",
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
    expect(browserSession.clearStorageDataCalls).toEqual([
      { storages: ["cookies"] },
    ]);
    expect(browserSession.cookieSetCalls).toHaveLength(251);
    expect(browserSession.cookieSetCalls[0]).toMatchObject({
      name: "session-0",
      value: "value-0",
    });
    expect(browserSession.cookieSetCalls[250]).toMatchObject({
      name: "session-250",
      value: "value-250",
    });
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
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 0,
      },
    });
    view.webContents.pendingCaptureResolvers.shift()?.(
      electronMock.fakeCapturedImage,
    );
    await expect(capture).resolves.toEqual({
      navigationEpoch: 0,
      dataUrl: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
      pixelSize: { width: 1_200, height: 800 },
    });

    const invalidatedCapture = manager.capturePage({
      hostWindow,
      request: {
        tabId: "browser:a",
        format: "jpeg",
        quality: 75,
        expectedNavigationEpoch: 0,
      },
    });
    view.webContents.emitDidStartNavigation();
    view.webContents.pendingCaptureResolvers.shift()?.(
      electronMock.fakeCapturedImage,
    );
    await expect(invalidatedCapture).rejects.toThrow(
      "Browser page changed during capture",
    );
    await expect(
      manager.capturePage({
        hostWindow,
        request: {
          tabId: "browser:a",
          format: "png",
          quality: 85,
          expectedNavigationEpoch: 0,
        },
      }),
    ).rejects.toThrow("Browser page changed before capture");
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
            permissions: ["media"],
          },
        },
      }),
    ).resolves.toMatchObject({
      navigationEpoch: 0,
      value: { decision: "allow", permissions: ["media"] },
    });
    expect(fakeSession.permissionCheckHandler(view.webContents, "media")).toBe(
      true,
    );
    const permissionDecisions: boolean[] = [];
    fakeSession.permissionRequestHandler(view.webContents, "media", (allowed) =>
      permissionDecisions.push(allowed),
    );
    expect(permissionDecisions).toEqual([true]);
    await manager.runAutomation({
      hostWindow,
      request: {
        tabId: "browser:a",
        expectedNavigationEpoch: 0,
        action: {
          kind: "set-permissions",
          decision: "deny",
          permissions: ["clipboard-sanitized-write"],
        },
      },
    });
    expect(
      fakeSession.permissionCheckHandler(
        view.webContents,
        "clipboard-sanitized-write",
      ),
    ).toBe(false);

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

    await expect(
      manager.runAutomation({
        hostWindow,
        request: {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          action: {
            kind: "capture-full-page",
            format: "png",
            quality: 100,
          },
        },
      }),
    ).resolves.toEqual({
      navigationEpoch: 0,
      value: {
        dataUrl: `data:image/png;base64,${Buffer.from("full-page").toString("base64")}`,
        pixelSize: { width: 1_200, height: 2_400 },
      },
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
    if (child === undefined) throw new Error("Expected a discovered child frame.");
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
    expect(view.webContents.sentInputEvents).toEqual([
      {
        type: "mouseDown",
        x: 30,
        y: 50,
        button: "left",
        clickCount: 1,
      },
      {
        type: "mouseUp",
        x: 30,
        y: 50,
        button: "left",
        clickCount: 1,
      },
    ]);

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

    expect(checkHandler(null, "clipboard-sanitized-write")).toBe(true);
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
    expect(requestGrants).toEqual([true, false, false]);
  });
  it("trusts only the current loopback HTTPS certificate for this Browser session", () => {
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

    manager.trustLocalhostCertificate({ hostWindow, tabId: "browser:a" });

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
