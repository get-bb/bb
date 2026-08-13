import type {
  EventProjectionAssistantTextMessage,
  EventProjectionMessage,
} from "./event-projection-types.js";
import {
  flushToolActivityBeforeNonToolMessage,
  type ToolActivityProjectionState,
} from "./tool-activity-projection.js";
import {
  flushVisibleTextBuffer,
  getVisibleTextBufferText,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";

export interface AssistantStreamProjectionState extends ToolActivityProjectionState {
  messages: EventProjectionMessage[];
  openAssistantMessagesByKey: Map<string, EventProjectionAssistantTextMessage>;
  assistantTextBuffersByKey: Map<string, VisibleTextBuffer>;
  visibleAssistantMessageKeys: Set<string>;
  finalizedAssistantMessageKeys: Set<string>;
}

interface SyncBufferedTextMessageArgs {
  buffer: VisibleTextBuffer;
  messageKey: string;
  message: EventProjectionAssistantTextMessage;
  state: AssistantStreamProjectionState;
  status: EventProjectionAssistantTextMessage["status"];
  visibleKeys: Set<string>;
}

interface FlushBufferedTextMessagesArgs {
  buffers: Map<string, VisibleTextBuffer>;
  finalizedKeys: Set<string>;
  openMessages: Map<string, EventProjectionAssistantTextMessage>;
  shouldFlush: (message: EventProjectionAssistantTextMessage) => boolean;
  state: AssistantStreamProjectionState;
  visibleKeys: Set<string>;
}

export function finalizeProjectionKey(
  finalizedKeys: Set<string>,
  messageKey: string,
): void {
  finalizedKeys.add(messageKey);
}

export function syncBufferedTextMessage(
  args: SyncBufferedTextMessageArgs,
): void {
  const text = getVisibleTextBufferText(args.buffer);
  if (!text) {
    if (args.status === "completed") {
      args.message.status = "completed";
    }
    return;
  }

  args.message.text = text;
  args.message.status = args.status;
  if (args.visibleKeys.has(args.messageKey)) {
    return;
  }

  flushToolActivityBeforeNonToolMessage(args.state);
  args.state.messages.push(args.message);
  args.visibleKeys.add(args.messageKey);
}

function flushBufferedTextMessages(args: FlushBufferedTextMessagesArgs): void {
  const pendingMessages = Array.from(args.openMessages.entries())
    .filter(([, message]) => args.shouldFlush(message))
    .sort(
      (left, right) =>
        left[1].sourceSeqStart - right[1].sourceSeqStart ||
        left[1].sourceSeqEnd - right[1].sourceSeqEnd ||
        left[1].createdAt - right[1].createdAt,
    );

  for (const [messageKey, message] of pendingMessages) {
    const buffer = args.buffers.get(messageKey);
    if (buffer) {
      flushVisibleTextBuffer(buffer);
      syncBufferedTextMessage({
        buffer,
        messageKey,
        message,
        state: args.state,
        status: "completed",
        visibleKeys: args.visibleKeys,
      });
    } else {
      message.status = "completed";
    }
    args.finalizedKeys.add(messageKey);
    args.openMessages.delete(messageKey);
    args.buffers.delete(messageKey);
    args.visibleKeys.delete(messageKey);
  }
}

export function flushBufferedAssistantMessages(
  state: AssistantStreamProjectionState,
): void {
  flushBufferedTextMessages({
    buffers: state.assistantTextBuffersByKey,
    finalizedKeys: state.finalizedAssistantMessageKeys,
    openMessages: state.openAssistantMessagesByKey,
    shouldFlush: () => true,
    state,
    visibleKeys: state.visibleAssistantMessageKeys,
  });
}

export function flushBufferedAssistantMessagesForTurn(
  state: AssistantStreamProjectionState,
  turnId: string,
): void {
  flushBufferedTextMessages({
    buffers: state.assistantTextBuffersByKey,
    finalizedKeys: state.finalizedAssistantMessageKeys,
    openMessages: state.openAssistantMessagesByKey,
    shouldFlush: (message) =>
      message.scope.kind === "turn" && message.scope.turnId === turnId,
    state,
    visibleKeys: state.visibleAssistantMessageKeys,
  });
}
