/**
 * Test-side view of the runtime's delta assembly: bridge tests capture raw
 * JSON-RPC output, and bridges emit `thread/delta` notifications rather than
 * finished `ThreadEvent`s. These helpers run captured notifications through
 * the real delta assembler — the exact translation the bridge protocol
 * adapter performs — so assertions keep working against canonical
 * `ThreadEvent`s.
 */
import type { ThreadEvent } from "@bb/domain";
import {
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "../thread-delta.js";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "../assembler/delta-assembler.js";

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
            .join(
              "; ",
            )} (params: ${JSON.stringify(message.params)?.slice(0, 400)})`,
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
 * Removed (SDK 0.4.16): the conformance kit assembles `thread/delta` itself.
 * A transport hands `runBridgeConformance` the raw captured messages
 * (`CapturedBridgeJsonRpcOutput.takeMessages`) and the run names its
 * `providerId`; this stub stays one release so a suite written against the
 * old transport shape fails with the replacement named, not a missing export.
 */
export function toConformanceMessages(): never {
  throw new Error(
    "experimental_toConformanceMessages was removed: experimental_runBridgeConformance assembles thread/delta itself. Hand it a transport whose takeMessages returns the raw captured messages (CapturedBridgeJsonRpcOutput.takeMessages) and pass the bridge's providerId.",
  );
}
