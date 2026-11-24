import { toast } from "sonner";
import type { ThreadChatMessageReference } from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_copyToClipboard,
} from "@get-bb/plugin-sdk/app";

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
    experimental_availability: ({ messageRequests }) =>
      enabledWhen(messageRequests.addToChat !== null),
    run({
      selectedText,
      experimental_selectedMarkdown,
      experimental_messageRequests,
    }) {
      const text = experimental_selectedMarkdown ?? selectedText;
      if (text === undefined) return;
      experimental_messageRequests.addToChat?.(text);
    },
  });
  app.slots.messageAction({
    id: "addToChat",
    title: "Add to chat",
    icon: "MessageSquarePlus",
    experimental_placements: ["menu"],
    experimental_order: 10,
    experimental_availability: ({ message, messageRequests }) =>
      enabledWhen(
        messageRequests.addToChat !== null &&
          (hasCopyableContent(message) ||
            message.experimental_attachments.length > 0),
      ),
    run({ message, experimental_messageRequests }) {
      const addToChat = experimental_messageRequests.addToChat;
      if (addToChat === null) return;
      const attachments = message.experimental_attachments;
      if (attachments.length > 0) {
        addToChat(copyableText(message), attachments);
      } else {
        addToChat(copyableText(message));
      }
    },
  });
  app.slots.messageAction({
    id: "fork",
    title: "Fork into new thread",
    icon: "Fork",
    experimental_roles: ["assistant"],
    experimental_placements: ["menu"],
    experimental_order: 20,
    experimental_availability: ({ messageRequests, canSpawnChild }) => {
      if (messageRequests.fork === null) return "hidden";
      return canSpawnChild ? "enabled" : "disabled";
    },
    run({ experimental_messageRequests }) {
      experimental_messageRequests.fork?.();
    },
  });
});
