// bb-plugin-concurrency-limit — admission control for thread dispatches.
//
// One handler at the dispatch checkpoint makes an attempt WAIT when the pool it
// would join is full, and four lifecycle listeners tell core to re-ask that
// handler when a thread stops occupying capacity. That is the entire plugin:
// parse the settings, ask the server what is running, compare, answer — and
// say when the answer might have changed.
//
// The limit is uniform: every running thread counts and every start-turn
// dispatch is hooked, with no carve-out for child threads or plugin-spawned
// ones. That has a real cost, stated here rather than hidden behind an
// exemption: under a tight limit, an orchestration pattern where a running
// parent waits on threads it spawned (the workflows plugin) can wedge, because
// the parent holds a slot while the children it is waiting for sit queued
// behind that same limit. It unwedges when other slots free, or when the user
// sends a child now from its queue. The alternative — exempting whole classes
// of thread from a limit the user set — silently overruns the number the user
// asked for, on every host, for as long as the pattern runs.
//
// It used to be four times this size, because it kept its own occupancy
// tally — a baseline seeded from `threads.count`, maintained by lifecycle
// events, plus its own in-flight `proceed`s — and its own registry of the rows
// it had queued, so it could clear the oldest one when a slot freed. None of
// that is needed now:
//
//   * `sdk.threads.listRunning()` answers "which threads are occupying
//     capacity" directly. Hook passes are serialized under one server-wide lock
//     AND a cleared first attempt commits its `pending -> starting` flip before
//     that lock releases, so inside a handler the answer already includes every
//     admission granted ahead of this one. No in-flight bookkeeping, no
//     reseeding, no drift to reconcile.
//   * `bb.experimental_hooks.requestDrain()` asks core to re-attempt every
//     plugin-queued row. A queued row is re-decided by this very handler, so a
//     request that is not warranted simply re-queues — which is why the plugin
//     never needed to choose *which* row to release, or to track what it had
//     queued at all.
//
// What remains, deliberately: unparseable settings report through
// `needsConfiguration` and leave that limit unenforced (a handler that threw on a
// typo would fail every dispatch in the server), and a `join-turn` attempt or
// an already-running thread proceeds unconditionally — it holds its slot
// already.

import type {
  BbPluginApi,
  MessageDispatchHookDecision,
  PluginThreadEventName,
} from "@get-bb/plugin-sdk";
import {
  isFullyUnlimited,
  resolveLimits,
  SETTING_LABELS,
  type ResolvedLimits,
} from "./limits.js";

/** Reason strings are capped by the queued-row contract; host names are user-set. */
export const MAX_REASON_LENGTH = 200;

/**
 * The moments a thread stops occupying capacity. That is this plugin's wait
 * condition, so watching it is this plugin's job: core owns the re-drain and
 * the clock, and everything else that ends a wait is owned by whoever set it.
 *
 * `thread.idle` and `thread.failed` are turns ending; archiving or deleting a
 * running thread stops it, which frees its slot just as surely — the case a
 * limiter watching only `thread.idle` would miss.
 */
const CAPACITY_FREED_EVENTS = [
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.deleted",
] as const satisfies readonly PluginThreadEventName[];

/**
 * "N of N running on <scope>". The count shown is the limit itself, so a
 * binding limit reads as a full pool ("4 of 4 running on all hosts") rather
 * than an off-by-one. A limit of 0 shows as "0 of 0", which is honest: the
 * pool has no slots.
 */
function waitDecision(
  limit: number,
  scopeLabel: string,
): MessageDispatchHookDecision {
  const reason = `${limit} of ${limit} running on ${scopeLabel}`;
  return {
    action: "wait",
    reason:
      reason.length <= MAX_REASON_LENGTH
        ? reason
        : `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`,
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
        "How many threads may run at once across every host. A thread counts while it is starting or running, not while it is idle. Anything over the limit waits on the thread's queue and starts automatically when a slot frees. Leave empty for no limit; 0 pauses all new work. The limit is uniform — every running thread counts, including child and plugin-spawned ones — so under a tight limit a running thread that waits on threads it spawned (workflows) can wedge until other slots free or you send a child now from its queue.",
      default: "",
    },
    maxConcurrentThreadsPerHost: {
      type: "string",
      label: SETTING_LABELS.maxConcurrentThreadsPerHost,
      description:
        "How many threads may run at once on any one machine. Applies per host, on top of the overall limit, and only once a thread's host is known. Counts every running thread on that host, child and plugin-spawned ones included. Leave empty for no limit.",
      default: "",
    },
  });

  let limits: ResolvedLimits = { global: null, perHost: null };

  async function applySettings(): Promise<void> {
    const raw = await settings.get();
    const resolved = resolveLimits(raw);
    limits = resolved.limits;
    if (resolved.problems.length > 0) {
      // Report rather than throw. A handler that threw on a typo would fail every
      // dispatch in the server with this plugin named, which is a far worse
      // outcome than an unenforced limit the user is told about.
      bb.status.needsConfiguration(resolved.problems.join(" "));
      for (const problem of resolved.problems) bb.log.warn(problem);
    }
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings();
  });

  for (const event of CAPACITY_FREED_EVENTS) {
    bb.events.on(event, async () => {
      // Not a release: core re-attempts every plugin-queued row in queue order
      // and re-runs the hook below on each, so a row that is still over the
      // limit simply re-queues. Nothing here has to work out which row earned
      // the slot, or whether one freed at all.
      await bb.experimental_hooks.requestDrain();
    });
  }

  bb.experimental_hooks.on("message.dispatch", async (context) => {
    // A thread that is already occupying its slot is not asking for a new one.
    // Re-evaluating it would queue a running thread's own follow-up behind the
    // pool it is itself filling — and a `join-turn` attempt is by definition
    // joining a turn whose slot is already ours.
    if (
      context.attempt === "join-turn" ||
      context.thread.status === "active" ||
      context.thread.status === "starting"
    ) {
      return { action: "proceed" };
    }
    if (isFullyUnlimited(limits)) {
      return { action: "proceed" };
    }

    // Exact here, and only here: the evaluation lock plus the flip-before-
    // unlock invariant mean this already contains every admission granted
    // ahead of us in this burst.
    const running = await bb.sdk.threads.listRunning();

    if (limits.global !== null && running.length >= limits.global) {
      // Broadest limit first, and deterministically so: both limits can be at
      // capacity at once, and a handler that reported whichever it noticed first
      // would give the same thread a different reason on each re-evaluation.
      // "the server is full" also explains more than "this host is full".
      return waitDecision(limits.global, "all hosts");
    }

    // Null whenever the environment is not chosen yet, which is the normal
    // case for a first message: such a dispatch counts globally but against no
    // host's pool.
    const host = context.host;
    if (limits.perHost !== null && host !== null) {
      const onHost = running.filter((thread) => thread.hostId === host.id);
      if (onHost.length >= limits.perHost) {
        const label = host.name.trim() === "" ? host.id : host.name;
        return waitDecision(limits.perHost, `host ${label}`);
      }
    }

    return { action: "proceed" };
  });
}
