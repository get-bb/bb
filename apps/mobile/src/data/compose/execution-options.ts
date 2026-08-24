import {
  PERMISSION_MODE_OPTIONS,
  type PermissionModeOption,
} from "@bb/client-core";
import {
  permissionModeRank,
  reconcileReasoningLevel,
  type AvailableModel,
  type PermissionMode,
  type ProviderInfo,
  type ReasoningLevel,
} from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";

/**
 * Picker option derivation for the execution controls (provider, model,
 * reasoning, permission mode), mirroring the pure parts of
 * apps/app/src/hooks/useThreadCreationOptions.ts and
 * thread-creation-options/selection-state.ts. Everything takes plain data so
 * the compose screen can call it from render.
 */

export interface ProviderPickerOption {
  value: string;
  label: string;
  logoUrl: string | null;
  /** The host glyph the provider declared, when it shipped no logo file. */
  glyph: string | null;
  available: boolean;
}

export interface ModelPickerOption {
  value: string;
  label: string;
  description: string;
  /** Provider route used to run this model when distinct from the agent provider. */
  routeProviderId?: string;
}

export interface ReasoningPickerOption {
  value: ReasoningLevel;
  label: string;
}

export interface PermissionModePickerOption extends PermissionModeOption {
  disabled: boolean;
  /** Set when the mode sits above the machine's permission ceiling. */
  disabledReason: string | null;
}

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
  ultra: "Ultra",
};

const PERMISSION_CEILING_REASON =
  "Above the selected machine's permission limit. Change it in Settings → Machines.";

const DEFAULT_SUPPORTED_PERMISSION_MODES: readonly PermissionMode[] = ["full"];

/** Case-normalise a raw model id into a displayable label. */
export function formatModelLabel(value: string): string {
  return value
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join("-");
}

export function buildProviderOptions(
  providers: readonly ProviderInfo[],
): ProviderPickerOption[] {
  return providers.map((provider) => ({
    value: provider.id,
    label: provider.displayName,
    logoUrl: provider.logoUrl,
    glyph: provider.icon?.glyph ?? null,
    available: provider.available,
  }));
}

/**
 * The provider that will run: the selection when the roster lists it, else
 * the roster's first entry (the server orders its default first).
 */
export function resolveEffectiveProviderId(
  providers: readonly ProviderInfo[],
  selectedProviderId: string | null | undefined,
): string {
  if (
    selectedProviderId &&
    providers.some((provider) => provider.id === selectedProviderId)
  ) {
    return selectedProviderId;
  }
  return providers[0]?.id ?? "";
}

function modelToOption(model: AvailableModel): ModelPickerOption {
  return {
    value: model.model,
    label: formatModelLabel(model.displayName || model.model),
    description: model.description,
    ...(model.routeProviderId
      ? { routeProviderId: model.routeProviderId }
      : {}),
  };
}

export interface ResolveModelSelectionArgs {
  executionOptions: SystemExecutionOptionsResponse | undefined;
  /** The stored/preferred model id, or null/"" for "use the catalog default". */
  selectedModel: string | null | undefined;
  /**
   * False while the catalog is provisional (placeholder data or a probe
   * failure). An unverified catalog never proves a stored model is gone, so
   * the explicit selection is kept instead of snapping to the default.
   */
  catalogVerified: boolean;
}

export interface ResolvedModelSelection {
  /** The model id that will run ("" when nothing is known yet). */
  selectedModel: string;
  activeModel: AvailableModel | undefined;
  /** Fresh picker choices; a retired-but-selected model is promoted to the top. */
  options: ModelPickerOption[];
  /** Retired/legacy models behind a "More models" disclosure. */
  moreOptions: ModelPickerOption[];
  /**
   * True when what will run differs from the stored string (model retired
   * and replaced by the default, or a prefix-free id resolved to its
   * canonical row). Callers send the model explicitly in that case.
   */
  isRecovery: boolean;
}

/**
 * Resolve the stored model against the catalog (mirrors the web hook):
 * re-point prefix-free Pi ids at their unique prefixed row, keep a retired
 * selection visible by promoting it from `selectedOnlyModels`, and fall back
 * to the catalog default only once the catalog is verified.
 */
export function resolveModelSelection({
  executionOptions,
  selectedModel,
  catalogVerified,
}: ResolveModelSelectionArgs): ResolvedModelSelection {
  const activeModels = executionOptions?.models ?? [];
  const selectedOnly = executionOptions?.selectedOnlyModels ?? [];
  const raw = selectedModel ?? "";
  const catalog = [...activeModels, ...selectedOnly];
  let normalized = raw;
  if (raw && !catalog.some((model) => model.model === raw)) {
    const prefixed = catalog.filter((model) => model.model.endsWith(`/${raw}`));
    if (prefixed.length === 1) normalized = prefixed[0].model;
  }
  let availableModels = activeModels;
  if (normalized && !activeModels.some((model) => model.model === normalized)) {
    const promoted = selectedOnly.find((model) => model.model === normalized);
    if (promoted) availableModels = [promoted, ...activeModels];
  }
  let effective: string;
  if (!catalogVerified && normalized) {
    effective = normalized;
  } else if (availableModels.length === 0) {
    effective = normalized;
  } else if (availableModels.some((model) => model.model === normalized)) {
    effective = normalized;
  } else {
    effective =
      availableModels.find((model) => model.isDefault)?.model ??
      availableModels[0].model;
  }
  const activeModel =
    availableModels.find((model) => model.model === effective) ??
    availableModels.find((model) => model.isDefault) ??
    availableModels[0];
  return {
    selectedModel: effective,
    activeModel,
    options: availableModels.map(modelToOption),
    moreOptions: selectedOnly
      .filter((model) => !availableModels.some((m) => m.model === model.model))
      .map(modelToOption),
    isRecovery: catalogVerified && raw.length > 0 && effective !== raw,
  };
}

export function buildReasoningOptions(
  model: AvailableModel | undefined,
): ReasoningPickerOption[] {
  if (!model) return [];
  const seen = new Set<ReasoningLevel>();
  const options: ReasoningPickerOption[] = [];
  for (const effort of model.supportedReasoningEfforts) {
    if (seen.has(effort.reasoningEffort)) continue;
    seen.add(effort.reasoningEffort);
    options.push({
      value: effort.reasoningEffort,
      label: REASONING_LABELS[effort.reasoningEffort],
    });
  }
  return options;
}

/**
 * Carry the preferred level across model switches when supported, else the
 * closest supported level (ties upward; see `reconcileReasoningLevel`).
 * With no options (no model yet) the preference passes through.
 */
export function resolveReasoningLevel(
  preferred: ReasoningLevel | null | undefined,
  options: readonly ReasoningPickerOption[],
): ReasoningLevel {
  const level = preferred ?? "medium";
  if (options.length === 0) return level;
  return reconcileReasoningLevel(
    level,
    options.map((option) => option.value),
  );
}

export interface PermissionModeSelectionArgs {
  /** The provider's supported modes (`capabilities.permissionModes`). */
  permissionModes: readonly PermissionMode[] | undefined;
  /** The routed machine's ceiling (`permissionCeiling` / host `maxPermissionMode`). */
  ceiling: PermissionMode;
}

/** Modes the provider supports that also fit under the machine ceiling. */
function allowedPermissionModes({
  permissionModes = DEFAULT_SUPPORTED_PERMISSION_MODES,
  ceiling,
}: PermissionModeSelectionArgs): PermissionMode[] {
  return permissionModes.filter(
    (mode) => permissionModeRank(mode) <= permissionModeRank(ceiling),
  );
}

/**
 * The picker rows: every mode the provider supports, with the ones above the
 * machine ceiling listed but disabled so the picker never offers a mode the
 * server would resolve back down.
 */
export function buildPermissionModeOptions({
  permissionModes = DEFAULT_SUPPORTED_PERMISSION_MODES,
  ceiling,
}: PermissionModeSelectionArgs): PermissionModePickerOption[] {
  return PERMISSION_MODE_OPTIONS.filter((option) =>
    permissionModes.includes(option.value),
  ).map((option) => {
    const aboveCeiling =
      permissionModeRank(option.value) > permissionModeRank(ceiling);
    return {
      ...option,
      disabled: aboveCeiling,
      disabledReason: aboveCeiling ? PERMISSION_CEILING_REASON : null,
    };
  });
}

/**
 * The permission mode that will run: the stored preference when allowed,
 * otherwise Auto (product default), then Full Access, then whatever the
 * provider supports. A preference above the ceiling shows as the clamped
 * mode, not the one that would be resolved away.
 */
export function resolvePermissionModeSelection(
  rawPermissionMode: PermissionMode | null | undefined,
  args: PermissionModeSelectionArgs,
): PermissionMode {
  const supported = args.permissionModes ?? DEFAULT_SUPPORTED_PERMISSION_MODES;
  const allowed = allowedPermissionModes(args);
  const modes = allowed.length > 0 ? allowed : supported;
  if (rawPermissionMode && modes.includes(rawPermissionMode)) {
    return rawPermissionMode;
  }
  if (modes.includes("auto")) return "auto";
  if (modes.includes("full")) return "full";
  return modes[0] ?? "auto";
}

/** Plain-text model probe failure (mirrors the web model-load-error-message). */
export function formatModelLoadErrorText(
  error: SystemExecutionOptionsModelLoadError,
  providerLabel: string,
): string {
  switch (error.code) {
    case "provider_unavailable":
      return `${providerLabel} is unavailable because its provider plugin failed to load.`;
    case "timeout":
      return `Timed out loading models for ${providerLabel}.`;
    case "missing_executable":
      return `Could not load models for ${providerLabel}. Make sure its CLI is installed on the machine.`;
    case "auth_required":
      return `Could not load models for ${providerLabel}. Sign in to the provider CLI on the machine first.`;
    case "failed":
      return `Could not load models for ${providerLabel}.`;
  }
}
