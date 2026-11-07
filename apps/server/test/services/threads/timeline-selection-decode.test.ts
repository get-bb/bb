import { describe, expect, it } from "vitest";
import {
  deleteThreadEventSuffixInTransaction,
  listStoredEventRows,
} from "@bb/db";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";
import {
  byteLengthOfStoredEventRows,
  decodeTimelineSelectionRows,
  withRowMeta,
} from "../../../src/services/threads/timeline-selection-decode.js";
import {
  appendRows,
  withTestThread,
} from "../../helpers/timeline-cache-fixture.js";

function agentMessage(id: string, text: string) {
  return {
    type: "item/completed" as const,
    turnId: "turn-1",
    itemId: id,
    itemKind: "agentMessage" as const,
    data: { item: { type: "agentMessage", id, text } },
  };
}

describe("timeline selection decode", () => {
  it("decodes only the rows appended after a decoded prefix", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        agentMessage("message-1", "Hello"),
      ]);
      const prefix = listStoredEventRows(db, { threadId: thread.id });
      const first = decodeTimelineSelectionRows(db, thread.id, prefix);
      appendRows(testThread, [agentMessage("message-2", "Héllo again")]);
      const appended = listStoredEventRows(db, {
        afterSequence: prefix.at(-1)!.sequence,
        threadId: thread.id,
      });
      expect(appended).toHaveLength(1);
      const rows = [...prefix, ...appended];
      const extended = decodeTimelineSelectionRows(db, thread.id, rows);

      expect(extended.events).toEqual(
        rows.map((row) => withRowMeta(row, parseStoredEvent(row))),
      );
      expect(extended.dataBytes).toBe(byteLengthOfStoredEventRows(rows));
      expect(extended.events[0]).toBe(first.events[0]);
      expect(extended.events[1]).toBe(first.events[1]);
      expect(extended.events).not.toBe(first.events);
    });
  });

  it("decodes again after the thread's history is rewritten", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        agentMessage("message-1", "Hello"),
        agentMessage("message-2", "Bye"),
      ]);
      const rows = listStoredEventRows(db, { threadId: thread.id });
      const first = decodeTimelineSelectionRows(db, thread.id, rows);
      db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: 3,
          oldMaxSequence: 3,
          threadId: thread.id,
        });
      });
      const again = decodeTimelineSelectionRows(db, thread.id, rows);
      expect(again.events).toEqual(first.events);
      expect(again.events[0]).not.toBe(first.events[0]);
    });
  });
});
