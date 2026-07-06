import { cp, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { copyBuiltinPlugins } from "../../../scripts/copy-builtin-plugins.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(
  testDir,
  "..",
  "..",
  "fixtures",
  "plugins",
  "bb-plugin-builtin-fixture",
);
const globals = globalThis as Record<string, unknown>;

function loadCount(): number {
  return (globals.__builtinFixtureLoads as number | undefined) ?? 0;
}

function createService(args: {
  dataDir: string;
  db: DbConnection;
  isEnabled?: () => boolean;
  rootDir?: string;
}): PluginService {
  return createPluginService({
    db: args.db,
    hub: {
      getDaemonSessionIdForHost: () => null,
      notifyPluginSignal: () => 0,
      notifySystem: () => {},
    },
    logger,
    dataDir: args.dataDir,
    appVersion: "0.9.0",
    isEnabled: args.isEnabled ?? (() => false),
    builtinPlugins: [{ name: "fixture", rootDir: args.rootDir ?? fixtureRoot }],
    loadTimeoutMs: 2000,
  });
}

describe("builtin plugin reconciliation", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService | undefined;

  beforeEach(async () => {
    delete globals.__builtinFixtureLoads;
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-builtin-plugins-"));
  });

  afterEach(async () => {
    await service?.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("installs and loads a declared builtin on a fresh database", async () => {
    service = createService({ db, dataDir: join(workDir, "data") });

    await service.start();

    expect(service.list()).toMatchObject([
      {
        id: "builtin-fixture",
        source: "builtin:fixture",
        version: "0.1.0",
        enabled: true,
        status: "running",
      },
    ]);
    expect(loadCount()).toBe(1);
  });

  it("keeps a builtin tombstoned after remove and restart", async () => {
    service = createService({ db, dataDir: join(workDir, "data") });
    await service.start();

    await expect(service.remove("builtin-fixture")).resolves.toBe(true);
    expect(service.list()).toEqual([]);
    await service.stop();

    service = createService({ db, dataDir: join(workDir, "data") });
    await service.start();

    expect(service.list()).toEqual([]);
    expect(loadCount()).toBe(1);
  });

  it("refreshes the builtin row when the bundled package version changes", async () => {
    const mutableRoot = join(workDir, "bb-plugin-builtin-fixture");
    await cp(fixtureRoot, mutableRoot, { recursive: true });
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      rootDir: mutableRoot,
    });
    await service.start();
    await service.stop();

    await writeFile(
      join(mutableRoot, "package.json"),
      JSON.stringify({
        name: "bb-plugin-builtin-fixture",
        version: "0.2.0",
        type: "module",
        bb: { server: "./server.ts" },
      }),
    );

    service = createService({
      db,
      dataDir: join(workDir, "data"),
      rootDir: mutableRoot,
    });
    await service.start();

    const entry = service
      .list()
      .find((plugin) => plugin.id === "builtin-fixture");
    expect(entry?.source).toBe("builtin:fixture");
    expect(entry?.version).toBe("0.2.0");
    expect(entry?.status).toBe("running");
    expect(loadCount()).toBe(2);
  });

  it("keeps builtin CLI and UI contributions available when the experiment is off", async () => {
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      isEnabled: () => false,
    });

    await service.start();

    expect(service.listCliContributions()).toMatchObject([
      {
        pluginId: "builtin-fixture",
        name: "builtin-fixture",
        summary: "Builtin fixture command",
      },
    ]);
    expect(service.listThreadActionContributions()).toMatchObject([
      {
        pluginId: "builtin-fixture",
        id: "ping",
        title: "Ping",
      },
    ]);
    await expect(
      service.runCliCommand("builtin-fixture", [], {}),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "builtin builtin-fixture",
    });
  });

  it("rejects unknown builtin install sources clearly", async () => {
    service = createService({ db, dataDir: join(workDir, "data") });

    await expect(service.install("builtin:missing")).rejects.toThrow(
      'unknown builtin plugin "missing"',
    );
  });
});

describe("builtin plugin packaging", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-builtin-plugin-copy-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("copies only the runtime layout for packaged builtins", async () => {
    const targetRoot = join(workDir, "builtin-plugins");

    await copyBuiltinPlugins({ build: false, targetRoot });

    const copiedRoot = join(targetRoot, "automations");
    await expect(stat(join(copiedRoot, "package.json"))).resolves.toBeTruthy();
    await expect(
      stat(join(copiedRoot, "dist", "server.js")),
    ).resolves.toBeTruthy();
    await expect(
      stat(join(copiedRoot, "dist", "app.js")),
    ).resolves.toBeTruthy();
    await expect(
      stat(join(copiedRoot, "dist", "app.css")),
    ).resolves.toBeTruthy();
    await expect(stat(join(copiedRoot, "skills"))).resolves.toBeTruthy();
    await expect(stat(join(copiedRoot, "src"))).rejects.toThrow();
    await expect(stat(join(copiedRoot, "node_modules"))).rejects.toThrow();
  });
});
