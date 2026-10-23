import fs from "node:fs/promises";

process.env.GIT_OPTIONAL_LOCKS = "0";
import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
} from "@get-bb/plugin-sdk/host";
import { gitHostContract, type DiffPatchEntry } from "./contract.js";
import {
  selectInitialPatchPaths,
  toDiffFileEntry,
} from "./host/diff-tiering.js";
import { WorkspaceReads } from "./host/workspace-reads.js";
import { gitPriority, withGitPriority } from "./host/git.js";
import type {
  WorkspaceResolutionFailure,
} from "bb-environment-provider-host/git-types";
import { listBranchOptions } from "bb-environment-provider-host/branch-options";
import {
  detectGitRepo,
  workspaceResolutionFailureFromError,
} from "bb-environment-provider-host/workspace-git";

const STATUS_MAX_FILES = 200;
const STATUS_MAX_UNTRACKED_LINE_STAT_FILES = 50;
const STATUS_MAX_UNTRACKED_LINE_STAT_BYTES = 8 * 1024 * 1024;
const DIFF_MAX_FILES = 500;
const PATCH_MAX_BYTES_PER_FILE = 512 * 1024;
const PATCH_BATCH_MAX_BYTES = 6 * 1024 * 1024;

const READS_CACHE_LIMIT = 64;
const readsByPath = new Map<string, WorkspaceReads>();

type HostRead<T> =
  | { outcome: "available"; value: T }
  | { outcome: "unavailable"; failure: WorkspaceResolutionFailure };

function failureFromError(
  error: unknown,
  workspacePath: string,
): WorkspaceResolutionFailure {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
    ? {
        code: "path_not_found",
        message: `Path does not exist: ${workspacePath}`,
        workspacePath,
      }
    : workspaceResolutionFailureFromError(error, workspacePath);
}

function forgetReads(path: string): void {
  const reads = readsByPath.get(path);
  if (reads === undefined) return;
  readsByPath.delete(path);
  void reads.dispose();
}

async function resolveReads(
  path: string,
  tempRoot: string,
): Promise<HostRead<WorkspaceReads>> {
  const known = readsByPath.get(path);
  if (known !== undefined) {
    readsByPath.delete(path);
    readsByPath.set(path, known);
    return { outcome: "available", value: known };
  }
  try {
    await fs.access(path);
    if (!(await detectGitRepo(path, { priority: gitPriority() }))) {
      return {
        outcome: "unavailable",
        failure: {
          code: "not_git_repo",
          message: `Path is not a git repository: ${path}`,
          workspacePath: path,
        },
      };
    }
  } catch (error) {
    return { outcome: "unavailable", failure: failureFromError(error, path) };
  }
  const reads = new WorkspaceReads(path, tempRoot);
  readsByPath.set(path, reads);
  for (const oldest of readsByPath.keys()) {
    if (readsByPath.size <= READS_CACHE_LIMIT) break;
    forgetReads(oldest);
  }
  return { outcome: "available", value: reads };
}

async function read<T>(
  path: string,
  context: ExperimentalHostRpcContext,
  run: (reads: WorkspaceReads) => Promise<T>,
): Promise<HostRead<T>> {
  const resolved = await resolveReads(path, context.experimental_paths.tempDir);
  if (resolved.outcome === "unavailable") return resolved;
  try {
    return { outcome: "available", value: await run(resolved.value) };
  } catch (error) {
    if (readsByPath.get(path) === resolved.value) forgetReads(path);
    return { outcome: "unavailable", failure: failureFromError(error, path) };
  }
}

function fitPatchBatch(entries: readonly DiffPatchEntry[]): {
  patches: DiffPatchEntry[];
  deferred: string[];
} {
  const patches: DiffPatchEntry[] = [];
  const deferred: string[] = [];
  let total = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (patches.length > 0 && total + size > PATCH_BATCH_MAX_BYTES) {
      deferred.push(entry.path);
      continue;
    }
    total += size;
    patches.push(entry);
  }
  return { patches, deferred };
}

function interactive<T>(operation: () => Promise<T>): Promise<T> {
  return withGitPriority("interactive", operation);
}

export default experimental_defineHostEntry({
  contract: gitHostContract,
  dispose: async () => {
    const reads = [...readsByPath.values()];
    readsByPath.clear();
    await Promise.all(reads.map((entry) => entry.dispose()));
  },
  handlers: {
    status: ({ path, freshness, mergeBaseBranch }, context) =>
      read(path, context, (reads) =>
        reads.getStatus({
          freshness,
          ...(mergeBaseBranch === undefined ? {} : { mergeBaseBranch }),
          maxFiles: STATUS_MAX_FILES,
          maxUntrackedLineStatFiles: STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
          maxUntrackedLineStatBytes: STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
        }),
      ),
    diff: ({ path, freshness, target, maxDiffBytes, maxFileListBytes }, context) =>
      interactive(() =>
        read(path, context, (reads) =>
          reads.getDiff({
            freshness,
            target,
            maxDiffBytes,
            maxFileListBytes,
            maxUntrackedFiles: DIFF_MAX_FILES,
          }),
        ),
      ),
    files: ({ path, freshness, target, ignoreWhitespace }, context) =>
      interactive(() =>
        read(path, context, async (reads) => {
          const result = await reads.diffFiles({
            freshness,
            target,
            maxFiles: DIFF_MAX_FILES,
            ignoreWhitespace,
          });
          const files = result.files.map(toDiffFileEntry);
          const initialPatchPaths = selectInitialPatchPaths(files);
          const initialPatches =
            initialPatchPaths.length === 0
              ? []
              : await reads
                  .diffPatch({
                    freshness,
                    target,
                    paths: initialPatchPaths,
                    maxBytesPerFile: PATCH_MAX_BYTES_PER_FILE,
                    ignoreWhitespace,
                  })
                  .then((entries) => fitPatchBatch(entries).patches)
                  .catch(() => []);
          return {
            files,
            truncated: result.truncated,
            shortstat: result.shortstat,
            mergeBaseRef: result.mergeBaseRef,
            initialPatches,
          };
        }),
      ),
    patches: ({ path, freshness, target, ignoreWhitespace, paths }, context) =>
      interactive(() =>
        read(path, context, (reads) =>
          reads
            .diffPatch({
              freshness,
              target,
              paths,
              maxBytesPerFile: PATCH_MAX_BYTES_PER_FILE,
              ignoreWhitespace,
            })
            .then(fitPatchBatch),
        ),
      ),
    branches: ({ path, query, limit, selectedBranch }) =>
      interactive(() =>
        listBranchOptions({
          path,
          limit,
          priority: "interactive",
          remoteRefresh: "background",
          ...(query === undefined ? {} : { query }),
          ...(selectedBranch === undefined ? {} : { selectedBranch }),
        }),
      ),
  },
});
