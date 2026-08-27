// bb-plugin-concurrency-limit — admission control for thread dispatches.
//
// Two gates (`thread.create` and `turn.submit`) hold a dispatch when the pool
// it would join is full, and a background reconciler releases the oldest hold
// whenever a slot frees. Everything the gate needs is in memory before it
// runs: gates are boxed at 10s, fail closed on throw, and run under one
// server-wide lock, so a gate that awaited a query would stall every dispatch
// in the server and a gate that threw would block its stage entirely.
//
// The bookkeeping this implies — a tally seeded from `threads.count`,
// maintained by lifecycle events, with the plugin's own in-flight `proceed`s
// counted until their rows land — lives in ./tally.ts. Hold attribution lives
// in ./holds.ts, settings parsing in ./limits.ts. This file is wiring.

import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { HoldRegistry, type HeldRecord } from "./holds.js";
import {
  isFullyUnlimited,
  resolveLimits,
  SETTING_LABELS,
  type ResolvedLimits,
} from "./limits.js";
import { evaluateDispatch, isExemptDispatch, scopeKeysFor } from "./scope.js";
import { OccupancyTally, type SeedCounts } from "./tally.js";

// The SDK exports neither DTO by name — the event payload map is where a
// plugin meets them, so that is where these are taken from. Deriving keeps
// them pinned to exactly what a handler is handed.
type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type DispatchHoldResponse = PluginThreadEventPayloads["dispatch.held"]["hold"];

/**
 * The `parentThreadId` sentinel that counts root threads only. It is a
 * server-contract constant a plugin cannot import (plugins may only depend on
 * `@get-bb/plugin-sdk`), so it is repeated here with its meaning stated.
 */
const ROOT_PARENT_SENTINEL = "none";

/**
 * How often the tally is rebuilt from the database and holds are reconciled.
 *
 * The event stream keeps the tally accurate between passes; this pass is what
 * makes a *missed* event self-correcting instead of permanent. A minute is
 * short enough that drift never lasts long and long enough that two grouped
 * `count(*)` queries are free.
 */
const RECONCILE_INTERVAL_MS = 60_000;

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

function toHeldRecord(hold: DispatchHoldResponse): HeldRecord {
  return {
    id: hold.id,
    threadId: hold.threadId,
    reason: hold.reason,
    createdAt: hold.createdAt,
    holder: hold.holder,
  };
}

export default async function concurrencyLimitPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const settings = bb.settings.define({
    maxConcurrentThreads: {
      type: "string",
      label: SETTING_LABELS.maxConcurrentThreads,
      description:
        "How many threads may run at once across every host. A thread counts while it is starting or running, not while it is idle. Anything over the limit waits as a held dispatch and starts automatically when a slot frees. Leave empty for no limit; 0 pauses all new work. Child threads and plugin-spawned threads never count.",
      default: "",
    },
    maxConcurrentThreadsPerHost: {
      type: "string",
      label: SETTING_LABELS.maxConcurrentThreadsPerHost,
      description:
        "How many threads may run at once on any one machine. Applies per host, on top of the overall limit, and only once a thread's host is known. Leave empty for no limit.",
      default: "",
    },
  });

  const holder = `plugin:${bb.pluginId}`;
  const tally = new OccupancyTally();
  const holds = new HoldRegistry(holder);

  /**
   * environmentId → hostId. Thread lifecycle events carry `environmentId` but
   * not `hostId`, and the per-host tally needs the host. The mapping never
   * changes for a given environment, so one lookup per environment is enough.
   */
  const environmentHosts = new Map<string, string | null>();
  /** Host display names, for hold reasons. Refreshed on each reconcile. */
  const hostNames = new Map<string, string>();

  let limits: ResolvedLimits = { global: null, perHost: null };
  let wakeReconciler: (() => void) | null = null;

  async function applySettings(): Promise<void> {
    const raw = await settings.get();
    const resolved = resolveLimits(raw);
    limits = resolved.limits;
    if (resolved.problems.length > 0) {
      // Report rather than throw. A gate that threw on a typo would fail every
      // dispatch in the server with this plugin named, which is a far worse
      // outcome than an unenforced limit the user is told about.
      bb.status.needsConfiguration(resolved.problems.join(" "));
      for (const problem of resolved.problems) bb.log.warn(problem);
    }
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings().then(() => wakeReconciler?.());
  });

  // --- scope resolution -----------------------------------------------------

  async function hostIdForEnvironment(
    environmentId: string | null,
  ): Promise<string | null> {
    if (environmentId === null) return null;
    const cached = environmentHosts.get(environmentId);
    if (cached !== undefined) return cached;
    try {
      const environment = await bb.sdk.environments.get({ environmentId });
      environmentHosts.set(environmentId, environment.hostId);
      return environment.hostId;
    } catch (error) {
      bb.log.debug(
        `could not resolve the host for environment ${environmentId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  function isExemptThread(thread: ThreadResponse): boolean {
    return isExemptDispatch({
      parentThreadId: thread.parentThreadId,
      originPluginId: thread.originPluginId,
    });
  }

  // --- gates ----------------------------------------------------------------

  /**
   * The whole decision, for either stage. Synchronous by construction: every
   * input is already resolved in memory, which is the only way to honour the
   * "decide in milliseconds" contract.
   */
  function decide(args: {
    hostId: string | null;
    exempt: boolean;
    threadId: string | null;
  }): { action: "proceed" } | { action: "hold"; reason: string } {
    if (args.exempt || isFullyUnlimited(limits)) return { action: "proceed" };

    const now = Date.now();
    const verdict = evaluateDispatch({
      limits,
      hostId: args.hostId,
      hostName:
        args.hostId === null ? null : (hostNames.get(args.hostId) ?? null),
      countInScope: (key) => tally.count(key, now),
    });

    if (verdict.action === "hold") {
      holds.expectHold(verdict.reason, verdict.scopeKey);
      return { action: "hold", reason: verdict.reason };
    }

    // A `proceed` is a commitment to a slot the database does not know about
    // yet. Count it now or a limit of 1 admits every dispatch that arrives
    // before the first thread's row lands.
    if (args.threadId === null) tally.notePendingCreate(args.hostId, now);
    else tally.notePendingSubmit(args.threadId, args.hostId, now);
    return { action: "proceed" };
  }

  bb.experimental_dispatch.gate("thread.create", (context) => {
    return decide({
      // Null whenever the environment is not chosen yet, which is the normal
      // case at create: such a dispatch counts globally but against no host's
      // pool.
      hostId: context.host?.id ?? null,
      exempt: isExemptDispatch({
        parentThreadId: context.parentThreadId,
        originPluginId: context.originPluginId,
      }),
      threadId: null,
    });
  });

  bb.experimental_dispatch.gate("turn.submit", (context) => {
    // A thread that is already occupying its slot is not asking for a new one.
    // Re-evaluating it would hold a running thread's own follow-up behind the
    // pool it is itself filling.
    if (
      context.thread.status === "active" ||
      context.thread.status === "starting"
    ) {
      return { action: "proceed" };
    }
    return decide({
      hostId: context.host?.id ?? null,
      exempt: isExemptThread(context.thread),
      threadId: context.thread.id,
    });
  });

  // --- lifecycle events -----------------------------------------------------

  bb.events.on("thread.created", async ({ thread }) => {
    if (isExemptThread(thread)) return;
    tally.noteCreated(thread.id, await hostIdForEnvironment(thread.environmentId));
  });

  bb.events.on("thread.active", async ({ thread }) => {
    if (isExemptThread(thread)) return;
    tally.noteActive(thread.id, await hostIdForEnvironment(thread.environmentId));
  });

  /**
   * A slot freed. Update the tally, then release the oldest hold waiting on a
   * scope this thread was occupying.
   *
   * Exempt threads are skipped entirely, exactly as they are on the way in.
   * The tally must not see them in one direction only: a child thread never
   * took a slot, so treating its completion as a freed one would hand out
   * capacity that does not exist — and under `workflows`, where children
   * finish constantly, it would do so continuously.
   *
   * Releasing is unconditional rather than "release only if now below
   * capacity". Core re-runs the whole gate pipeline on release — including
   * this plugin's own gate — so a release that turns out to be unwarranted
   * simply re-holds, and core paces the retry. Checking first would duplicate
   * the gate's logic in a second place that could disagree with it.
   */
  async function noteThreadFreed(thread: ThreadResponse): Promise<void> {
    if (isExemptThread(thread)) return;
    const hostId = await hostIdForEnvironment(thread.environmentId);
    tally.noteFreed(thread.id, hostId);

    const candidate = holds.oldestForScopes(scopeKeysFor(hostId));
    if (candidate === null) return;
    // Forget it before awaiting: `dispatch.released` may not arrive before the
    // next freed thread looks for a hold, and releasing the same hold twice is
    // a wasted round trip at best. The reconcile pass re-adopts it if the
    // release failed.
    holds.noteResolved(candidate.holdId);
    try {
      await bb.experimental_dispatch.release(candidate.holdId);
    } catch (error) {
      bb.log.warn(
        `could not release hold ${candidate.holdId}: ${errorMessage(error)}`,
      );
      wakeReconciler?.();
    }
  }

  bb.events.on("thread.idle", ({ thread }) => noteThreadFreed(thread));
  bb.events.on("thread.failed", ({ thread }) => noteThreadFreed(thread));
  bb.events.on("thread.archived", ({ thread }) => noteThreadFreed(thread));
  bb.events.on("thread.deleted", ({ thread }) => noteThreadFreed(thread));

  bb.events.on("dispatch.held", ({ hold }) => {
    holds.noteHeld(toHeldRecord(hold));
  });
  bb.events.on("dispatch.released", ({ hold }) => {
    holds.noteResolved(hold.id);
  });
  bb.events.on("dispatch.cancelled", ({ hold }) => {
    holds.noteResolved(hold.id);
  });

  // --- reconciliation -------------------------------------------------------

  async function readSeed(): Promise<SeedCounts> {
    // `parentThreadId: "none"` keeps children out of the seed, so the baseline
    // agrees with what the events maintain.
    //
    // It is not a perfect filter: the count route has no `originPluginId`, so
    // a plugin-spawned *root* thread is exempt from the gate but still lands
    // in the seed. That over-counts, which is the safe direction (it holds
    // rather than over-admits) and it is bounded — the thread's own completion
    // is invisible to the tally, but the next reconcile pass drops it.
    const [active, starting] = await Promise.all([
      bb.sdk.threads.count({
        parentThreadId: ROOT_PARENT_SENTINEL,
        status: "active",
        groupBy: "host",
      }),
      bb.sdk.threads.count({
        parentThreadId: ROOT_PARENT_SENTINEL,
        status: "starting",
        groupBy: "host",
      }),
    ]);

    const byHost: Record<string, number> = {};
    for (const response of [active, starting]) {
      for (const group of response.groups ?? []) {
        if (group.key === null) continue;
        byHost[group.key] = (byHost[group.key] ?? 0) + group.count;
      }
    }

    return { global: active.total + starting.total, byHost };
  }

  async function reconcile(): Promise<void> {
    const hosts = await bb.sdk.hosts.list();
    hostNames.clear();
    for (const host of hosts) hostNames.set(host.id, host.name);

    tally.seed(await readSeed());

    const liveHolds = await bb.sdk.threads.holds.list();
    holds.adopt(
      liveHolds.filter((hold) => hold.holder === holder).map(toHeldRecord),
    );
  }

  bb.background.service("reconciler", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await reconcile();
        } catch (error) {
          if (signal.aborted) break;
          // Deliberately leave the previous tally in place. Stale counts
          // over-count at worst — they still hold the threads they were seeded
          // with, and the event stream keeps adjusting them — whereas clearing
          // the tally would make a transient query failure admit everything.
          bb.log.warn(`could not reconcile counts: ${errorMessage(error)}`);
        }
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          wakeReconciler = resolve;
          void sleep(RECONCILE_INTERVAL_MS, signal).then(resolve);
        });
        wakeReconciler = null;
      }
    },
  });
}
