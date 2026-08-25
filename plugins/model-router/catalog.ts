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

/** A slot setting, parsed. */
export interface ModelSlot {
  providerId: string;
  model: string;
}

export type ParsedSlot =
  | { kind: "unset" }
  | { kind: "slot"; slot: ModelSlot }
  | { kind: "invalid"; message: string };

export function formatModelSlot(slot: ModelSlot): string {
  return `${slot.providerId}/${slot.model}`;
}

/**
 * Parse `<providerId>/<model>`.
 *
 * Split on the FIRST slash, never the last: provider ids never contain one,
 * but model ids routinely do (`openai/gpt-5` under an aggregating provider),
 * so `codex/openai/gpt-5` has to mean provider `codex`, model `openai/gpt-5`.
 *
 * An unparseable value is reported rather than guessed at. Settings are plain
 * descriptors with no numeric or catalog-backed type, so the string a user
 * typed is the only thing this plugin has; inventing a provider from half of
 * it would route work somewhere nobody asked for.
 */
export function parseModelSlot(raw: string, label: string): ParsedSlot {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "unset" };

  const invalid = (detail: string): ParsedSlot => ({
    kind: "invalid",
    message: `${label} must look like "<provider>/<model>" (for example "codex/gpt-5-codex"), or be empty. ${detail}`,
  });

  const separator = trimmed.indexOf("/");
  if (separator === -1) return invalid(`Got "${raw}", which has no "/".`);

  const providerId = trimmed.slice(0, separator).trim();
  const model = trimmed.slice(separator + 1).trim();
  if (providerId === "") return invalid(`Got "${raw}", which names no provider.`);
  if (model === "") return invalid(`Got "${raw}", which names no model.`);
  if (/\s/u.test(providerId)) {
    return invalid(`Got "${raw}", whose provider contains whitespace.`);
  }

  return { kind: "slot", slot: { providerId, model } };
}

/** The catalog entry a slot names, or null when the catalog does not have it. */
export function lookupModel(
  catalog: ModelCatalog,
  slot: ModelSlot,
): CatalogModel | null {
  return catalog.providers.get(slot.providerId)?.get(slot.model) ?? null;
}

/**
 * The level to actually request, given the one routing wants.
 *
 * Models advertise different slices of the ladder, and an amendment core
 * cannot honour fails the dispatch with this plugin named — so an unsupported
 * level is never sent through. When the exact level is missing the nearest
 * supported one wins, with ties broken in the direction routing was reaching:
 * a "capable" route that cannot have `high` should land on more effort than
 * less, and a "fast" route on less.
 *
 * Returns null when the model advertises nothing, which means "leave core's
 * answer alone".
 */
export function nearestSupportedReasoningLevel(
  supported: readonly ReasoningLevel[],
  desired: ReasoningLevel,
  prefer: "lower" | "higher",
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
    // Equidistant: take the side routing was reaching for.
    const bestRank = best === null ? -1 : REASONING_LADDER.indexOf(best);
    const takeThis = prefer === "higher" ? rank > bestRank : rank < bestRank;
    if (takeThis) best = level;
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
