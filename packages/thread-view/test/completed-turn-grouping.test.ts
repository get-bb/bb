import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { groupCompletedTurnMessages } from "../src/completed-turn-grouping.js";
import type { CompletedTurnMessageGroups } from "../src/completed-turn-grouping.js";
import type {
  EventProjectionAssistantTextMessage,
  EventProjectionCommandMessage,
  EventProjectionMessage,
  EventProjectionOperationMessage,
  EventProjectionTurnRequest,
  EventProjectionTurn,
  EventProjectionUserMessage,
} from "../src/event-projection-types.js";

interface MessageBaseArgs {
  id: string;
  seq: number;
}

function messageBase({ id, seq }: MessageBaseArgs) {
  return {
    id,
    threadId: "thread-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    createdAt: seq,
    startedAt: seq,
    scope: turnScope("turn-1"),
  };
}

function assistantMessage(
  args: MessageBaseArgs,
): EventProjectionAssistantTextMessage {
  return {
    ...messageBase(args),
    kind: "assistant-text",
    text: args.id,
    status: "completed",
  };
}

function commandMessage(args: MessageBaseArgs): EventProjectionCommandMessage {
  return {
    ...messageBase(args),
    kind: "command",
    callId: args.id,
    command: "pnpm test",
    cwd: "/repo",
    parsedIntents: [],
    source: null,
    output: "",
    exitCode: 0,
    completedAt: args.seq,
    approvalStatus: null,
    status: "completed",
  };
}

interface UserMessageArgs extends MessageBaseArgs {
  initiator?: EventProjectionUserMessage["initiator"];
  turnRequest?: EventProjectionTurnRequest;
}

function userMessage(args: UserMessageArgs): EventProjectionUserMessage {
  return {
    ...messageBase(args),
    kind: "user",
    initiator: args.initiator ?? "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: args.turnRequest ?? {
      isGrouped: false,
      kind: "message",
      status: "accepted",
    },
    text: args.id,
    mentions: [],
  };
}

function legacyUserMessage(
  args: MessageBaseArgs,
): EventProjectionAssistantTextMessage {
  return {
    ...assistantMessage(args),
    isLegacyUserMessage: true,
  };
}

function compactionMessage(
  args: MessageBaseArgs,
): EventProjectionOperationMessage {
  return {
    ...messageBase(args),
    kind: "operation",
    opType: "compaction",
    title: "Context compacted",
    status: "completed",
    completedAt: args.seq,
  };
}

function contextClearMessage(
  args: MessageBaseArgs,
): EventProjectionOperationMessage {
  return {
    ...messageBase(args),
    kind: "operation",
    opType: "context-clear",
    title: "Context cleared",
    status: "completed",
    completedAt: args.seq,
  };
}

function completedTurn(
  messages: EventProjectionMessage[],
  terminalMessage: EventProjectionMessage | undefined,
  summaryCount = messages.length,
): EventProjectionTurn {
  return {
    turnId: "turn-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: messages.length,
    startedAt: 1,
    createdAt: messages.length,
    completedAt: messages.length,
    status: "completed",
    summaryCount,
    messages,
    ...(terminalMessage ? { terminalMessage } : {}),
  };
}

function summarySourceMessageIds(
  groups: CompletedTurnMessageGroups,
): string[][] {
  return groups.summaryItems.flatMap((item) =>
    item.kind === "summary"
      ? [item.sourceMessages.map((message) => message.id)]
      : [],
  );
}

describe("groupCompletedTurnMessages", () => {
  it("unwraps a singleton compaction group after a user message", () => {
    const user = userMessage({ id: "compact-request", seq: 1 });
    const compaction = compactionMessage({ id: "compaction", seq: 2 });
    const turn = completedTurn([user, compaction], undefined);
    turn.externalUserBoundarySeqs = [0];
    const groups = groupCompletedTurnMessages(turn);

    expect(groups.summaryItems).toEqual([
      { kind: "ungrouped-message", message: user },
      { kind: "ungrouped-message", message: compaction },
    ]);
    expect(groups.terminalMessages).toEqual([]);
    expect(groups.trailingMessages).toEqual([]);
  });

  it("unwraps a singleton context-clear group", () => {
    const contextClear = contextClearMessage({
      id: "context-clear",
      seq: 1,
    });
    const groups = groupCompletedTurnMessages(
      completedTurn([contextClear], undefined),
    );

    expect(groups.summaryItems).toEqual([
      { kind: "ungrouped-message", message: contextClear },
    ]);
  });

  it("uses one summary group when no messages are ungroupable", () => {
    const messages = [
      assistantMessage({ id: "assistant-1", seq: 1 }),
      commandMessage({ id: "command-1", seq: 2 }),
    ];
    const groups = groupCompletedTurnMessages(
      completedTurn(messages, undefined),
    );

    expect(groups.summaryItems).toMatchObject([
      {
        kind: "summary",
        startedAt: 1,
        completedAt: 2,
        segmentIndex: null,
        summaryCount: 2,
      },
    ]);
    expect(summarySourceMessageIds(groups)).toEqual([
      ["assistant-1", "command-1"],
    ]);
  });

  it("keeps an assistant response visible when more assistant text follows it directly", () => {
    const answer = assistantMessage({ id: "answer", seq: 1 });
    const hookReply = assistantMessage({ id: "hook-reply", seq: 2 });
    const groups = groupCompletedTurnMessages(
      completedTurn([answer, hookReply], hookReply),
    );

    expect(groups.summaryItems).toEqual([
      { kind: "ungrouped-message", message: answer },
    ]);
    expect(groups.terminalMessages).toEqual([hookReply]);
  });

  it("folds narration that precedes work and keeps the response that precedes the terminal text", () => {
    const narration = assistantMessage({ id: "narration", seq: 1 });
    const command = commandMessage({ id: "command", seq: 2 });
    const answer = assistantMessage({ id: "answer", seq: 3 });
    const hookReply = assistantMessage({ id: "hook-reply", seq: 4 });
    const groups = groupCompletedTurnMessages(
      completedTurn([narration, command, answer, hookReply], hookReply),
    );

    expect(groups.summaryItems).toMatchObject([
      {
        kind: "summary",
        startedAt: 1,
        completedAt: 4,
        segmentIndex: 0,
        sourceMessages: [{ id: "narration" }, { id: "command" }],
        summaryCount: 2,
      },
      { kind: "ungrouped-message", message: { id: "answer" } },
    ]);
    expect(groups.terminalMessages).toEqual([hookReply]);
  });

  it("keeps every response in a run of adjacent assistant texts", () => {
    const first = assistantMessage({ id: "first", seq: 1 });
    const second = assistantMessage({ id: "second", seq: 2 });
    const command = commandMessage({ id: "command", seq: 3 });
    const terminal = assistantMessage({ id: "terminal", seq: 4 });
    const groups = groupCompletedTurnMessages(
      completedTurn([first, second, command, terminal], terminal),
    );

    expect(groups.summaryItems).toMatchObject([
      { kind: "ungrouped-message", message: { id: "first" } },
      {
        kind: "summary",
        sourceMessages: [{ id: "second" }, { id: "command" }],
      },
    ]);
    expect(groups.terminalMessages).toEqual([terminal]);
  });

  it("preserves the last assistant message before an ungroupable user message", () => {
    const assistantBefore = assistantMessage({
      id: "assistant-before",
      seq: 1,
    });
    const assistantAfter = assistantMessage({
      id: "assistant-after",
      seq: 3,
    });
    const turn = completedTurn(
      [assistantBefore, userMessage({ id: "user", seq: 2 }), assistantAfter],
      assistantAfter,
    );
    const groups = groupCompletedTurnMessages(turn);

    expect(groups.summaryItems).toMatchObject([
      {
        kind: "ungrouped-message",
        message: {
          id: "assistant-before",
        },
      },
      {
        kind: "ungrouped-message",
        message: {
          id: "user",
        },
      },
    ]);
    expect(summarySourceMessageIds(groups)).toEqual([]);
    expect(groups.terminalMessages.map((message) => message.id)).toEqual([
      "assistant-after",
    ]);
  });

  it("does not segment summary groups around agent and system steers", () => {
    const turn = completedTurn(
      [
        assistantMessage({ id: "assistant-before", seq: 1 }),
        userMessage({
          id: "agent-steer",
          initiator: "agent",
          seq: 2,
          turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
        }),
        userMessage({
          id: "system-steer",
          initiator: "system",
          seq: 3,
          turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
        }),
        assistantMessage({ id: "assistant-after", seq: 4 }),
      ],
      undefined,
    );
    const groups = groupCompletedTurnMessages(turn);

    expect(groups.summaryItems).toMatchObject([
      {
        kind: "summary",
        startedAt: 1,
        completedAt: 4,
        segmentIndex: null,
        summaryCount: 4,
      },
    ]);
    expect(summarySourceMessageIds(groups)).toEqual([
      ["assistant-before", "agent-steer", "system-steer", "assistant-after"],
    ]);
  });

  it("segments summary groups around converted legacy user messages", () => {
    const turn = completedTurn(
      [
        assistantMessage({ id: "assistant-before", seq: 1 }),
        legacyUserMessage({ id: "legacy-user-message", seq: 2 }),
        assistantMessage({ id: "assistant-after", seq: 3 }),
      ],
      undefined,
    );
    const groups = groupCompletedTurnMessages(turn);

    expect(groups.summaryItems).toMatchObject([
      {
        kind: "summary",
        startedAt: 1,
        completedAt: null,
        segmentIndex: 0,
        summaryCount: 1,
      },
      {
        kind: "ungrouped-message",
        message: {
          id: "legacy-user-message",
        },
      },
      {
        kind: "summary",
        startedAt: 3,
        completedAt: null,
        segmentIndex: 1,
        summaryCount: 1,
      },
    ]);
    expect(summarySourceMessageIds(groups)).toEqual([
      ["assistant-before"],
      ["assistant-after"],
    ]);
  });

  it("slices terminal and trailing messages out of the summary groups", () => {
    const before = commandMessage({ id: "before", seq: 1 });
    const terminal = assistantMessage({ id: "terminal", seq: 2 });
    const trailing = assistantMessage({ id: "trailing", seq: 3 });
    const groups = groupCompletedTurnMessages(
      completedTurn([before, terminal, trailing], terminal),
    );

    expect(summarySourceMessageIds(groups)).toEqual([["before"]]);
    expect(groups.summaryItems).toMatchObject([
      {
        kind: "summary",
        sourceMessages: [{ id: "before" }],
      },
    ]);
    expect(groups.terminalMessages.map((message) => message.id)).toEqual([
      "terminal",
    ]);
    expect(groups.trailingMessages.map((message) => message.id)).toEqual([
      "trailing",
    ]);
  });
});
