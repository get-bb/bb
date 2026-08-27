// bb-plugin-model-router — the "Auto" entry in bb's provider/model picker.
//
// Auto routes by ASKING A MODEL. When a dispatch arrives carrying this
// plugin's picker entry, the gate hands bb's helper-inference model the user's
// routing prompt, the request being submitted and the available provider/model
// rows, and takes back `{ providerId, model, reasoningLevel? }` — which it
// applies as a dispatch amendment.
//
// Everything here is arranged around two hard constraints:
//
//   - **A gate is boxed at 10s and is fail-closed**: exceeding the box or
//     throwing fails the whole dispatch with this plugin named. So the
//     completion is given a budget well inside the box, one attempt only, and
//     every failure path returns `proceed` unamended.
//   - **An amendment core cannot honour also fails the dispatch.** So a choice
//     is checked against the catalog before it is sent, the provider is only
//     amended where a provider can still change, and a reasoning level is
//     clamped to what the chosen model advertises.
//
// The fallback for every "cannot choose" is the same and is not an error: bb's
// own resolved provider and model, which is the documented meaning of Auto.
//
// The catalog is fetched by the background service below and read from memory
// by the gates, because a gate must not query anything. The routing decision
// itself lives in ./routing.ts and the catalog shape in ./catalog.ts.

import type {
  BbPluginApi,
  JsonValue,
  PluginDispatchAmendments,
  PluginDispatchCreateAmendments,
} from "@get-bb/plugin-sdk";
import {
  buildProviderModels,
  EMPTY_CATALOG,
  isCatalogUsable,
  type CatalogModel,
  type ModelCatalog,
} from "./catalog.js";
import {
  buildRoutingPrompt,
  readRouteChoice,
  ROUTING_OUTPUT_SCHEMA,
  type RouteOutcome,
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

/**
 * The routing completion's whole budget.
 *
 * Sized against the 10s gate box, not against what a model needs: a gate that
 * overruns its box fails the dispatch, so the margin belongs to bb rather than
 * to the router. `complete()` makes exactly one attempt, so this is also the
 * worst case rather than the first of several.
 */
const ROUTING_TIMEOUT_MS = 7_000;

export const EMPTY_ROUTING_PROMPT =
  "Set a routing prompt so this plugin knows how you want prompts routed.";

export const NO_INFERENCE_SERVICE =
  "Auto cannot pick a model because bb has no helper-inference service configured. " +
  "Set BB_INFERENCE to a model bb can reach, or install a plugin that serves one.";

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

/**
 * The named cause of a rejected completion, when there is one.
 *
 * `complete()` rejects with a host-side class this plugin cannot import, so it
 * is matched by name, exactly as `NeedsConfigurationError` is. A caught value
 * is genuinely unknown, which is what makes narrowing correct here.
 */
export function readCompletionFailure(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "PluginAiCompletionError") {
    return null;
  }
  const failure: unknown = Reflect.get(error, "failure");
  return typeof failure === "string" ? failure : null;
}

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

export default async function modelRouterPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const settings = bb.settings.define({
    routingPrompt: {
      type: "string",
      label: "Routing prompt",
      description:
        "Plain English rules for which model gets which prompt — for example: " +
        '"Use a fast cheap model for quick questions and small edits. Use the most ' +
        'capable model for refactors, architecture and planning." Applied when you ' +
        'pick "Auto" in the model picker.',
      experimental_multiline: true,
      default: "",
    },
  });

  let routingPrompt = "";
  let inferenceEnabled = true;
  let catalog: ModelCatalog = EMPTY_CATALOG;
  let wakeRefresher: (() => void) | null = null;

  /**
   * Report anything that stops routing from working, in one place.
   *
   * Reported rather than thrown, for the same reason gates return `proceed` on
   * every failure: a factory that threw over an unset setting would take the
   * plugin down, when the honest outcome is that Auto quietly uses bb's
   * default while the user is told what to fix.
   */
  function reviewConfiguration(): void {
    const problems: string[] = [];
    if (routingPrompt === "") problems.push(EMPTY_ROUTING_PROMPT);
    if (!inferenceEnabled) problems.push(NO_INFERENCE_SERVICE);
    if (problems.length === 0) return;
    bb.status.needsConfiguration(problems.join(" "));
  }

  async function applySettings(): Promise<void> {
    routingPrompt = (await settings.get()).routingPrompt.trim();
    reviewConfiguration();
  }

  /**
   * Whether bb can answer a completion at all, read from the same system
   * config the settings UI shows. Probed rather than discovered on the first
   * send, so "Auto does nothing" is answerable before anyone tries it.
   */
  async function probeInference(signal: AbortSignal): Promise<void> {
    const config = await bb.sdk.system.config({ signal });
    inferenceEnabled = config.aiServices.inferenceEnabled;
    reviewConfiguration();
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings();
  });

  // --- catalog --------------------------------------------------------------

  /**
   * Rebuild the catalog from the available providers and their model lists.
   *
   * Per-provider failures are absorbed: a provider whose probe fails keeps the
   * models it had last time rather than vanishing, so one unreachable host
   * cannot un-route a request that was headed for a different provider
   * entirely. A refresh that resolves nothing at all leaves the previous
   * catalog in place — a stale list still routes correctly far more often than
   * no list does, and `CATALOG_TTL_MS` is what eventually stops trusting it.
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
  }

  bb.background.service("catalog", {
    async start(signal) {
      while (!signal.aborted) {
        // The inference probe rides the catalog refresh: both answer "can Auto
        // do anything right now", both are cheap, and both change when a host
        // or a setting does rather than between two sends.
        try {
          await probeInference(signal);
        } catch (error) {
          if (!signal.aborted) {
            bb.log.debug(
              `could not read the inference configuration: ${errorMessage(error)}`,
            );
          }
        }
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

  // --- routing --------------------------------------------------------------

  interface DecideArgs {
    stage: "thread.create" | "turn.submit";
    text: string;
    pluginInput: JsonValue | null;
    /** Non-null once the thread's provider can no longer change. */
    lockedProviderId: string | null;
  }

  /**
   * The whole decision: is this an Auto dispatch, and if so where does it go?
   *
   * Returns null for "not ours / nothing to do", which the gates turn into an
   * unamended `proceed`. Every failure is logged at debug and answered the
   * same way — a routing plugin that made sends fail would be worse than no
   * routing plugin.
   */
  async function decide(args: DecideArgs): Promise<RouteOutcome | null> {
    const entry = readAutoEntry(args.pluginInput);
    if (entry === null) return null;

    if (routingPrompt === "") {
      bb.log.debug(`${args.stage}: Auto picked, but no routing prompt is set`);
      return null;
    }
    if (!isCatalogUsable(catalog, Date.now(), CATALOG_TTL_MS)) {
      bb.log.debug(`${args.stage}: Auto picked, but no usable model catalog`);
      return null;
    }

    const prompt = buildRoutingPrompt({
      routingPrompt,
      text: args.text,
      catalog,
      lockedProviderId: args.lockedProviderId,
    });
    if (prompt === null) {
      bb.log.debug(`${args.stage}: nothing to route — no eligible rows or no text`);
      return null;
    }

    let value: Record<string, JsonValue>;
    try {
      value = await bb.experimental_aiServices.complete({
        prompt,
        outputSchema: ROUTING_OUTPUT_SCHEMA,
        timeoutMs: ROUTING_TIMEOUT_MS,
      });
    } catch (error) {
      const failure = readCompletionFailure(error);
      if (failure === "no-service-configured") {
        // The startup probe can be stale — a service can be disabled between
        // refreshes — so a call that proves it is the more current answer.
        inferenceEnabled = false;
        reviewConfiguration();
      }
      bb.log.debug(
        `${args.stage}: routing completion failed (${failure ?? "unknown"}): ${errorMessage(error)}`,
      );
      return null;
    }

    const outcome = readRouteChoice({
      value,
      catalog,
      lockedProviderId: args.lockedProviderId,
    });
    if (outcome.kind === "unroutable") {
      bb.log.debug(`${args.stage}: not routing — ${outcome.reason}`);
      return null;
    }
    bb.log.debug(
      `${args.stage}: routing "${entry}" to ${outcome.providerId}/${outcome.model}` +
        (outcome.reasoningLevel === null
          ? ""
          : ` at ${outcome.reasoningLevel}`),
    );
    return outcome;
  }

  /**
   * The fields any stage may amend. `providerId` is deliberately absent: a
   * thread's provider is fixed when its row is inserted, so only the create
   * gate adds it, and only when this pass is not a hold release.
   */
  function commonAmendments(
    outcome: RouteOutcome & { kind: "route" },
  ): PluginDispatchAmendments {
    return {
      model: outcome.model,
      ...(outcome.reasoningLevel === null
        ? {}
        : { reasoningLevel: outcome.reasoningLevel }),
    };
  }

  bb.experimental_dispatch.gate("thread.create", async (context) => {
    // A release re-runs this pass against a thread row that already exists and
    // already carries its provider; amending `providerId` there fails the
    // dispatch outright, so the provider is as fixed as it is at submit.
    const lockedProviderId = context.isReleaseReevaluation
      ? context.requestedExecution.providerId
      : null;
    const outcome = await decide({
      stage: "thread.create",
      text: context.input.text,
      pluginInput: context.pluginInput,
      lockedProviderId,
    });
    if (outcome === null || outcome.kind !== "route") {
      return { action: "proceed" };
    }
    const amend: PluginDispatchCreateAmendments = {
      ...commonAmendments(outcome),
      ...(lockedProviderId === null ? { providerId: outcome.providerId } : {}),
    };
    return { action: "proceed", amend };
  });

  bb.experimental_dispatch.gate("turn.submit", async (context) => {
    const outcome = await decide({
      stage: "turn.submit",
      text: context.input.text,
      pluginInput: context.pluginInput,
      lockedProviderId: context.requestedExecution.providerId,
    });
    if (outcome === null || outcome.kind !== "route") {
      return { action: "proceed" };
    }
    return { action: "proceed", amend: commonAmendments(outcome) };
  });
}
