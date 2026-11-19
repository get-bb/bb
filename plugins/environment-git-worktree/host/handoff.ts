import fs from "node:fs/promises";
import {
  getCurrentBranch,
  getGitCommonDir,
  runGit,
} from "bb-environment-provider-host/git";
import { withGitRefMutationLock } from "bb-environment-provider-host/locks";
import { resolveWorktreeBaseBranch } from "./base-branch.js";
import { fetchRemoteBaseBranch } from "./worktree.js";

const HANDOFF_LOCK_TIMEOUT_MS = 2_000;

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

export interface DefaultBaseState {
  ref: string | null;
  commit: string | null;
  members: { path: string; head: string | null; branch: string | null }[];
}

export async function refreshDefaultBase(args: {
  sourcePath: string;
  memberPaths: readonly string[];
  signal: AbortSignal | undefined;
}): Promise<DefaultBaseState> {
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
  return {
    ref: base?.ref ?? null,
    commit:
      base === null
        ? null
        : await readCommit(args.sourcePath, base.ref, args.signal),
    members: await Promise.all(
      args.memberPaths.map(async (path) => ({
        path,
        head: await readCommit(path, "HEAD", args.signal).catch(() => null),
        branch: (await getCurrentBranch(path).catch(() => undefined)) ?? null,
      })),
    ),
  };
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

export type HandOffResult =
  | { status: "handed-off"; baseBranch: string }
  | { status: "refused"; reason: string }
  | { status: "busy" };

export async function handOffWorktree(args: {
  sourcePath: string;
  path: string;
  fromBranch: string;
  toBranch: string;
  completionPath: string;
  signal: AbortSignal | undefined;
}): Promise<HandOffResult> {
  const base = await resolveWorktreeBaseBranch(args.sourcePath, {
    kind: "default",
  });
  if (base === null)
    return { status: "refused", reason: "the default base is unknown" };
  let locked = false;
  try {
    return await withGitRefMutationLock(
      await getGitCommonDir(args.path),
      async (): Promise<HandOffResult> => {
        locked = true;
        const placeholder = await restorePlaceholderUnlocked({
          sourcePath: args.sourcePath,
          path: args.path,
          placeholder: args.fromBranch,
          signal: args.signal,
        });
        if (placeholder.status === "used")
          return {
            status: "refused",
            reason: `it was used on ${placeholder.branch ?? "a detached HEAD"}`,
          };
        const [baseCommit, head] = await Promise.all([
          readCommit(args.sourcePath, base.ref, args.signal),
          readCommit(args.path, "HEAD", args.signal),
        ]);
        if (head === null || baseCommit === null)
          return { status: "refused", reason: "the worktree has no commit" };
        if (head !== baseCommit)
          return { status: "refused", reason: `it is behind ${base.ref}` };
        await runGit(["branch", "-m", args.fromBranch, args.toBranch], {
          cwd: args.path,
          ...signalOption(args.signal),
        });
        try {
          await fs.writeFile(args.completionPath, `${args.toBranch}\n`, "utf8");
        } catch (error) {
          await runGit(["branch", "-m", args.toBranch, args.fromBranch], {
            cwd: args.path,
          });
          throw error;
        }
        return { status: "handed-off", baseBranch: base.ref };
      },
      { ...signalOption(args.signal), timeoutMs: HANDOFF_LOCK_TIMEOUT_MS },
    );
  } catch (error) {
    if (!locked && !args.signal?.aborted) return { status: "busy" };
    throw error;
  }
}
