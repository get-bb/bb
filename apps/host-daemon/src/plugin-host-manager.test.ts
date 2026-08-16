import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDaemonOnlineRpcCommand } from "@bb/host-daemon-contract";
import type { WatchPathRootArgs } from "@bb/host-watcher";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginHostManager,
  pluginHostProcessEnv,
} from "./plugin-host-manager.js";

type PluginCall = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "plugin.host.call" }
>;

const artifactSource = Buffer.from(`
const anySchema = { "~standard": { validate(value) { return { value }; } } };
const stringSchema = { "~standard": { validate(value) { return typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] }; } } };
let lastPaths;
export default {
  experimental_apiVersion: 1,
  contract: {
    methods: {
      echo: { target: { kind: "host" }, input: anySchema, output: anySchema },
      wait: { target: { kind: "host" }, input: anySchema, output: anySchema },
      delayedAbort: { target: { kind: "host" }, input: anySchema, output: anySchema },
      rememberPaths: { target: { kind: "host" }, input: anySchema, output: anySchema },
      crash: { target: { kind: "host" }, input: anySchema, output: anySchema },
      stringEcho: { target: { kind: "host" }, input: stringSchema, output: stringSchema },
      invalidOutput: { target: { kind: "host" }, input: anySchema, output: stringSchema },
      large: { target: { kind: "host" }, input: anySchema, output: anySchema },
      watch: { target: { kind: "host" }, input: anySchema, output: anySchema },
    },
    signals: { changed: { target: "host", payload: anySchema } },
  },
  handlers: {
    echo(input, context) {
      return { input, pid: process.pid, target: context.target, cwd: context.cwd };
    },
    wait(_input, context) {
      context.signals.publish("changed", { reason: "waiting" });
      return new Promise((resolve) => {
        context.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
      });
    },
    delayedAbort(_input, context) {
      context.signals.publish("changed", { reason: "delaying" });
      return new Promise((resolve) => {
        context.signal.addEventListener(
          "abort",
          () => setTimeout(() => resolve({ aborted: true }), 100),
          { once: true },
        );
      });
    },
    rememberPaths(_input, context) {
      lastPaths = context.paths;
      context.signals.publish("changed", { reason: "test" });
      return context.paths;
    },
    crash() { process.exit(17); },
    stringEcho(input) { return input; },
    invalidOutput() { return { nope: true }; },
    large() { return "x".repeat(8 * 1024 * 1024); },
    async watch(input, context) {
      await context.experimental_watch(
        {
          rootPath: input.rootPath,
          ignoredPaths: [],
          debounceMs: 75,
          maxWaitMs: 500,
        },
        async (event) => {
          context.signals.publish("changed", event);
          if (input.listenerDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, input.listenerDelayMs));
          }
        },
      );
      return { watching: true };
    },
  },
  async dispose() {
    if (lastPaths) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(lastPaths.dataDir + "/disposed", "yes");
    }
  },
};
`);

function callCommand(overrides: Partial<PluginCall> = {}): PluginCall {
  return {
    type: "plugin.host.call",
    pluginId: "fixture",
    generation: "generation-1",
    artifact: {
      digest: createHash("sha256").update(artifactSource).digest("hex"),
      byteLength: artifactSource.byteLength,
    },
    callId: randomUUID(),
    method: "echo",
    input: { value: "hello" },
    target: { kind: "host" },
    scheduling: null,
    deadlineUnixMs: Date.now() + 10_000,
    ...overrides,
  };
}

describe("PluginHostManager", () => {
  const tempDirs: string[] = [];
  const managers: PluginHostManager[] = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function createManager(
    overrides: Partial<ConstructorParameters<typeof PluginHostManager>[0]> = {},
  ): Promise<PluginHostManager> {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-plugin-host-test-"));
    tempDirs.push(dataDir);
    const manager = new PluginHostManager({
      dataDir,
      hostId: "host-1",
      logger: { debug: vi.fn(), warn: vi.fn() },
      fetchArtifact: vi.fn(async () => artifactSource),
      ...overrides,
    });
    managers.push(manager);
    return manager;
  }

  it("verifies, caches, and reuses one worker for an artifact generation", async () => {
    const fetchArtifact = vi.fn(async () => artifactSource);
    const manager = await createManager({ fetchArtifact });

    const first = await manager.call(callCommand(), null);
    const second = await manager.call(callCommand(), null);

    expect(first.output).toMatchObject({
      input: { value: "hello" },
      target: { kind: "host", hostId: "host-1" },
      cwd: null,
    });
    expect(Reflect.get(Object(first.output), "pid")).toBe(
      Reflect.get(Object(second.output), "pid"),
    );
    expect(fetchArtifact).toHaveBeenCalledTimes(1);
  });

  it("bounds the verified artifact cache across development generations", async () => {
    const sources = Array.from({ length: 10 }, (_, index) =>
      Buffer.concat([
        artifactSource,
        Buffer.from(`\n// generation ${index}\n`),
      ]),
    );
    const sourceByDigest = new Map(
      sources.map((source) => [
        createHash("sha256").update(source).digest("hex"),
        source,
      ]),
    );
    const manager = await createManager({
      fetchArtifact: async ({ digest }) => {
        const source = sourceByDigest.get(digest);
        if (source === undefined) throw new Error("unknown fixture digest");
        return source;
      },
    });
    const dataDir = tempDirs.at(-1);
    if (dataDir === undefined) throw new Error("missing manager data dir");

    for (const [index, source] of sources.entries()) {
      await manager.call(
        callCommand({
          generation: `generation-${index}`,
          artifact: {
            digest: createHash("sha256").update(source).digest("hex"),
            byteLength: source.byteLength,
          },
        }),
        null,
      );
    }

    const cached = await readdir(
      join(dataDir, "plugin-host-artifacts", "fixture"),
    );
    const lastSource = sources.at(-1);
    if (lastSource === undefined) throw new Error("missing fixture source");
    expect(cached).toHaveLength(8);
    expect(cached).toContain(
      createHash("sha256").update(lastSource).digest("hex"),
    );
  });

  it("serializes concurrent startup so one generation gets one worker", async () => {
    const fetchArtifact = vi.fn(async () => artifactSource);
    const manager = await createManager({ fetchArtifact });

    const [first, second] = await Promise.all([
      manager.call(callCommand(), null),
      manager.call(callCommand(), null),
    ]);

    expect(Reflect.get(Object(first.output), "pid")).toBe(
      Reflect.get(Object(second.output), "pid"),
    );
    expect(fetchArtifact).toHaveBeenCalledOnce();
  });

  it("rejects artifact bytes that do not match the server digest", async () => {
    const manager = await createManager({
      fetchArtifact: async () => Buffer.from("tampered"),
    });

    await expect(manager.call(callCommand(), null)).rejects.toThrow(
      /artifact length mismatch/u,
    );
  });

  it("rejects an invalid artifact without leaking a closed-IPC error", async () => {
    const invalidArtifact = Buffer.from("export default {};\n");
    const manager = await createManager({
      fetchArtifact: async () => invalidArtifact,
    });

    await expect(
      manager.call(
        callCommand({
          artifact: {
            digest: createHash("sha256").update(invalidArtifact).digest("hex"),
            byteLength: invalidArtifact.byteLength,
          },
        }),
        null,
      ),
    ).rejects.toThrow(/must default-export/u);
  });

  it("enforces worker-side input, output, target, and result limits", async () => {
    const manager = await createManager();

    await expect(
      manager.call(callCommand({ method: "stringEcho", input: 42 }), null),
    ).rejects.toThrow(/expected string/u);
    await expect(
      manager.call(callCommand({ method: "invalidOutput" }), null),
    ).rejects.toThrow(/expected string/u);
    await expect(
      manager.call(callCommand({ method: "echo", scheduling: "shared" }), null),
    ).rejects.toThrow(/target or scheduling does not match/u);
    await expect(
      manager.call(callCommand({ method: "large" }), null),
    ).rejects.toThrow(/result exceeds 8388608 bytes/u);
  });

  it("cancels a call while its worker is starting or running", async () => {
    const manager = await createManager();
    const command = callCommand({ method: "wait" });
    const result = manager.call(command, null);

    expect(
      manager.cancel({
        type: "plugin.host.cancel",
        pluginId: command.pluginId,
        generation: command.generation,
        callId: command.callId,
      }),
    ).toEqual({ cancelled: true });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a dispatched call when it is cancelled", async () => {
    const onSignal = vi.fn();
    const manager = await createManager({ onSignal });
    await manager.call(callCommand(), null);
    const command = callCommand({ method: "wait" });
    const result = manager.call(command, null);
    await vi.waitFor(() => expect(onSignal).toHaveBeenCalled());

    expect(
      manager.cancel({
        type: "plugin.host.cancel",
        pluginId: command.pluginId,
        generation: command.generation,
        callId: command.callId,
      }),
    ).toEqual({ cancelled: true });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not reuse a cancelled in-flight call id", async () => {
    const onSignal = vi.fn();
    const manager = await createManager({ onSignal });
    await manager.call(callCommand(), null);
    const command = callCommand({ method: "delayedAbort" });
    const result = manager.call(command, null);
    await vi.waitFor(() => expect(onSignal).toHaveBeenCalled());
    expect(
      manager.cancel({
        type: "plugin.host.cancel",
        pluginId: command.pluginId,
        generation: command.generation,
        callId: command.callId,
      }),
    ).toEqual({ cancelled: true });
    await expect(manager.call(command, null)).rejects.toThrow(
      /duplicate host plugin call/u,
    );
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects at the daemon deadline even when the handler cooperates", async () => {
    const manager = await createManager();
    await manager.call(callCommand(), null);

    await expect(
      manager.call(
        callCommand({
          method: "wait",
          deadlineUnixMs: Date.now() + 20,
        }),
        null,
      ),
    ).rejects.toThrow(/exceeded its deadline/u);
  });

  it("does not fetch or start an artifact for an already-expired call", async () => {
    const fetchArtifact = vi.fn(async () => artifactSource);
    const manager = await createManager({ fetchArtifact });

    await expect(
      manager.call(callCommand({ deadlineUnixMs: Date.now() - 1 }), null),
    ).rejects.toThrow(/reached its deadline before dispatch/u);
    expect(fetchArtifact).not.toHaveBeenCalled();
  });

  it("forwards validated signals and disposes generation-owned resources", async () => {
    const onSignal = vi.fn();
    const manager = await createManager({ onSignal });
    const command = callCommand({ method: "rememberPaths" });
    const result = await manager.call(command, null);
    const paths = result.output as { dataDir: string };

    await vi.waitFor(() => expect(onSignal).toHaveBeenCalledOnce());
    expect(onSignal).toHaveBeenCalledWith({
      pluginId: "fixture",
      generation: "generation-1",
      signal: "changed",
      payload: { reason: "test" },
      target: { kind: "host", hostId: "host-1" },
    });
    await expect(
      manager.dispose({
        type: "plugin.host.dispose",
        pluginId: command.pluginId,
        generation: command.generation,
      }),
    ).resolves.toEqual({ disposed: true });
    await expect(
      readFile(join(paths.dataDir, "disposed"), "utf8"),
    ).resolves.toBe("yes");
  });

  it("backs pressured watch delivery and disposes native watches with the generation", async () => {
    const onSignal = vi.fn();
    const stop = vi.fn(async () => undefined);
    let watcher: WatchPathRootArgs | undefined;
    const manager = await createManager({
      onSignal,
      hostWatcher: {
        watchPathRoot(args) {
          watcher = args;
          return stop;
        },
      },
    });
    const command = callCommand({
      method: "watch",
      input: { rootPath: "/tmp/workspace", listenerDelayMs: 150 },
    });
    const call = manager.call(command, null);
    await vi.waitFor(() => expect(watcher).toBeDefined());
    watcher?.onReady();
    await expect(call).resolves.toEqual({ output: { watching: true } });

    watcher?.onChange([{ path: "/tmp/workspace/a", type: "update" }]);
    await vi.waitFor(() => expect(onSignal).toHaveBeenCalledTimes(1));
    watcher?.onChange([{ path: "/tmp/workspace/b", type: "create" }]);
    watcher?.onChange([{ path: "/tmp/workspace/c", type: "delete" }]);

    await vi.waitFor(() => expect(onSignal).toHaveBeenCalledTimes(2));
    expect(onSignal.mock.calls[1]?.[0]).toMatchObject({
      payload: {
        kind: "changed",
        changes: expect.arrayContaining([
          { path: "/tmp/workspace/b", type: "create" },
          { path: "/tmp/workspace/c", type: "delete" },
        ]),
      },
    });

    await manager.dispose({
      type: "plugin.host.dispose",
      pluginId: command.pluginId,
      generation: command.generation,
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("restarts after a crash and replaces stale generations", async () => {
    const manager = await createManager();
    const first = await manager.call(callCommand(), null);
    const firstPid = Reflect.get(Object(first.output), "pid");

    await expect(
      manager.call(callCommand({ method: "crash" }), null),
    ).rejects.toThrow(/worker exited/u);
    const afterCrash = await manager.call(callCommand(), null);
    expect(Reflect.get(Object(afterCrash.output), "pid")).not.toBe(firstPid);

    const replacement = await manager.call(
      callCommand({ generation: "generation-2" }),
      null,
    );
    expect(Reflect.get(Object(replacement.output), "pid")).not.toBe(
      Reflect.get(Object(afterCrash.output), "pid"),
    );

    await expect(
      manager.call(callCommand({ generation: "generation-1" }), null),
    ).rejects.toThrow(/generation generation-1 is retired/u);
  });

  it("retires a disposed generation before its first worker starts", async () => {
    const fetchArtifact = vi.fn(async () => artifactSource);
    const manager = await createManager({ fetchArtifact });

    await expect(
      manager.dispose({
        type: "plugin.host.dispose",
        pluginId: "fixture",
        generation: "generation-1",
      }),
    ).resolves.toEqual({ disposed: false });
    await expect(manager.call(callCommand(), null)).rejects.toThrow(
      /generation generation-1 is retired/u,
    );
    expect(fetchArtifact).not.toHaveBeenCalled();
  });

  it("rejects a changed digest within one generation", async () => {
    const manager = await createManager();
    await manager.call(callCommand(), null);

    await expect(
      manager.call(
        callCommand({
          artifact: { digest: "a".repeat(64), byteLength: 123 },
        }),
        null,
      ),
    ).rejects.toThrow(/changed artifact digest/u);
  });

  it("reconciles stale workers against the server snapshot after reconnect", async () => {
    const manager = await createManager();
    const first = await manager.call(callCommand(), null);
    const firstPid = Reflect.get(Object(first.output), "pid");

    await manager.reconcileGenerations([
      { pluginId: "fixture", generation: "generation-1" },
    ]);
    const retained = await manager.call(callCommand(), null);
    expect(Reflect.get(Object(retained.output), "pid")).toBe(firstPid);

    await manager.reconcileGenerations([]);
    await expect(manager.call(callCommand(), null)).rejects.toThrow(
      /generation generation-1 is retired/u,
    );
    const replacement = await manager.call(
      callCommand({ generation: "generation-2" }),
      null,
    );
    expect(Reflect.get(Object(replacement.output), "pid")).not.toBe(firstPid);
  });
});

describe("pluginHostProcessEnv", () => {
  it("uses the normalized PATH without forwarding daemon BB variables", () => {
    expect(
      pluginHostProcessEnv(
        {
          HOME: "/Users/test",
          PATH: "/usr/bin",
          GH_TOKEN: "user-token",
          BB_CONNECT_MACHINE_CREDENTIAL: "daemon-secret",
          BB_SERVER_URL: "http://daemon.internal",
        },
        { PATH: "/Users/test/bin:/usr/bin", BB_CLI: "/bb/bin/bb" },
      ),
    ).toEqual({
      HOME: "/Users/test",
      PATH: "/Users/test/bin:/usr/bin",
      GH_TOKEN: "user-token",
    });
  });
});
