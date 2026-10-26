import { useCallback, useMemo } from "react";
import type { MarkdownProps } from "@get-bb/plugin-sdk";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";
import { buildMarkdownDocumentLinkRouting } from "@/components/ui/markdown-document-link-routing";
import { buildMarkdownMessageLinkRouting } from "@/components/ui/markdown-message-link-routing";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { useThreadTimelineNavigation } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { useAppNavigationHost } from "@/lib/app-navigation-host";

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
  const onOpenLink = useCallback<MarkdownPreviewLinkHandler>(
    ({ href }) => navigation.openUrl({ url: href }),
    [navigation],
  );
  const linkRouting = useMemo<MarkdownLinkRouting>(() => {
    const messageRouting = buildMarkdownMessageLinkRouting({
      onOpenLink,
      onOpenLocalFileLink,
      threadId,
      workspaceRootPath,
    }) ?? { onOpenLink };
    return experimental_document === undefined
      ? messageRouting
      : buildMarkdownDocumentLinkRouting({
          document: experimental_document,
          messageRouting,
          openFilePreview: navigation.openFilePreview,
        });
  }, [
    experimental_document,
    navigation.openFilePreview,
    onOpenLink,
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
    />
  );
}
