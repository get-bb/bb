import type { FilePreviewLineRange } from "@bb/client-core";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { useThreadRecentFiles } from "@/data/files";
import { toast } from "@/ui";
import { useOptionalPanel } from "../panel/PanelProvider";
import type { OpenFileRequest as PanelOpenFileRequest } from "../panel/panel-model";
import { threadFilesHref } from "../shell/hrefs";
import {
  buildFilePreviewRouteParams,
  type FilePreviewTarget,
} from "./file-preview-target";

export interface FileOpenRequest {
  target: FilePreviewTarget;
  lineRange: FilePreviewLineRange | null;
}

export type FileOpenHandler = (request: FileOpenRequest) => void;

/** The workspace panel's open-file request for a preview target. */
function toPanelOpenFileRequest(
  request: FileOpenRequest,
): PanelOpenFileRequest {
  const line = request.lineRange?.startLineNumber ?? null;
  const endLine = request.lineRange?.endLineNumber ?? null;
  switch (request.target.kind) {
    case "workspace-file":
      return {
        kind: "workspace",
        path: request.target.path,
        line,
        endLine,
        source: request.target.source,
        statusLabel: request.target.statusLabel,
      };
    case "project-file":
      // The panel resolves workspace previews to the project when its scope
      // has no environment.
      return { kind: "workspace", path: request.target.path, line, endLine };
    case "host-file":
      return { kind: "host", path: request.target.path, line, endLine };
    case "storage-file":
      return { kind: "storage", path: request.target.path, line, endLine };
  }
}

/**
 * Where tapping a file goes: the workspace panel when one is mounted above
 * (the file becomes a panel tab, like the web's secondary panel), else the
 * full-screen preview route. Every path records workspace / storage files in
 * the thread's recent list.
 */
export function useThreadFileOpener(threadId: string | null): FileOpenHandler {
  const panel = useOptionalPanel();
  const router = useRouter();
  const recent = useThreadRecentFiles(threadId);
  const record = recent.record;
  const panelOpenFile = panel?.openFile ?? null;
  return useCallback(
    (request: FileOpenRequest) => {
      if (request.target.kind === "workspace-file") {
        record("workspace", request.target.path);
      } else if (request.target.kind === "storage-file") {
        record("thread-storage", request.target.path);
      }
      if (panelOpenFile) {
        panelOpenFile(toPanelOpenFileRequest(request));
        return;
      }
      if (threadId === null) {
        toast.error("Open a thread to preview files.");
        return;
      }
      router.push(
        threadFilesHref(
          threadId,
          buildFilePreviewRouteParams(request.target, request.lineRange),
        ),
      );
    },
    [panelOpenFile, record, router, threadId],
  );
}
