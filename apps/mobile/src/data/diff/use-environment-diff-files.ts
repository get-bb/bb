import type { WorkspaceDiffTarget } from "@bb/domain";
import type {
  DiffFileEntry,
  EnvironmentDiffFilesResponse,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { environmentDiffFilesQueryKey } from "@/lib/query/query-keys";
import { useEnvironmentDetailRealtimeSubscription } from "../shared/use-realtime-subscription";
import { buildEnvironmentDiffArgs, diffTargetKey } from "./diff-target";

/** Staleness window for the diff table of contents (the web's value). */
const ENVIRONMENT_DIFF_STALE_MS = 5_000;

export interface UseEnvironmentDiffFilesOptions {
  target: WorkspaceDiffTarget;
  enabled?: boolean;
}

const EMPTY_FILES: DiffFileEntry[] = [];

/**
 * `GET /environments/:id/diff/files?target=…`: the diff tab's table of
 * contents — one entry per changed file with its `loadMode` tier, the
 * shortstat, the resolved merge-base sha, and the inline patches for the
 * first screen of `auto` files. Patches for the rest are fetched on demand by
 * `useEnvironmentDiffPatches`. Holds the `environment-detail` realtime
 * subscription so the daemon watches the workspace; `work-status-changed` /
 * `git-refs-changed` invalidate it (and evict the patch cache) through the
 * realtime bridge. A target switch keeps the previous slice on screen as
 * placeholder while the new one loads.
 */
export function useEnvironmentDiffFiles(
  environmentId: string | null | undefined,
  { target, enabled: enabledOption = true }: UseEnvironmentDiffFilesOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = enabledOption && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentDiffFilesResponse>({
    queryKey: environmentDiffFilesQueryKey(
      environmentId ?? "",
      target.type,
      diffTargetKey(target),
    ),
    queryFn: ({ signal }) =>
      sdk.environments.diffFiles({
        ...buildEnvironmentDiffArgs(environmentId ?? "", target),
        signal,
      }),
    enabled,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === environmentId ? previousData : undefined,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: ENVIRONMENT_DIFF_STALE_MS,
  });
}

/** The file entries of an `available` response (empty otherwise). */
export function getDiffFilesFromResponse(
  response: EnvironmentDiffFilesResponse | undefined,
): readonly DiffFileEntry[] {
  return response?.outcome === "available" ? response.files : EMPTY_FILES;
}
