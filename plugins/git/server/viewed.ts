import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkspaceDiffTarget } from "../contract.js";
import type { DiffViewedFile } from "@bb/server-contract";

export interface GitViewed {
  list(
    environmentId: string,
    target: WorkspaceDiffTarget,
    paths: string[] | undefined,
  ): Promise<{ files: DiffViewedFile[] }>;
  mark(
    environmentId: string,
    target: WorkspaceDiffTarget,
    path: string,
    revision: string,
  ): Promise<{ ok: true }>;
  clear(
    environmentId: string,
    target: WorkspaceDiffTarget,
    path: string | undefined,
  ): Promise<{ ok: true }>;
}

function diffQuery(target: WorkspaceDiffTarget) {
  switch (target.type) {
    case "uncommitted":
      return { target: "uncommitted" as const };
    case "branch_committed":
    case "all":
      return { target: target.type, mergeBaseBranch: target.mergeBaseBranch };
    case "commit":
      return { target: "commit" as const, sha: target.sha };
  }
}

export function createGitViewed(bb: BbPluginApi): GitViewed {
  const environments = bb.sdk.environments;
  return {
    list: (environmentId, target, paths) =>
      environments.experimental_diffViewed({
        environmentId,
        ...diffQuery(target),
        ...(paths === undefined ? {} : { paths }),
      }),
    mark: (environmentId, target, path, revision) =>
      environments.experimental_markDiffViewed({
        environmentId,
        target,
        path,
        revision,
      }),
    clear: (environmentId, target, path) =>
      environments.experimental_clearDiffViewed({
        environmentId,
        target,
        ...(path === undefined ? {} : { path }),
      }),
  };
}
