/**
 * Test-side view of the runtime's delta assembly: bridge tests capture raw
 * JSON-RPC output, and bridges emit `thread/delta` notifications rather than
 * finished `ThreadEvent`s. These helpers run captured notifications through
 * a real delta assembler — the exact translation the bridge protocol adapter
 * performs — so assertions keep working against canonical `ThreadEvent`s.
 */
import type { ThreadEvent } from "@bb/domain";
import {
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "@bb/provider-bridge-protocol";
import { CONFORMANCE_ASSEMBLED_EVENT_METHOD } from "@bb/provider-bridge-protocol/conformance";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "../delta-assembler.js";

// Re-exported for bridge suites outside this package (the acp plugin's
// equivalence tests build a real assembler through this test-only path).
export { createDeltaAssembler };
export type { DeltaAssembler };

export interface CapturedBridgeNotification {
  method?: string;
  params?: unknown;
}

export interface BridgeDeltaEventCollector {
  assembler: DeltaAssembler;
  /** Canonical events for one captured notification (empty for non-deltas). */
  assembleMessage(message: CapturedBridgeNotification): ThreadEvent[];
}

export function createBridgeDeltaEventCollector(
  providerId = "pi",
): BridgeDeltaEventCollector {
  // Bridge equivalence/conformance/calibration suites pin per-delta
  // translation fidelity, so coalescing is explicitly disabled here.
  const assembler = createDeltaAssembler({ providerId, textDeltaFlushMs: 0 });
  return {
    assembler,
    assembleMessage(message) {
      if (message.method !== THREAD_DELTA_NOTIFICATION_METHOD) {
        return [];
      }
      const parsed = threadDeltaNotificationParamsSchema.safeParse(
        message.params,
      );
      if (!parsed.success) {
        // Test-only surface: a bridge emitting an invalid thread/delta must
        // fail its suite loudly. Swallowing it into an empty event list let a
        // bridge pass conformance while emitting garbage the runtime adapter
        // would drop.
        throw new Error(
          `Invalid thread/delta notification: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")} (params: ${JSON.stringify(message.params)?.slice(0, 400)})`,
        );
      }
      return assembler.assemble({
        threadId: parsed.data.threadId,
        deltas: parsed.data.deltas,
      });
    },
  };
}

/**
 * All canonical events an ordered capture of bridge notifications assembles
 * to. Builds a fresh assembler per call, so feed it the full capture (not an
 * incremental slice) for deterministic ids.
 */
export function assembleCapturedThreadEvents(
  messages: readonly CapturedBridgeNotification[],
  providerId = "pi",
): ThreadEvent[] {
  const collector = createBridgeDeltaEventCollector(providerId);
  return messages.flatMap((message) => collector.assembleMessage(message));
}

/**
 * Map one captured bridge message for the conformance kit's transport: a
 * `thread/delta` notification is assembled (statefully, through the
 * collector's real assembler — hold one collector for the whole run) and each
 * assembled event is re-emitted on the kit's internal assembled-event lane;
 * every other message passes through untouched.
 */
export function toConformanceMessages(
  message: CapturedBridgeNotification,
  collector: BridgeDeltaEventCollector,
): unknown[] {
  if (message.method !== THREAD_DELTA_NOTIFICATION_METHOD) {
    return [message];
  }
  const threadId =
    typeof (message.params as { threadId?: unknown } | undefined)?.threadId ===
    "string"
      ? (message.params as { threadId: string }).threadId
      : "";
  return collector.assembleMessage(message).map((event) => ({
    jsonrpc: "2.0" as const,
    method: CONFORMANCE_ASSEMBLED_EVENT_METHOD,
    // ThreadEvents are JSON data; the capture type demands JsonValue.
    params: JSON.parse(JSON.stringify({ threadId, event })) as unknown,
  }));
}
