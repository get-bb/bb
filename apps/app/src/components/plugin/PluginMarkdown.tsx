import { useMemo } from "react";
import type { MarkdownProps } from "@get-bb/plugin-sdk";
import { getEnvironmentFilePreviewSourceAtRef } from "@bb/client-core";
import { normalizeAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import {
  MarkdownPreview,
  type MarkdownThreadMentions,
} from "@/components/ui/markdown-preview";
import { buildMarkdownFileRouting } from "@/components/ui/markdown-file-routing";
import {
  useMessageLinkRouting,
  useThreadTimelineNavigation,
} from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  buildEnvironmentFileContentUrl,
  buildThreadStorageRawContentUrl,
} from "@/lib/file-content-urls";
import { normalizeExperimentalLiveFileTarget } from "@/lib/live-file-navigation";
import { useLocalFileLinkOpener } from "@/hooks/useLocalFileLinkOpener";
import { useResolvedLiveFileRoot } from "@/hooks/useResolvedLiveFileTarget";

const PLUGIN_MARKDOWN_THREAD_MENTIONS: MarkdownThreadMentions = {
  mentions: [],
  preserveSoftBreaks: false,
};

function parsePluginMarkdownDocument(
  document: NonNullable<MarkdownProps["experimental_document"]>,
) {
  const target = normalizeExperimentalLiveFileTarget(document.target);
  const threadId: unknown = document.threadId;
  const documentRootPath: unknown = document.rootPath;
  const rootPath =
    typeof documentRootPath === "string"
      ? normalizeAbsoluteFilePath({ path: documentRootPath })
      : null;
  if (
    target === null ||
    target.kind === "host" ||
    rootPath === null ||
    typeof threadId !== "string" ||
    !threadId.trim() ||
    (target.kind === "thread-storage" && target.threadId !== threadId)
  ) {
    return null;
  }
  return { rootPath, target, threadId };
}

type PluginMarkdownDocument = NonNullable<
  ReturnType<typeof parsePluginMarkdownDocument>
>;

function usePluginMarkdownMessageRouting() {
  return useMessageLinkRouting(useThreadTimelineNavigation()?.threadId);
}

function PluginDocumentMarkdown({
  className,
  content,
  document,
}: Pick<MarkdownProps, "className" | "content"> & {
  document: PluginMarkdownDocument;
}) {
  const messageRouting = usePluginMarkdownMessageRouting();
  const navigation = useAppNavigationHost();
  const { rootPath, target, threadId } = document;
  const root = useResolvedLiveFileRoot(target);
  const { openLink } = useLocalFileLinkOpener({
    canOpenInEditor: true,
    hostId: root.status === "available" ? root.hostId : null,
    openFilePreview: navigation.openFilePreview,
    threadStorage:
      target.kind === "thread-storage" ? { rootPath, threadId } : null,
    workspace:
      target.kind === "workspace"
        ? {
            environmentId: target.environmentId,
            rootPath,
            ...(target.experimental_ref === undefined
              ? {}
              : { experimental_ref: target.experimental_ref }),
          }
        : null,
  });
  const linkRouting = useMemo(
    () =>
      buildMarkdownFileRouting({
        path: target.path,
        rootPath,
        threadId,
        resolveRelativeSrc: (path) =>
          target.kind === "workspace"
            ? buildEnvironmentFileContentUrl(
                target.environmentId,
                getEnvironmentFilePreviewSourceAtRef(target.experimental_ref),
                path,
              )
            : buildThreadStorageRawContentUrl(threadId, path),
        openLink,
        openOutsideRoot: messageRouting?.localFile?.onOpenLink ?? (() => false),
      }),
    [messageRouting, openLink, rootPath, target, threadId],
  );
  return (
    <MarkdownPreview
      allowHtml
      content={content}
      className={className}
      linkRouting={linkRouting}
      threadMentions={PLUGIN_MARKDOWN_THREAD_MENTIONS}
    />
  );
}

export function PluginMarkdown({
  content,
  className,
  experimental_document,
}: MarkdownProps) {
  const messageRouting = usePluginMarkdownMessageRouting();
  const document = useMemo(
    () =>
      experimental_document === undefined
        ? undefined
        : parsePluginMarkdownDocument(experimental_document),
    [experimental_document],
  );
  if (document) {
    return (
      <PluginDocumentMarkdown
        className={className}
        content={content}
        document={document}
      />
    );
  }
  return (
    <MarkdownPreview
      allowHtml
      content={content}
      className={className}
      linkRouting={document === null ? {} : messageRouting}
      threadMentions={PLUGIN_MARKDOWN_THREAD_MENTIONS}
    />
  );
}
