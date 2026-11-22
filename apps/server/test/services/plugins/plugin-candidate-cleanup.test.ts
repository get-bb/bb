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

interface CandidateProbe {
  generation: number;
  fail: boolean;
  cleanup: string[];
  ticks: number[];
  errors: string[];
  timers: Map<number, ReturnType<typeof setInterval>>;
}

declare global {
  var __candidateProbe: CandidateProbe | undefined;
}

const serverEntry = `
  import type { BbPluginApi } from "@get-bb/plugin-sdk";
  export default function plugin(bb: BbPluginApi) {
    const probe = globalThis.__candidateProbe;
    const generation = ++probe.generation;
    const timer = setInterval(() => {
      probe.ticks.push(generation);
      try {
        bb.realtime.publish("probe", { generation });
      } catch (error) {
        probe.errors.push(error.name);
      }
    }, 10);
    probe.timers.set(generation, timer);
    bb.onDispose(() => {
      clearInterval(timer);
      probe.timers.delete(generation);
      probe.cleanup.push(generation + ":timer");
    });
    bb.onDispose(() => {
      probe.cleanup.push(generation + ":throw");
      throw new Error("cleanup probe failure");
    });
    bb.onDispose(async () => {
      await Promise.resolve();
      bb.realtime.publish("cleanup", { generation });
      probe.cleanup.push(generation + ":async");
    });
    bb.cli.register({
      name: "candidate-probe",
      summary: "Return the active generation",
      run: () => ({ exitCode: 0, stdout: String(generation) }),
    });
    if (probe.fail) throw new Error("candidate setup failed");
  }
`;

describe("failed plugin candidate cleanup", () => {
  let workDir: string;
  let service: PluginService;
  let probe: CandidateProbe;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-candidate-cleanup-"));
    probe = {
      generation: 0,
      fail: false,
      cleanup: [],
      ticks: [],
      errors: [],
      timers: new Map(),
    };
    globalThis.__candidateProbe = probe;
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
      globalThis.__candidateProbe = undefined;
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it.each([
    { failure: "host build", reload: false },
    { failure: "factory", reload: false },
    { failure: "factory", reload: true },
  ])(
    "cleans up after $failure failure (reload: $reload)",
    async ({ failure, reload }) => {
      const root = join(workDir, "candidate-probe");
      await mkdir(root);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "bb-plugin-candidate-probe",
          version: "0.1.0",
          bb: {
            name: "Candidate cleanup probe",
            description: "Exercises failed instance teardown",
            branding: { icon: "Zap" },
            server: "./server.ts",
            ...(failure === "host build" ? { host: "./host.ts" } : {}),
          },
        }),
      );
      await writeFile(join(root, "server.ts"), serverEntry);
      if (failure === "host build") {
        await writeFile(join(root, "host.ts"), "export const broken = ;");
      }

      if (reload) {
        expect(await service.installPath(root)).toMatchObject({
          status: "running",
        });
        await expect.poll(() => probe.ticks.includes(1)).toBe(true);
      }
      probe.fail = failure === "factory";
      if (reload) {
        expect(await service.reload("candidate-probe")).toMatchObject({
          ok: false,
          error: expect.stringContaining("candidate setup failed"),
        });
      } else {
        expect(await service.installPath(root)).toMatchObject({
          status: "error",
        });
      }

      const discarded = reload ? 2 : 1;
      expect(probe.generation).toBe(discarded);
      expect
        .soft(probe.cleanup)
        .toEqual([
          `${discarded}:async`,
          `${discarded}:throw`,
          `${discarded}:timer`,
        ]);
      expect.soft(probe.timers.has(discarded)).toBe(false);
      if (reload) {
        expect(
          await service.runCliCommand("candidate-probe", [], {}),
        ).toMatchObject({
          exitCode: 0,
          stdout: "1",
        });
        expect(probe.timers.has(1)).toBe(true);
      }
      await service.stop();
      const ticksAtStop = probe.ticks.length;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect.soft(probe.ticks).toHaveLength(ticksAtStop);
      expect.soft(probe.errors).toEqual([]);
      expect.soft(probe.timers.size).toBe(0);
    },
  );
});
