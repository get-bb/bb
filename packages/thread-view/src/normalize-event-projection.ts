import { getProjectionEntryMessages } from "./event-projection-flatten.js";
import { isLegacyDelegationToolCall } from "@bb/domain";
import {
  getFirstStringField,
  getMessageStartedAt,
  messageId,
} from "./format-helpers.js";
import type {
  EventProjectionDelegationMessage,
  EventProjectionMessage,
  EventProjection,
  EventProjectionEntry,
  EventProjectionToolCallMessage,
  EventProjectionTurn,
} from "./event-projection-types.js";
import { findLastTerminalTimelineMessage } from "./timeline-message-helpers.js";
import { getProjectionSummaryCount } from "./apply-turn-message-detail.js";

interface ProjectionMessageBounds {
  createdAt: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  startedAt: number;
}

interface StandaloneMessageContext {
  kind: "projected-message";
  entryIndex: number;
  message: EventProjectionMessage;
  messageIndex: number;
}

interface TurnMessageContext {
  kind: "turn";
  entryIndex: number;
  message: EventProjectionMessage;
  messageIndex: number;
  turn: EventProjectionTurn;
}

type SemanticMessageContext = StandaloneMessageContext | TurnMessageContext;

export function sortEventProjectionMessagesBySource(
  messages: EventProjectionMessage[],
): EventProjectionMessage[] {
  return messages
    .map((message, index) => ({ index, message }))
    .sort((left, right) => {
      if (left.message.sourceSeqStart !== right.message.sourceSeqStart) {
        return left.message.sourceSeqStart - right.message.sourceSeqStart;
      }
      if (left.message.createdAt !== right.message.createdAt) {
        return left.message.createdAt - right.message.createdAt;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function isDelegationSourceMessage(
  message: EventProjectionMessage,
): message is EventProjectionDelegationMessage {
  return message.kind === "delegation";
}

function toolCallAsDelegationMessage(
  message: EventProjectionToolCallMessage,
): EventProjectionDelegationMessage {
  const {
    kind: _kind,
    toolArgs,
    approvalStatus: _approvalStatus,
    ...shared
  } = message;
  const subagentType = getFirstStringField(toolArgs, [
    "subagent_type",
    "subagentType",
  ]);
  const description = getFirstStringField(toolArgs, ["description", "prompt"]);
  const model = getFirstStringField(toolArgs, ["model"]);
  return {
    ...shared,
    id: messageId(message.threadId, "delegation", message.callId),
    kind: "delegation",
    ...(subagentType ? { subagentType } : {}),
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    childRef: null,
    background: false,
    getChildProjection: () => ({
      state: {
        activeThinking: null,
        activeWorkflows: [],
        activeBackgroundCommands: [],
      },
      entries: [],
    }),
  };
}

function messageBounds(
  message: EventProjectionMessage,
): ProjectionMessageBounds {
  return {
    sourceSeqStart: message.sourceSeqStart,
    sourceSeqEnd: message.sourceSeqEnd,
    startedAt: getMessageStartedAt(message),
    createdAt: message.createdAt,
  };
}

function includeBounds(
  target: ProjectionMessageBounds,
  source: ProjectionMessageBounds,
): void {
  target.sourceSeqStart = Math.min(
    target.sourceSeqStart,
    source.sourceSeqStart,
  );
  target.sourceSeqEnd = Math.max(target.sourceSeqEnd, source.sourceSeqEnd);
  target.startedAt = Math.min(target.startedAt, source.startedAt);
  target.createdAt = Math.max(target.createdAt, source.createdAt);
}

function buildSourceTurn(
  sourceTurn: EventProjectionTurn,
  messages: EventProjectionMessage[],
): EventProjectionTurn {
  const terminalMessage = findLastTerminalTimelineMessage(messages);
  const turn: EventProjectionTurn = {
    ...sourceTurn,
    summaryCount: getProjectionSummaryCount(messages, terminalMessage),
    messages,
  };
  delete turn.terminalMessage;
  if (terminalMessage) {
    turn.terminalMessage = terminalMessage;
  }
  return turn;
}

function collectProjectionMessageContexts(
  projection: EventProjection,
): SemanticMessageContext[] {
  const contexts: SemanticMessageContext[] = [];
  let messageIndex = 0;

  projection.entries.forEach((entry, entryIndex) => {
    if (entry.kind === "projected-message") {
      contexts.push({
        kind: "projected-message",
        entryIndex,
        message: entry.message,
        messageIndex,
      });
      messageIndex += 1;
      return;
    }

    for (const message of getProjectionEntryMessages(entry)) {
      contexts.push({
        kind: "turn",
        entryIndex,
        message,
        messageIndex,
        turn: entry.turn,
      });
      messageIndex += 1;
    }
  });

  return contexts;
}

function isSameTurnEntry(
  left: SemanticMessageContext,
  right: SemanticMessageContext,
): right is TurnMessageContext {
  return (
    left.kind === "turn" &&
    right.kind === "turn" &&
    left.entryIndex === right.entryIndex
  );
}

class SemanticProjectionBuilder {
  private readonly boundsByMessage = new Map<
    EventProjectionMessage,
    ProjectionMessageBounds
  >();
  private readonly attachedMessageIds = new Set<string>();
  private readonly childrenByParentCallId = new Map<
    string,
    SemanticMessageContext[]
  >();
  private readonly rootContexts: SemanticMessageContext[];

  constructor(contexts: SemanticMessageContext[]) {
    const referencedParentCallIds = new Set(
      contexts
        .map((context) => context.message.parentToolCallId)
        .filter((id): id is string => id !== undefined),
    );
    for (const context of contexts) {
      if (
        context.message.kind === "tool-call" &&
        (referencedParentCallIds.has(context.message.callId) ||
          isLegacyDelegationToolCall({
            tool: context.message.toolName,
            presentation: context.message.presentation,
          }))
      ) {
        context.message = toolCallAsDelegationMessage(context.message);
      }
    }
    const delegationCallIds = new Set(
      contexts
        .map((context) => context.message)
        .filter(isDelegationSourceMessage)
        .map((message) => message.callId),
    );

    for (const context of contexts) {
      const parentToolCallId = context.message.parentToolCallId;
      if (!parentToolCallId || !delegationCallIds.has(parentToolCallId)) {
        continue;
      }

      const children = this.childrenByParentCallId.get(parentToolCallId) ?? [];
      children.push(context);
      this.childrenByParentCallId.set(parentToolCallId, children);
      this.attachedMessageIds.add(context.message.id);
    }

    this.rootContexts = contexts.filter(
      (context) =>
        !this.attachedMessageIds.has(context.message.id) &&
        !this.isRootSuppressedContext(context),
    );
  }

  private isRootSuppressedContext(context: SemanticMessageContext): boolean {
    return context.message.parentToolCallId !== undefined;
  }

  buildRootProjection(): EventProjection {
    return this.buildRootTurnProjection(this.rootContexts);
  }

  private buildRootTurnProjection(
    contexts: SemanticMessageContext[],
  ): EventProjection {
    const entries: EventProjectionEntry[] = [];
    let index = 0;

    while (index < contexts.length) {
      const context = contexts[index];
      if (!context) {
        break;
      }

      if (context.kind === "projected-message") {
        entries.push({
          kind: "projected-message",
          message: this.toSemanticMessage(context.message),
        });
        index += 1;
        continue;
      }

      const sourceTurn = context.turn;
      const messages: EventProjectionMessage[] = [];
      messages.push(this.toSemanticMessage(context.message));
      index += 1;

      while (index < contexts.length) {
        const nextContext = contexts[index];
        if (!nextContext || !isSameTurnEntry(context, nextContext)) {
          break;
        }
        messages.push(this.toSemanticMessage(nextContext.message));
        index += 1;
      }

      entries.push({
        kind: "turn",
        turn: buildSourceTurn(sourceTurn, messages),
      });
    }

    return {
      state: {
        activeThinking: null,
        activeWorkflows: [],
        activeBackgroundCommands: [],
      },
      entries,
    };
  }

  private buildFlatChildProjection(
    contexts: readonly SemanticMessageContext[],
  ): EventProjection {
    return {
      state: {
        activeThinking: null,
        activeWorkflows: [],
        activeBackgroundCommands: [],
      },
      entries: contexts.map((context) => ({
        kind: "projected-message",
        message: this.toSemanticMessage(context.message),
      })),
    };
  }

  private boundsForMessage(
    message: EventProjectionMessage,
  ): ProjectionMessageBounds {
    const cached = this.boundsByMessage.get(message);
    if (cached) return cached;
    const bounds = messageBounds(message);
    this.boundsByMessage.set(message, bounds);
    if (message.kind === "delegation") {
      for (const child of this.childrenByParentCallId.get(message.callId) ??
        []) {
        includeBounds(bounds, this.boundsForMessage(child.message));
      }
    }
    return bounds;
  }

  private toSemanticMessage(
    message: EventProjectionMessage,
  ): EventProjectionMessage {
    if (!isDelegationSourceMessage(message)) return message;
    const children = this.childrenByParentCallId.get(message.callId) ?? [];
    const bounds = this.boundsForMessage(message);
    let childProjection: EventProjection | undefined;
    return {
      ...message,
      sourceSeqStart: bounds.sourceSeqStart,
      sourceSeqEnd: bounds.sourceSeqEnd,
      createdAt: bounds.createdAt,
      ...(children.length > 0 ? { startedAt: bounds.startedAt } : {}),
      getChildProjection: () =>
        (childProjection ??= this.buildFlatChildProjection(children)),
    };
  }
}

export function normalizeEventProjection(
  projection: EventProjection,
): EventProjection {
  const normalizedProjection = new SemanticProjectionBuilder(
    collectProjectionMessageContexts(projection),
  ).buildRootProjection();
  return {
    ...normalizedProjection,
    state: projection.state,
  };
}
