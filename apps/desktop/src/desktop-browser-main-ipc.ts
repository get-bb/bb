import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import {
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserAutomationRequestSchema,
  bbDesktopBrowserCloseRequestSchema,
  bbDesktopBrowserFindInPageRequestSchema,
  bbDesktopBrowserImportCookiesFromBrowserRequestSchema,
  bbDesktopBrowserImportCookiesRequestSchema,
  bbDesktopBrowserListCookieImportSourcesRequestSchema,
  bbDesktopBrowserNavigateRequestSchema,
  bbDesktopBrowserCaptureChunkReadSchema,
  bbDesktopBrowserCaptureReleaseSchema,
  bbDesktopBrowserPageCaptureCancelRequestSchema,
  bbDesktopBrowserPageCaptureRequestSchema,
  bbDesktopBrowserListFramesRequestSchema,
  bbDesktopBrowserTrustedInputCancelRequestSchema,
  bbDesktopBrowserTrustedInputRequestSchema,
  bbDesktopBrowserWaitCancelRequestSchema,
  bbDesktopBrowserWaitRequestSchema,
  bbDesktopBrowserPageScriptRequestSchema,
  bbDesktopBrowserPageScriptCancelRequestSchema,
  bbDesktopBrowserPointerInputCancelRequestSchema,
  bbDesktopBrowserPointerInputRequestSchema,
  bbDesktopBrowserSetViewportProfileRequestSchema,
  bbDesktopBrowserClearViewportProfileRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserSetVisibleRequestSchema,
  bbDesktopBrowserStopFindInPageRequestSchema,
  bbDesktopBrowserTabRefSchema,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_FRAMES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_POINTER_INPUT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_TRUSTED_INPUT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_SEND_TRUSTED_INPUT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_WAIT_EVENT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_WAIT_EVENT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_CAPTURE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_AUTOMATION_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_READ_CAPTURE_CHUNK_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_RELEASE_CAPTURE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CLOSE_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_VIEWPORT_PROFILE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_SEND_POINTER_INPUT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_SET_VIEWPORT_PROFILE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_IMPORTED_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
} from "./desktop-browser-ipc.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface DesktopBrowserTabCommandArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

type DesktopBrowserTabCommand = (args: DesktopBrowserTabCommandArgs) => void;

interface RegisterDesktopBrowserTabCommandArgs {
  channel: string;
  run: DesktopBrowserTabCommand;
}

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent | IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(args: RegisterDesktopBrowserTabCommandArgs): void {
  ipcMain.on(args.channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    args.run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  ipcMain.on(BB_DESKTOP_BROWSER_ATTACH_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserAttachRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.attach({ hostWindow, request: parsed.data });
  });

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPageScriptRequestSchema.parse(payload);
      return manager.runPageScript({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_FRAMES_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserListFramesRequestSchema.parse(payload);
      return manager.listFrames({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_SEND_TRUSTED_INPUT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserTrustedInputRequestSchema.parse(payload);
      return manager.sendTrustedInput({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_WAIT_EVENT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserWaitRequestSchema.parse(payload);
      return manager.waitForBrowserEvent({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CLOSE_TAB_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserCloseRequestSchema.parse(payload);
      return manager.close({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPageCaptureRequestSchema.parse(payload);
      return manager.capturePage({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_READ_CAPTURE_CHUNK_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserCaptureChunkReadSchema.parse(payload);
      return manager.readCaptureChunk({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_RELEASE_CAPTURE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null)
        throw new Error("The Browser host window is unavailable");
      const request = bbDesktopBrowserCaptureReleaseSchema.parse(payload);
      return manager.releaseCapture({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_AUTOMATION_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserAutomationRequestSchema.parse(payload);
      return manager.runAutomation({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_SEND_POINTER_INPUT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPointerInputRequestSchema.parse(payload);
      return manager.sendPointerInput({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_SET_VIEWPORT_PROFILE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request =
        bbDesktopBrowserSetViewportProfileRequestSchema.parse(payload);
      return manager.setViewportProfile({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_VIEWPORT_PROFILE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request =
        bbDesktopBrowserClearViewportProfileRequestSchema.parse(payload);
      manager.clearViewportProfile({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserImportCookiesRequestSchema.parse(payload);
      return manager.importCookies({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request =
        bbDesktopBrowserListCookieImportSourcesRequestSchema.parse(payload);
      return manager.listCookieImportSources({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request =
        bbDesktopBrowserImportCookiesFromBrowserRequestSchema.parse(payload);
      return manager.importCookiesFromBrowser({ hostWindow, request });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_IMPORTED_COOKIES_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserTabRefSchema.parse(payload);
      await manager.clearImportedCookies({
        hostWindow,
        tabId: request.tabId,
      });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserPageScriptCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelPageScript({
        hostWindow,
        tabId: request.data.tabId,
        requestId: request.data.requestId,
      });
    },
  );
  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_CAPTURE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserPageCaptureCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelCapture({
        hostWindow,
        tabId: request.data.tabId,
        requestId: request.data.requestId,
      });
    },
  );
  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_WAIT_EVENT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserWaitCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelBrowserEvent({
        hostWindow,
        request: request.data,
      });
    },
  );
  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_TRUSTED_INPUT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserTrustedInputCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelTrustedInput({
        hostWindow,
        tabId: request.data.tabId,
        requestId: request.data.requestId,
      });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_POINTER_INPUT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserPointerInputCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelPointerInput({
        hostWindow,
        tabId: request.data.tabId,
        requestId: request.data.requestId,
      });
    },
  );

  ipcMain.on(BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserNavigateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.navigate({ hostWindow, request: parsed.data });
  });

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetBoundsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setBounds({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisible({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisibleWithoutFocus({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserFindInPageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.findInPage({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        bbDesktopBrowserStopFindInPageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.stopFindInPage({ hostWindow, request: parsed.data });
    },
  );

  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_DETACH_CHANNEL,
    run: (args) => manager.detach(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
    run: (args) => manager.focus(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    run: (args) => manager.goBack(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    run: (args) => manager.goForward(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
    run: (args) => manager.reload(args),
  });
  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserCloseRequestSchema.parse(payload);
      return manager.trustLocalhostCertificate({ hostWindow, request });
    },
  );
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });
}
