import type { ExperimentalFileIdentity } from "@get-bb/plugin-sdk";
import type { ByteFileTabState } from "@bb/client-core";
import {
  buildEnvironmentFileDownloadUrl,
  buildEnvironmentFilePreviewUrl,
  buildHostFileDownloadUrl,
  buildHostFilePreviewUrl,
  buildProjectAttachmentDownloadUrl,
  buildProjectAttachmentPreviewUrl,
  buildThreadHostFileDownloadUrl,
  buildThreadHostFilePreviewUrl,
  buildThreadStorageDownloadUrl,
  buildThreadStoragePreviewUrl,
} from "./file-content-urls";

export type ResolvedFileOpenAction = "external" | "preview";

export interface ResolvedFileInteraction {
  downloadUrl: string | null;
  openAction: ResolvedFileOpenAction;
  previewUrl: string | null;
}

function tasksAttachmentUrl(
  action: "download" | "preview",
  attachmentId: string,
): string {
  return `/api/v1/plugins/tasks/http/attachments/${action}?attachmentId=${encodeURIComponent(attachmentId)}`;
}

export function resolveFileInteraction(
  identity: ExperimentalFileIdentity,
): ResolvedFileInteraction {
  const { source } = identity;
  switch (source.store) {
    case "workspace":
      return {
        downloadUrl: buildEnvironmentFileDownloadUrl(
          source.ownerId,
          source.path,
        ),
        openAction: "preview",
        previewUrl: buildEnvironmentFilePreviewUrl(source.ownerId, source.path),
      };
    case "host":
      return {
        downloadUrl: buildHostFileDownloadUrl(source.ownerId, source.path),
        openAction: "preview",
        previewUrl: buildHostFilePreviewUrl(source.ownerId, source.path),
      };
    case "thread-host":
      return {
        downloadUrl: buildThreadHostFileDownloadUrl(
          source.ownerId,
          source.path,
        ),
        openAction: "preview",
        previewUrl: buildThreadHostFilePreviewUrl(source.ownerId, source.path),
      };
    case "thread-storage":
      return {
        downloadUrl: buildThreadStorageDownloadUrl(source.ownerId, source.path),
        openAction: "preview",
        previewUrl: buildThreadStoragePreviewUrl(source.ownerId, source.path),
      };
    case "project-attachment":
      return {
        downloadUrl: buildProjectAttachmentDownloadUrl(
          source.ownerId,
          source.path,
        ),
        openAction: "preview",
        previewUrl: buildProjectAttachmentPreviewUrl(
          source.ownerId,
          source.path,
        ),
      };
    case "tasks-attachment":
      return {
        downloadUrl: tasksAttachmentUrl("download", source.attachmentId),
        openAction: "preview",
        previewUrl: tasksAttachmentUrl("preview", source.attachmentId),
      };
    case "remote":
      return {
        downloadUrl: null,
        openAction: "external",
        previewUrl: source.url,
      };
  }
}

export function byteFileTabFromIdentity(
  identity: ExperimentalFileIdentity,
): ByteFileTabState | null {
  const { source } = identity;
  if (
    source.store !== "project-attachment" &&
    source.store !== "tasks-attachment"
  ) {
    return null;
  }
  return {
    displayName: identity.displayName,
    lineRange:
      identity.location === null
        ? null
        : {
            startLineNumber:
              identity.location.kind === "line"
                ? identity.location.line
                : identity.location.startLine,
            endLineNumber:
              identity.location.kind === "line"
                ? identity.location.line
                : identity.location.endLine,
          },
    mimeType: identity.mimeType,
    ownerId: source.ownerId,
    resourceId:
      source.store === "project-attachment" ? source.path : source.attachmentId,
    sizeBytes: identity.sizeBytes,
    source: source.store,
  };
}

export function identityFromByteFileTab(
  tab: ByteFileTabState,
): ExperimentalFileIdentity {
  return {
    source:
      tab.source === "project-attachment"
        ? { store: tab.source, ownerId: tab.ownerId, path: tab.resourceId }
        : {
            store: tab.source,
            ownerId: tab.ownerId,
            attachmentId: tab.resourceId,
          },
    displayName: tab.displayName,
    mimeType: tab.mimeType,
    sizeBytes: tab.sizeBytes,
    location:
      tab.lineRange === null
        ? null
        : {
            kind: "range",
            startLine: tab.lineRange.startLineNumber,
            endLine: tab.lineRange.endLineNumber,
          },
  };
}
