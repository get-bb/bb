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

const MAX_SCAN_DEPTH = 24;
const MAX_SCAN_ENTRY_COUNT = 1_000;

interface CommandScanRootBase {
  allowExternalProjectRoot?: boolean;
  boundaryPath?: string;
  namePrefix: string;
  skipIfManifest?: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
  skillIdentitySeed?: string;
}

interface CommandScanDirectoryRoot extends CommandScanRootBase {
  rootPath: string;
  shape: "skill" | "skill-recursive" | "skill-directory" | "command";
}

interface CommandScanFileRoot extends CommandScanRootBase {
  filePath: string;
  shape: "command-file";
}

interface CommandScanSkillFileRoot extends CommandScanRootBase {
  fallbackName: string;
  filePath: string;
  shape: "skill-file";
  source: "skill";
}

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
  boundary: SkillPathBoundary;
  entry: Dirent;
  entryPath: string;
}

interface SkillPathBoundary {
  canonicalPath: string | null;
  followLinks: boolean;
  requirePlainRoot: boolean;
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

interface SkillFileMatch {
  filePath: string;
  frontmatter: ParsedFrontmatter;
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
    return null;
  }
}

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

async function resolveSkillPathBoundary(
  root: CommandScanRoot,
): Promise<SkillPathBoundary | null> {
  if ("rootKind" in root && root.rootKind === "bb-project") {
    return {
      canonicalPath: null,
      followLinks: false,
      requirePlainRoot: false,
    };
  }
  if (root.origin === "user") {
    return {
      canonicalPath: null,
      followLinks: true,
      requirePlainRoot: false,
    };
  }
  if (root.boundaryPath === undefined) {
    return null;
  }
  const canonicalPath = await fs.realpath(root.boundaryPath).catch(() => null);
  if (canonicalPath === null) {
    return null;
  }
  const rootPath = "rootPath" in root ? root.rootPath : root.filePath;
  if (!isPathWithinDirectory(root.boundaryPath, rootPath)) {
    return root.allowExternalProjectRoot === true
      ? { canonicalPath: null, followLinks: false, requirePlainRoot: true }
      : null;
  }
  return { canonicalPath, followLinks: true, requirePlainRoot: false };
}

async function resolveSkillPath(
  boundary: SkillPathBoundary,
  candidatePath: string,
): Promise<string | null> {
  const resolvedPath = await fs.realpath(candidatePath).catch(() => null);
  if (resolvedPath === null) {
    return null;
  }
  return boundary.canonicalPath === null ||
    isPathWithinDirectory(boundary.canonicalPath, resolvedPath)
    ? resolvedPath
    : null;
}

async function resolveSkillRootPath(
  boundary: SkillPathBoundary,
  candidatePath: string,
): Promise<string | null> {
  if (boundary.requirePlainRoot) {
    const stat = await fs.lstat(candidatePath).catch(() => null);
    if (stat === null || stat.isSymbolicLink()) {
      return null;
    }
  }
  return resolveSkillPath(boundary, candidatePath);
}

async function isSkillDirectory(
  args: SkillDirectoryCheckArgs,
): Promise<string | null> {
  if (!args.entry.isDirectory() && !args.entry.isSymbolicLink()) {
    return null;
  }
  if (args.entry.isSymbolicLink() && !args.boundary.followLinks) {
    return null;
  }
  const resolvedPath = await resolveSkillPath(args.boundary, args.entryPath);
  const stat =
    resolvedPath === null
      ? null
      : await fs.stat(resolvedPath).catch(() => null);
  return stat?.isDirectory() === true ? resolvedPath : null;
}

async function statSkillFile(
  filePath: string,
  boundary: SkillPathBoundary,
): Promise<{ linked: boolean; resolvedPath: string } | null> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      return null;
    }
    if (stat.isSymbolicLink() && !boundary.followLinks) {
      return null;
    }
    const resolvedPath = await resolveSkillPath(boundary, filePath);
    if (resolvedPath === null) {
      return null;
    }
    const targetStat = await fs.stat(resolvedPath);
    return targetStat.isFile()
      ? { linked: stat.isSymbolicLink(), resolvedPath }
      : null;
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

async function scanSkillRootFiles(
  root: CommandScanDirectoryRoot,
  boundary: SkillPathBoundary,
): Promise<SkillFileMatch[]> {
  const resolvedRootPath = await resolveSkillRootPath(boundary, root.rootPath);
  if (resolvedRootPath === null) {
    return [];
  }
  const entries = await readDirEntries(resolvedRootPath);
  if (entries === null) {
    return [];
  }
  const rootLinked = await isSymbolicLinkPath(root.rootPath);
  const matches: SkillFileMatch[] = [];
  for (const entry of entries) {
    const skillDirPath = path.join(resolvedRootPath, entry.name);
    const resolvedSkillDirPath = await isSkillDirectory({
      boundary,
      entry,
      entryPath: skillDirPath,
    });
    if (resolvedSkillDirPath === null) {
      continue;
    }
    if (await hasManifestMarker(root, resolvedSkillDirPath)) {
      continue;
    }
    const skillFilePath = path.join(resolvedSkillDirPath, SKILL_FILE_NAME);
    const skillFile = await statSkillFile(skillFilePath, boundary);
    if (skillFile === null) {
      continue;
    }
    matches.push({
      filePath: path.join(root.rootPath, entry.name, SKILL_FILE_NAME),
      frontmatter: await parseFrontmatter(skillFile.resolvedPath),
      linked: rootLinked || entry.isSymbolicLink() || skillFile.linked,
      name: entry.name,
    });
  }
  return matches;
}

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

async function scanRecursiveSkillRootFiles(
  root: CommandScanDirectoryRoot,
  budget: ScanBudget,
  boundary: SkillPathBoundary,
): Promise<SkillFileMatch[]> {
  const rootPath = await resolveSkillRootPath(boundary, root.rootPath);
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

async function scanSingleSkillDirectoryFiles(
  root: CommandScanDirectoryRoot,
  boundary: SkillPathBoundary,
): Promise<SkillFileMatch[]> {
  const resolvedRootPath = await resolveSkillRootPath(boundary, root.rootPath);
  if (resolvedRootPath === null) {
    return [];
  }
  const skillFile = await statSkillFile(
    path.join(resolvedRootPath, SKILL_FILE_NAME),
    boundary,
  );
  if (skillFile === null) {
    return [];
  }
  return [
    {
      filePath: path.join(root.rootPath, SKILL_FILE_NAME),
      frontmatter: await parseFrontmatter(skillFile.resolvedPath),
      linked: (await isSymbolicLinkPath(root.rootPath)) || skillFile.linked,
      name: path.basename(root.rootPath),
    },
  ];
}

async function scanSkillFileRootFiles(
  root: CommandScanSkillFileRoot,
  boundary: SkillPathBoundary,
): Promise<SkillFileMatch[]> {
  const skillFile = await statSkillFile(root.filePath, boundary);
  if (skillFile === null) {
    return [];
  }
  const frontmatter = await parseFrontmatter(skillFile.resolvedPath);
  return [
    {
      filePath: root.filePath,
      frontmatter,
      linked: skillFile.linked,
      name: frontmatter.name ?? root.fallbackName,
    },
  ];
}

async function scanSkillFiles(args: ScanRootArgs): Promise<SkillFileMatch[]> {
  const { root } = args;
  const boundary = await resolveSkillPathBoundary(root);
  if (boundary === null) {
    return [];
  }
  switch (root.shape) {
    case "skill":
      return scanSkillRootFiles(root, boundary);
    case "skill-recursive":
      return scanRecursiveSkillRootFiles(root, args.budget, boundary);
    case "skill-directory":
      return scanSingleSkillDirectoryFiles(root, boundary);
    case "skill-file":
      return scanSkillFileRootFiles(root, boundary);
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

export type SkillScanRoot = CommandScanRoot & {
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
