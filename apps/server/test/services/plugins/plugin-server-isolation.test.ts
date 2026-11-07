import { execFile } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginService } from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import {
  startTestServer,
  testLogger,
  type RunningTestServer,
} from "../../helpers/test-app.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await run("git", args, { cwd });
}

async function writeGitPlugin(
  workDir: string,
  name: string,
  serverSource: string,
): Promise<string> {
  const repoDir = join(workDir, name);
  await mkdir(repoDir, { recursive: true });
  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${name}`,
      version: "0.1.0",
      bb: {
        name: `Isolation ${name}`,
        description: "Plugin server isolation fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(repoDir, "server.ts"), serverSource);
  await git(repoDir, ["init", "-q", "-b", "main"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test"]);
  await git(repoDir, ["add", "-A"]);
  await git(repoDir, ["commit", "-qm", "init"]);
  return `git:${repoDir}`;
}

const THREAD_ID_SOURCE = `
import { threadId } from "node:worker_threads";
const schema = (check: (value: any) => boolean) => ({
  "~standard": {
    version: 1,
    vendor: "fixture",
    validate: (value: unknown) =>
      check(value) ? { value } : { issues: [{ message: "invalid value" }] },
  },
});
const any = schema(() => true);
const isNumber = schema((value) => typeof value === "number");
const isNull = schema((value) => value === null);
const addInput = schema((value) => typeof value?.add === "number");
const msInput = schema((value) => typeof value?.ms === "number");
`;

const FULL_PLUGIN = `${THREAD_ID_SOURCE}

export default function plugin(bb: any) {
  const settings = bb.settings.define({
    greeting: { type: "string", label: "Greeting", default: "hello" },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, ["CREATE TABLE ticks (n INTEGER NOT NULL)"]);
  let serviceSignal: AbortSignal | null = null;
  bb.background.service("ticker", {
    async start(signal: AbortSignal) {
      serviceSignal = signal;
      db.prepare("INSERT INTO ticks (n) VALUES (?)").run(1);
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  });
  bb.rpc.register(
    {
      whereAmI: { input: addInput, output: any, invalidates: () => ["where"] },
      refuse: { input: isNull, output: isNull },
      big: { input: isNull, output: any },
      viaSdk: { input: isNull, output: any },
    },
    {
      async whereAmI(input: { add: number }, context: any) {
        const ticks = db.prepare("SELECT COUNT(*) AS n FROM ticks").get().n;
        const values = await settings.get();
        return {
          threadId,
          ticks,
          sum: input.add + 1,
          greeting: values.greeting,
          caller: context.experimental_caller,
        };
      },
      refuse() {
        const error: any = new Error("nope");
        error.code = "forbidden";
        error[Symbol.for("@get-bb/plugin-sdk/rpc-refusal")] = true;
        throw error;
      },
      big() {
        return Array.from({ length: 20_000 }, (_, i) => ({ i }));
      },
      async viaSdk() {
        return bb.sdk.plugins.callRpc({
          pluginId: bb.pluginId,
          method: "whereAmI",
          input: { add: 41 },
          outputSchema: { parse: (value: unknown) => value },
        });
      },
    },
  );
  bb.http.route("POST", "/echo", async (c: any) => {
    const body = await c.req.json();
    return c.json({ threadId, body, query: c.req.query("q") ?? null });
  });
  bb.http.route("GET", "/service-signal", (c: any) =>
    c.json({ aborted: serviceSignal?.aborted ?? null }),
  );
  bb.log.info("isolation fixture loaded");
}
`;

async function callRpc(
  server: RunningTestServer,
  pluginId: string,
  method: string,
  input: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${server.baseUrl}/api/v1/plugins/${pluginId}/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("plugin server isolation", { timeout: 60_000 }, () => {
  let server: RunningTestServer;
  let workDir: string;

  beforeEach(async () => {
    server = await startTestServer();
    server.pluginService.bindSdk({ baseUrl: server.baseUrl });
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-isolation-"));
  });

  afterEach(async () => {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  });

  async function install(name: string, source: string, isolated: boolean) {
    setExperiments(server.db, { isolatedPluginServers: isolated });
    const gitSource = await writeGitPlugin(workDir, name, source);
    return server.pluginService.install(gitSource, { kind: "root" });
  }

  it.each([
    { isolated: true, inWorker: true },
    { isolated: false, inWorker: false },
  ])(
    "serves rpc, http, storage, settings, services and sdk calls (experiment $isolated)",
    async ({ isolated, inWorker }) => {
      const entry = await install("full", FULL_PLUGIN, isolated);
      expect(entry).toMatchObject({ status: "running" });
      await expect
        .poll(async () => {
          const result = await callRpc(server, "full", "whereAmI", { add: 1 });
          return (result.body as { result?: { ticks?: number } }).result
            ?.ticks;
        })
        .toBe(1);

      const where = await callRpc(server, "full", "whereAmI", { add: 1 });
      expect(where.status).toBe(200);
      expect(where.body).toEqual({
        ok: true,
        result: {
          threadId: expect.any(Number),
          ticks: 1,
          sum: 2,
          greeting: "hello",
          caller: { kind: "client" },
        },
      });
      const threadId = (where.body as { result: { threadId: number } }).result
        .threadId;
      expect(threadId !== 0).toBe(inWorker);

      const invalid = await callRpc(server, "full", "whereAmI", { add: "x" });
      expect(invalid.body).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
      const refused = await callRpc(server, "full", "refuse", null);
      expect(refused.body).toMatchObject({
        ok: false,
        error: { code: "forbidden", message: "nope" },
      });
      const big = await callRpc(server, "full", "big", null);
      expect((big.body as { result: unknown[] }).result).toHaveLength(20_000);

      const viaSdk = await callRpc(server, "full", "viaSdk", null);
      expect(viaSdk.body).toMatchObject({
        ok: true,
        result: {
          threadId,
          sum: 42,
          caller: { kind: "plugin", pluginId: "full" },
        },
      });

      const echo = await fetch(
        `${server.baseUrl}/api/v1/plugins/full/http/echo?q=1`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hello: "world" }),
        },
      );
      expect(await echo.json()).toEqual({
        threadId,
        body: { hello: "world" },
        query: "1",
      });

      const log = await readFile(
        join(server.config.dataDir, "plugins", "full", "logs", "plugin.log"),
        "utf8",
      );
      expect(log).toContain("isolation fixture loaded");

      await server.pluginService.setEnabled("full", false);
      expect(
        server.pluginService.list().find((plugin) => plugin.id === "full"),
      ).toMatchObject({ status: "disabled" });
      await server.pluginService.setEnabled("full", true);
      const afterEnable = await callRpc(server, "full", "whereAmI", { add: 1 });
      expect(
        (afterEnable.body as { result: { ticks: number } }).result.ticks,
      ).toBeGreaterThanOrEqual(1);
    },
  );

  it("streams http responses and aborts the handler signal when the client disconnects", async () => {
    await install(
      "stream",
      `export default function plugin(bb: any) {
        const state = { entered: false, returned: false, aborted: null as boolean | null, cancelled: false };
        let finish: () => void = () => {};
        const pending = new Promise<void>((resolve) => { finish = resolve; });
        bb.http.route("GET", "/stream", async (context: any) => {
          state.entered = true;
          await pending;
          state.aborted = context.req.raw.signal.aborted;
          state.returned = true;
          return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
            cancel() { state.cancelled = true; },
          }), { headers: { "content-type": "text/event-stream" } });
        });
        bb.http.route("GET", "/state", (context: any) => context.json(state));
        bb.http.route("GET", "/finish", (context: any) => { finish(); return context.text("released"); });
      }`,
      true,
    );
    const readState = async () =>
      (
        await fetch(`${server.baseUrl}/api/v1/plugins/stream/http/state`)
      ).json();
    const client = request(`${server.baseUrl}/api/v1/plugins/stream/http/stream`);
    client.on("error", () => undefined);
    client.end();
    try {
      await expect.poll(readState).toMatchObject({ entered: true });
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fetch(`${server.baseUrl}/api/v1/plugins/stream/http/finish`);
      await expect.poll(readState).toMatchObject({ returned: true });
      expect(await readState()).toMatchObject({ aborted: true });
      await expect
        .poll(readState, { timeout: 2_000 })
        .toMatchObject({ cancelled: true });
    } finally {
      client.destroy();
    }

    const streamed = request(
      `${server.baseUrl}/api/v1/plugins/stream/http/stream`,
    );
    streamed.end();
    const [response] = (await once(streamed, "response")) as [
      import("node:http").IncomingMessage,
    ];
    const [chunk] = (await once(response, "data")) as [Buffer];
    expect(chunk.toString()).toBe("first");
    streamed.destroy();
  });

  it("keeps core's event loop responsive while a plugin handler blocks its own thread", async () => {
    await install(
      "busy",
      `${THREAD_ID_SOURCE}
      export default function plugin(bb: any) {
        bb.rpc.register(
          { spin: { input: msInput, output: isNumber } },
          {
            spin({ ms }: { ms: number }) {
              const until = Date.now() + ms;
              let spins = 0;
              while (Date.now() < until) spins += 1;
              return spins;
            },
          },
        );
      }`,
      true,
    );
    const call = callRpc(server, "busy", "spin", { ms: 600 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ticks: number[] = [];
    const started = Date.now();
    while (Date.now() - started < 300) {
      const before = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 10));
      ticks.push(performance.now() - before);
    }
    expect(Math.max(...ticks)).toBeLessThan(200);
    expect((await call).body).toMatchObject({ ok: true });
  });

  it("restarts a plugin whose server worker exits and keeps core running", async () => {
    await install(
      "crashy",
      `${THREAD_ID_SOURCE}
      export default function plugin(bb: any) {
        bb.http.route("GET", "/thread", (c: any) => c.json({ threadId }));
        bb.http.route("GET", "/exit", () => { process.exit(3); });
      }`,
      true,
    );
    const first = await (
      await fetch(`${server.baseUrl}/api/v1/plugins/crashy/http/thread`)
    ).json();
    const crashed = await fetch(
      `${server.baseUrl}/api/v1/plugins/crashy/http/exit`,
    );
    expect(crashed.status).toBe(500);
    expect(await crashed.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("exited with code 3"),
    });
    await expect
      .poll(
        () =>
          server.pluginService.list().find((plugin) => plugin.id === "crashy")
            ?.status,
        { timeout: 10_000 },
      )
      .toBe("running");
    const second = await (
      await fetch(`${server.baseUrl}/api/v1/plugins/crashy/http/thread`)
    ).json();
    expect(second.threadId).not.toBe(first.threadId);
  });

  it("restarts a background service that throws an uncaught error in its worker", async () => {
    await install(
      "uncaught",
      `export default function plugin(bb: any) {
        let starts = 0;
        bb.background.service("flaky", {
          start(signal: AbortSignal) {
            starts += 1;
            if (starts === 1) setTimeout(() => { throw new Error("boom"); }, 10);
            return new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
          },
        });
        bb.http.route("GET", "/starts", (c: any) => c.json({ starts }));
      }`,
      true,
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await fetch(`${server.baseUrl}/api/v1/plugins/uncaught/http/starts`)
            ).json()
          ).starts,
        { timeout: 10_000 },
      )
      .toBe(2);
    expect(
      server.pluginService.list().find((plugin) => plugin.id === "uncaught"),
    ).toMatchObject({ status: "running" });
  });

  it("times out a factory that never returns without blocking core", async () => {
    setExperiments(server.db, { isolatedPluginServers: true });
    const service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db: server.db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger: testLogger as unknown as Logger,
      dataDir: join(workDir, "timeout-data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 1_000,
    });
    try {
      const source = await writeGitPlugin(
        workDir,
        "hang",
        `export default function plugin() { while (true) {} }`,
      );
      const installing = service.install(source, { kind: "root" });
      const lags: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const before = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 20));
        lags.push(performance.now() - before);
      }
      expect(Math.max(...lags)).toBeLessThan(500);
      await expect(installing).resolves.toMatchObject({
        status: "error",
        statusDetail: expect.stringContaining("load timed out"),
      });
    } finally {
      await service.stop();
    }
  });

  it("closes the worker's database before uninstall removes its data", async () => {
    await install(
      "removable",
      `export default function plugin(bb: any) {
        const db = bb.storage.database();
        bb.storage.migrate(db, ["CREATE TABLE t (v TEXT)"]);
        db.prepare("INSERT INTO t (v) VALUES ('x')").run();
      }`,
      true,
    );
    const dataDir = join(server.config.dataDir, "plugins", "removable");
    expect(existsSync(join(dataDir, "data.db-wal"))).toBe(true);
    await expect(server.pluginService.remove("removable")).resolves.toBe(true);
    expect(existsSync(join(dataDir, "data.db-wal"))).toBe(false);
  });

  it("loads a plugin that uses an API the worker lacks in-process instead", async () => {
    const entry = await install(
      "tooling",
      `${THREAD_ID_SOURCE}
      export default function plugin(bb: any) {
        bb.agents.registerTool({
          name: "tooling_echo",
          description: "Echo",
          parameters: { type: "object", properties: {} },
          execute: () => "ok",
        });
        bb.http.route("GET", "/thread", (c: any) => c.json({ threadId }));
      }`,
      true,
    );
    expect(entry).toMatchObject({ status: "running" });
    const response = await (
      await fetch(`${server.baseUrl}/api/v1/plugins/tooling/http/thread`)
    ).json();
    expect(response.threadId).toBe(0);
  });

  it("moves running marketplace plugins between core and workers when the experiment changes", async () => {
    await install(
      "toggled",
      `${THREAD_ID_SOURCE}
      export default function plugin(bb: any) {
        bb.http.route("GET", "/thread", (c: any) => c.json({ threadId }));
      }`,
      false,
    );
    const readThread = async () =>
      (
        await (
          await fetch(`${server.baseUrl}/api/v1/plugins/toggled/http/thread`)
        ).json()
      ).threadId;
    expect(await readThread()).toBe(0);
    const setExperiment = (value: boolean) =>
      fetch(`${server.baseUrl}/api/v1/settings/experiments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isolatedPluginServers: value }),
      });
    expect((await setExperiment(true)).status).toBe(200);
    await expect.poll(readThread).not.toBe(0);
    expect((await setExperiment(false)).status).toBe(200);
    await expect.poll(readThread).toBe(0);
  });

  it("gives a worker plugin the same API surface as an in-process one", async () => {
    const walker = `${THREAD_ID_SOURCE}
      function walk(value: any, prefix: string, out: string[], seen: Set<unknown>) {
        if (seen.has(value)) return;
        seen.add(value);
        for (const key of Object.keys(value).sort()) {
          if (key === "sdk") { out.push(prefix + key); continue; }
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          if (descriptor.get) { out.push(prefix + key + ":get"); continue; }
          const member = descriptor.value;
          if (typeof member === "function") out.push(prefix + key + "()");
          else if (typeof member === "object" && member !== null) walk(member, prefix + key + ".", out, seen);
          else out.push(prefix + key);
        }
      }
      export default function plugin(bb: any) {
        const shape: string[] = [];
        walk(bb, "", shape, new Set());
        bb.http.route("GET", "/shape", (c: any) => c.json({ threadId, shape }));
      }`;
    await install("shape-worker", walker, true);
    await install("shape-core", walker, false);
    const worker = await (
      await fetch(`${server.baseUrl}/api/v1/plugins/shape-worker/http/shape`)
    ).json();
    const core = await (
      await fetch(`${server.baseUrl}/api/v1/plugins/shape-core/http/shape`)
    ).json();
    expect(worker.threadId).not.toBe(0);
    expect(core.threadId).toBe(0);
    expect(worker.shape).toEqual(core.shape);
  });
});
