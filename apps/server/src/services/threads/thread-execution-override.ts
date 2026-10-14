import {
  createEventId,
  getProjectExecutionDefaults,
  getThreadExecutionOverride,
  setThreadExecutionOverride,
  type ThreadExecutionOverride,
} from "@bb/db";
import {
  reconcileReasoningLevel,
  THREAD_PERMISSION_MODE_CHANGE_OPERATION,
  threadScope,
  type AvailableModel,
  type CallerExecutionInputSource,
  type PermissionMode,
  type ReasoningLevel,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import {
  clampPermissionModeToHost,
  resolveEnvironmentHostId,
} from "../hosts/permission-ceiling.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { resolveSystemExecutionOptionsForValidation } from "../system/execution-options.js";
import { appendThreadEvent, getLastExecutionOptions } from "./thread-events.js";
import { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

type ModelExecutionOverride = Pick<
  ThreadExecutionOverride,
  "modelOverride" | "reasoningLevelOverride"
>;

interface ThreadExecutionOverridePatch {
  model?: string | null;
  reasoningLevel?: ReasoningLevel | null;
}

interface ResolveThreadExecutionOverrideUpdateArgs {
  existing: ModelExecutionOverride;
  patch: ThreadExecutionOverridePatch;
  models: readonly AvailableModel[];
  providerId: string;
  fallbackModel: string | null;
}

interface ApplyThreadExecutionOverrideArgs {
  thread: Thread;
  patch: ThreadExecutionOverridePatch;
}

interface ApplyThreadPermissionModeOverrideArgs {
  permissionMode: PermissionMode;
  thread: Thread;
}

interface RecoverThreadModelOverrideArgs {
  model: string | undefined;
  modelSource: CallerExecutionInputSource | undefined;
  permissionMode?: PermissionMode | undefined;
  permissionModeSource?: CallerExecutionInputSource | undefined;
  reasoningLevel: ReasoningLevel | undefined;
  reasoningLevelSource: CallerExecutionInputSource | undefined;
  thread: Thread;
}

export function resolveThreadExecutionOverrideUpdate(
  registry: ProviderRegistryService,
  args: ResolveThreadExecutionOverrideUpdateArgs,
): ModelExecutionOverride {
  const { existing, patch, models, providerId, fallbackModel } = args;

  const modelChanged = "model" in patch;
  let nextModel = existing.modelOverride;
  if (modelChanged) {
    if (patch.model === null || patch.model === undefined) {
      nextModel = null;
    } else {
      const target = models.find(
        (candidate) => candidate.model === patch.model,
      );
      if (!target) {
        throw new ApiError(
          400,
          "invalid_request",
          `Model "${patch.model}" is not available in this thread's ${providerId} model catalog. Choose a model offered by ${providerId}; changing providers requires starting a new thread.`,
        );
      }
      nextModel = patch.model;
    }
  }

  const effectiveModel = nextModel ?? fallbackModel;
  const effectiveModelEntry = effectiveModel
    ? models.find((candidate) => candidate.model === effectiveModel)
    : undefined;
  const supportedReasoning: readonly ReasoningLevel[] = effectiveModelEntry
    ? effectiveModelEntry.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      )
    : getSupportedReasoningLevelsForProvider(registry, providerId);

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
            effectiveModel
              ? `model "${effectiveModel}"`
              : `provider ${providerId}`
          }. Supported reasoning levels: ${supportedReasoning.join(", ")}.`,
        );
      }
      nextReasoning = patch.reasoningLevel;
    }
  } else if (
    nextReasoning !== null &&
    supportedReasoning.length > 0 &&
    !supportedReasoning.includes(nextReasoning)
  ) {
    nextReasoning = reconcileReasoningLevel(
      nextReasoning,
      supportedReasoning,
      effectiveModelEntry?.defaultReasoningEffort,
    );
  }

  return { modelOverride: nextModel, reasoningLevelOverride: nextReasoning };
}

export async function applyThreadExecutionOverride(
  deps: LoggedWorkSessionDeps,
  args: ApplyThreadExecutionOverrideArgs,
): Promise<void> {
  const { thread, patch } = args;

  const models = await loadThreadProviderModels(
    deps,
    thread,
    typeof patch.model === "string" ? patch.model : null,
  );
  const existing = getThreadExecutionOverride(deps.db, thread.id) ?? {
    modelOverride: null,
    reasoningLevelOverride: null,
  };

  const next = resolveThreadExecutionOverrideUpdate(deps.providerRegistry, {
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

export function assertThreadPermissionModeAllowed(
  deps: LoggedWorkSessionDeps,
  args: ApplyThreadPermissionModeOverrideArgs,
): void {
  const { thread, permissionMode } = args;
  const hostId = resolveEnvironmentHostId(deps, thread.environmentId);
  const supported = deps.providerRegistry.getSupportedPermissionModes(
    thread.providerId,
  );
  if (supported && !supported.includes(permissionMode)) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${thread.providerId} only supports ${supported.join(", ")} permission mode.`,
    );
  }
  const allowed = clampPermissionModeToHost(deps, {
    hostId,
    permissionMode,
    providerId: thread.providerId,
  });
  if (allowed !== permissionMode) {
    throw new ApiError(
      400,
      "invalid_request",
      `This machine limits permission mode to ${allowed}; ${permissionMode} is not allowed here.`,
    );
  }
}

export function applyThreadPermissionModeOverride(
  deps: LoggedWorkSessionDeps,
  args: ApplyThreadPermissionModeOverrideArgs,
): void {
  const { thread, permissionMode } = args;
  assertThreadPermissionModeAllowed(deps, args);

  const existing = getThreadExecutionOverride(deps.db, thread.id);
  if (existing?.permissionModeOverride === permissionMode) return;

  setThreadExecutionOverride(deps.db, {
    threadId: thread.id,
    permissionModeOverride: permissionMode,
  });
  appendThreadEvent(deps, {
    threadId: thread.id,
    environmentId: thread.environmentId,
    type: "system/operation",
    scope: threadScope(),
    data: {
      operation: THREAD_PERMISSION_MODE_CHANGE_OPERATION,
      operationId: createEventId(),
      status: "completed",
      message: `Permission mode set to ${permissionMode}. It applies from the next turn.`,
      metadata: {
        previousPermissionMode:
          existing?.permissionModeOverride ??
          getLastExecutionOptions(deps, thread.id)?.permissionMode ??
          null,
        permissionMode,
      },
    },
  });
}

export async function recoverThreadModelOverride(
  deps: LoggedWorkSessionDeps,
  args: RecoverThreadModelOverrideArgs,
): Promise<void> {
  const existing = getThreadExecutionOverride(deps.db, args.thread.id);
  const patch: ThreadExecutionOverridePatch = {};
  if (
    args.model !== undefined &&
    args.modelSource === "explicit" &&
    existing?.modelOverride != null &&
    existing.modelOverride !== args.model
  ) {
    patch.model = args.model;
  }
  if (
    args.reasoningLevel !== undefined &&
    args.reasoningLevelSource === "explicit" &&
    existing?.reasoningLevelOverride != null &&
    existing.reasoningLevelOverride !== args.reasoningLevel
  ) {
    patch.reasoningLevel = args.reasoningLevel;
  }
  if (
    args.permissionMode !== undefined &&
    args.permissionModeSource === "explicit" &&
    existing?.permissionModeOverride != null &&
    existing.permissionModeOverride !== args.permissionMode
  ) {
    try {
      assertThreadPermissionModeAllowed(deps, {
        permissionMode: args.permissionMode,
        thread: args.thread,
      });
      setThreadExecutionOverride(deps.db, {
        threadId: args.thread.id,
        permissionModeOverride: args.permissionMode,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  if (patch.model === undefined && patch.reasoningLevel === undefined) return;

  await applyThreadExecutionOverride(deps, {
    thread: args.thread,
    patch,
  });
}

async function loadThreadProviderModels(
  deps: LoggedWorkSessionDeps,
  thread: Thread,
  requiredModel: string | null,
): Promise<readonly AvailableModel[]> {
  const result = await resolveSystemExecutionOptionsForValidation(
    deps,
    {
      providerId: thread.providerId,
      ...(thread.environmentId !== null
        ? { environmentId: thread.environmentId }
        : {}),
    },
    requiredModel,
  );
  if (result.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${thread.providerId} models to validate the change. Try again once the host is connected.`,
    );
  }
  return [...result.models, ...result.selectedOnlyModels];
}

function resolveFallbackModel(
  deps: LoggedWorkSessionDeps,
  thread: Thread,
): string | null {
  const lastExecution = getLastExecutionOptions(deps, thread.id);
  if (lastExecution?.model) {
    return lastExecution.model;
  }
  const projectDefaults = getProjectExecutionDefaults(deps.db, {
    projectId: thread.projectId,
  });
  return projectDefaults?.model ?? null;
}
