import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  getInstalledPluginRegistration,
  migrate,
  type DbConnection,
} from "@bb/db";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import {
  BUILTIN_PLUGIN_NAMES,
  BUILTIN_PLUGINS,
} from "../../../src/services/plugins/builtin-registry.js";
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

function packagedLoadCount(): number {
  return (globals.__packagedBuiltinLoads as number | undefined) ?? 0;
}

async function writePackagedBuiltinSource(workDir: string): Promise<{
  sourceModuleDir: string;
}> {
  const sourceModuleDir = join(workDir, "source-module");
  // copyBuiltinPlugins packages EVERY declared builtin, so the synthetic
  // source tree must carry one packaged plugin per BUILTIN_PLUGIN_NAMES
  // entry — a name added to the registry is covered here automatically.
  for (const name of BUILTIN_PLUGIN_NAMES) {
    const hasApp = name !== "memory";
    const sourceRoot = join(sourceModuleDir, "builtin-plugins", name);
    await mkdir(join(sourceRoot, "dist"), { recursive: true });
    await mkdir(join(sourceRoot, "skills", name), { recursive: true });
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify(
        {
          name: `bb-plugin-${name}`,
          version: "0.1.0",
          type: "module",
          bb: {
            ...(name === "memory"
              ? { displayName: "Memory", icon: "Brain" }
              : {}),
            server: "./src/server.ts",
            ...(hasApp ? { app: "./app.tsx" } : {}),
            skills: ["skills"],
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(sourceRoot, "src", "server.ts"),
      `throw new Error("packaged builtin should not load source");\n`,
    );
    if (hasApp) {
      await writeFile(
        join(sourceRoot, "app.tsx"),
        `throw new Error("packaged builtin should not build app source");\n`,
      );
    }
    await writeFile(
      join(sourceRoot, "dist", "server.js"),
      `export default function plugin() {
  globalThis.__packagedBuiltinLoads = (globalThis.__packagedBuiltinLoads ?? 0) + 1;
}
`,
    );
    await writeFile(
      join(sourceRoot, "dist", "server.meta.json"),
      `${JSON.stringify(
        { sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: PLUGIN_SDK_VERSION },
        null,
        2,
      )}\n`,
    );
    if (hasApp) {
      await writeFile(
        join(sourceRoot, "dist", "app.js"),
        `export default {};\n`,
      );
      await writeFile(join(sourceRoot, "dist", "app.css"), `/* built */\n`);
      await writeFile(
        join(sourceRoot, "dist", "app.meta.json"),
        `${JSON.stringify(
          { sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: PLUGIN_SDK_VERSION },
          null,
          2,
        )}\n`,
      );
    }
    await writeFile(
      join(sourceRoot, "skills", name, "SKILL.md"),
      `---\nname: ${name}\n---\n`,
    );
  }
  return { sourceModuleDir };
}

function createService(args: {
  dataDir: string;
  db: DbConnection;
  builtinName?: string;
  defaultEnabled?: boolean;
  isEnabled?: () => boolean;
  isConnectEnabled?: () => boolean;
  rootDir?: string;
  watchBuiltinPluginSources?: boolean;
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
    isConnectEnabled: args.isConnectEnabled ?? (() => false),
    builtinPlugins: [
      {
        name: args.builtinName ?? "fixture",
        rootDir: args.rootDir ?? fixtureRoot,
        defaultEnabled: args.defaultEnabled ?? true,
      },
    ],
    watchBuiltinPluginSources: args.watchBuiltinPluginSources,
    loadTimeoutMs: 2000,
  });
}

describe("builtin plugin reconciliation", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService | undefined;

  beforeEach(async () => {
    delete globals.__builtinFixtureLoads;
    delete globals.__packagedBuiltinLoads;
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-builtin-plugins-"));
  });

  it("declares memory as builtin and disabled by default", () => {
    expect(BUILTIN_PLUGINS).toContainEqual({
      name: "memory",
      defaultEnabled: false,
    });
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
        icon: "EditFile",
        enabled: true,
        status: "running",
      },
    ]);
    expect(loadCount()).toBe(1);
    expect(getInstalledPluginRegistration(db, "builtin-fixture")).toMatchObject(
      {
        provenance: "builtin",
        sourceKind: "builtin",
        sourceBuiltinName: "fixture",
        updatePolicy: "manual",
        normalizationVersion: 1,
      },
    );
  });

  it("backfills every legacy source form once while preserving registration state", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const legacyRoot = join(workDir, "missing-legacy-root");
    const legacyRows = [
      ["legacy-path", `path:${fixtureRoot}`, 1, 101],
      ["legacy-builtin", "builtin:fixture", 0, 102],
      ["legacy-npm", "npm:bb-plugin-legacy@1.2.3", 1, 103],
      ["legacy-git", `git:github.com/acme/bb-plugin-legacy@${sha}`, 0, 104],
    ] as const;
    const insert = db.$client.prepare(
      `INSERT INTO plugins
       (id, source, root_dir, version, enabled, removed_at, installed_at, updated_at)
       VALUES (?, ?, ?, '0.1.0', ?, ?, 10, 20)`,
    );
    for (const [id, source, enabled, removedAt] of legacyRows) {
      insert.run(id, source, legacyRoot, enabled, removedAt);
    }

    service = createService({ db, dataDir: join(workDir, "data") });
    await service.start();

    expect(getInstalledPluginRegistration(db, "legacy-path")).toMatchObject({
      enabled: true,
      removedAt: 101,
      provenance: "direct",
      sourceKind: "path",
      sourcePath: fixtureRoot,
      normalizationVersion: 1,
    });
    expect(getInstalledPluginRegistration(db, "legacy-builtin")).toMatchObject({
      enabled: false,
      removedAt: 102,
      provenance: "builtin",
      sourceKind: "builtin",
      sourceBuiltinName: "fixture",
    });
    expect(getInstalledPluginRegistration(db, "legacy-npm")).toMatchObject({
      enabled: true,
      removedAt: 103,
      sourceKind: "npm",
      sourceNpmPackage: "bb-plugin-legacy",
      sourceNpmRequestedSpec: "1.2.3",
      npmResolvedVersion: "1.2.3",
      updatePolicy: "manual",
    });
    expect(getInstalledPluginRegistration(db, "legacy-git")).toMatchObject({
      enabled: false,
      removedAt: 104,
      sourceKind: "git",
      sourceGitUrl: "https://github.com/acme/bb-plugin-legacy",
      sourceGitRequestedRef: sha,
      gitResolvedCommit: sha,
    });

    const once = legacyRows.map(([id]) =>
      getInstalledPluginRegistration(db, id),
    );
    await service.stop();
    service = createService({ db, dataDir: join(workDir, "data") });
    await service.start();
    expect(
      legacyRows.map(([id]) => getInstalledPluginRegistration(db, id)),
    ).toEqual(once);
  });

  it("installs a default-disabled builtin without loading it", async () => {
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      defaultEnabled: false,
    });
    await service.start();

    expect(service.list()).toMatchObject([
      {
        id: "builtin-fixture",
        source: "builtin:fixture",
        enabled: false,
        status: "disabled",
      },
    ]);
    expect(loadCount()).toBe(0);

    await service.setEnabled("builtin-fixture", true);
    expect(service.list()).toMatchObject([
      { id: "builtin-fixture", enabled: true, status: "running" },
    ]);
    expect(loadCount()).toBe(1);

    await service.stop();
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      defaultEnabled: false,
    });
    await service.start();

    expect(service.list()).toMatchObject([
      { id: "builtin-fixture", enabled: true, status: "running" },
    ]);
  });

  it("loads the builtin connect plugin only while the bb connect experiment is on", async () => {
    let connectEnabled = false;
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      builtinName: "connect",
      isConnectEnabled: () => connectEnabled,
    });

    await service.start();

    expect(service.list()).toMatchObject([
      {
        id: "builtin-fixture",
        source: "builtin:connect",
        enabled: true,
        status: "disabled",
        statusDetail: 'disabled by the "bb connect" experiment',
      },
    ]);
    expect(loadCount()).toBe(0);

    connectEnabled = true;
    await service.onExperimentsChanged();

    expect(service.list()).toMatchObject([
      {
        id: "builtin-fixture",
        source: "builtin:connect",
        status: "running",
      },
    ]);
    expect(loadCount()).toBe(1);

    connectEnabled = false;
    await service.onExperimentsChanged();

    expect(service.getApi("builtin-fixture")).toBeUndefined();
    expect(service.list()).toMatchObject([
      {
        id: "builtin-fixture",
        source: "builtin:connect",
        status: "disabled",
        statusDetail: 'disabled by the "bb connect" experiment',
      },
    ]);
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

  it("rebuilds and serves a new builtin app hash after a source edit while Plugins is off", async () => {
    const mutableRoot = join(workDir, "bb-plugin-hot-builtin");
    await mkdir(mutableRoot, { recursive: true });
    await writeFile(
      join(mutableRoot, "package.json"),
      JSON.stringify({
        name: "bb-plugin-hot-builtin",
        version: "0.1.0",
        type: "module",
        bb: { server: "./server.ts", app: "./app.tsx" },
      }),
    );
    await writeFile(
      join(mutableRoot, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(mutableRoot, "app.tsx"),
      "export default function App() { return <div>before</div>; }\n",
    );
    service = createService({
      db,
      dataDir: join(workDir, "data"),
      builtinName: "hot",
      isEnabled: () => false,
      rootDir: mutableRoot,
      watchBuiltinPluginSources: true,
    });
    await service.start();
    const before = service.list()[0]?.app.bundle;
    expect(before).not.toBeNull();

    await writeFile(
      join(mutableRoot, "app.tsx"),
      "export default function App() { return <div>after</div>; }\n",
    );
    let after = service.list()[0]?.app.bundle;
    const deadline = Date.now() + 20_000;
    while (after?.hash === before?.hash && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      after = service.list()[0]?.app.bundle;
    }
    expect(after?.hash).not.toBe(before?.hash);
    await expect(
      readFile(join(mutableRoot, "dist", "app.js"), "utf8"),
    ).resolves.toContain("after");
  }, 30_000);

  it("rejects unknown builtin install sources clearly", async () => {
    service = createService({ db, dataDir: join(workDir, "data") });

    await expect(service.install("builtin:missing")).rejects.toThrow(
      'unknown builtin plugin "missing"',
    );
  });

  it("installs and loads a packaged builtin whose source files are omitted", async () => {
    const { sourceModuleDir } = await writePackagedBuiltinSource(workDir);
    const targetRoot = join(workDir, "builtin-plugins");
    await copyBuiltinPlugins({ build: false, sourceModuleDir, targetRoot });
    const copiedRoot = join(targetRoot, "automations");

    service = createService({
      db,
      dataDir: join(workDir, "data"),
      builtinName: "automations",
      rootDir: copiedRoot,
    });
    await service.start();

    expect(service.list()).toMatchObject([
      {
        id: "automations",
        source: "builtin:automations",
        version: "0.1.0",
        enabled: true,
        status: "running",
        app: {
          hasApp: true,
          bundle: {
            compatible: true,
          },
        },
      },
    ]);
    expect(packagedLoadCount()).toBe(1);
  });

  it("explicitly installs a packaged builtin without rebuilding its app bundle", async () => {
    const { sourceModuleDir } = await writePackagedBuiltinSource(workDir);
    const targetRoot = join(workDir, "builtin-plugins");
    await copyBuiltinPlugins({ build: false, sourceModuleDir, targetRoot });
    const copiedRoot = join(targetRoot, "automations");

    service = createService({
      db,
      dataDir: join(workDir, "data"),
      builtinName: "automations",
      isEnabled: () => true,
      rootDir: copiedRoot,
    });

    await expect(service.install("builtin:automations")).resolves.toMatchObject(
      {
        id: "automations",
        status: "running",
      },
    );
    await expect(
      readFile(join(copiedRoot, "dist", "app.css"), "utf8"),
    ).resolves.toBe("/* built */\n");
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
    const { sourceModuleDir } = await writePackagedBuiltinSource(workDir);
    const targetRoot = join(workDir, "builtin-plugins");

    await copyBuiltinPlugins({ build: false, sourceModuleDir, targetRoot });

    const copiedRoot = join(targetRoot, "automations");
    const packageJson = JSON.parse(
      await readFile(join(copiedRoot, "package.json"), "utf8"),
    );
    expect(packageJson).toMatchObject({
      bb: {
        server: "./dist/server.js",
        app: "./dist/app.js",
        skills: ["skills"],
      },
    });
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
    await expect(stat(join(copiedRoot, "app.tsx"))).rejects.toThrow();
    await expect(stat(join(copiedRoot, "node_modules"))).rejects.toThrow();

    const connectRoot = join(targetRoot, "connect");
    await expect(stat(join(connectRoot, "package.json"))).resolves.toBeTruthy();
    await expect(
      stat(join(connectRoot, "dist", "server.js")),
    ).resolves.toBeTruthy();
    await expect(
      stat(join(connectRoot, "dist", "app.js")),
    ).resolves.toBeTruthy();
    await expect(stat(join(connectRoot, "src"))).rejects.toThrow();
    await expect(stat(join(connectRoot, "node_modules"))).rejects.toThrow();

    const memoryRoot = join(targetRoot, "memory");
    const memoryPackageJson = JSON.parse(
      await readFile(join(memoryRoot, "package.json"), "utf8"),
    );
    expect(memoryPackageJson.bb).toMatchObject({
      displayName: "Memory",
      icon: "Brain",
      server: "./dist/server.js",
      skills: ["skills"],
    });
    expect(memoryPackageJson.bb).not.toHaveProperty("app");
    await expect(
      stat(join(memoryRoot, "dist", "server.js")),
    ).resolves.toBeTruthy();
    await expect(stat(join(memoryRoot, "dist", "app.js"))).rejects.toThrow();
  });
});
