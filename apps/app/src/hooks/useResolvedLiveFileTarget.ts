import { useMemo } from "react";
import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
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

export function useResolvedLiveFileTarget(
  target: ExperimentalLiveFileTarget | null,
  options: { enabled: boolean },
): ResolvedLiveFileTarget {
  const storageThreadId =
    target?.kind === "thread-storage" ? target.threadId : "";
  const environmentId =
    target?.kind === "workspace" ? target.environmentId : "";
  const environmentQuery = useEnvironment(environmentId, {
    enabled: options.enabled && environmentId.length > 0,
  });
  const storageQuery = useThreadStorageLocation(storageThreadId, {
    enabled: options.enabled && storageThreadId.length > 0,
  });
  const { isLocalDaemonHost } = useHostDaemon();

  return useMemo(() => {
    if (!options.enabled || target === null) return { status: "unavailable" };
    if (target.kind === "host") {
      return {
        status: "available",
        absolutePath: target.path,
        openContext: isLocalDaemonHost(target.hostId)
          ? { kind: "local" }
          : {
              kind: "remote-ssh",
              hostId: target.hostId,
              serverOrigin: window.location.origin,
            },
      };
    }

    if (target.kind === "thread-storage") {
      if (storageQuery.isLoading) return { status: "loading" };
      const location = storageQuery.data;
      if (storageQuery.isError || location === undefined) {
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
              serverOrigin: window.location.origin,
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
            serverOrigin: window.location.origin,
          },
    };
  }, [
    environmentQuery.data,
    environmentQuery.isLoading,
    isLocalDaemonHost,
    options.enabled,
    storageQuery.data,
    storageQuery.isError,
    storageQuery.isLoading,
    target,
  ]);
}
