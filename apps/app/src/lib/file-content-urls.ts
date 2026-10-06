import type { EnvironmentFilePreviewSource } from "@bb/client-core";
import { apiClient, toRelativeUrl } from "./api-server";

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function encodeHostFilePath(absolutePath: string): string {
  return encodePathSegments(
    absolutePath.replace(/\\/gu, "/").replace(/^\/+/u, ""),
  );
}

export function buildProjectAttachmentContentUrl(
  projectId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.projects[":id"].attachments.content.$url({
      param: { id: projectId },
      query: { path },
    }),
  );
}

export function buildProjectFileContentUrl(
  projectId: string,
  path: string,
  routing: { environmentId: string | null; hostId: string | null },
): string {
  if (routing.environmentId !== null) {
    return buildEnvironmentFileContentUrl(
      routing.environmentId,
      { kind: "working-tree" },
      path,
    );
  }
  const filePath = encodePathSegments(path);
  return toRelativeUrl(
    routing.hostId === null
      ? apiClient.projects[":id"].files[":filePath{.+}"].$url({
          param: { id: projectId, filePath },
        })
      : apiClient.projects[":id"].hosts[":hostId"].files[":filePath{.+}"].$url({
          param: { id: projectId, hostId: routing.hostId, filePath },
        }),
  );
}

export function buildEnvironmentFileContentUrl(
  environmentId: string,
  source: EnvironmentFilePreviewSource,
  path: string,
): string {
  const filePath = encodePathSegments(path);
  if (source.kind === "working-tree") {
    return toRelativeUrl(
      apiClient.environments[":id"].files[":filePath{.+}"].$url({
        param: { id: environmentId, filePath },
      }),
    );
  }
  return toRelativeUrl(
    apiClient.environments[":id"].revisions[":ref"].files[":filePath{.+}"].$url(
      {
        param: {
          id: environmentId,
          ref: source.kind === "head" ? "HEAD" : source.ref,
          filePath,
        },
      },
    ),
  );
}

export function buildThreadStorageRawContentUrl(
  threadId: string,
  path: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["thread-storage"].files[":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodePathSegments(path) },
    }),
  );
}

export function buildThreadHostFileContentUrl(
  threadId: string,
  absolutePath: string,
): string {
  return toRelativeUrl(
    apiClient.threads[":id"]["host-files"][":filePath{.+}"].$url({
      param: { id: threadId, filePath: encodeHostFilePath(absolutePath) },
    }),
  );
}

export function buildHostFileContentUrl(
  hostId: string,
  absolutePath: string,
): string {
  return toRelativeUrl(
    apiClient.hosts[":id"].files[":filePath{.+}"].$url({
      param: { id: hostId, filePath: encodeHostFilePath(absolutePath) },
    }),
  );
}
