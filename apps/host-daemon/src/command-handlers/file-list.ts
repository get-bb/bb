import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import type {
  HostPathEntry,
  HostPathEntryKind,
} from "@bb/host-daemon-contract";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import { runInSerialLane } from "../serial-lane.js";
import {
  detectGitRepo,
  runGit,
} from "bb-environment-provider-host/workspace-git";

interface FinalizeListedFilesArgs {
  filePaths: string[];
  limit: number;
  query?: string;
  signal: AbortSignal;
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
  signal: AbortSignal;
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
}

interface CachedListing {
  completedAt: number;
  paths: ListedPath[];
}

const pendingListings = new Map<string, Promise<ListedPath[]>>();
const cachedListings = new Map<string, CachedListing>();

const SLOW_LISTING_MS = 500;
const CACHED_LISTING_REFRESH_AFTER_MS = 2_000;
const CACHED_LISTING_MAX_AGE_MS = 30_000;

const RANKING_CHUNK_SIZE = 10_000;
const CHUNKED_RANKING_LANE = "chunked-ranking";
const chunkedRankingLanes = new Map<string, Promise<void>>();

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
  const cached = cachedListings.get(key);
  const cachedAgeMs = cached ? Date.now() - cached.completedAt : null;
  if (
    cached === undefined ||
    cachedAgeMs === null ||
    cachedAgeMs >= CACHED_LISTING_MAX_AGE_MS
  ) {
    return refreshWorkspacePaths(key, args);
  }
  if (cachedAgeMs >= CACHED_LISTING_REFRESH_AFTER_MS) {
    void refreshWorkspacePaths(key, args).catch(() => undefined);
  }
  return Promise.resolve(cached.paths);
}

function refreshWorkspacePaths(
  key: string,
  args: ListWorkspacePathsArgs,
): Promise<ListedPath[]> {
  const existing = pendingListings.get(key);
  if (existing) return existing;
  const startedAt = Date.now();
  const listing = discoverWorkspacePaths(args)
    .then(
      (paths) => {
        const completedAt = Date.now();
        if (completedAt - startedAt >= SLOW_LISTING_MS) {
          cacheListing(key, { completedAt, paths });
        } else {
          cachedListings.delete(key);
        }
        return paths;
      },
      (error: unknown) => {
        cachedListings.delete(key);
        throw error;
      },
    )
    .finally(() => {
      pendingListings.delete(key);
    });
  pendingListings.set(key, listing);
  return listing;
}

function cacheListing(key: string, listing: CachedListing): void {
  cachedListings.set(key, listing);
  setTimeout(() => {
    if (cachedListings.get(key) === listing) {
      cachedListings.delete(key);
    }
  }, CACHED_LISTING_MAX_AGE_MS).unref();
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

export async function finalizeListedFiles(
  args: FinalizeListedFilesArgs,
): Promise<FinalizedFileList> {
  const result = await finalizeListedPaths({
    paths: args.filePaths.map(toListedFile),
    limit: args.limit,
    includeFiles: true,
    includeDirectories: false,
    signal: args.signal,
    ...(args.query ? { query: args.query } : {}),
  });

  return {
    files: result.paths.map(toFileListEntry),
    truncated: result.truncated,
  };
}

function matchListedPaths(
  items: readonly ListedPath[],
  query: string,
  limit: number,
) {
  return fuzzyMatchPaths({
    items,
    query,
    getPath: (pathEntry) => pathEntry.path,
    limit,
  });
}

function throwIfPathSearchCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ExpectedCommandDispatchError(
      "cancelled",
      "Path search was cancelled",
    );
  }
}

async function rankListedPathsInChunks(
  items: readonly ListedPath[],
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  const candidates: ListedPath[] = [];
  for (let start = 0; start < items.length; start += RANKING_CHUNK_SIZE) {
    await yieldToEventLoop();
    throwIfPathSearchCancelled(signal);
    const chunk = items.slice(start, start + RANKING_CHUNK_SIZE);
    for (const match of matchListedPaths(chunk, query, limit)) {
      candidates.push(match.item);
    }
  }
  await yieldToEventLoop();
  throwIfPathSearchCancelled(signal);
  return matchListedPaths(candidates, query, limit);
}

async function rankListedPaths(
  items: readonly ListedPath[],
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  if (items.length <= RANKING_CHUNK_SIZE) {
    return matchListedPaths(items, query, limit);
  }
  return runInSerialLane(chunkedRankingLanes, CHUNKED_RANKING_LANE, () =>
    rankListedPathsInChunks(items, query, limit, signal),
  );
}

export async function finalizeListedPaths(
  args: FinalizeListedPathsArgs,
): Promise<FinalizedPathList> {
  throwIfPathSearchCancelled(args.signal);
  const pathEntries = args.paths.filter((pathEntry) =>
    shouldIncludePath(pathEntry.kind, args),
  );
  let rankedEntries: HostPathEntry[];

  if (args.query) {
    const matches = await rankListedPaths(
      pathEntries,
      args.query,
      args.limit + 1,
      args.signal,
    );
    rankedEntries = matches.map((match) => ({
      ...match.item,
      score: match.score,
      positions: match.positions,
    }));
  } else {
    rankedEntries = pathEntries.slice(0, args.limit + 1).map((pathEntry) => ({
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
