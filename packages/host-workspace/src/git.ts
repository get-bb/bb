import fs from "node:fs/promises";
import path from "node:path";
import type { ExecFileException } from "node:child_process";
import { execHostFileBuffer, runVcsProcess } from "@bb/process-utils";
import type { GitCheckoutRef, WorkspaceGitOperation } from "@bb/domain";
import {
  createGitCommandFailedError,
  detectGitSource,
  ensureGitRepo,
  type GitProcessOptions,
  type GitTimeoutOptions,
  parseOriginHeadBranchName,
  resolveGitProcessEnv,
  resolvePreferredLocalDefaultBranch,
  runGit,
  trimOutput,
  WorkspaceError,
} from "bb-environment-provider-host/workspace-git";

function toExecError(error: unknown): ExecFileException | undefined {
  return error instanceof Error ? (error as ExecFileException) : undefined;
}

function isMaxBufferExceededError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

type ActiveWorkspaceGitOperationKind = Exclude<
  WorkspaceGitOperation["kind"],
  "none" | "unknown"
>;

interface WorkspaceGitOperationMarker {
  kind: ActiveWorkspaceGitOperationKind;
  markerNames: string[];
}

const CONFLICT_PORCELAIN_STATUSES = new Set<string>([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

const WORKSPACE_GIT_OPERATION_MARKERS: WorkspaceGitOperationMarker[] = [
  { kind: "rebase", markerNames: ["rebase-merge", "rebase-apply"] },
  { kind: "merge", markerNames: ["MERGE_HEAD"] },
  { kind: "cherry-pick", markerNames: ["CHERRY_PICK_HEAD"] },
  { kind: "revert", markerNames: ["REVERT_HEAD"] },
];

function isMissingGitBlobTargetError(stderr: string): boolean {
  return (
    /^fatal: path '.+' does not exist in '.+'$/u.test(stderr) ||
    /^fatal: invalid object name '.+'\.$/u.test(stderr) ||
    /^fatal: Not a valid object name .+$/u.test(stderr)
  );
}

export async function getAbsoluteGitDir(
  cwd: string,
  options: GitProcessOptions = {},
): Promise<string> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], {
    cwd,
    ...options,
  });
  const gitDir = result.stdout.trim();
  if (!gitDir) {
    throw new WorkspaceError(
      "git_command_failed",
      `git rev-parse --absolute-git-dir returned no path for ${cwd}`,
    );
  }
  return path.resolve(gitDir);
}

async function findWorkspaceGitOperationMarker(
  gitDir: string,
): Promise<WorkspaceGitOperationMarker | undefined> {
  for (const marker of WORKSPACE_GIT_OPERATION_MARKERS) {
    for (const markerName of marker.markerNames) {
      if (await pathExists(path.join(gitDir, markerName))) {
        return marker;
      }
    }
  }
  return undefined;
}

export async function inspectGitRepository(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<{ isGitRepo: boolean; isWorktree: boolean }> {
  const result = await runGit(
    [
      "rev-parse",
      "--is-inside-work-tree",
      "--is-bare-repository",
      "--git-dir",
      "--git-common-dir",
    ],
    { cwd, ...options, allowFailure: true },
  );
  if (result.exitCode !== 0) return { isGitRepo: false, isWorktree: false };
  const [insideWorkTree, bare, ...directoryLines] = result.stdout
    .replace(/\n$/u, "")
    .split("\n");
  let gitDir: string | undefined = directoryLines[0];
  let commonDir: string | undefined = directoryLines[1];
  if (directoryLines.length > 2) {
    gitDir = undefined;
    commonDir = undefined;
    for (let index = 1; index < directoryLines.length; index += 1) {
      const candidateGitDir = directoryLines.slice(0, index).join("\n");
      const candidateCommonDir = directoryLines.slice(index).join("\n");
      const directoriesExist = await Promise.all([
        pathExists(path.resolve(cwd, candidateGitDir)),
        pathExists(path.resolve(cwd, candidateCommonDir)),
      ]);
      if (directoriesExist.every(Boolean)) {
        gitDir = candidateGitDir;
        commonDir = candidateCommonDir;
        break;
      }
    }
  }
  if (
    (insideWorkTree !== "true" && insideWorkTree !== "false") ||
    (bare !== "true" && bare !== "false") ||
    !gitDir ||
    !commonDir
  ) {
    throw new WorkspaceError(
      "git_command_failed",
      "Invalid repository inspection output",
    );
  }
  const isGitRepo = insideWorkTree === "true";
  return {
    isGitRepo,
    isWorktree:
      isGitRepo && path.resolve(cwd, gitDir) !== path.resolve(cwd, commonDir),
  };
}

export async function detectLinkedWorktree(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<boolean> {
  const gitDirResult = await runGit(["rev-parse", "--git-dir"], {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (gitDirResult.exitCode !== 0) {
    return false;
  }
  return gitDirResult.stdout.trim().includes("/worktrees/");
}

async function readHeadSha(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "HEAD"], {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }

  const sha = trimOutput(result.stdout);
  return sha || null;
}

export async function getCheckoutRef(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<GitCheckoutRef> {
  if (!(await detectGitSource(cwd, options))) {
    return { kind: "unknown", reason: "Path is not a git repository" };
  }

  const [symbolicRef, headSha] = await Promise.all([
    runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd,
      ...options,
      allowFailure: true,
    }),
    readHeadSha(cwd, options),
  ]);

  const branchName = trimOutput(symbolicRef.stdout);
  if (symbolicRef.exitCode === 0 && branchName) {
    if (headSha === null) {
      return { kind: "unborn", branchName };
    }
    return { kind: "branch", branchName, headSha };
  }

  if (headSha !== null) {
    return { kind: "detached", headSha };
  }

  return {
    kind: "unknown",
    reason: "HEAD is not symbolic and no commit is checked out",
  };
}

function hasPorcelainConflict(statusOutput: string): boolean {
  return statusOutput.split("\n").some((line) => {
    const status = line.slice(0, 2);
    return status.includes("U") || CONFLICT_PORCELAIN_STATUSES.has(status);
  });
}

function buildActiveWorkspaceGitOperation(
  kind: ActiveWorkspaceGitOperationKind,
  hasConflicts: boolean,
): WorkspaceGitOperation {
  switch (kind) {
    case "merge":
      return { kind: "merge", hasConflicts };
    case "rebase":
      return { kind: "rebase", hasConflicts };
    case "cherry-pick":
      return { kind: "cherry-pick", hasConflicts };
    case "revert":
      return { kind: "revert", hasConflicts };
  }
}

export async function getWorkspaceGitOperation(
  cwd: string,
  options: GitProcessOptions = {},
): Promise<WorkspaceGitOperation> {
  await ensureGitRepo(cwd, options);

  const [gitDir, status] = await Promise.all([
    getAbsoluteGitDir(cwd, options),
    runGit(
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ],
      { cwd, ...options },
    ),
  ]);
  const hasConflicts = hasPorcelainConflict(status.stdout);
  const marker = await findWorkspaceGitOperationMarker(gitDir);
  if (!marker) {
    return { kind: "none" };
  }
  return buildActiveWorkspaceGitOperation(marker.kind, hasConflicts);
}

export interface SharedGitRefsSnapshot {
  fingerprint: string;
  defaultBranch: string | null;
}

export async function readSharedGitRefsSnapshot(
  cwd: string,
  options: GitProcessOptions = {},
  repositoryKnown = false,
): Promise<SharedGitRefsSnapshot> {
  if (!repositoryKnown) await ensureGitRepo(cwd, options);
  const refs = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(refname:short)%00%(symref)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd, ...options },
  );
  const refRecords = refs.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = "", oid = "", shortName = "", symref = ""] =
        line.split("\0");
      return { name, oid, shortName, symref };
    });
  const listedOriginHead = refRecords.find(
    (ref) => ref.name === "refs/remotes/origin/HEAD",
  );
  let originHead = listedOriginHead?.symref;
  if (originHead === undefined) {
    const remoteHead = await runGit(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { cwd, ...options, allowFailure: true },
    );
    originHead = remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : "";
  }
  const refLines = refRecords.map(
    (ref) => `${ref.name}\0${ref.oid}\0${ref.shortName}`,
  );
  const localBranches = refRecords
    .filter((ref) => ref.name.startsWith("refs/heads/"))
    .map((ref) => ref.shortName);
  return {
    fingerprint: JSON.stringify({ refs: refLines, remoteHead: originHead }),
    defaultBranch:
      parseOriginHeadBranchName(originHead) ??
      resolvePreferredLocalDefaultBranch(localBranches, undefined) ??
      null,
  };
}

export async function revParse(
  cwd: string,
  ref: string,
  options: GitProcessOptions = {},
): Promise<string> {
  await ensureGitRepo(cwd, options);
  const result = await runGit(["rev-parse", ref], { cwd, ...options });
  return trimOutput(result.stdout);
}

interface ReadGitBlobResult {
  contents: Buffer | null;
  sizeBytes: number;
}

async function gitBlobSize(
  cwd: string,
  ref: string,
  relativePath: string,
  options: GitProcessOptions,
): Promise<number | undefined> {
  await ensureGitRepo(cwd, options);
  const target = `${ref}:${relativePath}`;
  const typeArgs = ["cat-file", "-t", target];
  const typeResult = await runGit(typeArgs, {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (typeResult.exitCode !== 0) {
    const stderr = trimOutput(typeResult.stderr);
    if (isMissingGitBlobTargetError(stderr)) {
      return undefined;
    }
    throw createGitCommandFailedError(typeArgs, stderr);
  }

  const objectType = trimOutput(typeResult.stdout);
  if (objectType !== "blob") {
    throw new WorkspaceError(
      "git_command_failed",
      `git cat-file -t ${target} returned ${objectType || "unknown object type"}, expected blob`,
    );
  }

  const sizeArgs = ["cat-file", "-s", target];
  const sizeResult = await runGit(sizeArgs, {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (sizeResult.exitCode !== 0) {
    const stderr = trimOutput(sizeResult.stderr);
    if (isMissingGitBlobTargetError(stderr)) {
      return undefined;
    }
    throw createGitCommandFailedError(sizeArgs, stderr);
  }

  const parsed = Number.parseInt(trimOutput(sizeResult.stdout), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new WorkspaceError(
      "git_command_failed",
      `git cat-file -s ${target} returned invalid size ${trimOutput(
        sizeResult.stdout,
      )}`,
    );
  }
  return parsed;
}

export async function readGitBlob(
  cwd: string,
  ref: string,
  relativePath: string,
  maxBytes: number,
  options: GitProcessOptions = {},
): Promise<ReadGitBlobResult> {
  const target = `${ref}:${relativePath}`;
  const size = await gitBlobSize(cwd, ref, relativePath, options);
  if (size === undefined) {
    return { contents: null, sizeBytes: 0 };
  }
  if (size > maxBytes) {
    throw new WorkspaceError(
      "blob_too_large",
      `Blob size ${size} bytes exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
    );
  }

  try {
    const blobArgs = ["cat-file", "blob", target];
    const result = await runVcsProcess("git", blobArgs, () =>
      execHostFileBuffer("git", blobArgs, {
        cwd,
        env: resolveGitProcessEnv({
          env: undefined,
          shellPath: options.shellPath,
        }),
        maxBuffer: maxBytes,
      }),
    );
    const contents = Buffer.from(result.stdout);
    return { contents, sizeBytes: size };
  } catch (error) {
    if (isMaxBufferExceededError(error)) {
      throw new WorkspaceError(
        "blob_too_large",
        `Blob size exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
        { cause: error },
      );
    }

    const execError = toExecError(error);
    const stderr = trimOutput(execError?.stderr?.toString() ?? "");
    throw createGitCommandFailedError(
      ["cat-file", "blob", target],
      stderr,
      error,
    );
  }
}

export async function hasUncommittedChanges(
  cwd: string,
  options: GitProcessOptions = {},
): Promise<boolean> {
  await ensureGitRepo(cwd, options);
  const status = await runGit(
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    { cwd, ...options },
  );
  return status.stdout.trim().length > 0;
}
