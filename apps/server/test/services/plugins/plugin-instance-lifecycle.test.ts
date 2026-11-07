import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createPendingInteraction, getPendingInteraction } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  invokeServerAccessProvider,
  listServerAccessProviders,
} from "../../../src/services/plugins/plugin-server-access-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { seedThreadFixture } from "../../helpers/seed.js";
import {
  startTestServer,
  testLogger,
  type RunningTestServer,
} from "../../helpers/test-app.js";

interface LifecycleControl {
  generation: number;
  threadIds: string[];
  formResults: Array<{ generation: number; result: unknown }>;
  rpcSignals: Array<{ generation: number; aborted: boolean }>;
  cliSignals: Array<{ generation: number; aborted: boolean }>;
  closed: Array<{ generation: number; code: number }>;
  availabilityCalls: number[];
  release: Promise<void>;
  disposeGate: Promise<void>;
  afterRelease: (bb: {
    realtime: { publish(channel: string, payload: unknown): void };
  }) => void;
  coreWork: () => void;
}

declare global {
  var __lifecycle: LifecycleControl | undefined;
}

const fixture = `
  import { defineRpcContract } from "@get-bb/plugin-sdk";
  import { z } from "zod";
  export default function plugin(bb: any) {
    const control = globalThis.__lifecycle;
    control.generation += 1;
    const generation = control.generation;
    const threadId = control.threadIds[generation - 1];
    if (threadId !== undefined) {
      void bb.ui
        .requestInput({ threadId, rendererId: "probe", title: "Probe " + generation, payload: {} })
        .then((result: unknown) => control.formResults.push({ generation, result }));
    }
    bb.rpc.register(
      defineRpcContract({
        wait: { input: z.null(), output: z.number() },
        ping: { input: z.null(), output: z.number() },
      }),
      {
        async wait(_input: null, context: any) {
          await new Promise<void>((resolve) => {
            context.experimental_signal.addEventListener("abort", () => resolve(), { once: true });
            void control.release.then(resolve);
          });
          control.rpcSignals.push({ generation, aborted: context.experimental_signal.aborted });
          return generation;
        },
        ping: () => generation,
      },
    );
    bb.cli.register({
      name: "lifecycle",
      summary: "Fixture",
      async run(argv: string[], ctx: any) {
        if (argv[0] === "plugin-bug") {
          setTimeout(() => {
            throw new Error("plugin timer bug");
          }, 0);
          return { exitCode: 0 };
        }
        if (argv[0] === "core-work") {
          control.coreWork();
          return { exitCode: 0 };
        }
        if (argv[0] === "ping") return { exitCode: 0, stdout: String(generation) };
        await control.release;
        control.cliSignals.push({ generation, aborted: ctx.signal.aborted });
        setTimeout(() => control.afterRelease(bb), 20);
        return { exitCode: 0 };
      },
    });
    bb.http.experimental_websocket(
      "/socket",
      () => ({
        onClose(_socket: any, event: any) {
          control.closed.push({ generation, code: event.code });
        },
      }),
      { auth: "none" },
    );
    bb.experimental_serverAccess.register({
      id: "lifecycle-access",
      displayName: "Lifecycle access",
      description: "Fixture",
      availability() {
        control.availabilityCalls.push(generation);
        return { status: "available" };
      },
      async acquire() {
        return { status: "failed", message: "unused" };
      },
      async release() {},
    });
    bb.onDispose(() => control.disposeGate);
  }
`;

function newControl(): { control: LifecycleControl; release: () => void } {
  let release!: () => void;
  const control: LifecycleControl = {
    generation: 0,
    threadIds: [],
    formResults: [],
    rpcSignals: [],
    cliSignals: [],
    closed: [],
    availabilityCalls: [],
    release: new Promise<void>((resolve) => {
      release = resolve;
    }),
    disposeGate: Promise.resolve(),
    afterRelease: () => {},
    coreWork: () => {},
  };
  return { control, release };
}

async function writeFixture(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "bb-plugin-lifecycle",
      version: "0.1.0",
      bb: {
        name: "Lifecycle fixture",
        description: "Exercises plugin instance ownership.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(root, "server.ts"), fixture);
}

function control(): LifecycleControl {
  const current = globalThis.__lifecycle;
  if (current === undefined) throw new Error("fixture control missing");
  return current;
}

function withUncaughtExceptions(claim: (error: unknown) => boolean): {
  claimed: unknown[];
  unclaimed: unknown[];
  restore(): void;
} {
  const previous = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  const claimed: unknown[] = [];
  const unclaimed: unknown[] = [];
  process.on("uncaughtException", (error) => {
    (claim(error) ? claimed : unclaimed).push(error);
  });
  return {
    claimed,
    unclaimed,
    restore() {
      process.removeAllListeners("uncaughtException");
      for (const listener of previous)
        process.on("uncaughtException", listener);
    },
  };
}

describe("plugin instance lifecycle on a running server", () => {
  let server: RunningTestServer;
  let releaseGate: () => void;
  const sockets = new Set<WebSocket>();

  beforeEach(async () => {
    server = await startTestServer();
    const created = newControl();
    releaseGate = created.release;
    globalThis.__lifecycle = created.control;
    await writeFixture(join(server.config.dataDir, "lifecycle-fixture"));
  });

  afterEach(async () => {
    releaseGate();
    for (const socket of sockets) socket.terminate();
    sockets.clear();
    await server.pluginService.stop();
    await server.close();
    globalThis.__lifecycle = undefined;
  });

  async function install(): Promise<void> {
    const entry = await server.pluginService.installPath(
      join(server.config.dataDir, "lifecycle-fixture"),
    );
    expect(entry.status).toBe("running");
  }

  function callRpc(method: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${server.baseUrl}/api/v1/plugins/lifecycle/rpc/${method}`, {
      method: "POST",
      body: "null",
      headers: { "content-type": "application/json" },
      ...(signal ? { signal } : {}),
    });
  }

  async function openSocket(): Promise<WebSocket> {
    const url = new URL(
      "/api/v1/plugins/lifecycle/http/socket",
      server.baseUrl,
    );
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return socket;
  }

  it("keeps the new instance's startup form when a reload disposes the old one", async () => {
    const first = seedThreadFixture(server, { session: { id: "host-1" } });
    const second = seedThreadFixture(server, { session: { id: "host-2" } });
    control().threadIds = [first.thread.id, second.thread.id];
    await install();
    await expect
      .poll(() =>
        server.deps.pendingInteractions.listPendingThreadInteractions(
          first.thread.id,
        ),
      )
      .toHaveLength(1);

    await server.pluginService.reload("lifecycle");

    await expect
      .poll(() => control().formResults)
      .toEqual([
        {
          generation: 1,
          result: { outcome: "cancelled", reason: "plugin-disposed" },
        },
      ]);
    expect(
      server.deps.pendingInteractions
        .listPendingThreadInteractions(second.thread.id)
        .map((interaction) => interaction.status),
    ).toEqual(["pending"]);
  });

  it("interrupts a plugin's pending rows that have no waiter when it is disabled", async () => {
    const { thread } = seedThreadFixture(server, { session: { id: "host-1" } });
    await install();
    const orphan = createPendingInteraction(server.db, {
      originKind: "plugin",
      pluginId: "lifecycle",
      rendererId: "probe",
      threadId: thread.id,
      turnId: null,
      expiresAt: Date.now() + 60_000,
      payload: JSON.stringify({
        kind: "plugin",
        title: "Left over",
        data: {},
        presentation: {
          label: { pending: "Waiting", completed: "Done" },
          icon: { glyph: "Zap" },
        },
      }),
    });

    await server.pluginService.setEnabled("lifecycle", false);

    expect(getPendingInteraction(server.db, orphan.id)).toMatchObject({
      status: "interrupted",
      statusReason: "plugin-disposed",
    });
  });

  it("aborts an rpc handler's signal when its caller disconnects", async () => {
    await install();
    const caller = new AbortController();
    const pending = callRpc("wait", caller.signal).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));

    caller.abort();

    await expect
      .poll(() => control().rpcSignals)
      .toEqual([{ generation: 1, aborted: true }]);
    await pending;
  });

  it("aborts an in-flight rpc handler's signal at reload and delivers its answer", async () => {
    await install();
    const pending = callRpc("wait");
    await new Promise((resolve) => setTimeout(resolve, 50));

    await server.pluginService.reload("lifecycle");

    expect(await (await pending).json()).toEqual({ ok: true, result: 1 });
    expect(control().rpcSignals).toEqual([{ generation: 1, aborted: true }]);
    releaseGate();
    expect(await (await callRpc("wait")).json()).toEqual({
      ok: true,
      result: 2,
    });
    expect(control().rpcSignals.at(-1)).toEqual({
      generation: 2,
      aborted: false,
    });
  });

  it("keeps serving rpc calls from the old instance while a reload disposes it", async () => {
    await install();
    let openDisposeGate!: () => void;
    control().disposeGate = new Promise<void>((resolve) => {
      openDisposeGate = resolve;
    });

    const reload = server.pluginService.reload("lifecycle");
    await expect.poll(() => control().generation).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const duringDispose = await (await callRpc("ping")).json();
    openDisposeGate();
    await reload;

    expect(duringDispose).toEqual({ ok: true, result: 1 });
    expect(await (await callRpc("ping")).json()).toEqual({
      ok: true,
      result: 2,
    });
  });

  it("runs WebSocket onClose handlers on reload and on disable", async () => {
    await install();
    await openSocket();

    await server.pluginService.reload("lifecycle");

    expect(control().closed).toEqual([{ generation: 1, code: 1012 }]);
    await openSocket();

    await server.pluginService.setEnabled("lifecycle", false);

    expect(control().closed).toEqual([
      { generation: 1, code: 1012 },
      { generation: 2, code: 1012 },
    ]);
  });

  it("runs a provider callback only on the instance that registered it", async () => {
    await install();
    const [fromFirst] = listServerAccessProviders();
    if (fromFirst === undefined) throw new Error("provider not registered");

    await server.pluginService.reload("lifecycle");

    await expect(
      invokeServerAccessProvider(fromFirst, async () =>
        fromFirst.provider.availability(),
      ),
    ).rejects.toThrow();
    expect(control().availabilityCalls).toEqual([]);
    const [fromSecond] = listServerAccessProviders();
    if (fromSecond === undefined) throw new Error("provider not registered");
    await expect(
      invokeServerAccessProvider(fromSecond, async () =>
        fromSecond.provider.availability(),
      ),
    ).resolves.toEqual({ status: "available" });
    expect(control().availabilityCalls).toEqual([2]);
  });
});

describe("plugin instance lifecycle without cooperation", () => {
  let workDir: string;
  let releaseGate: () => void;
  let service: PluginService;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-lifecycle-"));
    const created = newControl();
    releaseGate = created.release;
    globalThis.__lifecycle = created.control;
    await writeFixture(join(workDir, "lifecycle"));
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db: createMigratedConnection(),
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger: testLogger as unknown as Logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 5_000,
      serviceStopTimeoutMs: 100,
    });
    await service.installPath(join(workDir, "lifecycle"));
  });

  afterEach(async () => {
    releaseGate();
    await service.stop();
    globalThis.__lifecycle = undefined;
    await rm(workDir, { recursive: true, force: true });
  });

  function status() {
    return service.list().find((plugin) => plugin.id === "lifecycle");
  }

  it("releases a caller the old instance never answers and contains its later stale-handle use", async () => {
    const uncaught = withUncaughtExceptions((error) =>
      service.handleUncaughtException(error),
    );
    control().afterRelease = (bb) => bb.realtime.publish("changed", null);
    try {
      const command = service.runCliCommand("lifecycle", [], {});
      await new Promise((resolve) => setTimeout(resolve, 50));

      await service.reload("lifecycle");

      expect(await command).toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("was reloaded or disabled"),
      });
      expect(
        await service.runCliCommand("lifecycle", ["ping"], {}),
      ).toMatchObject({ exitCode: 0, stdout: "2" });
      releaseGate();
      await expect.poll(() => uncaught.claimed).toHaveLength(1);
      expect(uncaught.claimed[0]).toMatchObject({
        name: "PluginContextStaleError",
      });
      expect(uncaught.unclaimed).toEqual([]);
      expect(control().cliSignals).toEqual([{ generation: 1, aborted: true }]);
      expect(status()).toMatchObject({ status: "running" });
    } finally {
      uncaught.restore();
    }
  });

  it("contains an uncaught error from plugin code and keeps the plugin running", async () => {
    const uncaught = withUncaughtExceptions((error) =>
      service.handleUncaughtException(error),
    );
    try {
      await service.runCliCommand("lifecycle", ["plugin-bug"], {});

      await expect.poll(() => uncaught.claimed).toHaveLength(1);
      expect(uncaught.unclaimed).toEqual([]);
      expect(status()).toMatchObject({
        status: "running",
        statusDetail: expect.stringContaining("plugin timer bug"),
      });
    } finally {
      uncaught.restore();
    }
  });

  it("does not claim errors from core work started during a plugin call", async () => {
    const results: boolean[] = [];
    control().coreWork = () => {
      setTimeout(() => {
        results.push(service.handleUncaughtException(new Error("core bug")));
      }, 0);
    };

    await service.runCliCommand("lifecycle", ["core-work"], {});

    await expect.poll(() => results).toEqual([false]);
    expect(status()).toMatchObject({ status: "running", statusDetail: null });
  });
});
