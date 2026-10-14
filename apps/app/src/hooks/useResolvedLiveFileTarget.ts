import { useMemo } from "react";
import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { Environment } from "@bb/domain";
import type { ThreadStorageLocationResponse } from "@bb/server-contract";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageLocation } from "@/hooks/queries/thread-queries";
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
  target: ExperimentalLiveFileTarget | null,
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
  if (target.kind === "host") {
    return {
      status: "available",
      absolutePath: target.path,
      openContext: isLocalDaemonHost(target.hostId)
        ? { kind: "local" }
        : {
            kind: "remote-ssh",
            hostId: target.hostId,
            serverOrigin,
          },
    };
  }

  if (target.kind === "thread-storage") {
    if (storageQuery.isLoading) return { status: "loading" };
    const location = storageQuery.data;
    if (location === undefined) {
      return { status: "unavailable" };
    }
    return {
      status: "available",
      absolutePath: buildAbsoluteHostPath(
        location.storageRootPath,
        target.path,
      ),
      openContext: isLocalDaemonHost(location.hostId)
        ? { kind: "local" }
        : {
            kind: "remote-ssh",
            hostId: location.hostId,
            serverOrigin,
          },
    };
  }

  if (environmentQuery.isLoading) return { status: "loading" };
  const environment = environmentQuery.data;
  if (environment === undefined || environment.path === null) {
    return { status: "unavailable" };
  }
  return {
    status: "available",
    absolutePath: buildAbsoluteHostPath(environment.path, target.path),
    openContext: isLocalDaemonHost(environment.hostId)
      ? { kind: "local" }
      : {
          kind: "remote-ssh",
          hostId: environment.hostId,
          serverOrigin,
        },
  };
}

export function useResolvedLiveFileTarget(
  target: ExperimentalLiveFileTarget | null,
  options: { enabled: boolean },
): ResolvedLiveFileTarget {
  const lookups = getLiveFileTargetLookups(target, options.enabled);
  const environmentQuery = useEnvironment(lookups.environmentId, {
    enabled: lookups.environmentEnabled,
  });
  const storageQuery = useThreadStorageLocation(lookups.storageThreadId, {
    enabled: lookups.storageEnabled,
  });
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
