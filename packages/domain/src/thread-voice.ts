import { z } from "zod";

export const threadVoiceContextSchema = z
  .array(
    z.object({
      role: z.enum(["developer", "user", "assistant"]),
      text: z.string().max(24000),
    }),
  )
  .max(31)
  .refine(
    (items) =>
      items.reduce(
        (sum, item) => sum + new TextEncoder().encode(item.text).length,
        0,
      ) <= 24000,
    "Voice context exceeds 24000 bytes",
  );
export type ThreadVoiceContext = z.infer<typeof threadVoiceContextSchema>;

export const threadVoiceCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      sessionId: z.string().uuid(),
      sdp: z.string().min(1).max(131072),
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
