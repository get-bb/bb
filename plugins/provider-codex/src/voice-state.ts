import { z } from "zod";

export const voiceStateSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["active", "closed", "error"]),
  message: z.string().nullable(),
  backgroundContext: z.string().max(32000).optional(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;
