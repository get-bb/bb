import { BrowserWindow, screen } from "electron";

const DIALOG_FALLBACK_CONTENT_HEIGHT = 320;
const DIALOG_MIN_CONTENT_HEIGHT = 120;
const DIALOG_WORK_AREA_MARGIN = 80;
const DIALOG_MEASURE_TIMEOUT_MS = 1_000;

interface CreateDesktopDialogWindowArgs {
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
    height: DIALOG_FALLBACK_CONTENT_HEIGHT,
    maximizable: false,
    minimizable: false,
    modal: args.parentWindow !== null,
    parent: args.parentWindow ?? undefined,
    resizable: false,
    show: false,
    title: args.title,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: args.width,
  });
}

export function clampDialogContentHeight(args: {
  contentHeight: number;
  workAreaHeight: number;
}): number {
  const available = args.workAreaHeight - DIALOG_WORK_AREA_MARGIN;
  const maxHeight = Math.max(DIALOG_MIN_CONTENT_HEIGHT, available);
  return Math.min(
    Math.max(DIALOG_MIN_CONTENT_HEIGHT, Math.ceil(args.contentHeight)),
    maxHeight,
  );
}

async function measureDialogContentHeight(
  dialogWindow: BrowserWindow,
): Promise<number | null> {
  const measurement = dialogWindow.webContents
    .executeJavaScript(`document.body.getBoundingClientRect().height`)
    .then((measured: unknown) =>
      typeof measured === "number" && Number.isFinite(measured)
        ? measured
        : null,
    )
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, DIALOG_MEASURE_TIMEOUT_MS);
  });
  return Promise.race([measurement, timeout]);
}

function fitDialogToContent(
  dialogWindow: BrowserWindow,
  contentHeight: number,
): void {
  const [width] = dialogWindow.getContentSize();
  const workAreaHeight = screen.getDisplayMatching(
    dialogWindow.getBounds(),
  ).workAreaSize.height;
  const height = clampDialogContentHeight({ contentHeight, workAreaHeight });
  const wasResizable = dialogWindow.isResizable();
  dialogWindow.setResizable(true);
  dialogWindow.setContentSize(width, height);
  dialogWindow.setResizable(wasResizable);
}

export function showDesktopDialogHtml(
  dialogWindow: BrowserWindow,
  html: string,
): void {
  let shown = false;
  function showOnce(): void {
    if (shown || dialogWindow.isDestroyed()) {
      return;
    }
    shown = true;
    dialogWindow.show();
  }

  dialogWindow.webContents.once("did-finish-load", () => {
    void (async () => {
      const contentHeight = await measureDialogContentHeight(dialogWindow);
      if (contentHeight !== null && !dialogWindow.isDestroyed()) {
        fitDialogToContent(dialogWindow, contentHeight);
      }
      showOnce();
    })();
  });
  dialogWindow.webContents.once("did-fail-load", () => {
    showOnce();
  });

  void dialogWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}
