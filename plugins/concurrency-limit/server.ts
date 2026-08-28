// bb-plugin-concurrency-limit — admission control for thread dispatches.
//
// One gate at the dispatch checkpoint makes an attempt WAIT when the pool it
// would join is full. That is the entire plugin: parse the settings, ask the
// server what is running, drop the exempt threads, compare, answer.
//
// It used to be four times this size, because it kept its own occupancy
// tally — a baseline seeded from `threads.count`, maintained by lifecycle
// events, plus its own in-flight `proceed`s — and its own registry of the rows
// it had parked, so it could clear the oldest one when a slot freed. None of
// that is needed now:
//
//   * `sdk.threads.listRunning()` answers "which threads are occupying
//     capacity" directly, with the provenance fields the exemption needs. Gate
//     passes are serialized under one server-wide lock AND a cleared first
//     attempt commits its `pending -> starting` flip before that lock
//     releases, so inside a gate the answer already includes every admission
//     granted ahead of this one. No in-flight bookkeeping, no reseeding, no
//     drift to reconcile.
//   * Core re-attempts every plugin-parked row whenever a thread leaves the
//     occupying set. A parked row is re-decided by this very gate, so a
//     release that is not warranted simply re-parks — which is why the plugin
//     never needed to choose *which* row to release.
//
// What remains, deliberately: unparseable settings report through
// `needsConfiguration` and leave that limit unenforced (a gate that threw on a
// typo would fail every dispatch in the server), and a `join-turn` attempt or
// an already-running thread proceeds unconditionally — it holds its slot
// already.

import type { BbPluginApi, PluginDispatchDecision } from "@get-bb/plugin-sdk";
import {
  isFullyUnlimited,
  resolveLimits,
  SETTING_LABELS,
  type ResolvedLimits,
} from "./limits.js";

/** Reason strings are capped by the queued-row contract; host names are user-set. */
export const MAX_REASON_LENGTH = 200;

/**
 * Whether this thread is exempt from counting and from limiting.
 *
 * Child and plugin-spawned threads always are, and this is not a setting. It
 * is the deadlock guard: a `workflows`-style parent sits in `active` for the
 * entire time it waits on hidden children. If children counted against the
 * same pool, a limit of N would be consumed by N parents that can only finish
 * once their children run — and the children would be held forever behind the
 * parents. Exempting children breaks the cycle: the parent occupies a slot,
 * its children do not.
 *
 * `parentThreadId` catches forks and side chats; `originPluginId` catches
 * plugin-spawned roots that have no parent thread but are still someone else's
 * internal machinery rather than a user asking for work.
 *
 * Applied to the running set as well as to the dispatch, because the tally
 * must not see exempt threads in one direction only.
 */
function isExempt(thread: {
  parentThreadId: string | null;
  originPluginId: string | null;
}): boolean {
  return thread.parentThreadId !== null || thread.originPluginId !== null;
}

/**
 * "N of N running on <scope>". The count shown is the limit itself, so a
 * binding limit reads as a full pool ("4 of 4 running on all hosts") rather
 * than an off-by-one. A limit of 0 shows as "0 of 0", which is honest: the
 * pool has no slots.
 */
function waitVerdict(limit: number, scopeLabel: string): PluginDispatchDecision {
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
        "How many threads may run at once across every host. A thread counts while it is starting or running, not while it is idle. Anything over the limit waits on the thread's queue and starts automatically when a slot frees. Leave empty for no limit; 0 pauses all new work. Child threads and plugin-spawned threads never count.",
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

  let limits: ResolvedLimits = { global: null, perHost: null };

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
    void applySettings();
  });

  bb.experimental_dispatch.gate("dispatch", async (context) => {
    // A thread that is already occupying its slot is not asking for a new one.
    // Re-evaluating it would park a running thread's own follow-up behind the
    // pool it is itself filling — and a `join-turn` attempt is by definition
    // joining a turn whose slot is already ours.
    if (
      context.attempt === "join-turn" ||
      context.thread.status === "active" ||
      context.thread.status === "starting"
    ) {
      return { action: "proceed" };
    }
    if (isExempt(context.thread) || isFullyUnlimited(limits)) {
      return { action: "proceed" };
    }

    // Exact here, and only here: the evaluation lock plus the flip-before-
    // unlock invariant mean this already contains every admission granted
    // ahead of us in this burst.
    const running = (await bb.sdk.threads.listRunning()).filter(
      (thread) => !isExempt(thread),
    );

    if (limits.global !== null && running.length >= limits.global) {
      // Broadest limit first, and deterministically so: both limits can be at
      // capacity at once, and a gate that reported whichever it noticed first
      // would give the same thread a different reason on each re-evaluation.
      // "the server is full" also explains more than "this host is full".
      return waitVerdict(limits.global, "all hosts");
    }

    // Null whenever the environment is not chosen yet, which is the normal
    // case for a first message: such a dispatch counts globally but against no
    // host's pool.
    const host = context.host;
    if (limits.perHost !== null && host !== null) {
      const onHost = running.filter((thread) => thread.hostId === host.id);
      if (onHost.length >= limits.perHost) {
        const label = host.name.trim() === "" ? host.id : host.name;
        return waitVerdict(limits.perHost, `host ${label}`);
      }
    }

    return { action: "proceed" };
  });
}
