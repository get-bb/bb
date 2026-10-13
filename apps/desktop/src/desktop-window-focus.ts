import { BrowserWindow, ipcMain } from "electron";
import { BB_DESKTOP_FOCUS_WINDOW_CHANNEL } from "./desktop-window-command-ipc.js";

export function registerDesktopWindowFocusIpc(
  applicationWindowWebContentsIds: ReadonlySet<number>,
): void {
  ipcMain.on(BB_DESKTOP_FOCUS_WINDOW_CHANNEL, (event) => {
    if (!applicationWindowWebContentsIds.has(event.sender.id)) return;
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow === null || browserWindow.isDestroyed()) return;
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.show();
    browserWindow.focus();
  });
}
