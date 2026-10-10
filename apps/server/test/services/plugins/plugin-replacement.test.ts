import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPluginSettingsValues,
  setPluginSettingsValues,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
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
        name: `Replacement fixture ${name}`,
        description: "Replacement fixture.",
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

describe("replacement plugins", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  function state(id: string) {
    const plugin = service.list().find((candidate) => candidate.id === id);
    return plugin === undefined
      ? null
      : { enabled: plugin.enabled, status: plugin.status };
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-replacement-"));
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
      bundledPlugins: [],
      bundledPluginReplacements: [
        { pluginId: "next", replaces: "original", carriedSettings: ["agents"] },
      ],
      loadTimeoutMs: 2000,
    });
    await service.start();
    await service.installPath(await writePathPlugin(workDir, "original"));
    await service.installPath(await writePathPlugin(workDir, "next"));
    await service.installPath(await writePathPlugin(workDir, "bystander"));
    await service.setEnabled("next", false);
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("turns the original off when its replacement is turned on, and back on when the replacement is turned off", async () => {
    expect(state("original")).toEqual({ enabled: true, status: "running" });
    expect(state("next")).toEqual({ enabled: false, status: "disabled" });

    await service.setEnabled("next", true);
    expect(state("next")).toEqual({ enabled: true, status: "running" });
    expect(state("original")).toEqual({ enabled: false, status: "disabled" });
    expect(state("bystander")).toEqual({ enabled: true, status: "running" });

    await service.setEnabled("next", false);
    expect(state("next")).toEqual({ enabled: false, status: "disabled" });
    expect(state("original")).toEqual({ enabled: true, status: "running" });
  });

  it("turns the replacement off when the original is turned back on", async () => {
    await service.setEnabled("next", true);

    await service.setEnabled("original", true);
    expect(state("original")).toEqual({ enabled: true, status: "running" });
    expect(state("next")).toEqual({ enabled: false, status: "disabled" });
  });

  it("leaves the replacement off when the original alone is turned off", async () => {
    await service.setEnabled("original", false);
    expect(state("original")).toEqual({ enabled: false, status: "disabled" });
    expect(state("next")).toEqual({ enabled: false, status: "disabled" });
  });

  it("carries the listed settings to whichever of the pair is being turned on, and nothing else", async () => {
    setPluginSettingsValues(db, "original", {
      agents: JSON.stringify("[one]"),
      unrelated: JSON.stringify("stays"),
    });

    await service.setEnabled("next", true);
    expect(getPluginSettingsValues(db, "next")).toEqual({
      agents: JSON.stringify("[one]"),
    });

    setPluginSettingsValues(db, "next", { agents: JSON.stringify("[two]") });
    await service.setEnabled("next", false);
    expect(getPluginSettingsValues(db, "original")).toEqual({
      agents: JSON.stringify("[two]"),
      unrelated: JSON.stringify("stays"),
    });
  });
});
