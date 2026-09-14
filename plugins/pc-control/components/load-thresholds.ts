export const LOAD_THRESHOLDS = {
  warningPercent: 85,
  criticalPercent: 95,
} as const;

export type LoadLevel = "normal" | "warning" | "critical";

export function loadLevel(percent: number | null): LoadLevel {
  if (percent === null) return "normal";
  if (percent >= LOAD_THRESHOLDS.criticalPercent) return "critical";
  if (percent >= LOAD_THRESHOLDS.warningPercent) return "warning";
  return "normal";
}

export function levelStrokeClass(level: LoadLevel): string {
  if (level === "critical") return "stroke-destructive";
  if (level === "warning") return "stroke-warning";
  return "stroke-primary";
}

export function levelBarClass(level: LoadLevel): string {
  if (level === "critical") return "bg-destructive";
  if (level === "warning") return "bg-warning";
  return "bg-primary";
}
