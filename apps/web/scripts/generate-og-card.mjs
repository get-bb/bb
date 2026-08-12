// Renders scripts/og-card.html to public/og.png, the card platforms show when
// a bb link is shared. Run it after editing the template:
//
//   pnpm --filter @bb/web og:card
//
// Every path is resolved from this file, so the working directory doesn't
// matter, and the font comes from the same @fontsource-variable/inter this app
// already depends on rather than a hand-written node_modules path.
//
// Chrome is found via CHROME_PATH or the usual install locations. It's driven
// over DevTools rather than with --headless --screenshot: recent Chrome hangs
// on that switch and never writes the file.
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WIDTH = 1200;
const HEIGHT = 630;
// 2x so the card stays sharp on the retina displays most feeds are read on.
const SCALE = 2;

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const TEMPLATE = here("./og-card.html");
const LOGO = here("../../../assets/bb-logo.png");
const OUTPUT = here("../public/og.png");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    `No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
  );
}

/** Waits for Chrome to write the DevTools port it picked (--remote-debugging-port=0). */
async function readDevToolsPort(profileDir, chrome) {
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited (${chrome.exitCode}) before DevTools was ready`);
    }
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      if (port) return port;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("DevTools did not start within 30s");
}

/** Minimal CDP client: send a command, resolve when its id comes back. */
function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const eventWaiters = new Map();
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      eventWaiters.get(message.method)?.forEach((resolve) => resolve(message.params));
      eventWaiters.delete(message.method);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), {
      once: true,
    });
  });
  return {
    ready,
    send(method, params = {}) {
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => {
        const waiters = eventWaiters.get(method) ?? [];
        waiters.push(resolve);
        eventWaiters.set(method, waiters);
      });
    },
    close: () => socket.close(),
  };
}

async function main() {
  const require = createRequire(import.meta.url);
  const font = require.resolve(
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  );

  // The font and logo are copied in beside the page rather than linked where
  // they live: a file:// document may only read its own directory, so absolute
  // file URLs elsewhere on disk load as broken images.
  const workDir = await mkdtemp(join(tmpdir(), "bb-og-card-"));
  const profileDir = join(workDir, "profile");
  const pageFile = join(workDir, "card.html");
  await copyFile(font, join(workDir, "inter.woff2"));
  await copyFile(LOGO, join(workDir, "bb-logo.png"));

  // replaceAll, not replace: the template's own comment names the placeholders,
  // so a first-occurrence swap rewrites the comment and leaves the real
  // attributes pointing at the literal token.
  const html = (await readFile(TEMPLATE, "utf8"))
    .replaceAll("__FONT_URL__", "inter.woff2")
    .replaceAll("__LOGO_URL__", "bb-logo.png");
  await writeFile(pageFile, html);

  const chromeBinary = await findChrome();
  const chrome = spawn(
    chromeBinary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      "--hide-scrollbars",
      "--use-mock-keychain",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const port = await readDevToolsPort(profileDir, chrome);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("Chrome exposed no page target");

    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: pathToFileURL(pageFile).href });
    await loaded;
    // Wait for the webfont (it decides the layout) and every image to actually
    // decode. Screenshotting before the mark loads produced a card with a
    // broken-image box, which is invisible until someone shares a link — so a
    // failed decode throws instead of writing a quietly wrong PNG.
    const { exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        await document.fonts.ready;
        if (!document.fonts.check('88px "Inter Var"')) {
          throw new Error("Inter Var did not load; the card would render in a fallback face");
        }
        await Promise.all([...document.images].map((image) =>
          image.decode().catch(() => {
            throw new Error("image failed to load: " + image.getAttribute("src"));
          }),
        ));
      })()`,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? "the card failed to render",
      );
    }
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    // Graceful shutdown: a plain kill leaves Chrome's helper processes writing
    // into the profile, which then survives the cleanup below.
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();

    await mkdir(here("../public"), { recursive: true });
    await writeFile(OUTPUT, Buffer.from(data, "base64"));
    console.log(`Wrote ${OUTPUT} (${WIDTH * SCALE}x${HEIGHT * SCALE})`);
  } finally {
    // Wait for Chrome to actually exit before deleting its profile — it keeps
    // writing there after the signal, and the removal fails as ENOTEMPTY.
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
