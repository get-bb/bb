import { randomUUID } from "node:crypto";
import {
  getLapsedResumeActivity,
  getLapsedResumeLastOpenAt,
  getLastUnfinishedThread,
  listWhileAwayThreads,
  recordLapsedResumeOpen,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import type { SystemLapsedResumeResponse } from "@bb/server-contract";

const LAPSE_DURATION_MS = 14 * 24 * 60 * 60 * 1_000;
const WHILE_AWAY_LIMIT = 8;

function readLapsedResume(
  db: DbQueryConnection,
  now: number,
): SystemLapsedResumeResponse {
  const activity = getLapsedResumeActivity(db);
  const lastOpenAt = getLapsedResumeLastOpenAt(db);
  const lastActivityAt =
    activity.lastActivityAt === null
      ? null
      : Math.max(activity.lastActivityAt, lastOpenAt ?? 0);
  const lapsed =
    lastActivityAt !== null && now - lastActivityAt >= LAPSE_DURATION_MS;
  if (!lapsed) {
    return {
      lapsed: false,
      lastActivityAt,
      target: null,
      threads: [],
      suggestionAnalyticsId: null,
    };
  }

  return {
    lapsed: true,
    lastActivityAt,
    target: getLastUnfinishedThread(db, now),
    threads: listWhileAwayThreads(db, {
      since: Math.max(activity.lastPresenceAt ?? 0, lastOpenAt ?? 0),
      now,
      limit: WHILE_AWAY_LIMIT,
    }),
    suggestionAnalyticsId: null,
  };
}

export function getSystemLapsedResume(
  db: DbConnection,
  now = Date.now(),
): SystemLapsedResumeResponse {
  return db.transaction((tx) => readLapsedResume(tx, now));
}

export function openSystemLapsedResume(
  db: DbConnection,
  now = Date.now(),
): SystemLapsedResumeResponse {
  return db.transaction(
    (tx) => {
      const state = readLapsedResume(tx, now);
      recordLapsedResumeOpen(tx, now);
      return {
        ...state,
        suggestionAnalyticsId:
          state.lapsed && state.target !== null ? randomUUID() : null,
      };
    },
    { behavior: "immediate" },
  );
}
