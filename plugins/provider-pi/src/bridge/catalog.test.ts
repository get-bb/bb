import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import { closeAllPiCatalogs, getPiCatalog } from "./catalog.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { fakePiPath } from "./test-support.js";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  await closeAllPiCatalogs();
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi catalog child generations", () => {
  it("re-reads model scope after the catalog child restarts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bb-pi-catalog-"));
    tempDirs.push(workspace);
    const extensionPath = join(workspace, "bb-extension.mjs");
    const spawnCounterPath = join(workspace, "spawns.txt");
    const processLogPath = join(workspace, "processes.txt");
    writeFileSync(extensionPath, BB_PI_EXTENSION_SOURCE);

    process.env[PI_BRIDGE_COMMAND_ENV] = process.execPath;
    process.env[PI_BRIDGE_ARGS_ENV] = JSON.stringify([fakePiPath]);
    process.env.FAKE_PI_SPAWN_COUNTER_FILE = spawnCounterPath;
    process.env.FAKE_PI_PROCESS_LOG = processLogPath;
    process.env.FAKE_PI_SCOPE_BY_SPAWN = "1";
    process.env.FAKE_PI_EXIT_AFTER_FIRST_AVAILABLE = "1";

    const catalog = await getPiCatalog(workspace, extensionPath);
    const first = await catalog.listModels();
    expect(first.models.map((model) => model.id)).toEqual([
      "fake-provider/fake-model",
    ]);

    await vi.waitFor(() => {
      expect(readFileSync(processLogPath, "utf8")).toContain("exit:");
    });

    const second = await catalog.listModels();
    expect(second.models.map((model) => model.id)).toEqual([
      "fake-provider/fake-mini",
    ]);
    expect(second.models[0]?.isDefault).toBe(true);
    expect(readFileSync(spawnCounterPath, "utf8")).toBe("2");
  }, 60_000);
});

const FAKE_MODEL = {
  id: "fake-model",
  name: "Fake Model",
  provider: "fake-provider",
  input: ["text"],
  reasoning: true,
  contextWindow: 200_000,
};
const ADDED_MODEL = {
  id: "added-model",
  name: "Added Model",
  provider: "added-provider",
  input: ["text"],
  reasoning: false,
  contextWindow: 64_000,
};

interface FakeCatalogPaths {
  workspace: string;
  extensionPath: string;
  modelsPath: string;
  refreshLogPath: string;
  spawnCounterPath: string;
  processLogPath: string;
}

function setUpFakeCatalog(env: Record<string, string>): FakeCatalogPaths {
  const workspace = mkdtempSync(join(tmpdir(), "bb-pi-catalog-"));
  tempDirs.push(workspace);
  const paths: FakeCatalogPaths = {
    workspace,
    extensionPath: join(workspace, "bb-extension.mjs"),
    modelsPath: join(workspace, "models.json"),
    refreshLogPath: join(workspace, "refreshes.txt"),
    spawnCounterPath: join(workspace, "spawns.txt"),
    processLogPath: join(workspace, "processes.txt"),
  };
  writeFileSync(paths.extensionPath, BB_PI_EXTENSION_SOURCE);
  writeFileSync(paths.modelsPath, JSON.stringify([FAKE_MODEL]));
  process.env[PI_BRIDGE_COMMAND_ENV] = process.execPath;
  process.env[PI_BRIDGE_ARGS_ENV] = JSON.stringify([fakePiPath]);
  process.env.FAKE_PI_MODELS_FILE = paths.modelsPath;
  process.env.FAKE_PI_REFRESH_LOG = paths.refreshLogPath;
  process.env.FAKE_PI_SPAWN_COUNTER_FILE = paths.spawnCounterPath;
  process.env.FAKE_PI_PROCESS_LOG = paths.processLogPath;
  Object.assign(process.env, env);
  return paths;
}

function readLogLines(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean)
    : [];
}

function processIds(path: string, step: "spawn" | "exit"): string[] {
  return readLogLines(path)
    .map((line) => line.split(":"))
    .filter(([entry]) => entry === step)
    .map(([, pid]) => pid ?? "");
}

function modelIds(result: { models: { id: string }[] }): string[] {
  return result.models.map((model) => model.id);
}

describe("pi catalog freshness", () => {
  it("serves models added after the child started without respawning it", async () => {
    const paths = setUpFakeCatalog({});

    const catalog = await getPiCatalog(paths.workspace, paths.extensionPath);
    expect(modelIds(await catalog.listModels())).toEqual([
      "fake-provider/fake-model",
    ]);

    writeFileSync(paths.modelsPath, JSON.stringify([FAKE_MODEL, ADDED_MODEL]));

    expect(modelIds(await catalog.listModels())).toEqual([
      "fake-provider/fake-model",
      "added-provider/added-model",
    ]);
    expect(readFileSync(paths.spawnCounterPath, "utf8")).toBe("1");
    expect(readLogLines(paths.refreshLogPath)).toEqual([
      JSON.stringify({ allowNetwork: false }),
    ]);
  }, 60_000);

  it("shares one model refresh between concurrent reads", async () => {
    const paths = setUpFakeCatalog({});

    const catalog = await getPiCatalog(paths.workspace, paths.extensionPath);
    await catalog.listModels();
    writeFileSync(paths.modelsPath, JSON.stringify([FAKE_MODEL, ADDED_MODEL]));

    const [listed, raw] = await Promise.all([
      catalog.listModels(),
      catalog.rawModels(),
    ]);

    expect(modelIds(listed)).toContain("added-provider/added-model");
    expect(raw.map((model) => model.id)).toContain("added-model");
    expect(readLogLines(paths.refreshLogPath)).toHaveLength(1);
    expect(readFileSync(paths.spawnCounterPath, "utf8")).toBe("1");
  }, 60_000);

  it("falls back to a new child when Pi exposes no model registry", async () => {
    const paths = setUpFakeCatalog({ FAKE_PI_NO_MODEL_REGISTRY: "1" });

    const catalog = await getPiCatalog(paths.workspace, paths.extensionPath);
    expect(modelIds(await catalog.listModels())).toEqual([
      "fake-provider/fake-model",
    ]);

    writeFileSync(paths.modelsPath, JSON.stringify([FAKE_MODEL, ADDED_MODEL]));

    expect(modelIds(await catalog.listModels())).toEqual([
      "fake-provider/fake-model",
      "added-provider/added-model",
    ]);
    expect(readFileSync(paths.spawnCounterPath, "utf8")).toBe("2");
    expect(readLogLines(paths.refreshLogPath)).toEqual([]);
  }, 60_000);

  it.each([
    ["hangs", "hang"],
    ["rejects", "reject"],
  ])(
    "replaces the child when the model refresh %s",
    async (_label, failure) => {
      const paths = setUpFakeCatalog({ FAKE_PI_REFRESH_FAILURE: failure });

      const catalog = await getPiCatalog(paths.workspace, paths.extensionPath);
      await catalog.listModels();
      writeFileSync(
        paths.modelsPath,
        JSON.stringify([FAKE_MODEL, ADDED_MODEL]),
      );

      expect(modelIds(await catalog.listModels())).toEqual([
        "fake-provider/fake-model",
        "added-provider/added-model",
      ]);
      const spawned = processIds(paths.processLogPath, "spawn");
      expect(spawned).toHaveLength(2);
      expect(processIds(paths.processLogPath, "exit")).toEqual([spawned[0]]);
    },
    60_000,
  );
});
