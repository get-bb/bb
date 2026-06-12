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

function splitVariant(id: string): { familyKey: string; effort: ReasoningLevel } {
  let rest = id;
  let fast = false;
  if (rest.endsWith(FAST_TAIL)) {
    fast = true;
    rest = rest.slice(0, -FAST_TAIL.length);
  }
  for (const [token, effort] of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      const base = rest.slice(0, -(token.length + 1));
      return { familyKey: base + (fast ? FAST_TAIL : ""), effort };
    }
  }
  // No effort token: the id is its own family and acts as its medium.
  return { familyKey: id, effort: "medium" };
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
  for (const raw of rawModels) {
    const { familyKey, effort } = splitVariant(raw.id);
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
    models.push({
      id: defaultVariant.id,
      model: defaultVariant.id,
      displayName: defaultVariant.displayName,
      description: "",
      supportedReasoningEfforts: members.map((member) => ({
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
