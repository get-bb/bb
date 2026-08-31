import { app, BrowserWindow, ipcMain } from "electron";
import { createInterface } from "node:readline";
import { createDesktopBrowserViewManager } from "../../src/desktop-browser-view.js";
import { registerDesktopBrowserIpc } from "../../src/desktop-browser-main-ipc.js";
import { BB_DESKTOP_GET_WINDOW_IDENTITY_CHANNEL } from "../../src/desktop-window-command-ipc.js";
import { createDesktopWindowIdentityRegistry } from "../../src/desktop-window-identity.js";

const rendererUrl = process.env.BB_BROWSER_CLI_RENDERER_URL;
const preloadPath = process.env.BB_BROWSER_CLI_PRELOAD_PATH;
if (rendererUrl === undefined || preloadPath === undefined) throw new Error("Browser CLI Electron fixture environment is incomplete");

const manager = createDesktopBrowserViewManager({
  activateHostWindow: (hostWebContentsId) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === hostWebContentsId)?.focus();
  },
  dispatchAppCommand: () => {},
  focusHostWebContents: () => {},
  partition: `persist:bb-browser-cli-${process.pid}`,
  resolveAppCommand: () => null,
});
const identities = createDesktopWindowIdentityRegistry();
registerDesktopBrowserIpc(manager);
ipcMain.handle(BB_DESKTOP_GET_WINDOW_IDENTITY_CHANNEL, (event) => identities.identityFor(event.sender.id));

app.whenReady().then(async () => {
  const hostWindow = new BrowserWindow({
    height: 760,
    show: true,
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
      sandbox: false,
    },
    width: 960,
  });
  hostWindow.webContents.on("console-message", (_event, _level, message) => {
    if (message.startsWith('{"fixture":')) process.stdout.write(`${message}\n`);
  });
  await hostWindow.loadURL(rendererUrl);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    const message = JSON.parse(line) as { targetId: string; type: string };
    if (message.type !== "verify-cleanup") return;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (
        manager.getAutomationPageState({ hostWindow, targetId: message.targetId }) === null &&
        hostWindow.contentView.children.length === 0
      ) {
        process.stdout.write(`${JSON.stringify({ fixture: "cleanup", noDebuggerOrView: true })}\n`);
        manager.destroyAll();
        hostWindow.destroy();
        app.exit(0);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Automation target or Browser view leaked after CLI close");
  });
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  app.exit(1);
});
