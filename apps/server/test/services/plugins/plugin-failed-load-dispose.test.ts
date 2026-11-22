import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

interface FailedLoadControl {
  generation: number;
  failFactory: boolean;
  disposed: string[];
}

declare global {
  var __failedLoad: FailedLoadControl | undefined;
}

const serverEntry = `
  export default function plugin(bb: any) {
    const control = globalThis.__failedLoad;
    const generation = ++control.generation;
    bb.onDispose(() => control.disposed.push(generation + ":first"));
    bb.onDispose(() => control.disposed.push(generation + ":second"));
    if (control.failFactory) throw new Error("factory failed after setup");
  }
`;

const brokenHostEntry = `
  import "bb-package-that-is-not-installed";
  export default { experimental_apiVersion: 1, contract: {}, handlers: {} };
`;

async function writePlugin(root: string, withBrokenHost: boolean) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "bb-plugin-failedload",
      version: "0.1.0",
      bb: {
        name: "Failed load fixture",
        description: "Registers cleanup, then fails to load.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(withBrokenHost ? { host: "./host.ts" } : {}),
      },
    }),
  );
  await writeFile(join(root, "server.ts"), serverEntry);
  if (withBrokenHost) await writeFile(join(root, "host.ts"), brokenHostEntry);
}

describe("plugin load that fails after the factory ran", () => {
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-failed-load-"));
    globalThis.__failedLoad = {
      generation: 0,
      failFactory: false,
      disposed: [],
    };
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
  });

  afterEach(async () => {
    await service.stop();
    globalThis.__failedLoad = undefined;
    await rm(workDir, { recursive: true, force: true });
  });

  function control(): FailedLoadControl {
    const current = globalThis.__failedLoad;
    if (current === undefined) throw new Error("fixture control missing");
    return current;
  }

  function status() {
    return service.list().find((plugin) => plugin.id === "failedload");
  }

  it("runs the candidate's dispose hooks when its host entry fails to build on first load", async () => {
    const root = join(workDir, "failedload");
    await writePlugin(root, true);

    await service.installPath(root);

    expect(status()).toMatchObject({
      status: "error",
      statusDetail: expect.stringContaining("bb-package-that-is-not-installed"),
    });
    expect(control().generation).toBe(1);
    expect(control().disposed).toEqual(["1:second", "1:first"]);
  });

  it("runs a failed reload's dispose hooks and keeps the previous instance's hooks for its own disposal", async () => {
    const root = join(workDir, "failedload");
    await writePlugin(root, false);
    await service.installPath(root);
    control().failFactory = true;

    await service.reload("failedload");

    expect(status()).toMatchObject({ status: "running" });
    expect(control().disposed).toEqual(["2:second", "2:first"]);

    await service.stop();

    expect(control().disposed).toEqual([
      "2:second",
      "2:first",
      "1:second",
      "1:first",
    ]);
  });
});
