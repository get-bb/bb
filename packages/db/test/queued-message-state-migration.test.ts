import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createConnection,
  createThread,
  migrate,
  noopNotifier,
  type DbConnection,
} from "../src/index.js";
import {
  dropThreadParentNotificationsColumn,
  rewindQueuedMessageStateMigration,
} from "./helpers/rewind.js";

interface LegacyQueuedRow {
  id: string;
  sendAt?: number | null;
  waitingOn?: string | null;
  waitHolder?: string | null;
  failureReason?: string | null;
  failureCount?: number;
  nextAttemptAt?: number | null;
  claimedAt?: number | null;
  claimToken?: string | null;
  groupWithNext?: number;
}

interface MigratedQueuedRow {
  id: string;
  state: string;
  sendAt: number | null;
  waitingOn: string | null;
  waitHolder: string | null;
  failureReason: string | null;
  failureCount: number;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  claimToken: string | null;
  groupWithNext: number;
}

const busy = JSON.stringify({ kind: "thread-busy" });
const time = JSON.stringify({ kind: "time" });
const limiter = JSON.stringify({
  kind: "plugin",
  pluginId: "limiter",
  reason: "4 of 4 running",
});

function rewoundDatabase(): { db: DbConnection; threadId: string } {
  const db = createConnection(":memory:");
  migrate(db);
  const thread = createThread(db, noopNotifier, {
    projectId: PERSONAL_PROJECT_ID,
    providerId: "test-provider",
    status: "idle",
  });
  rewindQueuedMessageStateMigration(db);
  dropThreadParentNotificationsColumn(db);
  return { db, threadId: thread.id };
}

function insertLegacyRow(
  db: DbConnection,
  threadId: string,
  row: LegacyQueuedRow,
): void {
  db.$client
    .prepare(
      `INSERT INTO queued_thread_messages (
        id, thread_id, content, model, reasoning_level, permission_mode,
        service_tier, group_with_next, send_at, waiting_on, wait_holder,
        failure_reason, failure_count, next_attempt_at, claimed_at,
        claim_token, sort_key, created_at, updated_at
      ) VALUES (
        @id, @threadId, '[]', 'gpt-5', 'medium', 'full', 'default',
        @groupWithNext, @sendAt, @waitingOn, @waitHolder, @failureReason,
        @failureCount, @nextAttemptAt, @claimedAt, @claimToken, @id, 1000, 1000
      )`,
    )
    .run({
      threadId,
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
      ...row,
    });
}

function readMigratedRows(db: DbConnection): Map<string, MigratedQueuedRow> {
  const rows = db.$client
    .prepare<[], MigratedQueuedRow>(
      `SELECT
        id, state, send_at AS sendAt, waiting_on AS waitingOn,
        wait_holder AS waitHolder, failure_reason AS failureReason,
        failure_count AS failureCount, next_attempt_at AS nextAttemptAt,
        claimed_at AS claimedAt, claim_token AS claimToken,
        group_with_next AS groupWithNext
      FROM queued_thread_messages`,
    )
    .all();
  return new Map(rows.map((row) => [row.id, row]));
}

const documentedCombinations: readonly {
  legacy: LegacyQueuedRow;
  migrated: Omit<MigratedQueuedRow, "id">;
}[] = [
  {
    legacy: { id: "plain" },
    migrated: {
      state: "queued",
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "busy", waitingOn: busy, groupWithNext: 1 },
    migrated: {
      state: "waiting",
      sendAt: null,
      waitingOn: busy,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 1,
    },
  },
  {
    legacy: { id: "plugin", waitingOn: limiter, waitHolder: "plugin:limiter" },
    migrated: {
      state: "waiting",
      sendAt: null,
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: {
      id: "plugin-scheduled",
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      sendAt: 9000,
    },
    migrated: {
      state: "scheduled",
      sendAt: 9000,
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "time", waitingOn: time, sendAt: 9000 },
    migrated: {
      state: "scheduled",
      sendAt: 9000,
      waitingOn: time,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "send-at-without-wait", sendAt: 9000 },
    migrated: {
      state: "scheduled",
      sendAt: 9000,
      waitingOn: time,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: {
      id: "failed-retrying",
      waitingOn: busy,
      failureReason: "Provider not ready",
      failureCount: 1,
      nextAttemptAt: 16000,
    },
    migrated: {
      state: "failed_retrying",
      sendAt: null,
      waitingOn: busy,
      waitHolder: null,
      failureReason: "Provider not ready",
      failureCount: 1,
      nextAttemptAt: 16000,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: {
      id: "failed-exhausted",
      waitingOn: time,
      sendAt: 9000,
      failureReason: "Provider not ready",
      failureCount: 3,
    },
    migrated: {
      state: "failed_exhausted",
      sendAt: 9000,
      waitingOn: time,
      waitHolder: null,
      failureReason: "Provider not ready",
      failureCount: 3,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "failed-before-counter", failureReason: "Gone" },
    migrated: {
      state: "failed_exhausted",
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: "Gone",
      failureCount: 1,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "stray-counter", failureCount: 2, nextAttemptAt: 5000 },
    migrated: {
      state: "queued",
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: {
      id: "claimed",
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      failureReason: "Provider not ready",
      failureCount: 1,
      nextAttemptAt: 16000,
      claimedAt: 20000,
      claimToken: "claim_live",
    },
    migrated: {
      state: "claimed",
      sendAt: null,
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      failureReason: "Provider not ready",
      failureCount: 1,
      nextAttemptAt: 16000,
      claimedAt: 20000,
      claimToken: "claim_live",
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "claimed-at-only", waitingOn: busy, claimedAt: 20000 },
    migrated: {
      state: "waiting",
      sendAt: null,
      waitingOn: busy,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "claim-token-only", claimToken: "claim_orphan" },
    migrated: {
      state: "queued",
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: {
      id: "holder-without-plugin-wait",
      waitingOn: JSON.stringify({ kind: "provisioning" }),
      waitHolder: "plugin:limiter",
    },
    migrated: {
      state: "waiting",
      sendAt: null,
      waitingOn: JSON.stringify({ kind: "provisioning" }),
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "plugin-wait-without-holder", waitingOn: limiter },
    migrated: {
      state: "waiting",
      sendAt: null,
      waitingOn: limiter,
      waitHolder: "plugin:limiter",
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
  {
    legacy: { id: "malformed-wait", waitingOn: "{not json" },
    migrated: {
      state: "queued",
      sendAt: null,
      waitingOn: null,
      waitHolder: null,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      groupWithNext: 0,
    },
  },
];

describe("queued message state migration", () => {
  it("maps every documented column combination onto exactly one state", () => {
    const { db, threadId } = rewoundDatabase();
    try {
      for (const { legacy } of documentedCombinations) {
        insertLegacyRow(db, threadId, legacy);
      }

      migrate(db);

      const migrated = readMigratedRows(db);
      expect(migrated.size).toBe(documentedCombinations.length);
      for (const { legacy, migrated: expected } of documentedCombinations) {
        expect({ id: legacy.id, ...migrated.get(legacy.id) }).toEqual({
          id: legacy.id,
          ...expected,
        });
      }
    } finally {
      db.$client.close();
    }
  });

  it("migrates an install whose queue table never gained group_with_next", () => {
    const { db, threadId } = rewoundDatabase();
    try {
      db.$client.exec(
        "ALTER TABLE queued_thread_messages DROP COLUMN group_with_next",
      );
      db.$client
        .prepare(
          `INSERT INTO queued_thread_messages (
            id, thread_id, content, model, reasoning_level, permission_mode,
            service_tier, waiting_on, sort_key, created_at, updated_at
          ) VALUES ('old', ?, '[]', 'gpt-5', 'medium', 'full', 'default', ?, 'a', 1, 1)`,
        )
        .run(threadId, busy);

      migrate(db);

      expect(readMigratedRows(db).get("old")).toMatchObject({
        state: "waiting",
        groupWithNext: 0,
      });
    } finally {
      db.$client.close();
    }
  });
});
