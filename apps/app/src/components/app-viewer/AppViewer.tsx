import { useMemo } from "react";
import { useApp, useAppMarkdownPreview } from "@/hooks/queries/thread-queries";
import {
  buildAppEntryUrl,
  buildAppPublicBaseUrl,
} from "@/lib/file-content-urls";
import { createAssetMarkdownUrlTransform } from "@/lib/markdown-url-transform";
import { FilePreview as FilePreviewSurface } from "@/components/secondary-panel/FilePreview";

const APP_HEADER_MODE = "none";

export interface AppViewerProps {
  applicationId: string;
  /**
   * Thread the app posts into via its `message` capability. `null` on the
   * standalone surface, where the app renders without a host thread.
   */
  targetThreadId: string | null;
}

/**
 * Canonical renderer for a global app's entry. Resolves the app manifest, then
 * serves the HTML entry through the injected `/api/v1/apps/:id/` iframe (the
 * same route the in-thread tab uses) or renders a markdown entry statically.
 * Shared by the in-thread `AppTabContent` panel and the standalone app route so
 * there is a single app-rendering path.
 */
export function AppViewer({ applicationId, targetThreadId }: AppViewerProps) {
  const appDetail = useApp(applicationId);
  const markdownEntryPath =
    appDetail.data?.entry.kind === "md" ? appDetail.data.entry.path : null;
  const markdownPreview = useAppMarkdownPreview(
    applicationId,
    markdownEntryPath,
    {
      enabled: markdownEntryPath !== null,
    },
  );
  const markdownAssetBaseUrl = useMemo(() => {
    if (markdownEntryPath === null) {
      return null;
    }
    return buildAppPublicBaseUrl(applicationId, markdownEntryPath);
  }, [applicationId, markdownEntryPath]);
  const markdownUrlTransform = useMemo(() => {
    if (markdownAssetBaseUrl === null) {
      return undefined;
    }
    return createAssetMarkdownUrlTransform(markdownAssetBaseUrl);
  }, [markdownAssetBaseUrl]);
  const htmlEntryUrl = useMemo(
    () =>
      buildAppEntryUrl({
        applicationId,
        targetThreadId,
        reloadToken: appDetail.dataUpdatedAt,
      }),
    [appDetail.dataUpdatedAt, applicationId, targetThreadId],
  );

  if (appDetail.isError) {
    return (
      <FilePreviewSurface
        path={applicationId}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message:
            appDetail.error instanceof Error
              ? appDetail.error.message
              : "Failed to load app.",
        }}
      />
    );
  }

  if (!appDetail.data) {
    return (
      <FilePreviewSurface
        path={applicationId}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "loading" }}
      />
    );
  }

  if (appDetail.data.entry.kind === "html") {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "iframe",
          sandbox: null,
          title: appDetail.data.name,
          url: htmlEntryUrl,
        }}
      />
    );
  }

  if (markdownPreview.isError) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message:
            markdownPreview.error instanceof Error
              ? markdownPreview.error.message
              : "Failed to load app entry.",
        }}
      />
    );
  }

  if (!markdownPreview.data) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "loading" }}
      />
    );
  }

  if (markdownPreview.data.kind !== "text") {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message: `Preview not available for ${markdownPreview.data.mimeType}.`,
        }}
      />
    );
  }

  if (markdownPreview.data.content.length === 0) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "empty" }}
      />
    );
  }

  return (
    <FilePreviewSurface
      path={appDetail.data.name}
      headerMode={APP_HEADER_MODE}
      state={{
        kind: "ready",
        lineNumber: null,
        showMarkdownModeToggle: false,
        markdownUrlTransform,
        file: {
          name: markdownPreview.data.name ?? appDetail.data.entry.path,
          contents: markdownPreview.data.content,
        },
      }}
    />
  );
}
