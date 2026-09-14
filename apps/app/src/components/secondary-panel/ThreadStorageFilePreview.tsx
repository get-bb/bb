import {
  FilePreview as FilePreviewSurface,
  type FilePreviewFile,
  type FilePreviewState,
  type TextFilePreviewKind,
} from "./FilePreview";
import { hashSourceContents } from "@/components/code/source-code-budget";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { HttpError } from "@/lib/api";
import type {
  FilePreview,
  FilePreviewLineRange,
  TextFilePreview,
  WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import {
  isCsvFilePreview,
  isHtmlFilePreviewPath,
  isMarkdownFilePreview,
} from "@bb/client-core";

const GENERIC_HTML_IFRAME_SANDBOX = "allow-scripts";

interface SecondaryPanelFilePreviewProps {
  activePath: string;
  copyPath?: string | null;
  error?: Error | null;
  filePreview: FilePreview | undefined;
  htmlPreviewUrl?: string | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  lineRange?: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  onRefresh?: () => void;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface BuildTextPreviewFileArgs {
  activePath: string;
  filePreview: TextFilePreview;
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
    hashSourceContents(filePreview.content),
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

function getTextPreviewKind(
  filePreview: TextFilePreview,
): TextFilePreviewKind | null {
  if (isCsvFilePreview(filePreview)) {
    return "csv";
  }
  if (isMarkdownFilePreview(filePreview)) {
    return "markdown";
  }
  return null;
}

interface ResolveSecondaryPanelFilePreviewStateArgs {
  activePath: string;
  error: Error | null | undefined;
  filePreview: FilePreview | undefined;
  htmlPreviewUrl: string | null;
  isLoading: boolean;
  lineRange: FilePreviewLineRange | null;
}

function resolveSecondaryPanelFilePreviewState({
  activePath,
  error,
  filePreview,
  htmlPreviewUrl,
  isLoading,
  lineRange,
}: ResolveSecondaryPanelFilePreviewStateArgs): FilePreviewState {
  if (error) {
    const isNotFound = error instanceof HttpError && error.status === 404;
    return { kind: isNotFound ? "not-found" : "error" };
  }

  if (isLoading || !filePreview || filePreview.path !== activePath) {
    return { kind: "loading" };
  }

  if (htmlPreviewUrl !== null && isHtmlFilePreviewPath(activePath)) {
    if (filePreview.kind !== "text") {
      return {
        kind: "iframe",
        sandbox: GENERIC_HTML_IFRAME_SANDBOX,
        title: activePath,
        url: htmlPreviewUrl,
      };
    }

    return {
      kind: "html",
      file: buildTextPreviewFile({ activePath, filePreview }),
      iframe: {
        sandbox: GENERIC_HTML_IFRAME_SANDBOX,
        title: activePath,
        url: htmlPreviewUrl,
      },
      lineRange,
    };
  }

  if (filePreview.kind === "text") {
    if (filePreview.content.length === 0) {
      return { kind: "empty" };
    }
    return {
      kind: "ready",
      lineRange,
      textPreviewKind: getTextPreviewKind(filePreview),
      file: buildTextPreviewFile({ activePath, filePreview }),
    };
  }

  if (filePreview.kind === "image") {
    return { kind: "image", url: filePreview.url };
  }

  if (filePreview.kind === "video") {
    return { kind: "video", url: filePreview.url };
  }

  return {
    kind: "error",
    message: `Preview not available for ${filePreview.mimeType}.`,
  };
}

export function SecondaryPanelFilePreview({
  activePath,
  copyPath = null,
  error,
  filePreview,
  htmlPreviewUrl = null,
  isLoading,
  isRefreshing = false,
  lineRange = null,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  onRefresh,
  statusLabel = null,
}: SecondaryPanelFilePreviewProps) {
  const state = resolveSecondaryPanelFilePreviewState({
    activePath,
    error,
    filePreview,
    htmlPreviewUrl,
    isLoading,
    lineRange,
  });
  return (
    <FilePreviewSurface
      path={activePath}
      copyPath={copyPath}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      markdownLinkRouting={
        state.kind === "ready" ? markdownLinkRouting : undefined
      }
      statusLabel={statusLabel}
      state={state}
    />
  );
}
