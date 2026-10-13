import { captureFeatureUsed } from "./feature-telemetry.js";
import { eq } from "drizzle-orm";
import { afterCommit, telemetryThreads, type DbQueryConnection } from "@bb/db";
import {
  analyticsThreadProperties,
  captureWorkEvent,
  workOriginProperties,
  setWorkTelemetryDeps,
} from "./work-telemetry.js";
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
import { turnProviderSchema } from "./provider-telemetry.js";

export type TurnTelemetryDeps = Pick<AppDeps, "db" | "logger" | "telemetry">;

const SYSTEM_ERROR_CATEGORIES: Readonly<Record<string, TurnErrorCategory>> = {
  provider_process_exited: "process_exited",
  thread_command_failed: "start_failed",
  thread_provisioning_failed: "start_failed",
  provider_cli_unsupported_version: "start_failed",
  host_disconnected: "host_lost",
};

let turnTelemetryDeps: TurnTelemetryDeps | undefined;

export function setTurnTelemetryDeps(
  next: TurnTelemetryDeps | undefined,
): void {
  turnTelemetryDeps = next;
  setWorkTelemetryDeps(next);
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

export function reportedProviderId(providerId: string): string {
  return turnProviderSchema.safeParse(providerId).data ?? "other";
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

export function recordAppliedWorkLifecycle(
  db: DbQueryConnection,
  threadId: string,
  event: ThreadLifecycleEvent,
  previousStatus: ThreadStatus,
): void {
  const deps = turnTelemetryDeps;
  if (!deps) return;
  if (!deps.telemetry.isEnabled()) {
    try {
      db.update(telemetryThreads)
        .set({ activeRequestId: null, pendingRequestId: null, waiting: false })
        .where(eq(telemetryThreads.threadId, threadId))
        .run();
    } catch {}
    return;
  }
  try {
    const thread = getThread(db, threadId);
    if (!thread) return;
    const identity = analyticsThreadProperties(db, thread);
    const state = db
      .select()
      .from(telemetryThreads)
      .where(eq(telemetryThreads.threadId, threadId))
      .get();
    if (event.type === "run.started") {
      const requestId = state?.pendingRequestId ?? null;
      db.update(telemetryThreads)
        .set({ activeRequestId: requestId, pendingRequestId: null })
        .where(eq(telemetryThreads.threadId, threadId))
        .run();
      const origin = workOriginProperties(db, threadId, requestId);
      afterCommit(db, () =>
        captureFeatureUsed(deps.telemetry, {
          feature: "provider",
          feature_scope: "core",
          interaction: "ran",
          trigger: origin.trigger,
        }),
      );
      captureWorkEvent(
        db,
        {
          name: "thread_lifecycle",
          properties: {
            ...identity,
            ...origin,
            transition: "turn_started",
          },
        },
        thread.updatedAt,
      );
      return;
    }
    const outcome = turnFinishedOutcome(event, previousStatus);
    if (outcome === null) return;
    const requestId =
      previousStatus === "starting" || previousStatus === "pending"
        ? (state?.pendingRequestId ?? null)
        : (state?.activeRequestId ?? null);
    const properties = {
      ...identity,
      ...workOriginProperties(db, threadId, requestId),
      outcome,
      provider: reportedProviderId(thread.providerId),
      error_category:
        outcome === "failed"
          ? failureCategory(deps.db, threadId)
          : ("none" as const),
    };
    const occurredAt = thread.updatedAt;
    afterCommit(db, () => {
      try {
        if (!deps.telemetry.isEnabled()) return;
        deps.telemetry.capture(
          {
            name: "turn_finished",
            properties: {
              ...properties,
              first_turn: claimFirstFinishedTurn(deps.db, occurredAt),
            },
          },
          occurredAt,
        );
      } catch {}
    });
    if (event.type === "stop.settled")
      captureWorkEvent(
        db,
        {
          name: "thread_lifecycle",
          properties: { ...identity, transition: "thread_stopped" },
        },
        occurredAt,
      );
    db.update(telemetryThreads)
      .set({ activeRequestId: null, pendingRequestId: null })
      .where(eq(telemetryThreads.threadId, threadId))
      .run();
  } catch (error) {
    deps.logger.debug({ err: error }, "Work telemetry failed");
  }
}
