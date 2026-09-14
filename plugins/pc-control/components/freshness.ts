export const STALE_AFTER_MS = 10_000;

export type Freshness = "fresh" | "stale";
export type ReadingState = Freshness | "error" | "measuring";

export function snapshotFreshness(
  collectedAt: string | null,
  nowMs: number,
): Freshness {
  if (collectedAt === null) return "stale";
  const collected = new Date(collectedAt).getTime();
  if (Number.isNaN(collected)) return "stale";
  return nowMs - collected >= STALE_AFTER_MS ? "stale" : "fresh";
}

export function freshnessDotClass(state: ReadingState): string {
  switch (state) {
    case "fresh":
      return "bg-emerald-500";
    case "stale":
      return "bg-warning";
    case "error":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/50";
  }
}

export function freshnessLabel(state: ReadingState): string {
  switch (state) {
    case "fresh":
      return "Актуально";
    case "stale":
      return "Данные устарели";
    case "error":
      return "Ошибка обновления";
    default:
      return "Измерение…";
  }
}
