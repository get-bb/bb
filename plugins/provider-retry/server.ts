// bb-plugin-provider-retry — continue a turn once a subscription window resets.
//
// The entire plugin is one listener on `turn.failed`: if the failure is a rate
// limit that reports a reset, ask core for a retry at that time. Buffer,
// jitter, maximum wait and the attempt cap are the only policy it owns.
//
// **It never intercepts a send.** An earlier version answered the dispatch
// checkpoint too: once one thread proved an account exhausted, it queued every
// other dispatch into that account until the window it remembered had passed.
// That is wrong on principle. A rate-limit record is a stale cache of provider
// state — the provider is the only thing that knows whether the limit still
// binds. A user who fixed it out of band (upgraded the plan, had the window
// reset early, swapped the credentials behind the provider) would be refused
// without an attempt, on this plugin's memory of a failure that no longer
// applied, with no way to tell that the refusal was ours and not theirs. The
// only authoritative check is trying.
//
// The cost of that is accepted rather than engineered around: N threads sharing
// one exhausted account each fail once, instead of the first failing and the
// rest queueing behind it. One honest failure per thread — visible, explained,
// and immediately followed by a scheduled retry — is cheaper than one wrong
// refusal, and it is the only version of this plugin that cannot be wrong about
// the present.
//
// It also narrates nothing. A scheduled retry IS a queued row, and that row
// already says what it is waiting on and when it will go, on the card above the
// composer and in `bb thread queue list`. A note repeating it could only go
// stale when the row is cancelled, sent now or re-queued.

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { DEFAULT_MAXIMUM_WAIT_MS, decideRetry } from "./src/retry-policy.js";

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
 * rides the row's `sendAt`, and every surface that shows a queued row renders
 * that itself — the card above the composer puts the clock next to the reason,
 * `bb thread queue list` gives it its own Send-at column. Formatting it into
 * the reason as well printed it twice in both.
 */
const RATE_LIMITED_WAIT_REASON = "Rate limited";

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
   * The retry decision, which is the whole plugin.
   *
   * Everything it needs — which turn failed, what the provider said about its
   * windows, how many times this turn has been retried — arrives on the event.
   * What is left is policy, and then one call: core owns the queue, the
   * schedule and the re-attempt, so asking for the retry IS scheduling it.
   */
  bb.events.on("turn.failed", async (event) => {
    const decision = decideRetry({
      failure: event,
      maximumWaitMs: maximumWait,
      now: Date.now(),
      random: Math.random(),
    });
    if (decision.kind === "decline") {
      return;
    }
    await bb.sdk.threads.retry({
      threadId: event.threadId,
      turnRequestId: event.requestId,
      sendAt: decision.sendAt,
      reason: RATE_LIMITED_WAIT_REASON,
    });
  });

  registerProviderRetryCli(bb);
}
