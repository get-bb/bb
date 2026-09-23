import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

const logger = testLogger as unknown as Logger;

async function writeHookPlugin(
  rootDir: string,
  options: { name: string; version?: string; handlerBody: string },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: options.version ?? "0.1.0",
      bb: {
        name: "Install hook fixture",
        description: "Records install handler runs.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `import { appendFileSync } from "node:fs";
export default function plugin(bb: any) {
  bb.onInstall(async () => {
    ${options.handlerBody}
  });
}
`,
  );
}

async function readRuns(markerPath: string): Promise<string[]> {
  try {
    return (await readFile(markerPath, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("bb.onInstall", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-install-hook-"));
    service = createPluginService({
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
      loadTimeoutMs: 5000,
      installHandlerTimeoutMs: 200,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs once on a fresh install and again only after removal", async () => {
    const rootDir = join(workDir, "hooked");
    const markerPath = join(workDir, "runs.txt");
    await writeHookPlugin(rootDir, {
      name: "bb-plugin-hooked",
      handlerBody: `appendFileSync(${JSON.stringify(markerPath)}, "install\\n");`,
    });

    await service.install(rootDir, { kind: "root" });
    expect(await readRuns(markerPath)).toEqual(["install"]);

    await service.install(rootDir, { kind: "root" });
    await service.reload("hooked");
    await service.setEnabled("hooked", false);
    await service.setEnabled("hooked", true);
    expect(await readRuns(markerPath)).toEqual(["install"]);

    await service.remove("hooked");
    await service.install(rootDir, { kind: "root" });
    expect(await readRuns(markerPath)).toEqual(["install", "install"]);
  });

  it("keeps the install when a handler throws", async () => {
    const rootDir = join(workDir, "throwing");
    await writeHookPlugin(rootDir, {
      name: "bb-plugin-throwing",
      handlerBody: `throw new Error("install hook exploded");`,
    });

    const entry = await service.install(rootDir, { kind: "root" });

    expect(entry).toMatchObject({ id: "throwing", status: "running" });
  });

  it("stops waiting for a handler that never settles", async () => {
    const rootDir = join(workDir, "hanging");
    await writeHookPlugin(rootDir, {
      name: "bb-plugin-hanging",
      handlerBody: `await new Promise(() => {});`,
    });

    const startedAt = Date.now();
    const entry = await service.install(rootDir, { kind: "root" });

    expect(entry).toMatchObject({ id: "hanging", status: "running" });
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });
});
