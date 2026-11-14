import { z } from "zod";
import { threadDeltaNotificationParamsSchema } from "../thread-delta.js";
import type { AssemblerDelta } from "./delta-assembler.js";

const rawDeltaBatchSchema = z
  .object({ deltas: z.array(z.unknown()) })
  .passthrough();

const claimIfIdleBoundarySchema = z
  .object({ kind: z.literal("turn.boundary"), claimIfIdle: z.literal(true) })
  .passthrough();

export interface ProtocolV2DeltaBatch {
  threadId: string;
  deltas: AssemblerDelta[];
}

export function parseProtocolV2ThreadDeltaParams(
  params: unknown,
): ProtocolV2DeltaBatch | null {
  const parsed = threadDeltaNotificationParamsSchema.safeParse(params);
  const raw = rawDeltaBatchSchema.safeParse(params);
  if (!parsed.success || !raw.success) {
    return null;
  }
  const deltas: AssemblerDelta[] = [];
  parsed.data.deltas.forEach((delta, index) => {
    if (
      delta.kind === "turn.boundary" &&
      delta.providerTurnId === undefined &&
      claimIfIdleBoundarySchema.safeParse(raw.data.deltas[index]).success
    ) {
      deltas.push({ kind: "protocolV2.claimIdleTurn" });
    }
    deltas.push(delta);
  });
  return { threadId: parsed.data.threadId, deltas };
}
