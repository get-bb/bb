import type {
  GitHostPullRequest,
  RawDiffFileStat,
  ThreadGitDiffResponse,
  WorkspaceCommitSummary,
  WorkspaceDiffTarget,
  WorkspaceFileStatus,
  WorkspaceFileStatusKind,
  WorkspaceStatus,
} from "@bb/domain";
import path from "node:path";
import {
  getPullRequestForBranch,
  runPullRequestActionForBranch,
  type GitHostPullRequestAction,
} from "./git-host.js";
import {
  createTempDir,
  detectGitRepo,
  ensureGitRepo,
  getCheckoutRef,
  getCurrentBranch,
  hasRef,
  hasUncommittedChanges,
  listBranches,
  parseNameStatusEntries,
  parseNameStatusSourceEntries,
  parseNumstatCount,
  parseNumstatEntriesZ,
  parsePorcelainEntries,
  pathExists,
  readDefaultBranch,
  readMergeBaseRef,
  parsePatchId,
  revParse,
  runGit,
  type NumstatEntry,
  type RunGitOptions,
  runShellPipeline,
  summarizeNumstat,
  WorkspaceError,
} from "./git.js";
import fs from "node:fs/promises";
import {
  withCheckoutMutationLock,
  withCheckoutMutationLocks,
} from "./checkout-mutation-lock.js";
import { runGitWithWorktreeMetadataLock } from "./worktree-metadata-lock.js";

export interface DiffOptions {
  target?: WorkspaceDiffTarget;
  maxDiffBytes?: number;
  maxFileListBytes?: number;
}

export interface StatusOptions {
  mergeBaseBranch?: string;
}

export type DiffResult = ThreadGitDiffResponse;

export interface CommitOptions {
  message: string;
  noVerify: boolean;
}

export interface CommitResult {
  commitSha: string;
  commitSubject: string;
}

export interface FetchOptions {
  remote?: string;
  branch?: string;
}

export interface SquashMergeOptions {
  targetBranch: string;
  commitMessage: string;
}

export interface SquashMergeResult {
  merged: boolean;
  commitSha: string;
  commitSubject: string;
  targetBranch: string;
}

export type PullRequestActionOptions = GitHostPullRequestAction;

type DiffSummary = {
  diff: string;
  files: string;
  shortstat: string;
  truncated: boolean;
  mergeBaseRef: string | null;
};

export interface DiffFilesArgs {
  target: WorkspaceDiffTarget;
}

export interface DiffFilesResult {
  files: RawDiffFileStat[];
  shortstat: string;
  mergeBaseRef: string | null;
}

export interface DiffPatchArgs {
  target: WorkspaceDiffTarget;
  paths: string[];
  /** Per-file patch byte budget; a longer patch is truncated to this size. */
  maxBytesPerFile: number;
}

export interface DiffPatchEntry {
  path: string;
  patch: string;
  truncated: boolean;
}

type DiffArtifactsResult = {
  artifacts: [string, string, string];
  mergeBaseRef: string | null;
};

type DiffArtifacts = {
  diff: string;
  files: string;
  numstat: string;
};

type DiffOutputLimits = {
  maxDiffBytes?: number;
  maxFileListBytes?: number;
};

/**
 * Optional subset of repo-relative paths to scope a diff to. `undefined` means
 * "all changed paths" — the full-diff behavior. When present, the git
 * invocations are scoped to exactly these paths (a trailing `-- <paths>`
 * pathspec) and untracked handling only considers the requested untracked
 * subset. For renamed entries the caller must include BOTH the old and new path
 * so git's `-M` rename detection still pairs them in a scoped diff.
 */
type DiffPathSubset = {
  paths?: string[];
};

type ReadWorkspaceDiffArtifactsArgs = DiffOutputLimits &
  DiffPathSubset & {
    target: WorkspaceDiffTarget;
  };

type AppendUntrackedDiffArtifactsArgs = DiffArtifacts &
  DiffOutputLimits &
  DiffPathSubset;

type ReadUntrackedDiffArtifactsArgs = DiffOutputLimits & {
  relativePaths: string[];
};

type ReadUntrackedDiffArtifactArgs = DiffOutputLimits & {
  relativePath: string;
};

type ReadUntrackedNumstatEntriesArgs = {
  workspacePath: string;
  relativePaths: readonly string[];
  timeoutMs?: number;
};

type TruncatedOutput = {
  value: string;
  truncated: boolean;
};

type WorktreeEntry = {
  path: string;
  branchRef: string | null;
};

type SquashMergeTarget = {
  kind: "local";
  baseRef: string;
  expectedSha: string;
};

type PublishSquashMergeCommitArgs = {
  targetBranch: string;
  target: SquashMergeTarget;
  commitSha: string;
};

type ReadDiffArtifactsArgs = {
  diffArgs: string[];
  filesArgs: string[];
  numstatArgs: string[];
} & DiffOutputLimits &
  DiffPathSubset;

type DiffStatArtifacts = {
  nameStatus: string;
  numstat: string;
  shortstat: string;
  mergeBaseRef: string | null;
  /**
   * Untracked working-tree paths for `uncommitted`/`all` targets; empty for
   * targets that do not surface untracked files.
   */
  untrackedPaths: string[];
};

type ReadTrackedPatchByPathArgs = {
  target: WorkspaceDiffTarget;
  paths: string[];
  /**
   * Per-file patch byte budget. Bounds the page's combined `git diff` buffer
   * (sized `paths.length * maxBytesPerFile` + headroom) and, on the per-file
   * fallback, each single-file read — so a large page truncates instead of
   * overflowing the default buffer and failing the whole page.
   */
  maxBytesPerFile: number;
};

type WorkspaceMutationTargets = Workspace[];
type WorkspaceMutationWork<T> = () => Promise<T>;

interface ListWorkspaceFilesRecursivelyArgs {
  dir: string;
  root: string;
}

const UNTRACKED_DIFF_BATCH_SIZE = 10;
const WORKSPACE_STATUS_GIT_TIMEOUT_MS = 15_000;

function parseWorktreeList(porcelainOutput: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let currentPath: string | null = null;
  let currentBranchRef: string | null = null;

  for (const line of porcelainOutput.split("\n")) {
    if (line === "") {
      if (currentPath !== null) {
        entries.push({ path: currentPath, branchRef: currentBranchRef });
      }
      currentPath = null;
      currentBranchRef = null;
      continue;
    }

    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      currentBranchRef = line.slice("branch ".length);
    }
  }

  if (currentPath !== null) {
    entries.push({ path: currentPath, branchRef: currentBranchRef });
  }

  return entries;
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
    // Type change (e.g. file ↔ symlink). Render as a modification — the
    // WorkspaceFileStatusKind enum doesn't model type changes separately.
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

function parseNullSeparatedLines(output: string): string[] {
  return output.split("\0").filter((value) => value.length > 0);
}

function parseNonEmptyLines(output: string): string[] {
  return output
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isMissingHeadRevisionError(stderr: string): boolean {
  return (
    stderr.includes("ambiguous argument 'HEAD'") ||
    stderr.includes("bad revision 'HEAD'") ||
    stderr.includes("unknown revision or path not in the working tree") ||
    stderr.includes("Needed a single revision")
  );
}

function isNotGitRepositoryError(stderr: string): boolean {
  return stderr.includes("not a git repository");
}

async function listWorkspaceFilesRecursively(
  args: ListWorkspaceFilesRecursivelyArgs,
): Promise<string[]> {
  const entries = await fs.readdir(args.dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(args.dir, entry.name);
    if (entry.isDirectory()) {
      results.push(
        ...(await listWorkspaceFilesRecursively({
          dir: fullPath,
          root: args.root,
        })),
      );
      continue;
    }
    results.push(path.relative(args.root, fullPath));
  }
  return results;
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

/**
 * Truncates a string to at most `maxBytes` UTF-8 bytes on a codepoint boundary.
 * A naive `buffer.subarray(0, maxBytes)` can slice through a multibyte
 * character, which `toString("utf8")` then renders as a replacement character
 * (U+FFFD, 3 bytes) — corrupting the text AND overshooting the byte budget. We
 * cut at `maxBytes`, then walk the cut point back over any trailing UTF-8
 * continuation bytes (`0b10xxxxxx`) so the result never ends mid-character; the
 * straddling codepoint is dropped whole. The result is always valid UTF-8 and
 * `Buffer.byteLength(result) <= maxBytes`.
 */
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

/**
 * Append a `-- <paths>` pathspec to a git diff/show argument list so the
 * invocation is scoped to a subset of files. `paths === undefined` returns the
 * args unchanged (full-diff behavior). Any existing trailing `--` separator is
 * normalized so we never emit a duplicate (e.g. the `uncommitted` args already
 * carry a trailing `--`).
 */
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

/**
 * Per-file framing headroom (`diff --git` header, index/mode lines, hunk
 * headers, the `GIT binary patch` terminator) added on top of each file's patch
 * budget when sizing the combined page buffer, plus a fixed base so a tiny
 * page is never starved. The buffer only needs to be generous enough that a
 * page whose files are individually within budget reads fully; anything larger
 * is intentionally truncated and recovered downstream (the section/entry
 * count-mismatch fallback to per-file fetch, then per-entry tail-cut).
 */
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

async function readHeadNumstat(
  workspacePath: string,
  timeoutMs?: number,
): Promise<string> {
  const result = await runGit(["diff", "--numstat", "-z", "HEAD", "--"], {
    cwd: workspacePath,
    allowFailure: true,
    timeoutMs,
  });
  if (result.exitCode === 0) {
    return result.stdout;
  }
  if (isMissingHeadRevisionError(result.stderr)) {
    return "";
  }
  const detail = result.stderr.trim();
  throw new WorkspaceError(
    "git_command_failed",
    `git diff --numstat -z HEAD -- failed${detail ? `: ${detail}` : ""}`,
  );
}

async function readUntrackedNumstatEntries(
  args: ReadUntrackedNumstatEntriesArgs,
): Promise<NumstatEntry[]> {
  if (args.relativePaths.length === 0) {
    return [];
  }

  const entries: NumstatEntry[] = [];
  for (
    let index = 0;
    index < args.relativePaths.length;
    index += UNTRACKED_DIFF_BATCH_SIZE
  ) {
    const batchPaths = args.relativePaths.slice(
      index,
      index + UNTRACKED_DIFF_BATCH_SIZE,
    );
    entries.push(
      ...(await Promise.all(
        batchPaths.map(async (relativePath) => {
          const result = await runGit(
            [
              "diff",
              "--no-index",
              "--numstat",
              "--",
              "/dev/null",
              relativePath,
            ],
            {
              cwd: args.workspacePath,
              allowFailure: true,
              timeoutMs: args.timeoutMs,
            },
          );
          const [line = ""] = result.stdout.split("\n");
          const [insertionsText = "", deletionsText = ""] = line.split("\t");
          return {
            path: relativePath,
            insertions: parseNumstatCount(insertionsText),
            deletions: parseNumstatCount(deletionsText),
          };
        }),
      )),
    );
  }
  return entries;
}

export class Workspace {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  static withMutations<T>(
    workspaces: WorkspaceMutationTargets,
    work: WorkspaceMutationWork<T>,
  ): Promise<T> {
    return withCheckoutMutationLocks(
      workspaces.map((workspace) => workspace.path),
      work,
    );
  }

  withMutation<T>(work: WorkspaceMutationWork<T>): Promise<T> {
    return withCheckoutMutationLock(this.path, work);
  }

  get exists(): Promise<boolean> {
    return pathExists(this.path);
  }

  get isGitRepo(): Promise<boolean> {
    return detectGitRepo(this.path);
  }

  get currentBranch(): Promise<string | undefined> {
    return getCurrentBranch(this.path);
  }

  /**
   * Raw `gh` pull request data for the workspace's current branch, or `null`
   * when there is no branch or no detectable PR. Never throws — see
   * {@link getPullRequestForBranch}.
   */
  async getPullRequest(): Promise<GitHostPullRequest | null> {
    const branch = await getCurrentBranch(this.path);
    if (!branch) {
      return null;
    }
    return getPullRequestForBranch({ cwd: this.path, branch });
  }

  async runPullRequestAction(
    action: PullRequestActionOptions,
  ): Promise<void> {
    const branch = await getCurrentBranch(this.path);
    if (!branch) {
      throw new WorkspaceError(
        "invalid_request",
        "Cannot update pull request from a detached workspace",
      );
    }
    return runPullRequestActionForBranch({ cwd: this.path, branch, action });
  }

  async getStatus(options: StatusOptions = {}): Promise<WorkspaceStatus> {
    await ensureGitRepo(this.path, {
      timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
    });

    const mergeBaseBranch = options.mergeBaseBranch;
    const [
      statusOutput,
      diffOutput,
      checkout,
      defaultBranch,
      mergeBaseData,
    ] = await Promise.all([
      // --no-optional-locks: this runs on the watcher polling cadence and
      // must not take index.lock under a concurrent commit.
      runGit(
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v1",
          "--branch",
          "--untracked-files=all",
        ],
        { cwd: this.path, timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS },
      ),
      readHeadNumstat(this.path, WORKSPACE_STATUS_GIT_TIMEOUT_MS),
      getCheckoutRef(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
      }),
      readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
      }),
      mergeBaseBranch
        ? this.readMergeBaseStatus(
            mergeBaseBranch,
            WORKSPACE_STATUS_GIT_TIMEOUT_MS,
          )
        : null,
    ]);

    const entries = parsePorcelainEntries(statusOutput.stdout);
    const untrackedPaths = entries
      .filter((entry) => entry.status === "??")
      .map((entry) => entry.path);
    const numstatEntries = [
      ...parseNumstatEntriesZ(diffOutput),
      ...(await readUntrackedNumstatEntries({
        workspacePath: this.path,
        relativePaths: untrackedPaths,
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
      })),
    ];
    const numstatByPath = new Map(
      numstatEntries.map((entry) => [entry.path, entry] as const),
    );
    let workingTreeInsertions = 0;
    let workingTreeDeletions = 0;
    for (const entry of numstatEntries) {
      if (entry.insertions !== null) workingTreeInsertions += entry.insertions;
      if (entry.deletions !== null) workingTreeDeletions += entry.deletions;
    }
    const files: WorkspaceFileStatus[] = entries.map((entry) => {
      const numstat = numstatByPath.get(entry.path);
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
    const hasUntracked = entries.some((entry) => entry.status === "??");
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

  async getLocalStateFingerprint(): Promise<string> {
    const [headSha, status] = await Promise.all([
      this.getHeadSha(),
      this.getStatus(),
    ]);
    return JSON.stringify({
      checkout: status.checkout,
      currentBranch: status.branch.currentBranch,
      headSha,
      workingTree: status.workingTree,
    });
  }

  async getSharedGitRefsFingerprint(): Promise<string> {
    await ensureGitRepo(this.path);

    const [refs, remoteHead] = await Promise.all([
      runGit(
        [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)",
          "refs/heads",
          "refs/remotes",
        ],
        { cwd: this.path },
      ),
      runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
        cwd: this.path,
        allowFailure: true,
      }),
    ]);

    return JSON.stringify({
      refs: parseNonEmptyLines(refs.stdout),
      remoteHead: remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : "",
    });
  }

  async getDiff(options: DiffOptions = {}): Promise<DiffResult> {
    await ensureGitRepo(this.path);

    const target = options.target ?? { type: "uncommitted" as const };
    return this.buildDiffSummary({
      maxDiffBytes: options.maxDiffBytes,
      maxFileListBytes: options.maxFileListBytes,
      target,
    });
  }

  /**
   * Structured table of contents for a diff target: one `RawDiffFileStat` per
   * changed file with no patch text. Uses only `--numstat` + `--name-status -M`
   * (rename detection) and, for `uncommitted`/`all` targets, the untracked
   * working-tree files (each tagged `origin: "untracked"`). The server maps
   * these raw stats into product tiering — the daemon stays policy-free.
   */
  async diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    await ensureGitRepo(this.path);

    const stats = await this.readDiffStatArtifacts(args.target);
    const numstatByPath = new Map(
      parseNumstatEntriesZ(stats.numstat).map(
        (entry) => [entry.path, entry] as const,
      ),
    );
    const files: RawDiffFileStat[] = parseNameStatusSourceEntries(
      stats.nameStatus,
    ).map((entry) => {
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
      };
    });

    const untrackedFiles = await this.readUntrackedDiffFileStats(
      stats.untrackedPaths,
    );

    return {
      files: [...files, ...untrackedFiles],
      shortstat: stats.shortstat,
      mergeBaseRef: stats.mergeBaseRef,
    };
  }

  /**
   * Patch text for a requested subset of paths, byte-bounded per file. Paths are
   * partitioned into tracked vs. untracked using the SAME `ls-files` computation
   * that builds the TOC (the caller-supplied origin is not trusted): tracked
   * paths are fetched in ONE combined `git diff` per page (see
   * `readTrackedPatchByPathCombined`), and untracked paths use the `--no-index`
   * form, without which an untracked file produces no patch.
   */
  async diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    await ensureGitRepo(this.path);

    const untrackedForTarget = this.targetIncludesUntracked(args.target)
      ? new Set(await this.listUntrackedPaths())
      : new Set<string>();

    const untrackedPaths = args.paths.filter((p) => untrackedForTarget.has(p));
    const trackedPaths = args.paths.filter((p) => !untrackedForTarget.has(p));

    const trackedPatchByPath =
      trackedPaths.length > 0
        ? await this.readTrackedPatchByPathCombined({
            target: args.target,
            paths: trackedPaths,
            maxBytesPerFile: args.maxBytesPerFile,
          })
        : new Map<string, string>();

    const untrackedPatchByPath = new Map(
      await Promise.all(
        untrackedPaths.map(async (relativePath) => {
          const artifact = await this.readUntrackedDiffArtifact({
            relativePath,
            maxDiffBytes: args.maxBytesPerFile,
          });
          return [relativePath, artifact.diff] as const;
        }),
      ),
    );

    // Preserve the caller's requested order; drop any duplicates.
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

  async getHeadSha(): Promise<string | null> {
    await ensureGitRepo(this.path);

    const result = await runGit(["rev-parse", "HEAD"], {
      allowFailure: true,
      cwd: this.path,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim() || null;
    }
    if (isMissingHeadRevisionError(result.stderr)) {
      return null;
    }
    throw new WorkspaceError(
      "git_command_failed",
      `git rev-parse HEAD failed: ${result.stderr.trim()}`,
    );
  }

  async getBranches(): Promise<string[]> {
    return listBranches(this.path);
  }

  async listFiles(): Promise<string[]> {
    const gitResult = await runGit(
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { allowFailure: true, cwd: this.path },
    );
    if (gitResult.exitCode === 0) {
      return parseNonEmptyLines(gitResult.stdout).sort();
    }
    if (
      gitResult.exitCode === 128 ||
      isNotGitRepositoryError(gitResult.stderr)
    ) {
      const filePaths = await listWorkspaceFilesRecursively({
        dir: this.path,
        root: this.path,
      });
      return filePaths.sort();
    }
    throw new WorkspaceError(
      "git_command_failed",
      `git ls-files failed (exit ${gitResult.exitCode}): ${gitResult.stderr.trim()}`,
    );
  }

  async commit(options: CommitOptions): Promise<CommitResult> {
    await ensureGitRepo(this.path);

    return this.withMutation(async () => {
      await runGit(["add", "-A"], { cwd: this.path });
      // Detect "nothing to commit" deterministically inside the mutation lock,
      // so a commit racing a concurrent commit (or an already-clean tree)
      // surfaces as a typed no_changes condition the server maps to 409,
      // instead of a generic git failure that surfaces as a 502.
      const staged = await runGit(["diff", "--cached", "--quiet"], {
        cwd: this.path,
        allowFailure: true,
      });
      if (staged.exitCode === 0) {
        throw new WorkspaceError("no_changes", "No changes to commit");
      }
      const commitArgs = ["commit", "-m", options.message];
      if (options.noVerify) {
        commitArgs.push("--no-verify");
      }
      await runGit(commitArgs, { cwd: this.path });
      const commitSha = await revParse(this.path, "HEAD");
      const commitSubject = (
        await runGit(["log", "-1", "--pretty=%s"], { cwd: this.path })
      ).stdout.trim();

      return { commitSha, commitSubject };
    });
  }

  async reset(): Promise<void> {
    await ensureGitRepo(this.path);
    await this.withMutation(async () => {
      await runGit(["reset", "--hard", "HEAD"], { cwd: this.path });
      await runGit(["clean", "-fd"], { cwd: this.path });
    });
  }

  async fetch(options: FetchOptions = {}): Promise<void> {
    await ensureGitRepo(this.path);

    const remote = options.remote ?? "origin";
    const args = ["fetch", remote];
    if (options.branch) {
      args.push(options.branch);
    }

    await runGit(args, { cwd: this.path });
  }

  async checkoutBranch(branchName: string): Promise<void> {
    await ensureGitRepo(this.path);

    await this.withMutation(async () => {
      if ((await this.currentBranch) === branchName) {
        return;
      }

      if (await hasRef(this.path, `refs/heads/${branchName}`)) {
        await runGit(["checkout", branchName], { cwd: this.path });
        return;
      }

      if (await hasRef(this.path, `refs/remotes/origin/${branchName}`)) {
        await runGit(["checkout", "-B", branchName, `origin/${branchName}`], {
          cwd: this.path,
        });
        await runGit(
          ["branch", "--set-upstream-to", `origin/${branchName}`, branchName],
          { cwd: this.path },
        );
        return;
      }

      await runGit(["checkout", "-B", branchName], { cwd: this.path });
    });
  }

  async detachHead(): Promise<void> {
    await ensureGitRepo(this.path);

    await this.withMutation(async () => {
      if ((await this.currentBranch) === undefined) {
        return;
      }

      await runGit(["checkout", "--detach"], { cwd: this.path });
    });
  }

  async stash(message = "bb-workspace-stash"): Promise<string | null> {
    await ensureGitRepo(this.path);

    return this.withMutation(async () => {
      if (!(await hasUncommittedChanges(this.path))) {
        return null;
      }

      await runGit(["stash", "push", "--include-untracked", "-m", message], {
        cwd: this.path,
      });
      const ref = await runGit(["stash", "list", "-1", "--format=%gd"], {
        cwd: this.path,
      });
      return ref.stdout.trim() || null;
    });
  }

  async stashPop(ref?: string): Promise<void> {
    await ensureGitRepo(this.path);

    const args = ["stash", "pop"];
    if (ref) {
      args.push(ref);
    }
    await this.withMutation(async () => {
      await runGit(args, { cwd: this.path });
    });
  }

  async squashMergeInto(
    options: SquashMergeOptions,
  ): Promise<SquashMergeResult> {
    await ensureGitRepo(this.path);

    const sourceBranch = await this.currentBranch;
    if (!sourceBranch) {
      throw new WorkspaceError(
        "detached_head",
        "Cannot squash merge from a detached workspace",
      );
    }

    const target = await this.resolveSquashMergeTarget(options.targetBranch);
    const tempDir = await createTempDir("bb-squash-");
    const tempDirPath = path.resolve(tempDir);

    try {
      await runGitWithWorktreeMetadataLock(
        ["worktree", "add", "--detach", tempDir, target.baseRef],
        { cwd: this.path },
      );
      const squashCommit = await new Workspace(tempDir).withMutation(
        async () => {
          await runGit(["merge", "--squash", sourceBranch], { cwd: tempDir });
          // A squash of a branch with no committed work ahead of the target
          // stages nothing; surface that as a typed no_changes condition the
          // server maps to 409, not a generic git "nothing to commit" failure.
          const staged = await runGit(["diff", "--cached", "--quiet"], {
            cwd: tempDir,
            allowFailure: true,
          });
          if (staged.exitCode === 0) {
            throw new WorkspaceError("no_changes", "No changes to merge");
          }
          await runGit(["commit", "--no-verify", "-m", options.commitMessage], {
            cwd: tempDir,
          });
          const commitSha = await revParse(tempDir, "HEAD");
          const commitSubject = (
            await runGit(["log", "-1", "--pretty=%s"], { cwd: tempDir })
          ).stdout.trim();
          return { commitSha, commitSubject };
        },
      );
      await this.publishSquashMergeCommit({
        targetBranch: options.targetBranch,
        target,
        commitSha: squashCommit.commitSha,
      });

      return {
        merged: true,
        commitSha: squashCommit.commitSha,
        commitSubject: squashCommit.commitSubject,
        targetBranch: options.targetBranch,
      };
    } finally {
      await runGitWithWorktreeMetadataLock(
        ["worktree", "remove", tempDir, "--force"],
        {
          cwd: this.path,
          allowFailure: true,
        },
      );
      await fs.rm(tempDir, { recursive: true, force: true });

      const remainingTempWorktree = (await this.listWorktrees()).find(
        (entry) => path.resolve(entry.path) === tempDirPath,
      );
      if (remainingTempWorktree) {
        throw new WorkspaceError(
          "worktree_cleanup_failed",
          "Temporary worktree cleanup failed",
        );
      }
    }
  }

  private async resolveSquashMergeTarget(
    targetBranch: string,
  ): Promise<SquashMergeTarget> {
    const localRef = `refs/heads/${targetBranch}`;
    if (await hasRef(this.path, localRef)) {
      return {
        kind: "local",
        baseRef: localRef,
        expectedSha: await revParse(this.path, localRef),
      };
    }

    const directRemoteRef = `refs/remotes/${targetBranch}`;
    if (await hasRef(this.path, directRemoteRef)) {
      throw new WorkspaceError(
        "non_local_target_branch",
        `Cannot squash merge into remote branch ${targetBranch}; select a local branch`,
      );
    }

    const remoteRef = `refs/remotes/origin/${targetBranch}`;
    if (await hasRef(this.path, remoteRef)) {
      throw new WorkspaceError(
        "non_local_target_branch",
        `Cannot squash merge into remote-only branch ${targetBranch}; select a local branch`,
      );
    }

    throw new WorkspaceError(
      "branch_not_found",
      `Target branch does not exist: ${targetBranch}`,
    );
  }

  private async publishSquashMergeCommit(
    args: PublishSquashMergeCommitArgs,
  ): Promise<void> {
    const checkedOutTargetPath = await this.findWorktreePathForBranch(
      args.targetBranch,
    );
    if (checkedOutTargetPath !== null) {
      await new Workspace(checkedOutTargetPath).withMutation(async () => {
        if (await hasUncommittedChanges(checkedOutTargetPath)) {
          throw new WorkspaceError(
            "dirty_target_branch",
            `Cannot squash merge into ${args.targetBranch}: target branch is checked out at ${checkedOutTargetPath} with uncommitted changes`,
          );
        }

        await runGit(["merge", "--ff-only", args.commitSha], {
          cwd: checkedOutTargetPath,
        });
      });
      return;
    }

    await runGit(
      [
        "update-ref",
        `refs/heads/${args.targetBranch}`,
        args.commitSha,
        args.target.expectedSha,
      ],
      { cwd: this.path },
    );
  }

  private async findWorktreePathForBranch(
    branchName: string,
  ): Promise<string | null> {
    const entries = await this.listWorktrees();
    const branchRef = `refs/heads/${branchName}`;
    return entries.find((entry) => entry.branchRef === branchRef)?.path ?? null;
  }

  private async listWorktrees(): Promise<WorktreeEntry[]> {
    const result = await runGit(["worktree", "list", "--porcelain"], {
      cwd: this.path,
    });
    return parseWorktreeList(result.stdout);
  }

  private async buildDiffSummary(args: {
    target: WorkspaceDiffTarget;
    maxDiffBytes?: number;
    maxFileListBytes?: number;
  }): Promise<DiffSummary> {
    const {
      artifacts: [rawDiff, shortstat, rawFiles],
      mergeBaseRef,
    } = await this.readDiffArtifacts({
      target: args.target,
      maxDiffBytes: args.maxDiffBytes,
      maxFileListBytes: args.maxFileListBytes,
    });

    const diffOutput = truncateOutputToMaxBytes(rawDiff, args.maxDiffBytes);
    const fileOutput = truncateOutputToMaxBytes(
      rawFiles,
      args.maxFileListBytes,
    );

    return {
      diff: diffOutput.value,
      files: fileOutput.value,
      shortstat,
      truncated: diffOutput.truncated || fileOutput.truncated,
      mergeBaseRef,
    };
  }

  private async readPatchUniqueCommitSummaries(
    mergeBaseBranch: string,
    timeoutMs?: number,
  ): Promise<WorkspaceCommitSummary[]> {
    const log = await runGit(
      [
        "log",
        "--cherry-pick",
        "--right-only",
        "--reverse",
        "--format=%H%x1f%h%x1f%s%x1f%an%x1f%at",
        `${mergeBaseBranch}...HEAD`,
      ],
      { cwd: this.path, allowFailure: true, timeoutMs },
    );

    return log.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, shortSha, subject, authorName, authoredAt] =
          line.split("\u001f");
        return {
          sha,
          shortSha,
          subject,
          authorName: authorName ?? "",
          authoredAt: Number.parseInt(authoredAt ?? "0", 10) * 1000,
        };
      });
  }

  private async readMergeBaseStatus(
    mergeBaseBranch: string,
    timeoutMs?: number,
  ): Promise<WorkspaceStatus["mergeBase"]> {
    const [mergeBaseRef, aheadBehindCounts, commits, nameStatus, numstat] =
      await Promise.all([
        readMergeBaseRef(this.path, mergeBaseBranch, { timeoutMs }),
        runGit(
          [
            "rev-list",
            // Ignore patch-equivalent commits so squash-merged branches are not still ahead.
            "--cherry-pick",
            "--left-right",
            "--count",
            `${mergeBaseBranch}...HEAD`,
          ],
          { cwd: this.path, timeoutMs },
        ),
        this.readPatchUniqueCommitSummaries(mergeBaseBranch, timeoutMs),
        runGit(
          [
            "diff",
            "--no-ext-diff",
            "--name-status",
            "-z",
            `${mergeBaseBranch}...HEAD`,
          ],
          { cwd: this.path, allowFailure: true, timeoutMs },
        ),
        runGit(
          [
            "diff",
            "--no-ext-diff",
            "--numstat",
            "-z",
            `${mergeBaseBranch}...HEAD`,
          ],
          { cwd: this.path, allowFailure: true, timeoutMs },
        ),
      ]);
    const [behindCount, aheadCount] = aheadBehindCounts.stdout
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10));
    let normalizedAheadCount = Number.isFinite(aheadCount) ? aheadCount : 0;
    const normalizedBehindCount = Number.isFinite(behindCount)
      ? behindCount
      : 0;
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
    for (const entry of numstatEntries) {
      if (entry.insertions !== null) effectiveInsertions += entry.insertions;
      if (entry.deletions !== null) effectiveDeletions += entry.deletions;
    }

    // `--cherry-pick` handles regular merges, rebase-merges, and cherry-picks,
    // but not squash merges. Only look for a squash when the branch still
    // appears ahead AND the base has advanced since the fork point — if the
    // base hasn't moved, no squash could exist there.
    if (normalizedAheadCount > 0 && normalizedBehindCount > 0 && mergeBaseRef) {
      const squashMerged = await this.detectSquashMerge(
        mergeBaseRef,
        mergeBaseBranch,
        timeoutMs,
      );
      if (squashMerged) {
        normalizedAheadCount = 0;
        effectiveCommits = [];
      }
    }

    // `commits` is cherry-pick-filtered (patch-equivalent commits that already
    // exist on the base are excluded), but `--name-status <base>...HEAD` is
    // not. If every branch commit has landed on the base via cherry-pick or
    // squash merge, there's nothing "committed unmerged" to surface — drop
    // the file list and stats to match so the UI doesn't show files with no
    // commits behind them.
    if (effectiveCommits.length === 0) {
      effectiveFiles = [];
      effectiveInsertions = 0;
      effectiveDeletions = 0;
    }

    return {
      mergeBaseBranch,
      baseRef: mergeBaseRef ?? null,
      aheadCount: normalizedAheadCount,
      behindCount: normalizedBehindCount,
      hasCommittedUnmergedChanges: normalizedAheadCount > 0,
      commits: effectiveCommits,
      files: effectiveFiles,
      insertions: effectiveInsertions,
      deletions: effectiveDeletions,
    };
  }

  /**
   * Detect whether the branch has already landed on the base as a squash
   * merge. A squash collapses N branch commits into a single base commit with
   * a combined patch-id that none of the originals match, so `--cherry-pick`
   * can't see it. Compare the branch's cumulative patch-id against each
   * commit on the base since the merge-base; a match means the branch
   * landed. If the cumulative diff is empty (e.g. commits that cancel out),
   * treat the branch as merged — there's nothing left to land.
   *
   * The diff/log pipelines are offloaded to `sh -c` so git streams directly
   * into `git patch-id` without Node buffering the intermediate output; only
   * the tiny patch-id output (one line per commit) is captured.
   */
  private async detectSquashMerge(
    mergeBaseRef: string,
    mergeBaseBranch: string,
    timeoutMs?: number,
  ): Promise<boolean> {
    const branchPatchIdResult = await runShellPipeline(
      'git diff "$1".."$2" | git patch-id --stable',
      [mergeBaseRef, "HEAD"],
      { cwd: this.path, allowFailure: true, timeoutMs },
    );
    if (branchPatchIdResult.exitCode !== 0) {
      return false;
    }
    if (!branchPatchIdResult.stdout.trim()) {
      // Empty cumulative diff — the branch contributes no net changes and is
      // effectively merged.
      return true;
    }
    const branchPatchId = parsePatchId(
      branchPatchIdResult.stdout.split("\n")[0],
    );
    if (!branchPatchId) {
      return false;
    }

    // Cap the base-side scan to keep `getStatus` bounded on long-divergent
    // branches. Squash merges we care about land within a reasonable window;
    // if the user opens a branch that's thousands of commits behind, we'll
    // miss detection and report the branch as ahead — the fallback is
    // pessimistic but correct.
    const basePatchIdsResult = await runShellPipeline(
      'git log -p -n 1000 --format="commit %H" "$1".."$2" | git patch-id --stable',
      [mergeBaseRef, mergeBaseBranch],
      { cwd: this.path, allowFailure: true, timeoutMs },
    );
    if (basePatchIdsResult.exitCode !== 0) {
      return false;
    }
    return basePatchIdsResult.stdout
      .split("\n")
      .some((line) => parsePatchId(line) === branchPatchId);
  }

  private targetIncludesUntracked(target: WorkspaceDiffTarget): boolean {
    return target.type === "uncommitted" || target.type === "all";
  }

  /**
   * Runs `--name-status -M`, `--numstat -M`, and `--shortstat` for a target
   * (no patch text), returning the raw outputs plus the resolved merge-base and
   * any untracked working-tree paths the TOC must surface. Mirrors
   * `readDiffArtifacts`'s target switch but omits the patch artifact.
   */
  private async readDiffStatArtifacts(
    target: WorkspaceDiffTarget,
  ): Promise<DiffStatArtifacts> {
    const untrackedPaths = this.targetIncludesUntracked(target)
      ? await this.listUntrackedPaths()
      : [];

    switch (target.type) {
      case "uncommitted": {
        const stats = await this.runDiffStatCommands(["HEAD"]);
        return { ...stats, mergeBaseRef: null, untrackedPaths };
      }
      case "branch_committed": {
        const mergeBaseRef = await readMergeBaseRef(
          this.path,
          target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return {
            nameStatus: "",
            numstat: "",
            shortstat: "",
            mergeBaseRef: null,
            untrackedPaths: [],
          };
        }
        const stats = await this.runDiffStatCommands([`${mergeBaseRef}..HEAD`]);
        return { ...stats, mergeBaseRef, untrackedPaths: [] };
      }
      case "all": {
        const mergeBaseRef = await readMergeBaseRef(
          this.path,
          target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return {
            nameStatus: "",
            numstat: "",
            shortstat: "",
            mergeBaseRef: null,
            untrackedPaths: [],
          };
        }
        const stats = await this.runDiffStatCommands([mergeBaseRef]);
        return { ...stats, mergeBaseRef, untrackedPaths };
      }
      case "commit": {
        const [nameStatus, numstat, shortstat] = await Promise.all([
          runGit(
            ["show", "--format=", "--no-ext-diff", "--name-status", "-M", "-z", target.sha],
            { cwd: this.path },
          ),
          runGit(
            ["show", "--format=", "--no-ext-diff", "--numstat", "-M", "-z", target.sha],
            { cwd: this.path },
          ),
          runGit(["show", "--format=", "--no-ext-diff", "--shortstat", target.sha], {
            cwd: this.path,
          }),
        ]);
        return {
          nameStatus: nameStatus.stdout,
          numstat: numstat.stdout,
          shortstat: shortstat.stdout,
          mergeBaseRef: null,
          untrackedPaths: [],
        };
      }
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  }

  private async runDiffStatCommands(
    rangeArgs: string[],
  ): Promise<{ nameStatus: string; numstat: string; shortstat: string }> {
    const [nameStatus, numstat, shortstat] = await Promise.all([
      runGit(
        ["diff", "--no-ext-diff", "--name-status", "-M", "-z", ...rangeArgs],
        { cwd: this.path },
      ),
      runGit(["diff", "--no-ext-diff", "--numstat", "-M", "-z", ...rangeArgs], {
        cwd: this.path,
      }),
      runGit(["diff", "--no-ext-diff", "--shortstat", ...rangeArgs], {
        cwd: this.path,
      }),
    ]);
    return {
      nameStatus: nameStatus.stdout,
      numstat: numstat.stdout,
      shortstat: shortstat.stdout,
    };
  }

  /**
   * Per-file numstat for untracked working-tree paths via the `--no-index` form
   * (a plain scoped `git diff` produces no output for an untracked file). Each
   * file is tagged `origin: "untracked"` and reports an `A` (added) status — an
   * untracked file is, by definition, a pure addition.
   */
  private async readUntrackedDiffFileStats(
    untrackedPaths: string[],
  ): Promise<RawDiffFileStat[]> {
    const stats: RawDiffFileStat[] = [];
    for (
      let index = 0;
      index < untrackedPaths.length;
      index += UNTRACKED_DIFF_BATCH_SIZE
    ) {
      const batch = untrackedPaths.slice(index, index + UNTRACKED_DIFF_BATCH_SIZE);
      stats.push(
        ...(await Promise.all(
          batch.map((relativePath) =>
            this.readUntrackedDiffFileStat(relativePath),
          ),
        )),
      );
    }
    return stats;
  }

  private async readUntrackedDiffFileStat(
    relativePath: string,
  ): Promise<RawDiffFileStat> {
    const numstat = await runGit(
      ["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", relativePath],
      { cwd: this.path, allowFailure: true },
    );
    const entry = parseNumstatEntriesZ(numstat.stdout)[0];
    const binary =
      entry !== undefined &&
      entry.insertions === null &&
      entry.deletions === null;
    return {
      path: relativePath,
      previousPath: null,
      statusLetter: "A",
      additions: binary ? 0 : (entry?.insertions ?? 0),
      deletions: binary ? 0 : (entry?.deletions ?? 0),
      binary,
      origin: "untracked",
    };
  }

  /**
   * Computes the tracked patch for the requested paths in ONE combined `git
   * diff` per page, keyed by the requested (new) file path. Two invocations run
   * for the page: a `--name-status -z` list (the authoritative per-file order
   * plus the raw, unquoted paths — including spaces) and the combined patch
   * text. The patch is split into per-file sections at each `diff --git `
   * boundary and ZIPPED positionally with the name-status entries — both are
   * git-sorted by the same pathspec, so section[i] belongs to entry[i]. We key
   * by the entry's new path (NOT by parsing the `diff --git` header, which git
   * does not quote for spaces and a token split would mangle); renames carry
   * old+new and are keyed by new. If the section and entry counts ever disagree
   * we fall back to per-file fetch so correctness never regresses.
   */
  private async readTrackedPatchByPathCombined(
    args: ReadTrackedPatchByPathArgs,
  ): Promise<Map<string, string>> {
    const combined = await this.readCombinedTrackedDiff(args);
    if (combined === null) {
      return new Map();
    }

    const entries = parseNameStatusSourceEntries(combined.nameStatus);
    const sections = splitPatchIntoSections(combined.patch);

    if (sections.length !== entries.length) {
      // The positional zip is only valid when the two git outputs agree
      // file-for-file. Any mismatch (an unexpected split boundary, a name-status
      // entry with no section, etc.) breaks the keying invariant, so fall back
      // to the unambiguous per-file fetch rather than risk mis-keying a patch.
      return this.readTrackedPatchByPathPerFile(args);
    }

    const patchByPath = new Map<string, string>();
    for (let index = 0; index < entries.length; index += 1) {
      // Key by the entry's new path — the path the client requested.
      patchByPath.set(entries[index].path, sections[index]);
    }
    return patchByPath;
  }

  /**
   * Per-file fallback for `readTrackedPatchByPathCombined`: one target-scoped
   * `git diff` per requested path (plus its rename/copy source so `-M` pairs
   * them), keyed by the requested path. Unambiguous for every path because the
   * key is the requested path, not a header-parsed one — used only when the
   * combined split's section/entry counts disagree.
   */
  private async readTrackedPatchByPathPerFile(
    args: ReadTrackedPatchByPathArgs,
  ): Promise<Map<string, string>> {
    const stats = await this.readDiffStatArtifacts(args.target);
    const previousPathByPath = new Map(
      parseNameStatusSourceEntries(stats.nameStatus).map(
        (entry) => [entry.path, entry.previousPath] as const,
      ),
    );

    const entries = await Promise.all(
      args.paths.map(async (path) => {
        const previousPath = previousPathByPath.get(path);
        const pathspec =
          previousPath != null && previousPath !== path
            ? [previousPath, path]
            : [path];
        const {
          artifacts: [diff],
        } = await this.readDiffArtifacts({
          target: args.target,
          paths: pathspec,
          maxDiffBytes: args.maxBytesPerFile,
        });
        return [path, diff] as const;
      }),
    );

    return new Map(entries);
  }

  /**
   * Runs the combined git invocations for a page of tracked paths. A scoped
   * `git diff -- <new path>` cannot pair a rename: with only the new path in the
   * pathspec, `-M` never sees the source and renders the rename as a pure
   * addition. So we first read the FULL-target name-status (one cheap, patchless
   * invocation that sees every file and therefore detects renames), collect the
   * rename/copy SOURCE paths for the requested files, and add them to the
   * pathspec. Then the page's `--name-status -z` and patch (PATCH ONLY — no
   * numstat/shortstat) both run scoped to `[...requested, ...renameSources]`, so
   * each rename is paired `a/old → b/new` and both outputs are git-sorted by the
   * same pathspec — letting the caller zip section[i] with entry[i]. Returns
   * `null` when the target resolves to no diff (e.g. a branch target whose merge
   * base cannot be found), matching the stat/artifact readers.
   */
  private async readCombinedTrackedDiff(
    args: ReadTrackedPatchByPathArgs,
  ): Promise<{ nameStatus: string; patch: string } | null> {
    const range = await this.resolveTrackedDiffRange(args.target);
    if (range === null) {
      return null;
    }

    const fullNameStatus = await runGit(
      [...range.baseArgs, "--name-status", "-z", "-M", ...range.rangeArgs],
      { cwd: this.path },
    );
    const requested = new Set(args.paths);
    const renameSources = parseNameStatusSourceEntries(fullNameStatus.stdout)
      .filter((entry) => requested.has(entry.path))
      .map((entry) => entry.previousPath)
      .filter(
        (previousPath): previousPath is string =>
          previousPath !== null && !requested.has(previousPath),
      );
    const pagePathspec = [...args.paths, ...renameSources];

    const [nameStatus, patch] = await Promise.all([
      runGit(
        withDiffPathspec(
          [...range.baseArgs, "--name-status", "-z", "-M", ...range.rangeArgs],
          pagePathspec,
        ),
        { cwd: this.path },
      ),
      runGit(
        withDiffPathspec(
          [...range.baseArgs, "--binary", "-M", ...range.rangeArgs],
          pagePathspec,
        ),
        buildDiffOutputGitOptions(
          this.path,
          combinedPageBufferBudget(pagePathspec.length, args.maxBytesPerFile),
        ),
      ),
    ]);

    return { nameStatus: nameStatus.stdout, patch: patch.stdout };
  }

  /**
   * Resolves the git argv prefix (`diff`/`show` plus `--no-ext-diff`) and the
   * range/sha args for a diff target's TRACKED side. Returns `null` for branch
   * targets whose merge base cannot be resolved — those surface as no diff.
   */
  private async resolveTrackedDiffRange(
    target: WorkspaceDiffTarget,
  ): Promise<{ baseArgs: string[]; rangeArgs: string[] } | null> {
    const diffBase = ["diff", "--no-ext-diff"];
    switch (target.type) {
      case "uncommitted":
        return { baseArgs: diffBase, rangeArgs: ["HEAD"] };
      case "branch_committed":
      case "all": {
        const mergeBaseRef = await readMergeBaseRef(
          this.path,
          target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return null;
        }
        const rangeArgs =
          target.type === "branch_committed"
            ? [`${mergeBaseRef}..HEAD`]
            : [mergeBaseRef];
        return { baseArgs: diffBase, rangeArgs };
      }
      case "commit":
        return {
          baseArgs: ["show", "--format=", "--no-ext-diff"],
          rangeArgs: [target.sha],
        };
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  }

  private async readDiffArtifacts(
    args: ReadWorkspaceDiffArtifactsArgs,
  ): Promise<DiffArtifactsResult> {
    switch (args.target.type) {
      case "uncommitted":
        return {
          artifacts: await this.readUncommittedDiffArtifacts({
            maxDiffBytes: args.maxDiffBytes,
            maxFileListBytes: args.maxFileListBytes,
            paths: args.paths,
          }),
          mergeBaseRef: null,
        };
      case "branch_committed": {
        const mergeBaseRef = await readMergeBaseRef(
          this.path,
          args.target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return { artifacts: ["", "", ""], mergeBaseRef: null };
        }
        return {
          artifacts: await this.runDiffCommands(
            [`${mergeBaseRef}..HEAD`],
            [`${mergeBaseRef}..HEAD`],
            [`${mergeBaseRef}..HEAD`],
            {
              maxDiffBytes: args.maxDiffBytes,
              maxFileListBytes: args.maxFileListBytes,
              paths: args.paths,
            },
          ),
          mergeBaseRef,
        };
      }
      case "all": {
        const mergeBaseRef = await readMergeBaseRef(
          this.path,
          args.target.mergeBaseBranch,
        );
        if (!mergeBaseRef) {
          return { artifacts: ["", "", ""], mergeBaseRef: null };
        }
        return {
          artifacts: await this.readDiffArtifactsIncludingUntracked({
            diffArgs: [mergeBaseRef],
            filesArgs: [mergeBaseRef],
            numstatArgs: [mergeBaseRef],
            maxDiffBytes: args.maxDiffBytes,
            maxFileListBytes: args.maxFileListBytes,
            paths: args.paths,
          }),
          mergeBaseRef,
        };
      }
      case "commit": {
        const sha = args.target.sha;
        const [diff, shortstat, files] = await Promise.all([
          runGit(
            withDiffPathspec(
              ["show", "--format=", "--no-ext-diff", "--binary", sha],
              args.paths,
            ),
            buildDiffOutputGitOptions(this.path, args.maxDiffBytes),
          ),
          runGit(
            withDiffPathspec(
              ["show", "--format=", "--shortstat", sha],
              args.paths,
            ),
            { cwd: this.path },
          ),
          runGit(
            withDiffPathspec(
              ["show", "--format=", "--name-status", sha],
              args.paths,
            ),
            buildDiffOutputGitOptions(this.path, args.maxFileListBytes),
          ),
        ]);
        return {
          artifacts: [diff.stdout, shortstat.stdout, files.stdout],
          mergeBaseRef: null,
        };
      }
      default: {
        const _exhaustive: never = args.target;
        return _exhaustive;
      }
    }
  }

  private async runDiffCommands(
    diffArgs: string[],
    shortstatArgs: string[],
    filesArgs: string[],
    options: DiffOutputLimits & DiffPathSubset = {},
  ): Promise<[string, string, string]> {
    const [diff, shortstat, files] = await Promise.all([
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--binary", ...diffArgs],
          options.paths,
        ),
        buildDiffOutputGitOptions(this.path, options.maxDiffBytes),
      ),
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--shortstat", ...shortstatArgs],
          options.paths,
        ),
        { cwd: this.path },
      ),
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--name-status", ...filesArgs],
          options.paths,
        ),
        buildDiffOutputGitOptions(this.path, options.maxFileListBytes),
      ),
    ]);

    return [diff.stdout, shortstat.stdout, files.stdout];
  }

  private async readDiffArtifactsIncludingUntracked(
    args: ReadDiffArtifactsArgs,
  ): Promise<[string, string, string]> {
    const [trackedDiff, trackedNumstat, trackedFiles] = await Promise.all([
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--binary", ...args.diffArgs],
          args.paths,
        ),
        buildDiffOutputGitOptions(this.path, args.maxDiffBytes),
      ),
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--numstat", ...args.numstatArgs],
          args.paths,
        ),
        { cwd: this.path },
      ),
      runGit(
        withDiffPathspec(
          ["diff", "--no-ext-diff", "--name-status", ...args.filesArgs],
          args.paths,
        ),
        buildDiffOutputGitOptions(this.path, args.maxFileListBytes),
      ),
    ]);

    return this.appendUntrackedDiffArtifacts({
      diff: trackedDiff.stdout,
      files: trackedFiles.stdout,
      numstat: trackedNumstat.stdout,
      maxDiffBytes: args.maxDiffBytes,
      maxFileListBytes: args.maxFileListBytes,
      paths: args.paths,
    });
  }

  private async appendUntrackedDiffArtifacts(
    args: AppendUntrackedDiffArtifactsArgs,
  ): Promise<[string, string, string]> {
    const untrackedPaths = await this.listUntrackedPaths();
    const requestedUntrackedPaths =
      args.paths === undefined
        ? untrackedPaths
        : untrackedPaths.filter((untrackedPath) =>
            args.paths?.includes(untrackedPath),
          );
    if (requestedUntrackedPaths.length === 0) {
      return [
        args.diff,
        formatShortstat(summarizeNumstat(args.numstat)),
        args.files,
      ];
    }

    const untrackedArtifacts =
      await this.readUntrackedDiffArtifacts({
        relativePaths: requestedUntrackedPaths,
        maxDiffBytes: args.maxDiffBytes,
        maxFileListBytes: args.maxFileListBytes,
      });
    const combinedNumstat = joinDiffArtifactLines([
      args.numstat,
      ...untrackedArtifacts.map((artifact) => artifact.numstat),
    ]);
    const combinedDiff = joinDiffArtifactOutput([
      args.diff,
      ...untrackedArtifacts.map((artifact) => artifact.diff),
    ]);
    const combinedFiles = joinDiffArtifactOutput([
      args.files,
      ...untrackedArtifacts.map((artifact) => artifact.files),
    ]);

    return [
      combinedDiff,
      formatShortstat(summarizeNumstat(combinedNumstat)),
      combinedFiles,
    ];
  }

  private async readUntrackedDiffArtifacts(
    args: ReadUntrackedDiffArtifactsArgs,
  ): Promise<DiffArtifacts[]> {
    const artifacts: DiffArtifacts[] = [];

    for (
      let index = 0;
      index < args.relativePaths.length;
      index += UNTRACKED_DIFF_BATCH_SIZE
    ) {
      const batchPaths = args.relativePaths.slice(
        index,
        index + UNTRACKED_DIFF_BATCH_SIZE,
      );
      artifacts.push(
        ...(await Promise.all(
          batchPaths.map((relativePath) =>
            this.readUntrackedDiffArtifact({
              relativePath,
              maxDiffBytes: args.maxDiffBytes,
              maxFileListBytes: args.maxFileListBytes,
            }),
          ),
        )),
      );
    }

    return artifacts;
  }

  private async readUntrackedDiffArtifact(
    args: ReadUntrackedDiffArtifactArgs,
  ): Promise<DiffArtifacts> {
    const [diff, numstat, files] = await Promise.all([
      runGit(
        [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--binary",
          "--",
          "/dev/null",
          args.relativePath,
        ],
        {
          ...buildDiffOutputGitOptions(this.path, args.maxDiffBytes),
          allowFailure: true,
        },
      ),
      runGit(
        [
          "diff",
          "--no-index",
          "--numstat",
          "--",
          "/dev/null",
          args.relativePath,
        ],
        { cwd: this.path, allowFailure: true },
      ),
      runGit(
        [
          "diff",
          "--no-index",
          "--name-status",
          "--",
          "/dev/null",
          args.relativePath,
        ],
        {
          ...buildDiffOutputGitOptions(this.path, args.maxFileListBytes),
          allowFailure: true,
        },
      ),
    ]);

    return {
      diff: diff.stdout,
      files: files.stdout,
      numstat: numstat.stdout,
    };
  }

  private async readUncommittedDiffArtifacts(
    args: DiffOutputLimits & DiffPathSubset,
  ): Promise<[string, string, string]> {
    return this.readDiffArtifactsIncludingUntracked({
      diffArgs: ["HEAD", "--"],
      filesArgs: ["HEAD", "--"],
      numstatArgs: ["HEAD", "--"],
      maxDiffBytes: args.maxDiffBytes,
      maxFileListBytes: args.maxFileListBytes,
      paths: args.paths,
    });
  }

  private async listUntrackedPaths(): Promise<string[]> {
    const untrackedFilesOutput = await runGit(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd: this.path },
    );
    return parseNullSeparatedLines(untrackedFilesOutput.stdout);
  }
}

function joinDiffArtifactLines(parts: string[]): string {
  return parts
    .map((value) => value.trimEnd())
    .filter((value) => value.length > 0)
    .join("\n");
}

function joinDiffArtifactOutput(parts: string[]): string {
  const combined = joinDiffArtifactLines(parts);
  return combined.length > 0 ? `${combined}\n` : "";
}

const DIFF_SECTION_HEADER = "diff --git ";

/**
 * Splits a combined `git diff` into one entry per changed file, cutting at each
 * `diff --git ` header line. Every changed file — including binary
 * ("Binary files … differ"), pure-rename, and mode-only sections — is exactly
 * one section, so the result is ordered identically to git's per-file output
 * and can be positionally zipped with the `--name-status -z` entries. We do NOT
 * derive the path from the header (git does not quote spaces there); the caller
 * keys each section by the corresponding name-status entry's path. Each section
 * is normalized to end in a single trailing newline, matching the byte framing
 * of a single-file `git diff` invocation.
 */
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

/**
 * Joins a section's lines back into patch text, dropping the trailing empty
 * lines the `\n` split produces at a section boundary (or end of output), so a
 * combined-split section is byte-equal to the per-file `git diff` for that file.
 *
 * A text diff ends with a single newline after its last content line. A
 * `GIT binary patch` literal block, however, is terminated by a blank line that
 * is part of git's per-file framing — so for a binary section we re-add that
 * terminator (the strip above removes it along with the boundary artifact).
 */
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

/**
 * Narrows a raw `git diff --name-status` letter to the canonical
 * `RawDiffFileStat["statusLetter"]` set. Renames and copies carry a similarity
 * score (`R100`, `C75`), so only the first character is significant. Anything
 * outside the known taxonomy (e.g. unmerged `U`, which the diff targets here
 * never surface) is reported as a modification.
 */
function normalizeNameStatusLetter(
  status: string,
): RawDiffFileStat["statusLetter"] {
  const letter = status[0] ?? "";
  if (NAME_STATUS_LETTERS.has(letter)) {
    return letter as RawDiffFileStat["statusLetter"];
  }
  return "M";
}

/**
 * Truncates a single file's patch to at most `maxBytes` UTF-8 bytes, flagging
 * whether the tail was cut. A non-positive budget disables truncation. The cut
 * is codepoint-safe (see `truncateToMaxBytes`), so a multibyte character at the
 * budget boundary is dropped whole rather than corrupted into U+FFFD.
 */
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
