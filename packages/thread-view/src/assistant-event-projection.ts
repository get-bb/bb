import type { ThreadEvent } from "@bb/domain";
import {
  parseAssistantDeltaText,
  parseAssistantFinalText,
  parseReasoningDeltaText,
  parseReasoningFinalText,
} from "./assistant-buffering.js";
import {
  projectBufferedTextEvent,
  projectReasoningTextEvent,
} from "./buffered-text-projection.js";
import { resolveBufferedTextIdentity } from "./buffered-text-identity.js";
import type { EventMeta } from "./event-decode.js";
import type { EventProjectionAssistantTextMessage } from "./event-projection-types.js";
import { messageId } from "./format-helpers.js";
import {
  finalizeReasoningLifecycle,
  trackReasoningTurn,
  upsertReasoningLifecycle,
} from "./reasoning-lifecycle-projection.js";
import type { ProjectionState } from "./event-projection-state.js";

interface ProjectAssistantAndReasoningEventArgs {
  decoded: ThreadEvent;
  eventParentToolCallId: string | undefined;
  eventTurnId: string | undefined;
  meta: EventMeta;
  shouldTrackActiveThinking: boolean;
  state: ProjectionState;
}

interface CreateAssistantTextMessageArgs {
  decoded: ThreadEvent;
  eventParentToolCallId: string | undefined;
  messageKey: string;
  meta: EventMeta;
}

function createAssistantTextMessage(
  args: CreateAssistantTextMessageArgs,
): EventProjectionAssistantTextMessage {
  return {
    kind: "assistant-text",
    id: messageId(args.decoded.threadId, "assistant", args.messageKey),
    threadId: args.decoded.threadId,
    sourceSeqStart: args.meta.seq,
    sourceSeqEnd: args.meta.seq,
    createdAt: args.meta.createdAt,
    startedAt: args.meta.createdAt,
    scope: args.decoded.scope,
    ...(args.eventParentToolCallId
      ? { parentToolCallId: args.eventParentToolCallId }
      : {}),
    text: "",
    status: "streaming",
  };
}

export function projectAssistantAndReasoningEvent(
  args: ProjectAssistantAndReasoningEventArgs,
): boolean {
  if (
    args.decoded.type === "item/agentMessage/delta" ||
    (args.decoded.type === "item/completed" &&
      args.decoded.item.type === "agentMessage")
  ) {
    const assistantIdentity = resolveBufferedTextIdentity({
      decoded: args.decoded,
      kind: "assistant",
      parentToolCallId: args.eventParentToolCallId,
      turnId: args.eventTurnId,
    });

    return projectBufferedTextEvent({
      createMessage: (messageKey) =>
        createAssistantTextMessage({
          decoded: args.decoded,
          eventParentToolCallId: args.eventParentToolCallId,
          messageKey,
          meta: args.meta,
        }),
      identity: assistantIdentity,
      meta: args.meta,
      mode: args.decoded.type === "item/agentMessage/delta" ? "delta" : "final",
      refs: {
        finalizedKeys: args.state.finalizedAssistantMessageKeys,
        openMessages: args.state.openAssistantMessagesByKey,
        textBuffers: args.state.assistantTextBuffersByKey,
        visibleKeys: args.state.visibleAssistantMessageKeys,
      },
      state: args.state,
      text:
        args.decoded.type === "item/agentMessage/delta"
          ? parseAssistantDeltaText(args.decoded)
          : parseAssistantFinalText(args.decoded),
    });
  }

  if (
    args.decoded.type === "item/started" &&
    args.decoded.item.type === "reasoning"
  ) {
    const reasoningIdentity = resolveBufferedTextIdentity({
      decoded: args.decoded,
      kind: "reasoning",
      parentToolCallId: args.eventParentToolCallId,
      turnId: args.eventTurnId,
    });
    trackReasoningTurn(args.state, reasoningIdentity);
    if (args.shouldTrackActiveThinking) {
      upsertReasoningLifecycle({
        identity: reasoningIdentity,
        meta: args.meta,
        state: args.state,
      });
    }
    return false;
  }

  if (
    args.decoded.type === "item/reasoning/summaryTextDelta" ||
    args.decoded.type === "item/reasoning/textDelta" ||
    (args.decoded.type === "item/completed" &&
      args.decoded.item.type === "reasoning")
  ) {
    const reasoningIdentity = resolveBufferedTextIdentity({
      decoded: args.decoded,
      kind: "reasoning",
      parentToolCallId: args.eventParentToolCallId,
      turnId: args.eventTurnId,
    });
    trackReasoningTurn(args.state, reasoningIdentity);
    if (args.shouldTrackActiveThinking) {
      upsertReasoningLifecycle({
        identity: reasoningIdentity,
        meta: args.meta,
        state: args.state,
      });
    }

    if (
      args.decoded.type === "item/reasoning/summaryTextDelta" ||
      args.decoded.type === "item/reasoning/textDelta"
    ) {
      return projectReasoningTextEvent({
        identity: reasoningIdentity,
        mode: "delta",
        state: args.state,
        text: parseReasoningDeltaText(args.decoded),
      });
    }

    const projectedFinalReasoning = projectReasoningTextEvent({
      identity: reasoningIdentity,
      mode: "final",
      state: args.state,
      text: parseReasoningFinalText(args.decoded),
    });
    finalizeReasoningLifecycle(args.state, reasoningIdentity);
    if (projectedFinalReasoning) {
      return true;
    }
  }

  return false;
}
