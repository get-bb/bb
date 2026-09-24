import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "plugins",
  "bb-plugin-builtin-fixture",
);
const globals = globalThis as Record<string, unknown>;

async function writePathPlugin(dir: string, name: string): Promise<string> {
  const rootDir = join(dir, `bb-plugin-${name}`);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${name}`,
      version: "0.1.0",
      bb: {
        name: "Safe mode fixture",
        description: "Safe mode fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `export default function plugin(bb: any) {
      const g = globalThis as any;
      g.__safeModeLoads = { ...g.__safeModeLoads, ${JSON.stringify(name)}: (g.__safeModeLoads?.[${JSON.stringify(name)}] ?? 0) + 1 };
      bb.onDispose(() => {
        g.__safeModeDisposed = [...(g.__safeModeDisposed ?? []), ${JSON.stringify(name)}];
      });
    }`,
  );
  return rootDir;
}

describe("plugin safe mode", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  function createService(): PluginService {
    return createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      bundledPlugins: [
        {
          name: "fixture",
          pluginId: "builtin-fixture",
          autoInstall: true,
          defaultEnabled: true,
          rootDir: fixtureRoot,
        },
      ],
      loadTimeoutMs: 2000,
    });
  }

  function entry(id: string) {
    return service.list().find((plugin) => plugin.id === id);
  }

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-safe-mode-"));
    service = createService();
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
    delete globals.__safeModeLoads;
    delete globals.__safeModeDisposed;
    delete globals.__builtinFixtureLoads;
  });

  it("stops non-builtin plugins and restores only the ones that were enabled", async () => {
    await service.installPath(await writePathPlugin(workDir, "alpha"));
    await service.installPath(await writePathPlugin(workDir, "beta"));
    await service.setEnabled("beta", false);
    expect(service.getSafeMode()).toBe(false);

    await expect(service.setSafeMode(true)).resolves.toBe(true);

    expect(service.getSafeMode()).toBe(true);
    expect(entry("builtin-fixture")).toMatchObject({ status: "running" });
    expect(entry("alpha")).toMatchObject({
      enabled: true,
      status: "disabled",
      statusDetail: "safe mode is on",
    });
    expect(entry("beta")).toMatchObject({
      enabled: false,
      status: "disabled",
      statusDetail: null,
    });
    expect(service.getApi("alpha")).toBeUndefined();
    expect(globals.__safeModeDisposed).toEqual(["beta", "alpha"]);

    await expect(service.setSafeMode(false)).resolves.toBe(false);

    expect(entry("alpha")).toMatchObject({ enabled: true, status: "running" });
    expect(entry("beta")).toMatchObject({ enabled: false, status: "disabled" });
    expect(globals.__safeModeLoads).toEqual({ alpha: 2, beta: 1 });
  });

  it("keeps plugins enabled or reloaded during safe mode unloaded until it ends", async () => {
    await service.installPath(await writePathPlugin(workDir, "alpha"));
    await service.setEnabled("alpha", false);
    await service.setSafeMode(true);

    await expect(service.setEnabled("alpha", true)).resolves.toMatchObject({
      enabled: true,
      status: "disabled",
      statusDetail: "safe mode is on",
    });
    await service.reload("alpha");
    expect(service.getApi("alpha")).toBeUndefined();

    await service.setSafeMode(false);
    expect(entry("alpha")).toMatchObject({ status: "running" });
  });

  it("persists across a restart without loading non-builtin plugins", async () => {
    await service.installPath(await writePathPlugin(workDir, "alpha"));
    await service.setSafeMode(true);
    await service.stop();
    globals.__safeModeLoads = {};
    globals.__builtinFixtureLoads = 0;

    service = createService();
    await service.start();

    expect(service.getSafeMode()).toBe(true);
    expect(entry("alpha")).toMatchObject({
      enabled: true,
      status: "disabled",
      statusDetail: "safe mode is on",
    });
    expect(globals.__safeModeLoads).toEqual({});
    expect(globals.__builtinFixtureLoads).toBe(1);
  });
});
