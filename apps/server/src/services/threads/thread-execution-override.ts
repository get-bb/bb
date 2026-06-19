import {
  getBuiltInAgentProviderServerCapabilities,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import {
  getProjectExecutionDefaults,
  getThreadExecutionOverride,
  setThreadExecutionOverride,
  type ThreadExecutionOverride,
} from "@bb/db";
import {
  reconcileReasoningLevel,
  type AvailableModel,
  type ReasoningLevel,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { resolveSystemExecutionOptions } from "../system/execution-options.js";
import { getLastExecutionOptions } from "./thread-events.js";
import { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

/**
 * Whether the thread's provider applies an in-place execution override on
 * `thread/resume` while preserving context. Reads the provider's
 * `supportsExecutionOverride` capability fact from the catalog; cross-provider
 * changes always require respawning the thread.
 */
function providerSupportsExecutionOverride(providerId: string): boolean {
  if (!isAgentProviderId(providerId)) {
    return false;
  }
  return getBuiltInAgentProviderServerCapabilities(providerId)
    .supportsExecutionOverride;
}

function listExecutionOverrideProviderIds(): string[] {
  return listBuiltInAgentProviderInfos()
    .filter((info) =>
      getBuiltInAgentProviderServerCapabilities(info.id)
        .supportsExecutionOverride,
    )
    .map((info) => info.id);
}

/**
 * Presence-sensitive patch for the thread execution override. A field that is
 * absent (key not present) is left unchanged; an explicit `null` clears it.
 */
export interface ThreadExecutionOverridePatch {
  model?: string | null;
  reasoningLevel?: ReasoningLevel | null;
}

export interface ResolveThreadExecutionOverrideUpdateArgs {
  /** The thread's currently persisted override. */
  existing: ThreadExecutionOverride;
  /** The requested change (presence-sensitive). */
  patch: ThreadExecutionOverridePatch;
  /** The active model catalog for the thread's provider (swap targets). */
  models: readonly AvailableModel[];
  /** The thread's provider id, for error messages and the reasoning fallback. */
  providerId: string;
  /**
   * The model a turn would resolve to absent any override (last turn ?? project
   * default). Used to validate a reasoning-only change against the right model.
   */
  fallbackModel: string | null;
}

export interface ApplyThreadExecutionOverrideArgs {
  thread: Thread;
  patch: ThreadExecutionOverridePatch;
}

/**
 * Pure resolver for the next override values. Validates a requested model
 * against the active catalog (same-provider + in-catalog), validates an
 * explicit reasoning level against the target model's supported efforts, and
 * reconciles a now-incompatible stored reasoning level when only the model
 * changes. Throws `ApiError(400)` for incompatible input. No IO.
 */
export function resolveThreadExecutionOverrideUpdate(
  args: ResolveThreadExecutionOverrideUpdateArgs,
): ThreadExecutionOverride {
  const { existing, patch, models, providerId, fallbackModel } = args;

  const modelChanged = "model" in patch;
  let nextModel = existing.modelOverride;
  if (modelChanged) {
    if (patch.model === null || patch.model === undefined) {
      nextModel = null;
    } else {
      const target = models.find((candidate) => candidate.model === patch.model);
      if (!target) {
        throw new ApiError(
          400,
          "invalid_request",
          `Model "${patch.model}" is not available for provider ${providerId}. Cross-provider switches require respawning the thread.`,
        );
      }
      nextModel = patch.model;
    }
  }

  // The model whose reasoning support we validate/reconcile against: the new
  // override if set, otherwise what the next turn would resolve to.
  const effectiveModel = nextModel ?? fallbackModel;
  const effectiveModelEntry = effectiveModel
    ? models.find((candidate) => candidate.model === effectiveModel)
    : undefined;
  const supportedReasoning: readonly ReasoningLevel[] = effectiveModelEntry
    ? effectiveModelEntry.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      )
    : getSupportedReasoningLevelsForProvider(providerId);

  let nextReasoning = existing.reasoningLevelOverride;
  if ("reasoningLevel" in patch) {
    if (patch.reasoningLevel === null || patch.reasoningLevel === undefined) {
      nextReasoning = null;
    } else {
      if (
        supportedReasoning.length > 0 &&
        !supportedReasoning.includes(patch.reasoningLevel)
      ) {
        throw new ApiError(
          400,
          "invalid_request",
          `Reasoning level "${patch.reasoningLevel}" is not supported by ${
            effectiveModel ? `model "${effectiveModel}"` : `provider ${providerId}`
          }. Supported reasoning levels: ${supportedReasoning.join(", ")}.`,
        );
      }
      nextReasoning = patch.reasoningLevel;
    }
  } else if (
    modelChanged &&
    nextReasoning !== null &&
    supportedReasoning.length > 0 &&
    !supportedReasoning.includes(nextReasoning)
  ) {
    // The model changed without an explicit reasoning level and the stored
    // reasoning override is no longer supported by the new model → reconcile
    // to the closest supported level rather than failing.
    nextReasoning = reconcileReasoningLevel(nextReasoning, supportedReasoning);
  }

  return { modelOverride: nextModel, reasoningLevelOverride: nextReasoning };
}

/**
 * Validates and persists the sticky thread-level execution override. Loads the
 * thread provider's active model catalog from the daemon to validate, then
 * stores the resolved values. The change takes effect on the next turn via
 * `resolveExecutionOptions` + the runtime's `reconfigureThreadIfNeeded`.
 */
export async function applyThreadExecutionOverride(
  deps: AppDeps,
  args: ApplyThreadExecutionOverrideArgs,
): Promise<void> {
  const { thread, patch } = args;

  if (!providerSupportsExecutionOverride(thread.providerId)) {
    throw new ApiError(
      400,
      "invalid_request",
      `Changing the model or reasoning level of a running thread is only supported for ${listExecutionOverrideProviderIds().join(", ")} threads (this thread uses ${thread.providerId}). Cross-provider changes require respawning the thread.`,
    );
  }

  const models = await loadThreadProviderModels(deps, thread);
  const existing = getThreadExecutionOverride(deps.db, thread.id) ?? {
    modelOverride: null,
    reasoningLevelOverride: null,
  };

  const next = resolveThreadExecutionOverrideUpdate({
    existing,
    patch,
    models,
    providerId: thread.providerId,
    fallbackModel: resolveFallbackModel(deps, thread),
  });

  setThreadExecutionOverride(deps.db, {
    threadId: thread.id,
    modelOverride: next.modelOverride,
    reasoningLevelOverride: next.reasoningLevelOverride,
  });
}

async function loadThreadProviderModels(
  deps: AppDeps,
  thread: Thread,
): Promise<readonly AvailableModel[]> {
  const result = await resolveSystemExecutionOptions(deps, {
    providerId: thread.providerId,
    ...(thread.environmentId !== null
      ? { environmentId: thread.environmentId }
      : {}),
  });
  if (result.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${thread.providerId} models to validate the change. Try again once the host is connected.`,
    );
  }
  // Selected-only models are browsable in the picker's collapsed "More
  // models" section, so they are valid swap targets too.
  return [...result.models, ...result.selectedOnlyModels];
}

function resolveFallbackModel(deps: AppDeps, thread: Thread): string | null {
  const lastExecution = getLastExecutionOptions(deps, thread.id);
  if (lastExecution?.model) {
    return lastExecution.model;
  }
  const projectDefaults = getProjectExecutionDefaults(deps.db, {
    projectId: thread.projectId,
  });
  return projectDefaults?.model ?? null;
}
