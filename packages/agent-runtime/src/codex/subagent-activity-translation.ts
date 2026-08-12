import type {
  ThreadEvent,
  ThreadEventItem,
  ThreadEventItemStatus,
} from "@bb/domain";
import { turnScope } from "@bb/domain";
import type { ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import {
  codexBridgeEnvelopeSchema,
  codexSubAgentActivityItemSchema,
  type CodexSubAgentActivityItem,
} from "./schemas.js";

export interface CodexSubAgentActivityEvent {
  item: CodexSubAgentActivityItem;
  providerThreadId: string;
  turnId: string;
}

export interface CodexTrackedSubAgent {
  agentPath: string;
  agentThreadId: string;
  callId: string;
  parentProviderThreadId: string;
  parentToolCallId?: string;
  parentTurnId: string;
  pendingFollowups: number;
  terminal: boolean;
}

export function parseCodexSubAgentActivityEvent(
  event: ProviderRuntimeEvent,
): CodexSubAgentActivityEvent | null {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success || envelope.data.method !== "item/completed") {
    return null;
  }

  const params = envelope.data.params;
  if (!params) {
    return null;
  }
  const item = codexSubAgentActivityItemSchema.safeParse(params.item);
  if (
    !item.success ||
    typeof params.threadId !== "string" ||
    typeof params.turnId !== "string"
  ) {
    return null;
  }

  return {
    item: item.data,
    providerThreadId: params.threadId,
    turnId: params.turnId,
  };
}

function buildSubAgentToolCallItem(
  tracked: CodexTrackedSubAgent,
  status: ThreadEventItemStatus,
): Extract<ThreadEventItem, { type: "toolCall" }> {
  return {
    type: "toolCall",
    id: tracked.callId,
    tool: "spawnAgent",
    arguments: {
      senderThreadId: tracked.parentProviderThreadId,
      receiverThreadIds: [tracked.agentThreadId],
      description: tracked.agentPath,
    },
    status,
    ...(tracked.parentToolCallId
      ? { parentToolCallId: tracked.parentToolCallId }
      : {}),
    ...(status === "pending"
      ? {}
      : {
          result: {
            agentPath: tracked.agentPath,
            agentThreadId: tracked.agentThreadId,
          },
        }),
  };
}

export function buildCodexSubAgentStartedEvent(
  tracked: CodexTrackedSubAgent,
): ThreadEvent {
  return {
    type: "item/started",
    threadId: tracked.parentProviderThreadId,
    providerThreadId: tracked.parentProviderThreadId,
    scope: turnScope(tracked.parentTurnId),
    item: buildSubAgentToolCallItem(tracked, "pending"),
  };
}

export function buildCodexSubAgentCompletedEvent(args: {
  status: Exclude<ThreadEventItemStatus, "pending">;
  tracked: CodexTrackedSubAgent;
}): ThreadEvent {
  return {
    type: "item/completed",
    threadId: args.tracked.parentProviderThreadId,
    providerThreadId: args.tracked.parentProviderThreadId,
    scope: turnScope(args.tracked.parentTurnId),
    item: buildSubAgentToolCallItem(args.tracked, args.status),
  };
}
