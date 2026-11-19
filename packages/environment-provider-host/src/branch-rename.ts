import path from "node:path";
import { runGit, type RunGitOptions } from "./git.js";
import { withWorktreeMetadataLock } from "./locks.js";

export type CheckedOutBranchRename =
  | { status: "renamed" }
  | { status: "kept"; reason: string };

export async function renameCheckedOutBranch(args: {
  path: string;
  from: string;
  to: string;
  signal?: AbortSignal | undefined;
}): Promise<CheckedOutBranchRename> {
  const options: RunGitOptions = {
    cwd: args.path,
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  };
  const commonDir = await runGit(["rev-parse", "--git-common-dir"], options);
  return withWorktreeMetadataLock(
    path.resolve(args.path, commonDir.stdout.trim()),
    async (): Promise<CheckedOutBranchRename> => {
      const head = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
        ...options,
        allowFailure: true,
      });
      const headRef = head.exitCode === 0 ? head.stdout.trim() : null;
      if (headRef === `refs/heads/${args.to}`) return { status: "renamed" };
      if (headRef !== `refs/heads/${args.from}`) {
        return {
          status: "kept",
          reason: `The workspace is no longer on ${args.from}.`,
        };
      }
      const valid = await runGit(["check-ref-format", "--branch", args.to], {
        ...options,
        allowFailure: true,
      });
      if (valid.exitCode !== 0) {
        return {
          status: "kept",
          reason: `${args.to} is not a valid branch name.`,
        };
      }
      const upstream = await runGit(
        [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          `${args.from}@{upstream}`,
        ],
        { ...options, allowFailure: true },
      );
      if (upstream.exitCode === 0) {
        return {
          status: "kept",
          reason: `${args.from} tracks ${upstream.stdout.trim()}.`,
        };
      }
      const remoteRefs = await runGit(
        ["for-each-ref", "--format=%(refname)", "refs/remotes/"],
        options,
      );
      if (
        remoteRefs.stdout
          .split("\n")
          .some((ref) => ref.endsWith(`/${args.from}`))
      ) {
        return {
          status: "kept",
          reason: `${args.from} was already pushed.`,
        };
      }
      const target = await runGit(
        ["show-ref", "--verify", "--quiet", `refs/heads/${args.to}`],
        { ...options, allowFailure: true },
      );
      if (target.exitCode === 0) {
        return { status: "kept", reason: `${args.to} already exists.` };
      }
      await runGit(["branch", "-m", args.from, args.to], options);
      return { status: "renamed" };
    },
    args.signal,
  );
}
