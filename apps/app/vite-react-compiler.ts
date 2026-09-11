import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import * as cacache from "cacache";
import type { ResolvedConfig } from "vite";
import { z } from "zod";

const transformResult = z
  .object({
    code: z.string(),
    map: z
      .object({
        version: z.number(),
        sources: z.array(z.string()),
        names: z.array(z.string()),
        mappings: z.string(),
        file: z.string().optional(),
        sourceRoot: z.string().optional(),
        sourcesContent: z.array(z.string().nullable()).optional(),
        ignoreList: z.array(z.number()).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function containsWorktreePath(serialized: string, root: string) {
  return [root, root.replaceAll("\\", "/")].some((value) => {
    const encoded = JSON.stringify(value).slice(1, -1);
    return (
      serialized.includes(encoded) ||
      serialized.includes(JSON.stringify(encoded).slice(1, -1))
    );
  });
}

export function compilerTransformKey(
  namespace: string,
  root: string,
  id: string,
  code: string,
  moduleType: string,
  environment: string,
) {
  if (!isAbsolute(id)) return null;
  const localId = relative(root, id);
  if (localId.startsWith("..") || isAbsolute(localId)) return null;
  return digest(
    JSON.stringify([namespace, localId, code, moduleType, environment]),
  );
}

export function compilerCacheNamespace(identity: {
  dependencies: Array<[string, string]>;
  node: string;
  nodeOptions: string | null;
  execArgv: string[];
  platform: NodeJS.Platform;
  arch: string;
  mode: string;
  production: boolean;
  env: Array<[string, string | undefined]>;
}) {
  return digest(JSON.stringify({ schema: 1, ...identity }));
}

export async function cachedReactCompiler(cacheDirectory?: string): Promise<
  Awaited<ReturnType<typeof babel>> & {
    api: {
      compilerCache: { hits: number; misses: number };
    };
  }
> {
  const plugin = await babel({ presets: [reactCompilerPreset()] });
  const transform = plugin.transform;
  if (!transform || typeof transform === "function") {
    throw new Error("Expected the Babel plugin's filtered transform hook");
  }
  const handler = transform.handler;
  if (
    !("configResolved" in plugin) ||
    typeof plugin.configResolved !== "function"
  ) {
    throw new Error("Expected the Babel plugin's configResolved hook");
  }
  const configResolved = plugin.configResolved;
  const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  let cache: { directory: string; namespace: string } | null = null;
  let warned = false;
  const stats = { hits: 0, misses: 0 };
  plugin.configResolved = async function (this: void, config: ResolvedConfig) {
    await configResolved.call(this, config);
    if (
      config.command !== "build" ||
      process.env.ENABLE_REACT_COMPILER_TIMINGS === "1" ||
      process.env.BABEL_SHOW_CONFIG_FOR
    )
      return;
    let directory: string;
    try {
      const { stdout } = await promisify(execFile)(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      directory = resolve(stdout.trim(), "bb-cache/react-compiler");
    } catch {
      directory = resolve(config.cacheDir, "react-compiler");
    }
    const files = [
      ...new Set([
        resolve(root, "package.json"),
        resolve(root, "pnpm-lock.yaml"),
        resolve(root, "pnpm-workspace.yaml"),
        fileURLToPath(import.meta.url),
        ...config.configFileDependencies,
      ]),
    ].sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
    const dependencies = await Promise.all(
      files.map(
        async (file): Promise<[string, string]> => [
          relative(root, file),
          await readFile(file, "utf8"),
        ],
      ),
    );
    cache = {
      directory: cacheDirectory ?? directory,
      namespace: compilerCacheNamespace({
        dependencies,
        node: process.version,
        nodeOptions: process.env.NODE_OPTIONS ?? null,
        execArgv: process.execArgv,
        platform: process.platform,
        arch: process.arch,
        mode: config.mode,
        production: config.isProduction,
        env: Object.entries(process.env)
          .filter(([key]) => key.startsWith("BABEL_") || key === "NODE_ENV")
          .sort(),
      }),
    };
  };
  transform.handler = async function (code, id, options) {
    const key =
      cache &&
      compilerTransformKey(
        cache.namespace,
        root,
        id,
        code,
        options?.moduleType ?? "js",
        this.environment.name,
      );
    if (!cache || !key) return handler.call(this, code, id, options);
    try {
      const entry = await cacache.get(cache.directory, key);
      const result = transformResult.parse(
        JSON.parse(entry.data.toString("utf8")),
      );
      stats.hits++;
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EINTEGRITY" || error.code === "EBADSIZE")
      ) {
        try {
          const entry = await cacache.get.info(cache.directory, key);
          if (entry) await cacache.rm.content(cache.directory, entry.integrity);
        } catch (error) {
          if (!warned) {
            this.warn(
              `Unable to remove corrupt React Compiler cache entry: ${String(error)}`,
            );
            warned = true;
          }
        }
      }
      stats.misses++;
      const result = await handler.call(this, code, id, options);
      const parsed = transformResult.safeParse(result);
      if (parsed.success) {
        const serialized = JSON.stringify(parsed.data);
        if (!containsWorktreePath(serialized, root)) {
          try {
            await cacache.put(cache.directory, key, serialized);
          } catch (error) {
            if (!warned) {
              this.warn(
                `Unable to cache React Compiler output: ${String(error)}`,
              );
              warned = true;
            }
          }
        }
      }
      return result;
    }
  };
  const buildEnd = plugin.buildEnd;
  return {
    ...plugin,
    api: { compilerCache: stats },
    async buildEnd(...args) {
      if (buildEnd)
        await (
          typeof buildEnd === "function" ? buildEnd : buildEnd.handler
        ).apply(this, args);
      if (cache)
        console.info(
          `React Compiler cache: ${stats.hits} hits, ${stats.misses} misses`,
        );
    },
  };
}
