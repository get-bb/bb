import {
  promptInputHasCommandMention,
  requireThreadEventScopeTurnId,
  removeCommandMentionsFromPromptInput,
  type Thread,
  type ThreadTimelineActivePromptMode,
} from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { parsePromptInput } from "./user-message-parsing.js";

type PlanModeProviderId = ThreadTimelineActivePromptMode["providerId"];

const PLAN_COMMAND_SELECTOR = { trigger: "/", name: "plan" } as const;

function isPlanModeProviderId(
  providerId: string | undefined,
): providerId is PlanModeProviderId {
  return providerId === "claude-code" || providerId === "codex";
}

interface ActiveTurnInput {
  request: Extract<
    ThreadEventWithMeta["event"],
    { type: "client/turn/requested" }
  >;
  seq: number;
}

function promptTextWithoutPlanCommand(
  request: ActiveTurnInput["request"],
): string {
  const cleanedInput = removeCommandMentionsFromPromptInput(
    request.input,
    PLAN_COMMAND_SELECTOR,
  );
  return parsePromptInput(cleanedInput)?.text.trim() ?? "";
}

function extractActiveTurnInputs(
  events: readonly ThreadEventWithMeta[],
): ActiveTurnInput[] {
  const requestsById = new Map<
    string,
    Extract<ThreadEventWithMeta["event"], { type: "client/turn/requested" }>
  >();
  const completedTurnIds = new Set<string>();
  let latestThreadInterruptionSeq = -1;

  for (const { event, meta } of events) {
    if (event.type === "client/turn/requested") {
      requestsById.set(event.requestId, event);
      continue;
    }
    if (event.type === "turn/completed") {
      completedTurnIds.add(
        requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        }),
      );
      continue;
    }
    if (event.type === "system/thread/interrupted") {
      latestThreadInterruptionSeq = Math.max(
        latestThreadInterruptionSeq,
        meta.seq,
      );
    }
  }

  return events.flatMap(({ event, meta }) => {
    if (event.type !== "turn/input/accepted") {
      return [];
    }
    if (meta.seq <= latestThreadInterruptionSeq) {
      return [];
    }
    const turnId = requireThreadEventScopeTurnId({
      type: event.type,
      scope: event.scope,
    });
    if (completedTurnIds.has(turnId)) {
      return [];
    }
    const request = requestsById.get(event.clientRequestId);
    return request ? [{ request, seq: meta.seq }] : [];
  });
}

export function extractThreadTimelineActivePromptMode({
  events,
  providerId,
  threadStatus,
}: {
  events: readonly ThreadEventWithMeta[];
  providerId: string | undefined;
  threadStatus: Thread["status"];
}): ThreadTimelineActivePromptMode | null {
  if (threadStatus !== "active" || !isPlanModeProviderId(providerId)) {
    return null;
  }

  let latestPlanTurn: ActiveTurnInput | null = null;
  for (const activeTurn of extractActiveTurnInputs(events)) {
    if (
      !promptInputHasCommandMention(activeTurn.request.input, {
        ...PLAN_COMMAND_SELECTOR,
      })
    ) {
      continue;
    }
    if (!latestPlanTurn || activeTurn.seq > latestPlanTurn.seq) {
      latestPlanTurn = activeTurn;
    }
  }

  return latestPlanTurn
    ? {
        mode: "plan",
        providerId,
        prompt: promptTextWithoutPlanCommand(latestPlanTurn.request),
      }
    : null;
}
