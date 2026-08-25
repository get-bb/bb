import {
  createDispatchHold,
  getDispatchHold,
  getThread,
  listDispatchHolds,
  listLiveDispatchHoldCountsByThreadIds,
  releaseDispatchHold,
  updateDispatchHoldPayload,
  updateDispatchHoldReport,
  updateDispatchHoldResumeAt,
  type DispatchHoldRow,
} from "@bb/db";
import {
  dispatchHoldPayloadSchema,
  promptInputSchema,
  type DispatchHoldHolder,
  type DispatchHoldPayload,
  type DispatchHoldReleaseKind,
  type DispatchHoldReportUpdate,
  type PermissionMode,
  type PromptInput,
  type ProvisioningTranscriptEntry,
  type ReasoningLevel,
  type ServiceTier,
  threadScope,
  type SystemDispatchHoldStatus,
} from "@bb/domain";
import type { DbTransaction } from "@bb/db";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { startedOnBehalfOfSchema } from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  emitPluginDispatchCancelled,
  emitPluginDispatchHeld,
  emitPluginDispatchReleased,
} from "../plugins/plugin-thread-events.js";
import { appendThreadEvent } from "./thread-events.js";
import {
  threadForkDescriptorSchema,
  threadProvisionEnvironmentIntentSchema,
} from "./thread-provisioning-context.js";

type DispatchHoldDeps = Pick<AppDeps, "db" | "hub">;

/**
 * Reason shown on a `holdUntil` hold. `holdUntil` is a time, not an
 * explanation, so the banner pairs this label with the countdown it already
 * renders from `resumeAt`.
 */
export const SCHEDULED_DISPATCH_HOLD_REASON = "Scheduled";

/**
 * The half of a never-started thread's first turn that does not fit in
 * {@link DispatchHoldPayload}: where the thread will run and how it will be
 * established. The payload owns what the turn says (input) and how it executes
 * (the frozen tuple); this owns everything `requestThreadProvision` needs on
 * top of that.
 *
 * It is persisted rather than recomputed because the live provisioning context
 * is in-memory only (`rememberActiveThreadProvisionContext`) and requires the
 * thread to be `starting` — a held thread is `idle`, possibly across a restart,
 * so parking a metadata-pending context would not survive the wait. Presence of
 * this record is also what makes a hold a *cold-start* hold: releasing it
 * provisions the thread, where every other hold just sends.
 *
 * Stored in `dispatch_holds.original_request`, which the plan reserves for "the
 * request this hold dispatches"; phase 2 adds `effective_request` alongside it
 * for the post-amendment pair.
 */
const dispatchHoldThreadStartContextSchema = z.object({
  environmentIntent: threadProvisionEnvironmentIntentSchema,
  fork: threadForkDescriptorSchema.nullable(),
  /** Provider-facing input when it differs from the persisted start seed. */
  providerInput: z.array(promptInputSchema).optional(),
  startedOnBehalfOf: startedOnBehalfOfSchema.nullable(),
  titleProvided: z.boolean(),
});
export type DispatchHoldThreadStartContext = z.infer<
  typeof dispatchHoldThreadStartContextSchema
>;

export interface CreateThreadDispatchHoldArgs {
  threadId: string;
  environmentId: string | null;
  holder: DispatchHoldHolder;
  payload: DispatchHoldPayload;
  reason: string;
  /** Non-null makes core's timer sweep release the hold when it arrives. */
  resumeAt: number | null;
  /**
   * The post-amendment audit record for a hold a gate pass produced: what the
   * gates changed and which plugin changed each field. `original_request` is
   * already taken by the cold-start thread context, so the amendment pair
   * lives here alone — the pre-amendment input rides it as `originalInput`.
   */
  effectiveRequest?: DispatchHoldEffectiveRequest;
  userReleasable: boolean;
  /** Present only for a never-started thread's first turn. */
  threadStartContext?: DispatchHoldThreadStartContext;
  /**
   * Runs in the same transaction as the insert. The queue drain uses it to
   * consume the queued message it is converting into a hold, so the message
   * can never be consumed without a hold to show for it, nor a hold created
   * for a message another drain already claimed.
   */
  beforeCreateInTransaction?: (args: { tx: DbTransaction }) => void;
}

/**
 * What a gate pass changed, stored on `dispatch_holds.effective_request`. It
 * exists so a plugin that silently rewrote a user's provider, model or message
 * stays debuggable after the fact — nothing reads it to dispatch.
 */
const dispatchHoldEffectiveRequestSchema = z.object({
  amendedBy: z.record(z.string(), z.string()),
  originalInput: z.array(promptInputSchema).nullable(),
});
export type DispatchHoldEffectiveRequest = z.infer<
  typeof dispatchHoldEffectiveRequestSchema
>;

/** Null for a hold no gate amended. */
export function parseDispatchHoldEffectiveRequest(
  row: DispatchHoldRow,
): DispatchHoldEffectiveRequest | null {
  if (row.effectiveRequest === null) {
    return null;
  }
  return dispatchHoldEffectiveRequestSchema.parse(
    JSON.parse(row.effectiveRequest),
  );
}

export interface ListDispatchHoldsForApiArgs {
  threadId?: string;
  holder?: DispatchHoldHolder;
}

/**
 * Parses a stored payload. A row whose payload cannot be parsed is a bug or a
 * hand-edited database, and every caller either dispatches or renders it, so
 * failing loudly beats silently dropping the user's message.
 */
export function parseDispatchHoldPayload(
  row: DispatchHoldRow,
): DispatchHoldPayload {
  return dispatchHoldPayloadSchema.parse(JSON.parse(row.payload));
}

/** Null for a follow-up hold; a context for a never-started thread's first turn. */
export function parseDispatchHoldThreadStartContext(
  row: DispatchHoldRow,
): DispatchHoldThreadStartContext | null {
  if (row.originalRequest === null) {
    return null;
  }
  return dispatchHoldThreadStartContextSchema.parse(
    JSON.parse(row.originalRequest),
  );
}

export function toDispatchHoldResponse(
  row: DispatchHoldRow,
): DispatchHoldResponse {
  const payload = parseDispatchHoldPayload(row);
  return {
    id: row.id,
    kind: row.kind,
    threadId: row.threadId,
    holder: row.holder,
    userReleasable: row.userReleasable,
    reason: row.reason,
    payload:
      payload.kind === "inline"
        ? {
            kind: "inline",
            input: payload.input,
            execution: payload.execution,
            // Mirrors exactly what `updateLiveDispatchHold` will accept, which
            // is the point of shipping this instead of letting clients guess.
            // A released hold has already dispatched (or been discarded), so
            // its draft is history; a hold core owns (`core:reprovision`,
            // `core:host-offline`) is not the user's draft to rewrite — its
            // turn is already persisted elsewhere and only waiting.
            editable: row.releasedAt === null && row.userReleasable,
          }
        : {
            kind: "retry",
            retryOfTurnRequestId: payload.retryOfTurnRequestId,
          },
    resumeAt: row.resumeAt,
    expectedReleaseAt: row.expectedReleaseAt,
    staleAfterMs: row.staleAfterMs,
    lastReportAt: row.lastReportAt,
    createdAt: row.createdAt,
    releasedAt: row.releasedAt,
    releaseKind: row.releaseKind,
  };
}

function dispatchHoldStatusForReleaseKind(
  releaseKind: DispatchHoldReleaseKind,
): SystemDispatchHoldStatus {
  switch (releaseKind) {
    case "cancelled":
      return "cancelled";
    case "orphaned":
      return "orphaned";
    case "owner":
    case "timer":
    case "user":
      return "released";
  }
}

/**
 * The one timeline row a hold owns. Events are append-only, so a status change
 * appends another row carrying the same `holdId`; the timeline projection
 * collapses them by that id exactly as it does `system/thread-provisioning`.
 * Only the delta entries are sent — the projection concatenates transcripts.
 */
function appendDispatchHoldEvent(
  deps: DispatchHoldDeps,
  args: {
    entries: ProvisioningTranscriptEntry[];
    environmentId: string | null;
    row: DispatchHoldRow;
    status: SystemDispatchHoldStatus;
  },
): void {
  appendThreadEvent(deps, {
    threadId: args.row.threadId,
    environmentId: args.environmentId,
    type: "system/dispatch-hold",
    scope: threadScope(),
    data: {
      holdId: args.row.id,
      holder: args.row.holder,
      status: args.status,
      reason: args.row.reason,
      entries: args.entries,
    },
  });
}

export function createThreadDispatchHold(
  deps: DispatchHoldDeps,
  args: CreateThreadDispatchHoldArgs,
): DispatchHoldRow {
  const row = deps.db.transaction(
    (tx) => {
      args.beforeCreateInTransaction?.({ tx });
      return createDispatchHold(tx, {
        kind: "turn",
        threadId: args.threadId,
        payload: args.payload,
        holder: args.holder,
        userReleasable: args.userReleasable,
        reason: args.reason,
        resumeAt: args.resumeAt,
        amend: null,
        originalRequest:
          args.threadStartContext === undefined
            ? null
            : JSON.stringify(args.threadStartContext),
        effectiveRequest:
          args.effectiveRequest === undefined
            ? null
            : JSON.stringify(args.effectiveRequest),
        expectedReleaseAt: null,
        staleAfterMs: null,
      });
    },
    { behavior: "immediate" },
  );
  appendDispatchHoldEvent(deps, {
    entries: [],
    environmentId: args.environmentId,
    row,
    status: "active",
  });
  emitPluginDispatchHeld(toDispatchHoldResponse(row));
  return row;
}

/**
 * Releases the row and records the outcome on the timeline. Returns null when
 * the compare-and-set lost — a timer and a "Release now" that fired together
 * produce exactly one winner, and the loser must do nothing at all rather than
 * dispatch a second copy of the turn.
 */
export function settleDispatchHold(
  deps: DispatchHoldDeps,
  args: { row: DispatchHoldRow; releaseKind: DispatchHoldReleaseKind },
): DispatchHoldRow | null {
  const releasedAt = Date.now();
  if (
    !releaseDispatchHold(deps.db, {
      id: args.row.id,
      releaseKind: args.releaseKind,
      releasedAt,
    })
  ) {
    return null;
  }
  const released: DispatchHoldRow = {
    ...args.row,
    releasedAt,
    releaseKind: args.releaseKind,
  };
  appendDispatchHoldEvent(deps, {
    entries: [],
    environmentId: getThread(deps.db, args.row.threadId)?.environmentId ?? null,
    row: released,
    status: dispatchHoldStatusForReleaseKind(args.releaseKind),
  });
  // Cancelling discards the dispatch; every other kind runs it. Owners tell
  // the two apart to know whether to tear down or to expect their work to run.
  const response = toDispatchHoldResponse(released);
  if (args.releaseKind === "cancelled") {
    emitPluginDispatchCancelled(response);
  } else {
    emitPluginDispatchReleased(response);
  }
  return released;
}

export function listLiveThreadDispatchHolds(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): DispatchHoldRow[] {
  return listDispatchHolds(deps.db, { threadId, liveOnly: true });
}

export function listDispatchHoldsForApi(
  deps: Pick<AppDeps, "db">,
  args: ListDispatchHoldsForApiArgs,
): DispatchHoldRow[] {
  return listDispatchHolds(deps.db, {
    ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
    ...(args.holder !== undefined ? { holder: args.holder } : {}),
    liveOnly: true,
  });
}

export function liveDispatchHoldCountsByThreadId(
  deps: Pick<AppDeps, "db">,
  threadIds: readonly string[],
): Map<string, number> {
  return new Map(
    listLiveDispatchHoldCountsByThreadIds(deps.db, { threadIds }).map(
      (row) => [row.threadId, row.liveHoldCount],
    ),
  );
}

export function requireDispatchHold(
  deps: Pick<AppDeps, "db">,
  holdId: string,
): DispatchHoldRow {
  const hold = getDispatchHold(deps.db, holdId);
  if (!hold) {
    throw new ApiError(404, "hold_not_found", "Dispatch hold not found");
  }
  return hold;
}

export function requireLiveDispatchHold(
  deps: Pick<AppDeps, "db">,
  holdId: string,
): DispatchHoldRow {
  const hold = requireDispatchHold(deps, holdId);
  if (hold.releasedAt !== null) {
    throw new ApiError(
      409,
      "hold_already_released",
      "This hold has already been released",
    );
  }
  return hold;
}

/**
 * Applies an owner's progress report. Returns false when the hold is gone or
 * already released; a late report from a torn-down owner must not resurrect it.
 */
export function reportDispatchHoldProgress(
  deps: DispatchHoldDeps,
  args: { holdId: string; update: DispatchHoldReportUpdate },
): boolean {
  const applied = updateDispatchHoldReport(deps.db, {
    id: args.holdId,
    reportedAt: Date.now(),
    ...(args.update.reason !== undefined ? { reason: args.update.reason } : {}),
    ...(args.update.expectedReleaseAt !== undefined
      ? { expectedReleaseAt: args.update.expectedReleaseAt }
      : {}),
    ...(args.update.staleAfterMs !== undefined
      ? { staleAfterMs: args.update.staleAfterMs }
      : {}),
  });
  if (!applied) {
    return false;
  }
  const row = getDispatchHold(deps.db, args.holdId);
  if (!row) {
    return false;
  }
  const entries: ProvisioningTranscriptEntry[] = [
    ...(args.update.step
      ? [
          {
            type: "step" as const,
            key: args.update.step.key,
            text: args.update.step.text,
            status: args.update.step.status,
            startedAt: Date.now(),
          },
        ]
      : []),
    ...(args.update.output
      ? [
          {
            type: "output" as const,
            key: args.update.output.key,
            text: args.update.output.text,
          },
        ]
      : []),
  ];
  appendDispatchHoldEvent(deps, {
    entries,
    environmentId: getThread(deps.db, row.threadId)?.environmentId ?? null,
    row,
    status: "active",
  });
  return true;
}

/**
 * Applies an owner's release amendment to a live hold's frozen payload.
 *
 * Amendments at release are narrower than at a gate pass: the row already
 * exists, so its provider and its environment are settled facts. What is left
 * is the turn itself — its message and its execution knobs — which is exactly
 * what {@link PluginDispatchAmendments} carries.
 *
 * Returns the updated row, or the row unchanged when the amendment was empty.
 */
export function applyDispatchHoldReleaseAmendment(
  deps: DispatchHoldDeps,
  args: { hold: DispatchHoldRow; amend: DispatchHoldReleaseAmendment },
): DispatchHoldRow {
  const payload = parseDispatchHoldPayload(args.hold);
  if (payload.kind !== "inline") {
    throw new ApiError(
      409,
      "hold_not_amendable",
      "This hold re-submits an earlier turn and cannot be amended",
    );
  }
  const next: DispatchHoldPayload = {
    ...payload,
    ...(args.amend.input !== undefined ? { input: args.amend.input } : {}),
    execution: {
      ...payload.execution,
      ...(args.amend.model !== undefined ? { model: args.amend.model } : {}),
      ...(args.amend.reasoningLevel !== undefined
        ? { reasoningLevel: args.amend.reasoningLevel }
        : {}),
      ...(args.amend.serviceTier !== undefined
        ? { serviceTier: args.amend.serviceTier }
        : {}),
      ...(args.amend.permissionMode !== undefined
        ? { permissionMode: args.amend.permissionMode }
        : {}),
    },
  };
  updateDispatchHoldPayload(deps.db, { id: args.hold.id, payload: next });
  return requireDispatchHold(deps, args.hold.id);
}

/**
 * What an owner may change when it releases its own hold. Structurally the
 * plugin-facing amendment shape, restated locally so this module does not
 * depend on the SDK contract for a four-field record.
 */
export interface DispatchHoldReleaseAmendment {
  input?: PromptInput[];
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
}

export interface UpdateLiveDispatchHoldArgs {
  holdId: string;
  input?: PromptInput[];
  resumeAt?: number;
}

/**
 * Edits a live hold's inline draft and/or reschedules its timer. Only a live
 * inline hold is editable: a retry reference exists to re-submit the original
 * request faithfully, so rewriting it would defeat its purpose.
 */
export function updateLiveDispatchHold(
  deps: DispatchHoldDeps,
  args: UpdateLiveDispatchHoldArgs,
): DispatchHoldRow {
  const hold = requireLiveDispatchHold(deps, args.holdId);
  if (!hold.userReleasable) {
    throw new ApiError(
      409,
      "hold_not_user_editable",
      "This hold is owned by core and cannot be edited",
    );
  }
  if (args.input !== undefined) {
    const payload = parseDispatchHoldPayload(hold);
    if (payload.kind !== "inline") {
      throw new ApiError(
        409,
        "hold_not_editable",
        "This hold re-submits an earlier turn and has no editable input",
      );
    }
    updateDispatchHoldPayload(deps.db, {
      id: hold.id,
      payload: { ...payload, input: args.input },
    });
  }
  if (args.resumeAt !== undefined) {
    updateDispatchHoldResumeAt(deps.db, {
      id: hold.id,
      resumeAt: args.resumeAt,
    });
  }
  const updated = requireDispatchHold(deps, args.holdId);
  deps.hub.notifyThread(updated.threadId, ["queue-changed"]);
  return updated;
}
