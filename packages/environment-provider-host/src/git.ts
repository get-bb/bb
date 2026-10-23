import {
  experimental_runVcsProcess as runVcsProcess,
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
} from "@get-bb/plugin-sdk/host";
import path from "node:path";
import fs from "node:fs/promises";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const USES_PROCESS_GROUPS = process.platform !== "win32";

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "WorkspaceError";
  }
}

export interface GitProcessOptions {
  shellPath?: string;
}

interface GitTimeoutOptions extends GitProcessOptions {
  timeoutMs?: number;
}

export interface RunGitOptions extends GitProcessOptions {
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitRepositoryState = "not_git" | "no_commits" | "has_commits";

export type DefaultBranchRelation =
  | "equal"
  | "local-behind"
  | "local-ahead"
  | "diverged"
  | "unknown";

export type GitCheckoutRef =
  | { kind: "branch"; branchName: string; headSha: string }
  | { kind: "detached"; headSha: string }
  | { kind: "unborn"; branchName: string }
  | { kind: "unknown"; reason: string };

export interface DefaultBranchRefs {
  defaultBranch: string | undefined;
  defaultBranchRelation: DefaultBranchRelation | undefined;
  originDefaultBranch: string | undefined;
}

type GitRepoKind = "work-tree" | "bare" | "none";

interface GitOutputBuffer {
  append: (chunk: Buffer) => boolean;
  read: () => string;
}

function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
}

function describeCommand(args: string[]): string {
  return `git ${args.join(" ")}`;
}

function createGitCommandCancelledError(
  args: string[],
  cause?: unknown,
): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    `${describeCommand(args)} was cancelled`,
    { cause },
  );
}

function createGitCommandFailedError(
  args: string[],
  stderr: string,
  cause?: unknown,
): WorkspaceError {
  const detail = stderr ? `: ${stderr}` : "";
  return new WorkspaceError(
    "git_command_failed",
    `${describeCommand(args)} failed${detail}`,
    { cause },
  );
}

function resolveGitProcessEnv(options: RunGitOptions): NodeJS.ProcessEnv {
  return {
    ...sanitizeInheritedChildProcessEnv({
      env: process.env,
      ...(options.shellPath !== undefined
        ? { shellPath: options.shellPath }
        : {}),
    }),
    ...options.env,
  };
}

function createGitOutputBuffer(): GitOutputBuffer {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    append(chunk: Buffer): boolean {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        return false;
      }
      chunks.push(chunk);
      return true;
    },
    read(): string {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

export function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  if (options.signal?.aborted) {
    return Promise.reject(
      createGitCommandCancelledError(args, options.signal.reason),
    );
  }

  return runVcsProcess("git", args, () => runGitAdmitted(args, options), {
    signal: options.signal,
    priority: "background",
  }).catch((error: unknown) => {
    if (options.signal?.aborted)
      throw createGitCommandCancelledError(args, error);
    throw error;
  });
}

function runGitAdmitted(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  return new Promise<GitCommandResult>((resolve, reject) => {
    const stdout = createGitOutputBuffer();
    const stderr = createGitOutputBuffer();
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const child = spawnPortableOutputProcess({
      command: "git",
      args,
      cwd: options.cwd,
      detached: USES_PROCESS_GROUPS,
      env: resolveGitProcessEnv(options),
    });

    const signalGit = (signal: NodeJS.Signals): void => {
      if (USES_PROCESS_GROUPS && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {}
      }
      child.kill(signal);
    };

    const onAbort = (): void => {
      signalGit("SIGTERM");
    };

    const release = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: WorkspaceError): void => {
      if (settled) {
        return;
      }
      settled = true;
      release();
      reject(error);
    };

    const succeed = (result: GitCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      release();
      resolve(result);
    };

    const readInto = (buffer: GitOutputBuffer) => {
      return (chunk: Buffer): void => {
        if (!buffer.append(chunk)) {
          overflowed = true;
          signalGit("SIGKILL");
        }
      };
    };

    child.stdout.on("data", readInto(stdout));
    child.stderr.on("data", readInto(stderr));

    child.on("error", (error) => {
      if (options.signal?.aborted) {
        fail(createGitCommandCancelledError(args, error));
        return;
      }
      if (options.allowFailure === true) {
        succeed({ stdout: "", stderr: "", exitCode: 1 });
        return;
      }
      fail(createGitCommandFailedError(args, "", error));
    });

    child.on("close", (code) => {
      if (options.signal?.aborted) {
        fail(createGitCommandCancelledError(args, options.signal.reason));
        return;
      }
      if (timedOut) {
        fail(
          new WorkspaceError(
            "git_command_timeout",
            `${describeCommand(args)} timed out after ${options.timeoutMs}ms`,
          ),
        );
        return;
      }
      if (overflowed) {
        fail(
          new WorkspaceError(
            "git_command_failed",
            `${describeCommand(args)} produced more than ${MAX_OUTPUT_BYTES} bytes of output`,
          ),
        );
        return;
      }
      const result: GitCommandResult = {
        stdout: stdout.read(),
        stderr: stderr.read(),
        exitCode: code ?? 1,
      };
      if (result.exitCode === 0 || options.allowFailure === true) {
        succeed(result);
        return;
      }
      fail(createGitCommandFailedError(args, trimOutput(result.stderr)));
    });

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        signalGit("SIGTERM");
      }, options.timeoutMs);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function getGitCommonDir(
  cwd: string,
  options: GitProcessOptions & { signal?: AbortSignal } = {},
): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], {
    cwd,
    ...options,
  });
  const commonDir = result.stdout.trim();
  if (!commonDir) {
    throw new WorkspaceError(
      "git_command_failed",
      `git rev-parse --git-common-dir returned no path for ${cwd}`,
    );
  }
  return path.resolve(cwd, commonDir);
}

export async function detectGitRepoKind(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<GitRepoKind> {
  const result = await runGit(
    ["rev-parse", "--is-inside-work-tree", "--is-bare-repository"],
    { cwd, ...options, allowFailure: true },
  );
  if (result.exitCode !== 0) {
    return "none";
  }
  const [insideWorkTree, bare] = trimOutput(result.stdout).split("\n");
  if (insideWorkTree === "true") {
    return "work-tree";
  }
  if (bare === "true") {
    return "bare";
  }
  return "none";
}

export async function detectGitRepo(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<boolean> {
  return (await detectGitRepoKind(cwd, options)) === "work-tree";
}

async function detectGitSource(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<boolean> {
  return (await detectGitRepoKind(cwd, options)) !== "none";
}

export async function ensureGitRepo(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<void> {
  if (await detectGitSource(cwd, options)) {
    return;
  }

  throw new WorkspaceError(
    "not_git_repo",
    `Path is not a git repository: ${cwd}`,
  );
}

export async function readGitRepositoryState(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<GitRepositoryState> {
  if (!(await detectGitSource(cwd, options))) {
    return "not_git";
  }
  const result = await runGit(["rev-list", "--all", "--max-count=1"], {
    cwd,
    ...options,
  });
  return trimOutput(result.stdout).length > 0 ? "has_commits" : "no_commits";
}

export async function getCurrentBranch(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  if (!(await detectGitRepo(cwd, options))) {
    return undefined;
  }
  return readCurrentBranchName(cwd, options);
}

export async function readCurrentBranchName(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return undefined;
  }

  const branchName = trimOutput(result.stdout);
  return branchName || undefined;
}

export async function readLocalBranches(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string[]> {
  const branches = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd, ...options },
  );
  return branches.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function hasRef(
  cwd: string,
  ref: string,
  options: GitTimeoutOptions = {},
): Promise<boolean> {
  await ensureGitRepo(cwd, options);
  const result = await runGit(["show-ref", "--verify", "--quiet", ref], {
    cwd,
    ...options,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

export async function findWorktreeForBranch(
  cwd: string,
  branchName: string,
  options: GitTimeoutOptions = {},
): Promise<string | null> {
  await ensureGitRepo(cwd, options);
  const result = await runGit(["worktree", "list", "--porcelain"], {
    cwd,
    ...options,
  });
  let worktreePath: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (
      line === `branch refs/heads/${branchName}` &&
      worktreePath !== null
    ) {
      return worktreePath;
    }
  }
  return null;
}

export function resolvePreferredLocalDefaultBranch(
  localBranches: readonly string[],
  originDefaultBranchName: string | undefined,
): string | undefined {
  if (
    originDefaultBranchName &&
    localBranches.includes(originDefaultBranchName)
  ) {
    return originDefaultBranchName;
  }
  if (localBranches.includes("main")) {
    return "main";
  }
  if (localBranches.includes("master")) {
    return "master";
  }
  return localBranches[0];
}

export async function readOriginHeadBranchName(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const originHead = await runGit(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    { cwd, ...options, allowFailure: true },
  );
  return parseOriginHeadBranchName(originHead.stdout);
}

async function readOriginDefaultBranch(
  cwd: string,
  localDefaultBranch: string | undefined,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const originHeadBranch = await readOriginHeadBranchName(cwd, options);
  if (
    originHeadBranch &&
    (await hasRef(cwd, `refs/remotes/origin/${originHeadBranch}`, options))
  ) {
    return `origin/${originHeadBranch}`;
  }

  if (
    localDefaultBranch &&
    (await hasRef(cwd, `refs/remotes/origin/${localDefaultBranch}`, options))
  ) {
    return `origin/${localDefaultBranch}`;
  }

  return undefined;
}

async function revParseRef(
  cwd: string,
  ref: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const result = await runGit(["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return trimOutput(result.stdout) || undefined;
}

async function isAncestorRef(
  cwd: string,
  ancestorRef: string,
  descendantRef: string,
  options: GitTimeoutOptions = {},
): Promise<boolean | undefined> {
  const result = await runGit(
    ["merge-base", "--is-ancestor", ancestorRef, descendantRef],
    { cwd, ...options, allowFailure: true },
  );
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  return undefined;
}

export async function readBranchRelation(
  cwd: string,
  localDefaultBranch: string | undefined,
  originDefaultBranch: string | undefined,
  options: GitTimeoutOptions = {},
): Promise<DefaultBranchRelation | undefined> {
  if (!localDefaultBranch || !originDefaultBranch) {
    return undefined;
  }

  const localRef = `refs/heads/${localDefaultBranch}`;
  const originRef = `refs/remotes/${originDefaultBranch}`;
  const [localSha, originSha] = await Promise.all([
    revParseRef(cwd, localRef, options),
    revParseRef(cwd, originRef, options),
  ]);
  if (!localSha || !originSha) {
    return "unknown";
  }
  if (localSha === originSha) {
    return "equal";
  }

  const localIsAncestor = await isAncestorRef(
    cwd,
    localRef,
    originRef,
    options,
  );
  if (localIsAncestor === true) {
    return "local-behind";
  }
  if (localIsAncestor === undefined) {
    return "unknown";
  }

  const originIsAncestor = await isAncestorRef(
    cwd,
    originRef,
    localRef,
    options,
  );
  if (originIsAncestor === true) {
    return "local-ahead";
  }
  if (originIsAncestor === undefined) {
    return "unknown";
  }

  return "diverged";
}

export async function readDefaultBranchRefs(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<DefaultBranchRefs> {
  await ensureGitRepo(cwd, options);
  const originHeadBranch = await readOriginHeadBranchName(cwd, options);
  const localBranches = await readLocalBranches(cwd, options);
  const defaultBranch = resolvePreferredLocalDefaultBranch(
    localBranches,
    originHeadBranch,
  );
  const originDefaultBranch = await readOriginDefaultBranch(
    cwd,
    defaultBranch,
    options,
  );
  const defaultBranchRelation = await readBranchRelation(
    cwd,
    defaultBranch,
    originDefaultBranch,
    options,
  );

  return {
    defaultBranch,
    defaultBranchRelation,
    originDefaultBranch,
  };
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
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
  const [resolvedGitDir, resolvedCommonDir] = await Promise.all([
    fs.realpath(path.resolve(cwd, gitDir)),
    fs.realpath(path.resolve(cwd, commonDir)),
  ]);
  return {
    isGitRepo,
    isWorktree: isGitRepo && resolvedGitDir !== resolvedCommonDir,
  };
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

export async function detectLinkedWorktree(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<boolean> {
  return (await inspectGitRepository(cwd, options)).isWorktree;
}

export interface WorkTreeLocation {
  root: string;
  workspacePrefix: string;
}

export async function readWorkTreeLocation(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<WorkTreeLocation | null> {
  const result = await runGit(
    ["rev-parse", "--show-toplevel", "--show-prefix"],
    {
      cwd,
      ...options,
      allowFailure: true,
    },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  const output = result.stdout.replace(/\r?\n$/u, "");
  const separator = output.lastIndexOf("\n");
  const root = output.slice(0, separator).replace(/\r$/u, "");
  if (separator < 0 || !root) {
    return null;
  }
  return {
    root: path.resolve(root),
    workspacePrefix: output.slice(separator + 1),
  };
}

export function parseOriginHeadBranchName(output: string): string | undefined {
  const remoteHead = trimOutput(output);
  if (remoteHead.startsWith("refs/remotes/origin/")) {
    return remoteHead.replace("refs/remotes/origin/", "");
  }
  return undefined;
}

export async function readRepoDefaultBranch(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const originHeadBranch = await readOriginHeadBranchName(cwd, options);
  if (originHeadBranch !== undefined) {
    return originHeadBranch;
  }
  return resolvePreferredLocalDefaultBranch(
    await readLocalBranches(cwd, options),
    undefined,
  );
}
