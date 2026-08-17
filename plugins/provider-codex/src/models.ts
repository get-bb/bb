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

const codexModelIdentitySchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
  })
  .passthrough();

/** Map a Codex-native reasoning effort string into a BB ReasoningLevel. */
export function mapCodexReasoningLevelToBb(
  value: unknown,
): ReasoningLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  // Codex levels that BB knows about (including Codex-only "ultra") pass
  // through via the shared schema. Unknown future names soft-fail to null.
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Map a BB ReasoningLevel to the string Codex app-server expects for
 * `model_reasoning_effort`. Returns null for levels Codex never accepts
 * (currently only "none").
 *
 * "ultracode" is Claude-specific and is not sent to Codex; callers should not
 * offer it for Codex models. "ultra" is the Codex-native top tier and passes
 * through as-is.
 */
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

  // All efforts unknown/unmapped — fall back rather than rejecting the model.
  return efforts.length > 0 ? efforts : cloneDefaultReasoningEfforts();
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
    isDefault: raw.isDefault === true,
  };
}

/**
 * Parse Codex `model/list` results.
 *
 * Soft by design: unknown reasoning efforts are skipped, malformed model
 * entries are skipped, and only a completely unusable payload fails hard.
 * This keeps the model picker working when Codex introduces new effort names.
 */
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
