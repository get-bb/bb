import {
  getProjectExecutionDefaults,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import type {
  ProjectExecutionDefaults,
  ResolvedThreadExecutionOptions,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import type {
  ThreadCreateServiceRequest,
  ThreadCreateServiceRequestInput,
} from "./thread-create-request.js";
import { resolveCreateThreadExecutionDefaults } from "./thread-default-policy.js";

export interface RememberProjectExecutionDefaultsForCreateArgs {
  execution: ResolvedThreadExecutionOptions;
  request: ThreadCreateServiceRequest;
}

export interface ResolveProjectExecutionDefaultsForCreateArgs {
  executionInputSources?: ThreadCreateServiceRequestInput["executionInputSources"];
  model?: ThreadCreateServiceRequestInput["model"];
  projectId: string;
  providerId?: ThreadCreateServiceRequestInput["providerId"];
}

export interface ResolvedProjectExecutionDefaultsForCreate {
  executionDefaults: ProjectExecutionDefaults | null;
  providerId: string;
}

type CreateExecutionInputSources =
  ThreadCreateServiceRequestInput["executionInputSources"];
type CreateExecutionInputField = keyof NonNullable<CreateExecutionInputSources>;

interface ResolveRequestedCreateExecutionValueArgs<TValue> {
  field: CreateExecutionInputField;
  sources: CreateExecutionInputSources;
  value: TValue | undefined;
}

function shouldRememberProjectExecutionDefaults(args: {
  automationId: string | null;
  environment: ThreadCreateServiceRequest["environment"];
  origin: ThreadCreateServiceRequest["origin"];
}): boolean {
  // Reusing an existing worktree is a one-off in a specific environment, not
  // a fresh default-shaping event. Don't overwrite the project's stored
  // execution defaults with the picker selections made for that single thread.
  if (args.environment.type === "reuse") return false;
  return args.origin === "app" && args.automationId === null;
}

function resolveRequestedCreateExecutionValue<TValue>({
  field,
  sources,
  value,
}: ResolveRequestedCreateExecutionValueArgs<TValue>): TValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (sources === undefined) {
    return value;
  }
  return sources[field] === undefined ? undefined : value;
}

export function resolveProjectExecutionDefaultsForCreate(
  deps: Pick<AppDeps, "db">,
  args: ResolveProjectExecutionDefaultsForCreateArgs,
): ResolvedProjectExecutionDefaultsForCreate {
  const storedDefaults = getProjectExecutionDefaults(deps.db, {
    projectId: args.projectId,
  });
  const requestedProviderId = resolveRequestedCreateExecutionValue({
    field: "providerId",
    sources: args.executionInputSources,
    value: args.providerId,
  });
  const requestedModel = resolveRequestedCreateExecutionValue({
    field: "model",
    sources: args.executionInputSources,
    value: args.model,
  });
  const resolution = resolveCreateThreadExecutionDefaults({
    requestedProviderId,
    storedDefaults,
  });
  const { executionDefaults, providerId } = resolution;

  if (!requestedModel && !executionDefaults) {
    throw new ApiError(
      400,
      "invalid_request",
      `Model is required when project ${args.projectId} has no stored execution defaults for provider ${providerId}`,
    );
  }

  return {
    executionDefaults,
    providerId,
  };
}

export function rememberProjectExecutionDefaultsForCreate(
  deps: Pick<AppDeps, "db">,
  args: RememberProjectExecutionDefaultsForCreateArgs,
): void {
  if (!shouldRememberProjectExecutionDefaults(args.request)) {
    return;
  }

  upsertProjectExecutionDefaults(deps.db, {
    projectId: args.request.projectId,
    providerId: args.request.providerId,
    model: args.execution.model,
    reasoningLevel: args.execution.reasoningLevel,
    permissionMode: args.execution.permissionMode,
    serviceTier: args.execution.serviceTier,
  });
}
