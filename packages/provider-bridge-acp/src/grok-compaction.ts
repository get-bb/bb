import { z } from "zod";

const startedSchema = z
  .object({
    sessionUpdate: z.literal("auto_compact_started"),
    tokens_used: z.number().int().nonnegative(),
    context_window: z.number().int().positive(),
    percentage: z.number().nonnegative(),
    reason: z.string().optional(),
  })
  .passthrough();

const completedSchema = z
  .object({
    sessionUpdate: z.literal("auto_compact_completed"),
    tokens_before: z.number().int().nonnegative(),
    tokens_after: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative(),
    summary_preview: z.string().nullable().optional(),
  })
  .passthrough();

export type GrokCompactionNotification =
  | {
      kind: "started";
      tokensUsed: number;
      contextWindow: number;
      percentage: number;
      reason?: string;
    }
  | {
      kind: "completed";
      tokensBefore: number;
      tokensAfter: number;
      elapsedMs: number;
      summaryPreview?: string | null;
    };

export function decodeGrokCompactionNotification(
  update: unknown,
): GrokCompactionNotification | null {
  const kind = z
    .enum(["auto_compact_started", "auto_compact_completed"])
    .safeParse(
      typeof update === "object" && update !== null
        ? Reflect.get(update, "sessionUpdate")
        : undefined,
    );
  if (!kind.success) return null;
  if (kind.data === "auto_compact_started") {
    const parsed = startedSchema.parse(update);
    return {
      kind: "started",
      tokensUsed: parsed.tokens_used,
      contextWindow: parsed.context_window,
      percentage: parsed.percentage,
      ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
    };
  }
  const parsed = completedSchema.parse(update);
  return {
    kind: "completed",
    tokensBefore: parsed.tokens_before,
    tokensAfter: parsed.tokens_after,
    elapsedMs: parsed.elapsed_ms,
    summaryPreview: parsed.summary_preview,
  };
}
