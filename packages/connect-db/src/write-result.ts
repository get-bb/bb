export function rowsChanged(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  if (
    "meta" in result &&
    typeof result.meta === "object" &&
    result.meta !== null &&
    "changes" in result.meta &&
    typeof result.meta.changes === "number"
  ) {
    return result.meta.changes;
  }
  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }
  return 0;
}
