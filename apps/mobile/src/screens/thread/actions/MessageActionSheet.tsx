import { useMemo } from "react";
import {
  ActionSheet,
  type ActionSheetAction,
  type SheetController,
} from "@/ui";
import {
  buildEditMessageRequest,
  buildMessageActionItems,
  capabilitiesFromHandlers,
  type MessageActionItem,
  type TimelineMessageActionHandlers,
  type TimelineMessageActionsTarget,
} from "./message-actions-model";

interface MessageActionSheetProps {
  controller: SheetController;
  /** The long-pressed message; null before the first press. */
  target: TimelineMessageActionsTarget | null;
  handlers: TimelineMessageActionHandlers;
  /** Copies `text` to the clipboard (the host owns the toast). */
  onCopy: (text: string) => void;
}

function runAction(
  item: MessageActionItem,
  target: TimelineMessageActionsTarget,
  handlers: TimelineMessageActionHandlers,
  onCopy: (text: string) => void,
): void {
  switch (item.key) {
    case "copy":
      onCopy(target.text);
      return;
    case "quote-paragraph":
      if (target.paragraph !== null) {
        handlers.quoteIntoComposer?.(target.paragraph);
      }
      return;
    case "add-to-chat":
      handlers.quoteIntoComposer?.(target.text);
      return;
    case "edit":
      handlers.editMessage?.(buildEditMessageRequest(target));
      return;
    case "fork":
      handlers.forkFromMessage?.({ sourceSeqEnd: target.sourceSeqEnd });
      return;
    case "send-to-main":
      handlers.sendToMainThread?.({ messageText: target.text });
      return;
  }
}

/**
 * The long-press menu for a conversation message (web MessageActionBar as a
 * bottom sheet): copy, quote paragraph / add to chat, edit, fork, send to
 * main thread — each present only when the host supplied its handler and
 * the message qualifies.
 */
export function MessageActionSheet({
  controller,
  target,
  handlers,
  onCopy,
}: MessageActionSheetProps) {
  const actions = useMemo<ActionSheetAction[]>(() => {
    if (target === null) return [];
    return buildMessageActionItems(
      target,
      capabilitiesFromHandlers(handlers),
    ).map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      onPress: () => runAction(item, target, handlers, onCopy),
    }));
  }, [handlers, onCopy, target]);
  return <ActionSheet controller={controller} actions={actions} />;
}
