import { z } from "zod";

export const systemVoiceTranscriptionResponseSchema = z.object({
  text: z.string(),
});
