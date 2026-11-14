import {
  parseStoredThreadEvent,
  promptInputSchema,
  threadScope,
  turnScope,
  type ThreadEventType,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildHistoryFixture } from "../src/history-fixture.js";
import { createMigratedConnection } from "../src/testing.js";

interface StoredRow {
  data: string;
  provider_thread_id: string | null;
  sequence: number;
  thread_id: string;
  turn_id: string | null;
  type: ThreadEventType;
}

describe("buildHistoryFixture", () => {
  it("stores only events and queued messages the server can parse", () => {
    const db = createMigratedConnection();
    try {
      const fixture = buildHistoryFixture(db, {
        historyTurns: 1_000,
        longTurnSteps: 120,
        neighborThreads: 3,
        neighborTurns: 20,
        providerId: "test",
      });
      const span = db.$client
        .prepare(
          "SELECT min(created_at) AS oldest, max(created_at) AS newest FROM events WHERE thread_id = ?",
        )
        .get(fixture.threadId) as { oldest: number; newest: number };
      const hour = 60 * 60_000;
      expect(Date.now() - span.newest).toBeGreaterThanOrEqual(hour);
      expect(span.newest - span.oldest).toBeGreaterThan(24 * hour);
      const rows = db.$client
        .prepare(
          "SELECT data, provider_thread_id, sequence, thread_id, turn_id, type FROM events",
        )
        .all() as StoredRow[];
      const malformed = rows.flatMap((row) => {
        try {
          parseStoredThreadEvent({
            data: JSON.parse(row.data) as Record<string, unknown>,
            providerThreadId: row.provider_thread_id,
            scope:
              row.turn_id === null ? threadScope() : turnScope(row.turn_id),
            threadId: row.thread_id,
            type: row.type,
          });
          return [];
        } catch (error) {
          return [
            `${row.type} #${row.sequence}: ${String(error).slice(0, 300)}`,
          ];
        }
      });
      expect([...new Set(malformed)].slice(0, 10)).toEqual([]);
      const queued = db.$client
        .prepare("SELECT content FROM queued_thread_messages")
        .all() as Array<{ content: string }>;
      for (const row of queued) {
        expect(
          promptInputSchema.array().min(1).safeParse(JSON.parse(row.content))
            .success,
        ).toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });
});
