import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { app, BaseWindow, BrowserWindow, webContents } from "electron";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

app.commandLine.appendSwitch("site-per-process");
const mode = process.argv[2];
assert(mode === "same-origin" || mode === "remote" || mode === "mixed");
let epoch = 0;
const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  const pathname = new URL(request.url ?? "/", "http://fixture.test").pathname;
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  const port = address.port;
  const text = pathname === "/nested" ? "Nested context" : "Child context";
  const button = `<button id="child" style="position:absolute;left:10px;top:10px;width:100px;height:30px">${text}</button><form style="position:absolute;left:10px;top:45px" onsubmit="event.preventDefault();document.body.dataset.submitted='true'"><input id="field" value="stale"></form><script>document.addEventListener("input",event=>document.body.dataset.trustedInput=String(event.isTrusted));document.addEventListener("keydown",event=>window.lastKey={key:event.key,code:event.code,shift:event.shiftKey,trusted:event.isTrusted});</script>`;
  response.end(
    pathname === "/child"
      ? `${button}<iframe style="position:absolute;left:20px;top:60px" src="http://${mode === "mixed" ? "localhost" : "127.0.0.1"}:${port}/nested"></iframe>`
      : pathname === "/nested"
        ? button
        : `<title>Root</title><iframe src="http://${mode === "same-origin" ? "127.0.0.1" : "localhost"}:${port}/child"></iframe>`,
  );
});
const deadline = setTimeout(() => {
  console.error("Native frame scenario timed out");
  app.exit(1);
}, 30_000);

async function run() {
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  await app.whenReady();
  const window = new BrowserWindow({ show: false });
  await window.loadURL("about:blank");
  const originalWindows = new Set(BaseWindow.getAllWindows());
  const hostWindow: DesktopBrowserHostWindow = {
    contentView: window.contentView,
    getContentBounds: () => window.getContentBounds(),
    isDestroyed: () => window.isDestroyed(),
    webContents: {
      id: window.webContents.id,
      isDestroyed: () => window.webContents.isDestroyed(),
      send: (_channel, payload) => {
        if (
          "navigationEpoch" in payload &&
          typeof payload.navigationEpoch === "number"
        ) {
          epoch = payload.navigationEpoch;
        }
      },
    },
  };
  const manager = createDesktopBrowserViewManager({
    dispatchAppCommand: () => {},
    focusHostWebContents: () => {
      throw new Error("Background input stole focus");
    },
    resolveAppCommand: () => null,
    partition: `bb-frame-smoke-${Date.now()}`,
  });
  try {
    const address = server.address();
    assert(address !== null && typeof address !== "string");
    manager.attach({
      hostWindow,
      request: {
        tabId: "probe",
        url: `http://127.0.0.1:${address.port}/`,
        visible: false,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    });
    const page = webContents
      .getAllWebContents()
      .find((contents) => contents.id !== window.webContents.id);
    assert(page);
    const loaded = Promise.withResolvers<void>();
    page.once("did-finish-load", loaded.resolve);
    page.once("did-fail-load", (_event, code, message) =>
      loaded.reject(new Error(`${code}: ${message}`)),
    );
    await loaded.promise;
    const listed = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "probe",
        expectedNavigationEpoch: epoch,
        maxFrames: 20,
      },
    });
    assert.equal(listed.frames.length, 2);
    const observations = [];
    for (const frame of listed.frames) {
      for (const world of ["main", "isolated"] as const) {
        const result = await manager.runPageScript({
          hostWindow,
          request: {
            tabId: "probe",
            requestId: `${frame.frameId}-${world}`,
            expectedNavigationEpoch: epoch,
            frame: {
              frameId: frame.frameId,
              documentEpoch: frame.documentEpoch,
            },
            world,
            source:
              '({ input }) => { globalThis.sentinel = input; return document.querySelector("#child").textContent; }',
            input: world,
            timeoutMs: 3_000,
          },
        });
        const expected =
          new URL(frame.url).pathname === "/nested"
            ? "Nested context"
            : "Child context";
        assert.equal(result.value, expected);
        observations.push({
          url: frame.url,
          depth: frame.depth,
          world,
          value: result.value,
        });
      }
      for (const world of ["main", "isolated"] as const) {
        const sentinel = await manager.runPageScript({
          hostWindow,
          request: {
            tabId: "probe",
            requestId: `${frame.frameId}-${world}-sentinel`,
            expectedNavigationEpoch: epoch,
            frame: {
              frameId: frame.frameId,
              documentEpoch: frame.documentEpoch,
            },
            world,
            source: "() => globalThis.sentinel",
            input: null,
            timeoutMs: 3_000,
          },
        });
        assert.equal(sentinel.value, world);
      }
      const click = manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-click`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source:
            '() => { const clicked = Promise.withResolvers(); document.querySelector("#child").addEventListener("click", event => clicked.resolve(event.isTrusted), { once: true }); return clicked.promise; }',
          input: null,
          timeoutMs: 3_000,
        },
      });
      const pointerCancellation = assert.rejects(
        manager.sendPointerInput({
          hostWindow,
          request: {
            tabId: "probe",
            requestId: `${frame.frameId}-input`,
            expectedNavigationEpoch: epoch,
            frame: {
              frameId: frame.frameId,
              documentEpoch: frame.documentEpoch,
            },
            events: [{ type: "mouseMove", x: 60, y: 25 }],
          },
        }),
        { name: "AbortError" },
      );
      const trustedInput = manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-input`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          action: {
            kind: "click",
            x: 60,
            y: 25,
            button: "left",
            clickCount: 1,
          },
        },
      });
      manager.cancelPointerInput({
        hostWindow,
        tabId: "probe",
        requestId: `${frame.frameId}-input`,
      });
      const [clicked] = await Promise.all([
        click,
        trustedInput,
        pointerCancellation,
      ]);
      assert.equal(clicked.value, true);
      observations.push({ url: frame.url, trustedClick: true });
      const pointerClick = manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-pointer-click`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source:
            '() => { const clicked = Promise.withResolvers(); const states = []; const button = document.querySelector("#child"); for (const type of ["mousedown", "mouseup"]) button.addEventListener(type, event => states.push({ type: event.type, buttons: event.buttons, trusted: event.isTrusted }), { once: true }); button.addEventListener("click", () => clicked.resolve(states), { once: true }); return clicked.promise; }',
          input: null,
          timeoutMs: 3_000,
        },
      });
      const trustedCancellation = assert.rejects(
        manager.sendTrustedInput({
          hostWindow,
          request: {
            tabId: "probe",
            requestId: `${frame.frameId}-pointer`,
            expectedNavigationEpoch: epoch,
            frame: {
              frameId: frame.frameId,
              documentEpoch: frame.documentEpoch,
            },
            action: {
              kind: "click",
              x: 60,
              y: 25,
              button: "left",
              clickCount: 1,
            },
          },
        }),
        { name: "AbortError" },
      );
      const pointerInput = manager.sendPointerInput({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-pointer`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          events: [
            { type: "mouseMove", x: 60, y: 25 },
            { type: "mouseDown", x: 60, y: 25, button: "left", clickCount: 1 },
            { type: "mouseUp", x: 60, y: 25, button: "left", clickCount: 1 },
          ],
        },
      });
      manager.cancelTrustedInput({
        hostWindow,
        tabId: "probe",
        requestId: `${frame.frameId}-pointer`,
      });
      const [pointerClicked] = await Promise.all([
        pointerClick,
        pointerInput,
        trustedCancellation,
      ]);
      assert.deepEqual(pointerClicked.value, [
        { type: "mousedown", buttons: 1, trusted: true },
        { type: "mouseup", buttons: 0, trusted: true },
      ]);
      observations.push({ url: frame.url, pointerClick: pointerClicked.value });
      await manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-focus`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source: '() => document.querySelector("#field").focus()',
          input: null,
          timeoutMs: 3_000,
        },
      });
      await manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-type`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          action: { kind: "type", text: "frame text", clear: true },
        },
      });
      await manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-key`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          action: {
            kind: "key",
            key: "!",
            code: "Digit1",
            modifiers: ["Shift"],
          },
        },
      });
      const typed = await manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-typed`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source:
            '() => ({ value: document.querySelector("#field").value, trusted: document.body.dataset.trustedInput, key: window.lastKey })',
          input: null,
          timeoutMs: 3_000,
        },
      });
      assert.deepEqual(typed.value, {
        value: "frame text!",
        trusted: "true",
        key: { key: "!", code: "Digit1", shift: true, trusted: true },
      });
      await manager.sendTrustedInput({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-enter`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          action: { kind: "key", key: "Enter", code: "Enter", modifiers: [] },
        },
      });
      const submitted = await manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-submitted`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source: "() => document.body.dataset.submitted",
          input: null,
          timeoutMs: 3_000,
        },
      });
      assert.equal(submitted.value, "true");
      observations.push({
        url: frame.url,
        typed: typed.value,
        submitted: true,
      });
    }
    const parentFrame = listed.frames.find((frame) => frame.depth === 1);
    const previousChild = listed.frames.find((frame) => frame.depth === 2);
    assert(parentFrame && previousChild);
    const changed = await manager.runPageScript({
      hostWindow,
      request: {
        tabId: "probe",
        requestId: "child-navigation",
        expectedNavigationEpoch: epoch,
        frame: {
          frameId: parentFrame.frameId,
          documentEpoch: parentFrame.documentEpoch,
        },
        world: "main",
        source:
          'async ({ input }) => { const frame = document.querySelector("iframe"); const loaded = Promise.withResolvers(); frame.addEventListener("load", loaded.resolve, { once: true }); frame.src = input; await loaded.promise; return globalThis.sentinel; }',
        input: `${previousChild.url}?generation=next`,
        timeoutMs: 3_000,
      },
    });
    assert.equal(changed.value, "main");
    await assert.rejects(
      manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: "stale-child",
          expectedNavigationEpoch: epoch,
          frame: {
            frameId: previousChild.frameId,
            documentEpoch: previousChild.documentEpoch,
          },
          world: "main",
          source: '() => { document.body.dataset.staleTarget = "mutated"; }',
          input: null,
          timeoutMs: 3_000,
        },
      }),
    );
    const afterChildNavigation = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "probe",
        expectedNavigationEpoch: epoch,
        maxFrames: 20,
      },
    });
    const survivingParent = afterChildNavigation.frames.find(
      (frame) => frame.frameId === parentFrame.frameId,
    );
    assert(survivingParent);
    assert.equal(survivingParent.documentEpoch, parentFrame.documentEpoch);
    observations.push({ parentSurvivedChildNavigation: true });
    const detached = Promise.withResolvers<void>();
    page.debugger.once("detach", () => detached.resolve());
    page.debugger.detach();
    await detached.promise;
    const oldFrame = afterChildNavigation.frames[0];
    assert(oldFrame);
    await assert.rejects(
      manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: "stale-after-detach",
          expectedNavigationEpoch: epoch,
          frame: {
            frameId: oldFrame.frameId,
            documentEpoch: oldFrame.documentEpoch,
          },
          world: "main",
          source: '() => { document.body.dataset.staleTarget = "mutated"; }',
          input: null,
          timeoutMs: 3_000,
        },
      }),
    );
    const rediscovered = await manager.listFrames({
      hostWindow,
      request: {
        tabId: "probe",
        expectedNavigationEpoch: epoch,
        maxFrames: 20,
      },
    });
    assert.equal(rediscovered.frames.length, listed.frames.length);
    for (const frame of rediscovered.frames) {
      assert(
        !listed.frames.some((previous) => previous.frameId === frame.frameId),
      );
      const result = await manager.runPageScript({
        hostWindow,
        request: {
          tabId: "probe",
          requestId: `${frame.frameId}-after-detach`,
          expectedNavigationEpoch: epoch,
          frame: { frameId: frame.frameId, documentEpoch: frame.documentEpoch },
          world: "main",
          source: "() => document.body.dataset.staleTarget ?? null",
          input: null,
          timeoutMs: 3_000,
        },
      });
      assert.equal(result.value, null);
    }
    observations.push({ debuggerRecovery: true, staleMutation: false });
    assert.equal(window.isVisible(), false);
    for (const surface of BaseWindow.getAllWindows()) {
      if (originalWindows.has(surface)) continue;
      assert.equal(surface.getOpacity(), 0);
      assert.equal(surface.isFocusable(), false);
    }
    return { nativeFrameSmoke: "passed", mode, observations };
  } finally {
    try {
      manager.destroyAll();
      assert.deepEqual(new Set(BaseWindow.getAllWindows()), originalWindows);
    } finally {
      window.destroy();
    }
  }
}

run()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(deadline);
    server.close();
    app.exit(process.exitCode === 1 ? 1 : 0);
  });
