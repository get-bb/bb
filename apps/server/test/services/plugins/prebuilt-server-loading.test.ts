import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  setExperiments,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import {
  defaultExperiments,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
} from "@bb/domain";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

const logger = testLogger as unknown as Logger;

function gitPersistence(url: string, requestedRef: string) {
  return {
    provenance: { kind: "direct" } as const,
    sourceIntent: {
      kind: "git" as const,
      url,
      subdirectory: null,
      selector: {
        kind: "ref" as const,
        ref: requestedRef,
        refKind: "branch" as const,
      },
    },
    exactResolution: { kind: "git" as const, commit: "test-commit" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
  };
}

const THROWING_SERVER_TS = `throw new Error("source must not load");\n`;

const PREBUILT_SERVER_JS = `export default async function plugin(bb) {
  bb.log.info("dist");
  globalThis.__prebuiltDistLoads = (globalThis.__prebuiltDistLoads ?? 0) + 1;
}
`;

describe("prebuilt server bundle loading", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-prebuilt-"));
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
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  async function writePrebuiltPlugin(
    name: string,
    options: { sdkMajor?: number; sdkVersion?: string } = {},
  ): Promise<string> {
    const rootDir = join(workDir, name);
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name,
        version: "0.1.0",
        type: "commonjs",
        bb: {
          name: "Prebuilt server fixture",
          description: "Prebuilt plugin server fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), THROWING_SERVER_TS);
    await writeFile(join(rootDir, "dist", "server.js"), PREBUILT_SERVER_JS);
    await writeFile(
      join(rootDir, "dist", "server.meta.json"),
      JSON.stringify({
        sdkMajor: options.sdkMajor ?? PLUGIN_SDK_MAJOR,
        sdkVersion: options.sdkVersion ?? PLUGIN_SDK_VERSION,
      }),
    );
    return rootDir;
  }

  it("loads a compatible ESM prebuild from a CommonJS plugin package", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-gitdist");
    upsertInstalledPlugin(db, {
      ...gitPersistence("https://github.com/acme/bb-plugin-gitdist", "v1"),
      id: "gitdist",
      source: "git:github.com/acme/bb-plugin-gitdist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    const before =
      ((globalThis as Record<string, unknown>).__prebuiltDistLoads as
        | number
        | undefined) ?? 0;
    await service.reload("gitdist");

    const entry = service.list().find((plugin) => plugin.id === "gitdist");
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toBeNull();
    expect((globalThis as Record<string, unknown>).__prebuiltDistLoads).toBe(
      before + 1,
    );

    await service.reload("gitdist");
    expect((globalThis as Record<string, unknown>).__prebuiltDistLoads).toBe(
      before + 2,
    );
  });

  it("never prefers dist for path installs — edited source must win", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-pathsrc");
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("source must not load");
  });

  it("compiles path source into a reusable cache and rebuilds after edits", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-pathcache");
    const sourcePath = join(rootDir, "server.ts");
    await writeFile(
      sourcePath,
      `const value: string = "first";
export default function plugin() {
  globalThis.__pathCacheValue = value;
  globalThis.__pathCacheLoads = (globalThis.__pathCacheLoads ?? 0) + 1;
}
`,
    );

    const installed = await service.installPath(rootDir);
    expect(installed.status).toBe("running");
    expect((globalThis as Record<string, unknown>).__pathCacheValue).toBe(
      "first",
    );

    const cacheRoot = join(workDir, "data", "plugins", "runtime", "server");
    const firstFiles = await readdir(cacheRoot, { recursive: true });
    const firstServer = firstFiles.find((file) => file.endsWith("server.cjs"));
    expect(firstServer).toBeDefined();
    const firstServerPath = join(cacheRoot, firstServer!);
    const firstMtime = (await stat(firstServerPath)).mtimeMs;

    await service.reload("pathcache");
    expect((await stat(firstServerPath)).mtimeMs).toBe(firstMtime);
    expect((globalThis as Record<string, unknown>).__pathCacheLoads).toBe(2);

    await writeFile(
      sourcePath,
      `const value: string = "second";
export default function plugin() {
  globalThis.__pathCacheValue = value;
  globalThis.__pathCacheLoads = (globalThis.__pathCacheLoads ?? 0) + 1;
}
`,
    );
    await service.reload("pathcache");

    expect((globalThis as Record<string, unknown>).__pathCacheValue).toBe(
      "second",
    );
    expect((globalThis as Record<string, unknown>).__pathCacheLoads).toBe(3);
    const updatedFiles = await readdir(cacheRoot, { recursive: true });
    expect(
      updatedFiles.filter((file) => file.endsWith("server.cjs")),
    ).toHaveLength(2);
  });

  it("uses JITI on the next load when the legacy loader experiment is enabled", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-legacy-loader");
    const sourcePath = join(rootDir, "server.ts");
    await writeFile(
      sourcePath,
      `const value: string = "native";
export default function plugin() {
  globalThis.__loaderExperimentValue = value;
}
`,
    );

    const installed = await service.installPath(rootDir);
    expect(installed.status).toBe("running");
    expect(
      (globalThis as Record<string, unknown>).__loaderExperimentValue,
    ).toBe("native");
    const cacheRoot = join(workDir, "data", "plugins", "runtime", "server");
    const before = (await readdir(cacheRoot, { recursive: true })).filter(
      (file) => file.endsWith("server.cjs"),
    );
    expect(before).toHaveLength(1);

    setExperiments(db, {
      ...defaultExperiments,
      legacyJitiPluginLoader: true,
    });
    await writeFile(
      sourcePath,
      `const value: string = "jiti";
export default function plugin() {
  globalThis.__loaderExperimentValue = value;
}
`,
    );
    expect(
      (globalThis as Record<string, unknown>).__loaderExperimentValue,
    ).toBe("native");

    await service.reload("legacy-loader");
    expect(
      (globalThis as Record<string, unknown>).__loaderExperimentValue,
    ).toBe("jiti");
    const after = (await readdir(cacheRoot, { recursive: true })).filter(
      (file) => file.endsWith("server.cjs"),
    );
    expect(after).toEqual(before);
  });

  it("bounds compiled artifacts and evicts loaded source modules", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-reload-retention");
    const sourcePath = join(rootDir, "server.ts");
    const cacheRoot = join(workDir, "data", "plugins", "runtime", "server");
    for (let generation = 0; generation < 8; generation += 1) {
      await writeFile(
        sourcePath,
        `export default function plugin() { globalThis.__reloadRetention = ${generation}; }\n`,
      );
      if (generation === 0) await service.installPath(rootDir);
      else await service.reload("reload-retention");
    }

    expect((globalThis as Record<string, unknown>).__reloadRetention).toBe(7);
    const files = await readdir(cacheRoot, { recursive: true });
    expect(files.filter((file) => file.endsWith("server.cjs"))).toHaveLength(4);
    const cache = createRequire(import.meta.url).cache;
    expect(
      Object.keys(cache).filter((path) => path.startsWith(cacheRoot)),
    ).toEqual([]);
    expect(
      Object.values(cache)
        .flatMap((entry) => entry?.children ?? [])
        .filter((entry) => entry.filename.startsWith(cacheRoot)),
    ).toEqual([]);
  });

  it("pre-1.0: falls back to source when the dist SDK version differs within major 0", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-minordist", {
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: `${PLUGIN_SDK_MAJOR}.999.0`,
    });
    upsertInstalledPlugin(db, {
      ...gitPersistence("https://github.com/acme/bb-plugin-minordist", "v1"),
      id: "minordist",
      source: "git:github.com/acme/bb-plugin-minordist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await service.reload("minordist");

    const entry = service.list().find((plugin) => plugin.id === "minordist");
    expect(entry?.status).toBe("error");
    expect(entry?.statusDetail).toContain("source must not load");
  });

  it("falls back to source when the dist meta's SDK major mismatches", async () => {
    const rootDir = await writePrebuiltPlugin("bb-plugin-staledist", {
      sdkMajor: 999,
      sdkVersion: "999.0.0",
    });
    upsertInstalledPlugin(db, {
      ...gitPersistence("https://github.com/acme/bb-plugin-staledist", "v1"),
      id: "staledist",
      source: "git:github.com/acme/bb-plugin-staledist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await service.reload("staledist");

    const entry = service.list().find((plugin) => plugin.id === "staledist");
    expect(entry?.status).toBe("error");
    expect(entry?.statusDetail).toContain("source must not load");
  });
});
