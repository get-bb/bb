import { toast } from "sonner";
import type {
  ComposerAttachment,
  PluginComposerApi,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_appendQuoteToDraft,
  experimental_copyToClipboard,
  experimental_showErrorToast,
} from "@get-bb/plugin-sdk/app";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";

function copyableText(message: ThreadChatMessageReference): string {
  return message.role === "user" ? message.text.trim() : message.text;
}

function hasCopyableContent(message: ThreadChatMessageReference): boolean {
  return (
    copyableText(message).length > 0 ||
    message.experimental_imageUrls.length > 0
  );
}

async function copyMessage(
  message: ThreadChatMessageReference,
  announceSuccess: boolean,
): Promise<boolean> {
  const text = copyableText(message);
  const imageUrl = message.experimental_imageUrls[0];
  if (
    await experimental_copyToClipboard(
      imageUrl === undefined ? { text } : { text, imageUrl },
    )
  ) {
    if (announceSuccess) toast.success("Copied");
    return true;
  }
  if (
    imageUrl !== undefined &&
    text.length > 0 &&
    (await experimental_copyToClipboard({ text }))
  ) {
    toast.success("Copied text; image could not be copied");
    return true;
  }
  toast.error("Failed to copy");
  return false;
}

function addToChat(
  composer: PluginComposerApi,
  text: string,
  attachments: readonly ComposerAttachment[] = [],
): void {
  if (
    window.matchMedia(COMPACT_VIEWPORT_QUERY).matches &&
    document.activeElement instanceof HTMLElement
  ) {
    document.activeElement.blur();
  }
  composer.replace((current) =>
    experimental_appendQuoteToDraft(current, text, attachments),
  );
  composer.focus();
}

const forksInFlight = new Set<string>();

function enabledWhen(condition: boolean) {
  return condition ? "enabled" : "hidden";
}

export default definePluginApp((app) => {
  app.slots.messageAction({
    id: "copyLink",
    title: "Copy link",
    icon: "Link",
    experimental_placements: ["menu"],
    experimental_order: -30,
    experimental_availability: ({ message }) =>
      enabledWhen(message.experimental_settled),
    async run({ message, navigate }) {
      const url = new URL(
        navigate.experimental_threadHref(message.threadId, {
          messageSeq: message.experimental_messageSeq,
        }),
        window.location.origin,
      ).toString();
      if (await experimental_copyToClipboard({ text: url })) {
        toast.success("Message link copied");
      } else {
        toast.error("Failed to copy message link");
      }
    },
  });
  app.slots.messageAction({
    id: "copy",
    title: "Copy message",
    icon: "Copy",
    experimental_placements: ["inline"],
    experimental_order: -20,
    experimental_availability: ({ message }) =>
      enabledWhen(hasCopyableContent(message)),
    run: ({ message, experimental_invokedFrom }) =>
      copyMessage(message, experimental_invokedFrom !== "button"),
  });
  app.slots.messageAction({
    id: "edit",
    title: "Edit message",
    icon: "Edit",
    experimental_roles: ["user"],
    experimental_placements: ["inline"],
    experimental_order: -10,
    experimental_availability: ({ messageRequests }) =>
      enabledWhen(messageRequests.edit !== null),
    run({ experimental_messageRequests }) {
      experimental_messageRequests.edit?.();
    },
  });
  app.slots.messageAction({
    id: "addSelectionToChat",
    title: "Add to chat",
    icon: "MessageSquarePlus",
    experimental_placements: ["selection"],
    experimental_order: -10,
    experimental_availability: ({ composer }) => enabledWhen(composer !== null),
    run({ selectedText, experimental_selectedMarkdown, composer }) {
      const text = experimental_selectedMarkdown ?? selectedText;
      if (text === undefined || composer === null) return;
      addToChat(composer, text);
    },
  });
  app.slots.messageAction({
    id: "addToChat",
    title: "Add to chat",
    icon: "MessageSquarePlus",
    experimental_placements: ["menu"],
    experimental_order: 10,
    experimental_availability: ({ message, composer }) =>
      enabledWhen(
        composer !== null &&
          (hasCopyableContent(message) ||
            message.experimental_attachments.length > 0),
      ),
    run({ message, composer }) {
      if (composer === null) return;
      addToChat(
        composer,
        copyableText(message),
        message.experimental_attachments,
      );
    },
  });
  app.slots.messageAction({
    id: "fork",
    title: "Fork into new thread",
    icon: "Fork",
    experimental_roles: ["assistant"],
    experimental_placements: ["menu"],
    experimental_order: 20,
    experimental_availability: ({ canFork, canSpawnChild }) => {
      if (!canFork) return "hidden";
      return canSpawnChild ? "enabled" : "disabled";
    },
    async run({ threadId, message, sdk, navigate }) {
      if (forksInFlight.has(threadId)) return;
      forksInFlight.add(threadId);
      try {
        const fork = await sdk.threads.fork({
          sourceThreadId: threadId,
          sourceSeqEnd: message.sourceSeqEnd,
          origin: "app",
        });
        navigate.toThread(fork.id);
      } catch (error) {
        experimental_showErrorToast({
          error,
          fallbackMessage: "Failed to fork thread.",
        });
      } finally {
        forksInFlight.delete(threadId);
      }
    },
  });
});
