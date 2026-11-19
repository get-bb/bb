import type { ThreadEvent } from "@bb/domain";
import {
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "../thread-delta.js";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "../assembler/delta-assembler.js";
import { parseProtocolV2ThreadDeltaParams } from "../assembler/protocol-v2.js";
import {
  PROVIDER_BRIDGE_PROTOCOL_V2,
  type BridgeProtocolVersion,
} from "../protocol-v2.js";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "../version.js";

export interface CapturedBridgeNotification {
  method?: string;
  params?: unknown;
}

export interface BridgeDeltaEventCollector {
  assembler: DeltaAssembler;
  assembleMessage(message: CapturedBridgeNotification): ThreadEvent[];
  setProtocolVersion(version: BridgeProtocolVersion): void;
}

export function createBridgeDeltaEventCollector(
  providerId = "pi",
): BridgeDeltaEventCollector {
  const assembler = createDeltaAssembler({
    providerId,
    textDeltaFlushMs: 0,
    now: () => 0,
  });
  let protocolVersion: BridgeProtocolVersion = PROVIDER_BRIDGE_PROTOCOL_VERSION;
  return {
    assembler,
    setProtocolVersion(version) {
      protocolVersion = version;
    },
    assembleMessage(message) {
      if (message.method !== THREAD_DELTA_NOTIFICATION_METHOD) {
        return [];
      }
      if (protocolVersion === PROVIDER_BRIDGE_PROTOCOL_V2) {
        const batch = parseProtocolV2ThreadDeltaParams(message.params);
        if (batch !== null) {
          return assembler.assemble(batch);
        }
      }
      const parsed = threadDeltaNotificationParamsSchema.safeParse(
        message.params,
      );
      if (!parsed.success) {
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

export function assembleCapturedThreadEvents(
  messages: readonly CapturedBridgeNotification[],
  providerId = "pi",
): ThreadEvent[] {
  const collector = createBridgeDeltaEventCollector(providerId);
  return messages.flatMap((message) => collector.assembleMessage(message));
}
