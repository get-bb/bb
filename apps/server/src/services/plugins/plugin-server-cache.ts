import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import { isFsErrorWithCode } from "../lib/fs-errors.js";
import {
  buildPluginServer,
  PLUGIN_TOOLCHAIN_PINS,
  pluginBuildCodeDigest,
  type PluginBuildToolchain,
} from "@bb/plugin-build";

const PLUGIN_SERVER_RUNTIME_FORMAT_VERSION = 5;
const RETAINED_PLUGIN_SERVER_ARTIFACTS = 4;
const FILESYSTEM_CONCURRENCY = 64;
const COARSE_TIMESTAMP_SLACK_MS = 2000;
const BUILD_RECORD_FILE = "build.json";
const ARTIFACT_FILES = ["server.cjs", "server.cjs.map", "server.meta.json"];
const RESOLUTION_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
];
const TSCONFIG_FILES = new Set(["tsconfig.json", "jsconfig.json"]);
const TSCONFIG_EXTENDS = /"extends"\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/u;

const pathStatSchema = z.object({
  size: z.number(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  ino: z.number(),
});

const trackedPathSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["file", "directory"]),
    path: z.string(),
    stat: pathStatSchema,
    digest: z.string(),
  }),
  z.object({ kind: z.literal("absent"), path: z.string() }),
]);

const buildRecordSchema = z.object({
  configKey: z.string(),
  artifactDigest: z.string(),
  warnings: z.array(z.string()),
  tracked: z.array(trackedPathSchema),
});

type PathStat = z.infer<typeof pathStatSchema>;
type TrackedPath = z.infer<typeof trackedPathSchema>;
type BuildRecord = z.infer<typeof buildRecordSchema>;

interface CachedPluginServerArgs {
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
}

interface CachedPluginServer {
  path: string;
  digest: string;
  warnings: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function hashDirectoryListing(path: string): Promise<string> {
  const entries = await readdir(path, { withFileTypes: true });
  const names = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) {
        return `${entry.name}\0link\0${await readlink(join(path, entry.name))}`;
      }
      return `${entry.name}\0${entry.isDirectory() ? "directory" : "file"}`;
    }),
  );
  return sha256(names.sort().join("\n"));
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (
      error instanceof Error &&
      (isFsErrorWithCode(error, "ENOENT") ||
        isFsErrorWithCode(error, "ENOTDIR"))
    ) {
      return null;
    }
    throw error;
  }
}

function toPathStat(stats: Stats): PathStat {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    ino: stats.ino,
  };
}

function changedSince(stats: Stats, sinceMs: number): boolean {
  return [stats.mtimeMs, stats.ctimeMs].some(
    (time) =>
      time >=
      (time % 1000 === 0 ? sinceMs - COARSE_TIMESTAMP_SLACK_MS : sinceMs),
  );
}

async function everyWithConcurrency<T>(
  items: readonly T[],
  visit: (item: T) => Promise<boolean>,
): Promise<boolean> {
  let next = 0;
  let passed = true;
  const worker = async () => {
    while (passed && next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined && !(await visit(item))) passed = false;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(FILESYSTEM_CONCURRENCY, items.length) },
      worker,
    ),
  );
  return passed;
}

async function observePath(
  path: string,
  builtSinceMs: number,
): Promise<TrackedPath | null> {
  const before = await statOrNull(path);
  if (before === null) return { kind: "absent", path };
  if (!before.isFile() && !before.isDirectory()) return null;
  const kind = before.isDirectory() ? "directory" : "file";
  const digest =
    kind === "directory"
      ? await hashDirectoryListing(path)
      : await hashFile(path);
  const after = await stat(path);
  if (after.isDirectory() !== before.isDirectory()) return null;
  if (changedSince(after, builtSinceMs)) return null;
  return { kind, path, stat: toPathStat(after), digest };
}

async function isPathUnchanged(tracked: TrackedPath): Promise<boolean> {
  const current = await statOrNull(tracked.path);
  if (tracked.kind === "absent") return current === null;
  if (current === null) return false;
  if ((tracked.kind === "directory") !== current.isDirectory()) return false;
  const { size, mtimeMs, ctimeMs, ino } = toPathStat(current);
  if (
    size === tracked.stat.size &&
    mtimeMs === tracked.stat.mtimeMs &&
    ctimeMs === tracked.stat.ctimeMs &&
    ino === tracked.stat.ino
  ) {
    return true;
  }
  const digest =
    tracked.kind === "directory"
      ? await hashDirectoryListing(tracked.path)
      : await hashFile(tracked.path);
  return digest === tracked.digest;
}

function isWithin(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function ancestors(path: string): string[] {
  const directories: string[] = [];
  for (let directory = path; ; directory = dirname(directory)) {
    directories.push(directory);
    if (dirname(directory) === directory) return directories;
  }
}

function tsconfigExtendsCandidates(configPath: string, source: string) {
  const match = TSCONFIG_EXTENDS.exec(source);
  if (match?.[1] === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const specifiers = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (specifier): specifier is string => typeof specifier === "string",
  );
  return specifiers.flatMap((specifier) => {
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      const base = resolve(dirname(configPath), specifier);
      return [base, `${base}.json`];
    }
    return ancestors(dirname(configPath)).flatMap((directory) => {
      const base = join(directory, "node_modules", specifier);
      return [
        base,
        `${base}.json`,
        join(base, "tsconfig.json"),
        join(base, "package.json"),
      ];
    });
  });
}

async function snapshotBuildInputs(
  rootDir: string,
  inputs: readonly string[],
  builtSinceMs: number,
): Promise<TrackedPath[] | null> {
  const sourceRoot = await realpath(rootDir);
  const paths = new Set<string>(inputs);
  const visited = new Set<string>();
  for (const input of inputs) {
    paths.add(dirname(input));
    const listAncestors = isWithin(sourceRoot, input);
    for (const directory of ancestors(dirname(input))) {
      if (visited.has(directory)) break;
      visited.add(directory);
      if (listAncestors && isWithin(sourceRoot, directory)) {
        paths.add(directory);
      }
      for (const name of RESOLUTION_CONFIG_FILES) {
        paths.add(join(directory, name));
      }
    }
  }
  const tracked = new Map<string, TrackedPath>();
  let pending = [...paths];
  while (pending.length > 0) {
    const discovered: string[] = [];
    const complete = await everyWithConcurrency(pending, async (path) => {
      if (tracked.has(path)) return true;
      const observed = await observePath(path, builtSinceMs).catch(() => null);
      if (observed === null) return false;
      tracked.set(path, observed);
      if (observed.kind === "file" && TSCONFIG_FILES.has(basename(path))) {
        const source = await readFile(path, "utf8").catch(() => "");
        discovered.push(...tsconfigExtendsCandidates(path, source));
      }
      return true;
    });
    if (!complete) return null;
    pending = discovered.filter((path) => !tracked.has(path));
  }
  return [...tracked.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

async function pluginServerConfigKey(
  args: CachedPluginServerArgs,
): Promise<string> {
  return sha256(
    JSON.stringify({
      formatVersion: PLUGIN_SERVER_RUNTIME_FORMAT_VERSION,
      buildCode: await pluginBuildCodeDigest(),
      pluginId: args.pluginId,
      rootDir: args.rootDir,
      serverEntry: args.validatedConfig.serverEntry,
      packageName: args.validatedConfig.packageName,
      pluginVersion: args.validatedConfig.pluginVersion,
      sdkVersion: args.sdkVersion,
      bbVersion: args.bbVersion,
      nodeVersion: process.versions.node,
      toolchain: PLUGIN_TOOLCHAIN_PINS,
      runtimeImports: Object.entries(args.runtimeImports)
        .map(([specifier, entry]) => [
          specifier,
          entry.path,
          entry.external === true,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    }),
  );
}

async function readBuildRecord(directory: string): Promise<BuildRecord | null> {
  try {
    return buildRecordSchema.parse(
      JSON.parse(await readFile(join(directory, BUILD_RECORD_FILE), "utf8")),
    );
  } catch {
    return null;
  }
}

async function hasArtifactFiles(directory: string): Promise<boolean> {
  const states = await Promise.all(
    ARTIFACT_FILES.map((file) =>
      stat(join(directory, file))
        .then((value) => value.isFile())
        .catch(() => false),
    ),
  );
  return states.every(Boolean);
}

async function listBuildDirectories(
  pluginCacheDir: string,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  let entries;
  try {
    entries = await readdir(pluginCacheDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const path = join(pluginCacheDir, entry.name);
        return { path, mtimeMs: (await stat(path)).mtimeMs };
      }),
  );
  return directories.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function findCurrentBuild(
  pluginCacheDir: string,
  configKey: string,
): Promise<{ directory: string; record: BuildRecord } | null> {
  for (const { path } of await listBuildDirectories(pluginCacheDir)) {
    const record = await readBuildRecord(path);
    if (record === null || record.configKey !== configKey) continue;
    if (!(await hasArtifactFiles(path))) continue;
    const current = await everyWithConcurrency(record.tracked, (tracked) =>
      isPathUnchanged(tracked).catch(() => false),
    );
    if (current) return { directory: path, record };
  }
  return null;
}

async function prunePluginServerCache(
  pluginCacheDir: string,
  currentBuildDir: string,
): Promise<void> {
  const stale = (await listBuildDirectories(pluginCacheDir))
    .filter(({ path }) => path !== currentBuildDir)
    .slice(RETAINED_PLUGIN_SERVER_ARTIFACTS - 1);
  await Promise.all(
    stale.map(({ path }) => rm(path, { recursive: true, force: true })),
  );
}

function cachedResult(
  directory: string,
  record: Pick<BuildRecord, "artifactDigest" | "warnings">,
): CachedPluginServer {
  return {
    path: join(directory, "server.cjs"),
    digest: record.artifactDigest,
    warnings: record.warnings,
  };
}

export async function buildCachedPluginServer(
  args: CachedPluginServerArgs,
): Promise<CachedPluginServer> {
  const configKey = await pluginServerConfigKey(args);
  const pluginCacheDir = join(
    args.dataDir,
    "plugins",
    "runtime",
    "server",
    sha256(args.pluginId),
  );
  const existing = await findCurrentBuild(pluginCacheDir, configKey);
  if (existing !== null) {
    const now = new Date();
    await utimes(existing.directory, now, now).catch(() => undefined);
    return cachedResult(existing.directory, existing.record);
  }
  await mkdir(pluginCacheDir, { recursive: true });
  const stageDir = await mkdtemp(join(pluginCacheDir, ".stage-"));
  try {
    const builtSinceMs = (await stat(stageDir)).mtimeMs;
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
    const tracked = await snapshotBuildInputs(
      args.rootDir,
      built.inputs,
      builtSinceMs,
    ).catch(() => null);
    const artifact = {
      artifactDigest: await hashFile(built.jsPath),
      warnings: built.migrationWarnings,
    };
    if (tracked !== null) {
      const record: BuildRecord = { configKey, ...artifact, tracked };
      await writeFile(
        join(stageDir, BUILD_RECORD_FILE),
        JSON.stringify(record),
      );
    }
    const buildDir = join(pluginCacheDir, randomUUID());
    await rename(stageDir, buildDir);
    await prunePluginServerCache(pluginCacheDir, buildDir);
    return cachedResult(buildDir, artifact);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
