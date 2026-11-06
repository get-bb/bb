import { access } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { getCurrentBranch, runGit } from "bb-environment-provider-host/git";
import { githubPrStatusHostContract, type HostRefs } from "./contract.js";
import {
  prepareCurrentBranchRead,
  prepareUrlRead,
  preparedResult,
  readPullRequests,
  runPullRequestAction,
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

async function readRefs(path: string): Promise<HostRefs> {
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
}

type PreparedView = { read: PreparedRead; refs: HostRefs | null };

async function prepareView({
  path,
  known,
  refresh,
}: {
  path: string;
  known: { url: string; branchName: string | null } | null;
  refresh: boolean;
}): Promise<PreparedView> {
  if (!(await pathExists(path)))
    return {
      read: preparedResult({
        outcome: "unavailable",
        message: `Workspace path no longer exists: ${path}`,
      }),
      refs: null,
    };
  let refs: HostRefs;
  try {
    refs = await readRefs(path);
  } catch (error) {
    return {
      read: preparedResult({
        outcome: "unavailable",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Could not read the workspace branch",
      }),
      refs: null,
    };
  }
  if (known !== null && known.branchName === refs.branchName)
    return { read: await prepareUrlRead(known.url, path), refs };
  if (refs.branchName === null)
    return { read: preparedResult({ outcome: "none" }), refs };
  return {
    read: await prepareCurrentBranchRead({
      cwd: path,
      localBranch: refs.branchName,
      refresh,
    }),
    refs,
  };
}

export default experimental_defineHostEntry({
  contract: githubPrStatusHostContract,
  handlers: {
    async views({ reads }) {
      const prepared = reads.map(prepareView);
      const lookups = await readPullRequests(
        prepared.map((view) => view.then(({ read }) => read)),
      );
      const views = await Promise.all(prepared);
      return views.map((view, index) => ({
        lookup: lookups[index]!,
        refs: view.refs,
      }));
    },
    upstream: ({ path }) => readRefs(path),
    act({ path, url, action }) {
      return runPullRequestAction({ cwd: path, url, action });
    },
  },
});
