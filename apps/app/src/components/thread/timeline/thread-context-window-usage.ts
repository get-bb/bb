import type {
  ThreadContextWindowUsage,
  ThreadPromptCacheUsage,
} from "@bb/server-contract";

const TOKEN_COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});

export function calculateContextWindowUsagePercent(
  usage: ThreadContextWindowUsage,
): number {
  if (usage.modelContextWindow <= 0) return 0;
  const ratio = usage.usedTokens / usage.modelContextWindow;
  const clampedRatio = Math.min(Math.max(ratio, 0), 1);
  return Math.round(clampedRatio * 100);
}

export function calculatePromptCacheHitPercent(
  usage: ThreadPromptCacheUsage,
): number | null {
  if (usage.status === "unknown") return null;
  if (usage.inputTokens <= 0) {
    return usage.cachedInputTokens > 0 ? 100 : 0;
  }
  const ratio = usage.cachedInputTokens / usage.inputTokens;
  const clampedRatio = Math.min(Math.max(ratio, 0), 1);
  return Math.round(clampedRatio * 100);
}

export function formatCompactTokenCount(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  return TOKEN_COMPACT_FORMATTER.format(safeValue).toLowerCase();
}

export function formatTokenCount(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  return safeValue.toLocaleString("en-US");
}
