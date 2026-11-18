import { createHash } from "node:crypto";
import type { TimelineRow } from "@bb/server-contract";
import type { ThreadTimelineWindow } from "./timeline.js";

const TAG_LENGTH = 22;

export interface TimelineRowDigest {
  hash: string;
  jsonLength: number;
}

const rowDigests = new WeakMap<TimelineRow, TimelineRowDigest>();

function rowDigest(row: TimelineRow): TimelineRowDigest {
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

export function timelineRowDigests(
  rows: readonly TimelineRow[],
): TimelineRowDigest[] {
  return rows.map(rowDigest);
}

export function seedTimelineRowDigests(
  rows: readonly TimelineRow[],
  digests: readonly TimelineRowDigest[],
): void {
  if (rows.length !== digests.length) {
    throw new Error(
      `Expected ${rows.length} timeline row digests, received ${digests.length}`,
    );
  }
  rows.forEach((row, index) => {
    rowDigests.set(row, digests[index]!);
  });
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
