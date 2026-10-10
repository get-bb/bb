import {
  claimFirstFinishedTurn,
  getLatestStoredThreadEventOfTypes,
  getThread,
} from "@bb/db";
import {
  systemErrorEventDataSchema,
  type ProviderErrorCategory,
  type ThreadLifecycleEvent,
  type ThreadStatus,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { buildTurnFailedEvent } from "../threads/turn-failed.js";
import type { TurnErrorCategory, TurnFinishedOutcome } from "./telemetry.js";

export type TurnTelemetryDeps = Pick<AppDeps, "db" | "logger" | "telemetry"> & {
  builtInProviderIds(): ReadonlySet<string>;
};

const SYSTEM_ERROR_CATEGORIES: Readonly<Record<string, TurnErrorCategory>> = {
  provider_process_exited: "process_exited",
  thread_command_failed: "start_failed",
  thread_provisioning_failed: "start_failed",
  provider_cli_unsupported_version: "start_failed",
  host_disconnected: "host_lost",
};

let turnTelemetryDeps: TurnTelemetryDeps | undefined;
let firstTurnSettled = false;

export function setTurnTelemetryDeps(
  next: TurnTelemetryDeps | undefined,
): void {
  turnTelemetryDeps = next;
  firstTurnSettled = false;
}

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

export function reportedProviderId(
  providerId: string,
  builtInProviderIds: ReadonlySet<string>,
): string {
  return builtInProviderIds.has(providerId) ? providerId : "other";
}

export function isTurnEndingLifecycleEvent(
  event: ThreadLifecycleEvent,
): boolean {
  return (
    event.type === "run.failed" ||
    event.type === "run.succeeded" ||
    event.type === "stop.settled"
  );
}

export function turnFinishedOutcome(
  event: ThreadLifecycleEvent,
  previousStatus: ThreadStatus,
): TurnFinishedOutcome | null {
  if (event.type === "run.failed") return "failed";
  if (event.type === "run.succeeded") {
    return previousStatus === "active" || previousStatus === "stopping"
      ? "completed"
      : null;
  }
  if (event.type === "stop.settled") return "stopped";
  return null;
}

function failureCategory(
  db: TurnTelemetryDeps["db"],
  threadId: string,
): TurnErrorCategory {
  const latest = getLatestStoredThreadEventOfTypes(db, {
    threadId,
    types: ["system/error", "turn/started"],
    afterSequence: 0,
  });
  if (latest?.type === "system/error") {
    let data: unknown = null;
    try {
      data = JSON.parse(latest.data);
    } catch {}
    const code = systemErrorEventDataSchema.safeParse(data).data?.code;
    const category =
      code === undefined ? undefined : SYSTEM_ERROR_CATEGORIES[code];
    if (category !== undefined) return category;
  }
  return turnErrorCategory(
    buildTurnFailedEvent(db, threadId)?.errorInfo?.category ?? null,
  );
}

function claimFirstTurn(deps: TurnTelemetryDeps): boolean {
  if (firstTurnSettled) return false;
  firstTurnSettled = true;
  return claimFirstFinishedTurn(deps.db, Date.now());
}

export function recordTurnFinished(
  deps: TurnTelemetryDeps,
  args: { threadId: string; outcome: TurnFinishedOutcome },
): void {
  try {
    const thread = getThread(deps.db, args.threadId);
    if (!thread) return;
    deps.telemetry.capture({
      name: "turn_finished",
      properties: {
        outcome: args.outcome,
        provider: reportedProviderId(
          thread.providerId,
          deps.builtInProviderIds(),
        ),
        error_category:
          args.outcome === "failed"
            ? failureCategory(deps.db, args.threadId)
            : "none",
        first_turn: claimFirstTurn(deps),
      },
    });
  } catch (error) {
    deps.logger.debug(
      { err: error, threadId: args.threadId },
      "Turn telemetry failed",
    );
  }
}

export function announceTurnFinished(
  threadId: string,
  outcome: TurnFinishedOutcome,
): void {
  const deps = turnTelemetryDeps;
  if (deps === undefined) return;
  setImmediate(() => recordTurnFinished(deps, { threadId, outcome }));
}
