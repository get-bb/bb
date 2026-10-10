import { claimFirstFinishedTurn, getThread } from "@bb/db";
import type { ProviderErrorCategory } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { buildTurnFailedEvent } from "../threads/turn-failed.js";
import type { TurnErrorCategory, TurnFinishedOutcome } from "./telemetry.js";

const REPORTED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "pi",
  "acp-cursor",
  "acp-opencode",
  "acp-omp",
  "acp-grok",
  "acp-hermes-agent",
]);

export function turnErrorCategory(
  category: ProviderErrorCategory | null,
): TurnErrorCategory {
  switch (category) {
    case "unauthorized":
      return "auth";
    case "billing":
    case "budget-exceeded":
      return "billing";
    case "rate-limit":
      return "rate_limit";
    case "overloaded":
    case "connection-failed":
    case "stream-disconnected":
      return "provider_unavailable";
    case "context-window-exceeded":
    case "max-output-tokens":
    case "max-turns":
      return "limit_reached";
    default:
      return "other";
  }
}

export function reportedProviderId(providerId: string): string {
  return REPORTED_PROVIDER_IDS.has(providerId) ? providerId : "other";
}

export function recordTurnFinished(
  deps: Pick<AppDeps, "db" | "logger" | "telemetry">,
  args: {
    threadId: string;
    outcome: TurnFinishedOutcome;
    errorCategory?: TurnErrorCategory;
  },
): void {
  try {
    const thread = getThread(deps.db, args.threadId);
    if (!thread) return;
    const errorCategory =
      args.outcome !== "failed"
        ? "none"
        : (args.errorCategory ??
          turnErrorCategory(
            buildTurnFailedEvent(deps.db, args.threadId)?.errorInfo?.category ??
              null,
          ));
    deps.telemetry.capture({
      name: "turn_finished",
      properties: {
        outcome: args.outcome,
        provider: reportedProviderId(thread.providerId),
        error_category: errorCategory,
        first_turn: claimFirstFinishedTurn(deps.db, Date.now()),
      },
    });
  } catch (error) {
    deps.logger.debug(
      { err: error, threadId: args.threadId },
      "Turn telemetry failed",
    );
  }
}
