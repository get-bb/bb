// bb-plugin-model-router — the "Auto" entry in bb's provider/model picker.
//
// Auto routes by ASKING AN AGENT. When a dispatch arrives carrying this
// plugin's picker entry, the gate does not decide — it returns `wait`
// ("Choosing a model…"), which parks the message as a queued row, and answers
// later. A background flow then spawns a hidden routing thread, hands it the
// user's routing prompt, the request being submitted and the eligible
// provider/model rows, waits for its answer, and clears the wait with that
// answer as a dispatch amendment.
//
// Waiting rather than deciding inline is the whole design, and it follows from
// one constraint: **a gate is boxed at 10s and is fail-closed**. Asking a real
// agent takes longer than that box, so a gate that waited would fail the send.
// A parked row has no such limit — it is the documented way to say "this needs
// real work" — and it costs the user a brief, visible, cancellable pause
// instead of an error.
//
// Two rules shape everything below:
//
//   - **Auto must never strand a parked row.** Every failure — spawn error,
//     timeout, unparseable answer, hallucinated model, a refused amendment —
//     ends in a plain unamended clear, so the send proceeds on bb's own
//     resolved provider and model. That is the documented meaning of Auto, not
//     an error.
//   - **An amendment core cannot honour is refused.** So a choice is checked
//     against the catalog before it is sent, a reasoning level is clamped to
//     what the chosen model advertises, and the provider is only amended where
//     a provider can still change.
//
// The catalog is fetched by the background service below and read from memory,
// because a gate must not query anything. The routing decision itself lives in
// ./routing.ts and the catalog shape in ./catalog.ts.

import type {
  BbPluginApi,
  JsonValue,
  PluginDispatchAmendments,
  PluginThreadEventPayloads,
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
  readFencedJsonObject,
  readRouteChoice,
} from "./routing.js";

type QueueEntry = PluginThreadEventPayloads["queue.parked"]["entry"];

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
 * The whole budget for one routing thread, from spawn to answer.
 *
 * Sized for a real agent rather than a completion: the routing thread has to
 * provision a workspace and take a turn, which is seconds, not milliseconds.
 * Nothing is boxed at 10s here — the gate already let go — so this bounds the
 * user's visible pause rather than the plugin's correctness. Exceeding it is
 * an ordinary failure: the hold releases unamended.
 */
const ROUTING_BUDGET_MS = 90_000;

/** How often the wait polls. */
const ROUTING_POLL_INTERVAL_MS = 500;

/**
 * The reason on the parked row, shown on the user's queued card.
 *
 * No `retryAt` accompanies it: a timer would dispatch the send while this
 * plugin was still deciding, and the answer would arrive to find nothing to
 * amend. This plugin clears its own waits, and the orphan sweep is the backstop
 * if the plugin dies mid-route.
 */
export const ROUTING_WAIT_REASON = "Choosing a model…";

export const EMPTY_ROUTING_PROMPT =
  "Set a routing prompt so this plugin knows how you want prompts routed.";

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

/** The concatenated text of a parked row's text blocks. */
export function readParkedText(entry: QueueEntry): string {
  if (entry.payload.kind !== "inline") return "";
  return entry.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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

  // Typed as the holder template literal rather than a plain string: that is
  // the shape both `hold.holder` and the hold-list filter are declared with.
  const ownHolder: `plugin:${string}` = `plugin:${bb.pluginId}`;
  let routingPrompt = "";
  let catalog: ModelCatalog = EMPTY_CATALOG;
  let wakeRefresher: (() => void) | null = null;

  /**
   * Report anything that stops routing from working, in one place.
   *
   * Reported rather than thrown, for the same reason every failure releases
   * unamended: a factory that threw over an unset setting would take the
   * plugin down, when the honest outcome is that Auto quietly uses bb's
   * default while the user is told what to fix.
   */
  function reviewConfiguration(): void {
    if (routingPrompt !== "") return;
    bb.status.needsConfiguration(EMPTY_ROUTING_PROMPT);
  }

  async function applySettings(): Promise<void> {
    routingPrompt = (await settings.get()).routingPrompt.trim();
    reviewConfiguration();
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings();
    // A new routing prompt should apply to the next send, and a catalog that
    // aged out is the one thing that would silently stop it from being routed
    // at all.
    wakeRefresher?.();
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
      let recovered = false;
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
        if (!recovered) {
          recovered = true;
          // Rows this plugin parked can outlive the process that parked them.
          // Re-driving them happens AFTER the first refresh, not before it:
          // routing needs a catalog to offer, and a recovery that ran against
          // an empty one would clear every recovered wait unamended — turning
          // a restart into "Auto did nothing" for exactly the sends that were
          // waiting on it.
          await recoverOwnParkedRows();
          if (signal.aborted) break;
        }
        await new Promise<void>((resolve) => {
          wakeRefresher = resolve;
          void sleep(CATALOG_REFRESH_INTERVAL_MS, signal).then(resolve);
        });
        wakeRefresher = null;
      }
    },
  });

  // --- gates ----------------------------------------------------------------

  /**
   * Whether this dispatch is one this plugin should route, and nothing more.
   *
   * A gate decides in microseconds here because it decides nothing: the answer
   * is either "not ours, proceed" or "ours, hold". Three of the four refusals
   * are structural rather than judgements:
   *
   * - **Our own spawn.** The routing thread is itself a `thread.create`
   *   dispatch. Routing it would spawn a routing thread to route the routing
   *   thread. `originPluginId` is checked first and unconditionally, before
   *   even looking for an Auto entry, so no future path can reintroduce the
   *   recursion.
   * - **A re-attempt.** Clearing a wait re-runs this gate against the dispatch
   *   we just decided about. Waiting again would re-park what we just let go,
   *   forever. Our answer is already in the amendment, which core applied to
   *   the row before the re-attempt.
   * - **Nothing to route with.** No routing prompt, or no usable catalog: bb's
   *   own resolved provider and model are still correct, and holding a send to
   *   discover that would be a pause for nothing.
   */
  function shouldRoute(context: {
    isReattempt: boolean;
    originPluginId: string | null;
    pluginInput: JsonValue | null;
  }): boolean {
    if (context.originPluginId === bb.pluginId) return false;
    const entry = readAutoEntry(context.pluginInput);
    if (entry === null) return false;
    if (context.isReattempt) return false;
    if (routingPrompt === "") {
      bb.log.debug("Auto picked, but no routing prompt is set");
      return false;
    }
    if (!isCatalogUsable(catalog, Date.now(), CATALOG_TTL_MS)) {
      bb.log.debug("Auto picked, but no usable model catalog");
      return false;
    }
    return true;
  }

  bb.experimental_dispatch.gate("dispatch", (context) => {
    if (
      !shouldRoute({
        // A row that is already parked has been past this gate once. That is
        // the same test the old `isReleaseReevaluation` flag made, now read
        // off the row itself rather than off a flag core had to set.
        isReattempt: context.queuedMessage !== null,
        originPluginId: context.originPluginId,
        pluginInput: context.pluginInput,
      })
    ) {
      return { action: "proceed" };
    }
    // No `retryAt`: this plugin clears its own waits, and a timer that beat it
    // would dispatch the send the routing thread is still deciding about.
    return { action: "wait", reason: ROUTING_WAIT_REASON };
  });

  // --- routing --------------------------------------------------------------

  /**
   * Rows currently being routed, so one row is never routed twice.
   *
   * Both a `queue.parked` event and the startup recovery can name the same row
   * — a restart that lands mid-flight is exactly when both fire — and two
   * flows for one row would spawn two routing threads and race to clear.
   */
  const routing = new Set<string>();

  bb.events.on("queue.parked", ({ entry }) => {
    if (entry.waitingOn?.kind !== "plugin") return;
    if (entry.waitingOn.pluginId !== bb.pluginId) return;
    void routeParkedRow(entry);
  });

  async function recoverOwnParkedRows(): Promise<void> {
    try {
      // Rows this plugin is holding, across every thread — the indexed
      // wait-holder query. A restart between the park and the clear leaves a
      // parked row with nobody deciding about it; re-driving them here is the
      // recovery, and core's orphan sweep is the last-resort backstop.
      const parked = await bb.sdk.threads.queue.list({
        waitHolder: ownHolder,
      });
      for (const entry of parked) {
        void routeParkedRow(entry);
      }
    } catch (error) {
      bb.log.warn(
        `could not list this plugin's parked rows to recover them: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Whether this thread's provider can still change.
   *
   * The invariant core enforces is that a thread's provider is immutable once
   * a PROVIDER SESSION exists — not once its row is inserted. `pending` is
   * exactly that state, and it is a status on the thread rather than something
   * to infer: this used to read the event log for a `client/turn/requested`
   * row, because `idle` meant both "before the first turn" and "between two of
   * them" and only the log could tell them apart. It no longer does.
   *
   * A fork is excluded by core, which refuses the amendment rather than
   * applying it, so the worst case there is one wasted round trip.
   */
  function providerIsAmendable(thread: { status: string }): boolean {
    return thread.status === "pending";
  }

  /**
   * Spawn a hidden routing thread, read its answer, and clean it up.
   *
   * The thread is hidden because it is machinery: it is not the user's work
   * and it should not appear in the sidebar, in attention surfaces, or in a
   * thread count. It runs on the project's defaults (no provider or model is
   * passed) — asking a specific model which model to use would just move the
   * choice — and reuses the target thread's environment when there is one, so
   * routing a follow-up turn costs no workspace of its own.
   */
  async function askRoutingAgent(args: {
    environmentId: string | null;
    projectId: string;
    prompt: string;
  }): Promise<string | null> {
    const spawned = await bb.sdk.threads.spawn({
      projectId: args.projectId,
      title: "Model routing",
      visibility: "hidden",
      environment:
        args.environmentId === null
          ? { type: "project-default" }
          : { type: "reuse", environmentId: args.environmentId },
      prompt: args.prompt,
    });
    try {
      await bb.sdk.threads.wait({
        threadId: spawned.id,
        status: "idle",
        timeoutMs: ROUTING_BUDGET_MS,
        pollIntervalMs: ROUTING_POLL_INTERVAL_MS,
      });
      const { output } = await bb.sdk.threads.output({ threadId: spawned.id });
      return output;
    } finally {
      await discardRoutingThread(spawned.id);
    }
  }

  /**
   * Get rid of a routing thread whatever state it is in.
   *
   * Deleted rather than archived: an archived thread is one a person might
   * want back, and nobody wants a routing thread back. `stop` comes first
   * because the thread may still be running (the timeout path is exactly
   * that), and both calls are best-effort — a routing thread that outlives its
   * route is untidy, never incorrect, and must not cost the user's send.
   */
  async function discardRoutingThread(threadId: string): Promise<void> {
    try {
      await bb.sdk.threads.stop({ threadId });
    } catch (error) {
      bb.log.debug(
        `could not stop routing thread ${threadId}: ${errorMessage(error)}`,
      );
    }
    try {
      await bb.sdk.threads.delete({ threadId, childThreadsConfirmed: true });
    } catch (error) {
      bb.log.debug(
        `could not delete routing thread ${threadId}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Decide about one held dispatch, then let it go.
   *
   * The amendment is the only thing that varies: EVERY path ends in a release,
   * and a release with no amendment is the correct, documented Auto fallback
   * rather than a failure state. That is why the decision is wrapped and the
   * release is not — a throw anywhere in the decision degrades to "proceed on
   * bb's defaults", and the user's message is never left parked.
   */
  async function routeParkedRow(entry: QueueEntry): Promise<void> {
    if (routing.has(entry.id)) return;
    routing.add(entry.id);
    try {
      const amend = await decideAmendment(entry);
      await clearWaitWithFallback(entry.id, amend);
    } catch (error) {
      bb.log.warn(
        `could not clear the wait on ${entry.id} after routing: ${errorMessage(error)}`,
      );
    } finally {
      routing.delete(entry.id);
    }
  }

  /** The amendment for a parked dispatch, or undefined to proceed unamended. */
  async function decideAmendment(
    entry: QueueEntry,
  ): Promise<PluginDispatchAmendments | undefined> {
    try {
      if (entry.payload.kind !== "inline") {
        // A retry row references an earlier turn instead of carrying one, so
        // there is nothing to route and nothing to amend.
        return undefined;
      }
      const thread = await bb.sdk.threads.get({ threadId: entry.threadId });
      const amendable = providerIsAmendable(thread);
      const lockedProviderId = amendable ? null : thread.providerId;
      const prompt = buildRoutingPrompt({
        routingPrompt,
        text: readParkedText(entry),
        catalog,
        lockedProviderId,
      });
      if (prompt === null) {
        bb.log.debug(
          `${entry.id}: nothing to route — no eligible rows or no text`,
        );
        return undefined;
      }

      const output = await askRoutingAgent({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        prompt,
      });
      const value = readFencedJsonObject(output);
      if (value === null) {
        bb.log.debug(`${entry.id}: the routing agent answered no JSON object`);
        return undefined;
      }
      const outcome = readRouteChoice({ value, catalog, lockedProviderId });
      if (outcome.kind === "unroutable") {
        bb.log.debug(`${entry.id}: not routing — ${outcome.reason}`);
        return undefined;
      }
      bb.log.debug(
        `${entry.id}: routing to ${outcome.providerId}/${outcome.model}` +
          (outcome.reasoningLevel === null
            ? ""
            : ` at ${outcome.reasoningLevel}`),
      );
      return {
        model: outcome.model,
        ...(outcome.reasoningLevel === null
          ? {}
          : { reasoningLevel: outcome.reasoningLevel }),
        // Sent only when it actually changes something. A provider amendment
        // makes core re-validate the model against that provider's catalog and
        // rewrite the thread row; asking for the provider the thread already
        // has would pay for both to change nothing.
        ...(amendable && outcome.providerId !== thread.providerId
          ? { providerId: outcome.providerId }
          : {}),
      };
    } catch (error) {
      bb.log.debug(`${entry.id}: routing failed: ${errorMessage(error)}`);
      return undefined;
    }
  }

  /**
   * Clear the wait, and if the amendment is refused, clear it without one.
   *
   * Core refuses a `providerId` amendment BEFORE it clears anything — on a
   * thread that has started, on a fork — so a refusal leaves the row parked
   * and this second attempt is always available. Retrying unamended rather
   * than retrying with a trimmed amendment is deliberate: the model that came
   * back with the provider belongs to that provider, so half the answer is not
   * a better answer, it is an invalid one.
   */
  async function clearWaitWithFallback(
    queuedMessageId: string,
    amend: PluginDispatchAmendments | undefined,
  ): Promise<void> {
    try {
      await bb.experimental_dispatch.clearWait(
        queuedMessageId,
        amend === undefined ? undefined : { amend },
      );
      return;
    } catch (error) {
      if (amend === undefined) throw error;
      bb.log.debug(
        `${queuedMessageId}: amended clear refused, proceeding unamended: ${errorMessage(error)}`,
      );
    }
    await bb.experimental_dispatch.clearWait(queuedMessageId);
  }
}
