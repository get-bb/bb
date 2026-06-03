import { useMemo } from "react";
import {
  useApp,
  useAppMarkdownPreview,
} from "@/hooks/queries/thread-queries";
import {
  buildAppAssetBaseUrl,
  buildAppEntryUrl,
} from "@/lib/file-content-urls";
import { createAssetMarkdownUrlTransform } from "@/lib/markdown-url-transform";
import { FilePreview as FilePreviewSurface } from "./FilePreview";

const APP_HEADER_MODE = "none";

interface BuildReloadableAppEntryUrlArgs {
  applicationId: string;
  reloadToken: number;
  threadId: string;
}

export interface AppTabContentProps {
  applicationId: string;
  threadId: string;
}

function buildReloadableAppEntryUrl({
  applicationId,
  reloadToken,
  threadId,
}: BuildReloadableAppEntryUrlArgs): string {
  return `${buildAppEntryUrl(applicationId, threadId)}&v=${encodeURIComponent(
    String(reloadToken),
  )}`;
}

export function AppTabContent({ applicationId, threadId }: AppTabContentProps) {
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
    return buildAppAssetBaseUrl(applicationId, markdownEntryPath);
  }, [applicationId, markdownEntryPath]);
  const markdownUrlTransform = useMemo(() => {
    if (markdownAssetBaseUrl === null) {
      return undefined;
    }
    return createAssetMarkdownUrlTransform(markdownAssetBaseUrl);
  }, [markdownAssetBaseUrl]);
  const htmlEntryUrl = useMemo(
    () =>
      buildReloadableAppEntryUrl({
        applicationId,
        reloadToken: appDetail.dataUpdatedAt,
        threadId,
      }),
    [appDetail.dataUpdatedAt, applicationId, threadId],
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
