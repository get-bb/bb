import { useMemo } from "react";
import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { Environment } from "@bb/domain";
import type { ThreadStorageLocationResponse } from "@bb/server-contract";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageLocation } from "@/hooks/queries/thread-panel-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";

type ResolvedLiveFileTarget =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "available";
      absolutePath: string;
      openContext: OpenInTargetContext;
    };

function buildAbsoluteHostPath(rootPath: string, relativePath: string): string {
  const usesWindowsSeparators =
    /^[A-Za-z]:[\\/]/u.test(rootPath) || rootPath.startsWith("\\\\");
  const separator = usesWindowsSeparators ? "\\" : "/";
  const normalizedRelativePath = usesWindowsSeparators
    ? relativePath.replaceAll("/", "\\")
    : relativePath;
  const trimmedRootPath = rootPath.replace(/[\\/]+$/u, "");
  return `${trimmedRootPath}${separator}${normalizedRelativePath}`;
}

interface LiveFileTargetLookups {
  environmentId: string;
  environmentEnabled: boolean;
  storageThreadId: string;
  storageEnabled: boolean;
}

export function getLiveFileTargetLookups(
  target: LiveFileRoot | null,
  enabled: boolean,
): LiveFileTargetLookups {
  const storageThreadId =
    target?.kind === "thread-storage" ? target.threadId : "";
  const environmentId =
    target?.kind === "workspace" ? target.environmentId : "";
  return {
    environmentId,
    environmentEnabled: enabled && environmentId.length > 0,
    storageThreadId,
    storageEnabled: enabled && storageThreadId.length > 0,
  };
}

interface LookupState<TData> {
  data: TData | undefined;
  isLoading: boolean;
}

export type LiveFileRoot =
  | { kind: "workspace"; environmentId: string }
  | { kind: "host"; hostId: string }
  | { kind: "thread-storage"; threadId: string };

type ResolvedLiveFileRoot =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "available"; hostId: string; rootPath: string | null };

export function resolveLiveFileRoot({
  root,
  environmentQuery,
  storageQuery,
}: {
  root: LiveFileRoot;
  environmentQuery: LookupState<Environment>;
  storageQuery: LookupState<ThreadStorageLocationResponse>;
}): ResolvedLiveFileRoot {
  if (root.kind === "host") {
    return { status: "available", hostId: root.hostId, rootPath: null };
  }
  const query = root.kind === "workspace" ? environmentQuery : storageQuery;
  if (query.isLoading) return { status: "loading" };
  if (root.kind === "thread-storage") {
    const location = storageQuery.data;
    return location === undefined
      ? { status: "unavailable" }
      : {
          status: "available",
          hostId: location.hostId,
          rootPath: location.storageRootPath,
        };
  }
  const environment = environmentQuery.data;
  return environment === undefined ||
    environment.status !== "ready" ||
    environment.hostLifecycle !== "active" ||
    environment.path === null
    ? { status: "unavailable" }
    : {
        status: "available",
        hostId: environment.hostId,
        rootPath: environment.path,
      };
}

export function getLiveFileOpenContext({
  hostId,
  isLocalDaemonHost,
  serverOrigin,
}: {
  hostId: string;
  isLocalDaemonHost: (hostId: string) => boolean;
  serverOrigin: string;
}): OpenInTargetContext {
  return isLocalDaemonHost(hostId)
    ? { kind: "local" }
    : { kind: "remote-ssh", hostId, serverOrigin };
}

export function resolveLiveFileTarget({
  target,
  enabled,
  environmentQuery,
  storageQuery,
  isLocalDaemonHost,
  serverOrigin,
}: {
  target: ExperimentalLiveFileTarget | null;
  enabled: boolean;
  environmentQuery: LookupState<Environment>;
  storageQuery: LookupState<ThreadStorageLocationResponse>;
  isLocalDaemonHost: (hostId: string) => boolean;
  serverOrigin: string;
}): ResolvedLiveFileTarget {
  if (!enabled || target === null) return { status: "unavailable" };
  const root = resolveLiveFileRoot({
    root: target,
    environmentQuery,
    storageQuery,
  });
  if (root.status !== "available") return root;
  return {
    status: "available",
    absolutePath:
      root.rootPath === null
        ? target.path
        : buildAbsoluteHostPath(root.rootPath, target.path),
    openContext: getLiveFileOpenContext({
      hostId: root.hostId,
      isLocalDaemonHost,
      serverOrigin,
    }),
  };
}

function useLiveFileRootQueries(root: LiveFileRoot | null, enabled: boolean) {
  const lookups = getLiveFileTargetLookups(root, enabled);
  const environmentQuery = useEnvironment(lookups.environmentId, {
    enabled: lookups.environmentEnabled,
  });
  const storageQuery = useThreadStorageLocation(lookups.storageThreadId, {
    enabled: lookups.storageEnabled,
  });
  return { environmentQuery, storageQuery };
}

export function useResolvedLiveFileRoot(
  root: LiveFileRoot | null,
): ResolvedLiveFileRoot {
  const { environmentQuery, storageQuery } = useLiveFileRootQueries(
    root,
    root !== null,
  );
  return root === null
    ? { status: "unavailable" }
    : resolveLiveFileRoot({ root, environmentQuery, storageQuery });
}

export function useResolvedLiveFileTarget(
  target: ExperimentalLiveFileTarget | null,
  options: { enabled: boolean },
): ResolvedLiveFileTarget {
  const { environmentQuery, storageQuery } = useLiveFileRootQueries(
    target,
    options.enabled,
  );
  const { isLocalDaemonHost } = useHostDaemon();

  return useMemo(
    () =>
      resolveLiveFileTarget({
        target,
        enabled: options.enabled,
        environmentQuery: {
          data: environmentQuery.data,
          isLoading: environmentQuery.isLoading,
        },
        storageQuery: {
          data: storageQuery.data,
          isLoading: storageQuery.isLoading,
        },
        isLocalDaemonHost,
        serverOrigin: window.location.origin,
      }),
    [
      environmentQuery.data,
      environmentQuery.isLoading,
      isLocalDaemonHost,
      options.enabled,
      storageQuery.data,
      storageQuery.isLoading,
      target,
    ],
  );
}
