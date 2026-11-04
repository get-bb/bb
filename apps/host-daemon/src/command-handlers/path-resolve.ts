import fs from "node:fs/promises";
import path from "node:path";
import {
  RESOLVE_PATHS_MAX_MATCHES,
  type HostDaemonOnlineRpcResult,
  type PathResolution,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { listWorkspacePaths } from "./file-list.js";

const ROOT_INDEX_MAX_AGE_MS = 10_000;

type ResolvePathsCommand = CommandOf<"host.resolve_paths">;

interface RootIndex {
  byName: Map<string, string[]>;
}

interface CachedRootIndex {
  builtAt: number;
  index: Promise<RootIndex>;
}

interface RankedMatch {
  depth: number;
  path: string;
}

const rootIndexes = new Map<string, CachedRootIndex>();

function referenceSegments(reference: string): string[] | null {
  if (path.isAbsolute(reference) || /^[A-Za-z]:[\\/]/u.test(reference)) {
    return null;
  }
  const segments = reference
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  return segments;
}

async function isExistingPath(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch (error) {
    if (
      isFsErrorWithCode(error, "ENOENT") ||
      isFsErrorWithCode(error, "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

async function buildRootIndex(
  root: string,
  command: ResolvePathsCommand,
): Promise<RootIndex> {
  const byName = new Map<string, string[]>();
  let listed: Awaited<ReturnType<typeof listWorkspacePaths>>;
  try {
    listed = await listWorkspacePaths({
      root,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: command.includeHidden,
      excludeNames: command.excludeNames,
      respectGitIgnore: command.respectGitIgnore,
    });
  } catch (error) {
    if (
      isFsErrorWithCode(error, "ENOENT") ||
      isFsErrorWithCode(error, "ENOTDIR")
    ) {
      return { byName };
    }
    throw error;
  }
  for (const entry of listed) {
    const key = entry.name.toLowerCase();
    const paths = byName.get(key);
    if (paths === undefined) byName.set(key, [entry.path]);
    else paths.push(entry.path);
  }
  return { byName };
}

function rootIndex(
  root: string,
  command: ResolvePathsCommand,
): Promise<RootIndex> {
  const key = JSON.stringify([
    root,
    command.includeHidden,
    command.respectGitIgnore,
    [...command.excludeNames].sort(),
  ]);
  const cached = rootIndexes.get(key);
  if (cached && Date.now() - cached.builtAt < ROOT_INDEX_MAX_AGE_MS) {
    return cached.index;
  }
  const entry: CachedRootIndex = {
    builtAt: Date.now(),
    index: buildRootIndex(root, command),
  };
  rootIndexes.set(key, entry);
  const evict = () => {
    if (rootIndexes.get(key) === entry) rootIndexes.delete(key);
  };
  entry.index.catch(evict);
  setTimeout(evict, ROOT_INDEX_MAX_AGE_MS).unref();
  return entry.index;
}

function endsWithSegments(
  candidate: readonly string[],
  suffix: readonly string[],
  caseSensitive: boolean,
): boolean {
  if (suffix.length > candidate.length) return false;
  const offset = candidate.length - suffix.length;
  return suffix.every((segment, index) => {
    const actual = candidate[offset + index]!;
    return caseSensitive
      ? actual === segment
      : actual.toLowerCase() === segment.toLowerCase();
  });
}

function suffixMatches(
  segments: readonly string[],
  roots: readonly string[],
  indexes: readonly RootIndex[],
): string[] {
  const exactCase: RankedMatch[] = [];
  const anyCase: RankedMatch[] = [];
  const name = segments.at(-1)!.toLowerCase();
  indexes.forEach((index, rootIndexPosition) => {
    for (const relative of index.byName.get(name) ?? []) {
      const candidate = relative.split("/");
      const match = {
        depth: candidate.length,
        path: path.join(roots[rootIndexPosition]!, relative),
      };
      if (endsWithSegments(candidate, segments, true)) exactCase.push(match);
      else if (endsWithSegments(candidate, segments, false))
        anyCase.push(match);
    }
  });
  const ranked = exactCase.length > 0 ? exactCase : anyCase;
  return ranked
    .sort(
      (left, right) =>
        left.depth - right.depth || left.path.localeCompare(right.path),
    )
    .slice(0, RESOLVE_PATHS_MAX_MATCHES)
    .map((match) => match.path);
}

async function resolveExact(
  segments: readonly string[],
  roots: readonly string[],
): Promise<string | null> {
  for (const root of roots) {
    const candidate = path.join(root, ...segments);
    if (await isExistingPath(candidate)) return candidate;
  }
  return null;
}

export async function resolveHostPaths(
  command: ResolvePathsCommand,
): Promise<HostDaemonOnlineRpcResult<"host.resolve_paths">> {
  if (command.roots.some((root) => !path.isAbsolute(root))) {
    throw new CommandDispatchError("invalid_path", "Roots must be absolute");
  }
  const resolutions: Record<string, PathResolution> = {};
  const unresolved: Array<{ reference: string; segments: string[] }> = [];
  await Promise.all(
    command.paths.map(async (reference) => {
      const segments = referenceSegments(reference);
      if (segments === null) {
        resolutions[reference] = { kind: "matches", paths: [] };
        return;
      }
      const exact = await resolveExact(segments, command.roots);
      if (exact !== null) {
        resolutions[reference] = { kind: "exact", path: exact };
        return;
      }
      unresolved.push({ reference, segments });
    }),
  );
  if (unresolved.length > 0) {
    const indexes = await Promise.all(
      command.roots.map((root) => rootIndex(root, command)),
    );
    for (const { reference, segments } of unresolved) {
      resolutions[reference] = {
        kind: "matches",
        paths: suffixMatches(segments, command.roots, indexes),
      };
    }
  }
  return { resolutions };
}
