import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const SKILL_FILE_NAME = "SKILL.md";

const MAX_SCAN_DEPTH = 24;
const MAX_SCAN_ENTRY_COUNT = 1_000;
const MAX_SKILL_FILE_BYTES = 25 * 1024 * 1024;

export interface SkillScanRoot {
  path: string;
  shape:
    | "skill"
    | "skill-recursive"
    | "skill-directory"
    | "skill-file"
    | "command"
    | "command-file";
  boundaryPath: string | null;
  skipIfManifest?: string;
  fallbackName?: string;
}

export interface SkillFile {
  filePath: string;
  realPath: string;
  name: string;
  linked: boolean;
}

export interface IndexedSkillFile extends SkillFile {
  contentSha256: string;
  content: string;
}

export function skillRegistrationId(
  identitySeed: string,
  logicalPath: string,
): string {
  return `skill_${createHash("sha256").update(`${identitySeed}\0${logicalPath}`).digest("hex")}`;
}

export function firstPerIdentity<T>(
  items: readonly T[],
  identity: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = identity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isWithinSkillBoundary(
  boundary: string,
  candidate: string,
): boolean {
  const relative = path.relative(boundary, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function resolveSkillPath(
  filePath: string,
  boundaryPath: string | null,
): Promise<string | null> {
  const realPath = await fs.realpath(filePath).catch(() => null);
  if (realPath === null || boundaryPath === null) return realPath;
  const boundary = await fs.realpath(boundaryPath).catch(() => null);
  return boundary !== null && isWithinSkillBoundary(boundary, realPath)
    ? realPath
    : null;
}

async function isSymbolicLinkPath(filePath: string): Promise<boolean> {
  return (
    (await fs.lstat(filePath).catch(() => null))?.isSymbolicLink() ?? false
  );
}

export async function findSkillFiles(
  root: SkillScanRoot,
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const visited = new Set<string>();
  let remainingEntries = MAX_SCAN_ENTRY_COUNT;
  const charged = (entry: Dirent): boolean =>
    root.shape === "command" ||
    (root.shape === "skill-recursive" &&
      (entry.isDirectory() || entry.isSymbolicLink()));
  if ((await resolveSkillPath(root.path, root.boundaryPath)) === null) {
    return files;
  }
  const rootLinked = await isSymbolicLinkPath(root.path);
  async function add(
    filePath: string,
    name: string,
    linked: boolean,
  ): Promise<void> {
    const realPath = await resolveSkillPath(filePath, root.boundaryPath);
    if (realPath === null) return;
    const stat = await fs.stat(realPath).catch(() => null);
    if (!stat?.isFile()) return;
    files.push({
      filePath,
      realPath,
      name,
      linked: linked || (await isSymbolicLinkPath(filePath)),
    });
  }
  async function walk(
    directory: string,
    depth: number,
    linked: boolean,
  ): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    const leaf =
      root.shape === "skill-directory" ||
      (root.shape === "skill" && depth === 1);
    const realPath = await resolveSkillPath(directory, root.boundaryPath);
    if (realPath === null || (!leaf && visited.has(realPath))) return;
    const stat = await fs.stat(realPath).catch(() => null);
    if (!stat?.isDirectory()) return;
    if (!leaf) visited.add(realPath);
    if (
      depth > 0 &&
      root.skipIfManifest !== undefined &&
      (
        await fs
          .stat(path.join(directory, root.skipIfManifest))
          .catch(() => null)
      )?.isFile()
    ) {
      return;
    }
    const handle = await fs.opendir(directory).catch(() => null);
    if (handle === null) return;
    const entries = [];
    for await (const entry of handle) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (charged(entry)) {
        if (remainingEntries === 0) continue;
        remainingEntries -= 1;
      }
      entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (
      (leaf || root.shape === "skill-recursive") &&
      entries.some((entry) => entry.name === SKILL_FILE_NAME)
    ) {
      await add(
        path.join(directory, SKILL_FILE_NAME),
        path.basename(directory),
        linked,
      );
    }
    if (leaf) return;
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const target = await resolveSkillPath(entryPath, root.boundaryPath);
      if (target === null) continue;
      const entryStat = await fs.stat(target).catch(() => null);
      const entryLinked = linked || entry.isSymbolicLink();
      if (entryStat?.isDirectory()) {
        await walk(entryPath, depth + 1, entryLinked);
      } else if (root.shape === "command" && entry.name.endsWith(".md")) {
        await add(
          entryPath,
          path
            .relative(root.path, entryPath)
            .slice(0, -3)
            .split(path.sep)
            .join(":"),
          entryLinked,
        );
      }
    }
  }
  if (root.shape === "skill-file" || root.shape === "command-file") {
    await add(
      root.path,
      root.fallbackName ?? path.basename(root.path, ".md"),
      rootLinked,
    );
  } else {
    await walk(root.path, 0, rootLinked);
  }
  return files;
}

export async function scanSkillFiles(
  root: SkillScanRoot,
): Promise<IndexedSkillFile[]> {
  const indexed: IndexedSkillFile[] = [];
  for (const file of await findSkillFiles(root)) {
    const stat = await fs.stat(file.realPath).catch(() => null);
    if (stat === null || stat.size > MAX_SKILL_FILE_BYTES) continue;
    const bytes = await fs.readFile(file.realPath).catch(() => null);
    if (bytes === null || bytes.length > MAX_SKILL_FILE_BYTES) continue;
    indexed.push({
      ...file,
      content: bytes.toString("utf8"),
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return indexed;
}

interface SkillMentionCandidate {
  start: number;
  end: number;
  resource: {
    kind: string;
    source?: unknown;
    trigger?: unknown;
    name?: unknown;
  };
}

interface SelectedSkillMention extends SkillMentionCandidate {
  resource: {
    kind: "command";
    source: "skill";
    trigger: "/" | "$";
    name: string;
  };
}

export function selectedSkillMentions(input: {
  text: string;
  mentions: readonly SkillMentionCandidate[];
}): SelectedSkillMention[] {
  return input.mentions.filter((mention): mention is SelectedSkillMention => {
    const { start, end, resource } = mention;
    return (
      resource.kind === "command" &&
      resource.source === "skill" &&
      typeof resource.name === "string" &&
      (resource.trigger === "/" || resource.trigger === "$") &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      start < end &&
      end <= input.text.length &&
      input.text.slice(start, end) === `${resource.trigger}${resource.name}`
    );
  });
}
