import { performance } from "node:perf_hooks";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import { expect, it } from "vitest";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createQueuedThreadMessage,
  getQueuedThreadMessage,
  supersedeQueuedRetriesInTransaction,
} from "../../src/data/queued-thread-messages.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

it("supersedes an unaccepted retry without repeatedly walking long request history", () => {
  const db = createMigratedConnection();
  try {
    const host = upsertHost(db, noopNotifier, { name: "retry-history" });
    const { project } = createProject(db, noopNotifier, {
      name: "retry-history",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/retry-history",
      },
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const requestCount = 2_000;
    const requestId = (value: number) =>
      encodeClientTurnRequestIdNumber({ value });
    const insert = db.$client.prepare(`INSERT INTO events
      (id, thread_id, scope_kind, turn_id, sequence, type, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
    db.$client.transaction(() => {
      for (let index = 1; index <= requestCount; index++) {
        insert.run(
          `request-${index}`,
          thread.id,
          "thread",
          null,
          index * 2,
          "client/turn/requested",
          JSON.stringify({
            requestId: requestId(index),
            input: [
              { type: "text", text: "history ".repeat(256), mentions: [] },
            ],
          }),
        );
        if (index < requestCount) {
          insert.run(
            `accepted-${index}`,
            thread.id,
            "turn",
            `turn-${index}`,
            index * 2 + 1,
            "turn/input/accepted",
            JSON.stringify({ clientRequestId: requestId(index) }),
          );
        }
      }
    })();
    const retry = createQueuedThreadMessage(db, noopNotifier, {
      threadId: thread.id,
      content: [],
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      waitingOn: null,
      sendAt: null,
      payload: {
        kind: "retry",
        retryOfTurnRequestId: requestId(requestCount),
        attempt: 1,
        reason: "retry-history",
      },
      systemNotice: null,
    });
    const started = performance.now();
    const superseded = db.transaction(
      (tx) =>
        supersedeQueuedRetriesInTransaction(tx, {
          threadId: thread.id,
          retryOfTurnRequestId: null,
        }),
      { behavior: "immediate" },
    );
    const elapsed = performance.now() - started;
    expect(superseded).toBe(1);
    expect(getQueuedThreadMessage(db, retry.id)?.waitingOn).toBe(
      JSON.stringify({ kind: "superseded" }),
    );
    console.info(
      JSON.stringify({ requestCount, superseded, elapsedMs: elapsed }),
    );
    expect(elapsed).toBeLessThan(500);
  } finally {
    db.$client.close();
  }
});

it.each([
  { acceptance: "root", clientId: 1, foreignThread: false, dropped: true },
  {
    acceptance: "direct retry",
    clientId: 2,
    foreignThread: false,
    dropped: true,
  },
  {
    acceptance: "deeper retry",
    clientId: 3,
    foreignThread: false,
    dropped: false,
  },
  {
    acceptance: "unrelated",
    clientId: 4,
    foreignThread: false,
    dropped: false,
  },
  {
    acceptance: "other thread",
    clientId: 1,
    foreignThread: true,
    dropped: false,
  },
  {
    acceptance: "null ID",
    clientId: null,
    foreignThread: false,
    dropped: false,
  },
  {
    acceptance: "missing ID",
    clientId: undefined,
    foreignThread: false,
    dropped: false,
  },
])(
  "preserves retry disposition for $acceptance acceptance",
  ({ clientId, foreignThread, dropped }) => {
    const db = createMigratedConnection();
    try {
      const host = upsertHost(db, noopNotifier, { name: "retry-acceptance" });
      const { project } = createProject(db, noopNotifier, {
        name: "retry-acceptance",
        source: {
          type: "local_path",
          hostId: host.id,
          path: "/tmp/retry-acceptance",
        },
      });
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const other = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const requestId = (value: number) =>
        encodeClientTurnRequestIdNumber({ value });
      const insert = db.$client.prepare(`INSERT INTO events
      (id, thread_id, scope_kind, turn_id, sequence, type, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
      for (const [index, parent] of [null, 1, 2, null, 1].entries()) {
        const requestNumber = index === 4 ? 2 : index + 1;
        insert.run(
          `request-${index}`,
          thread.id,
          "thread",
          null,
          index + 1,
          "client/turn/requested",
          JSON.stringify({
            requestId: requestId(requestNumber),
            ...(parent === null ? {} : { retryOfRequestId: requestId(parent) }),
          }),
        );
      }
      insert.run(
        "accepted",
        foreignThread ? other.id : thread.id,
        "turn",
        "accepted-turn",
        6,
        "turn/input/accepted",
        JSON.stringify({
          clientRequestId: clientId == null ? clientId : requestId(clientId),
        }),
      );
      const retry = createQueuedThreadMessage(db, noopNotifier, {
        threadId: thread.id,
        content: [],
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        waitingOn: null,
        sendAt: null,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: requestId(1),
          attempt: 1,
          reason: "retry-acceptance",
        },
        systemNotice: null,
      });
      expect(
        db.transaction((tx) =>
          supersedeQueuedRetriesInTransaction(tx, {
            threadId: thread.id,
            retryOfTurnRequestId: null,
          }),
        ),
      ).toBe(1);
      const stored = getQueuedThreadMessage(db, retry.id);
      if (dropped) {
        expect(stored).toBeNull();
      } else {
        expect(stored?.waitingOn).toBe(JSON.stringify({ kind: "superseded" }));
      }
    } finally {
      db.$client.close();
    }
  },
);
