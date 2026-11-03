import { createHash } from "node:crypto";
import type { TimelineRow } from "@bb/server-contract";
import type { ThreadTimelineWindow } from "./timeline.js";

const TAG_LENGTH = 22;

interface RowDigest {
  hash: string;
  jsonLength: number;
}

const rowDigests = new WeakMap<TimelineRow, RowDigest>();

function rowDigest(row: TimelineRow): RowDigest {
  const cached = rowDigests.get(row);
  if (cached !== undefined) {
    return cached;
  }
  const json = JSON.stringify(row);
  const digest = {
    hash: createHash("sha256").update(json).digest("base64url"),
    jsonLength: json.length,
  };
  rowDigests.set(row, digest);
  return digest;
}

export function timelineRowHash(row: TimelineRow): string {
  return rowDigest(row).hash;
}

export function timelineWindowTag(window: ThreadTimelineWindow): string {
  const { rows, ...fields } = window;
  const hash = createHash("sha256").update(JSON.stringify(fields));
  for (const row of rows) {
    hash.update(rowDigest(row).hash);
  }
  return hash.digest("base64url").slice(0, TAG_LENGTH);
}

export function timelineWindowJsonLength(window: ThreadTimelineWindow): number {
  const { rows, ...fields } = window;
  let length = JSON.stringify(fields).length;
  for (const row of rows) {
    length += rowDigest(row).jsonLength + 1;
  }
  return length;
}
