import type { EnvironmentFilePreviewSource } from "@bb/client-core";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  environmentFilePreviewQueryKey,
  projectFilePreviewQueryKey,
  threadHostFilePreviewQueryKey,
  threadStorageFilePreviewQueryKey,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import {
  EXPENSIVE_MANUAL_QUERY_POLICY,
  HEAVY_PAYLOAD_QUERY_POLICY,
  REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
} from "../shared/query-policies";
import {
  useEnvironmentDetailRealtimeSubscription,
  useThreadDetailRealtimeSubscription,
} from "../shared/use-realtime-subscription";
import {
  buildEnvironmentDiffFileContentUrl,
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
  type ProjectFileRouting,
} from "./file-content-urls";
import {
  buildEnvironmentFilePreview,
  buildEnvironmentFilePreviewQuery,
  environmentFilePreviewSourceKey,
  loadFilePreview,
  type LoadedFilePreview,
} from "./file-preview-fetch";
import { getFileName } from "./file-preview-model";

/**
 * File content queries behind the preview screen / panel tab (mirror of the
 * web's `useEnvironmentFilePreview`, `useThreadStorageFilePreview`,
 * `useThreadHostFilePreview`, `useProjectFilePreview`). Binary routes are
 * read with the profile-aware fetch (app-surface header; the cookie jar is
 * native) and classified by `buildFilePreview`; the workspace source goes
 * through `sdk.environments.diffFile` so a deleted / merge-base side can be
 * read too. Heavy payloads: evicted a minute after the last observer leaves.
 */

interface QueryOptions {
  enabled?: boolean;
}

function useContentFetch(): typeof fetch {
  // The profile's fetch: app-surface header + 401/403 reporting to the
  // session scheduler (the cookie jar itself is native).
  return useProfileClient().fetch;
}

/** A workspace file at `source` (working tree / HEAD / merge base) through `/diff/file`. */
export function useWorkspaceFilePreview(
  environmentId: string | null | undefined,
  path: string | null,
  source: EnvironmentFilePreviewSource | null,
  options?: QueryOptions,
) {
  const { sdk, serverUrl } = useProfileClient();
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(environmentId) &&
    Boolean(path) &&
    source !== null;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<LoadedFilePreview>({
    queryKey: environmentFilePreviewQueryKey(
      environmentId ?? "",
      path ?? "",
      source === null ? "" : environmentFilePreviewSourceKey(source),
    ),
    queryFn: async ({ signal }) => {
      const resolvedEnvironmentId = requireEnabledQueryArg({
        value: environmentId,
        hookName: "useWorkspaceFilePreview",
        argName: "environmentId",
      });
      const resolvedPath = requireEnabledQueryArg({
        value: path,
        hookName: "useWorkspaceFilePreview",
        argName: "path",
      });
      const resolvedSource = requireEnabledQueryArg({
        value: source,
        hookName: "useWorkspaceFilePreview",
        argName: "source",
      });
      const query = buildEnvironmentFilePreviewQuery(
        resolvedPath,
        resolvedSource,
      );
      const response = await sdk.environments.diffFile({
        environmentId: resolvedEnvironmentId,
        signal,
        ...query,
      });
      return buildEnvironmentFilePreview({
        contentUrl: buildEnvironmentDiffFileContentUrl(
          serverUrl,
          resolvedEnvironmentId,
          query,
        ),
        path: resolvedPath,
        response,
      });
    },
    enabled,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

/** A file under the thread's storage directory (`/thread-storage/content`). */
export function useThreadStorageFilePreview(
  threadId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
) {
  const { serverUrl } = useProfileClient();
  const contentFetch = useContentFetch();
  const enabled =
    (options?.enabled ?? true) && Boolean(threadId) && Boolean(path);
  useThreadDetailRealtimeSubscription(threadId ?? undefined, { enabled });
  return useQuery<LoadedFilePreview>({
    queryKey: threadStorageFilePreviewQueryKey(threadId ?? "", path ?? ""),
    queryFn: ({ signal }) => {
      const resolvedThreadId = requireEnabledQueryArg({
        value: threadId,
        hookName: "useThreadStorageFilePreview",
        argName: "threadId",
      });
      const resolvedPath = requireEnabledQueryArg({
        value: path,
        hookName: "useThreadStorageFilePreview",
        argName: "path",
      });
      return loadFilePreview({
        fetch: contentFetch,
        name: getFileName(resolvedPath),
        path: resolvedPath,
        signal,
        url: buildThreadStorageContentUrl(
          serverUrl,
          resolvedThreadId,
          resolvedPath,
        ),
      });
    },
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

/** An absolute path on the thread's host (`/host-files/content`). */
export function useThreadHostFilePreview(
  threadId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
) {
  const { serverUrl } = useProfileClient();
  const contentFetch = useContentFetch();
  const enabled =
    (options?.enabled ?? true) && Boolean(threadId) && Boolean(path);
  useThreadDetailRealtimeSubscription(threadId ?? undefined, { enabled });
  return useQuery<LoadedFilePreview>({
    queryKey: threadHostFilePreviewQueryKey(threadId ?? "", path ?? ""),
    queryFn: ({ signal }) => {
      const resolvedThreadId = requireEnabledQueryArg({
        value: threadId,
        hookName: "useThreadHostFilePreview",
        argName: "threadId",
      });
      const resolvedPath = requireEnabledQueryArg({
        value: path,
        hookName: "useThreadHostFilePreview",
        argName: "path",
      });
      return loadFilePreview({
        fetch: contentFetch,
        name: getFileName(resolvedPath),
        path: resolvedPath,
        signal,
        url: buildThreadHostFileContentUrl(
          serverUrl,
          resolvedThreadId,
          resolvedPath,
        ),
      });
    },
    enabled,
    // No realtime signal covers arbitrary host paths: refetch on focus/reconnect.
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

/** A project-relative file through `/projects/:id/files/content` (no environment yet). */
export function useProjectFilePreview(
  projectId: string | null | undefined,
  path: string | null,
  routing: ProjectFileRouting,
  options?: QueryOptions,
) {
  const { serverUrl } = useProfileClient();
  const contentFetch = useContentFetch();
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(path);
  const environmentId = routing.environmentId ?? null;
  const hostId = environmentId === null ? (routing.hostId ?? null) : null;
  return useQuery<LoadedFilePreview>({
    queryKey: projectFilePreviewQueryKey(
      projectId ?? "",
      environmentId,
      hostId,
      path ?? "",
    ),
    queryFn: ({ signal }) => {
      const resolvedProjectId = requireEnabledQueryArg({
        value: projectId,
        hookName: "useProjectFilePreview",
        argName: "projectId",
      });
      const resolvedPath = requireEnabledQueryArg({
        value: path,
        hookName: "useProjectFilePreview",
        argName: "path",
      });
      return loadFilePreview({
        fetch: contentFetch,
        name: getFileName(resolvedPath),
        path: resolvedPath,
        signal,
        url: buildProjectFileContentUrl(
          serverUrl,
          resolvedProjectId,
          resolvedPath,
          { environmentId, hostId },
        ),
      });
    },
    enabled,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}
