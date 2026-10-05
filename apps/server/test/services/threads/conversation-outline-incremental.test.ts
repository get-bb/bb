import { describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  type CompletedTurnDisplay,
} from "@bb/domain";
import {
  deleteThreadEventSuffixInTransaction,
  createThread,
  noopNotifier,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
} from "@bb/db";
import {
  buildThreadConversationOutline,
  loadThreadConversationOutline,
} from "../../../src/services/threads/timeline.js";
import {
  appendRows,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";

function started(turnId: string, parentToolCallId?: string): RowSpec {
  return {
    type: "turn/started",
    turnId,
    parentToolCallId,
    data: { parentToolCallId },
  };
}

function completed(turnId: string): RowSpec {
  return { type: "turn/completed", turnId, data: { status: "completed" } };
}

function message(
  turnId: string,
  text: string,
  parentToolCallId?: string,
): RowSpec {
  return {
    type: "item/completed",
    turnId,
    itemId: `message-${turnId}`,
    itemKind: "agentMessage",
    parentToolCallId,
    data: {
      item: {
        id: `message-${turnId}`,
        type: "agentMessage",
        text,
        parentToolCallId,
      },
    },
  };
}

function delta(turnId: string, text: string): RowSpec {
  return {
    type: "item/agentMessage/delta",
    turnId,
    itemId: `message-${turnId}`,
    data: { itemId: `message-${turnId}`, delta: text },
  };
}

function request(
  requestId: string,
  expectedTurnId: string | null = null,
): RowSpec {
  return {
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      requestId,
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      input: [{ type: "text", text: "User request" }],
      target:
        expectedTurnId === null
          ? { kind: "new-turn" }
          : { kind: "steer", expectedTurnId },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "workspace-write",
        source: "client/turn/requested",
        serviceTier: "auto",
      },
    },
  };
}

function accepted(requestId: string, turnId: string): RowSpec {
  return {
    type: "turn/input/accepted",
    turnId,
    data: { clientRequestId: requestId },
  };
}

function seed(testThread: TestThread, count = 3): void {
  appendRows(
    testThread,
    Array.from({ length: count }, (_, i) => {
      const turnId = `turn-${i}`;
      const requestId = `creq_${i.toString(8).replaceAll("0", "a").replaceAll("1", "b").padStart(10, "a")}`;
      return [
        request(requestId),
        started(turnId),
        accepted(requestId, turnId),
        message(turnId, `Answer ${i}`),
        completed(turnId),
      ];
    }).flat(),
  );
  appendRows(testThread, [started("live"), delta("live", "Live")]);
}

function nestedTurn(index: number, includeParent = true): RowSpec[] {
  const root = `nested-root-${index}`;
  const child = `nested-child-${index}`;
  const parent = `nested-call-${index}`;
  return [
    started(root),
    ...(includeParent ? [parentCall(root, parent)] : []),
    started(child, parent),
    message(child, `Child answer ${index}`, parent),
    { ...completed(child), parentToolCallId: parent },
    message(root, `Root answer ${index}`),
    completed(root),
  ];
}

function parentCall(turnId: string, itemId: string): RowSpec {
  return {
    type: "item/started",
    turnId,
    itemId,
    itemKind: "toolCall",
    data: {
      item: {
        id: itemId,
        type: "toolCall",
        tool: "Agent",
        arguments: {},
        status: "pending",
      },
    },
  };
}

function load(
  testThread: TestThread,
  completedTurnDisplay: CompletedTurnDisplay = "collapse",
) {
  const threadId = testThread.thread.id;
  return loadThreadConversationOutline(testThread.db, testThread.thread, {
    completedTurnDisplay,
    maxSeq: getLatestThreadSequence(testThread.db, { threadId }),
    outlineSequence: getLatestStoredConversationOutlineSequence(testThread.db, {
      threadId,
    }),
  });
}

function expectMatchesFull(
  testThread: TestThread,
  completedTurnDisplay: CompletedTurnDisplay = "collapse",
) {
  const result = load(testThread, completedTurnDisplay);
  expect(result).toEqual(
    buildThreadConversationOutline(testThread.coldDb, testThread.thread, {
      completedTurnDisplay,
      maxSeq: result.maxSeq,
    }),
  );
  return result;
}

function countSelectedEventRows(
  testThread: TestThread,
  run: () => void,
): number {
  const raw = testThread.db.$client;
  const originalPrepare = raw.prepare.bind(raw);
  let count = 0;
  Object.defineProperty(raw, "prepare", {
    configurable: true,
    writable: true,
    value: (source: string) => {
      const statement = originalPrepare(source);
      if (source.includes('from "events"') && source.includes('"created_at"')) {
        const originalAll = statement.all.bind(statement);
        statement.all = function (...params: unknown[]) {
          const rows = originalAll(...params);
          count += rows.length;
          return rows;
        };
      }
      return statement;
    },
  });
  try {
    run();
  } finally {
    raw.prepare = originalPrepare;
  }
  return count;
}

describe("incremental conversation outlines", () => {
  it.each(["collapse", "flat"] as const)(
    "retains completed nested history while updating the live tail (%s)",
    (display) => {
      withTestThread((testThread) => {
        appendRows(testThread, [
          ...Array.from({ length: 100 }, (_, index) =>
            nestedTurn(index),
          ).flat(),
          started("live"),
          delta("live", "Live"),
        ]);
        expectMatchesFull(testThread, display);
        for (const rows of [
          [delta("live", " continued")],
          [message("live", "Finished"), completed("live")],
          nestedTurn(101),
          [started("next"), delta("next", "Next")],
        ]) {
          appendRows(testThread, rows);
          const selected = countSelectedEventRows(testThread, () =>
            expectMatchesFull(testThread, display),
          );
          expect(selected).toBeLessThan(25);
        }
      });
    },
  );

  it.each([
    "new child",
    "late parent",
    "reopened turn",
    "completion rewrite",
    "incomplete child",
  ] as const)(
    "preserves outlines after nested history changes: %s",
    (change) => {
      withTestThread((testThread) => {
        appendRows(testThread, [
          ...Array.from({ length: 30 }, (_, index) =>
            nestedTurn(index, change !== "late parent"),
          ).flat(),
          started("live"),
          delta("live", "Live"),
        ]);
        const removeCompletion = () =>
          testThread.coldDb.$client
            .prepare(
              "DELETE FROM events WHERE thread_id = ? AND turn_id = ? AND type = 'turn/completed'",
            )
            .run(testThread.thread.id, "nested-child-0");
        if (change === "incomplete child") removeCompletion();
        expectMatchesFull(testThread);
        switch (change) {
          case "new child":
            appendRows(testThread, [
              started("late-child", "nested-call-0"),
              message("late-child", "Late child", "nested-call-0"),
            ]);
            break;
          case "late parent":
            appendRows(testThread, [parentCall("live", "nested-call-0")]);
            break;
          case "reopened turn":
            appendRows(testThread, [
              started("nested-child-0", "nested-call-0"),
              message("nested-child-0", "Reopened", "nested-call-0"),
            ]);
            break;
          case "completion rewrite":
            removeCompletion();
            break;
          case "incomplete child":
            appendRows(testThread, [delta("live", "More")]);
            break;
        }
        const selected = countSelectedEventRows(testThread, () =>
          expectMatchesFull(testThread),
        );
        if (change === "completion rewrite")
          expect(selected).toBeGreaterThan(100);
        else expect(selected).toBeLessThan(25);
      });
    },
  );

  it.each(["collapse", "flat"] as const)(
    "only reads root messages while a nested child is still streaming (%s)",
    (display) => {
      withTestThread((testThread) => {
        appendRows(testThread, [
          ...nestedTurn(0).filter(
            (row) =>
              !(
                row.type === "turn/completed" && row.turnId === "nested-child-0"
              ),
          ),
          ...Array.from({ length: 99 }, (_, index) =>
            nestedTurn(index + 1),
          ).flat(),
          started("live"),
          delta("live", "Live"),
        ]);
        expectMatchesFull(testThread, display);
        for (let index = 0; index < 3; index += 1) {
          appendRows(testThread, [
            {
              ...delta("nested-child-0", "Nested update"),
              parentToolCallId: "nested-call-0",
              data: {
                itemId: "message-nested-child-0",
                delta: "Nested update",
                parentToolCallId: "nested-call-0",
              },
            },
            delta("live", " Root update"),
          ]);
          const selected = countSelectedEventRows(testThread, () =>
            expectMatchesFull(testThread, display),
          );
          expect(selected).toBeLessThan(25);
        }
      });
    },
  );

  it.each(["immediate", "late"] as const)(
    "keeps accepted root answers with inherited parent metadata (%s acceptance)",
    (acceptance) => {
      withTestThread((testThread) => {
        appendRows(testThread, [
          request("creq_abcdefghij"),
          started("inherited-root", "inherited-parent"),
          ...(acceptance !== "late"
            ? [accepted("creq_abcdefghij", "inherited-root")]
            : []),
          message("inherited-root", "Actual root answer", "inherited-parent"),
          completed("inherited-root"),
          started("live"),
          delta("live", "Live"),
        ]);
        expectMatchesFull(testThread);
        if (acceptance === "late") {
          appendRows(testThread, [
            accepted("creq_abcdefghij", "inherited-root"),
          ]);
        }
        const result = expectMatchesFull(testThread);
        expect(result.items.map((item) => item.preview)).toContain(
          "Actual root answer",
        );
      });
    },
  );

  it("rebuilds root fallback previews when child deltas cross the compaction threshold", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        started("root"),
        parentCall("root", "parent"),
        started("child", "parent"),
        delta("root", "First"),
        delta("root", " second"),
        message("root", ""),
        completed("root"),
        started("live"),
        delta("live", "Live"),
      ]);
      const before = expectMatchesFull(testThread);
      expect(before.items.map((item) => item.preview)).toContain(
        "First second",
      );
      appendRows(
        testThread,
        Array.from({ length: 1_000 }, () => ({
          ...delta("child", "Nested"),
          parentToolCallId: "parent",
          data: {
            itemId: "message-child",
            delta: "Nested",
            parentToolCallId: "parent",
          },
        })),
      );
      const after = expectMatchesFull(testThread);
      expect(after.items.map((item) => item.preview)).toContain("First");
    });
  });

  it.each([950, 1050])(
    "preserves previews across delta compaction with %i historical deltas",
    (deltaCount) => {
      withTestThread((testThread) => {
        appendRows(testThread, [
          started("old"),
          ...Array.from({ length: deltaCount }, () => delta("old", "word ")),
          message("old", "Complete"),
          completed("old"),
          started("live"),
          delta("live", "First"),
          delta("live", " second"),
        ]);
        expectMatchesFull(testThread);
        appendRows(testThread, [message("live", ""), completed("live")]);
        expectMatchesFull(testThread);
        appendRows(testThread, [
          started("next"),
          ...Array.from({ length: 100 }, () => delta("next", "more ")),
        ]);
        expectMatchesFull(testThread);
      });
    },
  );

  it("rebuilds when a previously unaccepted request joins a later turn", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [request("creq_abcdefghij")]);
      seed(testThread);
      expectMatchesFull(testThread);
      appendRows(testThread, [
        accepted("creq_abcdefghij", "live"),
        delta("live", " accepted"),
      ]);
      expectMatchesFull(testThread);
    });
  });

  it("only reads the live tail after a long completed history, including across turn boundaries", () => {
    withTestThread((testThread) => {
      seed(testThread, 100);
      expectMatchesFull(testThread);
      for (const rows of [
        [delta("live", " continuation")],
        [message("live", "Final answer"), completed("live")],
        [
          request("creq_abcdefghij"),
          started("next"),
          accepted("creq_abcdefghij", "next"),
          delta("next", "Next"),
        ],
        [delta("next", " update")],
      ]) {
        appendRows(testThread, rows);
        const count = countSelectedEventRows(testThread, () => {
          load(testThread);
        });
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(20);
        expectMatchesFull(testThread);
      }
    });
  });

  it.each([
    "rewind",
    "clear",
    "external rewrite",
    "metadata",
    "display",
    "late event",
    "late steer",
    "thread error",
    "nested",
  ] as const)(
    "matches a full rebuild after %s invalidates the frozen prefix",
    (change) =>
      withTestThread((testThread) => {
        seed(testThread);
        appendRows(testThread, [
          message("live", "Finished prelude"),
          completed("live"),
          ...nestedTurn(900),
          started("next-live"),
          delta("next-live", "Live"),
        ]);
        expectMatchesFull(testThread);
        switch (change) {
          case "rewind": {
            const maxSeq = getLatestThreadSequence(testThread.db, {
              threadId: testThread.thread.id,
            });
            testThread.db.transaction((tx) =>
              deleteThreadEventSuffixInTransaction(tx, {
                threadId: testThread.thread.id,
                cutoffSequence: 4,
                oldMaxSequence: maxSeq,
              }),
            );
            appendRows(testThread, [
              message("turn-0", "Replacement"),
              completed("turn-0"),
              started("replacement"),
              delta("replacement", "New"),
            ]);
            while (
              getLatestThreadSequence(testThread.db, {
                threadId: testThread.thread.id,
              }) < maxSeq
            ) {
              appendRows(testThread, [
                {
                  type: "system/manager/user_message",
                  data: { text: "Refilled history" },
                },
              ]);
            }
            break;
          }
          case "clear":
            appendRows(testThread, [
              {
                type: "system/operation",
                data: {
                  operation: THREAD_CONTEXT_CLEAR_OPERATION,
                  operationId: "clear",
                  status: "completed",
                  message: "Context cleared",
                },
              },
              started("fresh"),
              delta("fresh", "Fresh"),
            ]);
            break;
          case "external rewrite":
            testThread.coldDb.$client
              .prepare(
                "UPDATE events SET data = json_set(data, '$.item.text', 'Rewritten') WHERE thread_id = ? AND sequence = 4",
              )
              .run(testThread.thread.id);
            break;
          case "display":
            break;
          case "metadata":
            testThread.thread = {
              ...testThread.thread,
              title: "Renamed",
              status: "error",
            };
            break;
          case "late event":
            appendRows(testThread, [message("turn-0", "Late replacement")]);
            break;
          case "late steer":
            appendRows(testThread, [
              request("creq_abcdefghij", "turn-0"),
              accepted("creq_abcdefghij", "turn-0"),
            ]);
            break;
          case "thread error":
            appendRows(testThread, [
              { type: "system/error", data: { message: "Failed" } },
            ]);
            break;
          case "nested":
            appendRows(testThread, [
              {
                ...started("child"),
                parentToolCallId: "parent",
                data: { parentToolCallId: "parent" },
              },
              {
                ...message("child", "Child answer"),
                parentToolCallId: "parent",
                data: {
                  item: {
                    id: "message-child",
                    type: "agentMessage",
                    text: "Child answer",
                    parentToolCallId: "parent",
                  },
                },
              },
            ]);
            break;
        }
        expectMatchesFull(
          testThread,
          change === "display" ? "flat" : "collapse",
        );
      }),
  );

  it("evicts old checkpoints without changing their rebuilt outlines", () => {
    withTestThread((testThread) => {
      seed(testThread, 100);
      expectMatchesFull(testThread);
      const firstThread = testThread.thread;
      for (let index = 0; index < 16; index += 1) {
        testThread.thread = createThread(testThread.db, noopNotifier, {
          projectId: testThread.projectId,
          providerId: "codex",
          status: "active",
        });
        seed(testThread);
        load(testThread);
      }
      testThread.thread = firstThread;
      const count = countSelectedEventRows(testThread, () => {
        load(testThread);
      });
      expect(count).toBeGreaterThan(500);
      expectMatchesFull(testThread);
      appendRows(testThread, [delta("live", " after eviction")]);
      expect(
        countSelectedEventRows(testThread, () => {
          load(testThread);
        }),
      ).toBeLessThan(20);
      expectMatchesFull(testThread);
    });
  });

  it("preserves overlapping turns and pending steers as they complete", () => {
    withTestThread((testThread) => {
      seed(testThread);
      expectMatchesFull(testThread);
      for (const rows of [
        [
          request("creq_abcdefghij", "live"),
          started("overlapping"),
          delta("overlapping", "Other"),
        ],
        [message("live", "Finished"), completed("live")],
        [
          accepted("creq_abcdefghij", "overlapping"),
          message("overlapping", "Other finished"),
          completed("overlapping"),
        ],
        [started("last"), delta("last", "Last")],
        [started("another"), delta("another", "Another")],
        [message("another", "Another done"), completed("another")],
        [message("last", "Last done"), completed("last")],
        [started("final"), delta("final", "Final")],
      ]) {
        appendRows(testThread, rows);
        expectMatchesFull(testThread);
      }
    });
  });
});
