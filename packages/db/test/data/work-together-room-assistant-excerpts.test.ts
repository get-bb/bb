import { threadScope, turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";

import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { insertEvents } from "../../src/data/events.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  InvalidWorkTogetherRoomAssistantExcerptError,
  listLatestCompletedAgentMessageExcerptsByThreadIds,
} from "../../src/data/work-together-room-assistant-excerpts.js";

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

function agentMessage(
  threadId: string,
  sequence: number,
  turnId: string,
  text: string,
  parentToolCallId?: string,
) {
  const itemId = `${turnId}-assistant`;
  return {
    threadId,
    sequence,
    type: "item/completed" as const,
    itemId,
    itemKind: "agentMessage" as const,
    scope: turnScope(turnId),
    data: JSON.stringify({
      item: {
        type: "agentMessage",
        id: itemId,
        text,
        ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      },
    }),
  };
}

function turnStarted(
  threadId: string,
  sequence: number,
  turnId: string,
  parentToolCallId?: string,
) {
  return {
    threadId,
    sequence,
    type: "turn/started" as const,
    itemId: null,
    itemKind: null,
    scope: turnScope(turnId),
    data: JSON.stringify(
      parentToolCallId === undefined ? {} : { parentToolCallId },
    ),
  };
}

function managerUserMessage(threadId: string, sequence: number, text: string) {
  return {
    threadId,
    sequence,
    type: "system/manager/user_message" as const,
    itemId: null,
    itemKind: null,
    scope: threadScope(),
    data: JSON.stringify({ text }),
  };
}

describe("latest completed agent message excerpts", () => {
  it("returns the latest completed agentMessage text per thread and ignores manager messages", () => {
    const { db, project } = setup();
    try {
      const included = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const empty = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const managerOnly = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const laterEmpty = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      insertEvents(db, noopNotifier, [
        turnStarted(included.id, 1, "turn_old"),
        agentMessage(included.id, 2, "turn_old", "Older answer."),
        turnStarted(included.id, 3, "turn_new"),
        agentMessage(included.id, 4, "turn_new", "Latest answer."),
        managerUserMessage(included.id, 5, "Manager should not win."),
        turnStarted(
          included.id,
          6,
          "turn_nested_without_item_parent",
          "call_nested_helper",
        ),
        agentMessage(
          included.id,
          7,
          "turn_nested_without_item_parent",
          "Nested helper output without an item parent should not win.",
        ),
        turnStarted(
          included.id,
          8,
          "turn_nested",
          "call_nested_helper",
        ),
        agentMessage(
          included.id,
          9,
          "turn_nested",
          "Nested helper output should not win.",
          "call_nested_helper",
        ),
        managerUserMessage(managerOnly.id, 1, "Only a manager note."),
        turnStarted(laterEmpty.id, 1, "turn_text"),
        agentMessage(laterEmpty.id, 2, "turn_text", "Prior answer."),
        turnStarted(laterEmpty.id, 3, "turn_blank"),
        agentMessage(laterEmpty.id, 4, "turn_blank", ""),
      ]);

      const rows = listLatestCompletedAgentMessageExcerptsByThreadIds(db, [
        included.id,
        empty.id,
        managerOnly.id,
        laterEmpty.id,
      ]);
      expect(
        [...rows].sort((left, right) =>
          left.threadId.localeCompare(right.threadId),
        ),
      ).toEqual([{ threadId: included.id, excerpt: "Latest answer." }]);
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
        turnStarted(included.id, 1, "turn_in"),
        agentMessage(included.id, 2, "turn_in", "Included."),
        turnStarted(excluded.id, 1, "turn_out"),
        agentMessage(excluded.id, 2, "turn_out", "Excluded."),
      ]);

      expect(
        listLatestCompletedAgentMessageExcerptsByThreadIds(db, [included.id]),
      ).toEqual([{ threadId: included.id, excerpt: "Included." }]);
      expect(
        listLatestCompletedAgentMessageExcerptsByThreadIds(db, []),
      ).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("fails closed on a malformed latest completed agentMessage", () => {
    const { db, project } = setup();
    try {
      const malformed = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      insertEvents(db, noopNotifier, [
        turnStarted(malformed.id, 1, "turn_malformed"),
        {
          ...agentMessage(malformed.id, 2, "turn_malformed", "valid"),
          data: JSON.stringify({ item: { type: "agentMessage", id: "x" } }),
        },
      ]);

      expect(() =>
        listLatestCompletedAgentMessageExcerptsByThreadIds(db, [malformed.id]),
      ).toThrow(InvalidWorkTogetherRoomAssistantExcerptError);
    } finally {
      db.$client.close();
    }
  });
});
