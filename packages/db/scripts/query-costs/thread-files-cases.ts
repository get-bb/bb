import type { DbConnection } from "../../src/connection.js";
import {
  insertHiddenThreadRow,
  insertThreadHistoryRows,
  insertThreadTableRow,
  listThreadAttachments,
  readThreadEventWindow,
  readThreadTableRowsPage,
  restartThreadArchiveClock,
  unhideImportedThread,
  type ThreadEventWindow,
  type ThreadFileTableRow,
} from "../../src/data/thread-files.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";

const THREAD_FILES = "packages/db/src/data/thread-files.ts";
const THREAD_FILE_WINDOW_BYTES = 128 * 1024;
const THREAD_FILE_WINDOW_ROWS = 128;
const TABLE_ROWS_PER_STEP = 256;
const RESTORED_THREAD_ID = "query-cost-restored-thread";

interface ThreadFilesSeed {
  threadRow: ThreadFileTableRow;
  window: ThreadEventWindow;
}

function seedThreadFiles(
  db: DbConnection,
  fixture: HistoryFixture,
): ThreadFilesSeed {
  const threadRow = readThreadTableRowsPage(db, {
    afterRowid: 0,
    limit: 1,
    table: "threads",
    threadId: fixture.threadId,
  }).rows[0];
  if (threadRow === undefined)
    throw new Error("Expected the fixture thread row");
  const window = readThreadEventWindow(db, {
    afterSequence: 0,
    maxBytes: THREAD_FILE_WINDOW_BYTES,
    maxRows: THREAD_FILE_WINDOW_ROWS,
    threadId: fixture.threadId,
  });
  return { threadRow, window };
}

function restoredThreadRow(seed: ThreadFilesSeed): ThreadFileTableRow {
  return {
    table: "threads",
    values: { ...seed.threadRow.values, id: RESTORED_THREAD_ID },
  };
}

const THREAD_FILE_CASES: readonly QueryCostCase<ThreadFilesSeed>[] = [
  {
    name: `${THREAD_FILES}#readThreadEventWindow`,
    run: (db, fixture) =>
      readThreadEventWindow(db, {
        afterSequence: fixture.turns[0]?.requestSequence ?? 0,
        maxBytes: THREAD_FILE_WINDOW_BYTES,
        maxRows: THREAD_FILE_WINDOW_ROWS,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${THREAD_FILES}#readThreadTableRowsPage`,
    run: (db, fixture) =>
      readThreadTableRowsPage(db, {
        afterRowid: 0,
        limit: TABLE_ROWS_PER_STEP,
        table: "prompt_history_entries",
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${THREAD_FILES}#insertHiddenThreadRow`,
    run: (db, _fixture, seed) =>
      insertHiddenThreadRow(db, restoredThreadRow(seed), Date.now()),
  },
  {
    name: `${THREAD_FILES}#insertThreadTableRow`,
    prepare: (db, _fixture, seed) => {
      insertHiddenThreadRow(db, restoredThreadRow(seed), Date.now());
    },
    run: (db) =>
      insertThreadTableRow(db, {
        table: "thread_plugin_metadata",
        values: {
          thread_id: RESTORED_THREAD_ID,
          plugin_id: "query-costs",
          metadata_json: '{"pr":42}',
        },
      }),
  },
  {
    name: `${THREAD_FILES}#listThreadAttachments`,
    run: (db, fixture) => listThreadAttachments(db, fixture.threadId),
  },
  {
    name: `${THREAD_FILES}#insertThreadHistoryRows`,
    prepare: (db, _fixture, seed) => {
      insertHiddenThreadRow(db, restoredThreadRow(seed), Date.now());
    },
    run: (db, _fixture, seed) =>
      insertThreadHistoryRows(db, {
        now: Date.now(),
        retained: seed.window.retained,
        rows: seed.window.rows.map((row) => ({
          ...row,
          id: `${RESTORED_THREAD_ID}-${row.id}`,
          threadId: RESTORED_THREAD_ID,
        })),
      }),
  },
  {
    name: `${THREAD_FILES}#unhideImportedThread`,
    run: (db, fixture) => unhideImportedThread(db, fixture.threadId),
  },
  {
    name: `${THREAD_FILES}#restartThreadArchiveClock`,
    run: (db, fixture) =>
      restartThreadArchiveClock(db, {
        now: Date.now(),
        threadId: fixture.threadId,
      }),
  },
];

export const THREAD_FILES_COST_GROUP = registerCostGroup({
  name: "thread-files",
  seed: seedThreadFiles,
  cases: THREAD_FILE_CASES,
});
