// Real-Electron fixture for the F12/R01 page-script safety contract.
// Exercises the ACTUAL source runtime (startDesktopBrowserPageScript from
// desktop-browser-page-runtime.ts) against a real hidden Electron window with
// the BB isolated world, then drives: busy timeout, concurrent newer request
// survival, explicit cancel, post-cancel page health, world/context survival.
import { app, BrowserWindow } from "electron";
import {
  startDesktopBrowserPageScript,
} from "../src/desktop-browser-page-runtime.js";

interface ResultRow {
  name: string;
  ok: boolean;
  observations: Record<string, unknown>;
}
const results: ResultRow[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(name: string, observations: Record<string, unknown>): void {
  results.push({ name, ok: true, observations });
}
function recordFail(name: string, error: unknown): void {
  results.push({
    name,
    ok: false,
    observations: { error: error instanceof Error ? error.message : String(error) },
  });
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadURL(
      "data:text/html,<html><body><script>globalThis.pageTicks=0;setInterval(()=>{globalThis.pageTicks++},20)</script></body></html>",
    );
    const contents = window.webContents;
    contents.debugger.attach("1.3");
    const readTicks = async (): Promise<number> => {
      const raw = (await contents.debugger.sendCommand("Runtime.evaluate", {
        expression: "globalThis.pageTicks",
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      return typeof raw?.result?.value === "number" ? raw.result.value : -1;
    };

    // A) busy-after-await times out finitely; page ticks and unrelated run
    await (async () => {
      const startedAt = Date.now();
      const ticksBefore = await readTicks();
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          tabId: "browser:f12",
          expectedNavigationEpoch: 1,
          requestId: "f12-busy",
          world: "isolated",
          timeoutMs: 500,
          source: "async () => { await new Promise((r) => setTimeout(r, 50)); while (true) {} }",
          input: null,
        },
        webContents: contents,
      });
      let outcome = "pending";
      let elapsedMs = -1;
      try {
        await session.promise;
        outcome = "resolved";
      } catch (error) {
        outcome = error instanceof Error ? error.name : String(error);
      }
      elapsedMs = Date.now() - startedAt;
      await delay(250);
      const ticksAfter = await readTicks();
      let unrelated = "unavailable";
      try {
        const raw = (await contents.debugger.sendCommand("Runtime.evaluate", {
          expression: "1 + 2",
          returnByValue: true,
        })) as { result?: { value?: unknown } };
        unrelated = String(raw?.result?.value);
      } catch (error) {
        unrelated = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      record("busy times out finite; page and unrelated survive", {
        outcome,
        elapsedMs,
        timedOut: outcome === "Error",
        ticksAdvanced:
          typeof ticksBefore === "number" &&
          typeof ticksAfter === "number" &&
          ticksAfter > ticksBefore,
        unrelated,
      });
    })().catch((error) => recordFail("busy times out finite", error));

    // B) a concurrent newer request in the same world must not be killed by
    // the older request's grace termination once it is actually running.
    // The older is an ASYNC busy loop (repeated awaits), which lets the newer
    // evaluate interleave and start while the older is still outstanding.
    await (async () => {
      const older = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          tabId: "browser:f12",
          expectedNavigationEpoch: 1,
          requestId: "f12-older",
          world: "isolated",
          timeoutMs: 500,
          source: "async () => { while (true) { await new Promise((r) => setTimeout(r, 5)); } }",
          input: null,
        },
        webContents: contents,
      });
      await delay(120);
      const newer = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          tabId: "browser:f12",
          expectedNavigationEpoch: 1,
          requestId: "f12-newer",
          world: "isolated",
          timeoutMs: 3_000,
          source: "async () => { await new Promise((r) => setTimeout(r, 600)); return 'newer-survived'; }",
          input: null,
        },
        webContents: contents,
      });
      const startedAt = Date.now();
      let olderOutcome = "pending";
      let olderMs = -1;
      try {
        await older.promise;
        olderOutcome = "resolved";
      } catch (error) {
        olderOutcome = error instanceof Error ? error.name : String(error);
      }
      olderMs = Date.now() - startedAt;
      let newerOutcome = "pending";
      let newerMs = -1;
      try {
        const newerValue = await newer.promise;
        newerOutcome = `resolved:${JSON.stringify(newerValue.value)}`;
      } catch (error) {
        newerOutcome = `rejected:${error instanceof Error ? error.name + ":" + error.message : String(error)}`;
      }
      newerMs = Date.now() - startedAt;
      record("concurrent newer request survives the older grace kill", {
        olderOutcome,
        olderMs,
        newerOutcome,
        newerMs,
        newerSurvived: newerOutcome.includes("newer-survived"),
      });
    })().catch((error) => recordFail("concurrent newer survives", error));

    // C) explicit cancel rejects AbortError; page healthy after
    await (async () => {
      const ticksBefore = await readTicks();
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          tabId: "browser:f12",
          expectedNavigationEpoch: 1,
          requestId: "f12-cancel",
          world: "isolated",
          timeoutMs: 5_000,
          source: "async () => { await new Promise((r) => setTimeout(r, 2000)); return 'late'; }",
          input: null,
        },
        webContents: contents,
      });
      await delay(150);
      session.cancel();
      let outcome = "pending";
      try {
        await session.promise;
        outcome = "resolved";
      } catch (error) {
        outcome = error instanceof Error ? error.name : String(error);
      }
      await delay(300);
      const ticksAfter = await readTicks();
      let unrelated = "unavailable";
      try {
        const raw = (await contents.debugger.sendCommand("Runtime.evaluate", {
          expression: "3 * 3",
          returnByValue: true,
        })) as { result?: { value?: unknown } };
        unrelated = String(raw?.result?.value);
      } catch (error) {
        unrelated = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      record("explicit cancel rejects AbortError; page healthy", {
        outcome,
        ticksAdvanced:
          typeof ticksBefore === "number" &&
          typeof ticksAfter === "number" &&
          ticksAfter > ticksBefore,
        unrelated,
      });
    })().catch((error) => recordFail("explicit cancel", error));

    // D) isolated world context survives a grace kill (fresh eval in same world)
    await (async () => {
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          tabId: "browser:f12",
          expectedNavigationEpoch: 1,
          requestId: "f12-kill-context",
          world: "isolated",
          timeoutMs: 300,
          source: "async () => { while (true) {} }",
          input: null,
        },
        webContents: contents,
      });
      let outcome = "pending";
      try {
        await session.promise;
        outcome = "resolved";
      } catch (error) {
        outcome = error instanceof Error ? error.name : String(error);
      }
      await delay(700);
      let fresh = "unavailable";
      try {
        const session2 = startDesktopBrowserPageScript({
          navigationEpoch: 1,
          request: {
            tabId: "browser:f12",
            expectedNavigationEpoch: 1,
            requestId: "f12-after-kill",
            world: "isolated",
            timeoutMs: 2_000,
            source: "async () => ({ ok: 'after-kill-fresh' })",
            input: null,
          },
          webContents: contents,
        });
        const value = await session2.promise;
        fresh = JSON.stringify(value.value);
      } catch (error) {
        fresh = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      record("isolated world context survives a grace kill", {
        outcome,
        freshResult: fresh,
      });
    })().catch((error) => recordFail("context survives kill", error));

    process.stdout.write(JSON.stringify(results));
  } catch (error) {
    recordFail("fixture-fatal", error);
    process.stdout.write(JSON.stringify(results));
  } finally {
    window.destroy();
    setTimeout(() => app.quit(), 30);
  }
});
