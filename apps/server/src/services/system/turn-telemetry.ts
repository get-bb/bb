import {
  afterCommit,
  claimInstallTurnNumber,
  getLatestStoredThreadEventOfTypes,
  getThread,
  type DbQueryConnection,
} from "@bb/db";
import {
  systemErrorEventDataSchema,
  systemThreadInterruptedEventDataSchema,
  type ProviderErrorCategory,
  type ThreadLifecycleEvent,
  type ThreadStatus,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { buildTurnFailedEvent } from "../threads/turn-failed.js";
import type { TurnErrorCategory, TurnFinishedOutcome } from "./telemetry.js";
import { reportedProviderId } from "./provider-telemetry.js";

type TurnTelemetryDeps = Pick<AppDeps, "db" | "logger" | "telemetry">;

const SYSTEM_ERROR_CATEGORIES: Readonly<Record<string, TurnErrorCategory>> = {
  provider_process_exited: "process_exited",
  thread_command_failed: "start_failed",
  thread_provisioning_failed: "start_failed",
  provider_cli_unsupported_version: "start_failed",
};

let turnTelemetryDeps: TurnTelemetryDeps | undefined;

export function setTurnTelemetryDeps(
  next: TurnTelemetryDeps | undefined,
): void {
  turnTelemetryDeps = next;
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

export function turnFinishedOutcome(
  event: ThreadLifecycleEvent,
  previousStatus: ThreadStatus,
): TurnFinishedOutcome | null {
  if (event.type === "run.failed") return "failed";
  if (event.type === "run.succeeded") {
    return previousStatus === "active" || previousStatus === "stopping"
      ? "succeeded"
      : null;
  }
  if (event.type === "stop.settled") return "stopped";
  return null;
}

function failureCategory(
  db: TurnTelemetryDeps["db"],
  threadId: string,
): TurnErrorCategory {
  const interruption = getLatestStoredThreadEventOfTypes(db, {
    threadId,
    types: ["system/thread/interrupted", "system/error", "turn/started"],
    afterSequence: 0,
  });
  if (interruption?.type === "system/thread/interrupted") {
    let data: unknown = null;
    try {
      data = JSON.parse(interruption.data);
    } catch {}
    const parsed = systemThreadInterruptedEventDataSchema.safeParse(data).data;
    const reason = parsed?.cause ?? parsed?.reason;
    if (reason === "host-daemon-restarted" || reason === "host-connection-lost")
      return "host_lost";
  }
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

export function recordFinishedTurn(
  db: DbQueryConnection,
  threadId: string,
  event: ThreadLifecycleEvent,
  previousStatus: ThreadStatus,
): void {
  const deps = turnTelemetryDeps;
  if (!deps?.telemetry.isEnabled()) return;
  const outcome = turnFinishedOutcome(event, previousStatus);
  if (outcome === null) return;
  try {
    const thread = getThread(db, threadId);
    if (!thread) return;
    const properties = {
      outcome,
      provider: reportedProviderId(thread.providerId),
      error_category:
        outcome === "failed"
          ? failureCategory(deps.db, threadId)
          : ("none" as const),
    };
    afterCommit(db, () => {
      if (!deps.telemetry.isEnabled()) return;
      deps.telemetry.capture({
        name: "turn_finished",
        properties: {
          ...properties,
          install_turn_number: claimInstallTurnNumber(
            deps.db,
            thread.updatedAt,
          ),
        },
      });
    });
  } catch (error) {
    deps.logger.debug({ err: error }, "Turn telemetry failed");
  }
}
