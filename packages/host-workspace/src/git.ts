import { createHash } from "node:crypto";
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
): Promise<{
  isGitRepo: boolean;
  isWorktree: boolean;
  gitCommonDir: string | null;
}> {
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
  if (result.exitCode !== 0)
    return { isGitRepo: false, isWorktree: false, gitCommonDir: null };
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
  const gitCommonDir = path.resolve(cwd, commonDir);
  return {
    isGitRepo,
    isWorktree: isGitRepo && path.resolve(cwd, gitDir) !== gitCommonDir,
    gitCommonDir: isGitRepo ? gitCommonDir : null,
  };
}

export interface SharedGitRefsSnapshot {
  defaultBranch: string | null;
  branchNamesFingerprint: string;
  fingerprintFor(refs: {
    branchName: string | null;
    mergeBaseBranch: string | null;
  }): string;
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
      "--format=%(refname)%00%(objectname)%00%(symref)%00%(upstream)%00%(push)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd, ...options },
  );
  const refRecords = new Map<
    string,
    { oid: string; upstream: string; push: string }
  >();
  const names = createHash("sha1");
  const localBranches: string[] = [];
  let listedOriginHead: string | undefined;
  for (const line of refs.stdout.split("\n")) {
    if (line.length === 0) continue;
    const [name = "", oid = "", symref = "", upstream = "", push = ""] =
      line.split("\0");
    refRecords.set(name, { oid, upstream, push });
    names.update(`${name}\0`);
    if (name === "refs/remotes/origin/HEAD") listedOriginHead = symref;
    if (name.startsWith("refs/heads/"))
      localBranches.push(name.slice("refs/heads/".length));
  }
  let originHead = listedOriginHead;
  if (originHead === undefined) {
    const remoteHead = await runGit(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { cwd, ...options, allowFailure: true },
    );
    originHead = remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : "";
  }
  const defaultBranch =
    parseOriginHeadBranchName(originHead) ??
    resolvePreferredLocalDefaultBranch(localBranches, undefined) ??
    null;
  return {
    defaultBranch,
    branchNamesFingerprint: names.digest("hex"),
    fingerprintFor({ branchName, mergeBaseBranch }) {
      const watched = new Set(["refs/remotes/origin/HEAD"]);
      if (originHead) watched.add(originHead);
      if (mergeBaseBranch !== null) {
        if (mergeBaseBranch.startsWith("refs/")) {
          watched.add(mergeBaseBranch);
        } else {
          watched.add(`refs/heads/${mergeBaseBranch}`);
          watched.add(`refs/remotes/${mergeBaseBranch}`);
        }
      }
      if (defaultBranch !== null) {
        watched.add(`refs/heads/${defaultBranch}`);
        watched.add(`refs/remotes/origin/${defaultBranch}`);
      }
      if (branchName !== null) {
        const head = `refs/heads/${branchName}`;
        watched.add(head);
        const record = refRecords.get(head);
        if (record?.upstream) watched.add(record.upstream);
        if (record?.push) watched.add(record.push);
        const remoteSuffix = `/${branchName}`;
        for (const name of refRecords.keys()) {
          if (name.startsWith("refs/remotes/") && name.endsWith(remoteSuffix))
            watched.add(name);
        }
      }
      return JSON.stringify({
        remoteHead: originHead,
        refs: [...watched]
          .sort()
          .map((name) => [name, refRecords.get(name)?.oid ?? null]),
      });
    },
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
