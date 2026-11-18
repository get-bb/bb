import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Thread } from "@bb/domain";
import {
  advanceThreadPruning,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
} from "@bb/db";
import {
  buildThreadConversationOutline,
  loadThreadConversationOutline,
} from "../../src/services/threads/timeline.js";
import {
  createRandom,
  pick,
  randomInteger,
  withTestThread,
} from "../helpers/timeline-cache-fixture.js";

const SOURCE_DB = process.env.BB_TIMELINE_HISTORY_DB;
const THREAD_FILTER = process.env.BB_TIMELINE_HISTORY_THREADS?.split(",");
const LARGEST_THREADS = 5;
const STATUSES: readonly Thread["status"][] = [
  "active",
  "idle",
  "error",
  "stopping",
  "pending",
  "starting",
];
const OPTIONS = {
  completedTurnDisplay: "collapse",
  includeClearedContextHistory: false,
} as const;

function copyDatabase(source: string, directory: string): string {
  const target = join(directory, "bb.db");
  const sourceDb = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    sourceDb.prepare("VACUUM INTO ?").run(target);
  } finally {
    sourceDb.close();
  }
  return target;
}

function largestThreadIds(source: Database.Database): string[] {
  return source
    .prepare<[number], { threadId: string }>(
      "SELECT thread_id AS threadId FROM events GROUP BY thread_id ORDER BY count(*) DESC LIMIT ?",
    )
    .all(LARGEST_THREADS)
    .map((row) => row.threadId);
}

function replayThread(sourcePath: string, sourceThreadId: string): string[] {
  const mismatches: string[] = [];
  const random = createRandom(sourceThreadId.length * 7919);
  withTestThread((testThread) => {
    const threadId = testThread.thread.id;
    const connections = [testThread.db, testThread.coldDb] as const;
    for (const connection of connections)
      connection.$client.prepare("ATTACH DATABASE ? AS source").run(sourcePath);
    const sourceMax =
      testThread.db.$client
        .prepare<[string], { sequence: number | null }>(
          "SELECT max(sequence) AS sequence FROM source.events WHERE thread_id = ?",
        )
        .get(sourceThreadId)?.sequence ?? 0;
    let current = 0;
    let copiedThrough = 0;
    for (let step = 0; copiedThrough < sourceMax; step += 1) {
      const through =
        connections[current].$client
          .prepare<[string, number, number], { sequence: number | null }>(
            `SELECT max(sequence) AS sequence FROM (
              SELECT sequence FROM source.events
              WHERE thread_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
            )`,
          )
          .get(sourceThreadId, copiedThrough, randomInteger(random, 1, 600))
          ?.sequence ?? sourceMax;
      connections[current].$client
        .prepare(
          `INSERT INTO events (id, thread_id, environment_id, scope_kind, turn_id,
            provider_thread_id, sequence, type, item_id, item_kind, data, created_at,
            parent_tool_call_id)
          SELECT id, ?, NULL, scope_kind, turn_id, provider_thread_id, sequence, type,
            item_id, item_kind, data, created_at, parent_tool_call_id
          FROM source.events
          WHERE thread_id = ? AND sequence > ? AND sequence <= ?
          ORDER BY sequence`,
        )
        .run(threadId, sourceThreadId, copiedThrough, through);
      copiedThrough = through;
      if (step % 7 === 6) {
        for (let pass = 0; pass < 4; pass += 1)
          advanceThreadPruning(connections[current], { threadId });
      }
      if (step % 11 === 10) current = 1 - current;
      const thread: Thread = {
        ...testThread.thread,
        status: pick(random, STATUSES),
      };
      const db = connections[current];
      const maxSeq = getLatestThreadSequence(db, { threadId });
      const incremental = loadThreadConversationOutline(db, thread, {
        ...OPTIONS,
        maxSeq,
        outlineSequence: getLatestStoredConversationOutlineSequence(db, {
          threadId,
        }),
      });
      const full = buildThreadConversationOutline(
        connections[1 - current],
        thread,
        { ...OPTIONS, maxSeq },
      );
      try {
        expect(incremental).toEqual(full);
      } catch {
        mismatches.push(
          `${sourceThreadId} through sequence ${copiedThrough} (${thread.status}): ${incremental.items.length} incremental items vs ${full.items.length} full items`,
        );
        break;
      }
    }
  });
  return mismatches;
}

describe.skipIf(SOURCE_DB === undefined)(
  "incremental conversation outlines over real history",
  () => {
    it("match a full build after every replayed append", () => {
      const directory = mkdtempSync(join(tmpdir(), "bb-outline-history-"));
      try {
        const sourcePath = copyDatabase(SOURCE_DB!, directory);
        const source = new Database(sourcePath, { readonly: true });
        const threadIds = THREAD_FILTER ?? largestThreadIds(source);
        source.close();
        const mismatches = threadIds.flatMap((threadId) =>
          replayThread(sourcePath, threadId),
        );
        expect(mismatches).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }, 7_200_000);
  },
);
