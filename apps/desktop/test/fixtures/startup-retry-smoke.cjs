const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const {
  appendFile,
  chmod,
  mkdir,
  readFile,
  writeFile,
} = require("node:fs/promises");
const { join } = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");

app.setName("bb-dev");

const desktopRoot = process.env.BB_STARTUP_SMOKE_APP_PATH;
app.setVersion(require(join(desktopRoot, "package.json")).version);
const scenario = process.env.BB_STARTUP_SMOKE_SCENARIO ?? "custom";
const channel = "bb-desktop:startup-action";
const loads = [];
let contents;
let recovered = false;
let mintCount = 0;
let logsWindow;

async function until(check) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "Timed out waiting for startup recovery");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function run() {
  const server = createServer((request, response) => {
    if (scenario === "fatal") {
      response.writeHead(503);
      response.end();
    } else if (request.url === "/health") {
      response.end(JSON.stringify({ ok: true }));
    } else if (request.url === "/api/v1/system/config") {
      response.end(
        JSON.stringify({
          hostDaemonPort: 38887,
          voiceTranscriptionEnabled: false,
        }),
      );
    } else if (
      request.url === "/api/v1/plugins/connect/rpc/createDesktopSession"
    ) {
      mintCount += 1;
      if (!recovered) {
        response.writeHead(503);
        response.end();
      } else {
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              cookie: {
                domain: "127.0.0.1",
                expiresAt: Date.now() + 3600_000,
                name: "bb_session",
                value: "synthetic-retry-cookie",
              },
            },
          }),
        );
      }
    } else if (request.url.startsWith("/api/")) {
      response.writeHead(404);
      response.end();
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end("<h1>Recovered</h1>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  if (scenario === "custom" || scenario === "crashed") {
    await new Promise((resolve) => server.close(resolve));
  }
  if (scenario === "crashed") {
    const crashingRuntime = join(app.getPath("userData"), "crashing-bb-app");
    await writeFile(
      crashingRuntime,
      '#!/bin/sh\necho "bb-app native module failed to load" >&2\nexit 3\n',
    );
    await chmod(crashingRuntime, 0o755);
    process.env.BB_DESKTOP_NODE_EXEC_PATH = crashingRuntime;
  }
  process.env.BB_SERVER_PORT = String(port);
  await writeFile(
    join(app.getPath("userData"), "server-target.json"),
    JSON.stringify(
      scenario === "fatal" || scenario === "attached" || scenario === "crashed"
        ? { target: "builtin", customServerUrl: null }
        : scenario === "connect"
          ? {
              target: "connect",
              customServerUrl: null,
              connectServer: {
                handle: "retry",
                name: "Retry fixture",
                url: serverUrl,
              },
            }
          : { target: "custom", customServerUrl: serverUrl },
    ),
  );
  if (scenario === "attached") process.env.BB_DESKTOP_APP_URL = serverUrl;
  app.setAppPath(desktopRoot);
  app.on("browser-window-created", (_event, window) => {
    contents ??= window.webContents;
    const loadURL = window.webContents.loadURL.bind(window.webContents);
    window.webContents.loadURL = (url, options) => {
      loads.push(url);
      return loadURL(url, options);
    };
  });
  require(join(desktopRoot, "dist/main.js"));
  if (scenario === "attached") {
    await until(() => contents?.getURL() === `${serverUrl}/`);
    await until(() =>
      contents.executeJavaScript(
        'document.querySelector("h1")?.textContent === "Recovered"',
      ),
    );
    assert.equal(
      await contents.executeJavaScript(
        "window.bbDesktop.getInfo().then((info) => info.serverDaemonLogsAvailable)",
      ),
      true,
    );
    await contents.executeJavaScript("window.bbDesktop.openServerDaemonLogs()");
    await verifyLocalLogs();
    server.close();
    console.log("STARTUP_RETRY_SMOKE_OK");
    app.exit(0);
    return;
  }
  if (scenario === "crashed") {
    const desktopLog = join(process.env.BB_DATA_DIR, "logs", "desktop.log");
    await until(async () =>
      (await readFile(desktopLog, "utf8")).includes("Could not start bb"),
    );
    const savedLogs = await readFile(desktopLog, "utf8");
    assert.ok(
      savedLogs.includes("bb-app native module failed to load"),
      "bb-app output from a failed startup must be persisted",
    );
    console.log("STARTUP_RETRY_SMOKE_OK");
    app.exit(0);
    return;
  }
  const errorTitle =
    scenario === "fatal"
      ? "Port conflict"
      : scenario === "connect"
        ? "Could not authenticate with bb Connect"
        : "Could not reach this bb server";
  const hasError = () =>
    contents?.getURL().startsWith("data:") &&
    contents.executeJavaScript(
      `document.querySelector("h1")?.textContent === ${JSON.stringify(errorTitle)}`,
    );
  await until(hasError);
  const savedLogs = await readFile(
    join(process.env.BB_DATA_DIR, "logs", "desktop.log"),
    "utf8",
  );
  assert.ok(
    savedLogs.includes(errorTitle),
    "Startup failures must be persisted without relying on stderr",
  );
  const viewMenu = Menu.getApplicationMenu().items.find(
    (item) => item.label === "View",
  );
  const logsItem = viewMenu.submenu.items.find(
    (item) => item.label === "Local Logs",
  );
  assert.equal(logsItem.enabled, true);
  logsItem.click();
  await verifyLocalLogs();
  if (scenario === "fatal") {
    assert.equal(
      await contents.executeJavaScript(
        'document.querySelectorAll("button").length',
      ),
      0,
    );
    const before = loads.length;
    ipcMain.emit(
      channel,
      { sender: contents, senderFrame: contents.mainFrame },
      "retry",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(loads.length, before, "A fatal startup error cannot retry");
    server.close();
    console.log("STARTUP_RETRY_SMOKE_OK");
    app.exit(0);
    return;
  }
  assert.equal(
    await contents.executeJavaScript("typeof window.bbDesktop"),
    "object",
  );
  assert.deepEqual(
    await contents.executeJavaScript(
      'Array.from(document.querySelectorAll("[data-startup-action]"), (button) => button.dataset.startupAction)',
    ),
    ["retry", "choose-server"],
  );
  const rejected = loads.length;
  ipcMain.emit(
    channel,
    { sender: contents, senderFrame: contents.mainFrame },
    {},
  );
  ipcMain.emit(
    channel,
    { sender: contents, senderFrame: contents.mainFrame },
    "retry",
    "unexpected",
  );
  ipcMain.emit(channel, { sender: contents, senderFrame: contents.mainFrame });
  ipcMain.emit(channel, { sender: contents, senderFrame: contents.mainFrame });
  ipcMain.emit(
    channel,
    { sender: { id: -1 }, senderFrame: contents.mainFrame },
    "retry",
  );
  ipcMain.emit(
    channel,
    { sender: contents, senderFrame: { url: contents.getURL() } },
    "retry",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    loads.length,
    rejected,
    "Invalid payloads, actions missing from the page, unregistered senders and subframes must be rejected",
  );
  const errorUrl = contents.getURL();
  await contents.loadURL(
    "data:text/html;charset=utf-8,<h1>Unrelated local page</h1>",
  );
  const unrelated = loads.length;
  ipcMain.emit(
    channel,
    { sender: contents, senderFrame: contents.mainFrame },
    "retry",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    loads.length,
    unrelated,
    "An unrelated data URL cannot retry startup",
  );
  await contents.loadURL(errorUrl);
  const failedRetry = loads.length;
  await contents.executeJavaScript('document.querySelector("button").click()');
  await until(() => loads.length > failedRetry);
  await until(hasError);
  if (scenario === "custom") {
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  }
  recovered = true;
  const before = loads.length;
  const previousMints = mintCount;
  await contents.executeJavaScript(
    'const button = document.querySelector("[data-startup-action=retry]"); for (let i = 0; i < 10; i++) button.click();',
  );
  await until(() => contents.getURL() === `${serverUrl}/`);
  await until(() =>
    contents.executeJavaScript(
      'document.querySelector("h1")?.textContent === "Recovered"',
    ),
  );
  const retryLoads = loads.slice(before).filter((url) => url === serverUrl);
  console.log(
    JSON.stringify({ scenario, retryLoads: retryLoads.length, mintCount }),
  );
  if (scenario === "connect") {
    assert.equal(
      mintCount - previousMints,
      1,
      "Concurrent retries must mint one fresh session",
    );
    const cookies = await contents.session.cookies.get({
      url: serverUrl,
      name: "bb_session",
    });
    assert.equal(cookies[0]?.value, "synthetic-retry-cookie");
  }
  assert.equal(
    retryLoads.length,
    1,
    "Concurrent renderer clicks must apply the target once",
  );
  const after = loads.length;
  ipcMain.emit(
    channel,
    { sender: contents, senderFrame: contents.mainFrame },
    "retry",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(loads.length, after, "Loaded remote pages cannot retry startup");
  assert.equal(
    logsWindow.isDestroyed(),
    false,
    "Runtime changes must preserve the local log viewer",
  );
  server.close();
  console.log("STARTUP_RETRY_SMOKE_OK");
  app.exit(0);
}

async function verifyLocalLogs() {
  await until(() => {
    logsWindow = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === "bb - Local Logs",
    );
    return logsWindow && !logsWindow.webContents.isLoading();
  });
  const logDir = join(process.env.BB_DATA_DIR, "logs");
  const openPath = shell.openPath;
  let openedPath;
  shell.openPath = async (path) => {
    openedPath = path;
    return "";
  };
  try {
    const result = await logsWindow.webContents.executeJavaScript(
      "window.bbLogViewer.openLogsFolder()",
    );
    assert.equal(result.path, logDir);
    assert.equal(openedPath, logDir);
  } finally {
    shell.openPath = openPath;
  }
  await mkdir(logDir, { recursive: true });
  await appendFile(
    join(logDir, "server.1.log"),
    "attached server diagnostic\n",
  );
  await appendFile(join(logDir, "desktop.log"), "desktop Connect diagnostic\n");
  await until(() =>
    logsWindow.webContents.executeJavaScript(
      'document.querySelector("pre")?.textContent.includes("attached server diagnostic") && document.querySelector("pre")?.textContent.includes("desktop Connect diagnostic")',
    ),
  );
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
