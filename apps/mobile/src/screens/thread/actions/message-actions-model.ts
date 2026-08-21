import type { PromptInput, PromptTextMention } from "@bb/domain";
import type {
  TimelineConversationAttachments,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { IconName } from "@/ui/icon-map";

/**
 * Pure policy behind the long-press message action sheet (port of the web
 * MessageActionBar + ThreadTimelineRows action wiring): what a row offers,
 * in which order, and the edit payload a user row hands to the composer.
 */

/** A message the long-press action sheet acts on. */
export interface TimelineMessageActionsTarget {
  rowId: string;
  role: "user" | "assistant";
  /** The message's full source text (Copy text / Add to chat). */
  text: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  /**
   * The single block's source when the long-press landed on one paragraph
   * of the body (offers "Quote paragraph"); null for a whole-message press.
   */
  paragraph: string | null;
  /**
   * User rows: whether the sent message may still be edited (web
   * `canEditMessage`); always false for assistant rows.
   */
  editable: boolean;
  mentions: readonly PromptTextMention[];
  attachments: TimelineConversationAttachments | null;
}

export interface EditMessageRequest {
  rowId: string;
  text: string;
  mentions: readonly PromptTextMention[];
  input: PromptInput[];
  /** The row's `sourceSeqStart`: the edit is refused if the thread moved on. */
  expectedRequestSequence: number;
}

/**
 * What the hosting screen can do with a message. An absent handler means
 * the capability is not available here (no composer mounted, provider that
 * cannot fork, not a side chat) and its action is left out of the sheet.
 */
export interface TimelineMessageActionHandlers {
  /** Quote text into the composer draft (Add to chat / Quote paragraph). */
  quoteIntoComposer?: (text: string) => void;
  /** Hand a sent user message to the composer's edit mode. */
  editMessage?: (request: EditMessageRequest) => void;
  /** Fork the thread from this message (provider history up to it). */
  forkFromMessage?: (target: { sourceSeqEnd: number }) => void;
  /** Side chats only: queue this message on the main thread. */
  sendToMainThread?: (target: { messageText: string }) => void;
}

type MessageActionKey =
  | "copy"
  | "quote-paragraph"
  | "add-to-chat"
  | "fork"
  | "send-to-main"
  | "edit";

export interface MessageActionItem {
  key: MessageActionKey;
  label: string;
  icon: IconName;
}

interface MessageActionCapabilities {
  canQuote: boolean;
  canEdit: boolean;
  canFork: boolean;
  canSendToMain: boolean;
}

export function capabilitiesFromHandlers(
  handlers: TimelineMessageActionHandlers,
): MessageActionCapabilities {
  return {
    canQuote: handlers.quoteIntoComposer !== undefined,
    canEdit: handlers.editMessage !== undefined,
    canFork: handlers.forkFromMessage !== undefined,
    canSendToMain: handlers.sendToMainThread !== undefined,
  };
}

/**
 * The sheet's rows for one message, in the web action-bar order: copy,
 * quote paragraph (when one was pressed), add to chat, edit (own sent
 * messages), fork, send to main thread (assistant rows in a side chat).
 */
export function buildMessageActionItems(
  target: TimelineMessageActionsTarget,
  capabilities: MessageActionCapabilities,
): MessageActionItem[] {
  const hasText = target.text.trim().length > 0;
  const items: MessageActionItem[] = [];
  if (hasText) {
    items.push({ key: "copy", label: "Copy text", icon: "Copy" });
  }
  if (
    capabilities.canQuote &&
    target.paragraph !== null &&
    target.paragraph.trim().length > 0 &&
    target.paragraph.trim() !== target.text.trim()
  ) {
    items.push({
      key: "quote-paragraph",
      label: "Quote paragraph",
      icon: "MessageSquarePlus",
    });
  }
  if (capabilities.canQuote && hasText) {
    items.push({
      key: "add-to-chat",
      label: "Add to chat",
      icon: "MessageSquarePlus",
    });
  }
  if (capabilities.canEdit && target.role === "user" && target.editable) {
    items.push({ key: "edit", label: "Edit message", icon: "Edit" });
  }
  if (capabilities.canFork && target.role === "assistant") {
    items.push({ key: "fork", label: "Fork from here", icon: "Fork" });
  }
  if (capabilities.canSendToMain && target.role === "assistant" && hasText) {
    items.push({
      key: "send-to-main",
      label: "Send to main thread",
      icon: "ArrowTurnBackward",
    });
  }
  return items;
}

/**
 * Web `canEditMessage`: only the person's own plain message requests that
 * were accepted, not grouped into a batch, and carry no image URLs.
 */
export function canEditUserMessage(
  row: Pick<
    TimelineUserConversationRow,
    "initiator" | "turnRequest" | "attachments"
  >,
): boolean {
  return (
    row.initiator === "user" &&
    !row.turnRequest.isGrouped &&
    row.turnRequest.kind === "message" &&
    row.turnRequest.status === "accepted" &&
    (row.attachments?.imageUrls.length ?? 0) === 0
  );
}

/** The prompt input an edit resubmits: text + mentions, then local images and files. */
function buildEditMessageInput(
  target: Pick<
    TimelineMessageActionsTarget,
    "text" | "mentions" | "attachments"
  >,
): PromptInput[] {
  const input: PromptInput[] = [];
  if (target.text.trim().length > 0) {
    input.push({
      type: "text",
      text: target.text,
      mentions: [...target.mentions],
    });
  }
  for (const path of target.attachments?.localImagePaths ?? []) {
    input.push({ type: "localImage", path });
  }
  for (const path of target.attachments?.localFilePaths ?? []) {
    input.push({ type: "localFile", path });
  }
  return input;
}

export function buildEditMessageRequest(
  target: TimelineMessageActionsTarget,
): EditMessageRequest {
  return {
    rowId: target.rowId,
    text: target.text,
    mentions: target.mentions,
    input: buildEditMessageInput(target),
    expectedRequestSequence: target.sourceSeqStart,
  };
}
