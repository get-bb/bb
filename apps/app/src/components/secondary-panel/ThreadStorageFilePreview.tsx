import {
  FilePreview as FilePreviewSurface,
  type FilePreviewFile,
} from "./FilePreview";
import { isManagerStatusStorageFilePath } from "./managerStorage";
import { useThreadStatusVersion } from "@/hooks/queries/thread-queries";
import { HttpError } from "@/lib/api";
import {
  buildThreadStatusContentUrl,
  buildThreadStorageRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  FilePreview as ApiFilePreview,
  TextFilePreview,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { isHtmlFilePreviewPath } from "@/lib/file-preview";

// Generic HTML comes from arbitrary worktree/storage files. Allow scripts for
// realistic previews, but omit allow-same-origin so the frame gets an opaque
// origin and cannot read bb app cookies, storage, or same-origin APIs.
const GENERIC_HTML_IFRAME_SANDBOX = "allow-scripts";

interface FilePreviewBaseProps {
  activePath: string;
  copyPath?: string | null;
  error?: Error | null;
  filePreview: ApiFilePreview | undefined;
  isLoading: boolean;
  lineNumber?: number | null;
  onOpenInEditor?: (path: string) => void;
}

interface ThreadStorageFilePreviewProps extends FilePreviewBaseProps {
  pinnedPath: string;
  threadId: string;
}

interface SecondaryPanelFilePreviewProps extends FilePreviewBaseProps {
  htmlPreviewUrl?: string | null;
  pendingNotFoundPath?: string;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface BuildTextPreviewFileArgs {
  activePath: string;
  filePreview: TextFilePreview;
}

function buildTextPreviewFile({
  activePath,
  filePreview,
}: BuildTextPreviewFileArgs): FilePreviewFile {
  return {
    name: filePreview.name ?? activePath,
    contents: filePreview.content,
  };
}

export function SecondaryPanelFilePreview({
  activePath,
  copyPath = null,
  error,
  filePreview,
  htmlPreviewUrl = null,
  isLoading,
  lineNumber = null,
  onOpenInEditor,
  pendingNotFoundPath,
  statusLabel = null,
}: SecondaryPanelFilePreviewProps) {
  if (error) {
    const isNotFound = error instanceof HttpError && error.status === 404;
    if (isNotFound && activePath === pendingNotFoundPath) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{ kind: "manager-status-pending" }}
        />
      );
    }
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: isNotFound ? "not-found" : "error" }}
      />
    );
  }

  if (isLoading || !filePreview || filePreview.path !== activePath) {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: "loading" }}
      />
    );
  }

  if (htmlPreviewUrl !== null && isHtmlFilePreviewPath(activePath)) {
    if (filePreview.kind !== "text") {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{
            kind: "iframe",
            sandbox: GENERIC_HTML_IFRAME_SANDBOX,
            title: activePath,
            url: htmlPreviewUrl,
          }}
        />
      );
    }

    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{
          kind: "html",
          file: buildTextPreviewFile({ activePath, filePreview }),
          iframe: {
            sandbox: GENERIC_HTML_IFRAME_SANDBOX,
            title: activePath,
            url: htmlPreviewUrl,
          },
          lineNumber,
        }}
      />
    );
  }

  if (filePreview.kind === "text") {
    if (filePreview.content.length === 0) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{ kind: "empty" }}
        />
      );
    }
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{
          kind: "ready",
          lineNumber,
          file: buildTextPreviewFile({ activePath, filePreview }),
        }}
      />
    );
  }

  if (filePreview.kind === "image") {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: "image", url: filePreview.url }}
      />
    );
  }

  return (
    <FilePreviewSurface
      path={activePath}
      copyPath={copyPath}
      onOpenInEditor={onOpenInEditor}
      statusLabel={statusLabel}
      state={{
        kind: "error",
        message: `Preview not available for ${filePreview.mimeType}.`,
      }}
    />
  );
}

export function ThreadStorageFilePreview({
  activePath,
  copyPath,
  error,
  filePreview,
  isLoading,
  lineNumber,
  onOpenInEditor,
  pinnedPath,
  threadId,
}: ThreadStorageFilePreviewProps) {
  const isManagerStatusTab = isManagerStatusStorageFilePath(activePath);
  const statusVersion = useThreadStatusVersion(threadId, {
    enabled: isManagerStatusTab,
  });

  if (isManagerStatusTab) {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        state={{
          kind: "iframe",
          sandbox: null,
          title: "Manager status",
          url: buildThreadStatusContentUrl(threadId, statusVersion.data?.hash),
        }}
      />
    );
  }

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={error}
      filePreview={filePreview}
      htmlPreviewUrl={buildThreadStorageRawContentUrl(threadId, activePath)}
      isLoading={isLoading}
      lineNumber={lineNumber}
      onOpenInEditor={onOpenInEditor}
      pendingNotFoundPath={pinnedPath}
    />
  );
}
