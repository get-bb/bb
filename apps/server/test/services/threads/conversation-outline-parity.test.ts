import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import {
  buildThreadConversationOutline,
  buildThreadTimeline,
} from "../../../src/services/threads/timeline.js";

type EventInput = Parameters<typeof insertEvents>[2][number];

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
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
  });
  return { db, thread };
}

function agentMessage(
  threadId: string,
  sequence: number,
  text: string,
): EventInput {
  return {
    threadId,
    sequence,
    type: "item/completed",
    scope: turnScope("turn-1"),
    providerThreadId: "provider-thread-1",
    itemId: `message-${sequence}`,
    itemKind: "agentMessage",
    data: JSON.stringify({
      item: { id: `message-${sequence}`, type: "agentMessage", text },
    }),
  };
}

function userQuestionLifecycle(
  threadId: string,
  sequence: number,
  status: "pending" | "resolved",
): EventInput {
  return {
    threadId,
    sequence,
    type: "system/userQuestion/lifecycle",
    scope: turnScope("turn-1"),
    itemId: null,
    itemKind: null,
    data: JSON.stringify({
      interactionId: "pi-user-question",
      providerId: "claude-code",
      providerRequestId: "request-user-question",
      status,
      resolution:
        status === "resolved"
          ? {
              kind: "user_answer",
              answers: { "question-1": { selected: ["staging"] } },
            }
          : null,
      statusReason: null,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "question-1",
            prompt: "Which deployment target should I use?",
            shortLabel: "Target",
            multiSelect: false,
            options: [
              { value: "staging", label: "Staging" },
              { value: "production", label: "Production" },
            ],
            allowFreeText: false,
          },
        ],
      },
    }),
  };
}

describe("thread conversation outline parity", () => {
  it("exposes the same conversation rows as the timeline after an answered question", () => {
    const { db, thread } = setup();
    const requestId = "creq_23456789ab";
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          requestId,
          source: "tell",
          initiator: "user",
          input: [{ type: "text", text: "Audit the router", mentions: [] }],
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "claude-opus-4",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "default",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId: requestId }),
      },
      userQuestionLifecycle(thread.id, 4, "pending"),
      userQuestionLifecycle(thread.id, 5, "resolved"),
      agentMessage(thread.id, 6, "Staging it is."),
      agentMessage(thread.id, 7, "Login works."),
      agentMessage(thread.id, 8, "Audit complete."),
      agentMessage(thread.id, 9, "Final runbook."),
      {
        threadId: thread.id,
        sequence: 10,
        type: "turn/completed",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ status: "completed" }),
      },
    ]);

    const timeline = buildThreadTimeline(db, thread, {
      eventBudget: 1_000_000,
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: null,
      maxSeq: 10,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const timelineConversation = timeline.rows.flatMap((row) =>
      row.kind === "conversation" ? [{ id: row.id, text: row.text }] : [],
    );
    // The answered question splits the turn: the direct reply and the
    // segment-final message are visible, the interim one stays folded.
    expect(timelineConversation.map((row) => row.text)).toEqual([
      "Audit the router",
      "Staging it is.",
      "Audit complete.",
      "Final runbook.",
    ]);

    const outline = buildThreadConversationOutline(db, thread, { maxSeq: 10 });
    expect(
      outline.items.map((item) => ({ id: item.id, text: item.preview })),
    ).toEqual(timelineConversation);
    db.$client.close();
  });
});
