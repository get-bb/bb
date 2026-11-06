import type { ThreadEventTokenUsageBreakdown } from "@bb/domain";
import { z } from "zod";

const tokenCountSchema = z.number().int().nonnegative();

export const acpPromptUsageSchema = z
  .object({
    totalTokens: tokenCountSchema,
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    thoughtTokens: tokenCountSchema.nullish(),
    cachedReadTokens: tokenCountSchema.nullish(),
    cachedWriteTokens: tokenCountSchema.nullish(),
  })
  .passthrough();
export type AcpPromptUsage = z.infer<typeof acpPromptUsageSchema>;

export interface AcpPromptTokenUsage {
  last: ThreadEventTokenUsageBreakdown;
  total: ThreadEventTokenUsageBreakdown;
}

export function promptUsageFromResult(
  result: unknown,
): AcpPromptUsage | undefined {
  if (typeof result !== "object" || result === null || !("usage" in result)) {
    return undefined;
  }
  const parsed = acpPromptUsageSchema.safeParse(result.usage);
  return parsed.success ? parsed.data : undefined;
}

function inputIncludesCache(usage: AcpPromptUsage, cached: number): boolean {
  if (cached === 0) {
    return false;
  }
  const exclusiveTotal = usage.inputTokens + cached + usage.outputTokens;
  if (
    usage.totalTokens === exclusiveTotal ||
    usage.totalTokens === exclusiveTotal + (usage.thoughtTokens ?? 0)
  ) {
    return false;
  }
  return usage.inputTokens >= cached;
}

export function breakdownFromPromptUsage(
  usage: AcpPromptUsage,
): ThreadEventTokenUsageBreakdown {
  const cacheRead = usage.cachedReadTokens ?? 0;
  const cacheWrite = usage.cachedWriteTokens ?? 0;
  const cached = cacheRead + cacheWrite;
  const includesCache = inputIncludesCache(usage, cached);
  const uncached = includesCache
    ? Math.max(0, usage.inputTokens - cached)
    : usage.inputTokens;
  const thought = usage.thoughtTokens ?? 0;
  const totalWithoutThought =
    usage.inputTokens + usage.outputTokens + (includesCache ? 0 : cached);
  const thoughtOutsideOutput =
    usage.totalTokens === totalWithoutThought + thought;
  return {
    totalTokens: usage.totalTokens,
    inputTokens: uncached,
    cachedInputTokens: cached,
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: usage.outputTokens + (thoughtOutsideOutput ? thought : 0),
    reasoningOutputTokens: thought,
  };
}

const BREAKDOWN_FIELDS = [
  "totalTokens",
  "inputTokens",
  "cachedInputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
] as const;

export function nextPromptTokenUsage(
  previousTotal: ThreadEventTokenUsageBreakdown | null,
  usage: AcpPromptUsage,
): AcpPromptTokenUsage {
  const last = breakdownFromPromptUsage(usage);
  if (previousTotal === null) {
    return { last, total: last };
  }
  const total = { ...last };
  for (const field of BREAKDOWN_FIELDS) {
    total[field] = (previousTotal[field] ?? 0) + (last[field] ?? 0);
  }
  return { last, total };
}
