import { z } from "zod";

export const threadVoiceCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      sessionId: z.string().uuid(),
      sdp: z.string().min(1).max(131072),
      voice: z.string().min(1).max(64).optional(),
      initialContext: z.string().max(16000).optional(),
      instructions: z.string().max(8000).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("keepAlive"), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({ action: z.literal("stop"), sessionId: z.string().uuid() })
    .strict(),
]);
export type ThreadVoiceCommand = z.infer<typeof threadVoiceCommandSchema>;
export const threadVoiceResultSchema = z
  .object({ sdp: z.string().min(1).max(131072).nullable() })
  .strict();
export type ThreadVoiceResult = z.infer<typeof threadVoiceResultSchema>;
