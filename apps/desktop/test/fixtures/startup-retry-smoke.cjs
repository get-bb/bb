const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { app, ipcMain } = require("electron");

const desktopRoot = process.env.BB_STARTUP_SMOKE_APP_PATH;
const scenario = process.env.BB_STARTUP_SMOKE_SCENARIO ?? "custom";
const channel = "bb-desktop:retry-startup";
const loads = [];
let contents;
let recovered = false;
let mintCount = 0;

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
  if (scenario === "custom") {
    await new Promise((resolve) => server.close(resolve));
  }
  process.env.BB_SERVER_PORT = String(port);
  await writeFile(
    join(app.getPath("userData"), "server-target.json"),
    JSON.stringify(
      scenario === "fatal"
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
  app.setAppPath(desktopRoot);
  app.on("browser-window-created", (_event, window) => {
    contents = window.webContents;
    const loadURL = contents.loadURL.bind(contents);
    contents.loadURL = (url, options) => {
      loads.push(url);
      return loadURL(url, options);
    };
  });
  require(join(desktopRoot, "dist/main.js"));
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
  if (scenario === "fatal") {
    assert.equal(
      await contents.executeJavaScript(
        'document.querySelectorAll("button").length',
      ),
      0,
    );
    const before = loads.length;
    ipcMain.emit(channel, {
      sender: contents,
      senderFrame: contents.mainFrame,
    });
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
  assert.equal(
    await contents.executeJavaScript(
      'document.querySelectorAll("[data-testid=bb-startup-retry]").length',
    ),
    1,
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
    undefined,
    "unexpected",
  );
  ipcMain.emit(channel, {
    sender: { id: -1 },
    senderFrame: contents.mainFrame,
  });
  ipcMain.emit(channel, {
    sender: contents,
    senderFrame: { url: contents.getURL() },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    loads.length,
    rejected,
    "Invalid payloads, unregistered senders and subframes must be rejected",
  );
  const errorUrl = contents.getURL();
  await contents.loadURL(
    "data:text/html;charset=utf-8,<h1>Unrelated local page</h1>",
  );
  const unrelated = loads.length;
  ipcMain.emit(channel, { sender: contents, senderFrame: contents.mainFrame });
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
    'const button = document.querySelector("[data-testid=bb-startup-retry]"); for (let i = 0; i < 10; i++) button.click();',
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
  ipcMain.emit(channel, { sender: contents, senderFrame: contents.mainFrame });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(loads.length, after, "Loaded remote pages cannot retry startup");
  server.close();
  console.log("STARTUP_RETRY_SMOKE_OK");
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
