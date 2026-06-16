import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  HostCommandOrigin,
  HostCommandSource,
  HostProviderCommand,
} from "@bb/host-daemon-contract";

const SKILL_FILE_NAME = "SKILL.md";
const MARKDOWN_FILE_EXTENSION = ".md";
const FRONTMATTER_DELIMITER = "---";

// Bounded-scan caps mirror `walkSkillTree` in injected-skills.ts so a pathological
// command/skill tree cannot stall discovery or exhaust memory.
const MAX_SCAN_DEPTH = 24;
const MAX_SCAN_FILE_COUNT = 1_000;

/**
 * Scan shape for a root:
 * - `skill`: one level of `<root>/<dir>/SKILL.md`; the command name is the
 *   parent directory name. User-origin skill entries/files may be symlinks
 *   because personal provider skill installs commonly use them; project-origin
 *   skill entry/file symlinks are skipped.
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
  | "skill-directory"
  | "skill-file"
  | "command"
  | "command-file";

interface CommandScanRootBase {
  /** Prefix prepended to the derived invocation name, e.g. `plugin-name:`. */
  namePrefix: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
}

export interface CommandScanDirectoryRoot extends CommandScanRootBase {
  /** Absolute directory to scan. Missing dir -> no records (no throw). */
  rootPath: string;
  shape: "skill" | "skill-directory" | "command";
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
  root: CommandScanRoot;
}

interface SkillDirectoryCheckArgs {
  entry: Dirent;
  entryPath: string;
  root: CommandScanDirectoryRoot;
}

interface WalkCommandTreeArgs {
  currentPath: string;
  depth: number;
  rootPath: string;
  matchedFiles: string[];
}

interface ParsedFrontmatter {
  name: string | null;
  description: string | null;
  argumentHint: string | null;
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

async function readDirEntries(dirPath: string): Promise<Dirent[] | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
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

/**
 * Bounded recursive walk collecting `*.md` paths. Symlinks are not followed;
 * the depth and file-count caps mirror `walkSkillTree`. Hitting a cap stops the
 * walk early rather than throwing — discovery degrades to a partial list.
 *
 * This is a deliberate separate walker, not an extraction of `walkSkillTree`:
 * that walker throws on caps/symlinks (skill staging must be exact and safe)
 * and collects file bytes, whereas discovery degrades gracefully and collects
 * only `*.md` paths. Forcing a shared walker across throw-vs-degrade semantics
 * would be the wrong abstraction; revisit if a third caller appears.
 */
async function walkCommandTree(args: WalkCommandTreeArgs): Promise<void> {
  if (args.depth > MAX_SCAN_DEPTH) {
    return;
  }
  const entries = await readDirEntries(args.currentPath);
  if (entries === null) {
    return;
  }

  for (const entry of entries) {
    if (args.matchedFiles.length >= MAX_SCAN_FILE_COUNT) {
      return;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(args.currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkCommandTree({
        currentPath: entryPath,
        depth: args.depth + 1,
        rootPath: args.rootPath,
        matchedFiles: args.matchedFiles,
      });
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(MARKDOWN_FILE_EXTENSION)) {
      args.matchedFiles.push(entryPath);
    }
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
  await walkCommandTree({
    currentPath: args.root.rootPath,
    depth: 0,
    rootPath: args.root.rootPath,
    matchedFiles,
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
  for (const root of args.roots) {
    records.push(...(await scanRoot({ root })));
  }
  return records;
}
