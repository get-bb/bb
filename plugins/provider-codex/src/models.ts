import {
  reasoningEffortsForLevels,
  reasoningLevelSchema,
  type AvailableModel,
  type ModelReasoningEffort,
  type ModelServiceTier,
  type ReasoningLevel,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  DAYBREAK_MODEL_OPTION_ID,
  DAYBREAK_OFF,
  DAYBREAK_ON,
} from "./daybreak.js";

const CODEX_FAST_SERVICE_TIER = "priority";
const BB_FAST_SERVICE_TIER = "fast";

const DAYBREAK_ALIAS_MODELS: ReadonlySet<string> = new Set([
  "gpt-daybreak-blue-latest",
  "gpt-daybreak-red-latest",
]);

export type CodexDaybreakProgram = "daybreakBlue" | "daybreakRed";

export function parseCyberAccessPrograms(raw: unknown): string[] | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const programs = (raw as { availableAccessPrograms?: unknown })
    .availableAccessPrograms;
  if (programs == null || typeof programs !== "object") {
    return null;
  }
  const cyber = (programs as { cyber?: unknown }).cyber;
  return Array.isArray(cyber)
    ? cyber.filter((program): program is string => typeof program === "string")
    : null;
}

export function codexDaybreakProgram(
  cyber: readonly string[] | null,
): CodexDaybreakProgram | null {
  if (cyber?.includes("daybreakBlue")) {
    return "daybreakBlue";
  }
  if (cyber?.includes("daybreakRed")) {
    return "daybreakRed";
  }
  return null;
}

function daybreakOptionValues(cyber: readonly string[] | null): string[] {
  const values: string[] = [];
  if (cyber === null || cyber.length === 0 || cyber.includes("standard")) {
    values.push(DAYBREAK_OFF);
  }
  if (codexDaybreakProgram(cyber) !== null) {
    values.push(DAYBREAK_ON);
  }
  return values;
}

const DEFAULT_REASONING_EFFORTS: readonly ModelReasoningEffort[] =
  reasoningEffortsForLevels(["low", "medium", "high", "xhigh"]);

const codexModelIdentitySchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
  })
  .passthrough();

function mapCodexReasoningLevelToBb(value: unknown): ReasoningLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mapBbReasoningLevelToCodex(
  level: ReasoningLevel,
): string | null {
  switch (level) {
    case "ultracode":
      return null;
    case "none":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
    case "ultra":
      return level;
  }
}

function cloneDefaultReasoningEfforts(): ModelReasoningEffort[] {
  return DEFAULT_REASONING_EFFORTS.map((effort) => ({ ...effort }));
}

function parseReasoningEffortOption(raw: unknown): ModelReasoningEffort | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const level = mapCodexReasoningLevelToBb(record.reasoningEffort);
  if (!level) {
    return null;
  }
  const description =
    typeof record.description === "string" && record.description.length > 0
      ? record.description
      : reasoningEffortsForLevels([level])[0].description;
  return {
    reasoningEffort: level,
    description,
  };
}

function parseSupportedReasoningEfforts(raw: unknown): ModelReasoningEffort[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return cloneDefaultReasoningEfforts();
  }

  const efforts: ModelReasoningEffort[] = [];
  const seen = new Set<ReasoningLevel>();
  for (const item of raw) {
    const effort = parseReasoningEffortOption(item);
    if (!effort || seen.has(effort.reasoningEffort)) {
      continue;
    }
    seen.add(effort.reasoningEffort);
    efforts.push(effort);
  }

  return efforts.length > 0 ? efforts : cloneDefaultReasoningEfforts();
}

function mapCodexServiceTierToBb(id: string): string {
  return id === CODEX_FAST_SERVICE_TIER ? BB_FAST_SERVICE_TIER : id;
}

function parseServiceTierOption(raw: unknown): ModelServiceTier | null {
  if (typeof raw === "string") {
    return raw.length > 0 ? { id: mapCodexServiceTierToBb(raw) } : null;
  }
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  return {
    id: mapCodexServiceTierToBb(record.id),
    ...(typeof record.name === "string" && record.name.length > 0
      ? { label: record.name }
      : {}),
    ...(typeof record.description === "string" && record.description.length > 0
      ? { description: record.description }
      : {}),
  };
}

function parseSupportedServiceTiers(
  raw: z.infer<typeof codexModelIdentitySchema>,
): ModelServiceTier[] {
  const listed = Array.isArray(raw.serviceTiers)
    ? raw.serviceTiers
    : Array.isArray(raw.additionalSpeedTiers)
      ? raw.additionalSpeedTiers
      : null;
  if (listed === null) {
    return [{ id: BB_FAST_SERVICE_TIER }];
  }
  const tiers: ModelServiceTier[] = [];
  const seen = new Set<string>();
  for (const item of listed) {
    const tier = parseServiceTierOption(item);
    if (!tier || seen.has(tier.id)) {
      continue;
    }
    seen.add(tier.id);
    tiers.push(tier);
  }
  return tiers;
}

function toAvailableModel(
  raw: z.infer<typeof codexModelIdentitySchema>,
): AvailableModel {
  const efforts = parseSupportedReasoningEfforts(raw.supportedReasoningEfforts);
  const mappedDefault = mapCodexReasoningLevelToBb(raw.defaultReasoningEffort);
  const defaultReasoningEffort =
    mappedDefault &&
    efforts.some((effort) => effort.reasoningEffort === mappedDefault)
      ? mappedDefault
      : efforts[0].reasoningEffort;

  return {
    id: raw.id,
    model: raw.model,
    displayName:
      typeof raw.displayName === "string" && raw.displayName.length > 0
        ? raw.displayName
        : raw.model,
    description: typeof raw.description === "string" ? raw.description : "",
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort,
    supportedServiceTiers: parseSupportedServiceTiers(raw),
    experimental_supportedModelOptions: {
      [DAYBREAK_MODEL_OPTION_ID]: daybreakOptionValues(
        parseCyberAccessPrograms(raw),
      ),
    },
    isDefault: raw.isDefault === true,
  };
}

export function parseModelsResponse(result: unknown): AvailableModel[] {
  if (result == null || typeof result !== "object") {
    throw new Error("Invalid response from codex model/list.");
  }

  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid response from codex model/list.");
  }

  const models: AvailableModel[] = [];
  for (const entry of data) {
    const identity = codexModelIdentitySchema.safeParse(entry);
    if (!identity.success) {
      continue;
    }
    models.push(toAvailableModel(identity.data));
  }

  if (models.length === 0) {
    throw new Error("Codex model/list returned no supported models.");
  }

  return models;
}

export function splitDaybreakAliasModels(models: readonly AvailableModel[]): {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
} {
  const switchable = models.some(
    (model) =>
      !DAYBREAK_ALIAS_MODELS.has(model.model) &&
      model.experimental_supportedModelOptions?.[
        DAYBREAK_MODEL_OPTION_ID
      ]?.includes(DAYBREAK_ON) === true,
  );
  if (!switchable) {
    return { models: [...models], selectedOnlyModels: [] };
  }
  return {
    models: models.filter((model) => !DAYBREAK_ALIAS_MODELS.has(model.model)),
    selectedOnlyModels: models.filter((model) =>
      DAYBREAK_ALIAS_MODELS.has(model.model),
    ),
  };
}
