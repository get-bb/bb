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
 * "Fast mode" toggle (serviceTier) selects between them at launch.
 *
 * Cursor's "thinking" marker (appearing as an infix `…-thinking-medium` or a
 * suffix `…-medium-thinking` / `…-thinking`) is folded into the reasoning
 * ladder too: thinking variants keep their effort, and the model's
 * non-thinking variants collapse onto a single "none" (thinking-off) level at
 * the bottom of the ladder. So one "Opus 4.8" entry offers None, Low … Max
 * instead of separate "Opus 4.8" and "Opus 4.8 Thinking" rows. An explicit
 * `-none` effort id (e.g. `gpt-5.5-none`) is the same "none" level.
 *
 * Display names are stripped of noise the picker renders elsewhere or doesn't
 * need — the per-model effort word and "Thinking" marker (reasoning has its
 * own control), the redundant `1M` context tag, the `(NO ZDR)` data-retention
 * marker, and Cursor's own `(default)`/`(current)` annotations.
 */

import { reasoningLevelValues } from "@bb/domain";
import type { AvailableModel, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { AcpConfigOption } from "../wire.js";

export interface RawAgentModel {
  id: string;
  displayName: string;
}

export const ACP_NATIVE_REASONING_EFFORTS: AvailableModel["supportedReasoningEfforts"] =
  [
    {
      reasoningEffort: "medium",
      description: "Reasoning effort is managed by the connected ACP agent.",
    },
  ];

export interface AcpNativeReasoningSupport {
  supportedReasoningEfforts: AvailableModel["supportedReasoningEfforts"];
  defaultReasoningEffort: ReasoningLevel;
}

interface AgentModelVariant extends RawAgentModel {
  /** Raw effort token's level (medium when absent), before the none collapse. */
  effort: ReasoningLevel;
  /** Matched effort display token, for stripping the family name. */
  effortToken: string | undefined;
  /** Whether this raw id carried the `-fast` service tail. */
  fast: boolean;
  /** Whether this raw id carried Cursor's "thinking" marker. */
  thinking: boolean;
}

const MODEL_LINE_PATTERN = /^(\S+) - (.+)$/;

// Trailing id tokens that mark a reasoning-effort variant, longest first so
// `extra-high` wins over `high`. `none` maps onto bb's "none" (thinking-off)
// level, used by explicit `-none` ids and by the non-thinking collapse.
const EFFORT_TOKENS: ReadonlyArray<readonly [string, ReasoningLevel]> = [
  ["extra-high", "xhigh"],
  ["medium", "medium"],
  ["xhigh", "xhigh"],
  ["high", "high"],
  ["low", "low"],
  ["max", "max"],
  ["none", "none"],
];

const FAST_TAIL = "-fast";
const THINKING_TOKEN = "thinking";

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

export function findAcpModelConfigOption(
  configOptions: readonly AcpConfigOption[] | undefined,
): AcpConfigOption | undefined {
  const options = configOptions ?? [];
  return (
    options.find((option) => option.category === "model") ??
    options.find((option) => option.id === "model")
  );
}

export function findAcpThoughtLevelConfigOption(
  configOptions: readonly AcpConfigOption[] | undefined,
): AcpConfigOption | undefined {
  return (configOptions ?? []).find(
    (option) => option.category === "thought_level",
  );
}

const ACP_NATIVE_REASONING_LEVEL_BY_VALUE: Readonly<
  Partial<Record<string, ReasoningLevel>>
> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

const ACP_NATIVE_REASONING_VALUE_BY_LEVEL: Readonly<
  Partial<Record<ReasoningLevel, string>>
> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

function acpNativeValueToReasoningLevel(
  value: string | undefined,
): ReasoningLevel | undefined {
  return value === undefined
    ? undefined
    : ACP_NATIVE_REASONING_LEVEL_BY_VALUE[value];
}

export function acpNativeReasoningLevelToValue(
  level: ReasoningLevel,
  thoughtLevelOption: AcpConfigOption,
): string | undefined {
  const mappedValue = ACP_NATIVE_REASONING_VALUE_BY_LEVEL[level];
  if (mappedValue === undefined) {
    return undefined;
  }
  const values = new Set(
    (thoughtLevelOption.options ?? []).map((o) => o.value),
  );
  return values.has(mappedValue) ? mappedValue : undefined;
}

export function buildAcpNativeReasoningSupport(
  thoughtLevelOption: AcpConfigOption | undefined,
): AcpNativeReasoningSupport {
  const options = thoughtLevelOption?.options ?? [];
  const seen = new Set<ReasoningLevel>();
  const supportedReasoningEfforts: AvailableModel["supportedReasoningEfforts"] =
    [];
  for (const option of options) {
    const level = acpNativeValueToReasoningLevel(option.value);
    if (level === undefined || seen.has(level)) {
      continue;
    }
    seen.add(level);
    supportedReasoningEfforts.push({
      reasoningEffort: level,
      description: option.name ?? option.value,
    });
  }
  supportedReasoningEfforts.sort(
    (a, b) =>
      reasoningLevelValues.indexOf(a.reasoningEffort) -
      reasoningLevelValues.indexOf(b.reasoningEffort),
  );
  if (supportedReasoningEfforts.length === 0) {
    return {
      supportedReasoningEfforts: ACP_NATIVE_REASONING_EFFORTS,
      defaultReasoningEffort: "medium",
    };
  }
  const currentLevel = acpNativeValueToReasoningLevel(
    thoughtLevelOption?.currentValue,
  );
  const supportedLevels = supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  return {
    supportedReasoningEfforts,
    defaultReasoningEffort:
      currentLevel !== undefined && supportedLevels.includes(currentLevel)
        ? currentLevel
        : supportedReasoningEfforts[0].reasoningEffort,
  };
}

export function buildModelCatalogFromConfigOptions(
  modelOption: AcpConfigOption | undefined,
  reasoningByModel?: ReadonlyMap<string, AcpNativeReasoningSupport>,
): AvailableModel[] {
  const options = modelOption?.options ?? [];
  if (options.length === 0) {
    return [];
  }
  const currentValue = modelOption?.currentValue;
  const models = options.map((option, index): AvailableModel => {
    const isDefault =
      currentValue !== undefined ? option.value === currentValue : index === 0;
    const reasoning = reasoningByModel?.get(option.value) ?? {
      supportedReasoningEfforts: ACP_NATIVE_REASONING_EFFORTS,
      defaultReasoningEffort: "medium" as ReasoningLevel,
    };
    return {
      id: option.value,
      model: option.value,
      displayName: option.name ?? option.value,
      description: "",
      supportedReasoningEfforts: reasoning.supportedReasoningEfforts,
      defaultReasoningEffort: reasoning.defaultReasoningEffort,
      isDefault,
    };
  });
  return models.some((model) => model.isDefault)
    ? models
    : models.map((model, index) =>
        index === 0 ? { ...model, isDefault: true } : model,
      );
}

function splitVariant(id: string): {
  familyKey: string;
  effort: ReasoningLevel;
  effortToken: string | undefined;
  fast: boolean;
  thinking: boolean;
} {
  let rest = id;
  let fast = false;
  if (rest.endsWith(FAST_TAIL)) {
    fast = true;
    rest = rest.slice(0, -FAST_TAIL.length);
  }
  // Cursor marks extended thinking either as a suffix (`…-medium-thinking`,
  // `…-thinking`) or an infix (`…-thinking-medium`). Strip it so the family
  // key matches the non-thinking twin; its presence is what later keeps the
  // variant a real effort instead of collapsing it to "none".
  let thinking = false;
  if (rest.endsWith(`-${THINKING_TOKEN}`)) {
    thinking = true;
    rest = rest.slice(0, -(THINKING_TOKEN.length + 1));
  } else if (rest.includes(`-${THINKING_TOKEN}-`)) {
    thinking = true;
    rest = rest.replace(`-${THINKING_TOKEN}-`, "-");
  }
  for (const [token, effort] of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      return {
        familyKey: rest.slice(0, -(token.length + 1)),
        effort,
        effortToken: token,
        fast,
        thinking,
      };
    }
  }
  // No effort token: the id (minus any `-fast`/`-thinking` markers) is its own
  // family and acts as its medium.
  return {
    familyKey: rest,
    effort: "medium",
    effortToken: undefined,
    fast,
    thinking,
  };
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
  none: "None",
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
 * Claude Code / Codex lists: the "Thinking" marker (now a reasoning level, not
 * a separate entry), the `1M` context tag (every big Cursor model is 1M, so it
 * distinguishes nothing), the `(NO ZDR)` data-retention marker, and Cursor's
 * own `(default)`/`(current)` annotations.
 */
function cleanDisplayName(name: string): string {
  return name
    .replace(/\s*\((?:NO ZDR|default|current)\)/gi, "")
    .replace(/(^|\s)(?:1M|Thinking)(?=\s|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Normal and fast raw ids for one (family, effort) cell. */
interface VariantTier {
  normal?: string;
  fast?: string;
}

/**
 * Group raw variants into model families. The family's bb-facing id is the raw
 * id of its default variant — the non-fast, thinking "medium" when present,
 * else the first non-`none` non-fast variant, else the first listed — so
 * threads persist real agent ids and the picker preselects a real effort, not
 * the bottom "none" rung. Within a family: thinking variants keep their
 * effort, the non-thinking variants collapse onto a single "none" level (a
 * medium-effort representative), and `-fast` ids fold in as each level's fast
 * service tier. Returns null when nothing parsed, so callers can fall back to
 * the synthetic default model.
 */
export function buildAgentModelCatalog(
  rawModels: readonly RawAgentModel[],
): AgentModelCatalog | null {
  const families = new Map<string, AgentModelVariant[]>();
  for (const raw of rawModels) {
    const { familyKey, effort, effortToken, fast, thinking } = splitVariant(
      raw.id,
    );
    const members = families.get(familyKey) ?? [];
    members.push({ ...raw, effort, effortToken, fast, thinking });
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
    // A family with any thinking variant maps its non-thinking variants to the
    // "none" (thinking-off) level; a family with none keeps each variant's own
    // effort (so an explicit `-none` id stays the "none" level).
    const hasThinking = members.some((m) => m.thinking);
    const leveled = members.map((member) => ({
      member,
      level: member.thinking
        ? member.effort
        : hasThinking
          ? ("none" as ReasoningLevel)
          : member.effort,
    }));

    // Resolution table: one normal + one fast id per level. Multiple
    // non-thinking variants collapse onto "none" — keep a medium-effort
    // representative when present, else the first listed.
    const byLevel = new Map<ReasoningLevel, VariantTier>();
    const repEffortByCell = new Map<string, ReasoningLevel>();
    for (const { member, level } of leveled) {
      const slot: keyof VariantTier = member.fast ? "fast" : "normal";
      const tier = byLevel.get(level) ?? {};
      const cellKey = `${level}:${slot}`;
      const upgradesNoneRep =
        level === "none" &&
        member.effort === "medium" &&
        repEffortByCell.get(cellKey) !== "medium";
      if (tier[slot] === undefined || upgradesNoneRep) {
        tier[slot] = member.id;
        repEffortByCell.set(cellKey, member.effort);
        byLevel.set(level, tier);
      }
    }

    // Prefer a thinking "medium" default so the picker preselects a real
    // effort; fall back to the first non-`none`, then to anything listed.
    const nonFast = leveled.filter((entry) => !entry.member.fast);
    const pool = nonFast.length > 0 ? nonFast : leveled;
    const defaultEntry =
      pool.find((entry) => entry.level === "medium") ??
      pool.find((entry) => entry.level !== "none") ??
      pool[0];
    const defaultVariant = defaultEntry.member;

    // The picker's ladder reads none → max regardless of listing order.
    const levelsInLadderOrder = [...byLevel.keys()].sort(
      (a, b) =>
        reasoningLevelValues.indexOf(a) - reasoningLevelValues.indexOf(b),
    );
    // First raw name seen per level, kept as the (non-user-facing) description.
    const nameByLevel = new Map<ReasoningLevel, string>();
    for (const { member, level } of leveled) {
      if (!nameByLevel.has(level)) {
        nameByLevel.set(level, member.displayName);
      }
    }

    models.push({
      id: defaultVariant.id,
      model: defaultVariant.id,
      displayName: familyDisplayName(
        defaultVariant.displayName,
        defaultVariant.effortToken,
      ),
      description: "",
      supportedReasoningEfforts: levelsInLadderOrder.map((level) => ({
        reasoningEffort: level,
        description: nameByLevel.get(level) ?? "",
      })),
      defaultReasoningEffort: defaultEntry.level,
      // The agent lists its default model first.
      isDefault: models.length === 0,
    });
    variantsByFamilyId.set(defaultVariant.id, byLevel);
    defaultEffortByFamilyId.set(defaultVariant.id, defaultEntry.level);
  }

  return {
    models,
    resolveVariant({ model, reasoningLevel, serviceTier }) {
      const byLevel = variantsByFamilyId.get(model);
      if (!byLevel) {
        return undefined;
      }
      const level = reasoningLevel ?? defaultEffortByFamilyId.get(model);
      const tier = level === undefined ? undefined : byLevel.get(level);
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
