import { useMemo } from "react";
import {
  ActionSheet,
  type ActionSheetAction,
  type SheetController,
} from "@/ui";
import {
  buildMessageActionItems,
  capabilitiesFromHandlers,
  runMessageAction,
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

/**
 * The long-press menu for a conversation message (web MessageActionBar as a
 * bottom sheet): copy, quote paragraph / add to chat, edit, fork, send to
 * main thread — each present only when the host supplied its handler and
 * the message qualifies. Both platforms: the timeline rows are recycled
 * FlashList cells, so they keep a plain long-press instead of hosting a
 * per-row native context menu (which would pin each cell's size to its
 * first SwiftUI measurement).
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
      onPress: () => runMessageAction(item, target, handlers, onCopy),
    }));
  }, [handlers, onCopy, target]);
  return <ActionSheet controller={controller} actions={actions} />;
}
