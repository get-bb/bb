import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import { getProjectExecutionDefaults, getThread } from "@bb/db";
import type {
  CallerExecutionInputSource,
  PermissionMode,
  ProjectExecutionDefaults,
  ReasoningLevel,
  ResolvedThreadExecutionOptions,
  ServiceTier,
  ThreadExecutionSource,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  DEFAULT_REASONING_LEVEL,
  DEFAULT_SERVICE_TIER,
  resolveCreateThreadExecutionDefaults,
  resolveThreadExecutionPermissionMode,
} from "./thread-default-policy.js";
import {
  getLastExecutionOptions,
} from "./thread-events.js";
import { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

export interface ExecutionPlanFieldInput<TValue> {
  source: CallerExecutionInputSource;
  value: TValue;
}

export interface ExistingThreadExecutionInput {
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

export interface ExistingThreadExecutionInputRequestSources {
  model?: CallerExecutionInputSource;
  permissionMode?: CallerExecutionInputSource;
  reasoningLevel?: CallerExecutionInputSource;
  serviceTier?: CallerExecutionInputSource;
}

export interface ResolveExistingThreadExecutionPlanArgs {
  executionSource: ThreadExecutionSource;
  input: ExistingThreadExecutionInput;
  projectDefaults?: ProjectExecutionDefaults | null;
  threadId: string;
}

export interface ResolveProjectCreateDefaultExecutionPlanArgs {
  projectId: string;
  requestedProviderId?: string;
}

export interface ExistingThreadExecutionPlan {
  defaultView: ResolvedThreadExecutionOptions;
  eventExecution: ResolvedThreadExecutionOptions;
  queuedExecution: ResolvedThreadExecutionOptions;
  resolvedExecution: ResolvedThreadExecutionOptions;
}

export interface ProjectCreateDefaultExecutionPlan {
  defaultView: ProjectExecutionDefaults | null;
  providerId: string;
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
    error.body.message ===
      `Thread ${threadId} has no stored execution model`
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
  providerId: string | undefined,
  permissionMode: PermissionMode,
): void {
  if (!providerId || !isAgentProviderId(providerId)) {
    return;
  }

  const provider = getBuiltInAgentProviderInfo(providerId);
  if (provider.capabilities.supportedPermissionModes.includes(permissionMode)) {
    return;
  }

  throw new ProviderCapabilityValidationError(
    400,
    "invalid_request",
    `Provider ${providerId} only supports ${provider.capabilities.supportedPermissionModes.join(", ")} permission mode.`,
  );
}

function validateProviderReasoningLevel(
  providerId: string | undefined,
  reasoningLevel: ReasoningLevel,
): void {
  const supportedLevels = getSupportedReasoningLevelsForProvider(
    providerId ?? "",
  );
  if (supportedLevels.length === 0 || supportedLevels.includes(reasoningLevel)) {
    return;
  }

  throw new ProviderCapabilityValidationError(
    400,
    "invalid_request",
    `Provider ${providerId} does not support ${reasoningLevel} reasoning level. Supported reasoning levels: ${supportedLevels.join(", ")}.`,
  );
}

function resolveRequiredField<TValue>(
  candidates: readonly (TValue | undefined)[],
): TValue | null {
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return null;
}

function resolveFieldWithDefault<TValue>(
  candidates: readonly (TValue | undefined)[],
  defaultValue: TValue,
): TValue {
  return resolveRequiredField(candidates) ?? defaultValue;
}

export async function resolveExistingThreadExecutionPlan(
  deps: Pick<AppDeps, "db">,
  args: ResolveExistingThreadExecutionPlanArgs,
): Promise<ExistingThreadExecutionPlan> {
  const lastExecution = getLastExecutionOptions(deps, args.threadId);
  const thread = getThread(deps.db, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  // Omitted project defaults means "load current project policy"; callers pass
  // null only when they need to prove project defaults are intentionally absent.
  const rawProjectExecution =
    args.projectDefaults === undefined
      ? getProjectExecutionDefaults(deps.db, {
          projectId: thread.projectId,
        })
      : args.projectDefaults;
  const projectExecution =
    rawProjectExecution?.providerId === thread.providerId
      ? rawProjectExecution
      : null;
  const parentThread =
    thread.parentThreadId !== null
      ? getThread(deps.db, thread.parentThreadId)
      : null;
  const parentExecution =
    parentThread !== null
      ? getLastExecutionOptions(deps, parentThread.id)
      : null;
  const model = resolveRequiredField<string>([
    args.input.model?.value,
    thread.modelOverride ?? undefined,
    lastExecution?.model,
    projectExecution?.model,
  ]);
  if (!model) {
    throw createMissingThreadExecutionModelError(args.threadId);
  }

  const permissionMode = resolveThreadExecutionPermissionMode({
    requestedPermissionMode: args.input.permissionMode?.value,
    lastExecutionPermissionMode: lastExecution?.permissionMode,
    parentThread,
    parentThreadExecutionPermissionMode: parentExecution?.permissionMode,
    projectExecutionPermissionMode: projectExecution?.permissionMode,
    thread,
  });
  validateProviderPermissionMode(thread.providerId, permissionMode);

  const reasoningLevel = resolveFieldWithDefault<ReasoningLevel>(
    [
      args.input.reasoningLevel?.value,
      thread.reasoningLevelOverride ?? undefined,
      lastExecution?.reasoningLevel,
      projectExecution?.reasoningLevel,
    ],
    DEFAULT_REASONING_LEVEL,
  );
  validateProviderReasoningLevel(thread.providerId, reasoningLevel);

  const serviceTier = resolveFieldWithDefault<ServiceTier>(
    [
      args.input.serviceTier?.value,
      lastExecution?.serviceTier,
      projectExecution?.serviceTier,
    ],
    DEFAULT_SERVICE_TIER,
  );

  const resolvedExecution = {
    model,
    permissionMode,
    reasoningLevel,
    serviceTier,
    source: args.executionSource,
  };
  return {
    defaultView: resolvedExecution,
    eventExecution: resolvedExecution,
    queuedExecution: resolvedExecution,
    resolvedExecution,
  };
}

export async function tryResolveExistingThreadExecutionPlan(
  deps: Pick<AppDeps, "db">,
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
      isProviderCapabilityValidationError(error)
    ) {
      return null;
    }
    throw error;
  }
}

export function resolveProjectCreateDefaultExecutionPlan(
  deps: Pick<AppDeps, "db">,
  args: ResolveProjectCreateDefaultExecutionPlanArgs,
): ProjectCreateDefaultExecutionPlan {
  const storedDefaults = getProjectExecutionDefaults(deps.db, {
    projectId: args.projectId,
  });
  const resolution = resolveCreateThreadExecutionDefaults({
    requestedProviderId: args.requestedProviderId,
    storedDefaults,
  });
  return {
    defaultView: resolution.executionDefaults,
    providerId: resolution.providerId,
  };
}
