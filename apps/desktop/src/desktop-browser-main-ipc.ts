import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import {
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserAutomationCommandRequestSchema,
  bbDesktopBrowserAutomationTargetRefSchema,
  bbDesktopBrowserAutomationTargetSchema,
  bbDesktopBrowserFindInPageRequestSchema,
  bbDesktopBrowserNavigateRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserSetVisibleRequestSchema,
  bbDesktopBrowserStopFindInPageRequestSchema,
  bbDesktopBrowserTabRefSchema,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_CANCEL_AUTOMATION_COMMAND_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_RESERVE_AUTOMATION_TARGET_CHANNEL,
  BB_DESKTOP_BROWSER_REGISTER_AUTOMATION_TARGET_CHANNEL,
  BB_DESKTOP_BROWSER_RUN_AUTOMATION_COMMAND_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_UNREGISTER_AUTOMATION_TARGET_CHANNEL,
} from "./desktop-browser-ipc.js";
import { classifyDesktopBrowserAutomationError } from "./desktop-browser-automation.js";
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
  event: Pick<IpcMainEvent, "sender">,
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
  ipcMain.handle(
    BB_DESKTOP_BROWSER_RUN_AUTOMATION_COMMAND_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      const parsed = bbDesktopBrowserAutomationCommandRequestSchema.safeParse(payload);
      if (hostWindow === null || !parsed.success) {
        return {
          ok: false,
          code: "native_operation_failed",
          detail: "Invalid Browser automation command",
        };
      }
      try {
        const result = await manager.runAutomationCommand({
          hostWindow,
          ...parsed.data,
        });
        return { ok: true, result };
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 512) : "Browser automation command failed";
        const code = classifyDesktopBrowserAutomationError(error);
        const state = manager.getAutomationPageState({
          hostWindow,
          targetId: parsed.data.targetId,
        });
        return {
          ok: false,
          code,
          detail,
          ...(state === null ? {} : { state }),
        };
      }
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_CANCEL_AUTOMATION_COMMAND_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      const parsed = bbDesktopBrowserAutomationTargetRefSchema.safeParse(payload);
      if (hostWindow === null || !parsed.success) return;
      manager.cancelAutomationCommand({ hostWindow, ...parsed.data });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_RESERVE_AUTOMATION_TARGET_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return false;
      const parsed = bbDesktopBrowserAutomationTargetSchema.safeParse(payload);
      if (!parsed.success) return false;
      return manager.reserveAutomationTarget({ hostWindow, ...parsed.data });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_REGISTER_AUTOMATION_TARGET_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return false;
      const parsed = bbDesktopBrowserAutomationTargetSchema.safeParse(payload);
      if (!parsed.success) return false;
      try {
        manager.registerAutomationTarget({ hostWindow, ...parsed.data });
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_UNREGISTER_AUTOMATION_TARGET_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const parsed = bbDesktopBrowserAutomationTargetRefSchema.safeParse(payload);
      if (!parsed.success) return;
      manager.unregisterAutomationTarget({ hostWindow, ...parsed.data });
    },
  );

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
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });
}
