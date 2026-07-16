import { useEffect, useState } from "react";

/** "just now" / "4m ago" / "3h ago" / "2d ago" — matches the mock's cadence. */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((nowMs - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface SystemBodySegment {
  text: string;
  bold: boolean;
}

/**
 * Splits a system-event body so the actor name renders bold-ish. Server
 * system comments end with "by <authorName>" ("Status changed to Done by
 * You"); anything else renders as one plain segment.
 */
export function splitSystemBody(
  body: string,
  authorName: string,
): SystemBodySegment[] {
  const suffix = `by ${authorName}`;
  if (authorName.trim() !== "" && body.endsWith(suffix)) {
    const prefix = body.slice(0, body.length - authorName.length);
    return [
      { text: prefix, bold: false },
      { text: authorName, bold: true },
    ];
  }
  return [{ text: body, bold: false }];
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Current time that re-renders every `intervalMs` so relative timestamps
 * tick. Ticks are skipped while a contenteditable is focused so a re-render
 * never disturbs an in-progress comment draft.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
