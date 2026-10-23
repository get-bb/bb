import path from "node:path";
import {
  parseNameStatusEntries,
  parseNameStatusSourceEntries,
  parseNumstatEntriesZ,
  gitPriority,
  readMergeBaseRef,
  runGitWithNullRecordLimit,
  type GitNullRecordFormat,
  type GitNullRecordLimitResult,
  parseRawDiffEntriesZ,
  type RawDiffEntry,
  type NumstatEntry,
  summarizeNumstat,
} from "./git.js";
import {
  parsePorcelainV2StatusZ,
  readRepoDefaultBranch,
  type GitCommandResult,
  type RunGitOptions,
  isMissingHeadRevisionError,
  WORKSPACE_STATUS_GIT_TIMEOUT_MS,
  runGit,
  WorkspaceError,
} from "bb-environment-provider-host/workspace-git";
import { ByteBudgetCache } from "./byte-budget-cache.js";
import {
  readCommitChanges,
  readCommitPatchIds,
  readPatchEquivalentCommits,
  readSquashRangePatchId,
  type CommitGitRunner,
} from "./commit-cache.js";
import fs from "node:fs/promises";
import type {
  GitReadFreshness,
  RawDiffFileStat,
  ThreadGitDiffResponse,
  WorkspaceCommitSummary,
  WorkspaceDiffTarget,
  WorkspaceFileStatus,
  WorkspaceFileStatusKind,
  WorkspaceStatus,
} from "../contract.js";
import type { GitCheckoutRef } from "bb-environment-provider-host/git-types";

export interface DiffOptions {
  freshness: ReadFreshness;
  target: WorkspaceDiffTarget;
  maxDiffBytes: number;
  maxFileListBytes: number;
  maxUntrackedFiles: number;
}

export type ReadFreshness = GitReadFreshness;

export interface StatusOptions {
  freshness: ReadFreshness;
  mergeBaseBranch?: string;
  maxFiles?: number;
  maxUntrackedLineStatFiles?: number;
  maxUntrackedLineStatBytes?: number;
}

export type DiffResult = ThreadGitDiffResponse;


export interface DiffFilesArgs {
  freshness: ReadFreshness;
  target: WorkspaceDiffTarget;
  maxFiles: number;
  ignoreWhitespace: boolean;
}

export interface DiffFilesResult {
  files: RawDiffFileStat[];
  shortstat: string;
  mergeBaseRef: string | null;
  truncated: boolean;
}

export interface DiffPatchArgs {
  freshness: ReadFreshness;
  target: WorkspaceDiffTarget;
  paths: string[];
  maxBytesPerFile: number;
  ignoreWhitespace: boolean;
}

export interface DiffPatchEntry {
  path: string;
  patch: string;
  truncated: boolean;
}









type TruncatedOutput = {
  value: string;
  truncated: boolean;
};


type BoundedDiffStatArtifacts = {
  trackedEntries: RawDiffEntry[];
  numstat: string;
  mergeBaseRef: string | null;
  untrackedPaths: string[];
  truncated: boolean;
};

type UntrackedStatusNumstatEnrichment = {
  entries: NumstatEntry[];
  complete: boolean;
};

type ReadTrackedPatchByPathArgs = {
  freshness: ReadFreshness;
  target: WorkspaceDiffTarget;
  paths: string[];
  maxBytesPerFile: number;
  ignoreWhitespace: boolean;
};

type ResolvedTrackedDiffRange = {
  baseArgs: string[];
  rangeArgs: string[];
  usesUncommittedHead: boolean;
  mergeBaseRef: string | null;
};


type SquashMergeCheck = { merged: boolean | null; timedOut: boolean };
type MergeBaseStatusComputation = {
  status: WorkspaceStatus["mergeBase"];
  retryable: boolean;
};

const MERGE_BASE_STATUS_CACHE_BYTES = 16 * 1024 * 1024;
const mergeBaseStatusCache = new ByteBudgetCache<
  NonNullable<WorkspaceStatus["mergeBase"]>
>(MERGE_BASE_STATUS_CACHE_BYTES);
const pendingMergeBaseStatuses = new Map<
  string,
  Promise<MergeBaseStatusComputation>
>();
const SQUASH_MERGE_MAX_METADATA_COMMITS = 1_000;
const SQUASH_MERGE_TIMEOUT_MS = 1_000;
const SQUASH_MERGE_MAX_PATCH_BYTES = 8 * 1024 * 1024;
const WORKSPACE_STATUS_UNTRACKED_ENRICHMENT_TIMEOUT_MS = 10_000;
const TEMPORARY_UNTRACKED_INDEX_ADD_ATTEMPTS = 3;
const DIFF_NUMSTAT_BASE_BUFFER_BYTES = 64 * 1024;
const DIFF_NUMSTAT_PER_FILE_BUFFER_BYTES = 16 * 1024;
const ZERO_BLOB_PATTERN = /^0+$/u;
const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0" };
const UNSPLIT_INDEX_ENV = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.splitIndex",
  GIT_CONFIG_VALUE_0: "false",
};

const STATUS_SNAPSHOT_LIMIT = 4;
const COARSE_RACY_SIGNATURE_WINDOW_MS = 2_000;
const FINE_RACY_SIGNATURE_WINDOW_MS = 5;
const REF_READ_LIMIT = 64;
const TRACKED_ENTRIES_LIMIT = 8;
const STATUS_ARGS = [
  "--no-optional-locks",
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all",
];

function readGit(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  return runGit(args, {
    ...options,
    priority: options.priority ?? gitPriority(),
    env: { ...READ_ONLY_GIT_ENV, ...options.env },
  });
}

type StatusSnapshot = {
  result: GitCommandResult;
  parsed: ReturnType<typeof parsePorcelainV2StatusZ> | null;
  untrackedPaths: string[];
};

type UntrackedFileStat = {
  numstat: NumstatEntry | undefined;
  raw: RawDiffEntry | undefined;
  blob: string | null | undefined;
};

type RetainedUntrackedIndex = {
  work: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  paths: ReadonlySet<string>;
  users: number;
  superseded: boolean;
};

function remember<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  limit: number,
): V {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
  return value;
}

function cachedRead<T>(
  map: Map<string, Promise<T>>,
  key: readonly unknown[],
  load: () => Promise<T>,
  limit: number,
): Promise<T> {
  const id = JSON.stringify(key);
  const known = map.get(id);
  if (known !== undefined) return known;
  const read = load();
  remember(map, id, read, limit);
  read.catch(() => {
    if (map.get(id) === read) map.delete(id);
  });
  return read;
}

interface IndexCopy {
  signature: string;
  env: Promise<NodeJS.ProcessEnv>;
  users: number;
  retired: boolean;
}

function removeIfUnused(copy: IndexCopy): void {
  if (!copy.retired || copy.users > 0) return;
  void copy.env.then(
    (env) =>
      env.GIT_INDEX_FILE === undefined
        ? undefined
        : fs.rm(path.dirname(env.GIT_INDEX_FILE), {
            recursive: true,
            force: true,
          }),
    () => undefined,
  );
}

function statusFailure(result: GitCommandResult, workspacePath: string): Error {
  const detail = result.stderr.trim();
  return /not a git repository/iu.test(detail)
    ? new WorkspaceError(
        "not_git_repo",
        `Path is not a git repository: ${workspacePath}`,
      )
    : new WorkspaceError(
        "git_command_failed",
        `git status failed${detail ? `: ${detail}` : ""}`,
      );
}

function splitRawNumstatZ(stdout: string): { raw: string; numstat: string } {
  const tokens = stdout.split("\0");
  let index = 0;
  while (index < tokens.length && tokens[index]?.startsWith(":")) {
    const record = tokens[index] ?? "";
    const statusLetter = record[record.lastIndexOf(" ") + 1];
    index += statusLetter === "R" || statusLetter === "C" ? 3 : 2;
  }
  return {
    raw: index === 0 ? "" : `${tokens.slice(0, index).join("\0")}\0`,
    numstat: tokens.slice(index).join("\0"),
  };
}
const MISSING_DIFF_REVISION = "missing";

function squashChangeSignature(entries: RawDiffEntry[]): string {
  return JSON.stringify(
    entries
      .map((entry) => [
        entry.path,
        entry.oldMode,
        entry.newMode,
        entry.oldBlob,
        entry.newBlob,
      ])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function whitespaceDiffArgs(ignoreWhitespace: boolean): string[] {
  return ignoreWhitespace ? ["-w"] : [];
}

function formatDiffRevision(
  entry: RawDiffEntry,
  worktreeBlobs: ReadonlyMap<string, string>,
): string {
  const newBlob = ZERO_BLOB_PATTERN.test(entry.newBlob)
    ? (worktreeBlobs.get(entry.path) ?? entry.newBlob)
    : entry.newBlob;
  return `${entry.oldMode}:${entry.oldBlob}:${entry.newMode}:${newBlob}`;
}

function resolveWorkspaceFileStatusKind(args: {
  indexStatus: string;
  status: string;
  worktreeStatus: string;
}): WorkspaceFileStatusKind {
  if (args.status === "??") {
    return "??";
  }
  if (
    args.indexStatus === "U" ||
    args.worktreeStatus === "U" ||
    args.status.includes("U")
  ) {
    return "U";
  }
  if (
    args.indexStatus === "R" ||
    args.worktreeStatus === "R" ||
    args.status.includes("R")
  ) {
    return "R";
  }
  if (
    args.indexStatus === "C" ||
    args.worktreeStatus === "C" ||
    args.status.includes("C")
  ) {
    return "C";
  }
  if (
    args.indexStatus === "A" ||
    args.worktreeStatus === "A" ||
    args.status.includes("A")
  ) {
    return "A";
  }
  if (
    args.indexStatus === "D" ||
    args.worktreeStatus === "D" ||
    args.status.includes("D")
  ) {
    return "D";
  }
  return "M";
}

function mapNameStatusLetter(letter: string): WorkspaceFileStatusKind {
  switch (letter) {
    case "A":
    case "D":
    case "R":
    case "C":
    case "U":
    case "M":
      return letter;
    case "T":
      return "M";
    default:
      return "?";
  }
}

function resolveWorkspaceState(args: {
  hasCommittedChanges: boolean;
  hasTrackedChanges: boolean;
  hasUntracked: boolean;
}): WorkspaceStatus["workingTree"]["state"] {
  if (
    !args.hasTrackedChanges &&
    !args.hasUntracked &&
    !args.hasCommittedChanges
  ) {
    return "clean";
  }
  if (
    (args.hasTrackedChanges || args.hasUntracked) &&
    args.hasCommittedChanges
  ) {
    return "dirty_and_committed_unmerged";
  }
  if (args.hasUntracked && !args.hasTrackedChanges) {
    return "untracked";
  }
  if (args.hasTrackedChanges) {
    return "dirty_uncommitted";
  }
  return "committed_unmerged";
}


function formatShortstat(args: {
  changedFiles: number;
  deletions: number;
  insertions: number;
}): string {
  if (args.changedFiles === 0) {
    return "";
  }

  const parts = [
    `${args.changedFiles} file${args.changedFiles === 1 ? "" : "s"} changed`,
  ];
  if (args.insertions > 0) {
    parts.push(
      `${args.insertions} insertion${args.insertions === 1 ? "" : "s"}(+)`,
    );
  }
  if (args.deletions > 0) {
    parts.push(
      `${args.deletions} deletion${args.deletions === 1 ? "" : "s"}(-)`,
    );
  }

  return `${parts.join(", ")}\n`;
}

function truncateToMaxBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  let cut = maxBytes;
  while (cut > 0 && (buffer[cut] & 0xc0) === 0x80) {
    cut -= 1;
  }
  return buffer.subarray(0, cut).toString("utf8");
}

function truncateOutputToMaxBytes(
  value: string,
  maxBytes: number | undefined,
): TruncatedOutput {
  if (
    typeof maxBytes !== "number" ||
    Buffer.byteLength(value, "utf8") <= maxBytes
  ) {
    return { value, truncated: false };
  }
  return { value: truncateToMaxBytes(value, maxBytes), truncated: true };
}

function withDiffPathspec(
  args: string[],
  paths: string[] | undefined,
): string[] {
  if (paths === undefined) {
    return args;
  }
  const withoutSeparator =
    args[args.length - 1] === "--" ? args.slice(0, -1) : args;
  return [...withoutSeparator, "--", ...paths];
}

const COMBINED_PAGE_PER_FILE_HEADROOM_BYTES = 4 * 1024;
const COMBINED_PAGE_BASE_HEADROOM_BYTES = 64 * 1024;

function combinedPageBufferBudget(
  fileCount: number,
  maxBytesPerFile: number,
): number {
  return (
    COMBINED_PAGE_BASE_HEADROOM_BYTES +
    fileCount * (maxBytesPerFile + COMBINED_PAGE_PER_FILE_HEADROOM_BYTES)
  );
}

function buildDiffOutputGitOptions(
  cwd: string,
  maxBytes: number | undefined,
): RunGitOptions {
  if (typeof maxBytes !== "number") {
    return { cwd };
  }
  return {
    cwd,
    maxBufferBytes: maxBytes + 1,
    allowTruncatedStdout: true,
  };
}

type GitRunner = (
  args: string[],
  options: RunGitOptions,
) => Promise<GitCommandResult>;

async function readEmptyTreeSha(
  workspacePath: string,
  run: GitRunner,
  timeoutMs?: number,
): Promise<string> {
  const emptyTree = await run(["hash-object", "-t", "tree", "--stdin"], {
    cwd: workspacePath,
    input: "",
    timeoutMs,
  });
  const emptyTreeSha = emptyTree.stdout.trim();
  if (emptyTreeSha.length === 0) {
    throw new WorkspaceError(
      "git_command_failed",
      "git hash-object returned no empty tree SHA",
    );
  }
  return emptyTreeSha;
}

type UncommittedDiffRunner = (
  buildArgs: (baseRef: string) => string[],
  options: RunGitOptions,
) => Promise<GitCommandResult>;

function createUncommittedDiffRunner(
  workspacePath: string,
  run: GitRunner,
): UncommittedDiffRunner {
  let emptyTreeShaPromise: Promise<string> | null = null;

  return async (buildArgs, options) => {
    if (emptyTreeShaPromise !== null) {
      return run(buildArgs(await emptyTreeShaPromise), options);
    }

    const headArgs = buildArgs("HEAD");
    const headResult = await run(headArgs, { ...options, allowFailure: true });
    if (headResult.exitCode === 0) {
      return headResult;
    }
    if (!isMissingHeadRevisionError(headResult.stderr)) {
      const detail = headResult.stderr.trim();
      throw new WorkspaceError(
        "git_command_failed",
        `git ${headArgs.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      );
    }

    emptyTreeShaPromise ??= readEmptyTreeSha(
      workspacePath,
      run,
      options.timeoutMs,
    );
    return run(buildArgs(await emptyTreeShaPromise), options);
  };
}

export class WorkspaceReads {
  readonly path: string;

  private readonly statusSnapshots = new Map<string, Promise<StatusSnapshot>>();
  private readonly defaultBranchReads = new Map<
    string,
    Promise<string | undefined>
  >();
  private readonly commitReads = new Map<string, Promise<string | null>>();
  private readonly mergeBaseReads = new Map<
    string,
    Promise<string | undefined>
  >();
  private readonly trackedEntriesByDiff = new Map<
    string,
    Promise<RawDiffEntry[]>
  >();
  private readonly untrackedStats = new Map<
    string,
    {
      signature: string;
      racy: boolean;
      work: string;
      stat: Promise<UntrackedFileStat | undefined>;
    }
  >();
  private retainedIndex: RetainedUntrackedIndex | null = null;
  private untrackedStatsRegistration: Promise<void> = Promise.resolve();
  private realIndexPathRead: Promise<string> | null = null;
  private indexCopy: IndexCopy | null = null;

  constructor(
    path: string,
    private readonly tempRoot: string,
  ) {
    this.path = path;
  }

  async dispose(): Promise<void> {
    const retained = this.retainedIndex;
    this.retainedIndex = null;
    if (retained !== null) await this.releaseRetainedIndex(retained, true);
    const indexCopy = this.indexCopy;
    this.indexCopy = null;
    if (indexCopy !== null) {
      indexCopy.retired = true;
      removeIfUnused(indexCopy);
    }
  }

  private createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(this.tempRoot, prefix));
  }

  private statusSnapshot(work: string): Promise<StatusSnapshot> {
    const known = this.statusSnapshots.get(work);
    if (known !== undefined) return known;
    if (this.retainedIndex !== null && this.retainedIndex.work !== work) {
      const retained = this.retainedIndex;
      this.retainedIndex = null;
      void this.releaseRetainedIndex(retained, true);
    }
    const snapshot = this.runGit(STATUS_ARGS, {
      cwd: this.path,
      allowFailure: true,
      timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
    }).then((result): StatusSnapshot => {
      const parsed =
        result.exitCode === 0 ? parsePorcelainV2StatusZ(result.stdout) : null;
      const untrackedPaths =
        parsed?.entries
          .filter((entry) => entry.status === "??")
          .map((entry) => entry.path) ?? [];
      if (parsed !== null) {
        const current = new Set(untrackedPaths);
        for (const known of this.untrackedStats.keys()) {
          if (!current.has(known)) this.untrackedStats.delete(known);
        }
      }
      return { result, parsed, untrackedPaths };
    });
    remember(this.statusSnapshots, work, snapshot, STATUS_SNAPSHOT_LIMIT);
    snapshot.catch(() => {
      if (this.statusSnapshots.get(work) === snapshot) {
        this.statusSnapshots.delete(work);
      }
    });
    return snapshot;
  }

  private async requireStatusSnapshot(
    work: string,
  ): Promise<StatusSnapshot & { parsed: NonNullable<StatusSnapshot["parsed"]> }> {
    const snapshot = await this.statusSnapshot(work);
    if (snapshot.parsed === null) throw statusFailure(snapshot.result, this.path);
    return { ...snapshot, parsed: snapshot.parsed };
  }

  private defaultBranch(refs: string): Promise<string | undefined> {
    return cachedRead(
      this.defaultBranchReads,
      [refs],
      () =>
        readRepoDefaultBranch(this.path, {
          timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
          priority: gitPriority(),
        }),
      REF_READ_LIMIT,
    );
  }

  private resolveCommit(
    refs: string,
    revision: string,
    timeoutMs?: number,
  ): Promise<string | null> {
    return cachedRead(
      this.commitReads,
      [refs, revision],
      async () => {
        const result = await this.runGit(["rev-parse", `${revision}^{commit}`], {
          cwd: this.path,
          allowFailure: true,
          timeoutMs,
        });
        const sha = result.stdout.trim();
        return result.exitCode === 0 && sha.length > 0 ? sha : null;
      },
      REF_READ_LIMIT,
    );
  }

  private async resolveMergeBaseRef(
    freshness: ReadFreshness,
    mergeBaseBranch: string,
  ): Promise<string | undefined> {
    const snapshot = await this.requireStatusSnapshot(freshness.work);
    const read = () =>
      readMergeBaseRef(this.path, mergeBaseBranch, {});
    const headOid = snapshot.parsed.headOid;
    return headOid === null
      ? read()
      : cachedRead(
          this.mergeBaseReads,
          [freshness.refs, headOid, mergeBaseBranch],
          read,
          REF_READ_LIMIT,
        );
  }

  private async fileSignature(
    relativePath: string,
  ): Promise<{ signature: string; racy: boolean } | null> {
    try {
      const signedAt = Date.now();
      const stats = await fs.lstat(path.join(this.path, relativePath));
      if (!stats.isFile() && !stats.isSymbolicLink()) return null;
      return {
        signature: [
          stats.mode,
          stats.size,
          stats.mtimeMs,
          stats.ctimeMs,
          stats.ino,
        ].join(":"),
        racy:
          Math.max(stats.mtimeMs, stats.ctimeMs) >=
          signedAt -
            (stats.mtimeMs % 1_000 === 0
              ? COARSE_RACY_SIGNATURE_WINDOW_MS
              : FINE_RACY_SIGNATURE_WINDOW_MS),
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async readUntrackedStats(
    work: string,
    relativePaths: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Map<string, UntrackedFileStat>> {
    const registered = this.untrackedStatsRegistration.then(() =>
      this.registerUntrackedStats(work, relativePaths, options),
    );
    this.untrackedStatsRegistration = registered.then(
      () => undefined,
      () => undefined,
    );
    const signatures = await registered;
    const stats = new Map<string, UntrackedFileStat>();
    for (const [relativePath, signed] of signatures) {
      if (signed === null) continue;
      const stat = await this.untrackedStats.get(relativePath)?.stat;
      if (stat !== undefined) stats.set(relativePath, stat);
    }
    return stats;
  }

  private async registerUntrackedStats(
    work: string,
    relativePaths: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<
    (readonly [string, { signature: string; racy: boolean } | null])[]
  > {
    const signatures = await Promise.all(
      relativePaths.map(
        async (relativePath) =>
          [relativePath, await this.fileSignature(relativePath)] as const,
      ),
    );
    const missing = signatures.flatMap(([relativePath, signed]) => {
      if (signed === null) return [];
      const cached = this.untrackedStats.get(relativePath);
      return cached === undefined ||
        cached.signature !== signed.signature ||
        (cached.racy && cached.work !== work)
        ? [{ relativePath, signature: signed.signature, racy: signed.racy }]
        : [];
    });
    if (missing.length > 0) {
      const batch = this.withRetainedUntrackedIndex(
        work,
        missing.map((entry) => entry.relativePath),
        async (env, indexedPaths) => {
          if (indexedPaths.length === 0) {
            return new Map<string, UntrackedFileStat>();
          }
          const result = await this.runGit(
            ["diff", "--no-ext-diff", "--raw", "--numstat", "--no-abbrev", "-z"],
            {
              cwd: this.path,
              env,
              signal: options.signal,
              timeoutMs: options.timeoutMs,
              maxBufferBytes:
                DIFF_NUMSTAT_BASE_BUFFER_BYTES +
                indexedPaths.length * 2 * DIFF_NUMSTAT_PER_FILE_BUFFER_BYTES,
            },
          );
          const { raw, numstat } = splitRawNumstatZ(result.stdout);
          const rawByPath = new Map(
            parseRawDiffEntriesZ(raw).map((entry) => [entry.path, entry] as const),
          );
          const numstatByPath = new Map(
            parseNumstatEntriesZ(numstat).map(
              (entry) => [entry.path, entry] as const,
            ),
          );
          return new Map(
            indexedPaths.map((relativePath) => [
              relativePath,
              {
                numstat: numstatByPath.get(relativePath),
                raw: rawByPath.get(relativePath),
                blob: undefined,
              },
            ]),
          );
        },
        options,
      );
      for (const { relativePath, signature, racy } of missing) {
        const stat = batch.then((stats) => stats.get(relativePath));
        this.untrackedStats.set(relativePath, { signature, racy, work, stat });
        stat.catch(() => {
          if (this.untrackedStats.get(relativePath)?.stat === stat) {
            this.untrackedStats.delete(relativePath);
          }
        });
      }
    }
    return signatures;
  }

  private async withRetainedUntrackedIndex<T>(
    work: string,
    relativePaths: readonly string[],
    read: (env: NodeJS.ProcessEnv, indexedPaths: readonly string[]) => Promise<T>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    return this.withTemporaryUntrackedIndex(
      relativePaths,
      read,
      options,
      (dir, env, indexedPaths) => {
        const previous = this.retainedIndex;
        if (this.statusSnapshots.has(work) && indexedPaths.length > 0) {
          this.retainedIndex = {
            work,
            dir,
            env,
            paths: new Set(indexedPaths),
            users: 0,
            superseded: false,
          };
          if (previous !== null) void this.releaseRetainedIndex(previous, true);
          return true;
        }
        return false;
      },
    );
  }

  private async readFromRetainedUntrackedIndex<T>(
    work: string,
    relativePaths: readonly string[],
    read: (env: NodeJS.ProcessEnv, indexedPaths: readonly string[]) => Promise<T>,
  ): Promise<{ value: T } | null> {
    const retained = this.retainedIndex;
    if (
      retained === null ||
      retained.work !== work ||
      !relativePaths.every((relativePath) => retained.paths.has(relativePath))
    ) {
      return null;
    }
    retained.users += 1;
    try {
      return { value: await read(retained.env, relativePaths) };
    } finally {
      retained.users -= 1;
      void this.releaseRetainedIndex(retained, false);
    }
  }

  private async releaseRetainedIndex(
    retained: RetainedUntrackedIndex,
    supersede: boolean,
  ): Promise<void> {
    if (supersede) retained.superseded = true;
    if (!retained.superseded || retained.users > 0) return;
    await fs.rm(retained.dir, { recursive: true, force: true });
  }

  private runGit(
    args: string[],
    options: RunGitOptions,
  ): Promise<GitCommandResult> {
    return this.withIndexEnv(args, options, (indexEnv) =>
      readGit(args, {
        ...options,
        env: { ...indexEnv, ...options.env },
      }),
    );
  }

  private runGitWithNullRecordLimit(
    args: string[],
    options: RunGitOptions,
    recordFormat: GitNullRecordFormat,
    maxRecords: number,
  ): Promise<GitNullRecordLimitResult> {
    return this.withIndexEnv(args, options, (indexEnv) =>
      runGitWithNullRecordLimit(
        args,
        {
          ...options,
            env: { ...READ_ONLY_GIT_ENV, ...indexEnv, ...options.env },
        },
        recordFormat,
        maxRecords,
      ),
    );
  }

  private async withIndexEnv<T>(
    args: readonly string[],
    options: RunGitOptions,
    run: (indexEnv: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    if (args[0] !== "diff" || options.env?.GIT_INDEX_FILE !== undefined) {
      return run({});
    }
    const copy = await this.acquireIndexCopy();
    if (copy === null) return run({});
    try {
      return await run(await copy.env);
    } finally {
      copy.users -= 1;
      removeIfUnused(copy);
    }
  }

  private realIndexPath(): Promise<string> {
    this.realIndexPathRead ??= readGit(["rev-parse", "--git-path", "index"], {
      cwd: this.path,
    }).then((result) => path.resolve(this.path, result.stdout.trim()));
    this.realIndexPathRead.catch(() => {
      this.realIndexPathRead = null;
    });
    return this.realIndexPathRead;
  }

  private async acquireIndexCopy(): Promise<IndexCopy | null> {
    const realPath = await this.realIndexPath();
    const stats = await fs.stat(realPath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (stats === null) return null;
    const signature = [stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino].join(
      ":",
    );
    let copy = this.indexCopy;
    if (copy?.signature !== signature) {
      if (copy !== null) {
        copy.retired = true;
        removeIfUnused(copy);
      }
      const created: IndexCopy = {
        signature,
        users: 0,
        retired: false,
        env: (async () => {
          const dir = await this.createTempDir("bb-index-copy-");
          const copyPath = path.join(dir, "index");
          await fs.copyFile(realPath, copyPath);
          await fs.utimes(copyPath, stats.atime, stats.mtime);
          return { ...UNSPLIT_INDEX_ENV, GIT_INDEX_FILE: copyPath };
        })(),
      };
      created.env.catch(() => {
        if (this.indexCopy === created) this.indexCopy = null;
      });
      this.indexCopy = created;
      copy = created;
    }
    copy.users += 1;
    return copy;
  }

  async getStatus(options: StatusOptions): Promise<WorkspaceStatus> {
    const maxFiles = options.maxFiles;
    if (maxFiles !== undefined) {
      assertPositiveInteger(maxFiles, "maxFiles");
    }
    const maxUntrackedLineStatFiles = options.maxUntrackedLineStatFiles;
    const maxUntrackedLineStatBytes = options.maxUntrackedLineStatBytes;
    const hasLineStatFileBudget = maxUntrackedLineStatFiles !== undefined;
    const hasLineStatByteBudget = maxUntrackedLineStatBytes !== undefined;
    if (hasLineStatFileBudget !== hasLineStatByteBudget) {
      throw new WorkspaceError(
        "invalid_request",
        "Untracked line-stat file and byte budgets must be provided together",
      );
    }
    if (
      maxUntrackedLineStatFiles !== undefined &&
      maxUntrackedLineStatBytes !== undefined
    ) {
      assertPositiveInteger(
        maxUntrackedLineStatFiles,
        "maxUntrackedLineStatFiles",
      );
      assertPositiveInteger(
        maxUntrackedLineStatBytes,
        "maxUntrackedLineStatBytes",
      );
    }
    const mergeBaseBranch = options.mergeBaseBranch;
    const { freshness } = options;
    const snapshotRead = this.statusSnapshot(freshness.work);
    const otherReads = Promise.all([
      createUncommittedDiffRunner(this.path, (gitArgs, gitOptions) =>
        this.runGit(gitArgs, gitOptions),
      )((baseRef) => ["diff", "--numstat", "-z", baseRef, "--"], {
        cwd: this.path,
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
      }).then((result) => result.stdout),
      this.defaultBranch(freshness.refs),
      mergeBaseBranch
        ? snapshotRead.then((snapshot) =>
            this.readMergeBaseStatus(
              mergeBaseBranch,
              maxFiles,
              freshness.refs,
              snapshot.parsed?.headOid ?? null,
              WORKSPACE_STATUS_GIT_TIMEOUT_MS,
            ),
          )
        : null,
    ]);
    otherReads.catch(() => undefined);
    const snapshot = await snapshotRead;
    if (snapshot.parsed === null) {
      throw statusFailure(snapshot.result, this.path);
    }
    const [diffOutput, defaultBranch, mergeBaseData] = await otherReads;
    const { entries, headOid, headBranch } = snapshot.parsed;
    const checkout: GitCheckoutRef =
      headBranch === null
        ? headOid === null
          ? {
              kind: "unknown",
              reason: "HEAD is not symbolic and no commit is checked out",
            }
          : { kind: "detached", headSha: headOid }
        : headOid === null
          ? { kind: "unborn", branchName: headBranch }
          : { kind: "branch", branchName: headBranch, headSha: headOid };
    const untrackedPaths = entries
      .filter((entry) => entry.status === "??")
      .map((entry) => entry.path);
    const trackedNumstatEntries = parseNumstatEntriesZ(diffOutput);
    const untrackedNumstatEnrichment =
      maxUntrackedLineStatFiles !== undefined &&
      maxUntrackedLineStatBytes !== undefined
        ? await this.readBoundedUntrackedStatusNumstat({
            work: freshness.work,
            paths: untrackedPaths,
            maxFiles: maxUntrackedLineStatFiles,
            maxBytes: maxUntrackedLineStatBytes,
          })
        : { entries: [], complete: false };
    const trackedNumstatByPath = new Map(
      trackedNumstatEntries.map((entry) => [entry.path, entry] as const),
    );
    const untrackedNumstatByPath = new Map(
      untrackedNumstatEnrichment.entries.map(
        (entry) => [entry.path, entry] as const,
      ),
    );
    let workingTreeInsertions = 0;
    let workingTreeDeletions = 0;
    for (const entry of [
      ...trackedNumstatEntries,
      ...untrackedNumstatEnrichment.entries,
    ]) {
      if (entry.insertions !== null) workingTreeInsertions += entry.insertions;
      if (entry.deletions !== null) workingTreeDeletions += entry.deletions;
    }
    const listedEntries =
      maxFiles === undefined ? entries : entries.slice(0, maxFiles);
    const files: WorkspaceFileStatus[] = listedEntries.map((entry) => {
      const numstat =
        entry.status === "??"
          ? untrackedNumstatByPath.get(entry.path)
          : trackedNumstatByPath.get(entry.path);
      return {
        path: entry.path,
        status: resolveWorkspaceFileStatusKind({
          indexStatus: entry.indexStatus,
          status: entry.status,
          worktreeStatus: entry.worktreeStatus,
        }),
        insertions: numstat?.insertions ?? null,
        deletions: numstat?.deletions ?? null,
      };
    });
    const hasUntracked = untrackedPaths.length > 0;
    const hasTrackedChanges = entries.some((entry) => entry.status !== "??");
    const hasDirtyEntries = entries.length > 0;
    const hasCommittedChanges =
      mergeBaseData?.hasCommittedUnmergedChanges ?? false;
    const state = resolveWorkspaceState({
      hasCommittedChanges,
      hasTrackedChanges,
      hasUntracked,
    });

    return {
      workingTree: {
        hasUncommittedChanges: hasDirtyEntries,
        state,
        insertions: workingTreeInsertions,
        deletions: workingTreeDeletions,
        lineStatsComplete: !hasUntracked || untrackedNumstatEnrichment.complete,
        fileCount: entries.length,
        files,
      },
      branch: {
        currentBranch:
          checkout.kind === "branch" || checkout.kind === "unborn"
            ? checkout.branchName
            : null,
        defaultBranch:
          defaultBranch ??
          (checkout.kind === "branch" || checkout.kind === "unborn"
            ? (checkout.branchName ?? "")
            : ""),
      },
      checkout,
      mergeBase: mergeBaseData,
    };
  }

  async getDiff(options: DiffOptions): Promise<DiffResult> {
    const { target, freshness, maxDiffBytes, maxFileListBytes } = options;
    assertPositiveInteger(options.maxUntrackedFiles, "maxUntrackedFiles");
    const range = await this.resolveTrackedDiffRange(target, freshness);
    if (range === null) {
      return {
        diff: "",
        files: "",
        shortstat: "",
        truncated: false,
        mergeBaseRef: null,
      };
    }
    const runRange = this.rangeGitRunner(range);
    const includesUntracked = this.targetIncludesUntracked(target);
    const [trackedDiff, trackedStat, trackedFiles] = await Promise.all([
      runRange(
        (rangeArgs) => [...range.baseArgs, "--binary", ...rangeArgs],
        buildDiffOutputGitOptions(this.path, maxDiffBytes),
      ),
      runRange(
        (rangeArgs) => [
          ...range.baseArgs,
          includesUntracked ? "--numstat" : "--shortstat",
          ...rangeArgs,
        ],
        { cwd: this.path },
      ),
      runRange(
        (rangeArgs) => [...range.baseArgs, "--name-status", ...rangeArgs],
        buildDiffOutputGitOptions(this.path, maxFileListBytes),
      ),
    ]);
    let diff = trackedDiff.stdout;
    let files = trackedFiles.stdout;
    let shortstat = trackedStat.stdout;
    let untrackedTruncated = false;
    if (includesUntracked) {
      const allUntracked = (await this.requireStatusSnapshot(freshness.work))
        .untrackedPaths;
      const untrackedPaths = allUntracked.slice(0, options.maxUntrackedFiles);
      untrackedTruncated = untrackedPaths.length < allUntracked.length;
      const untracked =
        untrackedPaths.length === 0
          ? null
          : await this.withRetainedUntrackedIndex(
              freshness.work,
              untrackedPaths,
              async (env) => {
                const [untrackedDiff, numstat, untrackedFiles] =
                  await Promise.all([
                    this.runGit(["diff", "--no-ext-diff", "--binary"], {
                      ...buildDiffOutputGitOptions(this.path, maxDiffBytes),
                      env,
                    }),
                    this.runGit(["diff", "--no-ext-diff", "--numstat"], {
                      cwd: this.path,
                      env,
                    }),
                    this.runGit(["diff", "--no-ext-diff", "--name-status"], {
                      ...buildDiffOutputGitOptions(this.path, maxFileListBytes),
                      env,
                    }),
                  ]);
                return {
                  diff: untrackedDiff.stdout,
                  numstat: numstat.stdout,
                  files: untrackedFiles.stdout,
                };
              },
            );
      if (untracked !== null) {
        diff = joinDiffArtifactOutput([diff, untracked.diff]);
        files = joinDiffArtifactOutput([files, untracked.files]);
      }
      shortstat = formatShortstat(
        summarizeNumstat(
          untracked === null
            ? trackedStat.stdout
            : joinDiffArtifactLines([trackedStat.stdout, untracked.numstat]),
        ),
      );
    }
    const diffOutput = truncateOutputToMaxBytes(diff, maxDiffBytes);
    const fileOutput = truncateOutputToMaxBytes(files, maxFileListBytes);
    return {
      diff: diffOutput.value,
      files: fileOutput.value,
      shortstat,
      truncated:
        untrackedTruncated || diffOutput.truncated || fileOutput.truncated,
      mergeBaseRef: range.mergeBaseRef,
    };
  }

  private rangeGitRunner(range: ResolvedTrackedDiffRange) {
    const runUncommittedDiff = createUncommittedDiffRunner(
      this.path,
      (gitArgs, options) => this.runGit(gitArgs, options),
    );
    return (
      buildArgs: (rangeArgs: string[]) => string[],
      options: RunGitOptions,
    ): Promise<GitCommandResult> =>
      range.usesUncommittedHead
        ? runUncommittedDiff((baseRef) => buildArgs([baseRef]), options)
        : this.runGit(buildArgs(range.rangeArgs), options);
  }

  async diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    assertPositiveInteger(args.maxFiles, "maxFiles");

    const stats = await this.readBoundedDiffStatArtifacts(
      args.target,
      args.maxFiles,
      args.ignoreWhitespace,
      args.freshness,
    );
    const numstatByPath = new Map(
      parseNumstatEntriesZ(stats.numstat).map(
        (entry) => [entry.path, entry] as const,
      ),
    );
    const untrackedStats = await this.readUntrackedStats(
      args.freshness.work,
      stats.untrackedPaths,
    );
    const unhashedUntracked = [...untrackedStats.values()].flatMap((stat) =>
      stat.raw !== undefined && stat.blob === undefined ? [stat.raw] : [],
    );
    const worktreeBlobs = await this.hashWorktreeBlobs([
      ...stats.trackedEntries,
      ...unhashedUntracked,
    ]);
    for (const stat of untrackedStats.values()) {
      if (stat.raw === undefined) continue;
      if (stat.blob === undefined) {
        stat.blob = worktreeBlobs.get(stat.raw.path) ?? null;
      } else if (stat.blob !== null) {
        worktreeBlobs.set(stat.raw.path, stat.blob);
      }
    }
    const trackedFiles: RawDiffFileStat[] = stats.trackedEntries.map(
      (entry) => {
        const numstat = numstatByPath.get(entry.path);
        const binary =
          numstat !== undefined &&
          numstat.insertions === null &&
          numstat.deletions === null;
        return {
          path: entry.path,
          previousPath: entry.previousPath,
          statusLetter: normalizeNameStatusLetter(entry.status),
          additions: binary ? 0 : (numstat?.insertions ?? 0),
          deletions: binary ? 0 : (numstat?.deletions ?? 0),
          binary,
          origin: "tracked",
          revision: formatDiffRevision(entry, worktreeBlobs),
        };
      },
    );
    const untrackedFiles = stats.untrackedPaths.map((relativePath) => {
      const stat = untrackedStats.get(relativePath);
      const binary =
        stat?.numstat !== undefined &&
        stat.numstat.insertions === null &&
        stat.numstat.deletions === null;
      return {
        ...toUntrackedDiffFilePlaceholder(relativePath),
        additions: binary ? 0 : (stat?.numstat?.insertions ?? 0),
        deletions: binary ? 0 : (stat?.numstat?.deletions ?? 0),
        binary,
        revision:
          stat?.raw === undefined
            ? MISSING_DIFF_REVISION
            : formatDiffRevision(stat.raw, worktreeBlobs),
      };
    });
    const files = [...trackedFiles, ...untrackedFiles];
    const summary = files.reduce(
      (result, file) => ({
        changedFiles: result.changedFiles + 1,
        insertions: result.insertions + file.additions,
        deletions: result.deletions + file.deletions,
      }),
      { changedFiles: 0, insertions: 0, deletions: 0 },
    );

    return {
      files,
      shortstat: formatShortstat(summary),
      mergeBaseRef: stats.mergeBaseRef,
      truncated: stats.truncated,
    };
  }

  async diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    const requested = new Set(args.paths);
    const untrackedForTarget = this.targetIncludesUntracked(args.target)
      ? new Set(
          (
            await this.requireStatusSnapshot(args.freshness.work)
          ).untrackedPaths.filter((relativePath) => requested.has(relativePath)),
        )
      : new Set<string>();

    const untrackedPaths = args.paths.filter((p) => untrackedForTarget.has(p));
    const trackedPaths = args.paths.filter((p) => !untrackedForTarget.has(p));

    const trackedPatchByPath =
      trackedPaths.length > 0
        ? await this.readTrackedPatchByPathCombined({
            freshness: args.freshness,
            target: args.target,
            paths: trackedPaths,
            maxBytesPerFile: args.maxBytesPerFile,
            ignoreWhitespace: args.ignoreWhitespace,
          })
        : new Map<string, string>();

    const untrackedPatchByPath = await this.readUntrackedPatchByPathCombined({
      work: args.freshness.work,
      paths: untrackedPaths,
      maxBytesPerFile: args.maxBytesPerFile,
      ignoreWhitespace: args.ignoreWhitespace,
    });

    const seen = new Set<string>();
    const entries: DiffPatchEntry[] = [];
    for (const path of args.paths) {
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      const rawPatch =
        trackedPatchByPath.get(path) ?? untrackedPatchByPath.get(path) ?? "";
      const { patch, truncated } = truncatePatchToMaxBytes(
        rawPatch,
        args.maxBytesPerFile,
      );
      entries.push({ path, patch, truncated });
    }
    return entries;
  }


  private async readMergeBaseStatus(
    mergeBaseBranch: string,
    maxFiles: number | undefined,
    refs: string,
    headSha: string | null,
    timeoutMs?: number,
  ): Promise<WorkspaceStatus["mergeBase"]> {
    const baseSha =
      headSha === null
        ? null
        : await this.resolveCommit(refs, mergeBaseBranch, timeoutMs);
    if (headSha === null || baseSha === null) {
      return (
        await this.computeMergeBaseStatus(
          mergeBaseBranch,
          "HEAD",
          mergeBaseBranch,
          maxFiles,
          timeoutMs,
        )
      ).status;
    }
    const key = JSON.stringify([
      this.path,
      headSha,
      baseSha,
      mergeBaseBranch,
      maxFiles,
    ]);
    const cached = mergeBaseStatusCache.get(key);
    if (cached) return structuredClone(cached);
    let pending = pendingMergeBaseStatuses.get(key);
    if (!pending) {
      const computation = this.computeMergeBaseStatus(
        baseSha,
        headSha,
        mergeBaseBranch,
        maxFiles,
        timeoutMs,
      );
      pending = computation;
      pendingMergeBaseStatuses.set(key, computation);
      computation
        .then(({ status, retryable }) => {
          if (status && !retryable) {
            mergeBaseStatusCache.set(
              key,
              status,
              JSON.stringify(status).length,
            );
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (pendingMergeBaseStatuses.get(key) === computation) {
            pendingMergeBaseStatuses.delete(key);
          }
        });
    }
    return structuredClone((await pending).status);
  }

  private async computeMergeBaseStatus(
    baseRevision: string,
    headRevision: string,
    mergeBaseBranch: string,
    maxFiles: number | undefined,
    timeoutMs?: number,
  ): Promise<MergeBaseStatusComputation> {
    const [mergeBaseRef, history, nameStatus, numstat] = await Promise.all([
      this.runGit(["merge-base", baseRevision, headRevision], {
        cwd: this.path,
        timeoutMs,
        allowFailure: true,
      }).then((result) =>
        result.exitCode === 0 ? result.stdout.trim() : undefined,
      ),
      this.runGit(
        [
          "log",
          "--left-right",
          "--format=%m%x1f%H%x1f%h%x1f%s%x1f%an%x1f%at",
          `${baseRevision}...${headRevision}`,
        ],
        { cwd: this.path, allowFailure: true, timeoutMs },
      ),
      this.runGit(
        [
          "diff",
          "--no-ext-diff",
          "--name-status",
          "-z",
          `${baseRevision}...${headRevision}`,
        ],
        { cwd: this.path, allowFailure: true, timeoutMs },
      ),
      this.runGit(
        [
          "diff",
          "--no-ext-diff",
          "--numstat",
          "-z",
          `${baseRevision}...${headRevision}`,
        ],
        { cwd: this.path, allowFailure: true, timeoutMs },
      ),
    ]);
    if (history.exitCode !== 0) {
      if (isMissingHeadRevisionError(history.stderr)) {
        return {
          retryable: false,
          status: {
            mergeBaseBranch,
            baseRef: null,
            aheadCount: 0,
            behindCount: 0,
            squashMergeCheckComplete: true,
            hasCommittedUnmergedChanges: false,
            commits: [],
            fileCount: 0,
            files: [],
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
          },
        };
      }
      const detail = history.stderr.trim();
      throw new WorkspaceError(
        "git_command_failed",
        `git log ${baseRevision}...${headRevision} failed${detail ? `: ${detail}` : ""}`,
      );
    }
    const behindCommits: string[] = [];
    const aheadCommits: WorkspaceCommitSummary[] = [];
    for (const line of history.stdout.split("\n")) {
      const [mark, sha, shortSha, subject, authorName, authoredAt] =
        line.split("\u001f");
      if (mark === "<") behindCommits.push(sha);
      if (mark !== ">") continue;
      aheadCommits.push({
        sha,
        shortSha,
        subject,
        authorName: authorName ?? "",
        authoredAt: Number.parseInt(authoredAt ?? "0", 10) * 1000,
      });
    }
    const runHistoryGit: CommitGitRunner = (args, options) =>
      this.runGit(args, {
        cwd: this.path,
        allowFailure: true,
        timeoutMs,
        ...options,
      });
    const equivalent = await readPatchEquivalentCommits(
      runHistoryGit,
      behindCommits,
      aheadCommits.map((commit) => commit.sha),
    );
    if (!equivalent) {
      throw new WorkspaceError(
        "git_command_failed",
        `Could not compare commits in ${baseRevision}...${headRevision}`,
      );
    }
    const uniqueBehindCommits = behindCommits.filter(
      (sha) => !equivalent.has(sha),
    );
    const commits = aheadCommits
      .filter((commit) => !equivalent.has(commit.sha))
      .reverse();
    const normalizedBehindCount = uniqueBehindCommits.length;
    let normalizedAheadCount = commits.length;
    let effectiveCommits = commits;
    const numstatEntries =
      numstat.exitCode === 0 ? parseNumstatEntriesZ(numstat.stdout) : [];
    const numstatByPath = new Map(
      numstatEntries.map((entry) => [entry.path, entry] as const),
    );
    let effectiveFiles: WorkspaceFileStatus[] =
      nameStatus.exitCode === 0
        ? parseNameStatusEntries(nameStatus.stdout).map((entry) => {
            const numstat = numstatByPath.get(entry.path);
            return {
              path: entry.path,
              status: mapNameStatusLetter(entry.status),
              insertions: numstat?.insertions ?? null,
              deletions: numstat?.deletions ?? null,
            };
          })
        : [];
    let effectiveInsertions = 0;
    let effectiveDeletions = 0;
    let effectiveLineStatsComplete = numstat.exitCode === 0;
    for (const entry of numstatEntries) {
      if (entry.insertions !== null) effectiveInsertions += entry.insertions;
      if (entry.deletions !== null) effectiveDeletions += entry.deletions;
    }

    let squashMergeCheckComplete = true;
    let retryable = nameStatus.exitCode !== 0 || numstat.exitCode !== 0;
    if (normalizedAheadCount > 0 && normalizedBehindCount > 0 && mergeBaseRef) {
      const { merged, timedOut } = await this.detectSquashMerge(
        mergeBaseRef,
        headRevision,
        behindCommits,
        timeoutMs,
      );
      squashMergeCheckComplete = merged !== null;
      retryable ||= timedOut;
      if (merged) {
        normalizedAheadCount = 0;
        effectiveCommits = [];
      }
    }

    if (effectiveCommits.length === 0) {
      effectiveFiles = [];
      effectiveInsertions = 0;
      effectiveDeletions = 0;
      effectiveLineStatsComplete = true;
    }

    return {
      retryable,
      status: {
        mergeBaseBranch,
        baseRef: mergeBaseRef ?? null,
        aheadCount: normalizedAheadCount,
        behindCount: normalizedBehindCount,
        squashMergeCheckComplete,
        hasCommittedUnmergedChanges: normalizedAheadCount > 0,
        commits: effectiveCommits,
        fileCount: effectiveFiles.length,
        files:
          maxFiles === undefined
            ? effectiveFiles
            : effectiveFiles.slice(0, maxFiles),
        insertions: effectiveInsertions,
        deletions: effectiveDeletions,
        lineStatsComplete: effectiveLineStatsComplete,
      },
    };
  }

  private async detectSquashMerge(
    mergeBaseRef: string,
    headRevision: string,
    behindCommits: string[],
    timeoutMs?: number,
  ): Promise<SquashMergeCheck> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(timeoutMs ?? SQUASH_MERGE_TIMEOUT_MS, SQUASH_MERGE_TIMEOUT_MS),
    );
    try {
      const merged = await this.computeSquashMerge(
        mergeBaseRef,
        headRevision,
        behindCommits,
        controller.signal,
      );
      return controller.signal.aborted
        ? { merged: null, timedOut: true }
        : { merged, timedOut: false };
    } catch (error) {
      if (controller.signal.aborted) return { merged: null, timedOut: true };
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async computeSquashMerge(
    mergeBaseRef: string,
    headRevision: string,
    behindCommits: string[],
    signal: AbortSignal,
  ): Promise<boolean | null> {
    const run: CommitGitRunner = (args, options) =>
      this.runGit(args, {
        cwd: this.path,
        signal,
        allowFailure: true,
        ...options,
      });
    const branch = await run([
      "diff",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      "--no-ext-diff",
      "--no-textconv",
      mergeBaseRef,
      headRevision,
    ]);
    if (branch.exitCode !== 0) return null;
    const branchEntries = parseRawDiffEntriesZ(branch.stdout);
    if (branchEntries.length === 0) return true;
    const scanned = behindCommits.slice(0, SQUASH_MERGE_MAX_METADATA_COMMITS);
    const complete = behindCommits.length <= SQUASH_MERGE_MAX_METADATA_COMMITS;
    const changes = await readCommitChanges(run, scanned);
    if (!changes) return null;
    const branchSignature = squashChangeSignature(branchEntries);
    const requiredPaths = branchEntries
      .filter((entry) => !/[^!-~]|["\\]/u.test(entry.path))
      .map((entry) => entry.path);
    const candidates: string[] = [];
    for (const commit of scanned) {
      const entries = changes.get(commit) ?? [];
      if (entries.length === 0) continue;
      const paths = new Set(
        entries.map((entry) => entry.path.replace(/\s/gu, "")),
      );
      if (!requiredPaths.every((path) => paths.has(path))) continue;
      if (squashChangeSignature(entries) === branchSignature) return true;
      candidates.push(commit);
    }
    if (candidates.length === 0) return complete ? false : null;
    let remainingPatchBytes = SQUASH_MERGE_MAX_PATCH_BYTES;
    const branchPatch = await readSquashRangePatchId(
      run,
      mergeBaseRef,
      headRevision,
      remainingPatchBytes,
    );
    if (!branchPatch?.patchId) return null;
    remainingPatchBytes -= branchPatch.patchBytes;
    for (const candidate of candidates) {
      const hashed = await readCommitPatchIds(
        run,
        "squash",
        [candidate],
        remainingPatchBytes,
      );
      const patchId = hashed?.patchIds.get(candidate);
      if (!hashed || !patchId) return null;
      remainingPatchBytes -= hashed.patchBytes;
      if (patchId === branchPatch.patchId) return true;
    }
    return complete ? false : null;
  }

  private targetIncludesUntracked(target: WorkspaceDiffTarget): boolean {
    return target.type === "uncommitted" || target.type === "all";
  }

  private async readBoundedUntrackedStatusNumstat(args: {
    work: string;
    paths: string[];
    maxFiles: number;
    maxBytes: number;
  }): Promise<UntrackedStatusNumstatEnrichment> {
    if (args.paths.length === 0) {
      return { entries: [], complete: true };
    }
    if (args.paths.length > args.maxFiles) {
      return { entries: [], complete: false };
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<UntrackedStatusNumstatEnrichment>(
      (resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve({ entries: [], complete: false });
        }, WORKSPACE_STATUS_UNTRACKED_ENRICHMENT_TIMEOUT_MS);
      },
    );
    try {
      return await Promise.race([
        this.readUntrackedStatusNumstatWithinBudget(args, controller.signal),
        deadline,
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async readUntrackedStatusNumstatWithinBudget(
    args: { work: string; paths: string[]; maxBytes: number },
    signal: AbortSignal,
  ): Promise<UntrackedStatusNumstatEnrichment> {
    try {
      const candidates = await Promise.all(
        args.paths.map(async (relativePath) => {
          try {
            const stats = await fs.lstat(path.join(this.path, relativePath));
            return stats.isFile() || stats.isSymbolicLink()
              ? { path: relativePath, size: stats.size }
              : null;
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return null;
            }
            throw error;
          }
        }),
      );
      const eligible = candidates.filter(
        (candidate): candidate is { path: string; size: number } =>
          candidate !== null,
      );
      let totalBytes = 0;
      for (const candidate of eligible) {
        totalBytes += candidate.size;
        if (totalBytes > args.maxBytes) {
          return { entries: [], complete: false };
        }
      }
      if (eligible.length === 0) {
        return { entries: [], complete: false };
      }

      if (signal.aborted) return { entries: [], complete: false };
      const stats = await this.readUntrackedStats(
        args.work,
        eligible.map((candidate) => candidate.path),
        { timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS },
      );
      const entries = eligible.flatMap((candidate) => {
        const numstat = stats.get(candidate.path)?.numstat;
        return numstat === undefined ? [] : [numstat];
      });
      return {
        entries,
        complete:
          eligible.length === args.paths.length &&
          entries.length === eligible.length,
      };
    } catch {
      return { entries: [], complete: false };
    }
  }

  private async readBoundedDiffStatArtifacts(
    target: WorkspaceDiffTarget,
    maxFiles: number,
    ignoreWhitespace: boolean,
    freshness: ReadFreshness,
  ): Promise<BoundedDiffStatArtifacts> {
    const range = await this.resolveTrackedDiffRange(target, freshness);
    if (range === null) {
      return {
        trackedEntries: [],
        numstat: "",
        mergeBaseRef: null,
        untrackedPaths: [],
        truncated: false,
      };
    }

    const overflowCount = maxFiles + 1;
    const readNumstat = async () =>
      (
        await this.runTrackedDiffWithLimit({
          range,
          outputArgs: [
            "--numstat",
            "-M",
            "-z",
            ...whitespaceDiffArgs(ignoreWhitespace),
          ],
          recordFormat: "numstat",
          maxRecords: overflowCount,
        })
      ).stdout;
    const [combined, whitespaceNumstat] = await Promise.all([
      this.runTrackedDiffWithLimit({
        range,
        outputArgs: ignoreWhitespace
          ? ["--raw", "--no-abbrev", "-M", "-z"]
          : ["--raw", "--numstat", "--no-abbrev", "-M", "-z"],
        recordFormat: ignoreWhitespace ? "raw" : "raw-numstat",
        maxRecords: overflowCount,
      }),
      ignoreWhitespace ? readNumstat() : null,
    ]);
    const split = splitRawNumstatZ(combined.stdout);
    const numstat =
      whitespaceNumstat ??
      (combined.recordLimitReached ? await readNumstat() : split.numstat);
    const enumeratedTrackedEntries = parseRawDiffEntriesZ(split.raw);
    remember(
      this.trackedEntriesByDiff,
      JSON.stringify([freshness.work, target]),
      Promise.resolve(enumeratedTrackedEntries),
      TRACKED_ENTRIES_LIMIT,
    );
    const trackedTruncated =
      combined.recordLimitReached ||
      enumeratedTrackedEntries.length > maxFiles;
    const trackedEntries = enumeratedTrackedEntries.slice(0, maxFiles);

    const remainingFileSlots = maxFiles - trackedEntries.length;
    const enumeratedUntrackedPaths =
      !trackedTruncated && this.targetIncludesUntracked(target)
        ? (
            await this.requireStatusSnapshot(freshness.work)
          ).untrackedPaths.slice(0, remainingFileSlots + 1)
        : [];
    const untrackedTruncated =
      enumeratedUntrackedPaths.length > remainingFileSlots;
    const untrackedPaths = enumeratedUntrackedPaths.slice(
      0,
      remainingFileSlots,
    );
    return {
      trackedEntries,
      numstat,
      mergeBaseRef: range.mergeBaseRef,
      untrackedPaths,
      truncated: trackedTruncated || untrackedTruncated,
    };
  }

  private async runTrackedDiffWithLimit(args: {
    range: ResolvedTrackedDiffRange;
    outputArgs: string[];
    recordFormat: GitNullRecordFormat;
    maxRecords: number;
  }): Promise<GitNullRecordLimitResult> {
    const buildArgs = (rangeArgs: string[]): string[] => [
      ...args.range.baseArgs,
      ...args.outputArgs,
      ...rangeArgs,
    ];
    if (!args.range.usesUncommittedHead) {
      return this.runGitWithNullRecordLimit(
        buildArgs(args.range.rangeArgs),
        { cwd: this.path },
        args.recordFormat,
        args.maxRecords,
      );
    }

    const headArgs = buildArgs(["HEAD"]);
    const headResult = await this.runGitWithNullRecordLimit(
      headArgs,
      { cwd: this.path, allowFailure: true },
      args.recordFormat,
      args.maxRecords,
    );
    if (headResult.exitCode === 0) {
      return headResult;
    }
    if (!isMissingHeadRevisionError(headResult.stderr)) {
      const detail = headResult.stderr.trim();
      throw new WorkspaceError(
        "git_command_failed",
        `git ${headArgs.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      );
    }

    const emptyTreeSha = await readEmptyTreeSha(
      this.path,
      (gitArgs, options) => this.runGit(gitArgs, options),
    );
    return this.runGitWithNullRecordLimit(
      buildArgs([emptyTreeSha]),
      { cwd: this.path },
      args.recordFormat,
      args.maxRecords,
    );
  }

  private async hashWorktreeBlobs(
    entries: readonly RawDiffEntry[],
  ): Promise<Map<string, string>> {
    const pending = entries.filter(
      (entry) =>
        ZERO_BLOB_PATTERN.test(entry.newBlob) &&
        entry.newMode !== "000000" &&
        entry.newMode !== "160000",
    );
    const blobs = new Map<string, string>();
    const batchPaths = pending
      .filter(
        (entry) => entry.newMode !== "120000" && !entry.path.includes("\n"),
      )
      .map((entry) => entry.path);
    if (batchPaths.length > 0) {
      const batch = await this.runGit(["hash-object", "--stdin-paths"], {
        cwd: this.path,
        input: `${batchPaths.join("\n")}\n`,
        allowFailure: true,
      });
      const hashes = batch.stdout.split("\n").filter((line) => line !== "");
      if (batch.exitCode === 0 && hashes.length === batchPaths.length) {
        batchPaths.forEach((relativePath, index) =>
          blobs.set(relativePath, hashes[index]),
        );
      }
    }
    for (const entry of pending) {
      if (blobs.has(entry.path)) {
        continue;
      }
      const blob = await this.hashWorktreeBlob(entry);
      if (blob !== null) {
        blobs.set(entry.path, blob);
      }
    }
    return blobs;
  }

  private async hashWorktreeBlob(entry: RawDiffEntry): Promise<string | null> {
    if (entry.newMode === "120000") {
      const linkTarget = await fs
        .readlink(path.join(this.path, entry.path))
        .catch(() => null);
      if (linkTarget === null) {
        return null;
      }
      const result = await this.runGit(["hash-object", "--stdin"], {
        cwd: this.path,
        input: linkTarget,
        allowFailure: true,
      });
      return result.exitCode === 0 ? result.stdout.trim() : null;
    }
    const result = await this.runGit(["hash-object", "--", entry.path], {
      cwd: this.path,
      allowFailure: true,
    });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  private async readUntrackedPatchByPathCombined(args: {
    work: string;
    paths: string[];
    maxBytesPerFile: number;
    ignoreWhitespace: boolean;
  }): Promise<Map<string, string>> {
    if (args.paths.length === 0) {
      return new Map();
    }
    const whitespaceArgs = whitespaceDiffArgs(args.ignoreWhitespace);
    const readPatches = async (
      env: NodeJS.ProcessEnv,
      indexedPaths: readonly string[],
    ): Promise<Map<string, string>> => {
      const pathspec = indexedPaths.map(
        (relativePath) => `:(literal)${relativePath}`,
      );
      if (indexedPaths.length === 0) return new Map();
      const [onlyPath] = indexedPaths;
      if (indexedPaths.length === 1 && onlyPath !== undefined) {
        const result = await this.runGit(
          ["diff", "--no-ext-diff", "--binary", ...whitespaceArgs, "--", ...pathspec],
          {
            ...buildDiffOutputGitOptions(this.path, args.maxBytesPerFile),
            env,
          },
        );
        return new Map([[onlyPath, result.stdout]]);
      }
      const [numstat, patch] = await Promise.all([
        this.runGit(
          [
            "diff",
            "--no-ext-diff",
            "--numstat",
            "-z",
            ...whitespaceArgs,
            "--",
            ...pathspec,
          ],
          { cwd: this.path, env },
        ),
        this.runGit(
          ["diff", "--no-ext-diff", "--binary", ...whitespaceArgs, "--", ...pathspec],
          {
            ...buildDiffOutputGitOptions(
              this.path,
              combinedPageBufferBudget(indexedPaths.length, args.maxBytesPerFile),
            ),
            env,
          },
        ),
      ]);
      const entries = parseNumstatEntriesZ(numstat.stdout);
      const sections = splitPatchIntoSections(patch.stdout);
      if (entries.length === sections.length) {
        return new Map(
          entries.map((entry, index) => [entry.path, sections[index]] as const),
        );
      }

      const patchByPath = new Map<string, string>();
      for (const relativePath of indexedPaths) {
        const result = await this.runGit(
          [
            "diff",
            "--no-ext-diff",
            "--binary",
            ...whitespaceArgs,
            "--",
            `:(literal)${relativePath}`,
          ],
          {
            ...buildDiffOutputGitOptions(this.path, args.maxBytesPerFile),
            env,
          },
        );
        patchByPath.set(relativePath, result.stdout);
      }
      return patchByPath;
    };
    const retained = await this.readFromRetainedUntrackedIndex(
      args.work,
      args.paths,
      readPatches,
    );
    return retained !== null
      ? retained.value
      : this.withTemporaryUntrackedIndex(args.paths, readPatches);
  }

  private async readTrackedPatchByPathCombined(
    args: ReadTrackedPatchByPathArgs,
  ): Promise<Map<string, string>> {
    const range = await this.resolveTrackedDiffRange(
      args.target,
      args.freshness,
    );
    if (range === null) {
      return new Map();
    }

    const runUncommittedDiff = createUncommittedDiffRunner(
      this.path,
      (gitArgs, options) => this.runGit(gitArgs, options),
    );
    const runRangeGit = (
      buildArgs: (rangeArgs: string[]) => string[],
      options: RunGitOptions,
    ): Promise<GitCommandResult> =>
      range.usesUncommittedHead
        ? runUncommittedDiff((baseRef) => buildArgs([baseRef]), options)
        : this.runGit(buildArgs(range.rangeArgs), options);
    const whitespaceArgs = whitespaceDiffArgs(args.ignoreWhitespace);

    const requested = new Set(args.paths);
    const knownEntries = await this.trackedEntriesByDiff
      .get(JSON.stringify([args.freshness.work, args.target]))
      ?.catch(() => null);
    const knownPaths = new Set(knownEntries?.map((entry) => entry.path));
    const renameSourceEntries =
      knownEntries !== undefined &&
      knownEntries !== null &&
      args.paths.every((relativePath) => knownPaths.has(relativePath))
        ? knownEntries
        : parseNameStatusSourceEntries(
            (
              await runRangeGit(
                (rangeArgs) => [
                  ...range.baseArgs,
                  "--name-status",
                  "-z",
                  "-M",
                  ...rangeArgs,
                ],
                { cwd: this.path },
              )
            ).stdout,
          );
    const previousPathByPath = new Map(
      renameSourceEntries
        .filter((entry) => requested.has(entry.path))
        .map((entry) => [entry.path, entry.previousPath] as const),
    );
    const renameSources = [...previousPathByPath.values()].filter(
      (previousPath): previousPath is string =>
        previousPath !== null && !requested.has(previousPath),
    );
    const pagePathspec = [...new Set([...args.paths, ...renameSources])];
    const [onlyPath] = pagePathspec;
    if (pagePathspec.length === 1 && onlyPath !== undefined) {
      const patch = await runRangeGit(
        (rangeArgs) =>
          withDiffPathspec(
            [
              ...range.baseArgs,
              "--binary",
              "-M",
              ...whitespaceArgs,
              ...rangeArgs,
            ],
            pagePathspec,
          ),
        buildDiffOutputGitOptions(this.path, args.maxBytesPerFile),
      );
      return new Map([[onlyPath, patch.stdout]]);
    }

    const [numstat, patch] = await Promise.all([
      runRangeGit(
        (rangeArgs) =>
          withDiffPathspec(
            [
              ...range.baseArgs,
              "--numstat",
              "-z",
              "-M",
              ...whitespaceArgs,
              ...rangeArgs,
            ],
            pagePathspec,
          ),
        { cwd: this.path },
      ),
      runRangeGit(
        (rangeArgs) =>
          withDiffPathspec(
            [
              ...range.baseArgs,
              "--binary",
              "-M",
              ...whitespaceArgs,
              ...rangeArgs,
            ],
            pagePathspec,
          ),
        buildDiffOutputGitOptions(
          this.path,
          combinedPageBufferBudget(pagePathspec.length, args.maxBytesPerFile),
        ),
      ),
    ]);

    const entries = parseNumstatEntriesZ(numstat.stdout);
    const sections = splitPatchIntoSections(patch.stdout);
    if (sections.length === entries.length) {
      return new Map(
        entries.map((entry, index) => [entry.path, sections[index]] as const),
      );
    }

    const patchEntries = await Promise.all(
      args.paths.map(async (relativePath) => {
        const previousPath = previousPathByPath.get(relativePath);
        const pathspec =
          previousPath != null && previousPath !== relativePath
            ? [previousPath, relativePath]
            : [relativePath];
        const result = await runRangeGit(
          (rangeArgs) =>
            withDiffPathspec(
              [
                ...range.baseArgs,
                "--binary",
                "-M",
                ...whitespaceArgs,
                ...rangeArgs,
              ],
              pathspec,
            ),
          buildDiffOutputGitOptions(this.path, args.maxBytesPerFile),
        );
        return [relativePath, result.stdout] as const;
      }),
    );
    return new Map(patchEntries);
  }

  private async resolveTrackedDiffRange(
    target: WorkspaceDiffTarget,
    freshness: ReadFreshness,
  ): Promise<ResolvedTrackedDiffRange | null> {
    const diffBase = ["diff", "--no-ext-diff"];
    switch (target.type) {
      case "uncommitted":
        return {
          baseArgs: diffBase,
          rangeArgs: ["HEAD"],
          usesUncommittedHead: true,
          mergeBaseRef: null,
        };
      case "branch_committed":
      case "all": {
        const mergeBaseRef = await this.resolveMergeBaseRef(
          freshness,
          target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return null;
        }
        const rangeArgs =
          target.type === "branch_committed"
            ? [`${mergeBaseRef}..HEAD`]
            : [mergeBaseRef];
        return {
          baseArgs: diffBase,
          rangeArgs,
          usesUncommittedHead: false,
          mergeBaseRef,
        };
      }
      case "commit":
        return {
          baseArgs: ["show", "--format=", "--no-ext-diff"],
          rangeArgs: [target.sha],
          usesUncommittedHead: false,
          mergeBaseRef: null,
        };
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  }







  private async withTemporaryUntrackedIndex<T>(
    relativePaths: readonly string[],
    work: (
      env: NodeJS.ProcessEnv,
      indexedPaths: readonly string[],
    ) => Promise<T>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
    retain?: (
      dir: string,
      env: NodeJS.ProcessEnv,
      indexedPaths: readonly string[],
    ) => boolean,
  ): Promise<T> {
    const tempDir = await this.createTempDir("bb-untracked-index-");
    const indexPath = path.join(tempDir, "index");
    const pathspecPath = path.join(tempDir, "pathspec");
    const env = { ...UNSPLIT_INDEX_ENV, GIT_INDEX_FILE: indexPath };
    let retained = false;
    try {
      let candidates = [...relativePaths];
      for (
        let attempt = 0;
        attempt < TEMPORARY_UNTRACKED_INDEX_ADD_ATTEMPTS;
        attempt += 1
      ) {
        candidates = await this.filterExistingUntrackedPaths(candidates);
        await fs.rm(indexPath, { force: true });
        if (candidates.length === 0) {
          return await work(env, []);
        }
        await fs.writeFile(
          pathspecPath,
          candidates.map((value) => `:(literal)${value}\0`).join(""),
        );
        const add = await this.runGit(
          [
            "add",
            "--sparse",
            "--intent-to-add",
            `--pathspec-from-file=${pathspecPath}`,
            "--pathspec-file-nul",
          ],
          {
            cwd: this.path,
            env,
            allowFailure: true,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          },
        );
        if (add.exitCode === 0) {
          const value = await work(env, candidates);
          retained = retain?.(tempDir, env, candidates) ?? false;
          return value;
        }
        const refreshedCandidates =
          await this.filterExistingUntrackedPaths(candidates);
        if (refreshedCandidates.length === candidates.length) {
          const detail = add.stderr.trim();
          throw new WorkspaceError(
            "git_command_failed",
            `git add --intent-to-add failed${detail ? `: ${detail}` : ""}`,
          );
        }
        candidates = refreshedCandidates;
      }

      await fs.rm(indexPath, { force: true });
      return await work(env, []);
    } finally {
      if (!retained) await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async filterExistingUntrackedPaths(
    relativePaths: readonly string[],
  ): Promise<string[]> {
    const existing = await Promise.all(
      relativePaths.map(async (relativePath) => {
        try {
          const stats = await fs.lstat(path.join(this.path, relativePath));
          return stats.isFile() || stats.isSymbolicLink() ? relativePath : null;
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return null;
          }
          throw error;
        }
      }),
    );
    return existing.filter((value): value is string => value !== null);
  }



}


function joinDiffArtifactLines(parts: string[]): string {
  return parts
    .map((value) => value.trimEnd())
    .filter((value) => value.length > 0)
    .join("\n");
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkspaceError(
      "invalid_request",
      `${field} must be a positive integer`,
    );
  }
}

function toUntrackedDiffFilePlaceholder(
  path: string,
): Omit<RawDiffFileStat, "revision"> {
  return {
    path,
    previousPath: null,
    statusLetter: "A",
    additions: 0,
    deletions: 0,
    binary: false,
    origin: "untracked",
  };
}

function joinDiffArtifactOutput(parts: string[]): string {
  const combined = joinDiffArtifactLines(parts);
  return combined.length > 0 ? `${combined}\n` : "";
}

const DIFF_SECTION_HEADER = "diff --git ";

function splitPatchIntoSections(combinedPatch: string): string[] {
  if (combinedPatch.length === 0) {
    return [];
  }
  const lines = combinedPatch.split("\n");
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(DIFF_SECTION_HEADER)) {
      if (current !== null) {
        sections.push(current);
      }
      current = [line];
      continue;
    }
    if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    sections.push(current);
  }
  return sections.map((sectionLines) => formatPatchSection(sectionLines));
}

function formatPatchSection(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  if (end === 0) {
    return "";
  }
  const body = lines.slice(0, end);
  const isBinary = body.some((line) => line === "GIT binary patch");
  return `${body.join("\n")}\n${isBinary ? "\n" : ""}`;
}

const NAME_STATUS_LETTERS = new Set(["A", "M", "D", "R", "C", "T"]);

function normalizeNameStatusLetter(
  status: string,
): RawDiffFileStat["statusLetter"] {
  const letter = status[0] ?? "";
  if (NAME_STATUS_LETTERS.has(letter)) {
    return letter as RawDiffFileStat["statusLetter"];
  }
  return "M";
}

function truncatePatchToMaxBytes(
  patch: string,
  maxBytes: number,
): { patch: string; truncated: boolean } {
  if (maxBytes <= 0) {
    return { patch, truncated: false };
  }
  if (Buffer.byteLength(patch, "utf8") <= maxBytes) {
    return { patch, truncated: false };
  }
  return { patch: truncateToMaxBytes(patch, maxBytes), truncated: true };
}
