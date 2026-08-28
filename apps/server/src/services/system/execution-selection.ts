import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import type {
  SystemExecutionSelectionValidationRequest,
  SystemExecutionSelectionValidationResponse,
} from "@bb/server-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import { resolveSystemProviderModels } from "./execution-options.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

export interface AuthoritativeProviderExecutionCatalog {
  models: readonly AvailableModel[];
  selectedOnlyModels: readonly AvailableModel[];
}

interface LoadAuthoritativeProviderExecutionCatalogArgs {
  cwd?: string;
  hostId: string;
  model?: string;
  providerId: string;
}

interface ValidateExecutionSelectionAgainstCatalogArgs {
  catalog: AuthoritativeProviderExecutionCatalog;
  model: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
}

export interface ValidatedProviderExecutionSelection {
  model: string;
  modelEntry: AvailableModel;
  providerId: string;
  reasoningLevel: ReasoningLevel;
}

export function isExecutionSelectionCatalogMismatch(
  error: unknown,
): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.body.code === "model_not_available" ||
      error.body.code === "reasoning_level_not_supported")
  );
}

export async function loadAuthoritativeProviderExecutionCatalog(
  deps: LoggedWorkSessionDeps,
  args: LoadAuthoritativeProviderExecutionCatalogArgs,
): Promise<AuthoritativeProviderExecutionCatalog> {
  const catalog = await resolveSystemProviderModels(deps, args);
  if (catalog.modelLoadError !== null) {
    const code = catalog.modelLoadError.code;
    if (
      (code === "timeout" || code === "failed") &&
      (catalog.models.length > 0 || catalog.selectedOnlyModels.length > 0) &&
      (args.model === undefined ||
        [...catalog.models, ...catalog.selectedOnlyModels].some(
          (model) => model.id === args.model || model.model === args.model,
        ))
    ) {
      return {
        models: catalog.models,
        selectedOnlyModels: catalog.selectedOnlyModels,
      };
    }
    const message =
      code === "missing_executable"
        ? `Unable to load ${args.providerId} models because its executable is not installed on the selected machine.`
        : code === "auth_required"
          ? `Unable to load ${args.providerId} models because the provider requires authentication on the selected machine.`
          : code === "provider_unavailable"
            ? `Unable to load ${args.providerId} models because the provider is unavailable on the selected machine.`
            : `Unable to load ${args.providerId} models to validate the execution selection. Try again once the host is connected and the provider is ready.`;
    throw new ApiError(503, "model_catalog_unavailable", message, {
      details: catalog.modelLoadError,
      retryable: code === "timeout" || code === "failed",
    });
  }
  return {
    models: catalog.models,
    selectedOnlyModels: catalog.selectedOnlyModels,
  };
}

export function validateExecutionSelectionAgainstCatalog(
  args: ValidateExecutionSelectionAgainstCatalogArgs,
): ValidatedProviderExecutionSelection {
  const candidates = [
    ...args.catalog.models,
    ...args.catalog.selectedOnlyModels,
  ];
  const modelEntry = candidates.find(
    (candidate) =>
      candidate.id === args.model || candidate.model === args.model,
  );
  if (modelEntry === undefined) {
    throw new ApiError(
      400,
      "model_not_available",
      `Model "${args.model}" is not available for provider ${args.providerId} on the selected machine. Choose a model from the provider catalog or register an accepted unlisted id in customModels.`,
    );
  }

  const supportedReasoningLevels = modelEntry.supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  if (
    supportedReasoningLevels.length > 0 &&
    !supportedReasoningLevels.includes(args.reasoningLevel)
  ) {
    throw new ApiError(
      400,
      "reasoning_level_not_supported",
      `Reasoning level "${args.reasoningLevel}" is not supported by ${args.providerId} model "${args.model}". Supported reasoning levels: ${supportedReasoningLevels.join(", ")}.`,
    );
  }

  return {
    providerId: args.providerId,
    model: modelEntry.model,
    modelEntry,
    reasoningLevel: args.reasoningLevel,
  };
}

export async function validateProviderExecutionSelection(
  deps: LoggedWorkSessionDeps,
  args: LoadAuthoritativeProviderExecutionCatalogArgs & {
    model: string;
    reasoningLevel: ReasoningLevel;
  },
): Promise<ValidatedProviderExecutionSelection> {
  const catalog = await loadAuthoritativeProviderExecutionCatalog(deps, args);
  return validateExecutionSelectionAgainstCatalog({
    catalog,
    model: args.model,
    providerId: args.providerId,
    reasoningLevel: args.reasoningLevel,
  });
}

export async function validateSystemExecutionSelection(
  deps: LoggedWorkSessionDeps,
  request: SystemExecutionSelectionValidationRequest,
): Promise<SystemExecutionSelectionValidationResponse> {
  const hostId = resolveSystemLookupHostId(deps, request);
  const cwd =
    request.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, request.environmentId).path ?? undefined);
  const validated = await validateProviderExecutionSelection(deps, {
    ...(cwd === undefined ? {} : { cwd }),
    hostId,
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
  });
  return {
    providerId: validated.providerId,
    model: validated.model,
    reasoningLevel: validated.reasoningLevel,
  };
}
