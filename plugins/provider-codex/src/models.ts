import {
  reasoningEffortsForLevels,
  reasoningLevelSchema,
  type AvailableModel,
  type ModelReasoningEffort,
  type ReasoningLevel,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const DEFAULT_REASONING_EFFORTS: readonly ModelReasoningEffort[] =
  reasoningEffortsForLevels(["low", "medium", "high", "xhigh"]);

type CodexReasoningLevelInput = string | number | boolean | null | undefined;

const codexReasoningEffortOptionSchema = z
  .object({
    reasoningEffort: z.string(),
    description: z.string().optional().catch(undefined),
  })
  .catch({ reasoningEffort: "" });

const codexModelIdentitySchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
    displayName: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
    supportedReasoningEfforts: z
      .array(codexReasoningEffortOptionSchema)
      .optional()
      .catch(undefined),
    defaultReasoningEffort: z.string().optional().catch(undefined),
    isDefault: z.boolean().optional().catch(undefined),
  })
  .strip();

const codexModelsResponseSchema = z.object({ data: z.array(z.unknown()) });

type CodexReasoningEffortOption = z.infer<
  typeof codexReasoningEffortOptionSchema
>;
type CodexModelIdentity = z.infer<typeof codexModelIdentitySchema>;

export function mapCodexReasoningLevelToBb(
  value: CodexReasoningLevelInput,
): ReasoningLevel | null {
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mapBbReasoningLevelToCodex(
  level: ReasoningLevel,
): string | null {
  switch (level) {
    case "none":
    case "ultracode":
      return null;
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

function parseReasoningEffortOption(
  raw: CodexReasoningEffortOption,
): ModelReasoningEffort | null {
  const level = mapCodexReasoningLevelToBb(raw.reasoningEffort);
  if (!level) {
    return null;
  }
  const description =
    raw.description !== undefined && raw.description.length > 0
      ? raw.description
      : reasoningEffortsForLevels([level])[0].description;
  return {
    reasoningEffort: level,
    description,
  };
}

function parseSupportedReasoningEfforts(
  raw: readonly CodexReasoningEffortOption[] | undefined,
): ModelReasoningEffort[] {
  if (raw === undefined || raw.length === 0) {
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

function toAvailableModel(raw: CodexModelIdentity): AvailableModel {
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
      raw.displayName !== undefined && raw.displayName.length > 0
        ? raw.displayName
        : raw.model,
    description: raw.description ?? "",
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort,
    isDefault: raw.isDefault === true,
  };
}

export function parseModelsResponse<T>(result: T): AvailableModel[] {
  const parsedResult = codexModelsResponseSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new Error("Invalid response from codex model/list.");
  }

  const models: AvailableModel[] = [];
  for (const entry of parsedResult.data.data) {
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
