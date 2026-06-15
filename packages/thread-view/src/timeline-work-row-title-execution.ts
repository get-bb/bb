import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { formatToolCallCommand } from "./tool-call-parsing.js";
import {
  formatTimelineActivityIntentDetailParts,
  getTimelineActivityIntentDetailDedupeKey,
  hasTimelineExplorationIntent,
  type TimelineExplorationWorkRow,
} from "./timeline-activity-intents.js";
import {
  durationDecoration,
  filterNull,
  makeTitle,
  segment,
  statusDecoration,
} from "./timeline-title-helpers.js";
import type {
  TimelineActivityIntentTitle,
  TimelineTitle,
  TimelineTitleDecoration,
  TimelineTitleSegment,
} from "./timeline-row-title.js";
import { displayWorkApprovalStatus } from "./timeline-work-row-title-shared.js";

interface BuildTimelineActivityIntentTitleArgs {
  intent: TimelineActivityIntent;
  pending: boolean;
  /**
   * When set, append a status decoration ("(error)" / "(interrupted)") after
   * the intent's title segments. The compact intent rendering used inside
   * activity bundles relies on this to surface row-level outcomes — the
   * bundle's own label only conveys an aggregate count.
   */
  failureStatus?: "error" | "interrupted";
}

type TimelineExecutionWorkRow = TimelineCommandWorkRow | TimelineToolWorkRow;

export function mapExecutionTitle(
  row: TimelineExecutionWorkRow,
): TimelineTitle {
  const explorationTitle = mapSingleExplorationIntentTitle(row);
  if (explorationTitle !== null) {
    return explorationTitle;
  }
  const status = displayWorkApprovalStatus({
    approvalStatus: row.approvalStatus,
    status: row.status,
  });
  const isCommand = row.workKind === "command";
  const content = isCommand
    ? row.command
    : formatToolCallCommand(row.toolName, row.toolArgs);
  switch (status) {
    case "waiting":
      return makeTitle({
        segments: [
          segment("Waiting for approval", { shimmer: true }),
          segment(isCommand ? "to run" : "to use"),
          segment(content, { em: true, truncate: true }),
        ],
      });
    case "denied":
      return makeTitle({
        segments: [
          segment("Permission denied:"),
          segment(content, { em: true, truncate: true }),
        ],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "pending":
      return makeTitle({
        segments: [
          segment(isCommand ? "Running" : "Running tool:", { shimmer: true }),
          segment(content, { em: true, truncate: true }),
        ],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "completed":
      return makeTitle({
        segments: [
          segment(isCommand ? "Ran" : "Ran tool"),
          segment(content, { em: true, truncate: true }),
        ],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "error":
      return makeTitle({
        segments: [
          segment(isCommand ? "Ran" : "Ran tool"),
          segment(content, { em: true, truncate: true }),
        ],
        decorations: [
          statusDecoration(
            "error",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    case "interrupted":
      return makeTitle({
        segments: [
          segment(isCommand ? "Ran" : "Ran tool"),
          segment(content, { em: true, truncate: true }),
        ],
        decorations: [
          statusDecoration(
            "interrupted",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    default:
      return assertNever(status);
  }
}

function mapSingleExplorationIntentTitle(
  row: TimelineExecutionWorkRow,
): TimelineTitle | null {
  if (!hasTimelineExplorationIntent(row)) {
    return null;
  }
  const knownIntents = row.activityIntents.filter(
    (intent) => intent.type !== "unknown",
  );
  if (knownIntents.length !== 1) {
    return null;
  }
  const intent = knownIntents[0];
  if (!intent) {
    return null;
  }
  const status = displayWorkApprovalStatus({
    approvalStatus: row.approvalStatus,
    status: row.status,
  });
  const pending = status === "pending";
  const detail = formatTimelineActivityIntentDetailParts({
    intent,
    pathMode: "compact",
    pending,
  });
  const plainDetail = formatTimelineActivityIntentDetailParts({
    intent,
    pathMode: "full",
    pending,
  });

  if (status === "denied") {
    const verbContent = detail.prefix
      ? `${detail.prefix} ${detail.content}`
      : detail.content;
    const plainVerbContent = plainDetail.prefix
      ? `${plainDetail.prefix} ${plainDetail.content}`
      : plainDetail.content;
    return makeTitle({
      segments: [
        segment("Permission denied:"),
        segment(verbContent, {
          em: true,
          truncate: true,
          plainText: plainVerbContent,
        }),
      ],
    });
  }
  if (status === "waiting") {
    const verbContent = detail.prefix
      ? `${detail.prefix} ${detail.content}`
      : detail.content;
    const plainVerbContent = plainDetail.prefix
      ? `${plainDetail.prefix} ${plainDetail.content}`
      : plainDetail.content;
    return makeTitle({
      segments: [
        segment("Waiting for approval", { shimmer: true }),
        segment("to use"),
        segment(verbContent, {
          em: true,
          truncate: true,
          plainText: plainVerbContent,
        }),
      ],
    });
  }

  const segments: TimelineTitleSegment[] = [];
  if (detail.prefix) {
    segments.push(segment(detail.prefix, { shimmer: pending }));
  }
  segments.push(
    segment(detail.content, {
      em: false,
      truncate: true,
      plainText: plainDetail.content,
    }),
  );

  const decorations: TimelineTitleDecoration[] =
    status === "error"
      ? [statusDecoration("error", null)]
      : status === "interrupted"
        ? [statusDecoration("interrupted", null)]
        : [];

  return makeTitle({ segments, decorations });
}

function mapTimelineActivityIntentTitle({
  intent,
  pending,
  failureStatus,
}: BuildTimelineActivityIntentTitleArgs): TimelineTitle {
  const detail = formatTimelineActivityIntentDetailParts({
    intent,
    pathMode: "compact",
    pending,
  });
  const plainDetail = formatTimelineActivityIntentDetailParts({
    intent,
    pathMode: "full",
    pending,
  });
  const segments: TimelineTitleSegment[] = [];
  if (detail.prefix) {
    segments.push(segment(detail.prefix, { shimmer: pending }));
  }
  segments.push(
    segment(detail.content, {
      em: false,
      truncate: true,
      plainText: plainDetail.content,
    }),
  );
  const decorations = failureStatus
    ? [statusDecoration(failureStatus, null)]
    : [];
  return makeTitle({ segments, decorations });
}

export function buildTimelineActivityIntentTitles(
  row: TimelineExplorationWorkRow,
): TimelineActivityIntentTitle[] {
  if (!hasTimelineExplorationIntent(row)) {
    return [];
  }

  let lastEmittedKey: string | null = null;
  const titles: TimelineActivityIntentTitle[] = [];
  const failureStatus =
    row.status === "error"
      ? "error"
      : row.status === "interrupted"
        ? "interrupted"
        : undefined;

  row.activityIntents.forEach((intent, index) => {
    if (intent.type === "unknown") {
      return;
    }
    const dedupeKey = getTimelineActivityIntentDetailDedupeKey(intent);
    if (dedupeKey !== null && dedupeKey === lastEmittedKey) {
      return;
    }
    titles.push({
      id: `${row.id}:activity-intent:${index}`,
      intentType: intent.type,
      title: mapTimelineActivityIntentTitle({
        intent,
        pending: row.status === "pending",
        ...(failureStatus ? { failureStatus } : {}),
      }),
    });
    lastEmittedKey = dedupeKey;
  });

  return titles;
}
