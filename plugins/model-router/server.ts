// bb-plugin-model-router — rules-based provider/model routing behind an
// "Auto" entry in bb's provider/model picker.
//
// Two gates (`thread.create` and `turn.submit`) proceed with an amended
// provider, model and reasoning level. There is no `hold` and no `reject` in
// this plugin at all: its job is to choose, and the fallback for "cannot
// choose" is the project default core has already resolved. Holding would
// strand a user who picked Auto behind a provider probe; rejecting would
// refuse work over a settings typo.
//
// Gates are boxed at 10s, run under one server-wide lock and fail the whole
// dispatch on throw, so nothing here queries anything. The provider/model
// catalog is fetched by the background service below and read from memory by
// the gates. The rule itself lives in ./routing.ts and the catalog shape and
// slot parsing in ./catalog.ts; this file is wiring.

import type {
  BbPluginApi,
  PluginDispatchAmendments,
  PluginDispatchCreateAmendments,
} from "@get-bb/plugin-sdk";
import {
  buildProviderModels,
  EMPTY_CATALOG,
  formatModelSlot,
  isCatalogUsable,
  lookupModel,
  type CatalogModel,
  type ModelCatalog,
  type ModelSlot,
} from "./catalog.js";
import {
  DEFAULT_LENGTH_THRESHOLD,
  resolveSettings,
  routeDispatch,
  SETTING_LABELS,
  type ResolvedRouterSettings,
  type RouteAmendments,
  type RouteDecision,
} from "./routing.js";

/**
 * How often the catalog is rebuilt. Model lists come from host probes, so this
 * is the one genuinely expensive thing the plugin does — and a model catalog
 * changes when someone installs a provider CLI, not between two sends.
 */
const CATALOG_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * How long a catalog stays routable without a successful refresh. Comfortably
 * more than several failed refreshes: a host that is briefly unreachable
 * should not silently switch every Auto send back to the project default,
 * because the model list it would have returned has almost certainly not
 * changed.
 */
const CATALOG_TTL_MS = 30 * 60_000;

const PROBE_TIMEOUT_MS = 10_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/**
 * `turn.submit` amendments, rebuilt field by field.
 *
 * `RouteAmendments` carries an optional `providerId` because `thread.create`
 * can use it; routing never produces one when a provider is locked, and this
 * spread makes that structural rather than a promise — a provider amendment on
 * an existing thread fails the dispatch with this plugin named.
 */
function submitAmendments(amend: RouteAmendments): PluginDispatchAmendments {
  return {
    ...(amend.model === undefined ? {} : { model: amend.model }),
    ...(amend.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: amend.reasoningLevel }),
  };
}

export default async function modelRouterPlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    fastModel: {
      type: "string",
      label: SETTING_LABELS.fastModel,
      description:
        'Where short, simple prompts go, as "<provider>/<model>" — for example "codex/gpt-5-codex". Leave empty to send everything to the capable model.',
      default: "",
    },
    capableModel: {
      type: "string",
      label: SETTING_LABELS.capableModel,
      description:
        'Where long prompts and keyword matches go, as "<provider>/<model>". Leave empty to send everything to the fast model.',
      default: "",
    },
    lengthThreshold: {
      type: "string",
      label: SETTING_LABELS.lengthThreshold,
      description: `A prompt at least this many characters long goes to the capable model. Empty means ${DEFAULT_LENGTH_THRESHOLD}.`,
      default: "",
    },
    capableKeywords: {
      type: "string",
      label: SETTING_LABELS.capableKeywords,
      description:
        'Comma-separated words or phrases that force the capable model whatever the prompt length — for example "refactor,architecture,plan". Matched whole-word and case-insensitively, so "plan" does not match "explanation".',
      default: "refactor,architecture,plan",
    },
    routeDefaultedFields: {
      type: "boolean",
      label: SETTING_LABELS.routeDefaultedFields,
      description:
        "Off by default: routing happens only when you pick Auto in the model picker. Turn this on to also route sends whose provider, model or reasoning level came from a default rather than from you — an explicit choice of yours is never overridden either way.",
      default: false,
    },
  });

  let resolved: ResolvedRouterSettings = {
    fast: null,
    capable: null,
    lengthThreshold: DEFAULT_LENGTH_THRESHOLD,
    keywords: [],
    routeDefaultedFields: false,
  };
  let settingProblems: readonly string[] = [];
  let catalog: ModelCatalog = EMPTY_CATALOG;
  let wakeRefresher: (() => void) | null = null;

  /**
   * Report anything that stops routing from working, in one place.
   *
   * Reported rather than thrown, for the reason gates are fail-closed: a
   * factory or gate that threw on a typo would take every dispatch in the
   * server down with this plugin named, which is far worse than Auto quietly
   * falling back to the project default while the user is told what to fix.
   *
   * A slot is only checked against the catalog once a catalog exists —
   * otherwise every boot would accuse a perfectly good setting of naming a
   * missing model.
   */
  function reviewConfiguration(): void {
    const problems = [...settingProblems];
    const slots: readonly [string, ModelSlot | null][] = [
      [SETTING_LABELS.fastModel, resolved.fast],
      [SETTING_LABELS.capableModel, resolved.capable],
    ];
    if (catalog.fetchedAt !== null) {
      for (const [label, slot] of slots) {
        if (slot === null) continue;
        if (lookupModel(catalog, slot) !== null) continue;
        problems.push(
          `${label} names "${formatModelSlot(slot)}", which no available provider offers.`,
        );
      }
    }
    if (problems.length === 0) return;
    bb.status.needsConfiguration(problems.join(" "));
    for (const problem of problems) bb.log.warn(problem);
  }

  async function applySettings(): Promise<void> {
    const result = resolveSettings(await settings.get());
    resolved = result.settings;
    settingProblems = result.problems;
    reviewConfiguration();
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings().then(() => wakeRefresher?.());
  });

  // --- catalog --------------------------------------------------------------

  /**
   * Rebuild the catalog from the available providers and their model lists.
   *
   * Per-provider failures are absorbed: a provider whose probe fails keeps the
   * models it had last time rather than vanishing, so one unreachable host
   * cannot un-route a slot that points at a different provider entirely. A
   * refresh that resolves nothing at all leaves the previous catalog in place
   * — a stale list still routes correctly far more often than no list does,
   * and `CATALOG_TTL_MS` is what eventually stops trusting it.
   */
  async function refreshCatalog(signal: AbortSignal): Promise<void> {
    const providers = await bb.sdk.providers.list({ signal });
    const next = new Map<string, ReadonlyMap<string, CatalogModel>>();

    await Promise.all(
      providers
        .filter((provider) => provider.available)
        .map(async (provider) => {
          const carryForward = (): void => {
            const previous = catalog.providers.get(provider.id);
            if (previous !== undefined) next.set(provider.id, previous);
          };
          try {
            const options = await bb.sdk.providers.models({
              providerId: provider.id,
              signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(PROBE_TIMEOUT_MS),
              ]),
            });
            if (options.modelLoadError !== null) {
              bb.log.debug(
                `provider ${provider.id} could not list models: ${options.modelLoadError.code}`,
              );
              carryForward();
              return;
            }
            const models = buildProviderModels(options.models);
            if (models.size === 0) {
              carryForward();
              return;
            }
            next.set(provider.id, models);
          } catch (error) {
            if (signal.aborted) return;
            bb.log.debug(
              `could not list models for provider ${provider.id}: ${errorMessage(error)}`,
            );
            carryForward();
          }
        }),
    );

    if (signal.aborted) return;
    if (next.size === 0) {
      bb.log.warn(
        "no provider returned a model list; keeping the previous catalog",
      );
      return;
    }
    catalog = { providers: next, fetchedAt: Date.now() };
    reviewConfiguration();
  }

  bb.background.service("catalog", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await refreshCatalog(signal);
        } catch (error) {
          if (signal.aborted) break;
          bb.log.warn(
            `could not refresh the provider/model catalog: ${errorMessage(error)}`,
          );
        }
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          wakeRefresher = resolve;
          void sleep(CATALOG_REFRESH_INTERVAL_MS, signal).then(resolve);
        });
        wakeRefresher = null;
      }
    },
  });

  // --- gates ----------------------------------------------------------------

  function decide(args: {
    stage: "thread.create" | "turn.submit";
    text: string;
    pluginInput: Parameters<typeof routeDispatch>[0]["pluginInput"];
    sources: Parameters<typeof routeDispatch>[0]["sources"];
    currentProviderId: string;
    currentModel: string | null;
    lockedProviderId: string | null;
  }): RouteDecision {
    const decision = routeDispatch({
      ...args,
      settings: resolved,
      catalog,
      catalogIsUsable: isCatalogUsable(catalog, Date.now(), CATALOG_TTL_MS),
    });
    bb.log.debug(
      decision.kind === "skip"
        ? `${args.stage}: not routing — ${decision.reason}`
        : `${args.stage}: routing ${decision.reason}`,
    );
    return decision;
  }

  bb.experimental_dispatch.gate("thread.create", (context) => {
    const decision = decide({
      stage: "thread.create",
      text: context.input.text,
      pluginInput: context.pluginInput,
      sources: {
        providerId: context.executionSources.providerId,
        model: context.executionSources.model,
        reasoningLevel: context.executionSources.reasoningLevel,
      },
      currentProviderId: context.requestedExecution.providerId,
      currentModel: context.requestedExecution.model,
      // A release re-runs this pass against a thread row that already exists
      // and already carries its provider; amending `providerId` there fails
      // the dispatch outright, so the provider is as fixed as it is at submit.
      lockedProviderId: context.isReleaseReevaluation
        ? context.requestedExecution.providerId
        : null,
    });
    if (decision.kind === "skip") return { action: "proceed" };
    const amend: PluginDispatchCreateAmendments = decision.amend;
    return { action: "proceed", amend };
  });

  bb.experimental_dispatch.gate("turn.submit", (context) => {
    const decision = decide({
      stage: "turn.submit",
      text: context.input.text,
      pluginInput: context.pluginInput,
      sources: {
        providerId: context.executionSources.providerId,
        model: context.executionSources.model,
        reasoningLevel: context.executionSources.reasoningLevel,
      },
      currentProviderId: context.requestedExecution.providerId,
      currentModel: context.requestedExecution.model,
      // A thread's provider is written when its row is inserted and never
      // changes, so routing may only pick a model within it.
      lockedProviderId: context.requestedExecution.providerId,
    });
    if (decision.kind === "skip") return { action: "proceed" };
    return { action: "proceed", amend: submitAmendments(decision.amend) };
  });
}
