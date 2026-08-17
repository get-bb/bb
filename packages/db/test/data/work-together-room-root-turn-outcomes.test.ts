import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";

import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { insertEvents } from "../../src/data/events.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  InvalidWorkTogetherRoomRootTurnOutcomeError,
  listLatestRootTurnTerminalOutcomesByThreadIds,
} from "../../src/data/work-together-room-root-turn-outcomes.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, project };
}

function turnFields(turnId: string) {
  return {
    itemId: null,
    itemKind: null,
    scope: turnScope(turnId),
  };
}

function started(threadId: string, sequence: number, turnId: string, nested = false) {
  return {
    threadId,
    sequence,
    type: "turn/started" as const,
    ...turnFields(turnId),
    data: nested
      ? JSON.stringify({ parentToolCallId: `call_${turnId}` })
      : "{}",
  };
}

function completed(
  threadId: string,
  sequence: number,
  turnId: string,
  status: "completed" | "failed" | "interrupted",
) {
  return {
    threadId,
    sequence,
    type: "turn/completed" as const,
    ...turnFields(turnId),
    data: JSON.stringify({
      providerThreadId: `provider_${turnId}`,
      status,
    }),
  };
}

describe("latest root-turn terminal outcomes", () => {
  it("returns the latest root completed/failed/interrupted outcome in SQL", () => {
    const { db, project } = setup();
    try {
      const completedThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const failedThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const interruptedThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const noTurnThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const nestedOnlyThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const activeAfterCompletionThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      insertEvents(db, noopNotifier, [
        started(completedThread.id, 1, "turn_old"),
        completed(completedThread.id, 2, "turn_old", "failed"),
        started(completedThread.id, 3, "turn_new"),
        started(completedThread.id, 4, "turn_nested", true),
        completed(completedThread.id, 5, "turn_nested", "interrupted"),
        completed(completedThread.id, 6, "turn_new", "completed"),
        started(failedThread.id, 1, "turn_fail"),
        completed(failedThread.id, 2, "turn_fail", "failed"),
        started(interruptedThread.id, 1, "turn_stop"),
        completed(interruptedThread.id, 2, "turn_stop", "interrupted"),
        started(nestedOnlyThread.id, 1, "turn_subagent", true),
        completed(nestedOnlyThread.id, 2, "turn_subagent", "completed"),
        started(activeAfterCompletionThread.id, 1, "turn_finished"),
        completed(
          activeAfterCompletionThread.id,
          2,
          "turn_finished",
          "completed",
        ),
        started(activeAfterCompletionThread.id, 3, "turn_active"),
      ]);

      const rows = listLatestRootTurnTerminalOutcomesByThreadIds(db, [
        completedThread.id,
        failedThread.id,
        interruptedThread.id,
        noTurnThread.id,
        nestedOnlyThread.id,
        activeAfterCompletionThread.id,
      ]);
      expect(
        [...rows].sort((left, right) => left.threadId.localeCompare(right.threadId)),
      ).toEqual(
        [
          { threadId: completedThread.id, outcome: "completed" },
          { threadId: failedThread.id, outcome: "failed" },
          { threadId: interruptedThread.id, outcome: "interrupted" },
        ].sort((left, right) => left.threadId.localeCompare(right.threadId)),
      );
    } finally {
      db.$client.close();
    }
  });

  it("omits threads outside the requested set and returns nothing for an empty set", () => {
    const { db, project } = setup();
    try {
      const included = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const excluded = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      insertEvents(db, noopNotifier, [
        started(included.id, 1, "turn_in"),
        completed(included.id, 2, "turn_in", "completed"),
        started(excluded.id, 1, "turn_out"),
        completed(excluded.id, 2, "turn_out", "failed"),
      ]);

      expect(
        listLatestRootTurnTerminalOutcomesByThreadIds(db, [included.id]),
      ).toEqual([{ threadId: included.id, outcome: "completed" }]);
      expect(listLatestRootTurnTerminalOutcomesByThreadIds(db, [])).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("fails closed on a malformed latest root-turn terminal outcome", () => {
    const { db, project } = setup();
    try {
      const malformed = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      insertEvents(db, noopNotifier, [
        started(malformed.id, 1, "turn_malformed"),
        {
          ...completed(malformed.id, 2, "turn_malformed", "completed"),
          data: JSON.stringify({
            providerThreadId: "provider_turn_malformed",
            status: "unknown",
          }),
        },
      ]);

      expect(() =>
        listLatestRootTurnTerminalOutcomesByThreadIds(db, [malformed.id]),
      ).toThrow(InvalidWorkTogetherRoomRootTurnOutcomeError);
    } finally {
      db.$client.close();
    }
  });
});
