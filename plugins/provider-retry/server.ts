import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { providerRetryRpcContract } from "./src/contract.js";
import { findParkedRetry, retryViewForThread } from "./src/parked-retries.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  RESET_BUFFER_MS,
  decideRetry,
  type RetryDeclineReason,
} from "./src/retry-policy.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string | boolean | undefined): number | null {
  switch (value) {
    case "6 hours":
      return DEFAULT_MAXIMUM_WAIT_MS;
    case "24 hours":
      return 24 * 60 * 60 * 1_000;
    case "No limit":
      return null;
    default:
      throw new Error(
        `Unsupported maximum provider retry wait: ${String(value)}`,
      );
  }
}

/**
 * What a rate-limited row is waiting for. Deliberately just the cause: the time
 * rides the row's `sendAt`, and every surface that shows a parked row renders
 * that itself — the card above the composer puts the clock next to the reason,
 * `bb thread queue list` gives it its own Send-at column. Formatting it into
 * the reason as well printed it twice in both.
 */
const RATE_LIMITED_WAIT_REASON = "Rate limited";

/**
 * The decline reasons worth telling the user about.
 *
 * Most declines mean "this failure had nothing to do with a rate limit", which
 * is every ordinary failure on the machine — annotating those would put a note
 * on failures this plugin has no opinion about. These two are different: the
 * user hit a limit and is being told, once, that nothing will happen
 * automatically.
 */
const NOTED_DECLINE_REASONS: Partial<Record<RetryDeclineReason, string>> = {
  "beyond-maximum-wait":
    "Rate limited, and the reset is farther away than the configured maximum wait — no retry scheduled.",
  "attempts-exhausted":
    "Rate limited again after several retries — giving up on this turn.",
};

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a retry when the reported reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  let maximumWait = maximumWaitMs(initialSettings.maximumWait);
  settings.onChange((next) => {
    maximumWait = maximumWaitMs(next.maximumWait);
  });

  /**
   * Windows this plugin has seen a provider account blocked on, keyed by
   * `hostId:providerId`.
   *
   * This is the whole replacement for the old per-account release pacing: once
   * one thread proves an account is exhausted, `turn.submit` parks OTHER
   * dispatches into the same account until the window resets, instead of
   * letting them each discover it by failing. Purely an optimisation, so
   * in-memory is right — losing it on restart costs one extra failure, and a
   * stale entry expires by its own reset time.
   */
  const blockedScopes = new Map<string, number>();

  function noteBlockedScope(
    hostId: string | null,
    providerId: string,
    resetsAtMs: number,
  ): void {
    if (hostId === null) return;
    blockedScopes.set(`${hostId}:${providerId}`, resetsAtMs);
  }

  function blockedScopeResetAt(
    hostId: string | null,
    providerId: string,
    now: number,
  ): number | null {
    if (hostId === null) return null;
    const key = `${hostId}:${providerId}`;
    const resetsAtMs = blockedScopes.get(key);
    if (resetsAtMs === undefined) return null;
    if (resetsAtMs + RESET_BUFFER_MS <= now) {
      blockedScopes.delete(key);
      return null;
    }
    return resetsAtMs;
  }

  function appendNote(
    threadId: string,
    text: string,
    level: "info" | "warning",
  ): void {
    // Deliberately not awaited: notes annotate, they do not gate anything, and
    // a gate that waited on one would spend its decision box on a write.
    void bb.experimental_threads
      .appendNote(threadId, { text, iconName: "ArrowReloadHorizontal", level })
      .catch((error: unknown) => {
        bb.log.warn(
          `Could not append a provider retry note: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * The retry decision itself.
   *
   * Everything this used to need — did the turn really fail, which request was
   * it, what did the provider say, which window is blocked, how many times have
   * we tried — arrives on the context. What is left is policy, which is all
   * this plugin was ever for.
   */
  bb.experimental_dispatch.gate("turn.failed", (context) => {
    const decision = decideRetry({
      failure: context.failure,
      maximumWaitMs: maximumWait,
      now: Date.now(),
      random: Math.random(),
    });
    if (decision.kind === "decline") {
      const noteText = NOTED_DECLINE_REASONS[decision.reason];
      if (noteText !== undefined) {
        appendNote(context.thread.id, noteText, "warning");
      }
      return { action: "none" };
    }
    noteBlockedScope(
      context.host?.id ?? null,
      context.requestedExecution.providerId,
      decision.resetsAtMs,
    );
    return {
      action: "retry",
      reason: RATE_LIMITED_WAIT_REASON,
      resumeAt: decision.resumeAt,
    };
  });

  /**
   * Admission control for an account already known to be exhausted.
   *
   * A dispatch into a blocked account can only fail, and a failure costs the
   * user a red turn plus a wait. Parking it until the window resets turns that
   * into one card that says why. The re-attempt re-enters this gate, so a
   * window that has not actually reset simply parks it again.
   *
   * A `join-turn` attempt is exempt: it is joining a turn the provider already
   * accepted, so the account is demonstrably not blocked for it, and parking a
   * steer behind a window would strand the user mid-turn for a limit that is
   * not being hit.
   */
  bb.experimental_dispatch.gate("dispatch", (context) => {
    if (context.attempt === "join-turn") {
      return { action: "proceed" };
    }
    const resetsAtMs = blockedScopeResetAt(
      context.host?.id ?? null,
      context.requestedExecution.providerId,
      Date.now(),
    );
    if (resetsAtMs === null) {
      return { action: "proceed" };
    }
    return {
      action: "wait",
      reason: RATE_LIMITED_WAIT_REASON,
      // `retryAt` becomes the row's `sendAt`, so core's due sweep re-attempts
      // when the window resets without this plugin holding a timer.
      retryAt: resetsAtMs + RESET_BUFFER_MS,
    };
  });

  // The user-facing narration of a retry's life. It hangs off the queue events
  // rather than the gate so the note reflects what core actually did with the
  // verdict, and so a row the user cancels says so without this plugin
  // tracking cancellation itself.
  //
  // `queue.dispatched` reports the wait the row was holding when it went, so
  // "was this ours?" is answerable from the event alone.
  const isOwnRetry = (entry: {
    payload: { kind: string };
    waitingOn: { kind: string; pluginId?: string } | null;
  }): boolean =>
    entry.payload.kind === "retry" &&
    entry.waitingOn?.kind === "plugin" &&
    entry.waitingOn.pluginId === bb.pluginId;

  bb.events.on("queue.dispatched", ({ entry }) => {
    if (!isOwnRetry(entry)) return;
    appendNote(entry.threadId, "Rate limit window reset — retrying now.", "info");
  });
  bb.events.on("queue.cancelled", ({ entry }) => {
    if (!isOwnRetry(entry)) return;
    appendNote(entry.threadId, "Automatic retry cancelled.", "info");
  });

  bb.rpc.register(providerRetryRpcContract, {
    async providerRetryCancel({ threadId }) {
      const parked = await findParkedRetry(bb, threadId);
      if (parked === null) return { cancelled: false };
      // Cancelling a parked dispatch is deleting its queued row — the same
      // affordance the user has on the card, rather than a second mechanism.
      await bb.sdk.threads.queuedMessages.delete({
        threadId: parked.threadId,
        queuedMessageId: parked.id,
      });
      return { cancelled: true };
    },
    async providerRetryStatus({ threadId }) {
      return { view: await retryViewForThread(bb, threadId) };
    },
  });
  registerProviderRetryCli(bb);
}
