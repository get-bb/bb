import {
  readRetryDiagnostic,
  retryDiagnosticContract,
} from "./src/diagnostics.js";
import {
  retryAvailabilityMethod,
  retryAvailabilitySchema,
  type RetryAvailability,
} from "./src/retry-contract.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import {
  handoffContract,
  handoffTag,
  readHandoffOffer,
  startHandoff,
} from "./src/handoff.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  decideRetry,
  isRateLimitFailure,
  type RetryDecision,
} from "./src/retry-policy.js";

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

  bb.rpc.register(
    retryDiagnosticContract,
    {
      "decision.get": ({ threadId }) => readRetryDiagnostic(bb, threadId),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "The last automatic retry decision for a thread, recorded after a scheduled retry is queued. A plugin that re-runs failed work waits for the decision on its failed request before re-running it.",
    },
  );
  const handoffs = new Map<string, Promise<{ threadId: string }>>();
  const handoff = (threadId: string) => {
    const running = handoffs.get(threadId);
    if (running !== undefined) return running;
    const started = startHandoff(bb, threadId).finally(() =>
      handoffs.delete(threadId),
    );
    handoffs.set(threadId, started);
    return started;
  };
  bb.rpc.register(handoffContract, {
    "handoff.get": ({ threadId }) => readHandoffOffer(bb, threadId),
    "handoff.start": ({ threadId }) => handoff(threadId),
  });
  const refreshHandoff = (threadId: string) =>
    bb.rpc.experimental_invalidate([handoffTag(threadId)]);
  bb.events.on("message.dispatched", ({ entry }) =>
    refreshHandoff(entry.threadId),
  );
  bb.events.on("message.cancelled", ({ entry }) =>
    refreshHandoff(entry.threadId),
  );
  bb.events.on("experimental_thread.settled", ({ thread }) =>
    refreshHandoff(thread.id),
  );
  bb.events.on("thread.active", ({ thread }) => refreshHandoff(thread.id));
  bb.events.on("turn.failed", async (event) => {
    const rateLimited = isRateLimitFailure(event);
    let availability: RetryAvailability = { kind: "not-routed" };
    if (rateLimited) {
      const sources = await bb.sdk.plugins.experimental_discoverRpc({
        method: retryAvailabilityMethod,
      });
      for (const source of sources) {
        try {
          const result = await bb.sdk.plugins.callRpc({
            pluginId: source.pluginId,
            method: retryAvailabilityMethod,
            input: { threadId: event.threadId, requestId: event.requestId },
            outputSchema: retryAvailabilitySchema,
            signal: AbortSignal.timeout(5_000),
          });
          if (result.kind !== "not-routed") {
            availability = result;
            break;
          }
        } catch (error) {
          bb.log.warn(
            `Retry availability failed for ${event.threadId}: ${String(error)}`,
          );
          availability = { kind: "unavailable", reason: "source-unavailable" };
        }
      }
    }
    const decision = decideRetry({
      availability,
      failure: event,
      maximumWaitMs: maximumWait,
      now: Date.now(),
      random: Math.random(),
    });
    const recordDecision = async () => {
      await bb.storage.kv.set(`decision:${event.threadId}`, {
        requestId: event.requestId,
        observedAt: Date.now(),
        availability,
        rateLimited,
        decision,
      });
      refreshHandoff(event.threadId);
    };
    if (decision.kind === "decline") {
      await recordDecision();
      bb.log.info(
        `Automatic retry skipped for ${event.threadId}: ${decision.reason}${availability.kind === "unavailable" ? ` (${availability.reason})` : ""}.`,
      );
      return;
    }
    await bb.sdk.threads.retry({
      threadId: event.threadId,
      turnRequestId: event.requestId,
      sendAt: decision.sendAt,
      reason: decision.reason,
    });
    await recordDecision();
  });

  registerProviderRetryCli(bb, handoff);
}
