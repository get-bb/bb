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
 *   parent directory name.
 * - `command`: recursive `<root>/**​/*.md`; the command name is the path under
 *   the root with `/` replaced by `:` and the `.md` extension dropped
 *   (namespacing, e.g. `frontend/component.md` -> `frontend:component`).
 */
export type CommandScanShape = "skill" | "command";

export interface CommandScanRoot {
  /** Absolute directory to scan. Missing dir -> no records (no throw). */
  rootPath: string;
  shape: CommandScanShape;
  source: HostCommandSource;
  origin: HostCommandOrigin;
}

export interface DiscoverProviderCommandsArgs {
  roots: readonly CommandScanRoot[];
}

interface ScanRootArgs {
  root: CommandScanRoot;
}

interface WalkCommandTreeArgs {
  currentPath: string;
  depth: number;
  rootPath: string;
  matchedFiles: string[];
}

interface ParsedFrontmatter {
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
    return { description: null, argumentHint: null };
  }

  if (!hasSupportedFrontmatterDelimiter(content)) {
    return { description: null, argumentHint: null };
  }

  let data: Record<string, unknown>;
  try {
    data = matter(content).data;
  } catch {
    return { description: null, argumentHint: null };
  }

  return {
    description: readFrontmatterString(data, "description"),
    argumentHint: readFrontmatterString(data, "argument-hint"),
  };
}

async function isNonSymlinkDirectory(entryPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(entryPath);
    return stat.isDirectory();
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
  return {
    name,
    source: args.source,
    origin: args.origin,
    description: frontmatter.description,
    argumentHint: frontmatter.argumentHint,
  };
}

/**
 * One-level skill scan: each `<root>/<dir>/SKILL.md` becomes a record named for
 * its parent directory. Symlinked entries are skipped (not followed).
 */
async function scanSkillRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  const entries = await readDirEntries(args.root.rootPath);
  if (entries === null) {
    return [];
  }

  const records: HostProviderCommand[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const skillDirPath = path.join(args.root.rootPath, entry.name);
    if (!(await isNonSymlinkDirectory(skillDirPath))) {
      continue;
    }
    const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
    const skillFileStat = await fs.lstat(skillFilePath).catch(() => null);
    if (skillFileStat === null || skillFileStat.isSymbolicLink() || !skillFileStat.isFile()) {
      continue;
    }
    records.push(await buildRecord(args.root, skillFilePath, entry.name));
  }
  return records;
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

async function scanRoot(args: ScanRootArgs): Promise<HostProviderCommand[]> {
  return args.root.shape === "skill"
    ? scanSkillRoot(args)
    : scanCommandRoot(args);
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
