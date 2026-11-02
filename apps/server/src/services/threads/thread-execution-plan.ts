import { getAppSettings, getQueuedThreadStartMessage, getThread } from "@bb/db";
import {
  DEFAULT_SERVICE_TIER,
  isStandardReasoningLevel,
  providerServiceTierOptions,
  reconcileServiceTier,
  type CallerExecutionInputSource,
  type PermissionMode,
  type ReasoningLevel,
  type RecordedThreadExecutionOptions,
  type ResolvedThreadExecutionOptions,
  type ServiceTier,
  type ThreadExecutionSource,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import {
  clampPermissionModeToHost,
  isHostPermissionCeilingConflictError,
  resolveEnvironmentHostId,
} from "../hosts/permission-ceiling.js";
import { loadThreadExecutionDefaults } from "./project-execution-defaults.js";
import {
  normalizeRecordedPermissionMode,
  type ThreadExecutionDefaults,
} from "./thread-default-policy.js";
import { getLastExecutionOptions } from "./thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";
import { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

interface ExecutionPlanFieldInput<TValue> {
  source: CallerExecutionInputSource;
  value: TValue;
}

interface ExistingThreadExecutionInput {
  model?: ExecutionPlanFieldInput<string>;
  permissionMode?: ExecutionPlanFieldInput<PermissionMode>;
  reasoningLevel?: ExecutionPlanFieldInput<ReasoningLevel>;
  serviceTier?: ExecutionPlanFieldInput<ServiceTier>;
}

export interface ExistingThreadExecutionInputRequest {
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
  executionInputSources?: ExistingThreadExecutionInputRequestSources;
}

interface ExistingThreadExecutionInputRequestSources {
  model?: CallerExecutionInputSource;
  permissionMode?: CallerExecutionInputSource;
  reasoningLevel?: CallerExecutionInputSource;
  serviceTier?: CallerExecutionInputSource;
}

interface ResolveExistingThreadExecutionPlanArgs {
  defaultModel?: string;
  executionSource: ThreadExecutionSource;
  hostId?: string | null;
  input: ExistingThreadExecutionInput;
  threadId: string;
}

interface ResolveThreadPermissionModeArgs {
  defaults: ThreadExecutionDefaults;
  hostId: string | null;
  lastExecution: RecordedThreadExecutionOptions | null;
  requested?: PermissionMode;
  thread: Thread;
}

interface ExistingThreadExecutionPlan {
  resolvedExecution: ResolvedThreadExecutionOptions;
}

function getStoredThreadExecutionOptions(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): RecordedThreadExecutionOptions | null {
  const lastExecution = getLastExecutionOptions(deps, thread.id);
  if (lastExecution !== null || thread.status !== "pending") {
    return lastExecution;
  }
  const queuedStart = getQueuedThreadStartMessage(deps.db, thread.id);
  if (queuedStart === null) return null;
  const queued = toThreadQueuedMessage(queuedStart);
  return {
    model: queued.model,
    reasoningLevel: queued.reasoningLevel,
    permissionMode: queued.permissionMode,
    serviceTier: queued.serviceTier,
    source: "client/turn/requested",
  };
}

function requireThread(deps: Pick<AppDeps, "db">, threadId: string) {
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return thread;
}

function resolveThreadPermissionMode(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ResolveThreadPermissionModeArgs,
): PermissionMode {
  const permissionMode = clampPermissionModeToHost(deps, {
    hostId: args.hostId,
    permissionMode:
      args.requested ??
      (args.lastExecution !== null
        ? normalizeRecordedPermissionMode(args.lastExecution.permissionMode)
        : args.defaults.permissionMode),
    providerId: args.thread.providerId,
  });
  validateProviderPermissionMode(
    deps.providerRegistry,
    args.thread.providerId,
    permissionMode,
  );
  return permissionMode;
}

export function resolveExistingThreadPermissionMode(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  threadId: string,
): PermissionMode {
  const thread = requireThread(deps, threadId);
  return resolveThreadPermissionMode(deps, {
    defaults: loadThreadExecutionDefaults(deps, thread),
    hostId: resolveEnvironmentHostId(deps, thread.environmentId),
    lastExecution: getStoredThreadExecutionOptions(deps, thread),
    thread,
  });
}

export function resolveThreadFallbackModel(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  thread: Thread,
): string | null {
  return (
    getStoredThreadExecutionOptions(deps, thread)?.model ??
    loadThreadExecutionDefaults(deps, thread).model
  );
}

function createMissingThreadExecutionModelError(threadId: string): ApiError {
  return new ApiError(
    500,
    "internal_error",
    `Thread ${threadId} has no stored execution model`,
  );
}

class ProviderCapabilityValidationError extends ApiError {}

function isMissingThreadExecutionModelError(
  error: unknown,
  threadId: string,
): boolean {
  return (
    error instanceof ApiError &&
    error.body.code === "internal_error" &&
    error.body.message === `Thread ${threadId} has no stored execution model`
  );
}

function isProviderCapabilityValidationError(
  error: unknown,
): error is ProviderCapabilityValidationError {
  return error instanceof ProviderCapabilityValidationError;
}

function hasExecutionInput(input: ExistingThreadExecutionInput): boolean {
  return (
    input.model !== undefined ||
    input.permissionMode !== undefined ||
    input.reasoningLevel !== undefined ||
    input.serviceTier !== undefined
  );
}

function toRequestInputField<TValue>(
  value: TValue | undefined,
  source: CallerExecutionInputSource | undefined,
): ExecutionPlanFieldInput<TValue> | undefined {
  if (value === undefined || source === undefined) {
    return undefined;
  }
  return { source, value };
}

function resolveRequestInputSource(
  sources: ExistingThreadExecutionInputRequestSources | undefined,
  field: keyof ExistingThreadExecutionInputRequestSources,
): CallerExecutionInputSource | undefined {
  if (sources === undefined) {
    return "explicit";
  }
  return sources[field];
}

export function buildExistingThreadExecutionInput(
  request: ExistingThreadExecutionInputRequest,
): ExistingThreadExecutionInput {
  const sources = request.executionInputSources;
  const model = toRequestInputField(
    request.model,
    resolveRequestInputSource(sources, "model"),
  );
  const serviceTier = toRequestInputField(
    request.serviceTier,
    resolveRequestInputSource(sources, "serviceTier"),
  );
  const reasoningLevel = toRequestInputField(
    request.reasoningLevel,
    resolveRequestInputSource(sources, "reasoningLevel"),
  );
  const permissionMode = toRequestInputField(
    request.permissionMode,
    resolveRequestInputSource(sources, "permissionMode"),
  );
  return {
    ...(model ? { model } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  };
}

function validateProviderPermissionMode(
  registry: ProviderRegistryService,
  providerId: string,
  permissionMode: PermissionMode,
): void {
  const supported = registry.getSupportedPermissionModes(providerId);
  if (!supported || supported.includes(permissionMode)) {
    return;
  }

  throw new ProviderCapabilityValidationError(
    400,
    "invalid_request",
    `Provider ${providerId} only supports ${supported.join(", ")} permission mode.`,
  );
}

function validateProviderReasoningLevel(
  registry: ProviderRegistryService,
  providerId: string,
  reasoningLevel: ReasoningLevel,
): void {
  const supportedLevels = getSupportedReasoningLevelsForProvider(
    registry,
    providerId,
  );
  if (
    supportedLevels.length === 0 ||
    supportedLevels.includes(reasoningLevel) ||
    !isStandardReasoningLevel(reasoningLevel)
  ) {
    return;
  }

  throw new ProviderCapabilityValidationError(
    400,
    "invalid_request",
    `Provider ${providerId} does not support ${reasoningLevel} reasoning level. Supported reasoning levels: ${supportedLevels.join(", ")}.`,
  );
}

function resolveProviderServiceTier(
  registry: ProviderRegistryService,
  args: {
    providerId: string;
    requested: ExecutionPlanFieldInput<ServiceTier> | undefined;
    inherited: ServiceTier;
  },
): ServiceTier {
  const provider = registry.get(args.providerId);
  const candidate = args.requested?.value ?? args.inherited;
  if (candidate === DEFAULT_SERVICE_TIER) {
    return DEFAULT_SERVICE_TIER;
  }
  if (provider === null) {
    return candidate;
  }
  const supported = providerServiceTierOptions(provider.info);
  const reconciled = reconcileServiceTier(candidate, supported);
  if (reconciled === candidate || args.requested?.source !== "explicit") {
    return reconciled;
  }

  throw new ProviderCapabilityValidationError(
    400,
    "invalid_request",
    supported.length === 0
      ? `Provider ${args.providerId} does not support service tiers.`
      : `Provider ${args.providerId} does not support the ${candidate} service tier. Supported service tiers: ${[
          DEFAULT_SERVICE_TIER,
          ...supported.map((tier) => tier.id),
        ].join(", ")}.`,
  );
}

export async function resolveExistingThreadExecutionPlan(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ResolveExistingThreadExecutionPlanArgs,
): Promise<ExistingThreadExecutionPlan> {
  const thread = requireThread(deps, args.threadId);
  const lastExecution = getStoredThreadExecutionOptions(deps, thread);
  const defaults = loadThreadExecutionDefaults(deps, thread);
  const model =
    args.input.model?.value ??
    thread.modelOverride ??
    lastExecution?.model ??
    args.defaultModel ??
    defaults.model;
  if (!model) {
    throw createMissingThreadExecutionModelError(args.threadId);
  }

  const permissionMode = resolveThreadPermissionMode(deps, {
    defaults,
    hostId:
      args.hostId === undefined
        ? resolveEnvironmentHostId(deps, thread.environmentId)
        : args.hostId,
    lastExecution,
    ...(args.input.permissionMode !== undefined
      ? { requested: args.input.permissionMode.value }
      : {}),
    thread,
  });

  const reasoningLevel =
    args.input.reasoningLevel?.value ??
    thread.reasoningLevelOverride ??
    lastExecution?.reasoningLevel ??
    defaults.reasoningLevel;
  validateProviderReasoningLevel(
    deps.providerRegistry,
    thread.providerId,
    reasoningLevel,
  );

  const serviceTier = getAppSettings(deps.db).allowFastServiceTier
    ? resolveProviderServiceTier(deps.providerRegistry, {
        providerId: thread.providerId,
        requested: args.input.serviceTier,
        inherited: lastExecution?.serviceTier ?? defaults.serviceTier,
      })
    : DEFAULT_SERVICE_TIER;

  const resolvedExecution = {
    model,
    permissionMode,
    reasoningLevel,
    serviceTier,
    source: args.executionSource,
  };
  return {
    resolvedExecution,
  };
}

export async function tryResolveExistingThreadExecutionPlan(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ResolveExistingThreadExecutionPlanArgs,
): Promise<ExistingThreadExecutionPlan | null> {
  try {
    return await resolveExistingThreadExecutionPlan(deps, args);
  } catch (error) {
    if (isMissingThreadExecutionModelError(error, args.threadId)) {
      return null;
    }
    if (
      !hasExecutionInput(args.input) &&
      (isProviderCapabilityValidationError(error) ||
        isHostPermissionCeilingConflictError(error))
    ) {
      return null;
    }
    throw error;
  }
}
