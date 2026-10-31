import { useMemo } from "react";
import type { MarkdownProps } from "@get-bb/plugin-sdk";
import { getEnvironmentFilePreviewSourceAtRef } from "@bb/client-core";
import { normalizeAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import {
  MarkdownPreview,
  type MarkdownThreadMentions,
} from "@/components/ui/markdown-preview";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";
import { buildMarkdownFileRouting } from "@/components/ui/markdown-file-routing";
import { buildMarkdownMessageLinkRouting } from "@/components/ui/markdown-message-link-routing";
import { useThreadTimelineNavigation } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  buildEnvironmentFileContentUrl,
  buildThreadStorageRawContentUrl,
} from "@/lib/file-content-urls";
import { normalizeExperimentalLiveFileTarget } from "@/lib/live-file-navigation";

const PLUGIN_MARKDOWN_THREAD_MENTIONS: MarkdownThreadMentions = {
  mentions: [],
  preserveSoftBreaks: false,
};

export function PluginMarkdown({
  content,
  className,
  experimental_document,
}: MarkdownProps) {
  const timelineNavigation = useThreadTimelineNavigation();
  const onOpenLocalFileLink = timelineNavigation?.onOpenLocalFileLink;
  const threadId = timelineNavigation?.threadId;
  const workspaceRootPath = timelineNavigation?.workspaceRootPath;
  const navigation = useAppNavigationHost();
  const linkRouting = useMemo<MarkdownLinkRouting | undefined>(() => {
    const messageRouting = buildMarkdownMessageLinkRouting({
      onOpenLocalFileLink,
      threadId,
      workspaceRootPath,
    });
    if (experimental_document === undefined) return messageRouting;
    const target = normalizeExperimentalLiveFileTarget(
      experimental_document.target,
    );
    const documentThreadId: unknown = experimental_document.threadId;
    const documentRootPath: unknown = experimental_document.rootPath;
    const rootPath =
      typeof documentRootPath === "string"
        ? normalizeAbsoluteFilePath({ path: documentRootPath })
        : null;
    if (
      target === null ||
      target.kind === "host" ||
      rootPath === null ||
      typeof documentThreadId !== "string" ||
      !documentThreadId.trim() ||
      (target.kind === "thread-storage" && target.threadId !== documentThreadId)
    ) {
      return {};
    }
    return buildMarkdownFileRouting({
      path: target.path,
      rootPath,
      threadId: documentThreadId,
      resolveRelativeSrc: (path) =>
        target.kind === "workspace"
          ? buildEnvironmentFileContentUrl(
              target.environmentId,
              getEnvironmentFilePreviewSourceAtRef(target.experimental_ref),
              path,
            )
          : buildThreadStorageRawContentUrl(documentThreadId, path),
      openFile: (path, _absolutePath, location) =>
        navigation.openFilePreview({ target: { ...target, path }, location }),
      openOutsideRoot: messageRouting?.localFile?.onOpenLink ?? (() => false),
    });
  }, [
    experimental_document,
    navigation,
    onOpenLocalFileLink,
    threadId,
    workspaceRootPath,
  ]);

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
