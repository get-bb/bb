import type {
  ThreadEventTokenUsageBreakdown,
  ThreadUsageCost,
} from "@bb/domain";
import { z } from "zod";

const nonnegativeMetric = z.number().int().nonnegative().optional();
const metricsSchema: z.ZodType<GrokUsageMetrics> = z
  .object({
    inputTokens: nonnegativeMetric,
    outputTokens: nonnegativeMetric,
    totalTokens: nonnegativeMetric,
    cachedReadTokens: nonnegativeMetric,
    cacheCreationTokens: nonnegativeMetric,
    reasoningTokens: nonnegativeMetric,
    modelCalls: nonnegativeMetric,
    apiDurationMs: nonnegativeMetric,
    costUsdTicks: nonnegativeMetric,
    modelUsage: z
      .record(
        z.string(),
        z.lazy(() => metricsSchema),
      )
      .optional(),
    numTurns: z.number().int().positive().optional(),
  })
  .passthrough();

const promptResultSchema = z
  .object({
    _meta: z
      .object({ usage: metricsSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface GrokUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  apiDurationMs?: number;
  costUsdTicks?: number;
  modelUsage?: Record<string, GrokUsageMetrics>;
  numTurns?: number;
}

export function decodeGrokPromptUsage(result: unknown): {
  metrics: GrokUsageMetrics;
  models: { modelId: string; metrics: GrokUsageMetrics }[];
} {
  const parsed = promptResultSchema.parse(result);
  const metrics = parsed._meta?.usage ?? {};
  const {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    modelCalls,
    apiDurationMs,
    costUsdTicks,
    numTurns,
  } = metrics;
  return {
    metrics: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(cachedReadTokens === undefined ? {} : { cachedReadTokens }),
      ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
      ...(modelCalls === undefined ? {} : { modelCalls }),
      ...(apiDurationMs === undefined ? {} : { apiDurationMs }),
      ...(costUsdTicks === undefined ? {} : { costUsdTicks }),
      ...(numTurns === undefined ? {} : { numTurns }),
    },
    models: Object.entries(metrics.modelUsage ?? {}).map(
      ([modelId, modelMetrics]) => ({
        modelId,
        metrics: {
          ...(modelMetrics.inputTokens === undefined
            ? {}
            : { inputTokens: modelMetrics.inputTokens }),
          ...(modelMetrics.outputTokens === undefined
            ? {}
            : { outputTokens: modelMetrics.outputTokens }),
          ...(modelMetrics.totalTokens === undefined
            ? {}
            : { totalTokens: modelMetrics.totalTokens }),
          ...(modelMetrics.cachedReadTokens === undefined
            ? {}
            : { cachedReadTokens: modelMetrics.cachedReadTokens }),
          ...(modelMetrics.cacheCreationTokens === undefined
            ? {}
            : { cacheCreationTokens: modelMetrics.cacheCreationTokens }),
          ...(modelMetrics.reasoningTokens === undefined
            ? {}
            : { reasoningTokens: modelMetrics.reasoningTokens }),
          ...(modelMetrics.modelCalls === undefined
            ? {}
            : { modelCalls: modelMetrics.modelCalls }),
          ...(modelMetrics.apiDurationMs === undefined
            ? {}
            : { apiDurationMs: modelMetrics.apiDurationMs }),
          ...(modelMetrics.costUsdTicks === undefined
            ? {}
            : { costUsdTicks: modelMetrics.costUsdTicks }),
          ...(modelMetrics.numTurns === undefined
            ? {}
            : { numTurns: modelMetrics.numTurns }),
        },
      }),
    ),
  };
}

export function grokUsageCostFromMetrics(
  metrics: GrokUsageMetrics,
): ThreadUsageCost | undefined {
  return metrics.costUsdTicks === undefined
    ? undefined
    : { amount: metrics.costUsdTicks / 1_000_000_000, currency: "USD" };
}

export function grokTokenUsageBreakdownFromMetrics(
  metrics: GrokUsageMetrics,
): ThreadEventTokenUsageBreakdown | null {
  if (
    metrics.totalTokens === undefined ||
    metrics.inputTokens === undefined ||
    metrics.cachedReadTokens === undefined ||
    metrics.cacheCreationTokens === undefined ||
    metrics.outputTokens === undefined ||
    metrics.reasoningTokens === undefined
  ) {
    return null;
  }
  return {
    totalTokens: metrics.totalTokens,
    inputTokens: metrics.inputTokens,
    cachedInputTokens: metrics.cachedReadTokens,
    cacheReadInputTokens: metrics.cachedReadTokens,
    cacheWriteInputTokens: metrics.cacheCreationTokens,
    outputTokens: metrics.outputTokens,
    reasoningOutputTokens: metrics.reasoningTokens,
  };
}
