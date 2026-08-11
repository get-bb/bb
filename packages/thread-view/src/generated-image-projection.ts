import type { ThreadEvent } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";
import type { EventProjectionGeneratedImageMessage } from "./event-projection-types.js";
import { messageId } from "./format-helpers.js";
import {
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";

interface ProjectGeneratedImageArgs {
  decoded: ThreadEvent;
  eventParentToolCallId: string | undefined;
  eventTurnId: string | undefined;
  meta: EventMeta;
}

export function projectGeneratedImage({
  decoded,
  eventParentToolCallId,
  eventTurnId,
  meta,
}: ProjectGeneratedImageArgs): EventProjectionGeneratedImageMessage | null {
  if (
    decoded.type !== "item/completed" ||
    decoded.item.type !== "imageGeneration"
  ) {
    return null;
  }

  const itemId = decoded.item.id;
  return {
    kind: "generated-image",
    id: messageId(decoded.threadId, "generated-image", itemId),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(eventTurnId
      ? eventProjectionMessageTurnScopeFields(eventTurnId)
      : eventProjectionMessageThreadScopeFields()),
    ...(eventParentToolCallId
      ? { parentToolCallId: eventParentToolCallId }
      : {}),
    itemId,
    path: decoded.item.path,
  };
}
