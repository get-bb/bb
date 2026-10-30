import path from "node:path";
import {
  experimental_runVcsProcess as runVcsProcess,
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
  type ExperimentalVcsProcessPriority,
} from "@get-bb/plugin-sdk/host";
import {
  experimental_killPortableProcess as killPortableProcess,
  experimental_spawnPortableProcess as spawnPortableProcess,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  workspaceResolutionFailureCodeSchema,
  type DefaultBranchRelation,
  type WorkspaceResolutionFailure,
} from "./git-types.js";

export const DEFAULT_BUFFER_BYTES = 16 * 1024 * 1024;

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "WorkspaceError";
  }
}

export const WORKSPACE_STATUS_GIT_TIMEOUT_MS = 15_000;

export function isMissingHeadRevisionError(stderr: string): boolean {
  return (
    stderr.includes("ambiguous argument 'HEAD'") ||
    stderr.includes("bad revision 'HEAD'") ||
    stderr.includes("unknown revision or path not in the working tree") ||
    stderr.includes("Needed a single revision")
  );
}

export function workspaceResolutionFailureFromError(
  error: unknown,
  workspacePath: string,
): WorkspaceResolutionFailure {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (code === "EACCES" || code === "EPERM") {
    return {
      code: "permission_denied",
      message: error instanceof Error ? error.message : String(error),
      workspacePath,
    };
  }
  const known = workspaceResolutionFailureCodeSchema.safeParse(code);
  return {
    code: known.success ? known.data : "unknown",
    message:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Unknown workspace resolution failure",
    workspacePath,
  };
}

export interface GitProcessOptions {
  shellPath?: string;
  priority?: ExperimentalVcsProcessPriority;
}

export interface RunGitOptions extends GitProcessOptions {
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  maxBufferBytes?: number;
  allowTruncatedStdout?: boolean;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: Buffer) => boolean;
  input?: string;
}

interface ResolveGitProcessEnvArgs {
  env: NodeJS.ProcessEnv | undefined;
  shellPath: string | undefined;
}

export interface GitTimeoutOptions extends GitProcessOptions {
  timeoutMs?: number;
}

export interface DefaultBranchRefs {
  defaultBranch: string | undefined;
  defaultBranchRelation: DefaultBranchRelation | undefined;
  originDefaultBranch: string | undefined;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PorcelainEntry {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
}

export function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
}

export function resolveGitProcessEnv(
  args: ResolveGitProcessEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...sanitizeInheritedChildProcessEnv({
      env: process.env,
      ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
    }),
    ...args.env,
  };
}

export function createGitCommandTimedOutError(
  args: string[],
  timeoutMs: number,
  cause?: unknown,
): WorkspaceError {
  return new WorkspaceError(
    "git_command_timeout",
    `git ${args.join(" ")} timed out after ${timeoutMs}ms`,
    { cause },
  );
}

export function createGitCommandCancelledError(
  args: string[],
  cause?: unknown,
): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    `git ${args.join(" ")} was cancelled`,
    { cause },
  );
}

export function createGitCommandFailedError(
  args: string[],
  stderr: string,
  cause?: unknown,
): WorkspaceError {
  const detail = stderr ? `: ${stderr}` : "";
  return new WorkspaceError(
    "git_command_failed",
    `git ${args.join(" ")} failed${detail}`,
    { cause },
  );
}

const WINDOWS_STARTUP_CRASH_ATTEMPTS = 3;
const WINDOWS_STARTUP_CRASH_RETRY_DELAY_MS = 150;
const STATUS_DLL_INIT_FAILED = 0xc0000142;
const FORCE_KILL_AFTER_MS = 1_000;
const USES_PROCESS_GROUPS = process.platform !== "win32";

interface GitRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  signaled: boolean;
  overflow: "stdout" | "stderr" | null;
  stopped: boolean;
  timedOut: boolean;
  spawnError: Error | undefined;
}

function maxBufferError(stream: "stdout" | "stderr"): Error {
  return Object.assign(new Error(`${stream} maxBuffer length exceeded`), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  });
}

function spawnGit(args: string[], options: RunGitOptions): Promise<GitRun> {
  return new Promise((resolve) => {
    const maxBuffer = options.maxBufferBytes ?? DEFAULT_BUFFER_BYTES;
    const request = {
      command: "git",
      args,
      cwd: options.cwd,
      detached: USES_PROCESS_GROUPS,
      env: resolveGitProcessEnv({
        env: options.env,
        shellPath: options.shellPath,
      }),
    };
    const child =
      options.input === undefined
        ? spawnPortableOutputProcess(request)
        : spawnPortableProcess({ ...request, stdio: ["pipe", "pipe", "pipe"] });
    const { stdout, stderr } = child;
    if (stdout === null || stderr === null) {
      throw new Error("git did not attach piped output");
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow: GitRun["overflow"] = null;
    let stopped = false;
    let timedOut = false;
    let stopping = false;
    let settled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;

    const signalGit = (signal: NodeJS.Signals): void => {
      if (USES_PROCESS_GROUPS && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {}
      }
      killPortableProcess(child, signal);
    };
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      signalGit("SIGTERM");
      forceKill = setTimeout(() => signalGit("SIGKILL"), FORCE_KILL_AFTER_MS);
    };
    const onAbort = (): void => stop();
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            stop();
          }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (
      exitCode: number,
      signaled: boolean,
      spawnError: Error | undefined,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        signaled,
        overflow,
        stopped,
        timedOut,
        spawnError,
      });
    };

    stdout.on("data", (chunk: Buffer) => {
      if (stopping) return;
      if (options.onStdout !== undefined) {
        if (options.onStdout(chunk)) {
          stopped = true;
          stop();
        }
        return;
      }
      if (stdoutBytes + chunk.length > maxBuffer) {
        stdoutChunks.push(chunk.subarray(0, maxBuffer - stdoutBytes));
        stdoutBytes = maxBuffer;
        overflow = "stdout";
        stop();
        return;
      }
      stdoutBytes += chunk.length;
      stdoutChunks.push(chunk);
    });
    const stderrDecoder = new TextDecoder();
    stderr.on("data", (chunk: Buffer) => {
      if (options.onStderr !== undefined) {
        const text = stderrDecoder.decode(chunk, { stream: true });
        if (text) options.onStderr(text);
      }
      if (overflow !== null) return;
      if (stderrBytes + chunk.length > maxBuffer) {
        overflow = "stderr";
        stop();
        return;
      }
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
    });
    stderr.on("end", () => {
      const text = stderrDecoder.decode();
      if (text) options.onStderr?.(text);
    });
    if (options.input !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(options.input);
    }
    child.on("error", (error) => finish(1, false, error));
    child.on("close", (code, signal) => finish(code ?? 1, signal !== null, undefined));
  });
}

function isWindowsStartupCrash(run: GitRun): boolean {
  return (
    run.exitCode === STATUS_DLL_INIT_FAILED &&
    !run.signaled &&
    run.stdout === "" &&
    run.stderr === ""
  );
}

export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  if (options.signal?.aborted) {
    throw createGitCommandCancelledError(args, options.signal.reason);
  }
  for (let attempt = 1; ; attempt += 1) {
    const run = await runVcsProcess("git", args, () => spawnGit(args, options), {
      priority: options.priority,
      signal: options.signal,
    }).catch((error: unknown) => {
      if (options.signal?.aborted) {
        throw createGitCommandCancelledError(args, error);
      }
      throw error;
    });
    if (run.stopped) {
      return { stdout: run.stdout, stderr: run.stderr, exitCode: 0 };
    }
    if (options.signal?.aborted) {
      throw createGitCommandCancelledError(args, options.signal.reason);
    }
    if (run.timedOut && options.timeoutMs !== undefined) {
      throw createGitCommandTimedOutError(args, options.timeoutMs);
    }
    if (run.overflow === "stdout" && options.allowTruncatedStdout === true) {
      return { stdout: run.stdout, stderr: run.stderr, exitCode: 0 };
    }
    if (
      attempt < WINDOWS_STARTUP_CRASH_ATTEMPTS &&
      run.overflow === null &&
      isWindowsStartupCrash(run)
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, WINDOWS_STARTUP_CRASH_RETRY_DELAY_MS * attempt),
      );
      continue;
    }
    const failure =
      run.spawnError ??
      (run.overflow === null ? undefined : maxBufferError(run.overflow));
    if (failure === undefined && run.exitCode === 0) {
      return { stdout: run.stdout, stderr: run.stderr, exitCode: 0 };
    }
    if (options.allowFailure) {
      return {
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: failure === undefined ? run.exitCode : 1,
      };
    }
    throw createGitCommandFailedError(args, trimOutput(run.stderr), failure);
  }
}

type GitRepoKind = "work-tree" | "bare" | "none";

interface PorcelainV2Status {
  entries: PorcelainEntry[];
  headOid: string | null;
  headBranch: string | null;
}

function porcelainV2StatusLetter(letter: string | undefined): string {
  return letter === undefined || letter === "." ? " " : letter;
}

export function parsePorcelainV2StatusZ(output: string): PorcelainV2Status {
  const records = output.split("\0");
  const entries: PorcelainEntry[] = [];
  let headOid: string | null = null;
  let headBranch: string | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length);
      headOid = oid === "(initial)" ? null : oid;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      headBranch = head === "(detached)" ? null : head;
      continue;
    }
    if (record.startsWith("#")) continue;
    if (record.startsWith("? ")) {
      entries.push({
        path: record.slice(2),
        status: "??",
        indexStatus: "?",
        worktreeStatus: "?",
      });
      continue;
    }
    const kind = record[0];
    const fieldCount =
      kind === "1" ? 8 : kind === "2" ? 9 : kind === "u" ? 10 : null;
    if (fieldCount === null) continue;
    const fields = record.split(" ");
    const indexStatus = porcelainV2StatusLetter(fields[1]?.[0]);
    const worktreeStatus = porcelainV2StatusLetter(fields[1]?.[1]);
    const status = `${indexStatus}${worktreeStatus}`;
    entries.push({
      path: fields.slice(fieldCount).join(" "),
      status: status.trim() || status,
      indexStatus,
      worktreeStatus,
    });
    if (kind === "2") index += 1;
  }
  return { entries, headOid, headBranch };
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

export function parseOriginHeadBranchName(output: string): string | undefined {
  const remoteHead = trimOutput(output);
  if (remoteHead.startsWith("refs/remotes/origin/")) {
    return remoteHead.replace("refs/remotes/origin/", "");
  }
  return undefined;
}

type GitQueryRunner = (
  args: string[],
  options: GitTimeoutOptions & {
    cwd: string;
    allowFailure?: boolean;
    signal?: AbortSignal;
  },
) => Promise<GitCommandResult>;

export function createGitQueries(run: GitQueryRunner) {
  async function detectGitRepoKind(
    cwd: string,
    options: GitTimeoutOptions = {},
  ): Promise<GitRepoKind> {
    const result = await run(
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

  async function detectGitRepo(
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

  async function ensureGitRepo(
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

  async function getCurrentBranch(
    cwd: string,
    options: GitTimeoutOptions = {},
  ): Promise<string | undefined> {
    if (!(await detectGitRepo(cwd, options))) {
      return undefined;
    }

    const result = await run(["symbolic-ref", "--quiet", "--short", "HEAD"], {
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

  async function getGitCommonDir(
    cwd: string,
    options: GitProcessOptions & { signal?: AbortSignal } = {},
  ): Promise<string> {
    const result = await run(["rev-parse", "--git-common-dir"], {
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

  async function hasRef(
    cwd: string,
    ref: string,
    options: GitTimeoutOptions = {},
  ): Promise<boolean> {
    await ensureGitRepo(cwd, options);
    const result = await run(["show-ref", "--verify", "--quiet", ref], {
      cwd,
      ...options,
      allowFailure: true,
    });
    return result.exitCode === 0;
  }

  async function revParseRef(
    cwd: string,
    ref: string,
    options: GitTimeoutOptions = {},
  ): Promise<string | undefined> {
    const result = await run(["rev-parse", "--verify", `${ref}^{commit}`], {
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
    const result = await run(
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

  async function readOriginHeadBranchName(
    cwd: string,
    options: GitTimeoutOptions = {},
  ): Promise<string | undefined> {
    const originHead = await run(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { cwd, ...options, allowFailure: true },
    );
    return parseOriginHeadBranchName(originHead.stdout);
  }

  async function readLocalBranches(
    cwd: string,
    options: GitTimeoutOptions = {},
  ): Promise<string[]> {
    const branches = await run(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { cwd, ...options },
    );
    return branches.stdout
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
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

  async function readBranchRelation(
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

  async function readDefaultBranchRefs(
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

  async function readRepoDefaultBranch(
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

  async function readDefaultBranch(
    cwd: string,
    options: GitTimeoutOptions = {},
  ): Promise<string | undefined> {
    await ensureGitRepo(cwd, options);
    return readRepoDefaultBranch(cwd, options);
  }
  return {
    detectGitRepoKind,
    detectGitRepo,
    detectGitSource,
    ensureGitRepo,
    getCurrentBranch,
    getGitCommonDir,
    hasRef,
    readBranchRelation,
    readOriginHeadBranchName,
    readLocalBranches,
    readDefaultBranchRefs,
    readRepoDefaultBranch,
    readDefaultBranch,
  };
}

export const {
  detectGitRepoKind,
  detectGitRepo,
  detectGitSource,
  ensureGitRepo,
  getCurrentBranch,
  getGitCommonDir,
  hasRef,
  readBranchRelation,
  readOriginHeadBranchName,
  readLocalBranches,
  readDefaultBranchRefs,
  readRepoDefaultBranch,
  readDefaultBranch,
} = createGitQueries(runGit);
