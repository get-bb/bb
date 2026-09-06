import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, webContents } from "electron";
import { importCookiesFromBrowserSource } from "../src/desktop-browser-cookie-import.js";
import { createDesktopBrowserViewManager } from "../src/desktop-browser-view.js";

const deadline = setTimeout(() => app.exit(1), 30_000);

async function run() {
  await app.whenReady();
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "bb-real-cookie-import-"));
  const profile = join(home, "Library", "Application Support", "Google", "Chrome", "Default");
  mkdirSync(profile, { recursive: true });
  const database = new DatabaseSync(join(profile, "Cookies"));
  database.exec(`
    CREATE TABLE cookies (
      host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT NOT NULL, path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL, samesite INTEGER NOT NULL,
      encrypted_value BLOB NOT NULL
    );
    INSERT INTO cookies VALUES ('.example.test', '', 'session', 'imported', '/', 0, 1, 1, 1, X'');
    INSERT INTO cookies VALUES ('.example.test', 'https://embedder.test', 'session', 'partitioned', '/', 0, 1, 1, 1, X'');
  `);
  database.close();
  process.env.HOME = home;
  const window = new BrowserWindow({ show: false });
  const manager = createDesktopBrowserViewManager({
    dispatchAppCommand: () => {},
    focusHostWebContents: () => {},
    resolveAppCommand: () => null,
    partition: `bb-real-cookie-probe-${Date.now()}`,
  });
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.setHeader("set-cookie", "network_writer=active; Path=/");
    response.end('<script>setInterval(() => { document.cookie = "page_writer=active; Path=/"; }, 1)</script>');
  });
  try {
    await window.loadURL("about:blank");
    manager.attach({ hostWindow: window, request: {
      tabId: "cookies", url: "about:blank", visible: false,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    } });
    const page = webContents.getAllWebContents().find(contents => contents.id !== window.webContents.id);
    assert(page);
    await page.loadURL("about:blank");
    const cookies = page.session.cookies;
    await cookies.set({
      domain: "example.test", httpOnly: true, name: "session", path: "/",
      sameSite: "lax", secure: true, url: "https://example.test/", value: "old",
    });
    const reloaded = Promise.withResolvers<void>();
    page.once("did-finish-load", reloaded.resolve);
    const imported = await manager.importCookiesFromBrowser({ hostWindow: window, request: {
      tabId: "cookies", family: "chrome", profileId: "Default",
    } });
    await reloaded.promise;
    const snapshot = await cookies.get({});
    assert.deepEqual(snapshot.map(({ httpOnly, name, value }) => ({ httpOnly, name, value })), [
      { httpOnly: true, name: "session", value: "imported" },
    ]);
    const source = importCookiesFromBrowserSource({ family: "chrome", profileId: "Default" });
    const set = cookies.set.bind(cookies);
    cookies.set = async (details) => {
      if (details.value === "reject-commit") throw new Error("Injected destination write failure");
      await set(details);
    };
    try {
      await assert.rejects(manager.importCookies({ hostWindow: window, request: {
        tabId: "cookies", cookies: source.map(cookie => ({ ...cookie, value: "reject-commit" })),
      } }), /Browser cookie import failed/);
    } finally {
      cookies.set = set;
    }
    assert.deepEqual(await cookies.get({}), snapshot);
    await assert.rejects(manager.importCookies({ hostWindow: window, request: {
      tabId: "cookies", cookies: source.map(cookie => ({ ...cookie, expirationDate: 1 })),
    } }));
    assert.deepEqual(await cookies.get({}), snapshot);
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const address = server.address();
    assert(address !== null && typeof address !== "string");
    await page.loadURL(`http://127.0.0.1:${address.port}/`);
    await assert.rejects(manager.importCookies({ hostWindow: window, request: {
      tabId: "cookies", cookies: source.map(cookie => ({ ...cookie, value: "must-not-commit" })),
    } }), /active page cookie writers cannot be isolated/);
    assert.deepEqual(await cookies.get({ domain: "example.test" }), snapshot);
    return {
      finalCookies: snapshot.map(({ httpOnly, name, value }) => ({ httpOnly, name, value })),
      importedCount: imported.importedCookies,
      rollbackRestored: true,
      invalidStagingPreservedDestination: true,
      activeWritersRejected: true,
    };
  } finally {
    manager.destroyAll();
    window.destroy();
    server.close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { force: true, recursive: true });
  }
}

run().then(result => process.stdout.write(JSON.stringify(result))).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline);
  app.exit(process.exitCode === 1 ? 1 : 0);
});
