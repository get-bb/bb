import type {
  TimelineImageViewWorkRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { fileNameFromPath } from "./timeline-path-display.js";
import {
  durationDecoration,
  filterNull,
  makeTitle,
  segment,
  statusDecoration,
} from "./timeline-title-helpers.js";
import type { TimelineTitle } from "./timeline-row-title.js";

export function mapWebSearchTitle(
  row: TimelineWebSearchWorkRow,
): TimelineTitle {
  const query = row.queries.join(", ") || "web search";
  const querySegment = segment(query, {
    em: false,
    truncate: true,
  });
  switch (row.status) {
    case "pending":
      // No live duration: the projection only sets `durationMs` at completion.
      return makeTitle({
        segments: [
          segment("Running web search:", { shimmer: true }),
          querySegment,
        ],
      });
    case "completed":
      return makeTitle({
        segments: [segment("Ran web search:"), querySegment],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "error":
      return makeTitle({
        segments: [segment("Ran web search:"), querySegment],
        decorations: [
          statusDecoration(
            "error",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    case "interrupted":
      return makeTitle({
        segments: [segment("Interrupted web search:"), querySegment],
        decorations: [
          statusDecoration(
            "interrupted",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    default:
      return assertNever(row.status);
  }
}

export function mapWebFetchTitle(row: TimelineWebFetchWorkRow): TimelineTitle {
  const urlSegment = segment(row.url, { em: false, truncate: true });
  switch (row.status) {
    case "pending":
      // No live duration: the projection only sets `durationMs` at completion.
      return makeTitle({
        segments: [segment("Fetching:", { shimmer: true }), urlSegment],
      });
    case "completed":
      return makeTitle({
        segments: [segment("Fetched:"), urlSegment],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "error":
      return makeTitle({
        segments: [segment("Fetched:"), urlSegment],
        decorations: [
          statusDecoration(
            "error",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    case "interrupted":
      return makeTitle({
        segments: [segment("Interrupted fetch:"), urlSegment],
        decorations: [
          statusDecoration(
            "interrupted",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    default:
      return assertNever(row.status);
  }
}

export function mapImageViewTitle(
  row: TimelineImageViewWorkRow,
): TimelineTitle {
  const pathSegment = segment(fileNameFromPath(row.path), {
    em: false,
    plainText: row.path,
    truncate: true,
  });
  switch (row.status) {
    case "pending":
      return makeTitle({
        segments: [segment("Viewing image:", { shimmer: true }), pathSegment],
      });
    case "completed":
      return makeTitle({
        segments: [segment("Viewed image:"), pathSegment],
        decorations: filterNull([
          durationDecoration(row.startedAt, row.completedAt),
        ]),
      });
    case "error":
      return makeTitle({
        segments: [segment("Viewed image:"), pathSegment],
        decorations: [
          statusDecoration(
            "error",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    case "interrupted":
      return makeTitle({
        segments: [segment("Interrupted image view:"), pathSegment],
        decorations: [
          statusDecoration(
            "interrupted",
            row.completedAt !== null ? row.completedAt - row.startedAt : null,
          ),
        ],
      });
    default:
      return assertNever(row.status);
  }
}
