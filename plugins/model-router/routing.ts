// The routing rule, and the settings it reads.
//
// Everything here is a pure function over values the gate already has in
// memory. That is not a style preference: gates decide in milliseconds under a
// server-wide lock and fail the dispatch if they throw, so the decision has to
// be arithmetic over a snapshot, and the snapshot has to be testable without a
// server.
//
// The rule, in full:
//
// | condition (checked in this order)         | tier    | reasoning |
// |-------------------------------------------|---------|-----------|
// | prompt contains a configured keyword       | capable | high      |
// | prompt length >= the length threshold      | capable | high      |
// | otherwise                                  | fast    | low       |
//
// The tier picks a slot; if that slot is unset, invalid, missing from the
// catalog, or on the wrong provider for a thread whose provider is already
// fixed, the other slot is used instead. The reasoning level follows the
// TIER, not the slot that ended up being used — a prompt that looked hard is
// still hard when it has to run on the fast model.

import {
  formatModelSlot,
  lookupModel,
  nearestSupportedReasoningLevel,
  parseModelSlot,
  type CatalogModel,
  type ModelCatalog,
  type ModelSlot,
  type ReasoningLevel,
} from "./catalog.js";
import type { JsonValue } from "@get-bb/plugin-sdk";

/** The two slots this plugin routes between. */
export type Tier = "fast" | "capable";

export const REASONING_FOR_TIER: Record<Tier, ReasoningLevel> = {
  fast: "low",
  capable: "high",
};

/**
 * How long a prompt has to be before length alone promotes it, when the user
 * sets no threshold. Chosen as "longer than a sentence or two of instruction":
 * short asks are the ones a fast model handles well, and a prompt carrying a
 * pasted stack trace or a spec is the one worth paying for.
 */
export const DEFAULT_LENGTH_THRESHOLD = 600;

/** Above this the threshold is certainly a typo rather than an intent. */
const MAX_LENGTH_THRESHOLD = 1_000_000;

/** The labels users see, reused verbatim in validation messages. */
export const SETTING_LABELS = {
  fastModel: "Fast model",
  capableModel: "Capable model",
  lengthThreshold: "Long prompt threshold",
  capableKeywords: "Capable-model keywords",
  routeDefaultedFields: "Route defaulted fields",
} as const;

/** Settings exactly as the descriptors deliver them. */
export interface RawRouterSettings {
  fastModel: string;
  capableModel: string;
  lengthThreshold: string;
  capableKeywords: string;
  routeDefaultedFields: boolean;
}

export interface ResolvedRouterSettings {
  fast: ModelSlot | null;
  capable: ModelSlot | null;
  lengthThreshold: number;
  /** Lowercased, de-duplicated, in the order the user wrote them. */
  keywords: readonly string[];
  routeDefaultedFields: boolean;
}

export interface ResolveSettingsResult {
  settings: ResolvedRouterSettings;
  /** One message per unusable setting, for `status.needsConfiguration`. */
  problems: string[];
}

const WHOLE_NUMBER = /^\d+$/u;

export function parseLengthThreshold(
  raw: string,
): { kind: "ok"; value: number } | { kind: "invalid"; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "ok", value: DEFAULT_LENGTH_THRESHOLD };
  const invalid = (detail: string) => ({
    kind: "invalid" as const,
    message: `${SETTING_LABELS.lengthThreshold} must be a whole number of characters (for example ${DEFAULT_LENGTH_THRESHOLD}), or empty for the ${DEFAULT_LENGTH_THRESHOLD} default. ${detail}`,
  });
  if (!WHOLE_NUMBER.test(trimmed)) return invalid(`Got "${raw}".`);
  const value = Number(trimmed);
  // 0 would promote every prompt, which is expressible by leaving the fast
  // slot empty and is far more likely to be a stray keystroke here.
  if (value < 1) return invalid(`Got "${raw}"; use 1 or more.`);
  if (value > MAX_LENGTH_THRESHOLD) {
    return invalid(`Got "${raw}"; use ${MAX_LENGTH_THRESHOLD} or fewer.`);
  }
  return { kind: "ok", value };
}

/** Split the comma-separated keyword list. Case is irrelevant to matching. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(",")) {
    const keyword = part.trim().toLowerCase();
    if (keyword === "" || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
}

export function resolveSettings(
  raw: RawRouterSettings,
): ResolveSettingsResult {
  const problems: string[] = [];

  const takeSlot = (value: string, label: string): ModelSlot | null => {
    const parsed = parseModelSlot(value, label);
    if (parsed.kind === "invalid") {
      problems.push(parsed.message);
      return null;
    }
    return parsed.kind === "slot" ? parsed.slot : null;
  };

  const fast = takeSlot(raw.fastModel, SETTING_LABELS.fastModel);
  const capable = takeSlot(raw.capableModel, SETTING_LABELS.capableModel);
  if (fast === null && capable === null) {
    problems.push(
      `Set ${SETTING_LABELS.fastModel} or ${SETTING_LABELS.capableModel} to a "<provider>/<model>" value; until one is set, Auto falls back to the project default.`,
    );
  }

  const threshold = parseLengthThreshold(raw.lengthThreshold);
  if (threshold.kind === "invalid") problems.push(threshold.message);

  return {
    settings: {
      fast,
      capable,
      lengthThreshold:
        threshold.kind === "ok" ? threshold.value : DEFAULT_LENGTH_THRESHOLD,
      keywords: parseKeywords(raw.capableKeywords),
      routeDefaultedFields: raw.routeDefaultedFields,
    },
    problems,
  };
}

// --- trigger ----------------------------------------------------------------

/**
 * The picker entry's `pluginInput` payload, by the convention the CLI already
 * ships (`--provider auto:<pluginId>[:<entryId>]` sends `{ entry }`). Reading
 * the same shape from both means a CLI selection and a picker selection are
 * indistinguishable here, which is the point of the convention.
 *
 * Anything else — including a bare string, or an object without `entry` — is
 * not an Auto selection. `pluginInput` is freeform JSON from a request body,
 * so this is the one place narrowing from `JsonValue` is correct.
 */
export function readAutoEntry(pluginInput: JsonValue | null): string | null {
  if (pluginInput === null || typeof pluginInput !== "object") return null;
  if (Array.isArray(pluginInput)) return null;
  const entry = pluginInput.entry;
  if (typeof entry !== "string" || entry.trim() === "") return null;
  return entry;
}

/** Where an execution field's value came from, as the gate context reports it. */
export type FieldSource = "explicit" | "client-preference" | "plugin" | null;

export interface RouteSources {
  providerId: FieldSource;
  model: FieldSource;
  reasoningLevel: FieldSource;
}

export type Trigger =
  | { kind: "auto"; entry: string }
  | { kind: "defaulted" }
  | { kind: "off"; reason: string };

export function resolveTrigger(args: {
  pluginInput: JsonValue | null;
  routeDefaultedFields: boolean;
}): Trigger {
  const entry = readAutoEntry(args.pluginInput);
  if (entry !== null) return { kind: "auto", entry };
  if (args.routeDefaultedFields) return { kind: "defaulted" };
  return {
    kind: "off",
    reason: 'the request did not select this plugin\'s "Auto" entry',
  };
}

export type Stage = "thread.create" | "turn.submit";

/** Which fields this pass is allowed to touch. */
export interface AmendPermission {
  /** May choose the provider and model. */
  execution: boolean;
  reasoningLevel: boolean;
}

/**
 * Auto owns the decision outright — the user picked "let the plugin choose",
 * so there is no choice of theirs left to protect.
 *
 * "Route defaulted fields" is the opposite posture: it routes requests the
 * user never expressed an opinion about, and must leave any field they did
 * choose exactly as they chose it. At `thread.create` an explicit provider
 * blocks the model too, because moving the model without the provider (or the
 * provider away from the one they picked) is the same override either way. At
 * `turn.submit` the provider is fixed by the thread and never amended, so an
 * explicit provider does not block routing the model inside it.
 */
export function amendPermission(args: {
  trigger: Trigger;
  stage: Stage;
  sources: RouteSources;
}): AmendPermission {
  if (args.trigger.kind === "off") {
    return { execution: false, reasoningLevel: false };
  }
  if (args.trigger.kind === "auto") {
    return { execution: true, reasoningLevel: true };
  }
  const modelIsFree = args.sources.model !== "explicit";
  const providerIsFree = args.sources.providerId !== "explicit";
  return {
    execution:
      args.stage === "thread.create"
        ? modelIsFree && providerIsFree
        : modelIsFree,
    reasoningLevel: args.sources.reasoningLevel !== "explicit",
  };
}

// --- classification ---------------------------------------------------------

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

/**
 * Whether `text` contains `keyword` as a whole word (or whole phrase).
 *
 * Substring matching would fire "plan" on "explanation" and "airplane", which
 * is exactly the kind of silent mis-route that makes an automatic router
 * untrustworthy. Boundaries are checked on the characters either side rather
 * than with `\b` so that multi-word keywords ("code review") work unchanged.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword === "") return false;
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    from = at + 1;
  }
}

export type Classification =
  | { tier: "capable"; because: "keyword"; keyword: string }
  | { tier: "capable"; because: "length"; length: number }
  | { tier: "fast"; because: "short" };

/** Keyword first, then length. See the table at the top of this file. */
export function classifyPrompt(args: {
  text: string;
  settings: ResolvedRouterSettings;
}): Classification {
  for (const keyword of args.settings.keywords) {
    if (matchesKeyword(args.text, keyword)) {
      return { tier: "capable", because: "keyword", keyword };
    }
  }
  const length = args.text.trim().length;
  if (length >= args.settings.lengthThreshold) {
    return { tier: "capable", because: "length", length };
  }
  return { tier: "fast", because: "short" };
}

export function describeClassification(classification: Classification): string {
  switch (classification.because) {
    case "keyword":
      return `the prompt mentions "${classification.keyword}"`;
    case "length":
      return `the prompt is ${classification.length} characters`;
    case "short":
      return "the prompt is short and mentions no capable-model keyword";
  }
}

// --- the decision -----------------------------------------------------------

export interface RouteRequest {
  stage: Stage;
  /** The prompt's concatenated text, as the gate context supplies it. */
  text: string;
  pluginInput: JsonValue | null;
  sources: RouteSources;
  /** The provider core resolved for this dispatch. */
  currentProviderId: string;
  /** The model core resolved, or null when it has not resolved one. */
  currentModel: string | null;
  /**
   * The provider this dispatch is stuck with: the thread's own at
   * `turn.submit`, and at `thread.create` when a hold is being released (the
   * row already carries a provider, and amending it there fails the dispatch).
   * Null means the provider is still open.
   */
  lockedProviderId: string | null;
  settings: ResolvedRouterSettings;
  catalog: ModelCatalog;
  /** `isCatalogUsable`, evaluated by the caller against its own clock. */
  catalogIsUsable: boolean;
}

export interface RouteAmendments {
  providerId?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}

export type RouteDecision =
  | { kind: "skip"; reason: string }
  | {
      kind: "route";
      tier: Tier;
      amend: RouteAmendments;
      /** One line for the debug log; never user-facing. */
      reason: string;
    };

function slotFor(
  settings: ResolvedRouterSettings,
  tier: Tier,
): ModelSlot | null {
  return tier === "capable" ? settings.capable : settings.fast;
}

function usableSlot(args: {
  slot: ModelSlot | null;
  catalog: ModelCatalog;
  lockedProviderId: string | null;
}): { slot: ModelSlot; model: CatalogModel } | null {
  if (args.slot === null) return null;
  if (
    args.lockedProviderId !== null &&
    args.slot.providerId !== args.lockedProviderId
  ) {
    return null;
  }
  const model = lookupModel(args.catalog, args.slot);
  return model === null ? null : { slot: args.slot, model };
}

/**
 * The whole routing decision.
 *
 * Every unroutable situation resolves to `skip`, which the caller turns into
 * an unamended `proceed`. There is deliberately no failure path: this plugin
 * chooses a model, and the fallback for "cannot choose" is the project default
 * core already resolved. A hold would strand a user who picked Auto behind a
 * provider probe, and a reject would refuse work over a settings typo.
 */
export function routeDispatch(request: RouteRequest): RouteDecision {
  const trigger = resolveTrigger({
    pluginInput: request.pluginInput,
    routeDefaultedFields: request.settings.routeDefaultedFields,
  });
  if (trigger.kind === "off") return { kind: "skip", reason: trigger.reason };

  const permission = amendPermission({
    trigger,
    stage: request.stage,
    sources: request.sources,
  });
  if (!permission.execution && !permission.reasoningLevel) {
    return { kind: "skip", reason: "every routable field was chosen explicitly" };
  }

  if (!request.catalogIsUsable) {
    return {
      kind: "skip",
      reason: "the provider/model catalog has not loaded yet",
    };
  }

  const classification = classifyPrompt({
    text: request.text,
    settings: request.settings,
  });
  const { tier } = classification;

  const amend: RouteAmendments = {};
  let effectiveProviderId = request.currentProviderId;
  let effectiveModel = request.currentModel;

  if (permission.execution) {
    // Preferred tier first, then the other slot. This is the "sensible
    // fallback when only one slot is configured" case, and also what covers a
    // slot whose provider is not the one a fixed thread runs on.
    const chosen =
      usableSlot({
        slot: slotFor(request.settings, tier),
        catalog: request.catalog,
        lockedProviderId: request.lockedProviderId,
      }) ??
      usableSlot({
        slot: slotFor(request.settings, tier === "capable" ? "fast" : "capable"),
        catalog: request.catalog,
        lockedProviderId: request.lockedProviderId,
      });

    if (chosen !== null) {
      // Only at `thread.create` with an open provider. Everywhere else the
      // provider is immutable and amending it fails the dispatch outright.
      if (request.lockedProviderId === null) {
        amend.providerId = chosen.slot.providerId;
      }
      amend.model = chosen.slot.model;
      effectiveProviderId = chosen.slot.providerId;
      effectiveModel = chosen.slot.model;
    }
  }

  if (permission.reasoningLevel && effectiveModel !== null) {
    // Clamp against the model that will actually run, which is the routed one
    // only when the execution amendment was allowed and found a slot.
    const target = lookupModel(request.catalog, {
      providerId: effectiveProviderId,
      model: effectiveModel,
    });
    if (target !== null) {
      const level = nearestSupportedReasoningLevel(
        target.supportedReasoningLevels,
        REASONING_FOR_TIER[tier],
        tier === "capable" ? "higher" : "lower",
      );
      if (level !== null) amend.reasoningLevel = level;
    }
  }

  if (amend.model === undefined && amend.reasoningLevel === undefined) {
    return {
      kind: "skip",
      reason:
        request.lockedProviderId === null
          ? "no configured model slot is in the catalog"
          : `no configured model slot belongs to provider "${request.lockedProviderId}"`,
    };
  }

  const target =
    amend.model === undefined
      ? "core's model"
      : formatModelSlot({
          providerId: effectiveProviderId,
          model: amend.model,
        });
  return {
    kind: "route",
    tier,
    amend,
    reason: `${tier} → ${target}${
      amend.reasoningLevel === undefined ? "" : ` (${amend.reasoningLevel})`
    } because ${describeClassification(classification)}`,
  };
}
