import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createConnection,
  createThread,
  migrate,
  noopNotifier,
  type DbConnection,
} from "../src/index.js";
import { rewindQueuedMessageRecheckAtMigration } from "./helpers/rewind.js";

const limiter = JSON.stringify({
  kind: "plugin",
  pluginId: "limiter",
  reason: "4 of 4 running",
});
const time = JSON.stringify({ kind: "time" });

interface LegacyRow {
  id: string;
  state: string;
  sendAt: number | null;
  waitingOn: string | null;
  waitHolder: string | null;
  failureReason?: string | null;
  failureCount?: number;
  nextAttemptAt?: number | null;
  claimedAt?: number | null;
  claimToken?: string | null;
}

function insertLegacyRow(
  db: DbConnection,
  threadId: string,
  row: LegacyRow,
): void {
  db.$client
    .prepare(
      `INSERT INTO queued_thread_messages (
        id, thread_id, content, model, reasoning_level, permission_mode,
        service_tier, state, send_at, waiting_on, wait_holder, failure_reason,
        failure_count, next_attempt_at, claimed_at, claim_token, sort_key,
        created_at, updated_at
      ) VALUES (
        @id, @threadId, '[]', 'gpt-5', 'medium', 'full', 'default', @state,
        @sendAt, @waitingOn, @waitHolder, @failureReason, @failureCount,
        @nextAttemptAt, @claimedAt, @claimToken, @id, 1000, 1000
      )`,
    )
    .run({
      threadId,
      failureReason: null,
      failureCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      ...row,
    });
}

describe("queued message recheck_at migration", () => {
  it("moves a plugin's instant out of the sender's send_at", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const thread = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
        status: "idle",
      });
      rewindQueuedMessageRecheckAtMigration(db);
      const plugin = { waitingOn: limiter, waitHolder: "plugin:limiter" };
      insertLegacyRow(db, thread.id, {
        id: "plugin-scheduled",
        state: "scheduled",
        sendAt: 9000,
        ...plugin,
      });
      insertLegacyRow(db, thread.id, {
        id: "plugin-claimed",
        state: "claimed",
        sendAt: 9000,
        claimedAt: 1000,
        claimToken: "claim",
        ...plugin,
      });
      insertLegacyRow(db, thread.id, {
        id: "plugin-failed",
        state: "failed_retrying",
        sendAt: 9000,
        failureReason: "boom",
        failureCount: 1,
        nextAttemptAt: 5000,
        ...plugin,
      });
      insertLegacyRow(db, thread.id, {
        id: "plugin-waiting",
        state: "waiting",
        sendAt: null,
        ...plugin,
      });
      insertLegacyRow(db, thread.id, {
        id: "time",
        state: "scheduled",
        sendAt: 9000,
        waitingOn: time,
        waitHolder: null,
      });

      migrate(db);

      expect(
        db.$client
          .prepare(
            "SELECT id, state, send_at AS sendAt, recheck_at AS recheckAt FROM queued_thread_messages ORDER BY id",
          )
          .all(),
      ).toEqual([
        {
          id: "plugin-claimed",
          state: "claimed",
          sendAt: null,
          recheckAt: 9000,
        },
        {
          id: "plugin-failed",
          state: "failed_retrying",
          sendAt: null,
          recheckAt: 9000,
        },
        {
          id: "plugin-scheduled",
          state: "waiting",
          sendAt: null,
          recheckAt: 9000,
        },
        {
          id: "plugin-waiting",
          state: "waiting",
          sendAt: null,
          recheckAt: null,
        },
        { id: "time", state: "scheduled", sendAt: 9000, recheckAt: null },
      ]);
    } finally {
      db.$client.close();
    }
  });
});
