import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildPluginServer,
  PLUGIN_TOOLCHAIN_PINS,
  type PluginBuildToolchain,
} from "@bb/plugin-build";

const PLUGIN_SERVER_RUNTIME_FORMAT_VERSION = 4;
const RETAINED_PLUGIN_SERVER_ARTIFACTS = 4;

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function pluginServerCacheDirectory(args: {
  dataDir: string;
  pluginId: string;
  rootDir: string;
  artifactDigest: string;
  sdkVersion: string;
  bbVersion: string;
  nodeVersion?: string;
}): string {
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        artifactDigest: args.artifactDigest,
        rootDir: args.rootDir,
        sdkVersion: args.sdkVersion,
        bbVersion: args.bbVersion,
        nodeVersion: args.nodeVersion ?? process.versions.node,
        formatVersion: PLUGIN_SERVER_RUNTIME_FORMAT_VERSION,
        toolchain: PLUGIN_TOOLCHAIN_PINS,
      }),
    )
    .digest("hex");
  const pluginKey = createHash("sha256").update(args.pluginId).digest("hex");
  return join(args.dataDir, "plugins", "runtime", "server", pluginKey, key);
}

async function isCompleteCacheEntry(directory: string): Promise<boolean> {
  const files = ["server.cjs", "server.cjs.map", "server.meta.json"];
  const states = await Promise.all(
    files.map((file) =>
      stat(join(directory, file))
        .then((value) => value.isFile())
        .catch(() => false),
    ),
  );
  return states.every(Boolean);
}

async function prunePluginServerCache(
  pluginCacheDir: string,
  currentCacheDir: string,
): Promise<void> {
  const entries = await readdir(pluginCacheDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".stage-") &&
          join(pluginCacheDir, entry.name) !== currentCacheDir,
      )
      .map(async (entry) => {
        const path = join(pluginCacheDir, entry.name);
        return { path, mtimeMs: (await stat(path)).mtimeMs };
      }),
  );
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(
    candidates
      .slice(RETAINED_PLUGIN_SERVER_ARTIFACTS - 1)
      .map(({ path }) => rm(path, { recursive: true, force: true })),
  );
}

export async function buildCachedPluginServer(args: {
  rootDir: string;
  dataDir: string;
  pluginId: string;
  sdkVersion: string;
  bbVersion: string;
  validatedConfig: {
    serverEntry: string;
    packageName: string;
    pluginVersion: string;
  };
  toolchain: () => Promise<PluginBuildToolchain>;
  runtimeImports: Record<string, { path: string; external?: boolean }>;
  fallbackResolve: (specifier: string) => string | undefined;
}): Promise<{ path: string; digest: string }> {
  const pluginCacheDir = dirname(
    pluginServerCacheDirectory({
      dataDir: args.dataDir,
      pluginId: args.pluginId,
      rootDir: args.rootDir,
      artifactDigest: "pending",
      sdkVersion: args.sdkVersion,
      bbVersion: args.bbVersion,
    }),
  );
  await mkdir(pluginCacheDir, { recursive: true });
  const stageDir = await mkdtemp(join(pluginCacheDir, ".stage-"));
  try {
    const built = await buildPluginServer(
      args.rootDir,
      args.bbVersion,
      await args.toolchain(),
      {
        outDir: stageDir,
        format: "cjs",
        validatedConfig: args.validatedConfig,
        runtimeImports: args.runtimeImports,
        fallbackResolve: args.fallbackResolve,
        preserveSourceModuleLocation: true,
        externalizeSourceOutsideRoot: true,
      },
    );
    const digest = await hashFile(built.jsPath);
    const cacheDir = pluginServerCacheDirectory({
      dataDir: args.dataDir,
      pluginId: args.pluginId,
      rootDir: args.rootDir,
      artifactDigest: digest,
      sdkVersion: args.sdkVersion,
      bbVersion: args.bbVersion,
    });
    if (await isCompleteCacheEntry(cacheDir)) {
      await prunePluginServerCache(pluginCacheDir, cacheDir);
      return { path: join(cacheDir, "server.cjs"), digest };
    }
    try {
      await rename(stageDir, cacheDir);
    } catch (error) {
      if (!(await isCompleteCacheEntry(cacheDir))) throw error;
    }
    await prunePluginServerCache(pluginCacheDir, cacheDir);
    return { path: join(cacheDir, "server.cjs"), digest };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
