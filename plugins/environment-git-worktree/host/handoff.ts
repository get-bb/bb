import fs from "node:fs/promises";
import {
  getCurrentBranch,
  getGitCommonDir,
  pathExists,
  readGitRepo,
  runGit,
} from "bb-environment-provider-host/git";
import { withGitRefMutationLock } from "bb-environment-provider-host/locks";
import { resolveWorktreeBaseBranch } from "./base-branch.js";
import {
  fetchRemoteBaseBranch,
  isFetchFailureWithFallback,
  resolveRemoteBaseBranch,
} from "./worktree.js";

const HANDOFF_LOCK_TIMEOUT_MS = 2_000;
const REMOTE_BASE_READ_TIMEOUT_MS = 10_000;

function signalOption(signal: AbortSignal | undefined) {
  return signal === undefined ? {} : { signal };
}

async function readCommit(
  cwd: string,
  ref: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const result = await runGit(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { cwd, allowFailure: true, ...signalOption(signal) },
  );
  const commit = result.stdout.trim();
  return result.exitCode === 0 && commit !== "" ? commit : null;
}

export type DefaultBaseState =
  | {
      status: "refreshed";
      ref: string | null;
      commit: string | null;
      members: {
        path: string;
        head: string | null;
        branch: string | null;
        onBase: boolean;
      }[];
    }
  | { status: "no-repository" };

async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const result = await runGit(
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd, allowFailure: true, ...signalOption(signal) },
  );
  return result.exitCode === 0;
}

export async function refreshDefaultBase(args: {
  sourcePath: string;
  memberPaths: readonly string[];
  signal: AbortSignal | undefined;
}): Promise<DefaultBaseState> {
  if (
    !(await pathExists(args.sourcePath)) ||
    (await readGitRepo(args.sourcePath)) === null
  )
    return { status: "no-repository" };
  const base = await resolveWorktreeBaseBranch(args.sourcePath, {
    kind: "default",
  });
  if (base !== null) {
    await fetchRemoteBaseBranch({
      sourcePath: args.sourcePath,
      baseBranch: base.ref,
      fetchFailureFallback: base.fetchFailureFallback,
      onProgress: undefined,
      signal: args.signal,
    });
  }
  const commit =
    base === null
      ? null
      : await readCommit(args.sourcePath, base.ref, args.signal);
  return {
    status: "refreshed",
    ref: base?.ref ?? null,
    commit,
    members: await Promise.all(
      args.memberPaths.map(async (path) => {
        const head = await readCommit(path, "HEAD", args.signal).catch(
          () => null,
        );
        return {
          path,
          head,
          branch: (await getCurrentBranch(path).catch(() => undefined)) ?? null,
          onBase:
            head !== null &&
            commit !== null &&
            (await isAncestor(path, head, commit, args.signal).catch(
              () => false,
            )),
        };
      }),
    ),
  };
}

export interface RemoteBase {
  ref: string;
  commit: string;
  offline: boolean;
}

export async function readRemoteBase(args: {
  sourcePath: string;
  signal: AbortSignal | undefined;
}): Promise<RemoteBase | null> {
  const base = await resolveWorktreeBaseBranch(args.sourcePath, {
    kind: "default",
  });
  if (base === null) return null;
  const local = async (offline: boolean): Promise<RemoteBase | null> => {
    const commit = await readCommit(args.sourcePath, base.ref, args.signal);
    return commit === null ? null : { ref: base.ref, commit, offline };
  };
  const remote = await resolveRemoteBaseBranch(
    args.sourcePath,
    base.ref,
    args.signal,
  );
  if (remote === null) return local(false);
  let listed;
  try {
    listed = await runGit(
      ["ls-remote", remote.remote, `refs/heads/${remote.branch}`],
      {
        cwd: args.sourcePath,
        ...signalOption(args.signal),
        env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        timeoutMs: REMOTE_BASE_READ_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (
      base.fetchFailureFallback &&
      !args.signal?.aborted &&
      isFetchFailureWithFallback(error)
    )
      return local(true);
    throw error;
  }
  const commit = listed.stdout.trim().split(/\s+/, 1)[0] ?? "";
  return /^[0-9a-f]{40,64}$/.test(commit)
    ? { ref: base.ref, commit, offline: false }
    : null;
}

export type PlaceholderState =
  | { status: "intact" }
  | { status: "restored" }
  | { status: "used"; branch: string | null };

async function restorePlaceholderUnlocked(args: {
  sourcePath: string;
  path: string;
  placeholder: string;
  signal: AbortSignal | undefined;
}): Promise<PlaceholderState> {
  const branch = (await getCurrentBranch(args.path)) ?? null;
  if (branch === args.placeholder) return { status: "intact" };
  if (branch === null) return { status: "used", branch };
  const placeholderExists = await runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${args.placeholder}`],
    { cwd: args.path, allowFailure: true, ...signalOption(args.signal) },
  );
  if (placeholderExists.exitCode === 0) return { status: "used", branch };
  const base = await resolveWorktreeBaseBranch(args.sourcePath, {
    kind: "default",
  });
  const [ahead, status] = await Promise.all([
    base === null
      ? Promise.resolve(null)
      : runGit(["rev-list", "--count", `${base.ref}..HEAD`], {
          cwd: args.path,
          allowFailure: true,
          ...signalOption(args.signal),
        }),
    runGit(["status", "--porcelain"], {
      cwd: args.path,
      ...signalOption(args.signal),
    }),
  ]);
  await runGit(["branch", "-m", branch, args.placeholder], {
    cwd: args.path,
    ...signalOption(args.signal),
  });
  const unused =
    ahead !== null &&
    ahead.exitCode === 0 &&
    ahead.stdout.trim() === "0" &&
    status.stdout.trim() === "";
  return unused ? { status: "restored" } : { status: "used", branch };
}

export async function restorePoolMember(args: {
  sourcePath: string;
  path: string;
  placeholder: string;
  signal: AbortSignal | undefined;
}): Promise<PlaceholderState> {
  return withGitRefMutationLock(
    await getGitCommonDir(args.path),
    () => restorePlaceholderUnlocked(args),
    signalOption(args.signal),
  );
}

export type PoolMemberCheck =
  | { status: "usable"; head: string }
  | { status: "refused"; reason: string }
  | { status: "busy" };

export async function checkPoolMember(args: {
  sourcePath: string;
  path: string;
  placeholder: string;
  baseBranch: string;
  baseCommit: string;
  signal: AbortSignal | undefined;
}): Promise<PoolMemberCheck> {
  if ((await readCommit(args.path, args.baseCommit, args.signal)) === null) {
    const base = await resolveWorktreeBaseBranch(args.sourcePath, {
      kind: "default",
    });
    if (base !== null)
      await fetchRemoteBaseBranch({
        sourcePath: args.sourcePath,
        baseBranch: base.ref,
        fetchFailureFallback: base.fetchFailureFallback,
        onProgress: undefined,
        signal: args.signal,
      });
    if ((await readCommit(args.path, args.baseCommit, args.signal)) === null)
      return {
        status: "refused",
        reason: `${args.baseBranch} is not at the commit the remote reported`,
      };
  }
  let locked = false;
  try {
    return await withGitRefMutationLock(
      await getGitCommonDir(args.path),
      async (): Promise<PoolMemberCheck> => {
        locked = true;
        const placeholder = await restorePlaceholderUnlocked({
          sourcePath: args.sourcePath,
          path: args.path,
          placeholder: args.placeholder,
          signal: args.signal,
        });
        if (placeholder.status === "used")
          return {
            status: "refused",
            reason: `it was used on ${placeholder.branch ?? "a detached HEAD"}`,
          };
        const head = await readCommit(args.path, "HEAD", args.signal);
        if (head === null)
          return { status: "refused", reason: "the worktree has no commit" };
        if (
          head !== args.baseCommit &&
          !(await isAncestor(args.path, head, args.baseCommit, args.signal))
        )
          return {
            status: "refused",
            reason: `it is not on ${args.baseBranch}`,
          };
        return { status: "usable", head };
      },
      { ...signalOption(args.signal), timeoutMs: HANDOFF_LOCK_TIMEOUT_MS },
    );
  } catch (error) {
    if (!locked && !args.signal?.aborted) return { status: "busy" };
    throw error;
  }
}

export async function nameHandedOffBranch(args: {
  path: string;
  fromBranch: string;
  toBranch: string;
  completionPath: string;
  signal: AbortSignal | undefined;
}): Promise<void> {
  await withGitRefMutationLock(
    await getGitCommonDir(args.path),
    async () => {
      await fs.writeFile(args.completionPath, `${args.toBranch}\n`, "utf8");
      await runGit(["branch", "-m", args.fromBranch, args.toBranch], {
        cwd: args.path,
        ...signalOption(args.signal),
      });
    },
    signalOption(args.signal),
  );
}

export async function fastForwardWorktree(args: {
  path: string;
  commit: string;
  signal: AbortSignal | undefined;
}): Promise<void> {
  await runGit(["merge", "--ff-only", "--quiet", args.commit], {
    cwd: args.path,
    ...signalOption(args.signal),
    env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
}
