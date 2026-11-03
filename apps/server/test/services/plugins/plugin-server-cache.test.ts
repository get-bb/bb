import { createReadStream, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildPluginServer,
  pluginBuildCodeDigest,
  resolvePluginBuildToolchain,
} from "@bb/plugin-build";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCachedPluginServer } from "../../../src/services/plugins/plugin-server-cache.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

vi.mock("@bb/plugin-build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/plugin-build")>();
  return {
    ...actual,
    buildPluginServer: vi.fn(actual.buildPluginServer),
    pluginBuildCodeDigest: vi.fn(actual.pluginBuildCodeDigest),
  };
});

type PluginFiles = Record<string, string>;

describe("plugin server cache", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.mocked(createReadStream).mockClear();
    vi.mocked(realpath).mockRestore();
    vi.mocked(buildPluginServer).mockRestore();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function writeFiles(rootDir: string, files: PluginFiles) {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(rootDir, path)), { recursive: true });
      await writeFile(join(rootDir, path), contents);
    }
  }

  async function settleTimestamps() {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async function createPlugin(files: PluginFiles) {
    const workDir = await mkdtemp(join(tmpdir(), "bb-server-cache-"));
    tempDirs.push(workDir);
    const rootDir = join(workDir, "plugin");
    const dataDir = join(workDir, "data");
    await writeFiles(rootDir, files);
    await settleTimestamps();
    let builds = 0;
    const load = async (
      overrides: {
        sdkVersion?: string;
        fallbackResolve?: (specifier: string) => string | undefined;
      } = {},
    ) => {
      const result = await buildCachedPluginServer({
        rootDir,
        dataDir,
        pluginId: "cache-fixture",
        sdkVersion: overrides.sdkVersion ?? "0.4.0",
        bbVersion: "0.9.0",
        validatedConfig: {
          serverEntry: join(rootDir, "server.ts"),
          packageName: "bb-plugin-cache-fixture",
          pluginVersion: "1.0.0",
        },
        toolchain: () => {
          builds += 1;
          return resolvePluginBuildToolchain(join(workDir, "toolchain"));
        },
        runtimeImports: {},
        fallbackResolve: overrides.fallbackResolve ?? (() => undefined),
      });
      return { ...result, source: await readFile(result.path, "utf8") };
    };
    return { rootDir, load, builds: () => builds };
  }

  it("builds an unchanged plugin once and reuses it with its warnings", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts":
        'export default (bb: any) => ["first-build", bb.environments.status];\n',
    });

    const first = await plugin.load();
    const second = await plugin.load();

    expect(plugin.builds()).toBe(1);
    expect(second).toEqual(first);
    expect(first.warnings).toEqual([
      expect.stringContaining("environments.status is retired"),
    ]);

    await plugin.load({ sdkVersion: "0.5.0" });
    expect(plugin.builds()).toBe(2);
  });

  it("does not reuse a build when a source file is saved while it builds", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts":
        'import late from "late-dependency";\nexport default () => ["entry-old", late];\n',
      "late.js": 'export default "late";\n',
    });
    let saved = false;
    const fallbackResolve = (specifier: string) => {
      if (specifier !== "late-dependency") return undefined;
      if (!saved) {
        saved = true;
        writeFileSync(
          join(plugin.rootDir, "server.ts"),
          'import late from "late-dependency";\nexport default () => ["entry-new", late];\n',
        );
      }
      return join(plugin.rootDir, "late.js");
    };

    const first = await plugin.load({ fallbackResolve });
    expect(first.source).toContain("entry-old");

    const second = await plugin.load({ fallbackResolve });
    expect(second.source).toContain("entry-new");
  });

  it.each<{ name: string; files: PluginFiles; change: PluginFiles }>([
    {
      name: "a tsconfig.json path mapping",
      files: {
        "tsconfig.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@app/value":["./a.ts"]}}}\n',
        "server.ts":
          'import { value } from "@app/value";\nexport default () => value;\n',
        "a.ts": 'export const value = "from-old";\n',
        "b.ts": 'export const value = "from-new";\n',
      },
      change: {
        "tsconfig.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@app/value":["./b.ts"]}}}\n',
      },
    },
    {
      name: "a tsconfig.json it extends",
      files: {
        "tsconfig.base.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@app/value":["./a.ts"]}}}\n',
        "tsconfig.json": '{ "extends": "./tsconfig.base.json" }\n',
        "server.ts":
          'import { value } from "@app/value";\nexport default () => value;\n',
        "a.ts": 'export const value = "from-old";\n',
        "b.ts": 'export const value = "from-new";\n',
      },
      change: {
        "tsconfig.base.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@app/value":["./b.ts"]}}}\n',
      },
    },
    {
      name: "a dependency's package.json exports",
      files: {
        "node_modules/dep/package.json":
          '{"name":"dep","type":"module","exports":"./a.js"}\n',
        "node_modules/dep/a.js": 'export const value = "from-old";\n',
        "node_modules/dep/b.js": 'export const value = "from-new";\n',
        "server.ts":
          'import { value } from "dep";\nexport default () => value;\n',
      },
      change: {
        "node_modules/dep/package.json":
          '{"name":"dep","type":"module","exports":"./b.js"}\n',
      },
    },
    {
      name: "a new file that resolves ahead of the bundled one",
      files: {
        "foo.js": 'export const value = "from-old";\n',
        "server.ts":
          'import { value } from "./foo";\nexport default () => value;\n',
      },
      change: { "foo.ts": 'export const value = "from-new";\n' },
    },
  ])("rebuilds after a change to $name", async ({ files, change }) => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      ...files,
    });

    expect((await plugin.load()).source).toContain("from-old");
    await writeFiles(plugin.rootDir, change);

    expect((await plugin.load()).source).toContain("from-new");
    expect(plugin.builds()).toBe(2);
  });

  it("checks unchanged inputs without reading them, and falls back to content", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts":
        'import { value } from "./value";\nexport default () => value;\n',
      "value.ts": 'export const value = "from-old";\n',
    });
    const valuePath = join(plugin.rootDir, "value.ts");
    const pinnedMtime = new Date("2026-01-01T00:00:00Z");
    await utimes(valuePath, pinnedMtime, pinnedMtime);
    await settleTimestamps();
    await plugin.load();

    vi.mocked(createReadStream).mockClear();
    await plugin.load();
    expect(createReadStream).not.toHaveBeenCalled();

    const later = new Date(Date.now() + 60_000);
    await utimes(valuePath, later, later);
    await plugin.load();
    expect(plugin.builds()).toBe(1);

    await utimes(valuePath, pinnedMtime, pinnedMtime);
    await writeFile(valuePath, 'export const value = "from-new";\n');
    await utimes(valuePath, pinnedMtime, pinnedMtime);
    expect((await plugin.load()).source).toContain("from-new");
    expect(plugin.builds()).toBe(2);
  });

  it("rebuilds when bb's plugin build code changes", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts": 'export default () => "server";\n',
    });

    await plugin.load();
    await plugin.load();
    expect(plugin.builds()).toBe(1);

    vi.mocked(pluginBuildCodeDigest).mockResolvedValueOnce(
      "changed-build-code",
    );
    await plugin.load();
    expect(plugin.builds()).toBe(2);
  });

  it("keeps a successful build whose inputs cannot be recorded", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts": 'export default () => "unrecorded";\n',
    });
    const actualRealpath = vi.mocked(realpath).getMockImplementation();
    const actualBuild = vi.mocked(buildPluginServer).getMockImplementation();
    if (actualRealpath === undefined || actualBuild === undefined) {
      throw new Error("expected wrapped fs and build functions");
    }
    let built = false;
    vi.mocked(buildPluginServer).mockImplementationOnce(async (...args) => {
      const result = await actualBuild(...args);
      built = true;
      return result;
    });
    vi.mocked(realpath).mockImplementation(async (path, options) => {
      if (built && path === plugin.rootDir) {
        built = false;
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return actualRealpath(path, options);
    });

    expect((await plugin.load()).source).toContain("unrecorded");
    await plugin.load();
    await plugin.load();
    expect(plugin.builds()).toBe(2);
  });

  it("keeps a bounded number of builds per plugin", async () => {
    const plugin = await createPlugin({
      "package.json": '{"name":"bb-plugin-cache-fixture","type":"module"}\n',
      "server.ts":
        'import { value } from "cache-dependency";\nexport default () => value;\n',
      "node_modules/cache-dependency/package.json":
        '{"name":"cache-dependency","type":"module","exports":"./index.js"}\n',
    });

    const paths = new Set<string>();
    let lastPath = "";
    for (let version = 0; version < 6; version += 1) {
      await writeFiles(plugin.rootDir, {
        "node_modules/cache-dependency/index.js": `export const value = ${version};\n`,
      });
      lastPath = (await plugin.load()).path;
      paths.add(lastPath);
    }

    expect(paths.size).toBe(6);
    const entries = await readdir(dirname(dirname(lastPath)), {
      withFileTypes: true,
    });
    expect(entries.filter((entry) => entry.isDirectory())).toHaveLength(4);
  });
});
