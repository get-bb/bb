import fs from "node:fs/promises";
import path from "node:path";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import { detectGitRepo, runGit } from "@bb/host-workspace";
import type {
  HostPathEntry,
  HostPathEntryKind,
} from "@bb/host-daemon-contract";

interface FinalizeListedFilesArgs {
  filePaths: string[];
  limit: number;
  query?: string;
}

interface FinalizedFileList {
  files: FileListEntry[];
  truncated: boolean;
}

interface FileListEntry {
  path: string;
  name: string;
}

interface ListedPath {
  kind: HostPathEntryKind;
  path: string;
  name: string;
}

interface PathListInclusion {
  includeFiles: boolean;
  includeDirectories: boolean;
}

interface FinalizeListedPathsArgs extends PathListInclusion {
  paths: ListedPath[];
  limit: number;
  query?: string;
}

interface FinalizedPathList {
  paths: HostPathEntry[];
  truncated: boolean;
}

interface ListPathsRecursivelyArgs extends PathListInclusion {
  dir: string;
  root: string;
  includeHidden: boolean;
  excludeNames: ReadonlySet<string>;
  ignoredPaths: ReadonlySet<string>;
}

interface ListWorkspacePathsArgs extends PathListInclusion {
  root: string;
  includeHidden: boolean;
  excludeNames: readonly string[];
  respectGitIgnore: boolean;
  maxAgeMs: number;
}

interface WorkspacePathListing {
  root: string;
  promise: Promise<ListedPath[]>;
  expiresAt: number | null;
  pathCount: number;
}

const workspaceListings = new Map<string, WorkspacePathListing>();
const MAX_CACHED_LISTINGS = 32;
const MAX_CACHED_PATHS = 100_000;

export function invalidateWorkspacePathListings(root: string): void {
  for (const [key, entry] of workspaceListings) {
    if (
      entry.root === root ||
      entry.root.startsWith(`${root}${path.sep}`) ||
      root.startsWith(`${entry.root}${path.sep}`)
    ) {
      workspaceListings.delete(key);
    }
  }
}

function trimWorkspaceListings(): void {
  let pathCount = 0;
  for (const entry of workspaceListings.values()) pathCount += entry.pathCount;
  for (const [key, entry] of workspaceListings) {
    if (
      workspaceListings.size <= MAX_CACHED_LISTINGS &&
      pathCount <= MAX_CACHED_PATHS
    )
      break;
    workspaceListings.delete(key);
    pathCount -= entry.pathCount;
  }
}

export function listWorkspacePaths(
  args: ListWorkspacePathsArgs,
): Promise<ListedPath[]> {
  const key = JSON.stringify([
    args.root,
    args.includeHidden,
    [...new Set(args.excludeNames)].sort(),
    args.respectGitIgnore,
    args.includeFiles,
    args.includeDirectories,
  ]);
  const existing = workspaceListings.get(key);
  if (
    existing &&
    (existing.expiresAt === null ||
      (args.maxAgeMs > 0 && existing.expiresAt > Date.now()))
  ) {
    workspaceListings.delete(key);
    workspaceListings.set(key, existing);
    return existing.promise;
  }
  const entry: WorkspacePathListing = {
    root: args.root,
    expiresAt: null,
    pathCount: 0,
    promise: discoverWorkspacePaths(args).then(
      (paths) => {
        if (workspaceListings.get(key) === entry) {
          if (args.maxAgeMs > 0 && paths.length <= MAX_CACHED_PATHS) {
            entry.expiresAt = Date.now() + args.maxAgeMs;
            entry.pathCount = paths.length;
            trimWorkspaceListings();
          } else {
            workspaceListings.delete(key);
          }
        }
        return paths;
      },
      (error: unknown) => {
        if (workspaceListings.get(key) === entry) workspaceListings.delete(key);
        throw error;
      },
    ),
  };
  workspaceListings.delete(key);
  workspaceListings.set(key, entry);
  trimWorkspaceListings();
  return entry.promise;
}

async function discoverWorkspacePaths(
  args: ListWorkspacePathsArgs,
): Promise<ListedPath[]> {
  const ignoredPaths = new Set<string>();
  if (
    args.respectGitIgnore &&
    (await detectGitRepo(args.root, { timeoutMs: 5_000 }))
  ) {
    const result = await runGit(
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
      ],
      { cwd: args.root, timeoutMs: 5_000 },
    );
    for (const entry of result.stdout.split("\0")) {
      if (entry.length > 0) ignoredPaths.add(entry.replace(/\/$/, ""));
    }
  }
  return listPathsRecursively({
    dir: args.root,
    root: args.root,
    includeHidden: args.includeHidden,
    excludeNames: new Set(args.excludeNames),
    ignoredPaths,
    includeFiles: args.includeFiles,
    includeDirectories: args.includeDirectories,
  });
}

const ALWAYS_EXCLUDED_NAMES: ReadonlySet<string> = new Set([".git"]);

function shouldIncludePath(
  pathKind: HostPathEntryKind,
  inclusion: PathListInclusion,
): boolean {
  return pathKind === "directory"
    ? inclusion.includeDirectories
    : inclusion.includeFiles;
}

function toFileListEntry(pathEntry: HostPathEntry): FileListEntry {
  return {
    path: pathEntry.path,
    name: pathEntry.name,
  };
}

function toListedFile(filePath: string): ListedPath {
  return {
    kind: "file",
    path: filePath,
    name: path.basename(filePath),
  };
}

export function normalizeListedPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function finalizeListedFiles(
  args: FinalizeListedFilesArgs,
): FinalizedFileList {
  const result = finalizeListedPaths({
    paths: args.filePaths.map(toListedFile),
    limit: args.limit,
    includeFiles: true,
    includeDirectories: false,
    ...(args.query ? { query: args.query } : {}),
  });

  return {
    files: result.paths.map(toFileListEntry),
    truncated: result.truncated,
  };
}

export function finalizeListedPaths(
  args: FinalizeListedPathsArgs,
): FinalizedPathList {
  let pathEntries = args.paths.filter((pathEntry) =>
    shouldIncludePath(pathEntry.kind, args),
  );
  let rankedEntries: HostPathEntry[];

  if (args.query) {
    const matches = fuzzyMatchPaths({
      items: pathEntries,
      query: args.query,
      getPath: (pathEntry) => pathEntry.path,
      limit: args.limit + 1,
    });
    rankedEntries = matches.map((match) => ({
      ...match.item,
      score: match.score,
      positions: match.positions,
    }));
  } else {
    rankedEntries = pathEntries.map((pathEntry) => ({
      ...pathEntry,
      score: 0,
      positions: [],
    }));
  }

  let truncated = false;
  if (rankedEntries.length > args.limit) {
    rankedEntries = rankedEntries.slice(0, args.limit);
    truncated = true;
  }

  return {
    paths: rankedEntries,
    truncated,
  };
}

async function listPathsRecursively(
  args: ListPathsRecursivelyArgs,
): Promise<ListedPath[]> {
  const entries = await fs.readdir(args.dir, { withFileTypes: true });
  const results: ListedPath[] = [];
  for (const entry of entries) {
    if (ALWAYS_EXCLUDED_NAMES.has(entry.name)) continue;
    if (args.excludeNames.has(entry.name)) continue;
    if (!args.includeHidden && entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(args.dir, entry.name);
    const relativePath = normalizeListedPath(
      path.relative(args.root, fullPath),
    );
    if (
      args.excludeNames.has(relativePath) ||
      args.ignoredPaths.has(relativePath)
    )
      continue;
    if (entry.isDirectory()) {
      if (args.includeDirectories) {
        results.push({
          kind: "directory",
          path: relativePath,
          name: entry.name,
        });
      }
      const childResults = await listPathsRecursively({
        ...args,
        dir: fullPath,
      });
      for (const childResult of childResults) results.push(childResult);
      continue;
    }

    if (args.includeFiles) {
      results.push({
        kind: "file",
        path: relativePath,
        name: entry.name,
      });
    }
  }
  return results;
}
