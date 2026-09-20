import fs from "node:fs/promises";
import path from "node:path";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import { detectGitRepo, runGit } from "@bb/host-workspace";
import type {
  HostPathEntry,
  HostPathEntryKind,
} from "@bb/host-daemon-contract";

// Heap safety: an unbounded walk over a multi-million-entry root OOM-killed the daemon.
export const MAX_LISTED_PATH_ENTRIES = 250_000;

interface FinalizeListedFilesArgs {
  filePaths: string[];
  limit: number;
  query?: string;
  budgetExhausted?: boolean;
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

export interface BoundedPathList {
  paths: ListedPath[];
  budgetExhausted: boolean;
}

interface PathListInclusion {
  includeFiles: boolean;
  includeDirectories: boolean;
}

interface FinalizeListedPathsArgs extends PathListInclusion {
  paths: ListedPath[];
  limit: number;
  query?: string;
  budgetExhausted?: boolean;
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
  maxEntries?: number;
}

interface ListWorkspacePathsArgs extends PathListInclusion {
  root: string;
  includeHidden: boolean;
  excludeNames: readonly string[];
  respectGitIgnore: boolean;
  maxEntries?: number;
}

const pendingListings = new Map<string, Promise<BoundedPathList>>();

export function listWorkspacePaths(
  args: ListWorkspacePathsArgs,
): Promise<BoundedPathList> {
  const maxEntries = args.maxEntries ?? MAX_LISTED_PATH_ENTRIES;
  const key = JSON.stringify([
    args.root,
    args.includeHidden,
    [...new Set(args.excludeNames)].sort(),
    args.respectGitIgnore,
    args.includeFiles,
    args.includeDirectories,
    maxEntries,
  ]);
  const existing = pendingListings.get(key);
  if (existing) return existing;
  const listing = discoverWorkspacePaths({
    ...args,
    maxEntries,
  }).finally(() => {
    pendingListings.delete(key);
  });
  pendingListings.set(key, listing);
  return listing;
}

async function discoverWorkspacePaths(
  args: ListWorkspacePathsArgs & { maxEntries: number },
): Promise<BoundedPathList> {
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
  return listPathsBounded({
    dir: args.root,
    root: args.root,
    includeHidden: args.includeHidden,
    excludeNames: new Set(args.excludeNames),
    ignoredPaths,
    includeFiles: args.includeFiles,
    includeDirectories: args.includeDirectories,
    maxEntries: args.maxEntries,
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
    ...(args.budgetExhausted ? { budgetExhausted: true } : {}),
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

  let truncated = args.budgetExhausted === true;
  if (rankedEntries.length > args.limit) {
    rankedEntries = rankedEntries.slice(0, args.limit);
    truncated = true;
  }

  return {
    paths: rankedEntries,
    truncated,
  };
}

export async function listPathsBounded(
  args: ListPathsRecursivelyArgs,
): Promise<BoundedPathList> {
  const results: ListedPath[] = [];
  const maxEntries = args.maxEntries ?? MAX_LISTED_PATH_ENTRIES;
  const budgetExhausted = await walkPathsInto(args, results, maxEntries);
  return { paths: results, budgetExhausted };
}

export async function listPathsRecursively(
  args: ListPathsRecursivelyArgs,
): Promise<ListedPath[]> {
  return (await listPathsBounded(args)).paths;
}

async function walkPathsInto(
  args: ListPathsRecursivelyArgs,
  results: ListedPath[],
  maxEntries: number,
): Promise<boolean> {
  if (results.length >= maxEntries) return true;

  const entries = await fs.readdir(args.dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxEntries) return true;
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
        if (results.length >= maxEntries) return true;
      }
      if (
        await walkPathsInto({ ...args, dir: fullPath }, results, maxEntries)
      ) {
        return true;
      }
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
  return results.length >= maxEntries;
}
