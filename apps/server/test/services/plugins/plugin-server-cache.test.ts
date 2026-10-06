import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePluginBuildToolchain } from "@bb/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCachedPluginServer,
  pluginServerCacheDirectory,
} from "../../../src/services/plugins/plugin-server-cache.js";

describe("plugin server cache", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("keys the cache from bundled inputs and prunes old artifacts", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-server-cache-graph-"));
    tempDirs.push(workDir);
    const rootDir = join(workDir, "plugin");
    const dataDir = join(workDir, "data");
    await mkdir(rootDir, { recursive: true });
    const dependencyDir = join(rootDir, "node_modules", "cache-dependency");
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      join(dependencyDir, "package.json"),
      '{"name":"cache-dependency","type":"module","exports":"./index.js"}\n',
    );
    await writeFile(
      join(rootDir, "server.ts"),
      'import { value } from "cache-dependency"; export default () => value;\n',
    );
    const build = () =>
      buildCachedPluginServer({
        rootDir,
        dataDir,
        pluginId: "cache-graph",
        sdkVersion: "0.4.0",
        bbVersion: "0.9.0",
        validatedConfig: {
          serverEntry: join(rootDir, "server.ts"),
          packageName: "bb-plugin-cache-graph",
          pluginVersion: "1.0.0",
        },
        toolchain: () =>
          resolvePluginBuildToolchain(join(workDir, "unused-toolchain")),
        runtimeImports: {},
        fallbackResolve: () => undefined,
      });

    const paths = new Set<string>();
    let lastPath = "";
    for (let version = 0; version < 6; version += 1) {
      await writeFile(
        join(dependencyDir, "index.js"),
        `export const value = ${version};\n`,
      );
      lastPath = (await build()).path;
      paths.add(lastPath);
    }

    expect(paths.size).toBe(6);
    const pluginCacheDir = dirname(dirname(lastPath));
    const entries = await readdir(pluginCacheDir, { withFileTypes: true });
    expect(entries.filter((entry) => entry.isDirectory())).toHaveLength(4);
  });

  it("keys entries by source, SDK, Node, plugin, and source location", () => {
    const base = {
      dataDir: "/data",
      pluginId: "example",
      rootDir: "/plugins/example",
      artifactDigest: "abc",
      sdkVersion: "0.4.0",
      bbVersion: "0.9.0",
      nodeVersion: "22.0.0",
    };
    const first = pluginServerCacheDirectory(base);

    expect(pluginServerCacheDirectory(base)).toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, artifactDigest: "def" }),
    ).not.toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, sdkVersion: "0.5.0" }),
    ).not.toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, bbVersion: "0.10.0" }),
    ).not.toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, nodeVersion: "23.0.0" }),
    ).not.toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, pluginId: "another" }),
    ).not.toBe(first);
    expect(
      pluginServerCacheDirectory({ ...base, rootDir: "/plugins/moved" }),
    ).not.toBe(first);
  });
});
