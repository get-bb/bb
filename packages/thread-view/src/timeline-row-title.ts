import type {
  TimelineParentChangeSystemRow,
  TimelineRowStatus,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  completedTurnDurationDecoration,
  durationDecoration,
  filterNull,
  makeTitle,
  segment,
  statusDecoration,
} from "./timeline-title-helpers.js";
import {
  buildTimelineWorkSummaryLabelParts,
  type ThreadTimelineViewRow,
  type TimelineWorkSummaryRow,
  type TimelineViewTurnRow,
} from "./timeline-view.js";
import { mapWorkTitle } from "./timeline-work-row-title.js";

export {
  formatTimelineDecorationText,
  renderTitlePlain,
} from "./timeline-title-helpers.js";
export { buildTimelineActivityIntentTitles } from "./timeline-work-row-title.js";

export type TimelineTitleTone = "default" | "summary";
export type TimelineStatusDecorationStatus =
  | "denied"
  | "error"
  | "interrupted";

/**
 * Optional link target attached to a title segment. Renderers that support
 * navigation (the App) can wrap the segment in a link; CLI renderers ignore
 * the link and render the segment text directly.
 */
export type TimelineTitleLink = { kind: "thread"; threadId: string };

/**
 * One slice of the title's text. Renderers walk the segment list and apply
 * `em`/`shimmer`/`truncate` per slice. There is no implicit "prefix vs content"
 * positional meaning — segment order is the only positional cue.
 */
/**
 * Optional per-segment color intent. App renderers map this to a token; CLI /
 * plain renderers ignore it. `muted`/`subtle` step a segment down the neutral
 * text ramp (lighter); `file` tints file-path segments with the file accent.
 */
export type TimelineTitleSegmentAccent = "muted" | "subtle" | "file";

export interface TimelineTitleSegment {
  text: string;
  /** Optional plain-text override for CLI rendering. Defaults to `text`. */
  plainText?: string;
  em: boolean;
  shimmer: boolean;
  truncate: boolean;
  accent?: TimelineTitleSegmentAccent;
  /**
   * Optional navigation target. App renderers wrap the segment in a link;
   * CLI/plain renderers ignore this field.
   */
  link?: TimelineTitleLink;
}

export type TimelineTitleDecoration =
  | {
      kind: "duration";
      /** Wall-clock millis when the work began. */
      startedAt: number;
      /**
       * Wall-clock millis when the work reached a terminal status. `null`
       * while pending; renderers derive elapsed from `now - startedAt` and
       * tick locally. When non-null the decoration renders statically as
       * `completedAt - startedAt`.
       */
      completedAt: number | null;
      /** Render with title-emphasis tone instead of the default muted decoration tone. */
      em: boolean;
    }
  | {
      kind: "status";
      status: TimelineStatusDecorationStatus;
      durationMs: number | null;
      /**
       * Whether this status is the row's primary signal and should be colored
       * (system error rows) rather than rendered as a muted annotation next to
       * a work row's content (a failed command, an interrupted fetch). Only
       * emphasized error statuses pick up the destructive color.
       */
      emphasis: boolean;
    }
  | {
      kind: "summary-status";
      errorCount: number;
      interruptedCount: number;
    }
  | { kind: "diff-stats"; added: number; removed: number };

/**
 * Describes what the title's content semantically represents when it's also an
 * actionable target (e.g. a file path that the consumer can open). Renderers
 * decide whether to surface the action; the title-builder only declares what's
 * available. New action kinds extend this union.
 */
export type TimelineTitleAction = {
  kind: "open-file-diff";
  /** Workspace-relative path of the file. For renames, the destination path. */
  path: string;
};

export interface TimelineTitle {
  segments: TimelineTitleSegment[];
  decorations: TimelineTitleDecoration[];
  tone: TimelineTitleTone;
  action: TimelineTitleAction | null;
  /** CLI plain rendering — segments + decorations joined per `renderTitlePlain`. */
  plain: string;
}

export interface BuildTimelineRowTitleOptions {
  summaryStyle: "bundle" | "background";
  workStyle: "default" | "summary";
  /**
   * Whether this row is the open step's currently-active bundle. Determined by
   * the list-level renderer that walks the row sequence; only bundles that are
   * the latest bundle-summary in the trailing open step set this to `true`.
   * Defaults to `false` so non-bundle rows and displaced bundles render past.
   */
  isActiveLatestBundle?: boolean;
}

export interface TimelineActivityIntentTitle {
  id: string;
  title: TimelineTitle;
  /** The exploration kind, so renderers can pick a per-intent leading glyph. */
  intentType: "read" | "list_files" | "search";
}

type TimelineSystemViewRow = Extract<ThreadTimelineViewRow, { kind: "system" }>;
type TimelineConversationViewRow = Extract<
  ThreadTimelineViewRow,
  { kind: "conversation" }
>;

function summaryStatusDecoration(
  row: TimelineWorkSummaryRow,
): TimelineTitleDecoration | null {
  let errorCount = 0;
  let interruptedCount = 0;
  for (const child of row.children) {
    if (child.status === "error") errorCount += 1;
    if (child.status === "interrupted") interruptedCount += 1;
  }
  if (errorCount === 0 && interruptedCount === 0) {
    return null;
  }
  return { kind: "summary-status", errorCount, interruptedCount };
}

function mapWorkSummaryTitle(
  row: TimelineWorkSummaryRow,
  options: BuildTimelineRowTitleOptions,
): TimelineTitle {
  // Bundles only render with active/present-tense treatment when the caller
  // (a list-level renderer) tells us this is the open step's latest bundle.
  const isActive =
    row.kind === "bundle-summary" && options.isActiveLatestBundle === true;
  const { verb, rest } = buildTimelineWorkSummaryLabelParts(row, {
    active: isActive,
  });
  const decorations = filterNull([summaryStatusDecoration(row)]);
  if (options.summaryStyle === "background") {
    const labelText = rest.length === 0 ? verb : `${verb} ${rest}`;
    return makeTitle({
      segments: [segment(labelText, { em: false, truncate: true })],
      decorations,
      tone: "summary",
    });
  }
  // Bundle summaryStyle: a settled recap (e.g. "Explored 3 files") recedes two
  // steps down the ramp so it reads as background; an active-latest bundle keeps
  // full contrast + shimmer as the frontier tell.
  const settledAccent: TimelineTitleSegmentAccent | undefined = isActive
    ? undefined
    : "subtle";
  const verbSegment = segment(verb, {
    shimmer: isActive,
    accent: settledAccent,
  });
  if (rest.length === 0) {
    return makeTitle({
      segments: [{ ...verbSegment, truncate: true }],
      decorations,
    });
  }
  return makeTitle({
    segments: [
      verbSegment,
      segment(rest, { em: true, truncate: true, accent: settledAccent }),
    ],
    decorations,
  });
}

function mapTurnTitle(row: TimelineViewTurnRow): TimelineTitle {
  const isPending = row.status === "pending";
  const durationDeco = isPending
    ? durationDecoration(row.startedAt, row.completedAt, { em: true })
    : completedTurnDurationDecoration(row.startedAt, row.completedAt);
  const hasCapturedDuration =
    !isPending && row.completedAt !== null && durationDeco !== null;
  if (hasCapturedDuration) {
    // Completed turn with a visible captured duration: "Worked for (8m 14s)".
    // The whole header sits one step down the ramp — it's a recap, not active
    // work — so the verb is subtle and the duration renders muted (see
    // completedTurnDurationDecoration: em=false).
    return makeTitle({
      segments: [segment("Worked for", { shimmer: false, accent: "subtle" })],
      decorations: [durationDeco],
    });
  }
  return makeTitle({
    segments: [
      segment(isPending ? "Working" : "Worked", {
        shimmer: isPending,
        accent: isPending ? undefined : "subtle",
      }),
    ],
    // Pending rows still emit the decoration so the App's `LiveDurationText`
    // can tick locally; CLI formatters return "" for pending and
    // `renderTitlePlain` filters that out.
    decorations: isPending && durationDeco !== null ? [durationDeco] : [],
  });
}

function parentLinkSegment(
  threadId: string | null,
  title: string | null,
): TimelineTitleSegment | null {
  if (threadId === null) {
    return null;
  }
  return segment(title ?? threadId, {
    em: true,
    truncate: true,
    link: { kind: "thread", threadId },
  });
}

interface ParentChangeVerbs {
  assign: string;
  release: string;
  transferFrom: string;
  transferTo: string;
}

function parentChangeVerbs(
  status: TimelineRowStatus,
): ParentChangeVerbs {
  switch (status) {
    case "completed":
    case "error":
    case "interrupted":
      // Past-tense verb shared across terminal statuses; status decoration
      // ("(failed)" / "(interrupted)") differentiates the outcome.
      return {
        assign: "Thread assigned to",
        release: "Thread unassigned from",
        transferFrom: "Thread reassigned from",
        transferTo: "to",
      };
    case "pending":
      return {
        assign: "Assigning thread to",
        release: "Releasing thread from",
        transferFrom: "Reassigning thread from",
        transferTo: "to",
      };
    default:
      return assertNever(status);
  }
}

function mapParentChangeSystemTitle(
  row: TimelineParentChangeSystemRow,
): TimelineTitle {
  const assignment = row.parentChange;
  const linkPrev = parentLinkSegment(
    assignment.previousParentThreadId,
    assignment.previousParentThreadTitle,
  );
  const linkNext = parentLinkSegment(
    assignment.nextParentThreadId,
    assignment.nextParentThreadTitle,
  );
  const shimmer = row.status === "pending";
  const verbs = parentChangeVerbs(row.status);

  const segments: TimelineTitleSegment[] = (() => {
    switch (assignment.action) {
      case "assign":
        return filterNull([segment(verbs.assign, { shimmer }), linkNext]);
      case "release":
        return filterNull([segment(verbs.release, { shimmer }), linkPrev]);
      case "transfer":
        return filterNull([
          segment(verbs.transferFrom, { shimmer }),
          linkPrev,
          linkNext !== null ? segment(verbs.transferTo, { shimmer }) : null,
          linkNext,
        ]);
      default:
        return assertNever(assignment.action);
    }
  })();

  const decorations: TimelineTitleDecoration[] = (() => {
    switch (row.status) {
      case "error":
        return [statusDecoration("error", null, { emphasis: true })];
      case "interrupted":
        return [statusDecoration("interrupted", null)];
      case "pending":
      case "completed":
        return [];
      default:
        return assertNever(row.status);
    }
  })();

  return makeTitle({
    segments,
    decorations,
  });
}

function mapSystemTitle(row: TimelineSystemViewRow): TimelineTitle {
  const hasError = row.systemKind === "error" || row.status === "error";
  if (
    row.systemKind === "operation" &&
    row.operationKind === "parent-change"
  ) {
    return mapParentChangeSystemTitle(row);
  }
  const isCompaction =
    row.systemKind === "operation" && row.operationKind === "compaction";
  const titleText =
    isCompaction && row.status === "pending" ? `${row.title}…` : row.title;
  // Error system rows read like every other terminal row: a neutral title plus
  // a status decoration that carries the error color (see TimelineTitleView).
  // They no longer recolor the whole title — full-destructive tone was unique
  // among timeline rows and made error rows shout relative to their peers.
  const decorations: TimelineTitleDecoration[] = hasError
    ? [statusDecoration("error", null, { emphasis: true })]
    : isCompaction && (row.status === "pending" || row.status === "completed")
      ? filterNull([durationDecoration(row.startedAt, row.completedAt)])
      : [];
  // Shimmer means "in progress right now" — true only for pending rows. Only
  // operations (provisioning, compaction) ever reach this branch with a pending
  // status; error rows are terminal and reconnect rows carry no status, so this
  // uniform rule leaves both static.
  return makeTitle({
    segments: [
      segment(titleText, { shimmer: row.status === "pending", truncate: true }),
    ],
    decorations,
  });
}

function mapConversationTitle(
  row: TimelineConversationViewRow,
): TimelineTitle {
  return makeTitle({
    segments: [
      segment(row.role === "user" ? "User" : "Assistant", { em: false }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

function isUserConversationRow(row: ThreadTimelineViewRow): boolean {
  return row.kind === "conversation" && row.role === "user";
}

/**
 * Returns the trailing row of `rows` for auto-expand and active-latest bundle
 * styling. User-role conversation rows are transparent: they are *requests*
 * to the agent rather than events the agent produced, so a user message at
 * the tail (initial message, follow-up, pending steer, accepted steer) does
 * not displace the previous frontier of activity.
 */
export function findTimelineFrontierRow(
  rows: readonly ThreadTimelineViewRow[],
): ThreadTimelineViewRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;
    if (isUserConversationRow(row)) continue;
    return row;
  }
  return null;
}

/**
 * Returns the `id` of the trailing bundle-summary in `rows`, or `null` if the
 * trailing row is anything else. Callers pair this with a scope-active gate:
 * in active scopes (top-level when the thread is active, delegation childRows
 * when the delegation is pending), this id receives present-tense
 * "Exploring/Running" treatment. We do not search backward past a non-bundle
 * trailing row — a non-bundle tail means no bundle is currently the frontier
 * of activity. User-role conversation rows are skipped because they are
 * inputs to the agent, not events on the activity timeline.
 */
export function findActiveLatestBundleId(
  rows: readonly ThreadTimelineViewRow[],
): string | null {
  const frontier = findTimelineFrontierRow(rows);
  return frontier?.kind === "bundle-summary" ? frontier.id : null;
}

export function buildTimelineRowTitle(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowTitleOptions,
): TimelineTitle {
  switch (row.kind) {
    case "conversation":
      return mapConversationTitle(row);
    case "system":
      return mapSystemTitle(row);
    case "work":
      return mapWorkTitle(row, options);
    case "bundle-summary":
    case "step-summary":
      return mapWorkSummaryTitle(row, options);
    case "turn":
      return mapTurnTitle(row);
    default:
      return assertNever(row);
  }
}
