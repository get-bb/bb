let streamTraceEnabled = false;

export function setStreamTraceEnabled(enabled: boolean): void {
  streamTraceEnabled = enabled;
}

export function markStreamTrace(
  name: "bb:timeline-applied" | "bb:stream-row-commit",
  detail: Record<string, number | string | null>,
): void {
  if (streamTraceEnabled) {
    performance.mark(name, { detail });
  }
}
