import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataDirSkillsRootPath } from "@bb/config/app-storage-paths";
import type { AgentRuntimeSkillRoot } from "@bb/agent-runtime";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";

const STAGING_ROOT_SEGMENTS = ["runtime", "global-skills"] as const;
const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const MAX_STAGED_SKILL_FILES = 1_000;
const MAX_STAGED_SKILL_BYTES = 10 * 1024 * 1024;
const MAX_STAGED_SKILL_DEPTH = 24;
export const EMPTY_SKILL_CATALOG_HASH = createHash("sha256")
  .update("bb-global-skills-v1-empty")
  .digest("hex");

export interface InjectedSkillsLogger {
  debug(context: object, message: string): void;
  warn(context: object, message: string): void;
}

export interface StageInjectedSkillSourcesArgs {
  dataDir: string;
  injectedSkillSources: readonly HostDaemonInjectedSkillSource[];
  logger?: InjectedSkillsLogger;
}

export interface CleanupInjectedSkillStagingDirsArgs {
  dataDir: string;
  keepCatalogHashes: readonly string[];
  logger?: InjectedSkillsLogger;
}

export interface StagedInjectedSkills {
  catalogHash: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

interface CollectedSkillFile {
  bytes: Buffer;
  relativePath: string;
}

interface CollectedSkillDirectory {
  relativePath: string;
}

interface CollectedSkillTree {
  directories: CollectedSkillDirectory[];
  files: CollectedSkillFile[];
  source: HostDaemonInjectedSkillSource;
  totalBytes: number;
}

interface CollectSkillTreeArgs {
  source: HostDaemonInjectedSkillSource;
}

interface WalkSkillTreeArgs {
  currentPath: string;
  depth: number;
  rootPath: string;
  state: SkillTreeCollectionState;
}

interface SkillTreeCollectionState {
  directories: CollectedSkillDirectory[];
  files: CollectedSkillFile[];
  totalBytes: number;
}

interface StageTreeArgs {
  skillDirectoryPath: string;
  tree: CollectedSkillTree;
}

interface WriteStageRootArgs {
  catalogHash: string;
  dataDir: string;
  trees: readonly CollectedSkillTree[];
}

interface BuildSkillRootsArgs {
  catalogHash: string;
  skillNames: readonly string[];
  stageRootPath: string;
}

interface PluginManifestAuthor {
  name: string;
}

interface ClaudePluginManifest {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: PluginManifestAuthor;
  skills: string[];
}

interface CatalogSkillEntry {
  applicationId: string | null;
  description: string;
  name: string;
  sourceRootPath: string;
  sourceType: HostDaemonInjectedSkillSource["sourceType"];
}

interface CatalogFile {
  catalogHash: string;
  generatedAt: string;
  skills: CatalogSkillEntry[];
}

interface CreateCatalogFileArgs {
  catalogHash: string;
  trees: readonly CollectedSkillTree[];
}

export interface InjectedSkillRootsDiagnostics {
  dataDirSkillsRootPath: string;
  stagingRootPath: string;
}

function createNoopLogger(): InjectedSkillsLogger {
  return {
    debug: () => undefined,
    warn: () => undefined,
  };
}

function isFsErrorWithCode(error: Error, code: string): boolean {
  return "code" in error && error.code === code;
}

function resolveStagingRootPath(dataDir: string): string {
  return path.join(dataDir, ...STAGING_ROOT_SEGMENTS);
}

function resolveStageRootPath(dataDir: string, catalogHash: string): string {
  return path.join(resolveStagingRootPath(dataDir), catalogHash);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

function sortTreesByName(
  left: CollectedSkillTree,
  right: CollectedSkillTree,
): number {
  return left.source.name.localeCompare(right.source.name);
}

function assertUsableSource(source: HostDaemonInjectedSkillSource): void {
  if (!SKILL_NAME_PATTERN.test(source.name)) {
    throw new Error(`Invalid injected skill name: ${source.name}`);
  }
  if (!path.isAbsolute(source.sourceRootPath)) {
    throw new Error(
      `Injected skill source root must be absolute: ${source.sourceRootPath}`,
    );
  }
  if (!path.isAbsolute(source.skillFilePath)) {
    throw new Error(
      `Injected skill file path must be absolute: ${source.skillFilePath}`,
    );
  }
  if (!isPathWithinRoot(source.sourceRootPath, source.skillFilePath)) {
    throw new Error(
      `Injected skill file path escapes source root: ${source.skillFilePath}`,
    );
  }
  if (path.basename(source.skillFilePath) !== SKILL_FILE_NAME) {
    throw new Error(
      `Injected skill file path must end with ${SKILL_FILE_NAME}: ${source.skillFilePath}`,
    );
  }
}

async function walkSkillTree(args: WalkSkillTreeArgs): Promise<void> {
  if (args.depth > MAX_STAGED_SKILL_DEPTH) {
    throw new Error(
      `Skill tree exceeds max depth ${MAX_STAGED_SKILL_DEPTH}: ${args.rootPath}`,
    );
  }

  const entries = (await fs.readdir(args.currentPath, {
    withFileTypes: true,
  })).sort(sortDirentsByName);

  for (const entry of entries) {
    const sourcePath = path.join(args.currentPath, entry.name);
    if (!isPathWithinRoot(args.rootPath, sourcePath)) {
      throw new Error(`Skill tree entry escapes source root: ${sourcePath}`);
    }
    const relativePath = normalizeRelativePath(
      path.relative(args.rootPath, sourcePath),
    );
    const entryStat = await fs.lstat(sourcePath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Skill tree contains a symlink: ${sourcePath}`);
    }
    if (entryStat.isDirectory()) {
      args.state.directories.push({ relativePath });
      await walkSkillTree({
        currentPath: sourcePath,
        depth: args.depth + 1,
        rootPath: args.rootPath,
        state: args.state,
      });
      continue;
    }
    if (!entryStat.isFile()) {
      throw new Error(`Skill tree entry is not a regular file: ${sourcePath}`);
    }
    if (args.state.files.length + 1 > MAX_STAGED_SKILL_FILES) {
      throw new Error(
        `Skill tree exceeds max file count ${MAX_STAGED_SKILL_FILES}: ${args.rootPath}`,
      );
    }
    if (args.state.totalBytes + entryStat.size > MAX_STAGED_SKILL_BYTES) {
      throw new Error(
        `Skill tree exceeds max byte count ${MAX_STAGED_SKILL_BYTES}: ${args.rootPath}`,
      );
    }
    const bytes = await fs.readFile(sourcePath);
    args.state.files.push({
      bytes,
      relativePath,
    });
    args.state.totalBytes += entryStat.size;
  }
}

async function collectSkillTree(
  args: CollectSkillTreeArgs,
): Promise<CollectedSkillTree> {
  assertUsableSource(args.source);
  const rootStat = await fs.lstat(args.source.sourceRootPath);
  if (rootStat.isSymbolicLink()) {
    throw new Error(
      `Injected skill source root is a symlink: ${args.source.sourceRootPath}`,
    );
  }
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Injected skill source root is not a directory: ${args.source.sourceRootPath}`,
    );
  }
  const skillFileStat = await fs.lstat(args.source.skillFilePath);
  if (skillFileStat.isSymbolicLink()) {
    throw new Error(
      `Injected skill file is a symlink: ${args.source.skillFilePath}`,
    );
  }
  if (!skillFileStat.isFile()) {
    throw new Error(
      `Injected skill file is not a regular file: ${args.source.skillFilePath}`,
    );
  }

  const state: SkillTreeCollectionState = {
    directories: [],
    files: [],
    totalBytes: 0,
  };
  await walkSkillTree({
    currentPath: args.source.sourceRootPath,
    depth: 0,
    rootPath: args.source.sourceRootPath,
    state,
  });

  return {
    directories: state.directories,
    files: state.files,
    source: args.source,
    totalBytes: state.totalBytes,
  };
}

function hashCollectedTrees(trees: readonly CollectedSkillTree[]): string {
  const hash = createHash("sha256");
  hash.update("bb-global-skills-v1");
  for (const tree of trees) {
    hash.update("\0skill\0");
    hash.update(tree.source.name);
    hash.update("\0");
    hash.update(tree.source.description);
    hash.update("\0");
    hash.update(tree.source.sourceType);
    hash.update("\0");
    hash.update(tree.source.applicationId ?? "");
    hash.update("\0");
    hash.update(tree.source.sourceRootPath);
    for (const file of tree.files) {
      hash.update("\0file\0");
      hash.update(file.relativePath);
      hash.update("\0");
      hash.update(createHash("sha256").update(file.bytes).digest("hex"));
    }
  }
  return hash.digest("hex");
}

async function copyCollectedTree(args: StageTreeArgs): Promise<void> {
  await fs.mkdir(args.skillDirectoryPath, { recursive: true });
  for (const directory of args.tree.directories) {
    await fs.mkdir(path.join(args.skillDirectoryPath, directory.relativePath), {
      recursive: true,
    });
  }
  for (const file of args.tree.files) {
    const destinationPath = path.join(
      args.skillDirectoryPath,
      file.relativePath,
    );
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, file.bytes);
  }
}

function createClaudePluginManifest(
  skillNames: readonly string[],
): ClaudePluginManifest {
  return {
    $schema: "https://anthropic.com/claude-code/plugin.schema.json",
    name: "bb-global-skills",
    version: "0.1.0",
    description: "Global skills staged by bb.",
    author: {
      name: "bb",
    },
    skills: skillNames.map((skillName) => `./skills/${skillName}`),
  };
}

function createCatalogFile(args: CreateCatalogFileArgs): CatalogFile {
  return {
    catalogHash: args.catalogHash,
    generatedAt: new Date().toISOString(),
    skills: args.trees.map((tree) => ({
      applicationId: tree.source.applicationId,
      description: tree.source.description,
      name: tree.source.name,
      sourceRootPath: tree.source.sourceRootPath,
      sourceType: tree.source.sourceType,
    })),
  };
}

async function writeStageRoot(args: WriteStageRootArgs): Promise<string> {
  const stagingRootPath = resolveStagingRootPath(args.dataDir);
  const stageRootPath = resolveStageRootPath(args.dataDir, args.catalogHash);
  try {
    await fs.access(path.join(stageRootPath, "catalog.json"));
    return stageRootPath;
  } catch (error) {
    if (!(error instanceof Error) || !isFsErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }

  await fs.mkdir(stagingRootPath, { recursive: true });
  const tempRootPath = path.join(
    stagingRootPath,
    `.tmp-${args.catalogHash}-${process.pid}-${Date.now()}`,
  );
  await fs.rm(tempRootPath, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRootPath, "skills"), { recursive: true });
  await fs.mkdir(path.join(tempRootPath, ".claude-plugin"), {
    recursive: true,
  });

  try {
    const skillNames = args.trees.map((tree) => tree.source.name);
    for (const tree of args.trees) {
      await copyCollectedTree({
        skillDirectoryPath: path.join(tempRootPath, "skills", tree.source.name),
        tree,
      });
    }
    await fs.writeFile(
      path.join(tempRootPath, ".claude-plugin", "plugin.json"),
      `${JSON.stringify(createClaudePluginManifest(skillNames), null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRootPath, "catalog.json"),
      `${JSON.stringify(
        createCatalogFile({
          catalogHash: args.catalogHash,
          trees: args.trees,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.rename(tempRootPath, stageRootPath);
  } catch (error) {
    if (
      error instanceof Error &&
      (isFsErrorWithCode(error, "EEXIST") ||
        isFsErrorWithCode(error, "ENOTEMPTY"))
    ) {
      await fs.rm(tempRootPath, { recursive: true, force: true });
      return stageRootPath;
    }
    await fs.rm(tempRootPath, { recursive: true, force: true });
    throw error;
  }

  return stageRootPath;
}

function buildSkillRoots(args: BuildSkillRootsArgs): AgentRuntimeSkillRoot[] {
  if (args.skillNames.length === 0) {
    return [];
  }
  return [
    {
      id: `global-skills:${args.catalogHash}:codex`,
      providerId: "codex",
      skillDirectoryRootPath: path.join(args.stageRootPath, "skills"),
    },
    {
      id: `global-skills:${args.catalogHash}:claude-code`,
      providerId: "claude-code",
      localPluginPath: args.stageRootPath,
      skillNames: [...args.skillNames],
    },
  ];
}

export async function stageInjectedSkillSources(
  args: StageInjectedSkillSourcesArgs,
): Promise<StagedInjectedSkills> {
  if (args.injectedSkillSources.length === 0) {
    return {
      catalogHash: EMPTY_SKILL_CATALOG_HASH,
      skillRoots: [],
    };
  }

  const logger = args.logger ?? createNoopLogger();
  const trees: CollectedSkillTree[] = [];
  const sortedSources = [...args.injectedSkillSources].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const source of sortedSources) {
    try {
      trees.push(await collectSkillTree({ source }));
    } catch (error) {
      logger.warn(
        {
          applicationId: source.applicationId,
          name: source.name,
          sourceRootPath: source.sourceRootPath,
          sourceType: source.sourceType,
          reason:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Unable to stage injected skill",
        },
        "Skipping injected skill during staging",
      );
    }
  }

  const sortedTrees = trees.sort(sortTreesByName);
  if (sortedTrees.length === 0) {
    return {
      catalogHash: EMPTY_SKILL_CATALOG_HASH,
      skillRoots: [],
    };
  }

  const catalogHash = hashCollectedTrees(sortedTrees);
  const stageRootPath = await writeStageRoot({
    catalogHash,
    dataDir: args.dataDir,
    trees: sortedTrees,
  });
  const skillNames = sortedTrees.map((tree) => tree.source.name);
  return {
    catalogHash,
    skillRoots: buildSkillRoots({
      catalogHash,
      skillNames,
      stageRootPath,
    }),
  };
}

export async function cleanupInjectedSkillStagingDirs(
  args: CleanupInjectedSkillStagingDirsArgs,
): Promise<void> {
  const stagingRootPath = resolveStagingRootPath(args.dataDir);
  const keep = new Set(args.keepCatalogHashes);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(stagingRootPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  const logger = args.logger ?? createNoopLogger();
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) {
        await fs.rm(path.join(stagingRootPath, entry.name), {
          recursive: true,
          force: true,
        });
        return;
      }
      if (keep.has(entry.name)) {
        return;
      }
      logger.debug(
        {
          catalogHash: entry.name,
          stagingRootPath,
        },
        "Removing unused injected skill staging directory",
      );
      await fs.rm(path.join(stagingRootPath, entry.name), {
        recursive: true,
        force: true,
      });
    }),
  );
}

export function resolveInjectedSkillRootsForDiagnostics(
  dataDir: string,
): InjectedSkillRootsDiagnostics {
  return {
    dataDirSkillsRootPath: resolveDataDirSkillsRootPath(dataDir),
    stagingRootPath: resolveStagingRootPath(dataDir),
  };
}
