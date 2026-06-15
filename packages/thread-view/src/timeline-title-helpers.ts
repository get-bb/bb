import type { TimelineFileChange } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  durationToCompactString,
  formatDiffStatsText,
} from "./format-helpers.js";
import type {
  TimelineStatusDecorationStatus,
  TimelineTitle,
  TimelineTitleAction,
  TimelineTitleDecoration,
  TimelineTitleLink,
  TimelineTitleSegment,
  TimelineTitleSegmentAccent,
  TimelineTitleTone,
} from "./timeline-row-title.js";

interface SegmentOptions {
  em?: boolean;
  shimmer?: boolean;
  truncate?: boolean;
  plainText?: string;
  link?: TimelineTitleLink;
  accent?: TimelineTitleSegmentAccent;
}

interface DurationDecorationOptions {
  em?: boolean;
}

interface StatusDecorationOptions {
  emphasis?: boolean;
}

interface MakeTitleArgs {
  segments: TimelineTitleSegment[];
  decorations?: TimelineTitleDecoration[];
  tone?: TimelineTitleTone;
  action?: TimelineTitleAction | null;
}

// Titles are always rendered on a single line — both in the App (segments
// use `whitespace-pre`, which would otherwise honor `\n` as a line break)
// and in the CLI/tooltip plain text. Normalizing newlines at segment
// construction means any caller that passes user-supplied content
// (commands, tool labels, file paths) gets single-line rendering for free,
// without each call site having to remember to sanitize.
function collapseTitleNewlines(text: string): string {
  return text.replace(/[\r\n]+/gu, " ");
}

export function segment(
  text: string,
  opts: SegmentOptions = {},
): TimelineTitleSegment {
  return {
    text: collapseTitleNewlines(text),
    em: opts.em ?? false,
    shimmer: opts.shimmer ?? false,
    truncate: opts.truncate ?? false,
    ...(opts.plainText !== undefined
      ? { plainText: collapseTitleNewlines(opts.plainText) }
      : {}),
    ...(opts.link !== undefined ? { link: opts.link } : {}),
    ...(opts.accent !== undefined ? { accent: opts.accent } : {}),
  };
}

export function filterNull<T>(values: (T | null)[]): T[] {
  return values.filter((v): v is T => v !== null);
}

function visibleDurationMs(durationMs: number | null): number | null {
  return durationMs !== null && durationMs > 1_000 ? durationMs : null;
}

/**
 * Most below-threshold elapsed durations don't render — sub-second flickers
 * would be noisy for active rows and too much detail for small work rows.
 */
export function durationDecoration(
  startedAt: number,
  completedAt: number | null,
  options: DurationDecorationOptions = {},
): TimelineTitleDecoration | null {
  if (completedAt !== null) {
    const finalMs = completedAt - startedAt;
    if (visibleDurationMs(finalMs) === null) return null;
  }
  return {
    kind: "duration",
    startedAt,
    completedAt,
    em: options.em ?? false,
  };
}

export function completedTurnDurationDecoration(
  startedAt: number,
  completedAt: number | null,
): TimelineTitleDecoration | null {
  if (completedAt === null) return null;
  return {
    kind: "duration",
    startedAt,
    completedAt,
    // A completed turn is a recap — the duration renders muted (not emphasized
    // foreground) so the "Worked for …" header sits a step quieter.
    em: false,
  };
}

export function statusDecoration(
  status: TimelineStatusDecorationStatus,
  durationMs: number | null,
  options: StatusDecorationOptions = {},
): TimelineTitleDecoration {
  return {
    kind: "status",
    status,
    durationMs: visibleDurationMs(durationMs),
    emphasis: options.emphasis ?? false,
  };
}

export function diffStatsDecoration(
  change: TimelineFileChange,
): TimelineTitleDecoration | null {
  const { added, removed } = change.diffStats;
  if (added === 0 && removed === 0) {
    return null;
  }
  return { kind: "diff-stats", added, removed };
}

/**
 * Canonical text rendering for a decoration. Used by the CLI plain renderer
 * directly and by the App renderer when it falls back to a plain text node
 * (App may also render structured spans for tone/styling).
 */
export function formatTimelineDecorationText(
  d: TimelineTitleDecoration,
): string {
  switch (d.kind) {
    case "duration": {
      // CLI is a static snapshot; pending rows have no captured end yet,
      // so we omit the duration entirely rather than print a placeholder
      // or a sub-second number.
      if (d.completedAt === null) return "";
      return `(${durationToCompactString(d.completedAt - d.startedAt)})`;
    }
    case "status":
      return d.durationMs !== null
        ? `(${durationToCompactString(d.durationMs)}, ${d.status})`
        : `(${d.status})`;
    case "summary-status": {
      const parts: string[] = [];
      if (d.errorCount > 0) {
        parts.push(
          `${d.errorCount} error${d.errorCount > 1 ? "s" : ""}`,
        );
      }
      if (d.interruptedCount > 0) {
        parts.push(`${d.interruptedCount} interrupted`);
      }
      return parts.length === 0 ? "" : `(${parts.join(", ")})`;
    }
    case "diff-stats":
      return formatDiffStatsText({
        added: d.added,
        removed: d.removed,
        hideZero: true,
      });
    default:
      return assertNever(d);
  }
}

export function renderTitlePlain(
  segments: readonly TimelineTitleSegment[],
  decorations: readonly TimelineTitleDecoration[],
): string {
  const segmentsText = segments
    .map((s) => s.plainText ?? s.text)
    .filter((t) => t.length > 0)
    .join(" ");
  const decorationsText = decorations
    .map(formatTimelineDecorationText)
    .filter((t) => t.length > 0)
    .join(" ");
  if (decorationsText.length === 0) return segmentsText;
  if (segmentsText.length === 0) return decorationsText;
  return `${segmentsText} ${decorationsText}`;
}

export function makeTitle({
  segments,
  decorations = [],
  tone = "default",
  action = null,
}: MakeTitleArgs): TimelineTitle {
  return {
    segments,
    decorations,
    tone,
    action,
    plain: renderTitlePlain(segments, decorations),
  };
}
