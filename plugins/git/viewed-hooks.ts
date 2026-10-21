import {
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { WorkspaceDiffTarget } from "bb-git-contract";
import { toast } from "sonner";
import { gitRpcContract } from "./contract.js";
export function useEnvironmentDiffViewed(
  environmentId: string,
  options: {
    target?: WorkspaceDiffTarget;
    enabled: boolean;
    paths: readonly string[];
  },
) {
  return experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "viewed",
    input: {
      environmentId,
      target: options.target ?? { type: "uncommitted" },
      paths: [...new Set(options.paths)].sort(),
    },
    enabled:
      Boolean(environmentId) &&
      options.enabled &&
      options.target !== undefined &&
      options.paths.length > 0,
  });
}
export function useSetDiffFileViewed(
  environmentId: string,
  target: WorkspaceDiffTarget,
  paths: readonly string[],
) {
  const input = { environmentId, target, paths: [...new Set(paths)].sort() };
  const mutation = experimental_useRpcMutation({
    contract: gitRpcContract,
    method: "setViewed",
    optimistic(request, cache) {
      cache.update("viewed", input, (data) => ({
        files: [
          ...data.files.filter((file) => file.path !== request.path),
          ...(request.viewed
            ? [{ path: request.path, revision: request.revision }]
            : []),
        ],
      }));
    },
  });
  return {
    ...mutation,
    mutate(request: Parameters<typeof mutation.mutate>[0]) {
      void mutation
        .mutate(request)
        .catch(() => toast.error("Failed to update Viewed."));
    },
  };
}
