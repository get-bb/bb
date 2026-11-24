import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

interface FailedLoadProbe {
  generation: number;
  failFactory: boolean;
  disposed: string[];
  ticks: number[];
  errors: string[];
  timers: Map<number, ReturnType<typeof setInterval>>;
}

declare global {
  var __failedLoadProbe: FailedLoadProbe | undefined;
}

const serverEntry = `
  import type { BbPluginApi } from "@get-bb/plugin-sdk";
  export default function plugin(bb: BbPluginApi) {
    const probe = globalThis.__failedLoadProbe;
    const generation = ++probe.generation;
    const timer = setInterval(() => {
      probe.ticks.push(generation);
      try {
        bb.realtime.publish("tick", { generation });
      } catch (error) {
        probe.errors.push(error.name);
      }
    }, 10);
    probe.timers.set(generation, timer);
    bb.onDispose(() => {
      clearInterval(timer);
      probe.timers.delete(generation);
      probe.disposed.push(generation + ":timer");
    });
    bb.onDispose(() => {
      probe.disposed.push(generation + ":throw");
      throw new Error("dispose hook failure");
    });
    bb.onDispose(async () => {
      await Promise.resolve();
      bb.realtime.publish("cleanup", { generation });
      probe.disposed.push(generation + ":async");
    });
    bb.cli.register({
      name: "generation",
      summary: "Print the live generation",
      run: () => ({ exitCode: 0, stdout: String(generation) }),
    });
    if (probe.failFactory) throw new Error("factory failed after setup");
  }
`;

const brokenHostEntry = `
  import "bb-package-that-is-not-installed";
  export default { experimental_apiVersion: 1, contract: {}, handlers: {} };
`;

function disposedInLifoOrder(generation: number): string[] {
  return [`${generation}:async`, `${generation}:throw`, `${generation}:timer`];
}

describe("plugin load that fails after the factory ran", () => {
  let workDir: string;
  let root: string;
  let service: PluginService;
  let probe: FailedLoadProbe;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-failed-load-"));
    root = join(workDir, "failedload");
    probe = {
      generation: 0,
      failFactory: false,
      disposed: [],
      ticks: [],
      errors: [],
      timers: new Map(),
    };
    globalThis.__failedLoadProbe = probe;
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
      logger: pino({ level: "silent" }),
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 5_000,
      serviceStopTimeoutMs: 100,
    });
  });

  afterEach(async () => {
    try {
      await service.stop();
    } finally {
      for (const timer of probe.timers.values()) clearInterval(timer);
      globalThis.__failedLoadProbe = undefined;
      await rm(workDir, { recursive: true, force: true });
    }
  });

  async function writePlugin(withBrokenHost: boolean) {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bb-plugin-failedload",
        version: "0.1.0",
        bb: {
          name: "Failed load fixture",
          description: "Starts a timer, registers cleanup, then fails to load.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          ...(withBrokenHost ? { host: "./host.ts" } : {}),
        },
      }),
    );
    await writeFile(join(root, "server.ts"), serverEntry);
    if (withBrokenHost) await writeFile(join(root, "host.ts"), brokenHostEntry);
  }

  async function expectNoTicksAfterStop() {
    await service.stop();
    const ticksAtStop = probe.ticks.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(probe.ticks).toHaveLength(ticksAtStop);
    expect(probe.timers.size).toBe(0);
    expect(probe.errors).toEqual([]);
  }

  it("runs the candidate's dispose hooks when its host entry fails to build on first load", async () => {
    await writePlugin(true);

    expect(await service.installPath(root)).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining("bb-package-that-is-not-installed"),
    });

    expect(probe.generation).toBe(1);
    expect(probe.disposed).toEqual(disposedInLifoOrder(1));
    await expectNoTicksAfterStop();
  });

  it("runs the candidate's dispose hooks when its factory throws on first load", async () => {
    await writePlugin(false);
    probe.failFactory = true;

    expect(await service.installPath(root)).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining("factory failed after setup"),
    });

    expect(probe.generation).toBe(1);
    expect(probe.disposed).toEqual(disposedInLifoOrder(1));
    await expectNoTicksAfterStop();
  });

  it("runs a failed reload's dispose hooks and keeps the previous instance serving until its own disposal", async () => {
    await writePlugin(false);
    expect(await service.installPath(root)).toMatchObject({
      status: "running",
    });
    await expect.poll(() => probe.ticks.includes(1)).toBe(true);
    probe.failFactory = true;

    expect(await service.reload("failedload")).toMatchObject({
      ok: false,
      error: expect.stringContaining("factory failed after setup"),
    });

    expect(probe.generation).toBe(2);
    expect(probe.disposed).toEqual(disposedInLifoOrder(2));
    expect(
      await service.runCliCommand("failedload", ["generation"], {}),
    ).toMatchObject({
      exitCode: 0,
      stdout: "1",
    });
    expect(probe.timers.has(1)).toBe(true);

    await expectNoTicksAfterStop();
    expect(probe.disposed).toEqual([
      ...disposedInLifoOrder(2),
      ...disposedInLifoOrder(1),
    ]);
  });
});
