import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDisabledProviderIds,
  getInstalledPluginRegistration,
  getPluginKvValue,
  getPluginSettingsValues,
  markInstalledPluginRemoved,
  setDisabledPluginProviderCatalog,
  setDisabledProviderIds,
  setPluginKvValue,
  setPluginSettingsValues,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  BUNDLED_PLUGINS,
  RETIRED_BUNDLED_PLUGINS,
} from "../../../src/services/plugins/builtin-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writePathPlugin(dir: string, name: string): Promise<string> {
  const rootDir = join(dir, `bb-plugin-${name}`);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${name}`,
      version: "0.1.0",
      bb: {
        name: `Retirement fixture ${name}`,
        description: "Retirement fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    "export default function plugin() {}",
  );
  return rootDir;
}

function insertRetiredBuiltin(
  db: DbConnection,
  args: { rootDir: string; enabled: boolean },
): void {
  upsertInstalledPlugin(db, {
    id: "retired",
    source: "builtin:retired",
    provenance: { kind: "builtin" },
    sourceIntent: { kind: "builtin", name: "retired" },
    exactResolution: { kind: "builtin" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: args.rootDir,
    version: "0.1.0",
    enabled: args.enabled,
    enabledFollowsDefault: false,
  });
}

describe("retired bundled plugins", () => {
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
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      bundledPlugins: [],
      retiredBundledPlugins: [
        {
          pluginId: "retired",
          successorPluginId: "successor",
          carriedSettings: ["agents"],
        },
      ],
      loadTimeoutMs: 2000,
    });
  }

  function state(id: string) {
    const plugin = service.list().find((candidate) => candidate.id === id);
    return plugin === undefined
      ? null
      : { enabled: plugin.enabled, status: plugin.status };
  }

  async function restart(): Promise<void> {
    await service.stop();
    service = createService();
    await service.start();
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-retired-"));
    service = createService();
    await service.start();
    await service.installPath(await writePathPlugin(workDir, "successor"));
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("hands an enabled retired plugin's listed settings to its successor and turns the successor on", async () => {
    await service.setEnabled("successor", false);
    setPluginSettingsValues(db, "successor", {
      agents: JSON.stringify("[old]"),
      unrelated: JSON.stringify("stays"),
    });
    insertRetiredBuiltin(db, {
      rootDir: join(workDir, "gone"),
      enabled: true,
    });
    setPluginSettingsValues(db, "retired", {
      agents: JSON.stringify("[new]"),
      other: JSON.stringify("dropped"),
    });
    setPluginKvValue(db, "retired", "registry-cache", JSON.stringify({}));

    await restart();

    expect(state("successor")).toEqual({ enabled: true, status: "running" });
    expect(getPluginSettingsValues(db, "successor")).toEqual({
      agents: JSON.stringify("[new]"),
      unrelated: JSON.stringify("stays"),
    });
    expect(getInstalledPluginRegistration(db, "retired")).toBeUndefined();
    expect(getPluginSettingsValues(db, "retired")).toEqual({});
    expect(getPluginKvValue(db, "retired", "registry-cache")).toBeUndefined();
  });

  it("leaves the successor alone when the retired plugin was off, and keeps the user's disabled providers", async () => {
    await service.setEnabled("successor", false);
    setPluginSettingsValues(db, "successor", {
      agents: JSON.stringify("[kept]"),
    });
    insertRetiredBuiltin(db, {
      rootDir: join(workDir, "gone"),
      enabled: false,
    });
    setPluginSettingsValues(db, "retired", {
      agents: JSON.stringify("[stale]"),
    });
    setDisabledPluginProviderCatalog(db, "retired", [
      { id: "shared", displayName: "Shared" },
    ]);
    setDisabledProviderIds(db, ["shared"]);

    await restart();

    expect(state("successor")).toEqual({ enabled: false, status: "disabled" });
    expect(getPluginSettingsValues(db, "successor")).toEqual({
      agents: JSON.stringify("[kept]"),
    });
    expect(getInstalledPluginRegistration(db, "retired")).toBeUndefined();
    expect(getDisabledProviderIds(db)).toEqual(["shared"]);
  });

  it("restores a removed successor and hands it the retired plugin's settings", async () => {
    markInstalledPluginRemoved(db, "successor");
    insertRetiredBuiltin(db, {
      rootDir: join(workDir, "gone"),
      enabled: true,
    });
    setPluginSettingsValues(db, "retired", {
      agents: JSON.stringify("[kept]"),
    });

    await restart();

    expect(state("successor")).toEqual({ enabled: true, status: "running" });
    expect(getPluginSettingsValues(db, "successor")).toEqual({
      agents: JSON.stringify("[kept]"),
    });
    expect(getInstalledPluginRegistration(db, "retired")).toBeUndefined();
  });

  it("keeps the handed-over settings for a successor that is not installed yet", async () => {
    expect(await service.remove("successor")).toBe(true);
    insertRetiredBuiltin(db, {
      rootDir: join(workDir, "gone"),
      enabled: true,
    });
    setPluginSettingsValues(db, "retired", {
      agents: JSON.stringify("[waiting]"),
    });

    await restart();

    expect(getInstalledPluginRegistration(db, "retired")).toBeUndefined();
    expect(getPluginSettingsValues(db, "retired")).toEqual({});
    expect(getPluginSettingsValues(db, "successor")).toEqual({
      agents: JSON.stringify("[waiting]"),
    });
  });

  it("retires only plugins bb no longer bundles, into successors it does", () => {
    const bundledIds = BUNDLED_PLUGINS.map((plugin) => plugin.pluginId);
    expect(RETIRED_BUNDLED_PLUGINS.length).toBeGreaterThan(0);
    for (const retired of RETIRED_BUNDLED_PLUGINS) {
      expect(bundledIds).not.toContain(retired.pluginId);
      expect(bundledIds).toContain(retired.successorPluginId);
    }
  });
});
