import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { Thread } from "@bb/domain";
import {
  createProject,
  createThread,
  insertEvents,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { DbConnection } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";

const providerThreadId = "provider-root";
const PARENT_INDEX = "events_parent_tool_call_thread_parent_sequence_idx";

function setup(): { db: DbConnection; thread: Thread } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
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

function insertDelegatedTurn(db: DbConnection, thread: Thread): void {
  const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const agentItem = {
    type: "toolCall",
    id: "toolu_agent",
    tool: "Agent",
    arguments: { prompt: "Run the child.", subagent_type: "general-purpose" },
  };
  const childMessage = (sequence: number, turnId: string, text: string) => ({
    threadId: thread.id,
    sequence,
    type: "item/completed" as const,
    scope: turnScope(turnId),
    providerThreadId,
    itemId: `child-message-${sequence}`,
    itemKind: "agentMessage" as const,
    parentToolCallId: "toolu_agent",
    data: JSON.stringify({
      item: {
        type: "agentMessage",
        id: `child-message-${sequence}`,
        text,
        parentToolCallId: "toolu_agent",
      },
    }),
  });
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "spawn",
        initiator: "user",
        request: { method: "thread/start", params: {} },
        requestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Delegate.", mentions: [] }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 2,
      type: "turn/started",
      scope: turnScope("root-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: 3,
      type: "turn/input/accepted",
      scope: turnScope("root-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId: requestId }),
    },
    {
      threadId: thread.id,
      sequence: 4,
      type: "item/started",
      scope: turnScope("root-turn"),
      providerThreadId,
      itemId: "toolu_agent",
      itemKind: "toolCall",
      parentToolCallId: null,
      data: JSON.stringify({ item: { ...agentItem, status: "pending" } }),
    },
    childMessage(5, "root-turn", "SAME_TURN_CHILD_OUTPUT"),
    {
      threadId: thread.id,
      sequence: 6,
      type: "turn/started",
      scope: turnScope("child-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: "toolu_agent",
      data: JSON.stringify({ parentToolCallId: "toolu_agent" }),
    },
    childMessage(7, "child-turn", "CHILD_TURN_OUTPUT"),
    {
      threadId: thread.id,
      sequence: 8,
      type: "item/completed",
      scope: turnScope("root-turn"),
      providerThreadId,
      itemId: "toolu_agent",
      itemKind: "toolCall",
      parentToolCallId: null,
      data: JSON.stringify({
        item: { ...agentItem, result: "AGENT_RESULT", status: "completed" },
      }),
    },
  ]);
}

function captureParentedRowReads(
  db: DbConnection,
  run: () => void,
): number[][] {
  const reads: number[][] = [];
  const client = db.$client;
  const originalPrepare = client.prepare.bind(client);
  Object.defineProperty(client, "prepare", {
    configurable: true,
    writable: true,
    value: (source: string) => {
      const statement = originalPrepare(source);
      if (!source.includes(PARENT_INDEX)) return statement;
      const originalAll = statement.all.bind(statement);
      statement.all = (...params: unknown[]) => {
        const rows = originalAll(...params) as { sequence: number }[];
        reads.push(rows.map((row) => row.sequence));
        return rows;
      };
      return statement;
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(client, "prepare", {
      configurable: true,
      writable: true,
      value: originalPrepare,
    });
  }
  return reads;
}

function conversationTexts(rows: readonly TimelineRow[]): string[] {
  return rows.flatMap((row) => [
    ...(row.kind === "conversation" ? [row.text] : []),
    ...conversationTexts(
      row.kind === "turn"
        ? (row.children ?? [])
        : row.kind === "work" && row.workKind === "delegation"
          ? (row.childRows ?? [])
          : [],
    ),
  ]);
}

describe("timeline parented row reads", () => {
  it("reads a delegated call's children once and skips children loaded with their turn", () => {
    const { db, thread } = setup();
    insertDelegatedTurn(db, thread);
    let rows: readonly TimelineRow[] = [];

    const reads = captureParentedRowReads(db, () => {
      rows = buildThreadTimelineWithProfile(db, thread, {
        completedTurnDisplay: "collapse",
        eventBudget: 1_000_000,
        includeClearedContextHistory: false,
        includeDiagnosticOperations: false,
        compactionOfferEnabled: false,
        summarizeShellCommands: true,
        includeNestedRows: true,
        maxInlineOutputChars: null,
        maxSeq: 8,
        page: { kind: "latest", segmentLimit: 20 },
      }).response.rows;
    });

    expect(reads).toEqual([[6, 7]]);
    expect(conversationTexts(rows)).toEqual(
      expect.arrayContaining(["SAME_TURN_CHILD_OUTPUT", "CHILD_TURN_OUTPUT"]),
    );
  });
});
