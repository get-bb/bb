export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds < 365 * 86_400)
    return `${Math.floor(seconds / (30 * 86_400))}mo ago`;
  return `${Math.floor(seconds / (365 * 86_400))}y ago`;
}

export function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(parsed));
  } catch {
    return iso;
  }
}
