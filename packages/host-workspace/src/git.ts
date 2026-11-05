import path from "node:path";
import type { ExecFileException } from "node:child_process";
import { execHostFileBuffer, runVcsProcess } from "@bb/process-utils";
import {
  createGitCommandFailedError,
  ensureGitRepo,
  type GitProcessOptions,
  type GitTimeoutOptions,
  parseOriginHeadBranchName,
  pathExists,
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

function isMissingGitBlobTargetError(stderr: string): boolean {
  return (
    /^fatal: path '.+' does not exist in '.+'$/u.test(stderr) ||
    /^fatal: invalid object name '.+'\.$/u.test(stderr) ||
    /^fatal: Not a valid object name .+$/u.test(stderr)
  );
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
