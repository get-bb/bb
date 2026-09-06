import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

interface ScenarioResult {
  name: string;
  ok: boolean;
  observations: Record<string, unknown>;
}

const results: ScenarioResult[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} did not settle within ${ms}ms`);
    }),
  ]);
}

interface WorldHandles {
  mainContextId?: unknown;
  mainFrameId?: unknown;
}

async function collectWorldHandles(window: BrowserWindow): Promise<WorldHandles> {
  const contents = window.webContents;
  const contexts: Array<Record<string, unknown>> = [];
  const listener = (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ): void => {
    if (method === "Runtime.executionContextCreated") {
      const context = params.context as Record<string, unknown> | undefined;
      if (context) contexts.push(context);
    }
  };
  contents.debugger.on("message", listener);
  try {
    await contents.debugger.sendCommand("Runtime.enable");
    await contents.debugger.sendCommand("Page.enable");
    await delay(250);
    const mainContext = contexts.find((context) => {
      const auxData = context.auxData as Record<string, unknown> | undefined;
      return auxData?.isDefault === true;
    });
    return {
      mainContextId: mainContext?.id,
      mainFrameId: (mainContext?.auxData as Record<string, unknown> | undefined)
        ?.frameId,
    };
  } finally {
    contents.debugger.removeListener("message", listener);
  }
}

async function createIsolatedWorld(
  window: BrowserWindow,
  frameId: unknown,
  worldName: string,
): Promise<number> {
  const contents = window.webContents;
  const created = (await contents.debugger.sendCommand(
    "Page.createIsolatedWorld",
    { frameId, worldName },
  )) as { executionContextId?: unknown };
  const contextId = created?.executionContextId;
  if (typeof contextId !== "number") {
    throw new Error("createIsolatedWorld returned no executionContextId");
  }
  return contextId;
}

async function evaluateInContext(
  window: BrowserWindow,
  contextId: number,
  code: string,
): Promise<unknown> {
  const contents = window.webContents;
  const raw = (await contents.debugger.sendCommand("Runtime.evaluate", {
    contextId,
    expression: code,
    awaitPromise: true,
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  return raw?.result?.value;
}

async function scenario(
  name: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    results.push({ name, ok: true, observations: await run() });
  } catch (error) {
    results.push({
      name,
      ok: false,
      observations: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

app.whenReady().then(async () => {
  const userData = mkdtempSync(join(tmpdir(), "bb-script-safety-"));
  app.setPath("userData", userData);
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
    const handles = await collectWorldHandles(window);
    const mainContextId = handles.mainContextId;
    const mainFrameId = handles.mainFrameId;
    if (typeof mainContextId !== "number" || typeof mainFrameId !== "string") {
      throw new Error("main context or frame id was not discovered");
    }
    const isolatedContextId = await createIsolatedWorld(
      window,
      mainFrameId,
      "bb-browser-frame-v1",
    );

    await scenario("E2 busy loop terminated and renderer survives", async () => {
      const ticksBefore = await contents.executeJavaScript(
        "globalThis.pageTicks",
        true,
      );
      const busy = evaluateInContext(
        window,
        isolatedContextId,
        `(() => { while (true) {} })()`,
      );
      let busyOutcome = "pending";
      void withTimeout(busy, 2_000, "busy loop").then(
        () => {
          busyOutcome = "resolved";
        },
        (error: unknown) => {
          busyOutcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
        },
      );
      await delay(300);
      await contents.debugger.sendCommand("Runtime.terminateExecution");
      await delay(500);
      const ticksAfter = await contents.executeJavaScript(
        "globalThis.pageTicks",
        true,
      );
      const unrelated = await contents.executeJavaScript("1 + 2", true);
      return {
        ticksBefore: typeof ticksBefore === "number" ? ticksBefore : null,
        ticksAfter: typeof ticksAfter === "number" ? ticksAfter : null,
        ticksAdvancedAfterTerminate:
          typeof ticksBefore === "number" &&
          typeof ticksAfter === "number" &&
          ticksAfter > ticksBefore,
        busyOutcome,
        unrelatedResult: unrelated,
      };
    });

    await scenario("E3 idle terminate does not break next execution", async () => {
      await delay(100);
      const before = await contents.executeJavaScript("1+1", true);
      await contents.debugger.sendCommand("Runtime.terminateExecution");
      await delay(50);
      let nextOutcome: string;
      try {
        const next = await withTimeout(
          contents.executeJavaScript("2+2", true),
          1_000,
          "next execution",
        );
        nextOutcome = `resolved:${String(next)}`;
      } catch (error) {
        nextOutcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      let tickOutcome: string;
      try {
        const tick = await withTimeout(
          contents.executeJavaScript("globalThis.pageTicks", true),
          1_000,
          "tick read",
        );
        tickOutcome = `resolved:${String(tick)}`;
      } catch (error) {
        tickOutcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      return { before, nextOutcome, tickOutcome };
    });

    await scenario("E4 terminate during async wait has no collateral", async () => {
      const pending = evaluateInContext(
        window,
        isolatedContextId,
        `(async () => { await new Promise((resolve) => setTimeout(resolve, 2000)); return "late"; })()`,
      );
      let pendingOutcome = "pending";
      void withTimeout(pending, 3_500, "pending async").then(
        () => {
          pendingOutcome = "resolved";
        },
        (error: unknown) => {
          pendingOutcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
        },
      );
      await delay(150);
      await contents.debugger.sendCommand("Runtime.terminateExecution");
      let unrelated: string;
      try {
        const value = await withTimeout(
          contents.executeJavaScript("6 * 7", true),
          1_000,
          "unrelated",
        );
        unrelated = `resolved:${String(value)}`;
      } catch (error) {
        unrelated = `rejected:${error instanceof Error ? error.message : String(error)}`;
      }
      const ticksAfterTerminate = await contents.executeJavaScript(
        "globalThis.pageTicks",
        true,
      );
      await delay(100);
      return {
        pendingOutcome,
        unrelated,
        ticksAdvanced:
          typeof ticksAfterTerminate === "number" && ticksAfterTerminate > 0,
      };
    });

    await scenario("E5 cooperative abort keeps page healthy", async () => {
      const pending = evaluateInContext(
        window,
        isolatedContextId,
        `(async () => {
          const controller = new AbortController();
          const registry = globalThis.__registry instanceof Map ? globalThis.__registry : new Map();
          globalThis.__registry = registry;
          const requestId = "req-race";
          registry.set(requestId, controller);
          try {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, 5000);
              controller.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              }, { once: true });
            });
            return "late";
          } finally {
            registry.delete(requestId);
          }
        })()`,
      );
      let pendingOutcome = "pending";
      void withTimeout(pending, 1_500, "cooperative pending").then(
        () => {
          pendingOutcome = "resolved";
        },
        (error: unknown) => {
          pendingOutcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
        },
      );
      await delay(150);
      await contents.executeJavaScript(
        `globalThis.__registry?.get("req-race")?.abort("cancelled"); true`,
        true,
      );
      await delay(200);
      const ticksAfterAbort = await contents.executeJavaScript(
        "globalThis.pageTicks",
        true,
      );
      const unrelated = await contents.executeJavaScript("9 * 9", true);
      return {
        pendingOutcome,
        ticksAdvanced:
          typeof ticksAfterAbort === "number" && ticksAfterAbort > 0,
        unrelated,
      };
    });

    process.stdout.write(JSON.stringify(results));
  } finally {
    window.destroy();
    rmSync(userData, { force: true, recursive: true });
    app.quit();
  }
});
