import { z } from "zod";

export const REFUSAL_FALLBACK_RENDERER_ID = "refusal-fallback";

export const refusalFallbackOptionSchema = z.object({
  model: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type RefusalFallbackOption = z.infer<typeof refusalFallbackOptionSchema>;

export const refusalFallbackPayloadSchema = z.object({
  refusedModelLabel: z.string().min(1),
  detail: z.string(),
  options: z.array(refusalFallbackOptionSchema).min(1),
});
export type RefusalFallbackPayload = z.infer<
  typeof refusalFallbackPayloadSchema
>;

export const refusalFallbackResponseSchema = z.object({
  model: z.string().min(1).nullable(),
  remember: z.boolean(),
});
export type RefusalFallbackResponse = z.infer<
  typeof refusalFallbackResponseSchema
>;
