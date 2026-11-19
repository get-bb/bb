import { useMemo } from "react";
import type {
  MarkdownProps,
  PluginMessageDirectiveMessage,
} from "@get-bb/plugin-sdk";
import { getEnvironmentFilePreviewSourceAtRef } from "@bb/client-core";
import { normalizeAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import {
  AUTHORED_MARKDOWN_THREAD_MENTIONS,
  MarkdownPreview,
} from "@/components/ui/markdown-preview";
import { buildMarkdownFileRouting } from "@/components/ui/markdown-file-routing";
import { WithoutCodeFenceRenderers } from "@/components/ui/markdown-code-fence-renderers";
import type { MarkdownMessageDirectives } from "@/components/ui/markdown-message-directives";
import {
  MessageCodeFences,
  MessageSlotRegistriesProvider,
  useMessageDirectives,
} from "@/components/ui/message-markdown-slots";
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
  messageDirectives,
}: Pick<MarkdownProps, "className" | "content"> & {
  document: PluginMarkdownDocument;
  messageDirectives: MarkdownMessageDirectives | undefined;
}) {
  const messageRouting = usePluginMarkdownMessageRouting();
  const navigation = useAppNavigationHost();
  const { rootPath, target, threadId } = document;
  const root = useResolvedLiveFileRoot(target);
  const hostId = root.status === "available" ? root.hostId : null;
  const { openLink } = useLocalFileLinkOpener({
    canOpenInEditor: true,
    hostId,
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
        hostId,
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
    [hostId, messageRouting, openLink, rootPath, target, threadId],
  );
  return (
    <MarkdownPreview
      allowHtml
      content={content}
      className={className}
      linkRouting={linkRouting}
      messageDirectives={messageDirectives}
      threadMentions={AUTHORED_MARKDOWN_THREAD_MENTIONS}
    />
  );
}

function PluginMarkdownBody({
  content,
  className,
  experimental_document,
  messageDirectives,
}: MarkdownProps & {
  messageDirectives: MarkdownMessageDirectives | undefined;
}) {
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
        messageDirectives={messageDirectives}
      />
    );
  }
  return (
    <MarkdownPreview
      allowHtml
      content={content}
      className={className}
      linkRouting={document === null ? {} : messageRouting}
      messageDirectives={messageDirectives}
      threadMentions={AUTHORED_MARKDOWN_THREAD_MENTIONS}
    />
  );
}

function parsePluginMarkdownMessage(
  message: PluginMessageDirectiveMessage,
): PluginMessageDirectiveMessage | null {
  const { id, threadId, turnId, projectId }: Record<string, unknown> = {
    ...message,
  };
  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof threadId !== "string" ||
    !threadId.trim() ||
    (turnId !== null && typeof turnId !== "string") ||
    (projectId !== null && typeof projectId !== "string")
  ) {
    return null;
  }
  return { id, threadId, turnId, projectId };
}

function PluginMessageMarkdown({
  message: { id, threadId, turnId, projectId },
  ...props
}: MarkdownProps & { message: PluginMessageDirectiveMessage }) {
  const message = useMemo(
    () => ({ id, threadId, turnId, projectId }),
    [id, threadId, turnId, projectId],
  );
  const messageDirectives = useMessageDirectives(message, null);
  return (
    <MessageCodeFences message={message} streaming={false}>
      <PluginMarkdownBody {...props} messageDirectives={messageDirectives} />
    </MessageCodeFences>
  );
}

export function PluginMarkdown({
  experimental_message,
  ...props
}: MarkdownProps) {
  const message =
    experimental_message === undefined
      ? null
      : parsePluginMarkdownMessage(experimental_message);
  if (message === null) {
    return (
      <WithoutCodeFenceRenderers>
        <PluginMarkdownBody {...props} messageDirectives={undefined} />
      </WithoutCodeFenceRenderers>
    );
  }
  return (
    <MessageSlotRegistriesProvider>
      <PluginMessageMarkdown {...props} message={message} />
    </MessageSlotRegistriesProvider>
  );
}
