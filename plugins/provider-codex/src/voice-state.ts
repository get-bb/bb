import { z } from "zod";

export const voiceStateSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["active", "closed", "error"]),
  message: z.string().nullable(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;
