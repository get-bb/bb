import { firstPerIdentity, resolveSkillPath } from "@bb/skill-index";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type { AgentRuntimeSkillRoot } from "@bb/agent-runtime";
import {
  hostDaemonSkillTreeManifestSchema,
  type HostDaemonInjectedSkillSource,
  type HostDaemonSkillTreeFile,
  type HostDaemonSkillTreeManifest,
} from "@bb/host-daemon-contract";
import { hashSkillTreeFiles } from "@bb/host-daemon-contract/skill-tree";
import { isPathWithinDirectory } from "@bb/process-utils";
import { SKILL_FILE_NAME } from "./command-discovery.js";
import { isFsErrorWithCode } from "./fs-errors.js";
import { runInSerialLane } from "./serial-lane.js";
import type { SkillTreeTransport } from "./skill-trees.js";
import {
  ChunkReader,
  copyVerifiedFile,
  FileTransferVerificationError,
  hashFile,
  takeExactBytes,
  writeVerifiedFile,
} from "@bb/file-transfer";

const STAGING_ROOT_SEGMENTS = ["runtime", "global-skills"] as const;
const STORE_ROOT_SEGMENTS = ["runtime", "skill-store"] as const;
const STORE_CONTENT_DIR = "content";
const STORE_COMPLETE_MARKER = ".complete";
const STORE_LAST_USED_MARKER = ".last-used";
const STORE_MANIFEST_FILE = "manifest.json";
export const MAX_SKILL_STORE_TREES = 64;
const STALE_TEMP_STAGING_DIR_AGE_MS = 60 * 60 * 1000;
const STAGE_CATALOG_FILE = "catalog.json";
const WINDOWS_RENAME_RETRY_BUDGET_MS = 5_000;
const WINDOWS_TRANSIENT_RENAME_CODES = ["EPERM", "EACCES", "EBUSY"] as const;
const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const MAX_STAGED_SKILL_FILES = 1_000;
const MAX_STAGED_SKILL_DEPTH = 24;
export const EMPTY_SKILL_CATALOG_HASH = createHash("sha256")
  .update("bb-global-skills-v1-empty")
  .digest("hex");

export interface InjectedSkillsLogger {
  debug(context: object, message: string): void;
  warn(context: object, message: string): void;
}

interface StageInjectedSkillSourcesArgs {
  workspacePath: string | null;
  dataDir: string;
  injectedSkillSources: readonly HostDaemonInjectedSkillSource[];
  logger?: InjectedSkillsLogger;
  skillTreeTransport?: SkillTreeTransport;
}

interface CleanupInjectedSkillStagingDirsArgs {
  dataDir: string;
  keepCatalogHashes: readonly string[];
  logger?: InjectedSkillsLogger;
}

interface StagedInjectedSkills {
  catalogHash: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

interface CopyInjectedSkillSourceArgs {
  destinationPath: string;
  name: string;
  sourceRootPath: string;
  skillFilePath: string;
}

interface CollectedSkillFile {
  contentSha256: string;
  mode: number;
  relativePath: string;
  sizeBytes: number;
  sourcePath: string;
}

interface CollectedSkillDirectory {
  relativePath: string;
}

interface CollectedSkillTree {
  directories: CollectedSkillDirectory[];
  files: CollectedSkillFile[];
  source: HostDaemonInjectedSkillSource;
}

interface CollectSkillTreeArgs {
  boundaryPath: string | null;
  source: HostDaemonInjectedSkillSource;
  sourceRootPath: string;
  skillFilePath: string;
}

interface CollectSkillDirectoryArgs {
  boundaryPath: string | null;
  name: string;
  sourceRootPath: string;
  skillFilePath: string;
}

interface WalkSkillTreeArgs {
  boundaryPath: string | null;
  currentPath: string;
  depth: number;
  rootPath: string;
  state: SkillTreeCollectionState;
}

interface SkillTreeCollectionState {
  directories: CollectedSkillDirectory[];
  files: CollectedSkillFile[];
}

interface StageTreeArgs {
  skillDirectoryPath: string;
  tree: SkillTreeCollectionState;
}

interface WriteStageRootArgs {
  catalogHash: string;
  dataDir: string;
  logger: InjectedSkillsLogger;
  skillTreeTransport: SkillTreeTransport | undefined;
  trees: readonly CollectedSkillTree[];
}

interface BuildSkillRootsArgs {
  catalogHash: string;
  stageRootPath: string;
  trees: readonly CollectedSkillTree[];
}

interface CatalogSkillEntry {
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

const MAX_COLLECTED_TREE_MEMOS = 256;
const MAX_COLLECTED_TREE_MEMO_FILES = 16_384;
const MAX_STAGE_ATTEMPTS = 3;

const collectedTreeMemos = new Map<string, SkillTreeCollectionState>();
const scheduledSkillStoreGcs = new Set<string>();
const pendingStageRootWrites = new Map<string, Promise<string>>();
const pendingSkillTreePulls = new Map<string, Promise<string>>();
const skillStoreQueues = new Map<string, Promise<void>>();
const activeSkillTreeStages = new Map<string, Map<string, number>>();

function markActiveSkillTreeStages(
  dataDir: string,
  treeHashes: readonly string[],
): void {
  const counts =
    activeSkillTreeStages.get(dataDir) ?? new Map<string, number>();
  for (const treeHash of treeHashes) {
    counts.set(treeHash, (counts.get(treeHash) ?? 0) + 1);
  }
  activeSkillTreeStages.set(dataDir, counts);
}

function unmarkActiveSkillTreeStages(
  dataDir: string,
  treeHashes: readonly string[],
): void {
  const counts = activeSkillTreeStages.get(dataDir);
  if (!counts) return;
  for (const treeHash of treeHashes) {
    const count = counts.get(treeHash) ?? 0;
    if (count <= 1) counts.delete(treeHash);
    else counts.set(treeHash, count - 1);
  }
  if (counts.size === 0) activeSkillTreeStages.delete(dataDir);
}

function createNoopLogger(): InjectedSkillsLogger {
  return {
    debug: () => undefined,
    warn: () => undefined,
  };
}

function resolveStagingRootPath(dataDir: string): string {
  return path.join(dataDir, ...STAGING_ROOT_SEGMENTS);
}

function resolveStageRootPath(dataDir: string, catalogHash: string): string {
  return path.join(resolveStagingRootPath(dataDir), catalogHash);
}

export async function ensureDataDirSkillsRootPath(
  dataDir: string,
): Promise<string> {
  const dataDirSkillsRootPath = resolveDataDirSkillsRootPath(dataDir);
  await fs.mkdir(dataDirSkillsRootPath, { recursive: true });
  return dataDirSkillsRootPath;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return compareStringsByCodePoint(left.name, right.name);
}

function sortTreesByName(
  left: CollectedSkillTree,
  right: CollectedSkillTree,
): number {
  return compareStringsByCodePoint(left.source.name, right.source.name);
}

function compareStringsByCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUsableSkillDirectory(args: CollectSkillDirectoryArgs): void {
  const { name, sourceRootPath, skillFilePath } = args;
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid injected skill name: ${name}`);
  }
  if (!path.isAbsolute(sourceRootPath)) {
    throw new Error(
      `Injected skill source root must be absolute: ${sourceRootPath}`,
    );
  }
  if (!path.isAbsolute(skillFilePath)) {
    throw new Error(
      `Injected skill file path must be absolute: ${skillFilePath}`,
    );
  }
  if (!isPathWithinDirectory(sourceRootPath, skillFilePath)) {
    throw new Error(
      `Injected skill file path escapes source root: ${skillFilePath}`,
    );
  }
  if (path.basename(skillFilePath) !== SKILL_FILE_NAME) {
    throw new Error(
      `Injected skill file path must end with ${SKILL_FILE_NAME}: ${skillFilePath}`,
    );
  }
}

async function walkSkillTree(args: WalkSkillTreeArgs): Promise<void> {
  if (args.depth > MAX_STAGED_SKILL_DEPTH) {
    throw new Error(
      `Skill tree exceeds max depth ${MAX_STAGED_SKILL_DEPTH}: ${args.rootPath}`,
    );
  }

  const entries = (
    await fs.readdir(args.currentPath, {
      withFileTypes: true,
    })
  ).sort(sortDirentsByName);

  for (const entry of entries) {
    const sourcePath = path.join(args.currentPath, entry.name);
    if (!isPathWithinDirectory(args.rootPath, sourcePath)) {
      throw new Error(`Skill tree entry escapes source root: ${sourcePath}`);
    }
    const relativePath = normalizeRelativePath(
      path.relative(args.rootPath, sourcePath),
    );
    let entryStat = await fs.lstat(sourcePath);
    let readPath = sourcePath;
    if (entryStat.isSymbolicLink()) {
      if (relativePath !== SKILL_FILE_NAME)
        throw new Error(`Skill tree contains a symlink: ${sourcePath}`);
      const resolved = await resolveSkillPath(sourcePath, args.boundaryPath);
      if (resolved === null)
        throw new Error(`Skill entry escapes read root: ${sourcePath}`);
      readPath = resolved;
      entryStat = await fs.stat(readPath);
    }
    if (entryStat.isDirectory()) {
      args.state.directories.push({ relativePath });
      await walkSkillTree({
        boundaryPath: args.boundaryPath,
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
    const hashed = await hashFile(readPath);
    args.state.files.push({
      contentSha256: hashed.sha256,
      mode: entryStat.mode & 0o777,
      relativePath,
      sizeBytes: hashed.sizeBytes,
      sourcePath: readPath,
    });
  }
}

async function collectSkillDirectory(
  args: CollectSkillDirectoryArgs,
): Promise<SkillTreeCollectionState> {
  assertUsableSkillDirectory(args);
  const originalRootStat = await fs.lstat(args.sourceRootPath);
  const realRootPath = await resolveSkillPath(
    args.sourceRootPath,
    args.boundaryPath,
  );
  if (realRootPath === null)
    throw new Error(`Missing injected skill: ${args.sourceRootPath}`);
  args = {
    ...args,
    sourceRootPath: realRootPath,
    skillFilePath: path.join(
      realRootPath,
      path.relative(args.sourceRootPath, args.skillFilePath),
    ),
  };
  const rootStat = originalRootStat.isSymbolicLink()
    ? await fs.stat(args.sourceRootPath)
    : originalRootStat;
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Injected skill source root is not a directory: ${args.sourceRootPath}`,
    );
  }
  const realSkillFile = await resolveSkillPath(
    args.skillFilePath,
    args.boundaryPath,
  );
  if (realSkillFile === null)
    throw new Error(`Skill entry escapes read root: ${args.skillFilePath}`);
  const skillFileStat = await fs.stat(realSkillFile);
  if (!skillFileStat.isFile()) {
    throw new Error(
      `Injected skill file is not a regular file: ${args.skillFilePath}`,
    );
  }

  const state: SkillTreeCollectionState = {
    directories: [],
    files: [],
  };
  await walkSkillTree({
    boundaryPath: args.boundaryPath,
    currentPath: args.sourceRootPath,
    depth: 0,
    rootPath: args.sourceRootPath,
    state,
  });

  return state;
}

function rememberCollectedTree(
  key: string,
  tree: SkillTreeCollectionState,
): void {
  collectedTreeMemos.delete(key);
  collectedTreeMemos.set(key, tree);
  let memoFiles = 0;
  for (const memo of collectedTreeMemos.values())
    memoFiles += memo.files.length;
  for (const [oldestKey, oldest] of collectedTreeMemos) {
    if (
      collectedTreeMemos.size <= MAX_COLLECTED_TREE_MEMOS &&
      memoFiles <= MAX_COLLECTED_TREE_MEMO_FILES
    ) {
      break;
    }
    if (oldestKey === key) continue;
    collectedTreeMemos.delete(oldestKey);
    memoFiles -= oldest.files.length;
  }
}

function recallCollectedTree(key: string): SkillTreeCollectionState | null {
  const tree = collectedTreeMemos.get(key);
  if (tree === undefined) {
    return null;
  }
  rememberCollectedTree(key, tree);
  return tree;
}

function toCollectedSkillTree(
  source: HostDaemonInjectedSkillSource,
  state: SkillTreeCollectionState,
): CollectedSkillTree {
  return {
    directories: state.directories,
    files: state.files,
    source,
  };
}

async function collectSkillTree(
  args: CollectSkillTreeArgs,
): Promise<CollectedSkillTree> {
  return toCollectedSkillTree(
    args.source,
    await collectSkillDirectory({
      boundaryPath: args.boundaryPath,
      name: args.source.name,
      sourceRootPath: args.sourceRootPath,
      skillFilePath: args.skillFilePath,
    }),
  );
}

function storedTreeMemoKey(
  dataDir: string,
  source: Extract<HostDaemonInjectedSkillSource, { kind: "tree" }>,
): string {
  return `tree\0${source.name}\0${dataDir}\0${source.treeHash}\0${source.entryPath}`;
}

export function scheduleSkillStoreGc(
  dataDir: string,
  logger: InjectedSkillsLogger,
): void {
  if (scheduledSkillStoreGcs.has(dataDir)) {
    return;
  }
  scheduledSkillStoreGcs.add(dataDir);
  void runInSerialLane(skillStoreQueues, dataDir, () => {
    scheduledSkillStoreGcs.delete(dataDir);
    return gcSkillStore(dataDir);
  }).catch((error: unknown) => {
    logger.warn(
      {
        reason:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Unable to garbage-collect the skill store",
      },
      "Failed to garbage-collect the skill store",
    );
  });
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
    hash.update(
      tree.source.kind === "tree"
        ? tree.source.treeHash
        : tree.source.sourceRootPath,
    );
    for (const file of tree.files) {
      hash.update("\0file\0");
      hash.update(file.relativePath);
      hash.update("\0");
      hash.update(file.contentSha256);
      hash.update("\0");
      hash.update(file.mode.toString(8));
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
    await copyVerifiedFile({
      destinationPath,
      expected: {
        maxBytes: file.sizeBytes,
        sha256: file.contentSha256,
        sizeBytes: file.sizeBytes,
      },
      label: `Skill file ${file.relativePath}`,
      mode: file.mode,
      sourcePath: file.sourcePath,
    });
  }
}

export async function copyInjectedSkillSource(
  args: CopyInjectedSkillSourceArgs,
): Promise<void> {
  const tree = await collectSkillDirectory({
    boundaryPath: null,
    name: args.name,
    sourceRootPath: args.sourceRootPath,
    skillFilePath: args.skillFilePath,
  });
  await copyCollectedTree({
    skillDirectoryPath: args.destinationPath,
    tree,
  });
}

function createCatalogFile(args: CreateCatalogFileArgs): CatalogFile {
  return {
    catalogHash: args.catalogHash,
    generatedAt: new Date().toISOString(),
    skills: args.trees.map((tree) => ({
      description: tree.source.description,
      name: tree.source.name,
      sourceRootPath:
        tree.source.kind === "tree"
          ? `skill-tree:${tree.source.treeHash}`
          : tree.source.sourceRootPath,
      sourceType: tree.source.sourceType,
    })),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isWindowsTransientRenameError(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    WINDOWS_TRANSIENT_RENAME_CODES.some((code) =>
      isFsErrorWithCode(error, code),
    )
  );
}

async function renameDirectoryIntoPlace(
  sourcePath: string,
  destinationPath: string,
): Promise<"renamed" | "destination-exists"> {
  const deadline = Date.now() + WINDOWS_RENAME_RETRY_BUDGET_MS;
  for (let delayMs = 20; ; delayMs = Math.min(delayMs * 2, 500)) {
    try {
      await fs.rename(sourcePath, destinationPath);
      return "renamed";
    } catch (error) {
      if (
        isFsErrorWithCode(error, "EEXIST") ||
        isFsErrorWithCode(error, "ENOTEMPTY")
      ) {
        return "destination-exists";
      }
      if (!isWindowsTransientRenameError(error)) throw error;
      if (await pathExists(destinationPath)) return "destination-exists";
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function publishDirectory(args: {
  destinationPath: string;
  isComplete: (directoryPath: string) => Promise<boolean>;
  tempRootPath: string;
}): Promise<void> {
  if (
    (await renameDirectoryIntoPlace(
      args.tempRootPath,
      args.destinationPath,
    )) === "renamed" ||
    (await args.isComplete(args.destinationPath))
  ) {
    return;
  }
  await fs.rm(args.destinationPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
  });
  if (
    (await renameDirectoryIntoPlace(
      args.tempRootPath,
      args.destinationPath,
    )) === "renamed" ||
    (await args.isComplete(args.destinationPath))
  ) {
    return;
  }
  throw new Error(
    `Unable to replace incomplete directory ${args.destinationPath}`,
  );
}

async function isStageRootComplete(stageRootPath: string): Promise<boolean> {
  return pathExists(path.join(stageRootPath, STAGE_CATALOG_FILE));
}

async function writeStageRoot(args: WriteStageRootArgs): Promise<string> {
  const stagingRootPath = resolveStagingRootPath(args.dataDir);
  const stageRootPath = resolveStageRootPath(args.dataDir, args.catalogHash);
  if (await isStageRootComplete(stageRootPath)) {
    return stageRootPath;
  }

  await fs.mkdir(stagingRootPath, { recursive: true });
  const tempRootPath = path.join(
    stagingRootPath,
    `.tmp-${args.catalogHash}-${process.pid}-${Date.now()}-${randomUUID()}`,
  );

  try {
    await fs.mkdir(path.join(tempRootPath, "skills"), { recursive: true });
    for (const tree of args.trees) {
      if (tree.source.kind === "tree") {
        if (args.skillTreeTransport === undefined) {
          throw new Error("Skill tree fetch transport is unavailable");
        }
        await ensureStoredSkillTree({
          dataDir: args.dataDir,
          logger: args.logger,
          skillTreeTransport: args.skillTreeTransport,
          treeHash: tree.source.treeHash,
        });
      }
      await copyCollectedTree({
        skillDirectoryPath: path.join(tempRootPath, "skills", tree.source.name),
        tree,
      });
    }
    await fs.writeFile(
      path.join(tempRootPath, STAGE_CATALOG_FILE),
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
    await publishDirectory({
      destinationPath: stageRootPath,
      isComplete: isStageRootComplete,
      tempRootPath,
    });
  } finally {
    await fs.rm(tempRootPath, { recursive: true, force: true });
  }

  return stageRootPath;
}

function stageRootWriteKey(args: WriteStageRootArgs): string {
  return `${args.dataDir}\0${args.catalogHash}`;
}

async function writeStageRootOnce(args: WriteStageRootArgs): Promise<string> {
  const key = stageRootWriteKey(args);
  const pending = pendingStageRootWrites.get(key);
  if (pending) {
    return pending;
  }

  const write = writeStageRoot(args).finally(() => {
    pendingStageRootWrites.delete(key);
  });
  pendingStageRootWrites.set(key, write);
  return write;
}

function buildSkillRoots(args: BuildSkillRootsArgs): AgentRuntimeSkillRoot[] {
  return [
    {
      id: `global-skills:${args.catalogHash}`,
      path: path.join(args.stageRootPath, "skills"),
      skills: args.trees.map((tree) => ({
        name: tree.source.name,
        description: tree.source.description,
      })),
    },
  ];
}

function resolveSkillStoreRootPath(dataDir: string): string {
  return path.join(dataDir, ...STORE_ROOT_SEGMENTS);
}

function resolveStoredTreeRootPath(dataDir: string, treeHash: string): string {
  return path.join(resolveSkillStoreRootPath(dataDir), treeHash);
}

function isSafeTreePath(entryPath: string): boolean {
  const segments = entryPath.split("/");
  return (
    !entryPath.includes("\\") &&
    !path.posix.isAbsolute(entryPath) &&
    !path.win32.isAbsolute(entryPath) &&
    segments.length <= MAX_STAGED_SKILL_DEPTH + 1 &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
}

function validatedManifestFiles(
  manifest: HostDaemonSkillTreeManifest,
  treeHash: string,
): HostDaemonSkillTreeFile[] {
  if (manifest.treeHash !== treeHash) {
    throw new Error(
      `Fetched skill tree hash mismatch: expected ${treeHash}, received ${manifest.treeHash}`,
    );
  }
  if (manifest.files.length > MAX_STAGED_SKILL_FILES) {
    throw new Error(
      `Skill tree exceeds max file count ${MAX_STAGED_SKILL_FILES}`,
    );
  }
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeTreePath(file.path)) {
      throw new Error(`Skill tree entry has unsafe path: ${file.path}`);
    }
    if (paths.has(file.path)) {
      throw new Error(`Skill tree contains duplicate path: ${file.path}`);
    }
    paths.add(file.path);
  }
  const actualHash = hashSkillTreeFiles(manifest.files);
  if (actualHash !== treeHash) {
    throw new Error(
      `Fetched skill tree manifest hash mismatch: expected ${treeHash}, computed ${actualHash}`,
    );
  }
  return [...manifest.files].sort((left, right) =>
    compareStringsByCodePoint(left.path, right.path),
  );
}

export async function hashInstalledSkillDirectory(args: {
  name: string;
  skillDirectoryPath: string;
}): Promise<string | null> {
  try {
    const tree = await collectSkillDirectory({
      boundaryPath: null,
      name: args.name,
      sourceRootPath: args.skillDirectoryPath,
      skillFilePath: path.join(args.skillDirectoryPath, SKILL_FILE_NAME),
    });
    return hashSkillTreeFiles(
      tree.files.map((file) => ({
        path: file.relativePath,
        mode: file.mode,
        sizeBytes: file.sizeBytes,
        sha256: file.contentSha256,
      })),
    );
  } catch {
    return null;
  }
}

async function isStoredTreeComplete(treeRootPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(treeRootPath, STORE_COMPLETE_MARKER));
    return (
      await fs.stat(path.join(treeRootPath, STORE_CONTENT_DIR))
    ).isDirectory();
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function touchStoredTree(treeRootPath: string): Promise<void> {
  await fs.writeFile(path.join(treeRootPath, STORE_LAST_USED_MARKER), "");
}

async function gcSkillStore(dataDir: string): Promise<void> {
  const exemptTreeHashes = new Set(
    activeSkillTreeStages.get(dataDir)?.keys() ?? [],
  );
  const storeRootPath = resolveSkillStoreRootPath(dataDir);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(storeRootPath, { withFileTypes: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) return;
    throw error;
  }
  const completeTrees: { name: string; usedAt: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) {
      continue;
    }
    const treeRootPath = path.join(storeRootPath, entry.name);
    try {
      await fs.access(path.join(treeRootPath, STORE_COMPLETE_MARKER));
      const stat = await fs.stat(
        path.join(treeRootPath, STORE_LAST_USED_MARKER),
      );
      completeTrees.push({ name: entry.name, usedAt: stat.mtimeMs });
    } catch (error) {
      if (!isFsErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
  completeTrees.sort(
    (left, right) =>
      right.usedAt - left.usedAt ||
      compareStringsByCodePoint(left.name, right.name),
  );
  const removalCount = Math.max(
    0,
    completeTrees.length - MAX_SKILL_STORE_TREES,
  );
  const evictionCandidates = completeTrees.filter(
    (entry) => !exemptTreeHashes.has(entry.name),
  );
  await Promise.all(
    evictionCandidates
      .slice(Math.max(0, evictionCandidates.length - removalCount))
      .map((entry) =>
        fs.rm(path.join(storeRootPath, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
}

async function readStoredTreeManifest(
  treeRootPath: string,
): Promise<HostDaemonSkillTreeManifest | null> {
  try {
    return hostDaemonSkillTreeManifestSchema.parse(
      JSON.parse(
        await fs.readFile(path.join(treeRootPath, STORE_MANIFEST_FILE), "utf8"),
      ),
    );
  } catch {
    return null;
  }
}

async function indexStoredFilesBySha256(
  dataDir: string,
): Promise<Map<string, string>> {
  const storeRootPath = resolveSkillStoreRootPath(dataDir);
  const filesBySha256 = new Map<string, string>();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(storeRootPath, { withFileTypes: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) return filesBySha256;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
    const treeRootPath = path.join(storeRootPath, entry.name);
    if (!(await isStoredTreeComplete(treeRootPath))) continue;
    const manifest = await readStoredTreeManifest(treeRootPath);
    for (const file of manifest?.files ?? []) {
      if (!isSafeTreePath(file.path) || filesBySha256.has(file.sha256)) {
        continue;
      }
      filesBySha256.set(
        file.sha256,
        path.join(treeRootPath, STORE_CONTENT_DIR, ...file.path.split("/")),
      );
    }
  }
  return filesBySha256;
}

function isRecoverableLocalCopyError(error: unknown): boolean {
  return (
    error instanceof FileTransferVerificationError ||
    isFsErrorWithCode(error, "ENOENT") ||
    isFsErrorWithCode(error, "EISDIR")
  );
}

function storedFileExpectation(file: HostDaemonSkillTreeFile) {
  return {
    maxBytes: file.sizeBytes,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
  };
}

async function downloadTreeFiles(args: {
  contentRootPath: string;
  files: readonly HostDaemonSkillTreeFile[];
  skillTreeTransport: SkillTreeTransport;
  treeHash: string;
}): Promise<void> {
  const reader = new ChunkReader(
    await args.skillTreeTransport.fetchContent(
      args.treeHash,
      args.files.map((file) => file.path),
    ),
  );
  try {
    for (const file of args.files) {
      await writeVerifiedFile({
        destinationPath: path.join(
          args.contentRootPath,
          ...file.path.split("/"),
        ),
        durable: false,
        expected: storedFileExpectation(file),
        label: `Skill tree file ${file.path}`,
        mode: { kind: "exact", mode: file.mode },
        source: takeExactBytes(reader, file.sizeBytes),
      });
    }
    await reader.assertEnded();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function pullTreeIntoStore(args: {
  dataDir: string;
  logger: InjectedSkillsLogger;
  skillTreeTransport: SkillTreeTransport;
  treeHash: string;
}): Promise<string> {
  const manifest = await args.skillTreeTransport.fetchManifest(args.treeHash);
  const files = validatedManifestFiles(manifest, args.treeHash);

  const storeRootPath = resolveSkillStoreRootPath(args.dataDir);
  const treeRootPath = resolveStoredTreeRootPath(args.dataDir, args.treeHash);
  await fs.mkdir(storeRootPath, { recursive: true });
  const tempRootPath = path.join(
    storeRootPath,
    `.tmp-${args.treeHash}-${process.pid}-${Date.now()}-${randomUUID()}`,
  );
  const contentRootPath = path.join(tempRootPath, STORE_CONTENT_DIR);
  const storedFiles = await indexStoredFilesBySha256(args.dataDir);
  const downloads: HostDaemonSkillTreeFile[] = [];
  const downloadShas = new Set<string>();
  const duplicates: HostDaemonSkillTreeFile[] = [];
  const pulledFiles = new Map<string, string>();
  let reusedFiles = 0;
  try {
    await fs.mkdir(contentRootPath, { recursive: true });
    for (const file of files) {
      const destinationPath = path.join(
        contentRootPath,
        ...file.path.split("/"),
      );
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      const storedPath = storedFiles.get(file.sha256);
      if (storedPath !== undefined && !pulledFiles.has(file.sha256)) {
        try {
          await copyVerifiedFile({
            destinationPath,
            expected: storedFileExpectation(file),
            label: `Stored skill file ${file.path}`,
            mode: file.mode,
            sourcePath: storedPath,
          });
          pulledFiles.set(file.sha256, destinationPath);
          reusedFiles += 1;
          continue;
        } catch (error) {
          if (!isRecoverableLocalCopyError(error)) throw error;
        }
      }
      if (pulledFiles.has(file.sha256) || downloadShas.has(file.sha256)) {
        duplicates.push(file);
        continue;
      }
      downloads.push(file);
      downloadShas.add(file.sha256);
    }
    if (downloads.length > 0) {
      await downloadTreeFiles({
        contentRootPath,
        files: downloads,
        skillTreeTransport: args.skillTreeTransport,
        treeHash: args.treeHash,
      });
      for (const file of downloads) {
        pulledFiles.set(
          file.sha256,
          path.join(contentRootPath, ...file.path.split("/")),
        );
      }
    }
    for (const file of duplicates) {
      const sourcePath = pulledFiles.get(file.sha256);
      if (sourcePath === undefined) {
        throw new Error(`Missing pulled skill file for ${file.path}`);
      }
      await copyVerifiedFile({
        destinationPath: path.join(contentRootPath, ...file.path.split("/")),
        expected: storedFileExpectation(file),
        label: `Skill tree file ${file.path}`,
        mode: file.mode,
        sourcePath,
      });
    }
    await fs.writeFile(
      path.join(tempRootPath, STORE_MANIFEST_FILE),
      `${JSON.stringify(manifest)}\n`,
    );
    await fs.writeFile(path.join(tempRootPath, STORE_LAST_USED_MARKER), "");
    await fs.writeFile(
      path.join(tempRootPath, STORE_COMPLETE_MARKER),
      "complete\n",
    );
    await publishDirectory({
      destinationPath: treeRootPath,
      isComplete: isStoredTreeComplete,
      tempRootPath,
    });
  } finally {
    await fs.rm(tempRootPath, { recursive: true, force: true });
  }
  args.logger.debug(
    {
      downloadedBytes: downloads.reduce(
        (total, file) => total + file.sizeBytes,
        0,
      ),
      downloadedFiles: downloads.length,
      reusedFiles,
      treeHash: args.treeHash,
    },
    "Pulled injected skill tree",
  );
  await touchStoredTree(treeRootPath);
  return path.join(treeRootPath, STORE_CONTENT_DIR);
}

export async function ensureStoredSkillTree(args: {
  dataDir: string;
  logger: InjectedSkillsLogger;
  skillTreeTransport: SkillTreeTransport;
  treeHash: string;
}): Promise<string> {
  const key = `${args.dataDir}\0${args.treeHash}`;
  const pending = pendingSkillTreePulls.get(key);
  if (pending) {
    return pending;
  }
  const pull = runInSerialLane(skillStoreQueues, args.dataDir, async () => {
    const treeRootPath = resolveStoredTreeRootPath(args.dataDir, args.treeHash);
    if (await isStoredTreeComplete(treeRootPath)) {
      await touchStoredTree(treeRootPath);
      return path.join(treeRootPath, STORE_CONTENT_DIR);
    }
    return pullTreeIntoStore(args);
  }).finally(() => pendingSkillTreePulls.delete(key));
  pendingSkillTreePulls.set(key, pull);
  return pull;
}

async function collectInjectedSkillTrees(
  args: StageInjectedSkillSourcesArgs,
  logger: InjectedSkillsLogger,
  sortedSources: readonly HostDaemonInjectedSkillSource[],
): Promise<{ pulledStoredTree: boolean; trees: CollectedSkillTree[] }> {
  const trees: CollectedSkillTree[] = [];
  let pulledStoredTree = false;
  for (const source of sortedSources) {
    if (source.kind === "tree") {
      const memoKey = storedTreeMemoKey(args.dataDir, source);
      const remembered = recallCollectedTree(memoKey);
      if (remembered !== null) {
        trees.push(toCollectedSkillTree(source, remembered));
        continue;
      }
      try {
        if (args.skillTreeTransport === undefined) {
          throw new Error("Skill tree fetch transport is unavailable");
        }
        pulledStoredTree = true;
        const sourceRootPath = await ensureStoredSkillTree({
          dataDir: args.dataDir,
          logger,
          skillTreeTransport: args.skillTreeTransport,
          treeHash: source.treeHash,
        });
        const skillFilePath = path.resolve(sourceRootPath, source.entryPath);
        if (!isPathWithinDirectory(sourceRootPath, skillFilePath)) {
          throw new Error(
            `Injected skill entry path escapes tree: ${source.entryPath}`,
          );
        }
        const tree = await collectSkillTree({
          boundaryPath: sourceRootPath,
          source,
          sourceRootPath,
          skillFilePath,
        });
        rememberCollectedTree(memoKey, tree);
        trees.push(tree);
      } catch (error) {
        logger.warn(
          {
            name: source.name,
            treeHash: source.treeHash,
            sourceType: source.sourceType,
            reason:
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : "Unable to pull injected skill tree",
          },
          "Failed to pull required injected skill tree",
        );
        throw error;
      }
      continue;
    }
    try {
      const project =
        source.sourceType === "project" ||
        source.sourceType === "shared-project";
      if (project && args.workspacePath === null)
        throw new Error("Project skill staging requires a workspace");
      trees.push(
        await collectSkillTree({
          boundaryPath: project ? args.workspacePath : null,
          source,
          sourceRootPath: source.sourceRootPath,
          skillFilePath: source.skillFilePath,
        }),
      );
    } catch (error) {
      logger.warn(
        {
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
  return { pulledStoredTree, trees };
}

async function stageCollectedTrees(
  args: StageInjectedSkillSourcesArgs,
  logger: InjectedSkillsLogger,
  trees: CollectedSkillTree[],
): Promise<StagedInjectedSkills> {
  const sortedTrees = firstPerIdentity(trees.sort(sortTreesByName), (tree) =>
    JSON.stringify([
      tree.source.name,
      tree.files
        .map((file): [string, string] => [
          file.relativePath,
          file.contentSha256,
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    ]),
  );
  if (sortedTrees.length === 0) {
    return {
      catalogHash: EMPTY_SKILL_CATALOG_HASH,
      skillRoots: [],
    };
  }

  const catalogHash = hashCollectedTrees(sortedTrees);
  const stageRootPath = await writeStageRootOnce({
    catalogHash,
    dataDir: args.dataDir,
    logger,
    skillTreeTransport: args.skillTreeTransport,
    trees: sortedTrees,
  });
  return {
    catalogHash,
    skillRoots: buildSkillRoots({
      catalogHash,
      stageRootPath,
      trees: sortedTrees,
    }),
  };
}

function isSourceChangedDuringStage(error: unknown): boolean {
  return (
    error instanceof FileTransferVerificationError ||
    isFsErrorWithCode(error, "ENOENT")
  );
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
  const sortedSources = [...args.injectedSkillSources].sort((left, right) =>
    compareStringsByCodePoint(left.name, right.name),
  );
  const stagedTreeHashes = sortedSources.flatMap((source) =>
    source.kind === "tree" ? [source.treeHash] : [],
  );
  let pulledStoredTree = false;
  markActiveSkillTreeStages(args.dataDir, stagedTreeHashes);
  try {
    for (let attempt = 1; ; attempt += 1) {
      const collected = await collectInjectedSkillTrees(
        args,
        logger,
        sortedSources,
      );
      pulledStoredTree ||= collected.pulledStoredTree;
      try {
        return await stageCollectedTrees(args, logger, collected.trees);
      } catch (error) {
        if (attempt >= MAX_STAGE_ATTEMPTS || !isSourceChangedDuringStage(error))
          throw error;
        logger.debug(
          {
            attempt,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Injected skill source changed during staging; retrying",
        );
      }
    }
  } finally {
    unmarkActiveSkillTreeStages(args.dataDir, stagedTreeHashes);
    if (pulledStoredTree) {
      scheduleSkillStoreGc(args.dataDir, logger);
    }
  }
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
    if (isFsErrorWithCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  const logger = args.logger ?? createNoopLogger();
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(stagingRootPath, entry.name);
      if (entry.name.startsWith(".tmp-")) {
        let mtimeMs: number;
        try {
          mtimeMs = (await fs.stat(entryPath)).mtimeMs;
        } catch (error) {
          if (isFsErrorWithCode(error, "ENOENT")) {
            return;
          }
          throw error;
        }
        if (Date.now() - mtimeMs < STALE_TEMP_STAGING_DIR_AGE_MS) {
          return;
        }
        await fs.rm(entryPath, { recursive: true, force: true });
        return;
      }
      if (!entry.isDirectory()) {
        await fs.rm(entryPath, { recursive: true, force: true });
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
      await fs.rm(entryPath, {
        recursive: true,
        force: true,
      });
    }),
  );
}
