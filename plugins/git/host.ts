import { createHash } from "node:crypto";
import fs from "node:fs/promises";

process.env.GIT_OPTIONAL_LOCKS = "0";
import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
} from "@get-bb/plugin-sdk/host";
import {
  gitHostContract,
  type DiffPatchEntry,
  type GitHostFiles,
  type GitReadFreshness,
  type WorkspaceDiffTarget,
  type WorkspaceStatus,
} from "./contract.js";
import {
  selectInitialPatchPaths,
  toDiffFileEntry,
} from "./host/diff-tiering.js";
import {
  MISSING_DIFF_REVISION,
  WorkspaceReads,
} from "./host/workspace-reads.js";
import { gitPriority, withGitPriority } from "./host/git.js";
import type {
  WorkspaceResolutionFailure,
} from "bb-environment-provider-host/git-types";
import {
  listBranchOptions,
  refreshRemoteBranches,
} from "bb-environment-provider-host/branch-options";
import {
  detectGitRepo,
  readGitRepo,
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

async function readWith<T>(
  path: string,
  reads: WorkspaceReads,
  run: (reads: WorkspaceReads) => Promise<T>,
): Promise<HostRead<T>> {
  try {
    return { outcome: "available", value: await run(reads) };
  } catch (error) {
    if (readsByPath.get(path) === reads) forgetReads(path);
    return { outcome: "unavailable", failure: failureFromError(error, path) };
  }
}

async function read<T>(
  path: string,
  context: ExperimentalHostRpcContext,
  run: (reads: WorkspaceReads) => Promise<T>,
): Promise<HostRead<T>> {
  const resolved = await resolveReads(path, context.experimental_paths.tempDir);
  if (resolved.outcome === "unavailable") return resolved;
  return readWith(path, resolved.value, run);
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

function readStatus(
  reads: WorkspaceReads,
  freshness: GitReadFreshness,
  mergeBaseBranch: string | undefined,
): Promise<WorkspaceStatus> {
  return reads.getStatus({
    freshness,
    ...(mergeBaseBranch === undefined ? {} : { mergeBaseBranch }),
    maxFiles: STATUS_MAX_FILES,
    maxUntrackedLineStatFiles: STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
    maxUntrackedLineStatBytes: STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

interface FilesQuery {
  target: WorkspaceDiffTarget;
  ignoreWhitespace: boolean;
  knownPatches: readonly { path: string; revision: string }[];
}

async function listFiles(
  reads: WorkspaceReads,
  freshness: GitReadFreshness,
  query: FilesQuery,
) {
  const result = await reads.diffFiles({
    freshness,
    target: query.target,
    maxFiles: DIFF_MAX_FILES,
    ignoreWhitespace: query.ignoreWhitespace,
  });
  const listed = {
    files: result.files.map(toDiffFileEntry),
    truncated: result.truncated,
    shortstat: result.shortstat,
    mergeBaseRef: result.mergeBaseRef,
  };
  return { listed, fingerprint: fingerprint(listed) };
}

async function withInitialPatches(
  reads: WorkspaceReads,
  freshness: GitReadFreshness,
  query: FilesQuery,
  listed: Omit<GitHostFiles, "initialPatches" | "reusedPatchPaths">,
): Promise<GitHostFiles> {
  const { target, ignoreWhitespace } = query;
  const { files } = listed;
  const known = new Map(
    query.knownPatches.map((entry) => [entry.path, entry.revision]),
  );
  const revisionByPath = new Map(
    files.map((file) => [file.path, file.revision]),
  );
  const reusedPatchPaths: string[] = [];
  const readPaths: string[] = [];
  for (const path of selectInitialPatchPaths(files)) {
    const revision = revisionByPath.get(path);
    if (revision !== MISSING_DIFF_REVISION && known.get(path) === revision) {
      reusedPatchPaths.push(path);
    } else {
      readPaths.push(path);
    }
  }
  const initialPatches =
    readPaths.length === 0
      ? []
      : await reads
          .diffPatch({
            freshness,
            target,
            paths: readPaths,
            maxBytesPerFile: PATCH_MAX_BYTES_PER_FILE,
            ignoreWhitespace,
          })
          .then((entries) => fitPatchBatch(entries).patches)
          .catch(() => []);
  return { ...listed, initialPatches, reusedPatchPaths };
}

async function filesPart(
  reads: WorkspaceReads,
  freshness: GitReadFreshness,
  query: FilesQuery,
) {
  const { listed, fingerprint } = await listFiles(reads, freshness, query);
  return {
    fingerprint,
    value: () => withInitialPatches(reads, freshness, query, listed),
  };
}

type SnapshotPart<T> =
  | { outcome: "available"; value: T; fingerprint: string }
  | { outcome: "unchanged" }
  | Extract<HostRead<T>, { outcome: "unavailable" }>;

async function snapshotPart<T>(
  path: string,
  reads: WorkspaceReads,
  unless: string | undefined,
  run: () => Promise<{
    fingerprint: string;
    value: () => Promise<T>;
  }>,
): Promise<SnapshotPart<T>> {
  const read = await readWith(path, reads, async () => {
    const result = await run();
    return result.fingerprint === unless
      ? null
      : { fingerprint: result.fingerprint, value: await result.value() };
  });
  if (read.outcome === "unavailable") return read;
  if (read.value === null) return { outcome: "unchanged" };
  return { outcome: "available", ...read.value };
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
        readStatus(reads, freshness, mergeBaseBranch),
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
    files: async ({ path, freshness, ...query }, context) => {
      const result = await interactive(() =>
        read(path, context, async (reads) => {
          const part = await filesPart(reads, freshness, query);
          return { fingerprint: part.fingerprint, value: await part.value() };
        }),
      );
      return result.outcome === "available"
        ? { outcome: "available" as const, ...result.value }
        : result;
    },
    snapshot: async (
      { path, freshness, mergeBaseBranch, statusUnless, files },
      context,
    ) => {
      const resolved = await resolveReads(
        path,
        context.experimental_paths.tempDir,
      );
      if (resolved.outcome === "unavailable") return resolved;
      const reads = resolved.value;
      const [status, fileLists] = await Promise.all([
        snapshotPart(path, reads, statusUnless, async () => {
          const value = await readStatus(reads, freshness, mergeBaseBranch);
          return { fingerprint: fingerprint(value), value: async () => value };
        }),
        Promise.all(
          files.map(({ unless, ...query }) =>
            interactive(() =>
              snapshotPart(path, reads, unless, () =>
                filesPart(reads, freshness, query),
              ),
            ),
          ),
        ),
      ]);
      return {
        outcome: "available" as const,
        value: { status, files: fileLists },
      };
    },
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
          remoteRefresh: "none",
          ...(query === undefined ? {} : { query }),
          ...(selectedBranch === undefined ? {} : { selectedBranch }),
        }),
      ),
    fetchRemoteBranches: ({ path }) => {
      const options = { priority: "interactive" } as const;
      void readGitRepo(path, options)
        .then((repo) =>
          repo === null
            ? undefined
            : refreshRemoteBranches(repo, options, "background"),
        )
        .catch(() => undefined);
      return Promise.resolve({ ok: true as const });
    },
  },
});
