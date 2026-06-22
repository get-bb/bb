import {
  FilePreview as FilePreviewSurface,
  type FilePreviewFile,
} from "./FilePreview";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { HttpError } from "@/lib/api";
import { buildThreadStorageRawContentUrl } from "@/lib/file-content-urls";
import type {
  FilePreview,
  FilePreviewLineRange,
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
  filePreview: FilePreview | undefined;
  isLoading: boolean;
  lineRange?: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onOpenInEditor?: (path: string) => void;
}

interface ThreadStorageFilePreviewProps extends FilePreviewBaseProps {
  threadId: string;
}

interface SecondaryPanelFilePreviewProps extends FilePreviewBaseProps {
  htmlPreviewUrl?: string | null;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface BuildTextPreviewFileArgs {
  activePath: string;
  filePreview: TextFilePreview;
}

function hashStringForPreviewCache(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildTextPreviewCacheKey({
  activePath,
  filePreview,
}: BuildTextPreviewFileArgs): string {
  return [
    "file-preview",
    filePreview.url,
    filePreview.path,
    filePreview.name ?? activePath,
    filePreview.mimeType,
    filePreview.content.length,
    hashStringForPreviewCache(filePreview.content),
  ].join(":");
}

function buildTextPreviewFile({
  activePath,
  filePreview,
}: BuildTextPreviewFileArgs): FilePreviewFile {
  return {
    cacheKey: buildTextPreviewCacheKey({ activePath, filePreview }),
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
  lineRange = null,
  markdownLinkRouting,
  onOpenInEditor,
  statusLabel = null,
}: SecondaryPanelFilePreviewProps) {
  if (error) {
    const isNotFound = error instanceof HttpError && error.status === 404;
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
          lineRange,
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
        markdownLinkRouting={markdownLinkRouting}
        statusLabel={statusLabel}
        state={{
          kind: "ready",
          lineRange,
          showMarkdownModeToggle: true,
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

  if (filePreview.kind === "video") {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: "video", url: filePreview.url }}
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
  lineRange,
  markdownLinkRouting,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewProps) {
  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={error}
      filePreview={filePreview}
      htmlPreviewUrl={buildThreadStorageRawContentUrl(threadId, activePath)}
      isLoading={isLoading}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onOpenInEditor={onOpenInEditor}
    />
  );
}
