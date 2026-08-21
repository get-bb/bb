import type { ThreadStorageFileListResponse } from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { threadStorageFilesQueryKey } from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import { REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY } from "../shared/query-policies";
import { useThreadDetailRealtimeSubscription } from "../shared/use-realtime-subscription";

const DEFAULT_THREAD_STORAGE_FILE_LIST_LIMIT = 1000;

export interface ThreadStorageFilesOptions {
  limit?: number;
  query?: string | null;
  enabled?: boolean;
}

/**
 * `GET /threads/:id/thread-storage/files`: the flat file list under the
 * thread's storage directory plus its absolute `storageRootPath` (which the
 * local-file-link router needs). Realtime `thread-storage-changed` refreshes
 * it; a mount establishes a fresh baseline.
 */
export function useThreadStorageFiles(
  threadId: string | null | undefined,
  options: ThreadStorageFilesOptions = {},
) {
  const { sdk } = useProfileClient();
  const limit = options.limit ?? DEFAULT_THREAD_STORAGE_FILE_LIST_LIMIT;
  const query = options.query?.trim() ?? "";
  const enabled = (options.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId ?? undefined, { enabled });
  return useQuery<ThreadStorageFileListResponse>({
    queryKey: threadStorageFilesQueryKey(threadId ?? "", query, limit),
    queryFn: ({ signal }) =>
      sdk.threads.storageFiles({
        threadId: requireEnabledQueryArg({
          value: threadId,
          hookName: "useThreadStorageFiles",
          argName: "threadId",
        }),
        limit: String(limit),
        ...(query.length > 0 ? { query } : {}),
        signal,
      }),
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}
