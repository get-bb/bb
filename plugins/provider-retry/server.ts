import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { findQueuedRetry } from "./src/queued-retries.js";
import { DEFAULT_MAXIMUM_WAIT_MS, decideRetry } from "./src/retry-policy.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string): number | null {
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

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a subscription-limit retry when its reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  let maximumWait = maximumWaitMs(initialSettings.maximumWait);
  settings.onChange((next) => {
    maximumWait = maximumWaitMs(next.maximumWait);
  });

  async function cancelQueuedRetry(threadId: string): Promise<void> {
    const queued = await findQueuedRetry(bb, threadId);
    if (queued === null) {
      return;
    }
    await bb.sdk.threads.queuedMessages.delete({
      threadId: queued.threadId,
      queuedMessageId: queued.id,
    });
  }

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
      reason: decision.reason,
    });
  });

  bb.events.on("thread.active", async ({ thread }) => {
    await cancelQueuedRetry(thread.id);
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    await cancelQueuedRetry(thread.id);
  });
  bb.events.on("message.queued", async ({ entry }) => {
    if (entry.payload.kind === "retry") {
      return;
    }
    await cancelQueuedRetry(entry.threadId);
  });

  registerProviderRetryCli(bb);
}
