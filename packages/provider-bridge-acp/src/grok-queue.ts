import { z } from "zod";

const grokInterjectParamsSchema = z.object({
  sessionId: z.string().min(1),
  text: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: "Grok interject text cannot be blank",
    }),
});

const grokInterjectResultSchema = z
  .object({
    result: z.object({ status: z.literal("queued") }).passthrough(),
    error: z.undefined().optional(),
  })
  .passthrough();

export interface GrokInterjectParams {
  readonly sessionId: string;
  readonly text: string;
}

export function buildGrokInterjectParams(
  params: GrokInterjectParams,
): GrokInterjectParams {
  return grokInterjectParamsSchema.parse(params);
}

export function decodeGrokInterjectResult(result: unknown): {
  readonly status: "queued";
} {
  const decoded = grokInterjectResultSchema.parse(result);
  return { status: decoded.result.status };
}
