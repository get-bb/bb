import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  isRelativeFilePathCandidate,
  relativeFileLinkCandidates,
  resolveThreadLocalFileLink,
  useThreadStorageFiles,
  type RelativeFileLinkCandidate,
} from "@/data/files";
import { copyWithToast } from "@/lib/clipboard";
import {
  parseLocalFileLineSuffix,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
} from "@/markdown";
import { ActionSheet, toast, useSheet, type ActionSheetAction } from "@/ui";
import { useThreadFileOpener, type FileOpenHandler } from "./file-opener";
import type { FilePreviewTarget } from "./file-preview-target";

interface UseThreadLocalFileLinksArgs {
  /** Null outside a thread (root compose): only workspace files resolve. */
  threadId: string | null;
  /** Null while the thread has no environment (host-file reads unavailable). */
  environmentId: string | null;
  /** The environment's checkout path (workspace root), when known. */
  workspaceRootPath: string | null;
  /** Where files open (default: the thread file opener → preview route). */
  onOpenFile?: FileOpenHandler;
}

interface ThreadLocalFileLinks {
  /** An absolute `/path[:line]` link (markdown `onFilePress`). */
  openLocalFileLink: (link: MarkdownLocalFileLink) => void;
  /** Drop-in `onLinkPress` for `<Markdown>`: claims relative file references. */
  onMarkdownLinkPress: (link: MarkdownLinkTarget) => boolean;
  /** Mount once near the host: the "which root?" picker sheet. */
  pickerSheet: ReactElement;
}

interface PendingRelativeLink {
  relativePath: string;
  lineRange: MarkdownLocalFileLink["lineRange"];
  candidates: RelativeFileLinkCandidate[];
}

function candidateTarget(
  candidate: RelativeFileLinkCandidate,
): FilePreviewTarget {
  return candidate.kind === "workspace-file"
    ? {
        kind: "workspace-file",
        path: candidate.relativePath,
        source: { kind: "working-tree" },
        statusLabel: null,
      }
    : { kind: "storage-file", path: candidate.relativePath };
}

/**
 * Routes local file links tapped in a thread (timeline markdown, attachment
 * paths, previewed markdown files): workspace root first, then the thread
 * storage root (when its file list has been loaded), then a host-file read;
 * relative references get a root picker when ambiguous.
 */
export function useThreadLocalFileLinks({
  threadId,
  environmentId,
  workspaceRootPath,
  onOpenFile,
}: UseThreadLocalFileLinksArgs): ThreadLocalFileLinks {
  const defaultOpen = useThreadFileOpener(threadId);
  const openFile = onOpenFile ?? defaultOpen;
  // Read the storage root only from cache (the Files tab / a storage preview
  // loads it); an absolute path outside the workspace still opens through
  // the host-file route when the root is unknown.
  const storageFiles = useThreadStorageFiles(threadId, { enabled: false });
  const threadStorageRootPath = storageFiles.data?.storageRootPath ?? null;

  const openLocalFileLink = useCallback(
    (link: MarkdownLocalFileLink) => {
      const resolution = resolveThreadLocalFileLink({
        path: link.path,
        lineRange: link.lineRange,
        workspaceRootPath,
        threadStorageRootPath,
        hostFileLinksAvailable: threadId !== null && environmentId !== null,
      });
      switch (resolution.kind) {
        case "workspace-file":
          openFile({
            target: {
              kind: "workspace-file",
              path: resolution.relativePath,
              source: { kind: "working-tree" },
              statusLabel: null,
            },
            lineRange: resolution.lineRange,
          });
          return;
        case "storage-file":
          openFile({
            target: { kind: "storage-file", path: resolution.relativePath },
            lineRange: resolution.lineRange,
          });
          return;
        case "host-file":
          openFile({
            target: { kind: "host-file", path: resolution.path },
            lineRange: resolution.lineRange,
          });
          return;
        case "error":
          toast.error("Could not open file", {
            description: resolution.description,
          });
          return;
      }
    },
    [
      environmentId,
      openFile,
      threadId,
      threadStorageRootPath,
      workspaceRootPath,
    ],
  );

  const picker = useSheet();
  const [pending, setPending] = useState<PendingRelativeLink | null>(null);
  const openRelativeFileLink = useCallback(
    (href: string): boolean => {
      const parsed = parseLocalFileLineSuffix(href);
      const rawPath = parsed?.path ?? href;
      if (!isRelativeFilePathCandidate(rawPath)) return false;
      const candidates = relativeFileLinkCandidates({
        relativePath: rawPath,
        workspaceRootPath,
        threadStorageRootPath,
      });
      if (candidates.length === 0) return false;
      const lineRange = parsed?.lineRange ?? null;
      if (candidates.length === 1) {
        openFile({ target: candidateTarget(candidates[0]!), lineRange });
        return true;
      }
      setPending({ relativePath: rawPath, lineRange, candidates });
      picker.present();
      return true;
    },
    [openFile, picker, threadStorageRootPath, workspaceRootPath],
  );
  const onMarkdownLinkPress = useCallback(
    (link: MarkdownLinkTarget): boolean =>
      link.kind === "relative" ? openRelativeFileLink(link.href) : false,
    [openRelativeFileLink],
  );

  const pickerActions = useMemo<ActionSheetAction[]>(() => {
    if (pending === null) return [];
    const actions: ActionSheetAction[] = pending.candidates.map(
      (candidate) => ({
        key: candidate.kind,
        label:
          candidate.kind === "workspace-file"
            ? "Open in workspace"
            : "Open in thread storage",
        icon: candidate.kind === "workspace-file" ? "FolderGit" : "Folder",
        onPress: () =>
          openFile({
            target: candidateTarget(candidate),
            lineRange: pending.lineRange,
          }),
      }),
    );
    actions.push({
      key: "copy",
      label: "Copy path",
      icon: "Copy",
      onPress: () => copyWithToast(pending.relativePath, "Path copied"),
    });
    return actions;
  }, [openFile, pending]);
  const pickerSheet = (
    <ActionSheet
      controller={picker}
      title={pending?.relativePath}
      message="This path could be in the workspace or in thread storage."
      actions={pickerActions}
      stackBehavior="push"
    />
  );

  return {
    openLocalFileLink,
    onMarkdownLinkPress,
    pickerSheet,
  };
}
