import { access } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { getCurrentBranch, runGit } from "bb-environment-provider-host/git";
import { githubPrStatusHostContract } from "./contract.js";
import {
  prepareCurrentBranchRead,
  prepareUrlRead,
  preparedResult,
  readPullRequests,
  runPullRequestActionForCurrentBranch,
  type PreparedRead,
} from "./host/git-host.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareView({
  path,
  url,
  refresh,
}: {
  path: string;
  url: string | null;
  refresh: boolean;
}): Promise<PreparedRead> {
  if (!(await pathExists(path)))
    return preparedResult({
      outcome: "unavailable",
      message: `Workspace path no longer exists: ${path}`,
    });
  if (url !== null) return prepareUrlRead(url, path);
  const localBranch = await getCurrentBranch(path);
  if (!localBranch) return preparedResult({ outcome: "none" });
  return prepareCurrentBranchRead({ cwd: path, localBranch, refresh });
}

export default experimental_defineHostEntry({
  contract: githubPrStatusHostContract,
  handlers: {
    views({ reads }) {
      return readPullRequests(reads.map(prepareView));
    },
    async upstream({ path }) {
      const [result, branchName] = await Promise.all([
        runGit(["rev-parse", "--verify", "@{u}"], {
          cwd: path,
          allowFailure: true,
        }),
        getCurrentBranch(path),
      ]);
      return {
        oid: result.exitCode === 0 ? result.stdout.trim() : null,
        branchName: branchName ?? null,
      };
    },
    async act({ path, action }) {
      const localBranch = await getCurrentBranch(path);
      if (!localBranch) {
        return {
          ok: false as const,
          message: "Cannot update pull request from a detached workspace",
        };
      }
      return runPullRequestActionForCurrentBranch({
        cwd: path,
        localBranch,
        action,
      });
    },
  },
});
