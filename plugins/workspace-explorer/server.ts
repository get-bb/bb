import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { explorerRpcContract } from "./shared/contract";

const MAX_PATH_SEGMENTS = 32;
const MAX_SEGMENT_LENGTH = 255;

interface ResolvedWorkspace {
  environmentId: string;
  environmentName: string | null;
  hostId: string;
  rootPath: string;
}

function splitRelativePath(raw: string): string[] {
  if (raw === "") return [];
  const normalized = raw.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/u.test(normalized)) {
    throw new Error(
      `path must be relative to the workspace root, got: ${raw}`,
    );
  }
  const segments = normalized.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new Error("relative path is too deep");
  }
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(
        `path must be relative to the workspace root, got: ${raw}`,
      );
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      throw new Error(`path segment is too long: ${segment}`);
    }
  }
  return segments;
}

function joinHostPath(rootPath: string, segments: readonly string[]): string {
  if (segments.length === 0) return rootPath;
  const windowsHost =
    rootPath.includes("\\") || /^[a-zA-Z]:/u.test(rootPath);
  const separator = windowsHost ? "\\" : "/";
  const trimmedRoot = rootPath.replace(/[\\/]+$/u, "");
  return `${trimmedRoot}${separator}${segments.join(separator)}`;
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

export default async function plugin(bb: BbPluginApi) {
  async function resolveWorkspace(
    threadId: string,
  ): Promise<
    | { status: "ready"; workspace: ResolvedWorkspace }
    | { status: "no-environment" }
    | { status: "no-workspace-path" }
  > {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      return { status: "no-environment" };
    }
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.path === null) {
      return { status: "no-workspace-path" };
    }
    return {
      status: "ready",
      workspace: {
        environmentId: environment.id,
        environmentName: environment.name,
        hostId: environment.hostId,
        rootPath: environment.path,
      },
    };
  }

  bb.rpc.register(explorerRpcContract, {
    async explorerRoot(input) {
      const resolved = await resolveWorkspace(input.threadId);
      if (resolved.status !== "ready") {
        return { status: resolved.status } as const;
      }
      const { workspace } = resolved;
      return {
        status: "ready" as const,
        environmentId: workspace.environmentId,
        environmentName: workspace.environmentName,
        hostId: workspace.hostId,
        rootPath: workspace.rootPath,
      };
    },
    async explorerList(input) {
      const resolved = await resolveWorkspace(input.threadId);
      if (resolved.status !== "ready") {
        throw new Error(
          resolved.status === "no-environment"
            ? "this thread has no environment workspace to browse"
            : "this thread's environment has no workspace path",
        );
      }
      const { workspace } = resolved;
      const segments = splitRelativePath(input.path);
      const hostPath = joinHostPath(workspace.rootPath, segments);
      const result = await bb.sdk.hosts.directory({
        hostId: workspace.hostId,
        path: hostPath,
      });
      const directory = trimTrailingSeparators(result.directory);
      const childPrefix = `${directory}${directory.includes("\\") || /^[a-zA-Z]:/u.test(result.directory) ? "\\" : "/"}`;
      const entries = result.entries
        .filter((entry) => {
          const entryPath = trimTrailingSeparators(entry.path);
          return entryPath === directory || entryPath.startsWith(childPrefix);
        })
        .map((entry) => {
          const entryPath = trimTrailingSeparators(entry.path);
          if (entryPath === directory) {
            return { kind: entry.kind, name: entry.name, relativePath: "" };
          }
          const withinDirectory = entryPath
            .slice(childPrefix.length)
            .replace(/\\/gu, "/");
          return {
            kind: entry.kind,
            name: entry.name,
            relativePath: [...segments, ...withinDirectory.split("/")].join("/"),
          };
        })
        .filter((entry) => entry.relativePath !== "");
      return {
        path: segments.join("/"),
        environmentId: workspace.environmentId,
        rootPath: workspace.rootPath,
        entries,
      };
    },
  });
}
