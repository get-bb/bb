/**
 * Agent CLI model catalog.
 *
 * Cursor's `agent --list-models` prints one `id - Display Name` line per
 * model and encodes reasoning effort in the id: `gpt-5.3-codex-low`, bare
 * `gpt-5.3-codex` for medium, `gpt-5.5-extra-high` as an alternate xhigh
 * spelling, with an optional `-fast` service tail after the effort token
 * (`gpt-5.3-codex-low-fast`). This module groups those raw variants into bb
 * model families so the picker offers one entry per family with selectable
 * reasoning efforts, and resolves a (family, effort) selection back to the
 * exact raw id at session launch — by table lookup, never string synthesis,
 * because effort spellings vary per family.
 *
 * Ids that don't follow the `base[-effort][-fast]` grammar (e.g. the
 * `…-high-thinking` style) stay standalone single-effort models.
 */

import { reasoningLevelValues } from "@bb/domain";
import type { AvailableModel, ReasoningLevel } from "@bb/domain";

export interface RawAgentModel {
  id: string;
  displayName: string;
}

interface AgentModelVariant extends RawAgentModel {
  effort: ReasoningLevel;
}

const MODEL_LINE_PATTERN = /^(\S+) - (.+)$/;

// Trailing id tokens that mark a reasoning-effort variant, longest first so
// `extra-high` wins over `high`. `none` is deliberately absent — bb has no
// matching level, so `-none` ids stay standalone models.
const EFFORT_TOKENS: ReadonlyArray<readonly [string, ReasoningLevel]> = [
  ["extra-high", "xhigh"],
  ["medium", "medium"],
  ["xhigh", "xhigh"],
  ["high", "high"],
  ["low", "low"],
  ["max", "max"],
];

const FAST_TAIL = "-fast";

export interface AgentModelCatalog {
  models: AvailableModel[];
  /**
   * Exact raw agent id for the family identified by its default-variant id
   * (`AvailableModel.id`) at the given effort; undefined when the family has
   * no such variant.
   */
  resolveVariant(args: {
    model: string;
    reasoningLevel: ReasoningLevel;
  }): string | undefined;
}

/** Parse `id - Display Name` stdout lines; headers and chatter are skipped. */
export function parseAgentModelLines(stdout: string): RawAgentModel[] {
  const models: RawAgentModel[] = [];
  for (const line of stdout.split("\n")) {
    const match = MODEL_LINE_PATTERN.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, id, displayName] = match;
    models.push({ id, displayName });
  }
  return models;
}

function splitVariant(id: string): {
  familyKey: string;
  effort: ReasoningLevel;
  effortToken: string | undefined;
} {
  let rest = id;
  let fast = false;
  if (rest.endsWith(FAST_TAIL)) {
    fast = true;
    rest = rest.slice(0, -FAST_TAIL.length);
  }
  for (const [token, effort] of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      const base = rest.slice(0, -(token.length + 1));
      return {
        familyKey: base + (fast ? FAST_TAIL : ""),
        effort,
        effortToken: token,
      };
    }
  }
  // No effort token: the id is its own family and acts as its medium.
  return { familyKey: id, effort: "medium", effortToken: undefined };
}

// How the agent's display names spell each effort token, for stripping the
// default variant's effort word out of the family display name.
const EFFORT_DISPLAY_WORDS: Readonly<Record<string, string>> = {
  "extra-high": "Extra High",
  medium: "Medium",
  xhigh: "Extra High",
  high: "High",
  low: "Low",
  max: "Max",
};

/**
 * Family display name: the default variant's name minus its own effort word
 * ("Opus 4.8 1M Medium" → "Opus 4.8 1M") — bb renders reasoning separately,
 * so keeping the word would show the level twice. Only the default variant's
 * explicit token is stripped; brand words that happen to match another
 * effort ("Codex 5.1 Max") are untouched.
 */
function familyDisplayName(
  displayName: string,
  effortToken: string | undefined,
): string {
  const word = effortToken ? EFFORT_DISPLAY_WORDS[effortToken] : undefined;
  if (!word) {
    return displayName;
  }
  return displayName
    .replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`), "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Group raw variants into model families. The family's bb-facing id is the
 * raw id of its default variant (medium when present, else the first listed),
 * so threads persist real agent ids and an effort-less launch needs no
 * translation. Returns null when nothing parsed, so callers can fall back to
 * the synthetic default model.
 */
export function buildAgentModelCatalog(
  rawModels: readonly RawAgentModel[],
): AgentModelCatalog | null {
  const families = new Map<string, AgentModelVariant[]>();
  const effortTokensById = new Map<string, string | undefined>();
  for (const raw of rawModels) {
    const { familyKey, effort, effortToken } = splitVariant(raw.id);
    effortTokensById.set(raw.id, effortToken);
    const members = families.get(familyKey) ?? [];
    if (members.some((member) => member.effort === effort)) {
      continue;
    }
    members.push({ ...raw, effort });
    families.set(familyKey, members);
  }
  if (families.size === 0) {
    return null;
  }

  const models: AvailableModel[] = [];
  const variantsByFamilyId = new Map<string, Map<ReasoningLevel, string>>();
  for (const members of families.values()) {
    const defaultVariant =
      members.find((member) => member.effort === "medium") ?? members[0];
    // Members keep the agent's listing order (it anchors the no-medium
    // default), but the picker's ladder reads low → max.
    const effortsInLadderOrder = [...members].sort(
      (a, b) =>
        reasoningLevelValues.indexOf(a.effort) -
        reasoningLevelValues.indexOf(b.effort),
    );
    models.push({
      id: defaultVariant.id,
      model: defaultVariant.id,
      displayName: familyDisplayName(
        defaultVariant.displayName,
        effortTokensById.get(defaultVariant.id),
      ),
      description: "",
      supportedReasoningEfforts: effortsInLadderOrder.map((member) => ({
        reasoningEffort: member.effort,
        description: member.displayName,
      })),
      defaultReasoningEffort: defaultVariant.effort,
      // The agent lists its default model first.
      isDefault: models.length === 0,
    });
    variantsByFamilyId.set(
      defaultVariant.id,
      new Map(members.map((member) => [member.effort, member.id])),
    );
  }

  return {
    models,
    resolveVariant({ model, reasoningLevel }) {
      return variantsByFamilyId.get(model)?.get(reasoningLevel);
    },
  };
}

export interface SplitPrimaryModelsResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

/**
 * Split the catalog into the picker's default list (families named in
 * `primaryModels`, by family id, in the declared order) and the collapsed
 * "more models" pool. Falls back to everything-primary when no name matches
 * — a renamed agent catalog must degrade to a full picker, never an empty
 * one. The default flag is re-anchored onto the primary list so the
 * picker's preselection never points at a hidden entry.
 */
export function splitPrimaryModels(
  catalogModels: readonly AvailableModel[],
  primaryModels: readonly string[],
): SplitPrimaryModelsResult {
  const primaryIds = new Set(primaryModels);
  const modelsById = new Map(catalogModels.map((model) => [model.id, model]));
  const models = primaryModels.flatMap((id) => {
    const model = modelsById.get(id);
    return model ? [model] : [];
  });
  if (models.length === 0) {
    return { models: [...catalogModels], selectedOnlyModels: [] };
  }
  const selectedOnlyModels = catalogModels.filter(
    (model) => !primaryIds.has(model.id),
  );
  if (models.some((model) => model.isDefault)) {
    return {
      models,
      selectedOnlyModels: selectedOnlyModels.map((model) =>
        model.isDefault ? { ...model, isDefault: false } : model,
      ),
    };
  }
  return {
    models: models.map((model, index) =>
      index === 0 ? { ...model, isDefault: true } : model,
    ),
    selectedOnlyModels: selectedOnlyModels.map((model) =>
      model.isDefault ? { ...model, isDefault: false } : model,
    ),
  };
}
