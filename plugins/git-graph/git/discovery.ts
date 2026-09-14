export interface FsDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface FsStat {
  isDirectory: boolean;
  isFile: boolean;
}

export interface FsReader {
  readDir(dirPath: string): Promise<FsDirEntry[]>;
  stat(targetPath: string): Promise<FsStat | null>;
  readFileUtf8(targetPath: string, maxBytes: number): Promise<string | null>;
}

export const SKIP_DIR_NAMES = new Set(
  [
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".gradle",
    ".idea",
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pnpm-store",
    ".pytest_cache",
    ".runtime",
    ".turbo",
    ".venv",
    ".yarn",
    "__pycache__",
    "bower_components",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "tmp",
    "venv",
  ].map((name) => name.toLowerCase()),
);

export interface DiscoveredRepo {
  relPath: string;
  position: "root" | "nested";
  gitLink: "direct" | "worktree" | "submodule";
}

export interface RepoScanResult {
  repos: DiscoveredRepo[];
  truncated: boolean;
  rootIsRepo: boolean;
}

export interface ScanLimits {
  maxDepth: number;
  maxDirectories: number;
  deadlineMs: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxDepth: 5,
  maxDirectories: 4_000,
  deadlineMs: 4_000,
};

export function toForwardSlashes(value: string): string {
  return value.replace(/\\/gu, "/");
}

export function joinRelPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}/${child}`;
}

export function parseGitLinkFile(
  content: string,
  repoDir: string,
): { gitLink: "worktree" | "submodule"; gitDir: string } | null {
  const match = content.match(/^gitdir:\s*(.+?)\s*$/u);
  if (match === null) return null;
  let gitDir = toForwardSlashes(match[1]);
  if (gitDir.startsWith("./") || gitDir.startsWith("../")) {
    const resolved = resolveRelative(repoDir, gitDir);
    if (resolved === null) return null;
    gitDir = resolved;
  } else if (!/^[a-zA-Z]:/u.test(gitDir) && !gitDir.startsWith("/")) {
    const resolved = resolveRelative(repoDir, gitDir);
    if (resolved === null) return null;
    gitDir = resolved;
  }
  const kind = /\/\.git\/modules\//u.test(gitDir) ? "submodule" : "worktree";
  return { gitLink: kind, gitDir };
}

function resolveRelative(base: string, relative: string): string | null {
  const segments = toForwardSlashes(base).split("/");
  for (const segment of toForwardSlashes(relative).split("/")) {
    if (segment === "." || segment.length === 0) continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

async function inspectDotGit(
  repoDirAbs: string,
  relPath: string,
  position: "root" | "nested",
  fs: FsReader,
): Promise<DiscoveredRepo | null> {
  const dotGitStat = await fs.stat(`${repoDirAbs}/.git`);
  if (dotGitStat === null) return null;
  if (dotGitStat.isDirectory) {
    return { relPath, position, gitLink: "direct" };
  }
  if (!dotGitStat.isFile) return null;
  const content = await fs.readFileUtf8(`${repoDirAbs}/.git`, 4_096);
  if (content === null) return null;
  const parsed = parseGitLinkFile(content, repoDirAbs);
  if (parsed === null) return null;
  return { relPath, position, gitLink: parsed.gitLink };
}

export async function scanDirectoryTree(
  sourceRoot: string,
  fs: FsReader,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): Promise<RepoScanResult> {
  const repos: DiscoveredRepo[] = [];
  let truncated = false;
  const rootStat = await fs.stat(sourceRoot);
  if (rootStat === null || !rootStat.isDirectory) {
    return { repos, truncated: false, rootIsRepo: false };
  }
  const rootRepo = await inspectDotGit(sourceRoot, "", "root", fs);
  if (rootRepo !== null) {
    repos.push(rootRepo);
  }
  const startedAt = Date.now();
  let directoriesVisited = 0;
  const queue: Array<{ absPath: string; relPath: string; depth: number }> = [
    { absPath: sourceRoot, relPath: "", depth: 0 },
  ];
  let cursor = 0;
  while (cursor < queue.length) {
    const entry = queue[cursor];
    cursor += 1;
    if (entry.depth >= limits.maxDepth) continue;
    if (
      directoriesVisited >= limits.maxDirectories ||
      Date.now() - startedAt > limits.deadlineMs
    ) {
      truncated = true;
      break;
    }
    directoriesVisited += 1;
    let entries: FsDirEntry[];
    try {
      entries = await fs.readDir(entry.absPath);
    } catch {
      continue;
    }
    for (const child of entries) {
      if (!child.isDirectory || child.isSymbolicLink) continue;
      const lower = child.name.toLowerCase();
      if (SKIP_DIR_NAMES.has(lower)) continue;
      const childRel = joinRelPath(entry.relPath, child.name);
      const childAbs = `${entry.absPath}/${child.name}`;
      const repo = await inspectDotGit(childAbs, childRel, "nested", fs);
      if (repo !== null) {
        repos.push(repo);
      }
      queue.push({
        absPath: childAbs,
        relPath: childRel,
        depth: entry.depth + 1,
      });
    }
  }
  repos.sort((a, b) => {
    if (a.position !== b.position) {
      return a.position === "root" ? -1 : 1;
    }
    const depthA = a.relPath.split("/").length;
    const depthB = b.relPath.split("/").length;
    if (depthA !== depthB) return depthA - depthB;
    return a.relPath.localeCompare(b.relPath);
  });
  return {
    repos,
    truncated,
    rootIsRepo: rootRepo !== null,
  };
}
