import {
  isBackgroundAgentTaskType,
  type Thread,
  type ThreadTimelineActiveTurnActivity,
  type ThreadTimelineActiveTurnPhase,
} from "@bb/domain";
import type {
  EventProjection,
  EventProjectionTurn,
} from "./event-projection.js";
import type { EventProjectionMessage } from "./event-projection-message.js";
import { getMessageStartedAt } from "./format-helpers.js";

const QUIET_THRESHOLD_MS: Record<ThreadTimelineActiveTurnPhase, number> = {
  provider: 2 * 60_000,
  model: 2 * 60_000,
  command: 5 * 60_000,
  tool: 5 * 60_000,
  compaction: 5 * 60_000,
  subagent: 10 * 60_000,
  workflow: 10 * 60_000,
};

interface ActivityCandidate {
  detail: string | null;
  lastProgressSequence: number;
  phase: ThreadTimelineActiveTurnPhase;
  startedAt: number;
  updatedAt: number;
}

function compactDetail(value: string | null | undefined): string | null {
  const detail = value?.trim().split("\n", 1)[0]?.trim();
  if (!detail) return null;
  return detail.length <= 160 ? detail : `${detail.slice(0, 157)}...`;
}

function candidateFromMessage(
  message: EventProjectionMessage,
): ActivityCandidate | null {
  const common = {
    lastProgressSequence: message.sourceSeqEnd,
    startedAt: getMessageStartedAt(message),
    updatedAt: message.createdAt,
  };

  switch (message.kind) {
    case "assistant-text":
      return message.status === "streaming"
        ? { ...common, detail: null, phase: "model" }
        : null;
    case "command":
      return message.status === "pending"
        ? {
            ...common,
            detail: compactDetail(message.command),
            phase: "command",
          }
        : null;
    case "delegation":
      return message.status === "pending"
        ? {
            ...common,
            detail: compactDetail(message.description ?? message.subagentType),
            phase: "subagent",
          }
        : null;
    case "workflow":
      return message.status === "pending"
        ? {
            ...common,
            detail: compactDetail(message.description),
            phase: isBackgroundAgentTaskType(message.taskType)
              ? "subagent"
              : "workflow",
          }
        : null;
    case "operation":
      return message.status === "pending" && message.opType === "compaction"
        ? { ...common, detail: null, phase: "compaction" }
        : null;
    case "tool-call":
      return message.status === "pending"
        ? { ...common, detail: compactDetail(message.toolName), phase: "tool" }
        : null;
    case "file-edit":
    case "image-view":
    case "web-fetch":
    case "web-search":
      return message.status === "pending"
        ? { ...common, detail: null, phase: "tool" }
        : null;
    case "debug/raw-event":
    case "error":
    case "permission-grant-lifecycle":
    case "user":
    case "user-question-lifecycle":
      return null;
  }
}

function findActiveTurn(
  projection: EventProjection,
): EventProjectionTurn | null {
  for (let index = projection.entries.length - 1; index >= 0; index -= 1) {
    const entry = projection.entries[index];
    if (entry?.kind === "turn" && entry.turn.status === "pending") {
      return entry.turn;
    }
  }
  return null;
}

function newestCandidate(
  candidates: readonly ActivityCandidate[],
): ActivityCandidate | null {
  let newest: ActivityCandidate | null = null;
  for (const candidate of candidates) {
    if (
      newest === null ||
      candidate.updatedAt > newest.updatedAt ||
      (candidate.updatedAt === newest.updatedAt &&
        candidate.lastProgressSequence > newest.lastProgressSequence)
    ) {
      newest = candidate;
    }
  }
  return newest;
}

function latestPendingRequestCandidate(
  projection: EventProjection,
): ActivityCandidate | null {
  for (let index = projection.entries.length - 1; index >= 0; index -= 1) {
    const entry = projection.entries[index];
    if (
      entry?.kind !== "projected-message" ||
      entry.message.kind !== "user" ||
      entry.message.turnRequest.status === "rejected"
    ) {
      continue;
    }
    return {
      detail: null,
      lastProgressSequence: entry.message.sourceSeqEnd,
      phase: "provider",
      startedAt: getMessageStartedAt(entry.message),
      updatedAt: entry.message.createdAt,
    };
  }
  return null;
}

/**
 * Resolve one provider-neutral description of the latest material activity in
 * the active turn. This is diagnostic only: it never stops or mutates a turn.
 */
export function resolveThreadTimelineActiveTurnActivity(args: {
  projection: EventProjection;
  threadStatus: Thread["status"];
}): ThreadTimelineActiveTurnActivity | null {
  if (args.threadStatus !== "active") return null;

  const activeTurn = findActiveTurn(args.projection);
  const candidates: ActivityCandidate[] = [];

  for (const message of activeTurn?.messages ?? []) {
    const candidate = candidateFromMessage(message);
    if (candidate) candidates.push(candidate);
  }
  for (const message of [
    ...args.projection.state.activeWorkflows,
    ...args.projection.state.activeBackgroundCommands,
  ]) {
    const candidate = candidateFromMessage(message);
    if (candidate) candidates.push(candidate);
  }
  if (args.projection.state.activeThinking) {
    const thinking = args.projection.state.activeThinking;
    candidates.push({
      detail: null,
      lastProgressSequence: activeTurn?.sourceSeqEnd ?? 0,
      phase: "model",
      startedAt: thinking.startedAt,
      updatedAt: thinking.updatedAt,
    });
  }

  const selected =
    newestCandidate(candidates) ??
    (activeTurn
      ? {
          detail: null,
          lastProgressSequence: activeTurn.sourceSeqEnd,
          phase: "provider" as const,
          startedAt: activeTurn.startedAt,
          updatedAt: activeTurn.createdAt,
        }
      : latestPendingRequestCandidate(args.projection));
  if (!selected) return null;

  return {
    ...selected,
    quietThresholdMs: QUIET_THRESHOLD_MS[selected.phase],
  };
}
