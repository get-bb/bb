/**
 * Agent CLI model catalog.
 *
 * Cursor's `agent --list-models` prints one `id - Display Name` line per
 * model and encodes reasoning effort in the id: `gpt-5.3-codex-low`, bare
 * `gpt-5.3-codex` for medium, `gpt-5.5-extra-high` as an alternate xhigh
 * spelling, with an optional `-fast` service tail after the effort token
 * (`gpt-5.3-codex-low-fast`). This module groups those raw variants into bb
 * model families so the picker offers one clean entry per family with
 * selectable reasoning efforts, and resolves a (family, effort, serviceTier)
 * selection back to the exact raw id at session launch — by table lookup,
 * never string synthesis, because effort spellings vary per family.
 *
 * The `-fast` tail is a service tier, not a separate model: both the normal
 * and fast raw ids for a given effort collapse into one family, and the bb
 * "Fast mode" toggle (serviceTier) selects between them at launch. Display
 * names are stripped of noise the picker renders elsewhere or doesn't need —
 * the per-model effort word (reasoning has its own control), the redundant
 * `1M` context tag, the `(NO ZDR)` data-retention marker, and Cursor's own
 * `(default)`/`(current)` annotations.
 *
 * Ids that don't follow the `base[-effort][-fast]` grammar (e.g. the
 * `…-high-thinking` style) stay standalone single-effort models.
 */

import { reasoningLevelValues } from "@bb/domain";
import type { AvailableModel, ReasoningLevel, ServiceTier } from "@bb/domain";

export interface RawAgentModel {
  id: string;
  displayName: string;
}

interface AgentModelVariant extends RawAgentModel {
  effort: ReasoningLevel;
  /** Whether this raw id carried the `-fast` service tail. */
  fast: boolean;
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
   * (`AvailableModel.id`) at the given effort and service tier. Picks the
   * `-fast` id when `serviceTier` is "fast" and the family has one, otherwise
   * the normal id. `reasoningLevel` omitted falls back to the family's default
   * effort. Returns undefined when the family or requested effort is unknown.
   */
  resolveVariant(args: {
    model: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: ServiceTier;
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
  fast: boolean;
} {
  let rest = id;
  let fast = false;
  if (rest.endsWith(FAST_TAIL)) {
    fast = true;
    rest = rest.slice(0, -FAST_TAIL.length);
  }
  for (const [token, effort] of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      return {
        familyKey: rest.slice(0, -(token.length + 1)),
        effort,
        effortToken: token,
        fast,
      };
    }
  }
  // No effort token: the id (minus any `-fast` tail) is its own family and
  // acts as its medium.
  return { familyKey: rest, effort: "medium", effortToken: undefined, fast };
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
    return cleanDisplayName(displayName);
  }
  return cleanDisplayName(
    displayName.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`), "$1"),
  );
}

/**
 * Strip picker noise from a Cursor display name so the list reads like the
 * Claude Code / Codex lists: the `1M` context tag (every big Cursor model is
 * 1M, so it distinguishes nothing), the `(NO ZDR)` data-retention marker, and
 * Cursor's own `(default)`/`(current)` annotations. The "Thinking" word is
 * deliberately kept — it distinguishes two real, separately selectable
 * families (e.g. `claude-opus-4-8` vs `claude-opus-4-8-thinking`).
 */
function cleanDisplayName(name: string): string {
  return name
    .replace(/\s*\((?:NO ZDR|default|current)\)/gi, "")
    .replace(/(^|\s)1M(?=\s|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Normal and fast raw ids for one (family, effort) cell. */
interface VariantTier {
  normal?: string;
  fast?: string;
}

/**
 * Group raw variants into model families. The family's bb-facing id is the
 * raw id of its default variant (the non-fast medium when present, else the
 * first non-fast listed), so threads persist real agent ids, fast stays an
 * opt-in tier rather than the default, and an effort-less launch needs no
 * translation. `-fast` ids fold into the same family as their normal twin and
 * become the family's fast service tier. Returns null when nothing parsed, so
 * callers can fall back to the synthetic default model.
 */
export function buildAgentModelCatalog(
  rawModels: readonly RawAgentModel[],
): AgentModelCatalog | null {
  const families = new Map<string, AgentModelVariant[]>();
  const effortTokensById = new Map<string, string | undefined>();
  for (const raw of rawModels) {
    const { familyKey, effort, effortToken, fast } = splitVariant(raw.id);
    effortTokensById.set(raw.id, effortToken);
    const members = families.get(familyKey) ?? [];
    // Dedupe per (effort, tier): keep one normal and one fast id per effort.
    if (members.some((m) => m.effort === effort && m.fast === fast)) {
      continue;
    }
    members.push({ ...raw, effort, fast });
    families.set(familyKey, members);
  }
  if (families.size === 0) {
    return null;
  }

  const models: AvailableModel[] = [];
  const variantsByFamilyId = new Map<
    string,
    Map<ReasoningLevel, VariantTier>
  >();
  const defaultEffortByFamilyId = new Map<string, ReasoningLevel>();
  for (const members of families.values()) {
    // The default variant and the reasoning ladder come from the non-fast
    // members (fast is a tier overlay, never the default). Fall back to all
    // members for the rare fast-only family.
    const baseMembers = members.filter((m) => !m.fast);
    const ladderMembers = baseMembers.length > 0 ? baseMembers : members;
    const defaultVariant =
      ladderMembers.find((member) => member.effort === "medium") ??
      ladderMembers[0];
    // Members keep the agent's listing order (it anchors the no-medium
    // default), but the picker's ladder reads low → max.
    const effortsInLadderOrder = [...ladderMembers].sort(
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
    const byEffort = new Map<ReasoningLevel, VariantTier>();
    for (const member of members) {
      const tier = byEffort.get(member.effort) ?? {};
      if (member.fast) {
        tier.fast = member.id;
      } else {
        tier.normal = member.id;
      }
      byEffort.set(member.effort, tier);
    }
    variantsByFamilyId.set(defaultVariant.id, byEffort);
    defaultEffortByFamilyId.set(defaultVariant.id, defaultVariant.effort);
  }

  return {
    models,
    resolveVariant({ model, reasoningLevel, serviceTier }) {
      const byEffort = variantsByFamilyId.get(model);
      if (!byEffort) {
        return undefined;
      }
      const effort = reasoningLevel ?? defaultEffortByFamilyId.get(model);
      const tier = effort === undefined ? undefined : byEffort.get(effort);
      if (!tier) {
        return undefined;
      }
      if (serviceTier === "fast" && tier.fast !== undefined) {
        return tier.fast;
      }
      return tier.normal ?? tier.fast;
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
