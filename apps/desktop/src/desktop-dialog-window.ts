import { BrowserWindow } from "electron";

interface CreateDesktopDialogWindowArgs {
  height: number;
  parentWindow: BrowserWindow | null;
  preloadPath: string;
  title: string;
  width: number;
}

export const DESKTOP_DIALOG_BASE_CSS = `    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      background: Canvas;
      color: CanvasText;
      margin: 0;
      padding: 20px;
    }

    h1 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 4px;
    }

    p {
      color: color-mix(in srgb, CanvasText 70%, transparent);
      font-size: 12px;
      line-height: 1.45;
      margin: 0 0 12px;
    }

    button {
      background: color-mix(in srgb, CanvasText 8%, Canvas);
      border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
      border-radius: 6px;
      color: CanvasText;
      font-size: 13px;
      padding: 5px 14px;
    }`;

export function createDesktopDialogWindow(
  args: CreateDesktopDialogWindowArgs,
): BrowserWindow {
  return new BrowserWindow({
    fullscreenable: false,
    height: args.height,
    maximizable: false,
    minimizable: false,
    modal: args.parentWindow !== null,
    parent: args.parentWindow ?? undefined,
    resizable: false,
    show: false,
    title: args.title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: args.width,
  });
}

export function showDesktopDialogHtml(
  dialogWindow: BrowserWindow,
  html: string,
): void {
  dialogWindow.once("ready-to-show", () => {
    dialogWindow.show();
  });
  void dialogWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}
