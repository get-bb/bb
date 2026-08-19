import { useMemo } from "react";
import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import {
  useThread,
  useThreadStoragePaths,
} from "@/hooks/queries/thread-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";

const STORAGE_ROOT_PATH_OPTIONS = {
  includeDirectories: false,
  includeFiles: true,
  limit: 1,
  query: null,
} as const;

export type ResolvedLiveFileTarget =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "available";
      absolutePath: string;
      hostId: string;
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
  const threadQuery = useThread(storageThreadId, {
    enabled: options.enabled && storageThreadId.length > 0,
  });
  const environmentId =
    target?.kind === "workspace"
      ? target.environmentId
      : target?.kind === "thread-storage"
        ? (threadQuery.data?.environmentId ?? "")
        : "";
  const environmentQuery = useEnvironment(environmentId, {
    enabled: options.enabled && environmentId.length > 0,
  });
  const storageQuery = useThreadStoragePaths(
    storageThreadId,
    STORAGE_ROOT_PATH_OPTIONS,
    { enabled: options.enabled && storageThreadId.length > 0 },
  );
  const { isLocalDaemonHost } = useHostDaemon();

  return useMemo(() => {
    if (!options.enabled || target === null) return { status: "unavailable" };
    if (target.kind === "host") {
      return {
        status: "available",
        absolutePath: target.path,
        hostId: target.hostId,
        openContext: isLocalDaemonHost(target.hostId)
          ? { kind: "local" }
          : {
              kind: "remote-ssh",
              hostId: target.hostId,
              serverOrigin: window.location.origin,
            },
      };
    }

    if (
      (target.kind === "thread-storage" && threadQuery.isLoading) ||
      environmentQuery.isLoading ||
      (target.kind === "thread-storage" && storageQuery.isLoading)
    ) {
      return { status: "loading" };
    }

    const environment = environmentQuery.data;
    if (
      environment === undefined ||
      environment.path === null ||
      (target.kind === "thread-storage" &&
        (threadQuery.isError || storageQuery.isError))
    ) {
      return { status: "unavailable" };
    }

    const rootPath =
      target.kind === "workspace"
        ? environment.path
        : storageQuery.data?.storageRootPath;
    if (!rootPath) return { status: "unavailable" };
    return {
      status: "available",
      absolutePath: buildAbsoluteHostPath(rootPath, target.path),
      hostId: environment.hostId,
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
    storageQuery.data?.storageRootPath,
    storageQuery.isError,
    storageQuery.isLoading,
    target,
    threadQuery.isError,
    threadQuery.isLoading,
  ]);
}
