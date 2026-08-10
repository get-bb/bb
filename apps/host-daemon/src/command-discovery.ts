import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  DiscoveredSkill,
  HostCommandOrigin,
  HostCommandSource,
  HostProviderCommand,
  SkillRootKind,
} from "@bb/host-daemon-contract";

const SKILL_FILE_NAME = "SKILL.md";
const MARKDOWN_FILE_EXTENSION = ".md";
const FRONTMATTER_DELIMITER = "---";

// Bound each discovery request so a pathological tree cannot stall discovery
// or exhaust memory.
const MAX_SCAN_DEPTH = 24;
const MAX_SCAN_ENTRY_COUNT = 1_000;

/**
 * Scan shape for a root:
 * - `skill`: one level of `<root>/<dir>/SKILL.md`; the command name is the
 *   parent directory name. User-origin skill entries/files may be symlinks
 *   because personal provider skill installs commonly use them; project-origin
 *   skill entry/file symlinks are skipped.
 * - `skill-recursive`: every `SKILL.md` below `<root>`; the command name is the
 *   name of the directory that contains the file. Symlinks are not followed.
 * - `skill-directory`: a single `<root>/SKILL.md` skill directory; the command
 *   name is the root directory name.
 * - `skill-file`: a single `SKILL.md`; the command name comes from frontmatter
 *   `name`, with `fallbackName` when absent. This covers plugin-root skills.
 * - `command`: recursive `<root>/**​/*.md`; the command name is the path under
 *   the root with `/` replaced by `:` and the `.md` extension dropped
 *   (namespacing, e.g. `frontend/component.md` -> `frontend:component`).
 * - `command-file`: a single command markdown file; the command name is the
 *   file name without `.md`.
 */
export type CommandScanShape =
  | "skill"
  | "skill-recursive"
  | "skill-directory"
  | "skill-file"
  | "command"
  | "command-file";

interface CommandScanRootBase {
  /** Prefix prepended to the derived invocation name, e.g. `plugin-name:`. */
  namePrefix: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
  /** Stable root identity for native skill roots that share one root kind. */
  skillIdentitySeed?: string;
}

export interface CommandScanDirectoryRoot extends CommandScanRootBase {
  /** Optional boundary that a project-origin recursive root must stay within. */
  boundaryPath?: string;
  /** Absolute directory to scan. Missing dir -> no records (no throw). */
  rootPath: string;
  shape: "skill" | "skill-recursive" | "skill-directory" | "command";
}

export interface CommandScanFileRoot extends CommandScanRootBase {
  /** Absolute file to scan. Missing file -> no record (no throw). */
  filePath: string;
  shape: "command-file";
}

export interface CommandScanSkillFileRoot extends CommandScanRootBase {
  /** Fallback command name used when the file has no frontmatter `name`. */
  fallbackName: string;
  /** Absolute SKILL.md file to scan. Missing file -> no record (no throw). */
  filePath: string;
  shape: "skill-file";
  source: "skill";
}

export type CommandScanRoot =
  | CommandScanDirectoryRoot
  | CommandScanFileRoot
  | CommandScanSkillFileRoot;

export interface DiscoverProviderCommandsArgs {
  roots: readonly CommandScanRoot[];
}

interface ScanRootArgs {
  budget: ScanBudget;
  root: CommandScanRoot;
}

interface ScanBudget {
  remainingEntries: number;
}

interface SkillDirectoryCheckArgs {
  entry: Dirent;
  entryPath: string;
  root: CommandScanDirectoryRoot;
}

interface WalkMarkdownTreeArgs {
  budget: ScanBudget;
  currentPath: string;
  depth: number;
  matchedFiles: string[];
  matches: (entry: Dirent) => boolean;
}

interface ParsedFrontmatter {
  name: string | null;
  description: string | null;
  argumentHint: string | null;
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

async function readDirEntries(
  dirPath: string,
  budget?: ScanBudget,
): Promise<Dirent[] | null> {
  try {
    const directory = await fs.opendir(dirPath);
    const entries: Dirent[] = [];
    for await (const entry of directory) {
      if (budget?.remainingEntries === 0) {
        break;
      }
      if (budget !== undefined) {
        budget.remainingEntries -= 1;
      }
      entries.push(entry);
    }
    return entries.sort(sortDirentsByName);
  } catch {
    // Any directory that can't be enumerated — missing (ENOENT), not a
    // directory (ENOTDIR), or unreadable (EACCES/EPERM) — contributes no
    // records. Discovery degrades per-root rather than failing the whole
    // command list, so one locked-down dir never blanks the typeahead.
    return null;
  }
}

// Conservative, intentional gate: only the canonical `---\n` / `---\r\n` opener
// is treated as frontmatter before handing off to gray-matter. Anything else
// (incl. BOM-prefixed or `---<tab>` openers) yields a name-only record rather
// than risking gray-matter's looser, historically-quirky delimiter detection.
function hasSupportedFrontmatterDelimiter(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith(`${FRONTMATTER_DELIMITER}\n`) ||
    trimmed.startsWith(`${FRONTMATTER_DELIMITER}\r\n`)
  );
}

function readFrontmatterString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a file's YAML frontmatter for `description` and `argument-hint`.
 * Malformed/absent frontmatter yields a name-only record (both fields null) —
 * discovery never throws on a single bad file.
 */
async function parseFrontmatter(filePath: string): Promise<ParsedFrontmatter> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return { name: null, description: null, argumentHint: null };
  }

  if (!hasSupportedFrontmatterDelimiter(content)) {
    return { name: null, description: null, argumentHint: null };
  }

  let data: Record<string, unknown>;
  try {
    data = matter(content).data;
  } catch {
    return { name: null, description: null, argumentHint: null };
  }

  return {
    name: readFrontmatterString(data, "name"),
    description: readFrontmatterString(data, "description"),
    argumentHint: readFrontmatterString(data, "argument-hint"),
  };
}

function canFollowSkillSymlink(root: CommandScanRoot): boolean {
  return root.origin === "user" && root.source === "skill";
}

async function isSkillDirectory(
  args: SkillDirectoryCheckArgs,
): Promise<boolean> {
  if (args.entry.isDirectory()) {
    return true;
  }
  if (!args.entry.isSymbolicLink() || !canFollowSkillSymlink(args.root)) {
    return false;
  }
  try {
    const stat = await fs.stat(args.entryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function isSkillFile(
  filePath: string,
  root: CommandScanRoot,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isFile()) {
      return true;
    }
    if (!stat.isSymbolicLink() || !canFollowSkillSymlink(root)) {
      return false;
    }
    const targetStat = await fs.stat(filePath);
    return targetStat.isFile();
  } catch {
    return false;
  }
}

async function buildRecord(
  args: CommandScanRoot,
  filePath: string,
  name: string,
): Promise<HostProviderCommand> {
  const frontmatter = await parseFrontmatter(filePath);
  return buildRecordFromFrontmatter(args, name, frontmatter);
}

function buildRecordFromFrontmatter(
  args: CommandScanRoot,
  name: string,
  frontmatter: ParsedFrontmatter,
): HostProviderCommand {
  return {
    name: `${args.namePrefix}${name}`,
    source: args.source,
    origin: args.origin,
    description: frontmatter.description,
    argumentHint: frontmatter.argumentHint,
  };
}

async function hasPluginManifest(skillDirPath: string): Promise<boolean> {
  try {
    const manifestStat = await fs.lstat(
      path.join(skillDirPath, ".claude-plugin", "plugin.json"),
    );
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

/**
 * One-level skill scan: each `<root>/<dir>/SKILL.md` becomes a record named for
 * its parent directory. Project-origin entry/file symlinks are skipped.
 * User-origin skill symlinks are followed so personal provider skill installs
 * show in typeahead.
 */
async function scanSkillRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "skill") {
    throw new Error("scanSkillRoot requires a skill root");
  }
  const entries = await readDirEntries(args.root.rootPath);
  if (entries === null) {
    return [];
  }

  const records: HostProviderCommand[] = [];
  for (const entry of entries) {
    const skillDirPath = path.join(args.root.rootPath, entry.name);
    if (
      !(await isSkillDirectory({
        entry,
        entryPath: skillDirPath,
        root: args.root,
      }))
    ) {
      continue;
    }
    if (await hasPluginManifest(skillDirPath)) {
      continue;
    }
    const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
    if (!(await isSkillFile(skillFilePath, args.root))) {
      continue;
    }
    records.push(await buildRecord(args.root, skillFilePath, entry.name));
  }
  return records;
}

/**
 * Bounded recursive skill walk for providers that support category folders.
 * Symlinks stay disabled because recursive symlink traversal can escape the
 * declared root or form cycles. Direct user skill roots retain their existing
 * one-level symlink support through the `skill` shape.
 */
async function walkMarkdownTree(args: WalkMarkdownTreeArgs): Promise<void> {
  if (args.depth > MAX_SCAN_DEPTH || args.budget.remainingEntries === 0) {
    return;
  }
  const entries = await readDirEntries(args.currentPath, args.budget);
  if (entries === null) {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(args.currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownTree({
        budget: args.budget,
        currentPath: entryPath,
        depth: args.depth + 1,
        matchedFiles: args.matchedFiles,
        matches: args.matches,
      });
      continue;
    }
    if (entry.isFile() && args.matches(entry)) {
      args.matchedFiles.push(entryPath);
    }
  }
}

function isPathWithinDirectory(
  directoryPath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function resolveRecursiveRootPath(
  root: CommandScanDirectoryRoot,
): Promise<string | null> {
  const resolvedRoot = await fs.realpath(root.rootPath).catch(() => null);
  if (resolvedRoot === null) {
    return null;
  }
  if (root.origin !== "project" || root.boundaryPath === undefined) {
    return resolvedRoot;
  }
  const resolvedBoundary = await fs
    .realpath(root.boundaryPath)
    .catch(() => null);
  return resolvedBoundary !== null &&
    isPathWithinDirectory(resolvedBoundary, resolvedRoot)
    ? resolvedRoot
    : null;
}

async function scanRecursiveSkillRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "skill-recursive") {
    throw new Error("scanRecursiveSkillRoot requires a recursive skill root");
  }
  const rootPath = await resolveRecursiveRootPath(args.root);
  if (rootPath === null) {
    return [];
  }
  const matchedFiles: string[] = [];
  await walkMarkdownTree({
    budget: args.budget,
    currentPath: rootPath,
    depth: 0,
    matchedFiles,
    matches: (entry) => entry.name === SKILL_FILE_NAME,
  });
  return Promise.all(
    matchedFiles.map((filePath) =>
      buildRecord(args.root, filePath, path.basename(path.dirname(filePath))),
    ),
  );
}

async function scanSingleSkillDirectoryRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "skill-directory") {
    throw new Error(
      "scanSingleSkillDirectoryRoot requires a skill-directory root",
    );
  }
  const skillFilePath = path.join(args.root.rootPath, SKILL_FILE_NAME);
  if (!(await isSkillFile(skillFilePath, args.root))) {
    return [];
  }
  return [
    await buildRecord(
      args.root,
      skillFilePath,
      path.basename(args.root.rootPath),
    ),
  ];
}

async function scanSkillFileRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "skill-file") {
    throw new Error("scanSkillFileRoot requires a skill-file root");
  }
  if (!(await isSkillFile(args.root.filePath, args.root))) {
    return [];
  }
  const frontmatter = await parseFrontmatter(args.root.filePath);
  return [
    buildRecordFromFrontmatter(
      args.root,
      frontmatter.name ?? args.root.fallbackName,
      frontmatter,
    ),
  ];
}

function commandNameFromPath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  const withoutExtension = relativePath.slice(
    0,
    relativePath.length - MARKDOWN_FILE_EXTENSION.length,
  );
  return withoutExtension.split(path.sep).join(":");
}

async function scanCommandRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "command") {
    throw new Error("scanCommandRoot requires a command root");
  }
  const matchedFiles: string[] = [];
  await walkMarkdownTree({
    budget: args.budget,
    currentPath: args.root.rootPath,
    depth: 0,
    matchedFiles,
    matches: (entry) => entry.name.endsWith(MARKDOWN_FILE_EXTENSION),
  });

  const records: HostProviderCommand[] = [];
  for (const filePath of matchedFiles) {
    const name = commandNameFromPath(args.root.rootPath, filePath);
    records.push(await buildRecord(args.root, filePath, name));
  }
  return records;
}

async function scanCommandFileRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "command-file") {
    throw new Error("scanCommandFileRoot requires a command-file root");
  }
  try {
    const stat = await fs.lstat(args.root.filePath);
    if (!stat.isFile()) {
      return [];
    }
  } catch {
    return [];
  }
  const name = path.basename(args.root.filePath, MARKDOWN_FILE_EXTENSION);
  return [await buildRecord(args.root, args.root.filePath, name)];
}

async function scanRoot(args: ScanRootArgs): Promise<HostProviderCommand[]> {
  switch (args.root.shape) {
    case "skill":
      return scanSkillRoot(args);
    case "skill-recursive":
      return scanRecursiveSkillRoot(args);
    case "skill-directory":
      return scanSingleSkillDirectoryRoot(args);
    case "skill-file":
      return scanSkillFileRoot(args);
    case "command":
      return scanCommandRoot(args);
    case "command-file":
      return scanCommandFileRoot(args);
  }
}

/**
 * Scan each root and concatenate the raw discovered records in root order. No
 * filtering, sorting, limiting, or de-duplication is applied here — that is
 * server policy. Missing dirs contribute nothing; a malformed file contributes
 * a name-only record.
 */
export async function discoverProviderCommands(
  args: DiscoverProviderCommandsArgs,
): Promise<HostProviderCommand[]> {
  const records: HostProviderCommand[] = [];
  const budget = { remainingEntries: MAX_SCAN_ENTRY_COUNT };
  for (const root of args.roots) {
    records.push(...(await scanRoot({ budget, root })));
  }
  return records;
}

/**
 * A scan root tagged with the originating-root identity the skills page needs.
 * The typeahead path (`discoverProviderCommands`) ignores `rootKind`; only
 * `discoverSkills` consumes it, so the shared scan helpers stay untouched.
 */
export type SkillScanRoot = CommandScanRoot & {
  /** Logical root identity used to keep IDs stable when host paths move. */
  identitySeed: string;
  rootKind: SkillRootKind;
};

export interface DiscoverSkillsArgs {
  roots: readonly SkillScanRoot[];
}

function buildSkillRecord(
  root: SkillScanRoot,
  filePath: string,
  name: string,
  frontmatter: ParsedFrontmatter,
  linked: boolean,
): DiscoveredSkill {
  const rootPath =
    "rootPath" in root ? root.rootPath : path.dirname(root.filePath);
  const logicalPath = path
    .relative(rootPath, filePath)
    .split(path.sep)
    .join("/");
  return {
    id: `skill_${createHash("sha256")
      .update(`${root.identitySeed}\0${logicalPath}`)
      .digest("hex")}`,
    name: `${root.namePrefix}${name}`,
    description: frontmatter.description,
    filePath,
    rootKind: root.rootKind,
    linked,
  };
}

async function isSymbolicLinkPath(filePath: string): Promise<boolean> {
  return (
    (await fs.lstat(filePath).catch(() => null))?.isSymbolicLink() ?? false
  );
}

async function scanSkillRootForSkills(
  root: SkillScanRoot,
): Promise<DiscoveredSkill[]> {
  if (root.shape !== "skill") {
    throw new Error("scanSkillRootForSkills requires a skill root");
  }
  const entries = await readDirEntries(root.rootPath);
  if (entries === null) {
    return [];
  }
  const records: DiscoveredSkill[] = [];
  const rootLinked = await isSymbolicLinkPath(root.rootPath);
  for (const entry of entries) {
    const skillDirPath = path.join(root.rootPath, entry.name);
    if (!(await isSkillDirectory({ entry, entryPath: skillDirPath, root }))) {
      continue;
    }
    if (await hasPluginManifest(skillDirPath)) {
      continue;
    }
    const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
    if (!(await isSkillFile(skillFilePath, root))) {
      continue;
    }
    const frontmatter = await parseFrontmatter(skillFilePath);
    records.push(
      buildSkillRecord(
        root,
        skillFilePath,
        entry.name,
        frontmatter,
        rootLinked ||
          entry.isSymbolicLink() ||
          (await isSymbolicLinkPath(skillFilePath)),
      ),
    );
  }
  return records;
}

async function scanRecursiveSkillRootForSkills(
  root: SkillScanRoot,
  budget: ScanBudget,
): Promise<DiscoveredSkill[]> {
  if (root.shape !== "skill-recursive") {
    throw new Error(
      "scanRecursiveSkillRootForSkills requires a recursive skill root",
    );
  }
  const rootPath = await resolveRecursiveRootPath(root);
  if (rootPath === null) {
    return [];
  }
  const matchedFiles: string[] = [];
  await walkMarkdownTree({
    budget,
    currentPath: rootPath,
    depth: 0,
    matchedFiles,
    matches: (entry) => entry.name === SKILL_FILE_NAME,
  });
  return Promise.all(
    matchedFiles.map(async (physicalFilePath) => {
      const logicalFilePath = path.join(
        root.rootPath,
        path.relative(rootPath, physicalFilePath),
      );
      return buildSkillRecord(
        root,
        logicalFilePath,
        path.basename(path.dirname(physicalFilePath)),
        await parseFrontmatter(physicalFilePath),
        await isSymbolicLinkPath(root.rootPath),
      );
    }),
  );
}

async function scanSingleSkillDirectoryForSkills(
  root: SkillScanRoot,
): Promise<DiscoveredSkill[]> {
  if (root.shape !== "skill-directory") {
    throw new Error(
      "scanSingleSkillDirectoryForSkills requires a skill-directory root",
    );
  }
  const skillFilePath = path.join(root.rootPath, SKILL_FILE_NAME);
  if (!(await isSkillFile(skillFilePath, root))) {
    return [];
  }
  const frontmatter = await parseFrontmatter(skillFilePath);
  return [
    buildSkillRecord(
      root,
      skillFilePath,
      path.basename(root.rootPath),
      frontmatter,
      (await isSymbolicLinkPath(root.rootPath)) ||
        (await isSymbolicLinkPath(skillFilePath)),
    ),
  ];
}

async function scanSkillFileForSkills(
  root: SkillScanRoot,
): Promise<DiscoveredSkill[]> {
  if (root.shape !== "skill-file") {
    throw new Error("scanSkillFileForSkills requires a skill-file root");
  }
  if (!(await isSkillFile(root.filePath, root))) {
    return [];
  }
  const frontmatter = await parseFrontmatter(root.filePath);
  return [
    buildSkillRecord(
      root,
      root.filePath,
      frontmatter.name ?? root.fallbackName,
      frontmatter,
      await isSymbolicLinkPath(root.filePath),
    ),
  ];
}

/**
 * Skill-only sibling of {@link discoverProviderCommands}: walks the same SKILL.md
 * structures but emits the absolute `filePath` and originating `rootKind` the
 * management page needs. Legacy `command`-source roots contribute nothing. Like
 * the command walk, this never throws on a bad/locked root — it degrades to a
 * partial list.
 */
export async function discoverSkills(
  args: DiscoverSkillsArgs,
): Promise<DiscoveredSkill[]> {
  const records: DiscoveredSkill[] = [];
  const budget = { remainingEntries: MAX_SCAN_ENTRY_COUNT };
  for (const root of args.roots) {
    switch (root.shape) {
      case "skill":
        records.push(...(await scanSkillRootForSkills(root)));
        break;
      case "skill-recursive":
        records.push(...(await scanRecursiveSkillRootForSkills(root, budget)));
        break;
      case "skill-directory":
        records.push(...(await scanSingleSkillDirectoryForSkills(root)));
        break;
      case "skill-file":
        records.push(...(await scanSkillFileForSkills(root)));
        break;
      case "command":
      case "command-file":
        break;
    }
  }
  const uniqueRecords: DiscoveredSkill[] = [];
  const seenFiles = new Set<string>();
  for (const record of records) {
    const canonicalFilePath = await fs
      .realpath(record.filePath)
      .catch(() => record.filePath);
    if (!seenFiles.has(canonicalFilePath)) {
      seenFiles.add(canonicalFilePath);
      uniqueRecords.push(record);
    }
  }
  return uniqueRecords;
}
