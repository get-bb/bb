import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedThreadFixture } from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const fixture = `
  import { defineRpcContract } from "@get-bb/plugin-sdk";
  import { z } from "zod";
  export default function plugin(bb: any) {
    async function run() {
      const control = globalThis.__pluginErrorControl;
      control.started();
      await control.release;
      const fail = () => {
        if (control.stale) bb.realtime.publish("changed", null);
        else throw new Error("detached plugin failure");
      };
      for (let i = 0; i < control.count; i++) {
        if (control.rejection) void Promise.resolve().then(fail);
        else setImmediate(fail);
      }
    }
    bb.cli.register({ name: "uncaught", summary: "Fixture", async run() {
      await run();
      return { exitCode: 0 };
    } });
    bb.http.route("GET", "/run", async (c: any) => {
      await run();
      return c.json({ ok: true });
    });
    bb.rpc.register(defineRpcContract({ run: { input: z.null(), output: z.null() } }), {
      async run() { await run(); return null; },
    });
    bb.events.on("thread.created", run);
  }
`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("plugin uncaught failures", () => {
  let harness: TestAppHarness;
  let observed: Array<{ error: unknown; contained: boolean }>;
  let restoreListeners: () => void;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    observed = [];
    const exceptions = process.listeners("uncaughtException");
    const rejections = process.listeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    const handle = (error: unknown) => {
      observed.push({
        error,
        contained: harness.pluginService.handleUncaughtException(error),
      });
    };
    process.on("uncaughtException", handle);
    process.on("unhandledRejection", handle);
    restoreListeners = () => {
      process.removeListener("uncaughtException", handle);
      process.removeListener("unhandledRejection", handle);
      for (const listener of exceptions)
        process.on("uncaughtException", listener);
      for (const listener of rejections)
        process.on("unhandledRejection", listener);
    };
    const root = join(harness.config.dataDir, "fixture");
    await mkdir(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bb-plugin-uncaught",
        version: "0.1.0",
        bb: {
          name: "Uncaught fixture",
          description: "Error containment",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(root, "server.ts"), fixture);
    expect((await harness.pluginService.installPath(root)).status).toBe(
      "running",
    );
  });

  afterEach(async () => {
    restoreListeners();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  function control(stale: boolean, rejection: boolean, count = 1) {
    const started = deferred();
    const release = deferred();
    vi.stubGlobal("__pluginErrorControl", {
      started: started.resolve,
      release: release.promise,
      stale,
      rejection,
      count,
    });
    return { started: started.promise, release: release.resolve };
  }

  async function invoke(surface: string) {
    const base = "http://127.0.0.1:3334/api/v1/plugins/uncaught";
    if (surface === "event") {
      const { thread } = seedThreadFixture(harness);
      harness.pluginService.events.emitThreadCreated(thread);
      return;
    }
    const response = await harness.app.request(
      `${base}/${surface === "route" ? "http/run" : surface === "rpc" ? "rpc/run" : "cli"}`,
      surface === "route"
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(surface === "rpc" ? null : { argv: [] }),
          },
    );
    expect(response.status).toBe(200);
  }

  it.each([false, true])(
    "contains stale CLI continuations after reload (rejection=%s), once per instance",
    async (rejection) => {
      const warn = vi.spyOn(harness.deps.logger, "warn");
      for (let generation = 0; generation < 2; generation++) {
        const gate = control(true, rejection, 2);
        const request = invoke("cli");
        await gate.started;
        expect((await harness.pluginService.reload("uncaught")).ok).toBe(true);
        gate.release();
        await request;
        await vi.waitFor(() =>
          expect(observed).toHaveLength((generation + 1) * 2),
        );
        expect(observed.every((event) => event.contained)).toBe(true);
        expect(
          harness.pluginService.list().find((p) => p.id === "uncaught")?.status,
        ).toBe("running");
        expect(
          warn.mock.calls.filter((call) =>
            call.some(
              (value) =>
                typeof value === "string" && value.includes("stale API handle"),
            ),
          ),
        ).toHaveLength(generation + 1);
      }
      expect((await harness.app.request("/health")).status).toBe(200);
    },
    20_000,
  );

  it("contains stale handles without async attribution after disable", async () => {
    const api = harness.pluginService.getApi("uncaught");
    expect(api).toBeDefined();
    await harness.pluginService.setEnabled("uncaught", false);
    setImmediate(() => api!.realtime.publish("changed", null));
    await vi.waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]?.contained).toBe(true);
    expect(
      harness.pluginService.list().find((p) => p.id === "uncaught")?.status,
    ).toBe("disabled");
  });

  it.each(["cli", "route", "rpc", "event"])(
    "attributes detached %s failures and degrades only that plugin",
    async (surface) => {
      const gate = control(false, false);
      const request = invoke(surface);
      await gate.started;
      gate.release();
      await request;
      await vi.waitFor(() => expect(observed).toHaveLength(1));
      expect(observed[0]?.contained).toBe(true);
      expect(
        harness.pluginService.list().find((p) => p.id === "uncaught"),
      ).toMatchObject({
        status: "degraded",
        statusDetail: expect.stringContaining("detached plugin failure"),
      });
      expect(
        harness.pluginService.handleUncaughtException(
          new Error("core failure"),
        ),
      ).toBe(false);
    },
  );

  it("does not contain unattributed core failures or errors that merely copy the stale name", () => {
    const fake = new Error("core bug");
    fake.name = "PluginContextStaleError";
    expect(harness.pluginService.handleUncaughtException(fake)).toBe(false);
    expect(
      harness.pluginService.handleUncaughtException("core rejection"),
    ).toBe(false);
  });
});
