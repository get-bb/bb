export interface UsageSnapshot {
  spentMicros: number;
  limitMicros: number;
  resetsAt: number;
}

export function formatDollars(micros: number): string {
  if (micros > 0 && micros < 10_000) return "<$0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function formatResetTime(resetsAt: number): string {
  return new Date(resetsAt).toISOString().slice(11, 16);
}

export function formatUsage(usage: UsageSnapshot): string {
  return `${formatDollars(usage.spentMicros)} of ${formatDollars(usage.limitMicros)} today, resets ${formatResetTime(usage.resetsAt)} UTC`;
}
