import {
  buildProjectFileContentUrl,
  buildRawFilesystemHtmlContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/data/files/file-content-urls";
import { getParentPath } from "@/data/files/file-preview-model";
import { resolveRelativeLink } from "@/data/files/local-file-links";
import type { FilePreviewTarget } from "./file-preview-target";

export interface FileTargetUrlContext {
  serverUrl: string;
  /** Null outside a thread: only project-file URLs resolve. */
  threadId: string | null;
  projectId: string | null;
  environmentId: string | null;
  hostId: string | null;
}

/**
 * A browser-loadable URL for the target's bytes (raw routes for worktree /
 * storage files, the content routes for host / project files), used by the
 * HTML WebView, "Open in browser", video hand-off and sibling images. Null
 * when the source has no URL (HEAD / merge-base workspace reads).
 */
export function buildFileTargetExternalUrl(
  context: FileTargetUrlContext,
  target: FilePreviewTarget,
): string | null {
  switch (target.kind) {
    case "workspace-file":
      return target.source.kind === "working-tree" && context.threadId !== null
        ? buildThreadWorktreeRawContentUrl(
            context.serverUrl,
            context.threadId,
            target.path,
          )
        : null;
    case "storage-file":
      return context.threadId === null
        ? null
        : buildThreadStorageRawContentUrl(
            context.serverUrl,
            context.threadId,
            target.path,
          );
    case "host-file":
      return context.threadId === null
        ? null
        : buildThreadHostFileContentUrl(
            context.serverUrl,
            context.threadId,
            target.path,
          );
    case "project-file":
      return context.projectId === null
        ? null
        : buildProjectFileContentUrl(
            context.serverUrl,
            context.projectId,
            target.path,
            {
              environmentId: context.environmentId,
              hostId: context.hostId,
            },
          );
  }
}

/**
 * The URL the HTML WebView loads, or null when the file must be shown as
 * source instead. Only routes the server serves with the
 * `Content-Security-Policy: sandbox allow-scripts` header qualify: the
 * worktree / storage raw routes and, for host files, the raw filesystem
 * route. `/projects/:id/files/content` sets no CSP, so project-file HTML
 * would execute same-origin with the session cookie; like the web app, it is
 * never rendered.
 */
export function buildFileTargetHtmlUrl(
  context: FileTargetUrlContext,
  target: FilePreviewTarget,
): string | null {
  switch (target.kind) {
    case "host-file":
      return context.threadId === null
        ? null
        : buildRawFilesystemHtmlContentUrl(
            context.serverUrl,
            context.threadId,
            target.path,
          );
    case "project-file":
      return null;
    case "workspace-file":
    case "storage-file":
      return buildFileTargetExternalUrl(context, target);
  }
}

/** The same-source target for a link relative to the previewed file, or null. */
export function resolveSiblingFileTarget(
  target: FilePreviewTarget,
  relativePath: string,
): FilePreviewTarget | null {
  const resolved = resolveRelativeLink(
    getParentPath(target.path),
    relativePath,
  );
  if (resolved === null) return null;
  switch (target.kind) {
    case "workspace-file":
      return { ...target, path: resolved, statusLabel: null };
    case "host-file":
      return resolved.startsWith("/")
        ? { kind: "host-file", path: resolved }
        : null;
    case "storage-file":
    case "project-file":
      return { kind: target.kind, path: resolved };
  }
}
