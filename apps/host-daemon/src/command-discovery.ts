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

interface CommandScanRootBase {
  /** Prefix prepended to the derived invocation name, e.g. `plugin-name:`. */
  namePrefix: string;
  /**
   * A file, relative to a skill directory, that marks it as a vendor plugin
   * rather than a skill; such a directory is skipped. Declared by the plugin
   * that knows the vendor layout — discovery names no vendor path.
   */
  skipIfManifest?: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
  /** Stable root identity for native skill roots that share one root kind. */
  skillIdentitySeed?: string;
}

interface CommandScanDirectoryRoot extends CommandScanRootBase {
  /** Optional boundary that a project-origin recursive root must stay within. */
  boundaryPath?: string;
  /** Absolute directory to scan. Missing dir -> no records (no throw). */
  rootPath: string;
  shape: "skill" | "skill-recursive" | "skill-directory" | "command";
}

interface CommandScanFileRoot extends CommandScanRootBase {
  /** Absolute file to scan. Missing file -> no record (no throw). */
  filePath: string;
  shape: "command-file";
}

interface CommandScanSkillFileRoot extends CommandScanRootBase {
  /** Fallback command name used when the file has no frontmatter `name`. */
  fallbackName: string;
  /** Absolute SKILL.md file to scan. Missing file -> no record (no throw). */
  filePath: string;
  shape: "skill-file";
  source: "skill";
}

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
export type CommandScanRoot =
  | CommandScanDirectoryRoot
  | CommandScanFileRoot
  | CommandScanSkillFileRoot;

interface DiscoverProviderCommandsArgs {
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

/**
 * One SKILL.md a skill walker found, carrying what both consumers project
 * from it: the typeahead keeps the name and frontmatter; the skills page also
 * the path and whether a symlink was crossed to reach the file.
 */
interface SkillFileMatch {
  /**
   * The SKILL.md path as the root addresses it. For a recursive root that is
   * the declared root's path rather than its realpath: the skills page shows
   * the file where the provider looks for it.
   */
  filePath: string;
  frontmatter: ParsedFrontmatter;
  /**
   * A symlink stands between the root as declared and the SKILL.md: the root
   * itself, the skill entry, or the file. Which of these a shape can inspect
   * follows from how it walks — a recursive walk never follows links, so only
   * its root can be one.
   */
  linked: boolean;
  name: string;
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

/**
 * Whether a SKILL.md candidate is a usable skill file, and whether it is
 * reached through a symlink. A symlinked file counts only where the root
 * follows symlinks (user-origin skill roots); elsewhere it is no skill file.
 */
async function statSkillFile(
  filePath: string,
  root: CommandScanRoot,
): Promise<{ linked: boolean } | null> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isFile()) {
      return { linked: false };
    }
    if (!stat.isSymbolicLink() || !canFollowSkillSymlink(root)) {
      return null;
    }
    const targetStat = await fs.stat(filePath);
    return targetStat.isFile() ? { linked: true } : null;
  } catch {
    return null;
  }
}

async function isSymbolicLinkPath(filePath: string): Promise<boolean> {
  return (
    (await fs.lstat(filePath).catch(() => null))?.isSymbolicLink() ?? false
  );
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

async function hasManifestMarker(
  root: CommandScanRootBase,
  skillDirPath: string,
): Promise<boolean> {
  if (root.skipIfManifest === undefined) {
    return false;
  }
  try {
    const manifestStat = await fs.lstat(
      path.join(skillDirPath, root.skipIfManifest),
    );
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

/**
 * One-level skill scan: each `<root>/<dir>/SKILL.md` is a skill named for its
 * parent directory. Project-origin entry/file symlinks are skipped.
 * User-origin skill symlinks are followed so personal provider skill installs
 * show in typeahead and on the skills page.
 */
async function scanSkillRootFiles(
  root: CommandScanDirectoryRoot,
): Promise<SkillFileMatch[]> {
  const entries = await readDirEntries(root.rootPath);
  if (entries === null) {
    return [];
  }
  const rootLinked = await isSymbolicLinkPath(root.rootPath);
  const matches: SkillFileMatch[] = [];
  for (const entry of entries) {
    const skillDirPath = path.join(root.rootPath, entry.name);
    if (!(await isSkillDirectory({ entry, entryPath: skillDirPath, root }))) {
      continue;
    }
    if (await hasManifestMarker(root, skillDirPath)) {
      continue;
    }
    const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
    const skillFile = await statSkillFile(skillFilePath, root);
    if (skillFile === null) {
      continue;
    }
    matches.push({
      filePath: skillFilePath,
      frontmatter: await parseFrontmatter(skillFilePath),
      linked: rootLinked || entry.isSymbolicLink() || skillFile.linked,
      name: entry.name,
    });
  }
  return matches;
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

export function isPathWithinDirectory(
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

/**
 * Every `SKILL.md` below the root, walked through the root's realpath so a
 * symlinked root is followed once (the walk itself follows no link); each
 * match is reported under the root as declared.
 */
async function scanRecursiveSkillRootFiles(
  root: CommandScanDirectoryRoot,
  budget: ScanBudget,
): Promise<SkillFileMatch[]> {
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
  const linked = await isSymbolicLinkPath(root.rootPath);
  return Promise.all(
    matchedFiles.map(async (physicalFilePath) => ({
      filePath: path.join(
        root.rootPath,
        path.relative(rootPath, physicalFilePath),
      ),
      frontmatter: await parseFrontmatter(physicalFilePath),
      linked,
      name: path.basename(path.dirname(physicalFilePath)),
    })),
  );
}

/** A single `<root>/SKILL.md`, named for the root directory. */
async function scanSingleSkillDirectoryFiles(
  root: CommandScanDirectoryRoot,
): Promise<SkillFileMatch[]> {
  const skillFilePath = path.join(root.rootPath, SKILL_FILE_NAME);
  const skillFile = await statSkillFile(skillFilePath, root);
  if (skillFile === null) {
    return [];
  }
  return [
    {
      filePath: skillFilePath,
      frontmatter: await parseFrontmatter(skillFilePath),
      linked: (await isSymbolicLinkPath(root.rootPath)) || skillFile.linked,
      name: path.basename(root.rootPath),
    },
  ];
}

/** A single SKILL.md, named by its frontmatter with the declared fallback. */
async function scanSkillFileRootFiles(
  root: CommandScanSkillFileRoot,
): Promise<SkillFileMatch[]> {
  const skillFile = await statSkillFile(root.filePath, root);
  if (skillFile === null) {
    return [];
  }
  const frontmatter = await parseFrontmatter(root.filePath);
  return [
    {
      filePath: root.filePath,
      frontmatter,
      linked: skillFile.linked,
      name: frontmatter.name ?? root.fallbackName,
    },
  ];
}

/**
 * The SKILL.md files a skill-shaped root holds. Command-shaped roots hold
 * none: their markdown files are commands, never skills.
 */
async function scanSkillFiles(args: ScanRootArgs): Promise<SkillFileMatch[]> {
  const { root } = args;
  switch (root.shape) {
    case "skill":
      return scanSkillRootFiles(root);
    case "skill-recursive":
      return scanRecursiveSkillRootFiles(root, args.budget);
    case "skill-directory":
      return scanSingleSkillDirectoryFiles(root);
    case "skill-file":
      return scanSkillFileRootFiles(root);
    case "command":
    case "command-file":
      return [];
  }
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
    case "skill-recursive":
    case "skill-directory":
    case "skill-file":
      return (await scanSkillFiles(args)).map((match) =>
        buildRecordFromFrontmatter(args.root, match.name, match.frontmatter),
      );
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
 * `discoverSkills` consumes it.
 */
export type SkillScanRoot = CommandScanRoot & {
  /** Logical root identity used to keep IDs stable when host paths move. */
  identitySeed: string;
  rootKind: SkillRootKind;
};

interface DiscoverSkillsArgs {
  roots: readonly SkillScanRoot[];
}

function buildSkillRecord(
  root: SkillScanRoot,
  match: SkillFileMatch,
): DiscoveredSkill {
  const rootPath =
    "rootPath" in root ? root.rootPath : path.dirname(root.filePath);
  const logicalPath = path
    .relative(rootPath, match.filePath)
    .split(path.sep)
    .join("/");
  return {
    id: `skill_${createHash("sha256")
      .update(`${root.identitySeed}\0${logicalPath}`)
      .digest("hex")}`,
    name: `${root.namePrefix}${match.name}`,
    description: match.frontmatter.description,
    filePath: match.filePath,
    rootKind: root.rootKind,
    linked: match.linked,
  };
}

/**
 * Skill-only sibling of {@link discoverProviderCommands}: the same SKILL.md
 * walk, projected to the absolute `filePath`, originating `rootKind` and
 * `linked` flag the management page needs. Legacy `command`-source roots
 * contribute nothing. Like the command walk, this never throws on a
 * bad/locked root — it degrades to a partial list.
 */
export async function discoverSkills(
  args: DiscoverSkillsArgs,
): Promise<DiscoveredSkill[]> {
  const records: DiscoveredSkill[] = [];
  const budget = { remainingEntries: MAX_SCAN_ENTRY_COUNT };
  for (const root of args.roots) {
    for (const match of await scanSkillFiles({ budget, root })) {
      records.push(buildSkillRecord(root, match));
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
