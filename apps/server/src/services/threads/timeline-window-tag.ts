import { createHash } from "node:crypto";
import type { TimelineRow } from "@bb/server-contract";
import type { ThreadTimelineWindow } from "./timeline.js";

const TAG_LENGTH = 22;

const rowHashes = new WeakMap<TimelineRow, string>();

export function timelineRowHash(row: TimelineRow): string {
  const cached = rowHashes.get(row);
  if (cached !== undefined) {
    return cached;
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(row))
    .digest("base64url");
  rowHashes.set(row, hash);
  return hash;
}

export function timelineWindowTag(window: ThreadTimelineWindow): string {
  const { rows, ...fields } = window;
  const hash = createHash("sha256").update(JSON.stringify(fields));
  for (const row of rows) {
    hash.update(timelineRowHash(row));
  }
  return hash.digest("base64url").slice(0, TAG_LENGTH);
}
