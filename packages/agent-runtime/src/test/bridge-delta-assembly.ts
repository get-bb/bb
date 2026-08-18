/**
 * Test-side view of the runtime's delta assembly: bridge tests capture raw
 * JSON-RPC output, and pi now emits `thread/delta` notifications instead of
 * finished `thread/event`s. These helpers run captured notifications through
 * a real delta assembler — the exact translation the bridge protocol adapter
 * performs — so assertions keep working against canonical `ThreadEvent`s.
 */
import type { ThreadEvent } from "@bb/domain";
import {
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "@bb/provider-bridge-protocol";
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
  const assembler = createDeltaAssembler({ providerId });
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
        return [];
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
