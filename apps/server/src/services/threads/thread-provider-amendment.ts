import { setThreadProvider, type DispatchHoldRow } from "@bb/db";
import {
  reconcileReasoningLevel,
  type AvailableModel,
  type ReasoningLevel,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { resolveSystemExecutionOptions } from "../system/execution-options.js";
import { parseDispatchHoldThreadStartContext } from "./dispatch-holds.js";
import { getLastProviderThreadId } from "./thread-events.js";
import { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

/**
 * Why this thread's provider can no longer change, or null when it still can.
 *
 * The invariant is NOT "provider is locked when the row is inserted". It is
 * **provider is immutable once a provider session exists**: the session is the
 * conversation, and no other provider can continue one it never started. A
 * thread whose first turn is parked in a hold has a row but no session, so it
 * is still free to be repointed.
 *
 * Three separate facts have to hold, and each rules out something the others
 * do not:
 *
 * - **The hold must carry a cold-start context.** That record is what makes a
 *   hold a *creation* — releasing it provisions the thread, which is the only
 *   moment the provider is read to establish a session. Every other hold just
 *   sends into a session that already exists or is already determined.
 * - **The thread must have no provider session.** The event log, not the
 *   thread row, is the authority: `status` reads `idle` both before a thread's
 *   first turn and between two of them, so only `providerThreadId` on the
 *   event log can tell "never ran" from "ran and went quiet".
 * - **The thread must not be a fork.** A fork provisions by CLONING the source
 *   thread's provider session (`fork.sourceProviderThreadId`), so its provider
 *   is not a free choice at all — it is a property of the session being
 *   cloned. Both markers are checked: the hold's start context is what release
 *   actually hands to provisioning, and `originKind` is the durable row fact.
 */
export function threadProviderAmendmentRefusal(
  deps: Pick<LoggedWorkSessionDeps, "db">,
  // Structural pick so both the API Thread and the raw db row qualify —
  // the refusal reads only these three facts.
  args: {
    hold: DispatchHoldRow;
    thread: Pick<Thread, "id" | "providerId" | "originKind">;
  },
): string | null {
  const startContext = parseDispatchHoldThreadStartContext(args.hold);
  if (startContext === null) {
    return "this hold sends into a thread that is already established, not one that is starting";
  }
  if (getLastProviderThreadId(deps, args.thread.id) !== null) {
    return `this thread has already started on "${args.thread.providerId}"`;
  }
  if (startContext.fork !== null || args.thread.originKind === "fork") {
    return "this thread is a fork, and its first turn clones the source thread's provider session";
  }
  return null;
}

export interface ThreadProviderAmendment {
  /**
   * Required alongside `providerId`, and not a convenience: the hold's frozen
   * tuple names a model of the OLD provider, and a resolved tuple has no way
   * to say "re-resolve this". A provider without a model would dispatch a
   * model the new provider does not offer.
   */
  model: string;
  providerId: string;
  /** Reconciled to the new model's ladder when it does not offer this one. */
  reasoningLevel: ReasoningLevel | undefined;
}

/**
 * Repoints a held, never-started thread at a different provider, validating
 * the way creation does.
 *
 * Every refusal throws BEFORE anything is written or released, so a caller
 * whose amendment is rejected still has its hold and can release it unamended.
 * That is what lets a routing plugin ask for a provider change optimistically
 * instead of having to prove it may.
 *
 * Returns the reasoning level the new model can actually honour, so the caller
 * folds one consistent tuple into the hold's payload. An unhonourable level is
 * a fail-closed dispatch failure later, which is a worse answer than the
 * nearest supported one.
 */
export async function applyThreadProviderAmendment(
  deps: LoggedWorkSessionDeps,
  args: {
    amendment: ThreadProviderAmendment;
    hold: DispatchHoldRow;
    thread: Thread;
  },
): Promise<{ reasoningLevel: ReasoningLevel | undefined }> {
  const { amendment, thread } = args;
  const refusal = threadProviderAmendmentRefusal(deps, {
    hold: args.hold,
    thread,
  });
  if (refusal !== null) {
    throw new ApiError(
      409,
      "provider_not_amendable",
      `Cannot change this thread's provider to "${amendment.providerId}": ${refusal}.`,
    );
  }

  const registration = deps.providerRegistry.get(amendment.providerId);
  if (registration === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unknown provider "${amendment.providerId}".`,
    );
  }
  if (!registration.info.available) {
    throw new ApiError(
      409,
      "provider_unavailable",
      `${registration.info.displayName} is unavailable because its provider plugin failed to load.`,
    );
  }

  const models = await loadProviderModels(deps, {
    environmentId: thread.environmentId,
    providerId: amendment.providerId,
  });
  const target = models.find(
    (candidate) => candidate.model === amendment.model,
  );
  if (target === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Model "${amendment.model}" is not in the "${amendment.providerId}" model catalog.`,
    );
  }

  setThreadProvider(deps.db, {
    threadId: thread.id,
    providerId: amendment.providerId,
  });

  if (amendment.reasoningLevel === undefined) {
    return { reasoningLevel: undefined };
  }
  const supported: readonly ReasoningLevel[] =
    target.supportedReasoningEfforts.length > 0
      ? target.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
      : getSupportedReasoningLevelsForProvider(
          deps.providerRegistry,
          amendment.providerId,
        );
  if (supported.length === 0) {
    return { reasoningLevel: amendment.reasoningLevel };
  }
  return {
    reasoningLevel: reconcileReasoningLevel(
      amendment.reasoningLevel,
      supported,
    ),
  };
}

async function loadProviderModels(
  deps: LoggedWorkSessionDeps,
  args: { environmentId: string | null; providerId: string },
): Promise<readonly AvailableModel[]> {
  const result = await resolveSystemExecutionOptions(deps, {
    providerId: args.providerId,
    ...(args.environmentId !== null
      ? { environmentId: args.environmentId }
      : {}),
  });
  if (result.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${args.providerId} models to validate the change. Try again once the host is connected.`,
    );
  }
  // Selected-only rows are offerable in the picker, so they are valid targets
  // here for the same reason they are valid override targets.
  return [...result.models, ...result.selectedOnlyModels];
}
