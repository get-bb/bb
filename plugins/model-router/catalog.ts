// The provider/model catalog, and the `<providerId>/<model>` strings the
// settings use to name a slot in it.
//
// A gate is boxed at 10s, runs under one server-wide lock, and fails the whole
// dispatch if it throws — so it must not query anything. The catalog is
// therefore fetched by a background service and read from memory here. Every
// function in this file is pure: it takes an already-built catalog.

import type { BbPluginApi, PluginDispatchExecution } from "@get-bb/plugin-sdk";

/**
 * The SDK exports neither the reasoning-level union nor the model DTO by name.
 * Deriving them from the surfaces a plugin is actually handed keeps them
 * pinned to exactly what the gate and the SDK call produce.
 */
export type ReasoningLevel = NonNullable<
  PluginDispatchExecution["reasoningLevel"]
>;

type ExecutionOptions = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>;
export type AvailableModel = ExecutionOptions["models"][number];

/**
 * The reasoning ladder, lowest effort to highest. Repeated here because a
 * plugin may only depend on `@get-bb/plugin-sdk`, which exports the union but
 * not its order; the `satisfies` clause makes an added or renamed level a
 * compile error rather than a silently mis-ranked list.
 */
export const REASONING_LADDER = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const satisfies readonly ReasoningLevel[];

/** One model, reduced to what routing needs. */
export interface CatalogModel {
  /** The value that goes on the wire as the execution `model`. */
  model: string;
  displayName: string;
  /** Levels this model actually offers, in ladder order. */
  supportedReasoningLevels: readonly ReasoningLevel[];
}

/** Every available provider and its models, as of `fetchedAt`. */
export interface ModelCatalog {
  /** providerId → model string → model. */
  providers: ReadonlyMap<string, ReadonlyMap<string, CatalogModel>>;
  /** Epoch ms of the fetch, or null when nothing has been fetched yet. */
  fetchedAt: number | null;
}

export const EMPTY_CATALOG: ModelCatalog = {
  providers: new Map(),
  fetchedAt: null,
};

/**
 * Whether the catalog may be routed from.
 *
 * An empty or stale catalog is not an error to report — the plugin simply has
 * nothing to route with, and the correct answer is to proceed unamended so the
 * request falls back to the project defaults core already resolved. Holding or
 * rejecting would turn a transient probe failure into a user-visible outage
 * for a feature whose whole promise is that it stays out of the way.
 */
export function isCatalogUsable(
  catalog: ModelCatalog,
  now: number,
  ttlMs: number,
): boolean {
  if (catalog.fetchedAt === null) return false;
  if (catalog.providers.size === 0) return false;
  return now - catalog.fetchedAt <= ttlMs;
}

/** One place in the catalog: the pair an amendment ultimately names. */
export interface ModelSlot {
  providerId: string;
  model: string;
}

export function formatModelSlot(slot: ModelSlot): string {
  return `${slot.providerId}/${slot.model}`;
}

/**
 * The catalog as lines for the routing prompt: one per model, with the
 * reasoning levels it actually offers.
 *
 * `scopeToProviderId` is not a filter for tidiness — it is the whole reason a
 * submit-stage route is safe. A thread's provider is immutable once a provider
 * session exists, so for any thread that has taken a turn the only models that
 * can legally be chosen are its own provider's. Showing the model a larger menu
 * than it may order from would make every out-of-provider answer a discarded
 * round trip; scoping the menu makes the constraint the model's problem rather
 * than the validator's.
 *
 * Returns an empty string when there is nothing to offer, which callers read
 * as "do not route".
 */
export function describeCatalog(
  catalog: ModelCatalog,
  scopeToProviderId: string | null,
): string {
  const lines: string[] = [];
  for (const [providerId, models] of catalog.providers) {
    if (scopeToProviderId !== null && providerId !== scopeToProviderId) {
      continue;
    }
    for (const model of models.values()) {
      const levels =
        model.supportedReasoningLevels.length === 0
          ? "no reasoning levels"
          : `reasoning levels: ${model.supportedReasoningLevels.join(", ")}`;
      lines.push(
        `- providerId "${providerId}", model "${model.model}" (${model.displayName}; ${levels})`,
      );
    }
  }
  return lines.join("\n");
}

/** The catalog entry a slot names, or null when the catalog does not have it. */
export function lookupModel(
  catalog: ModelCatalog,
  slot: ModelSlot,
): CatalogModel | null {
  return catalog.providers.get(slot.providerId)?.get(slot.model) ?? null;
}

/**
 * The level to actually request, given the one routing asked for.
 *
 * Models advertise different slices of the ladder, and an amendment core
 * cannot honour fails the dispatch with this plugin named — so an unsupported
 * level is never sent through. When the exact level is missing the nearest
 * supported one wins; an equidistant tie goes to the lower level, because
 * spending more effort than was asked for is the more expensive way to be
 * wrong and the prompt is listed the real ladder anyway.
 *
 * Returns null when the model advertises nothing, which means "leave core's
 * answer alone".
 */
export function nearestSupportedReasoningLevel(
  supported: readonly ReasoningLevel[],
  desired: ReasoningLevel,
): ReasoningLevel | null {
  if (supported.length === 0) return null;
  if (supported.includes(desired)) return desired;

  const desiredRank = REASONING_LADDER.indexOf(desired);
  let best: ReasoningLevel | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of supported) {
    const rank = REASONING_LADDER.indexOf(level);
    if (rank === -1) continue;
    const distance = Math.abs(rank - desiredRank);
    if (distance > bestDistance) continue;
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
      continue;
    }
    const bestRank = best === null ? -1 : REASONING_LADDER.indexOf(best);
    if (rank < bestRank) best = level;
  }
  return best;
}

/**
 * Fold one provider's model list into catalog entries.
 *
 * `selectedOnlyModels` (retired models still selectable because someone has
 * one stored) are deliberately excluded: routing picks a model on the user's
 * behalf, and picking a deprecated one is never the right automatic answer.
 */
export function buildProviderModels(
  models: readonly AvailableModel[],
): Map<string, CatalogModel> {
  const entries = new Map<string, CatalogModel>();
  for (const model of models) {
    entries.set(model.model, {
      model: model.model,
      displayName: model.displayName,
      supportedReasoningLevels: model.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    });
  }
  return entries;
}
