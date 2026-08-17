import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDaemonOnlineRpcCommand } from "@bb/host-daemon-contract";
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
export default {
  experimental_apiVersion: 1,
  contract: {
    echo: { input: anySchema, output: anySchema },
    wait: { input: anySchema, output: anySchema },
    crash: { input: anySchema, output: anySchema },
    stringEcho: { input: stringSchema, output: stringSchema },
    invalidOutput: { input: anySchema, output: stringSchema },
    large: { input: anySchema, output: anySchema },
  },
  handlers: {
    echo(input) { return { input, pid: process.pid }; },
    wait(_input, context) {
      return new Promise((resolve) => {
        context.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
      });
    },
    crash() { process.exit(17); },
    stringEcho(input) { return input; },
    invalidOutput() { return { nope: true }; },
    large() { return "x".repeat(8 * 1024 * 1024); },
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

    const [first, second] = await Promise.all([
      manager.call(callCommand()),
      manager.call(callCommand()),
    ]);

    expect(first.output).toMatchObject({ input: { value: "hello" } });
    expect(Reflect.get(Object(first.output), "pid")).toBe(
      Reflect.get(Object(second.output), "pid"),
    );
    expect(fetchArtifact).toHaveBeenCalledOnce();
  });

  it("rejects unverified or invalid artifacts", async () => {
    const tampered = await createManager({
      fetchArtifact: async () => Buffer.from("tampered"),
    });
    await expect(tampered.call(callCommand())).rejects.toThrow(
      /artifact length mismatch/u,
    );

    const invalidArtifact = Buffer.from("export default {};\n");
    const invalid = await createManager({
      fetchArtifact: async () => invalidArtifact,
    });
    await expect(
      invalid.call(
        callCommand({
          artifact: {
            digest: createHash("sha256")
              .update(invalidArtifact)
              .digest("hex"),
            byteLength: invalidArtifact.byteLength,
          },
        }),
      ),
    ).rejects.toThrow(/valid host entry/u);
  });

  it("enforces worker-side input, output, and result limits", async () => {
    const manager = await createManager();

    await expect(
      manager.call(callCommand({ method: "stringEcho", input: 42 })),
    ).rejects.toThrow(/expected string/u);
    await expect(
      manager.call(callCommand({ method: "invalidOutput" })),
    ).rejects.toThrow(/expected string/u);
    await expect(
      manager.call(callCommand({ method: "large" })),
    ).rejects.toThrow(/exceeds 8388608 bytes/u);
  });

  it("cancels running calls and enforces deadlines", async () => {
    const manager = await createManager();
    await manager.call(callCommand());
    const command = callCommand({ method: "wait" });
    const result = manager.call(command);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      manager.cancel({
        type: "plugin.host.cancel",
        pluginId: command.pluginId,
        generation: command.generation,
        callId: command.callId,
      }),
    ).toEqual({ cancelled: true });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });

    await expect(
      manager.call(
        callCommand({ method: "wait", deadlineUnixMs: Date.now() + 20 }),
      ),
    ).rejects.toThrow(/exceeded its deadline/u);
  });

  it("disposes deliberately without reporting a crash", async () => {
    const onWorkerExit = vi.fn();
    const manager = await createManager({ onWorkerExit });
    const command = callCommand();
    await manager.call(command);

    await expect(
      manager.dispose({
        type: "plugin.host.dispose",
        pluginId: command.pluginId,
        generation: command.generation,
      }),
    ).resolves.toEqual({ disposed: true });
    expect(onWorkerExit).not.toHaveBeenCalled();
  });

  it("recovers after a crash and retires stale generations", async () => {
    const onWorkerExit = vi.fn();
    const manager = await createManager({ onWorkerExit });
    const first = await manager.call(callCommand());
    const firstPid = Reflect.get(Object(first.output), "pid");

    await expect(
      manager.call(callCommand({ method: "crash" })),
    ).rejects.toThrow(/worker exited/u);
    expect(onWorkerExit).toHaveBeenCalledWith({
      pluginId: "fixture",
      generation: "generation-1",
    });
    const restarted = await manager.call(callCommand());
    expect(Reflect.get(Object(restarted.output), "pid")).not.toBe(firstPid);

    await manager.reconcileGenerations([]);
    await expect(manager.call(callCommand())).rejects.toThrow(/is retired/u);
    await expect(
      manager.call(callCommand({ generation: "generation-2" })),
    ).resolves.toMatchObject({ output: { input: { value: "hello" } } });
  });

  it("rejects a changed digest within one generation", async () => {
    const manager = await createManager();
    await manager.call(callCommand());

    await expect(
      manager.call(
        callCommand({
          artifact: { digest: "a".repeat(64), byteLength: 123 },
        }),
      ),
    ).rejects.toThrow(/changed artifact digest/u);
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
