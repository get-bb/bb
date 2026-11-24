import type { GitSourceInspection } from "@bb/domain";
import type { ProjectBranchesResponse } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

const SEARCH_SOURCE_REUSE_MS = 30_000;

interface ReadProjectBranchesArgs {
  hostId: string;
  path: string;
  query: string | undefined;
  selectedBranch: string | undefined;
  limit: number;
  remoteRefresh: "background" | "blocking";
}

interface CachedSource {
  inspection: GitSourceInspection;
  readAt: number;
}

export type ProjectBranchesReader = (
  deps: AppDeps,
  args: ReadProjectBranchesArgs,
) => Promise<ProjectBranchesResponse>;

export function createProjectBranchesReader(): ProjectBranchesReader {
  const sources = new Map<string, CachedSource>();

  const reusableSource = (
    key: string,
    args: ReadProjectBranchesArgs,
    readAt: number,
  ): GitSourceInspection | null => {
    if (args.remoteRefresh !== "background" || args.query === undefined) {
      return null;
    }
    const cached = sources.get(key);
    return cached !== undefined &&
      readAt - cached.readAt < SEARCH_SOURCE_REUSE_MS
      ? cached.inspection
      : null;
  };

  const rememberSource = (
    key: string,
    inspection: GitSourceInspection,
    readAt: number,
  ) => {
    for (const [cachedKey, cached] of sources) {
      if (readAt - cached.readAt >= SEARCH_SOURCE_REUSE_MS) {
        sources.delete(cachedKey);
      }
    }
    sources.set(key, { inspection, readAt });
  };

  return async (deps, args) => {
    const key = `${args.hostId}\0${args.path}`;
    const readAt = Date.now();
    const reused = reusableSource(key, args, readAt);
    const { source, ...branchOptions } = await callHostRetryableOnlineRpc(
      deps,
      {
        hostId: args.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_branch_options",
          path: args.path,
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.selectedBranch === undefined
            ? {}
            : { selectedBranch: args.selectedBranch }),
          limit: args.limit,
          remoteRefresh: args.remoteRefresh,
          includeSource: reused === null,
        },
      },
    );
    if (source !== null) {
      rememberSource(key, source, readAt);
      return { ...source, ...branchOptions };
    }
    if (reused === null) {
      throw new Error("Host omitted the requested git source inspection");
    }
    return { ...reused, ...branchOptions };
  };
}
