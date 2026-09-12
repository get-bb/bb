import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import type { z } from "zod";
import {
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserFindInPageRequestSchema,
  bbDesktopBrowserNavigateRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserSetVisibleRequestSchema,
  bbDesktopBrowserStopFindInPageRequestSchema,
  bbDesktopBrowserTabRefSchema,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
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

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerRequestCommand<T>(
  channel: string,
  schema: z.ZodType<T>,
  run: (args: { hostWindow: BrowserWindow; request: T }) => void,
): void {
  ipcMain.on(channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    run({ hostWindow, request: parsed.data });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  registerRequestCommand(
    BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
    bbDesktopBrowserAttachRequestSchema,
    (args) => manager.attach(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
    bbDesktopBrowserNavigateRequestSchema,
    (args) => manager.navigate(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    bbDesktopBrowserSetBoundsRequestSchema,
    (args) => manager.setBounds(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    bbDesktopBrowserSetVisibleRequestSchema,
    (args) => manager.setVisible(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
    bbDesktopBrowserSetVisibleRequestSchema,
    (args) => manager.setVisibleWithoutFocus(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
    bbDesktopBrowserFindInPageRequestSchema,
    (args) => manager.findInPage(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
    bbDesktopBrowserStopFindInPageRequestSchema,
    (args) => manager.stopFindInPage(args),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_DETACH_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.detach({ hostWindow, tabId: request.tabId }),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.focus({ hostWindow, tabId: request.tabId }),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.goBack({ hostWindow, tabId: request.tabId }),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.goForward({ hostWindow, tabId: request.tabId }),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.reload({ hostWindow, tabId: request.tabId }),
  );
  registerRequestCommand(
    BB_DESKTOP_BROWSER_STOP_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.stop({ hostWindow, tabId: request.tabId }),
  );
}
