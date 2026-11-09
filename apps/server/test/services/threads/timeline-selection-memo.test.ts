import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  LOCAL_WORKFLOW_TASK_TYPE,
  THREAD_CONTEXT_CLEAR_OPERATION,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
import {
  advanceThreadPruning,
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestThreadSequence,
  noopNotifier,
  threads,
} from "@bb/db";
import { pruneThreadEventHistory } from "../../../src/services/system/event-pruning.js";
import {
  clearTimelineOrderingContextCache,
  getTimelineGroupingContext,
} from "../../../src/services/threads/timeline-context-order.js";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import {
  countTimelineSelectionMemoEntries,
  TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
  TIMELINE_SELECTION_MEMO_MAX_IDLE_ENTRIES,
} from "../../../src/services/threads/timeline-selection-memo.js";
import { createTestProviderRegistry } from "../../helpers/provider-registry.js";
import {
  appendRows as append,
  createRandom,
  PROVIDER_THREAD_ID as providerThreadId,
  withTestThread,
  type Random,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";
import {
  buildRouteTimelinePage,
  clearCrossBuildTimelineCaches,
  selectionWasReused,
  type BuiltTimelinePage,
  type TimelineVariant,
} from "../../provider-corpus/corpus-harness.js";

interface BuildArgs {
  eventBudget: number;
  extensionStateKinds?: readonly string[];
  includeDiagnosticOperations: boolean;
  maxSeq?: number;
  page: ThreadTimelinePageRequest;
  variant: TimelineVariant;
}

interface ClosedTurn {
  commandId: string | null;
  messageId: string | null;
  turnId: string;
}

interface SessionState {
  closedTurns: ClosedTurn[];
  itemCounter: number;
  lastCommandId: string | null;
  lastMessageId: string | null;
  openCommandId: string | null;
  openMessage: { id: string; text: string } | null;
  openReasoningId: string | null;
  openSubTurnId: string | null;
  openTaskId: string | null;
  openTaskParentId: string | null;
  openToolCallId: string | null;
  openTurnId: string | null;
  requestCounter: number;
  turnCounter: number;
}

const SEEDS = 5;
const STEPS = 70;
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;
const registry = await createTestProviderRegistry();

function userRequest(
  value: number,
  target: Record<string, unknown>,
  text: string,
): RowSpec {
  return {
    data: {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: encodeClientTurnRequestIdNumber({ value }),
      senderThreadId: null,
      input: [{ type: "text", text, mentions: [] }],
      target,
      execution,
    },
    type: "client/turn/requested",
  };
}

function acceptedInput(value: number, turnId: string): RowSpec {
  return {
    data: { clientRequestId: encodeClientTurnRequestIdNumber({ value }) },
    turnId,
    type: "turn/input/accepted",
  };
}

function itemRow(
  type: "item/started" | "item/completed",
  turnId: string,
  item: Record<string, unknown> & { id: string; type: ThreadEventItemType },
  parentToolCallId: string | null = null,
): RowSpec {
  return {
    data: {
      item: parentToolCallId === null ? item : { ...item, parentToolCallId },
    },
    itemId: item.id,
    itemKind: item.type,
    parentToolCallId,
    turnId,
    type,
  };
}

function deltaRow(
  type: ThreadEventType,
  turnId: string,
  itemId: string,
  delta: string,
): RowSpec {
  return { data: { itemId, delta }, itemId, turnId, type };
}

function messageDelta(turnId: string, itemId: string, delta: string): RowSpec {
  return deltaRow("item/agentMessage/delta", turnId, itemId, delta);
}

function messageStarted(turnId: string, id: string): RowSpec {
  return itemRow("item/started", turnId, {
    id,
    text: "",
    type: "agentMessage",
  });
}

function agentToolCall(
  type: "item/started" | "item/completed",
  turnId: string,
  id: string,
): RowSpec {
  return itemRow(type, turnId, {
    arguments: { prompt: "Investigate" },
    id,
    ...(type === "item/started"
      ? { status: "pending" }
      : { result: "done", status: "completed" }),
    tool: "Agent",
    type: "toolCall",
  });
}

function childCommand(
  turnId: string,
  id: string,
  parentToolCallId: string,
): RowSpec {
  return itemRow(
    "item/completed",
    turnId,
    {
      aggregatedOutput: "child output\n",
      approvalStatus: null,
      command: "echo child",
      cwd: "/tmp/memo",
      exitCode: 0,
      id,
      status: "completed",
      type: "commandExecution",
    },
    parentToolCallId,
  );
}

function workflowTask(id: string, completed: boolean) {
  return {
    description: "workflow",
    id,
    skipTranscript: false,
    foreground: false,
    status: completed ? "completed" : "pending",
    taskStatus: completed ? "completed" : "running",
    taskType: LOCAL_WORKFLOW_TASK_TYPE,
    type: "backgroundTask",
    workflowName: "workflow",
  } as const;
}

function workflowTaskUpdate(
  id: string,
  completed: boolean,
  parentToolCallId: string | null = null,
): RowSpec {
  return {
    data: { item: workflowTask(id, completed) },
    itemId: id,
    itemKind: "backgroundTask",
    parentToolCallId,
    providerThreadId,
    type: completed
      ? "item/backgroundTask/completed"
      : "item/backgroundTask/progress",
  };
}

function contextUsage(
  turnId: string,
  usedTokens: number,
  parentToolCallId: string | null = null,
): RowSpec {
  return {
    data: {
      contextWindowUsage: {
        estimated: false,
        modelContextWindow: 200_000,
        usedTokens,
      },
    },
    parentToolCallId,
    turnId,
    type: "thread/contextWindowUsage/updated",
  };
}

function completeTurn(
  state: SessionState,
  turnId: string,
  status = "completed",
): RowSpec {
  closeTurn(state, turnId);
  return { data: { status }, turnId, type: "turn/completed" };
}

function startTurn(state: SessionState): RowSpec[] {
  state.turnCounter += 1;
  state.requestCounter += 1;
  const turnId = `turn-${state.turnCounter}`;
  state.openTurnId = turnId;
  state.openMessage = null;
  state.openReasoningId = null;
  state.openCommandId = null;
  state.openToolCallId = null;
  state.openSubTurnId = null;
  state.lastCommandId = null;
  state.lastMessageId = null;
  return [
    userRequest(
      state.requestCounter,
      state.turnCounter === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
      `User message ${state.turnCounter}`,
    ),
    { data: {}, turnId, type: "turn/started" },
    acceptedInput(state.requestCounter, turnId),
  ];
}

function nextItemId(state: SessionState, prefix: string): string {
  state.itemCounter += 1;
  return `${prefix}-${state.itemCounter}`;
}

function closeTurn(state: SessionState, turnId: string): void {
  state.closedTurns.push({
    commandId: state.lastCommandId,
    messageId: state.lastMessageId,
    turnId,
  });
  state.openTurnId = null;
}

function lateDeltaRows(state: SessionState, random: Random): RowSpec[] {
  const closed =
    state.closedTurns[Math.floor(random() * state.closedTurns.length)];
  if (closed === undefined) return [];
  if (closed.commandId !== null && random() < 0.6) {
    return [
      deltaRow(
        "item/commandExecution/outputDelta",
        closed.turnId,
        closed.commandId,
        "late output\n",
      ),
    ];
  }
  return [
    messageDelta(
      closed.turnId,
      closed.messageId ?? nextItemId(state, "late-message"),
      random() < 0.5 ? "late line\n" : "late word ",
    ),
  ];
}

function contextClear(operationId: string): RowSpec {
  return {
    data: {
      operation: THREAD_CONTEXT_CLEAR_OPERATION,
      operationId,
      status: "completed",
      message: "Fresh context",
    },
    type: "system/operation",
  };
}

function randomSessionRows(state: SessionState, random: Random): RowSpec[] {
  const turnId = state.openTurnId;
  const outOfOrder = random();
  if (outOfOrder < 0.05 && state.closedTurns.length > 0) {
    return lateDeltaRows(state, random);
  }
  if (outOfOrder < 0.08) {
    const turnNumber = state.turnCounter + 1;
    return [
      messageDelta(
        `turn-${turnNumber}`,
        `early-message-${turnNumber}`,
        "early ",
      ),
    ];
  }
  if (turnId === null) {
    if (random() < 0.1) {
      return [contextClear(`clear-${state.itemCounter}`)];
    }
    return startTurn(state);
  }
  const choice = random();
  if (choice < 0.34) {
    const rows: RowSpec[] = [];
    if (state.openMessage === null) {
      state.openMessage = { id: nextItemId(state, "message"), text: "" };
      state.lastMessageId = state.openMessage.id;
      rows.push(messageStarted(turnId, state.openMessage.id));
    }
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const delta = random() < 0.3 ? `line ${index}\n` : `word${index} `;
      state.openMessage.text += delta;
      rows.push(messageDelta(turnId, state.openMessage.id, delta));
    }
    return rows;
  }
  if (choice < 0.4 && state.openMessage !== null) {
    const message = state.openMessage;
    state.openMessage = null;
    return [
      itemRow("item/completed", turnId, {
        id: message.id,
        text: message.text,
        type: "agentMessage",
      }),
    ];
  }
  if (choice < 0.48) {
    const rows: RowSpec[] = [];
    if (state.openReasoningId === null) {
      state.openReasoningId = nextItemId(state, "reasoning");
      rows.push(
        itemRow("item/started", turnId, {
          content: [],
          id: state.openReasoningId,
          summary: [],
          type: "reasoning",
        }),
      );
    }
    rows.push(
      deltaRow(
        random() < 0.5
          ? "item/reasoning/textDelta"
          : "item/reasoning/summaryTextDelta",
        turnId,
        state.openReasoningId,
        "thinking ",
      ),
    );
    if (random() < 0.2) {
      rows.push(
        itemRow("item/completed", turnId, {
          content: ["thinking"],
          id: state.openReasoningId,
          summary: ["summary"],
          type: "reasoning",
        }),
      );
      state.openReasoningId = null;
    }
    return rows;
  }
  if (choice < 0.56) {
    const rows: RowSpec[] = [];
    const command = {
      approvalStatus: null,
      command: "pnpm test",
      cwd: "/tmp/memo",
      type: "commandExecution",
    } as const;
    if (state.openCommandId === null) {
      state.openCommandId = nextItemId(state, "command");
      state.lastCommandId = state.openCommandId;
      rows.push(
        itemRow("item/started", turnId, {
          ...command,
          id: state.openCommandId,
          status: "pending",
        }),
      );
    }
    rows.push(
      deltaRow(
        "item/commandExecution/outputDelta",
        turnId,
        state.openCommandId,
        "ok\n",
      ),
    );
    if (random() < 0.3) {
      rows.push(
        itemRow("item/completed", turnId, {
          ...command,
          aggregatedOutput: "ok\n",
          exitCode: 0,
          id: state.openCommandId,
          status: "completed",
        }),
      );
      state.openCommandId = null;
    }
    return rows;
  }
  if (choice < 0.64) {
    if (state.openToolCallId === null) {
      state.openToolCallId = nextItemId(state, "agent");
      return [agentToolCall("item/started", turnId, state.openToolCallId)];
    }
    const toolCallId = state.openToolCallId;
    const roll = random();
    if (roll < 0.35) {
      return [
        {
          data: { itemId: toolCallId, message: "working" },
          itemId: toolCallId,
          turnId,
          type: "item/toolCall/progress",
        },
      ];
    }
    if (roll < 0.5 && state.openSubTurnId === null) {
      state.openSubTurnId = nextItemId(state, "sub-turn");
      return [
        {
          data: {},
          parentToolCallId: toolCallId,
          turnId: state.openSubTurnId,
          type: "turn/started",
        },
      ];
    }
    if (roll < 0.75) {
      return [
        childCommand(
          state.openSubTurnId ?? turnId,
          nextItemId(state, "child"),
          toolCallId,
        ),
      ];
    }
    const subTurnId = state.openSubTurnId;
    state.openToolCallId = null;
    state.openSubTurnId = null;
    return [
      ...(subTurnId === null
        ? []
        : [
            {
              data: { status: "completed" },
              parentToolCallId: toolCallId,
              turnId: subTurnId,
              type: "turn/completed",
            } satisfies RowSpec,
          ]),
      agentToolCall("item/completed", turnId, toolCallId),
    ];
  }
  if (choice < 0.7) {
    state.requestCounter += 1;
    return [
      userRequest(
        state.requestCounter,
        { kind: "steer", expectedTurnId: turnId },
        `Steer ${state.requestCounter}`,
      ),
      acceptedInput(state.requestCounter, turnId),
    ];
  }
  if (choice < 0.8) {
    const roll = random();
    if (roll < 0.4) {
      return [contextUsage(turnId, state.itemCounter * 10)];
    }
    if (roll < 0.7) {
      const breakdown = {
        cachedInputTokens: 0,
        inputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      };
      return [
        {
          data: {
            tokenUsage: {
              last: breakdown,
              modelContextWindow: 200_000,
              total: breakdown,
            },
          },
          turnId,
          type: "thread/tokenUsage/updated",
        },
      ];
    }
    return [
      { data: { diff: "diff --git" }, turnId, type: "turn/diff/updated" },
    ];
  }
  if (choice < 0.86) {
    if (state.openTaskId === null) {
      state.openTaskId = `task:${nextItemId(state, "wf")}`;
      const parentRoll = random();
      state.openTaskParentId =
        parentRoll < 0.3
          ? state.lastCommandId
          : parentRoll < 0.5
            ? state.openToolCallId
            : null;
      return [
        itemRow(
          "item/started",
          turnId,
          workflowTask(state.openTaskId, false),
          state.openTaskParentId,
        ),
      ];
    }
    const taskId = state.openTaskId;
    const completed = random() < 0.4;
    if (completed) state.openTaskId = null;
    return [workflowTaskUpdate(taskId, completed, state.openTaskParentId)];
  }
  if (choice < 0.93) {
    return [completeTurn(state, turnId)];
  }
  closeTurn(state, turnId);
  return [
    { data: { reason: "manual-stop" }, type: "system/thread/interrupted" },
  ];
}

function expectWarmEqualsCold(
  testThread: TestThread,
  args: BuildArgs,
  label: string,
): BuiltTimelinePage {
  const build = (db: TestThread["db"]) =>
    buildRouteTimelinePage({
      ...args,
      db,
      registry,
      thread: testThread.thread,
    });
  const warm = build(testThread.db);
  clearCrossBuildTimelineCaches(testThread.coldDb);
  clearTimelineOrderingContextCache(testThread.coldDb);
  const cold = build(testThread.coldDb);
  expect(selectionWasReused(cold.profile)).toBe(false);
  expect(JSON.stringify(warm.response), label).toBe(
    JSON.stringify(cold.response),
  );
  const profileSummary = ({ profile }: BuiltTimelinePage) => ({
    eventDataBytes: profile.eventDataBytes,
    eventRowCount: profile.eventRowCount,
    selectionStrategy: profile.selectionStrategy,
  });
  expect(profileSummary(warm), label).toEqual(profileSummary(cold));
  return warm;
}

function walkOlderPages(
  testThread: TestThread,
  latest: BuiltTimelinePage,
  args: BuildArgs,
  label: string,
): void {
  let page = latest;
  for (let depth = 0; depth < 10; depth += 1) {
    const cursor = page.response.timelinePage.olderCursor;
    if (page.response.timelinePage.olderCursor === null || cursor === null)
      return;
    page = expectWarmEqualsCold(
      testThread,
      {
        ...args,
        page: {
          beforeCursor: cursor,
          kind: "older",
          segmentLimit: args.page.segmentLimit,
        },
      },
      `${label} older ${depth}`,
    );
  }
}

function initialState(): SessionState {
  return {
    closedTurns: [],
    itemCounter: 0,
    lastCommandId: null,
    lastMessageId: null,
    openCommandId: null,
    openMessage: null,
    openReasoningId: null,
    openSubTurnId: null,
    openTaskId: null,
    openTaskParentId: null,
    openToolCallId: null,
    openTurnId: null,
    requestCounter: 0,
    turnCounter: 0,
  };
}

function latestArgs(
  variant: TimelineVariant,
  includeDiagnosticOperations = false,
): BuildArgs {
  return {
    eventBudget: 20,
    includeDiagnosticOperations,
    page: { kind: "latest", segmentLimit: 3 },
    variant,
  };
}

const CODEX_GOAL_KIND = "provider-codex/goal";

const singleSegmentArgs: BuildArgs = {
  eventBudget: 200,
  includeDiagnosticOperations: false,
  page: { kind: "latest", segmentLimit: 1 },
  variant: "default",
};

function goalRow(threadId: string, objective: string): RowSpec {
  return {
    data: {
      threadId,
      providerThreadId,
      objective,
      status: "active",
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 1,
    },
    providerThreadId,
    type: "thread/goal/updated",
  };
}

function planStepsRow(turnId: string, id: string, step: string): RowSpec {
  return itemRow("item/completed", turnId, {
    type: "planSteps",
    id,
    steps: [
      { step, status: "active" },
      { step: `${step} docs`, status: "pending" },
    ],
    status: "completed",
  });
}

function advanceSettledThreadPruning(
  testThread: TestThread,
  policy: "resolved-items" | "usage",
) {
  testThread.db
    .update(threads)
    .set({ status: "idle" })
    .where(eq(threads.id, testThread.thread.id))
    .run();
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    return advanceThreadPruning(testThread.db, policy);
  } finally {
    now.mockRestore();
  }
}

function pruneUsageSnapshots(testThread: TestThread): void {
  for (let pass = 0; pass < 100; pass += 1) {
    if (
      advanceSettledThreadPruning(testThread, "usage").action ===
      "cycle-complete"
    )
      return;
  }
  throw new Error("Usage pruning did not finish a cycle");
}

describe("latest timeline selection memo", () => {
  it("matches a cold build over randomized streaming, out-of-order deltas, rewrites, prunes and context clears", () => {
    let reused = 0;
    let rebuilt = 0;
    let narrowerReused = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = createRandom(seed);
      const narrowerOrder = createRandom(seed + 1_000);
      withTestThread((testThread) => {
        const state = initialState();
        for (let step = 0; step < STEPS; step += 1) {
          const roll = random();
          const latest = getLatestThreadSequence(testThread.db, {
            threadId: testThread.thread.id,
          });
          if (step > 8 && roll < 0.05) {
            testThread.db.transaction((tx) => {
              deleteThreadEventSuffixInTransaction(tx, {
                cutoffSequence: Math.max(1, latest - Math.floor(random() * 3)),
                oldMaxSequence: latest,
                threadId: testThread.thread.id,
              });
            });
            Object.assign(state, {
              ...initialState(),
              closedTurns: state.closedTurns,
              itemCounter: state.itemCounter,
              requestCounter: state.requestCounter,
              turnCounter: state.turnCounter,
            });
          } else if (step > 8 && roll < 0.1) {
            pruneThreadEventHistory(
              { db: testThread.db },
              { mode: "active", threadId: testThread.thread.id },
            );
            pruneUsageSnapshots(testThread);
          } else {
            append(testThread, randomSessionRows(state, random));
          }
          const label = JSON.stringify({ seed, step });
          const includeDiagnosticOperations = random() < 0.2;
          const narrowerArgs: BuildArgs = {
            ...latestArgs("default", includeDiagnosticOperations),
            page: { kind: "latest", segmentLimit: 1 },
          };
          const narrowerFirst = narrowerOrder() < 0.5;
          if (narrowerFirst) {
            expectWarmEqualsCold(testThread, narrowerArgs, `${label} narrower`);
          }
          const warm = expectWarmEqualsCold(
            testThread,
            latestArgs("default", includeDiagnosticOperations),
            label,
          );
          if (!narrowerFirst) {
            const narrower = expectWarmEqualsCold(
              testThread,
              narrowerArgs,
              `${label} narrower`,
            );
            if (selectionWasReused(narrower.profile)) narrowerReused += 1;
          }
          if (selectionWasReused(warm.profile)) {
            reused += 1;
          } else {
            rebuilt += 1;
          }
          expectWarmEqualsCold(
            testThread,
            latestArgs("nested", includeDiagnosticOperations),
            `${label} nested`,
          );
          if (step % 10 === 9) {
            walkOlderPages(
              testThread,
              warm,
              latestArgs("default", includeDiagnosticOperations),
              label,
            );
          }
        }
      });
    }
    expect(reused).toBeGreaterThan(SEEDS * 10);
    expect(rebuilt).toBeGreaterThan(SEEDS * 15);
    expect(narrowerReused).toBeGreaterThan(SEEDS * 10);
  }, 120_000);

  it("reuses the selection for fetched turns, parents without rows and childless tool calls", () => {
    withTestThread((testThread) => {
      const args = latestArgs("default");
      append(testThread, [
        ...startTurn(initialState()),
        messageStarted("turn-1", "message-1"),
      ]);
      const initial = expectWarmEqualsCold(testThread, args, "initial");
      expect(selectionWasReused(initial.profile)).toBe(false);

      append(testThread, [
        messageDelta("turn-1", "message-1", "Hello"),
        messageDelta("turn-1", "message-1", " world\n"),
        contextUsage("turn-1", 12),
      ]);
      const delta = expectWarmEqualsCold(testThread, args, "delta");
      expect(selectionWasReused(delta.profile)).toBe(true);
      const nested = expectWarmEqualsCold(
        testThread,
        latestArgs("nested"),
        "nested at the same sequence",
      );
      expect(selectionWasReused(nested.profile)).toBe(true);

      append(testThread, [
        itemRow("item/started", "turn-1", {
          approvalStatus: null,
          command: "ls",
          cwd: "/tmp/memo",
          id: "command-1",
          status: "pending",
          type: "commandExecution",
        }),
      ]);
      const lifecycle = expectWarmEqualsCold(testThread, args, "lifecycle");
      expect(selectionWasReused(lifecycle.profile)).toBe(true);

      append(testThread, [
        deltaRow(
          "item/commandExecution/outputDelta",
          "turn-1",
          "command-1",
          "file\n",
        ),
      ]);
      const outputDelta = expectWarmEqualsCold(testThread, args, "output");
      expect(selectionWasReused(outputDelta.profile)).toBe(true);

      append(testThread, [
        {
          ...messageDelta("turn-1", "message-1", "nested"),
          parentToolCallId: "agent-1",
        },
      ]);
      const parented = expectWarmEqualsCold(testThread, args, "parented");
      expect(selectionWasReused(parented.profile)).toBe(true);

      append(testThread, [agentToolCall("item/started", "turn-1", "agent-1")]);
      const parentArrived = expectWarmEqualsCold(
        testThread,
        args,
        "parent of an earlier child",
      );
      expect(selectionWasReused(parentArrived.profile)).toBe(false);

      append(testThread, [agentToolCall("item/started", "turn-1", "agent-2")]);
      const delegating = expectWarmEqualsCold(testThread, args, "delegating");
      expect(selectionWasReused(delegating.profile)).toBe(true);

      append(testThread, [childCommand("turn-1", "child-1", "agent-2")]);
      const child = expectWarmEqualsCold(testThread, args, "child");
      expect(selectionWasReused(child.profile)).toBe(true);
      append(testThread, [
        agentToolCall("item/completed", "turn-1", "agent-2"),
      ]);
      const completed = expectWarmEqualsCold(testThread, args, "completed");
      expect(selectionWasReused(completed.profile)).toBe(true);
    });
  });

  it("folds only the appended events while the selection is reused", () => {
    withTestThread((testThread) => {
      const args = latestArgs("default");
      append(testThread, [
        ...startTurn(initialState()),
        messageStarted("turn-1", "message-1"),
      ]);
      const initial = expectWarmEqualsCold(testThread, args, "initial");
      expect(initial.profile.foldedEventCount).toBe(
        initial.profile.compactedEventCount,
      );

      append(testThread, [
        messageDelta("turn-1", "message-1", "Hello"),
        messageDelta("turn-1", "message-1", " world\n"),
      ]);
      const delta = expectWarmEqualsCold(testThread, args, "delta");
      expect(selectionWasReused(delta.profile)).toBe(true);
      expect(delta.profile.foldedEventCount).toBe(2);
      const nested = expectWarmEqualsCold(
        testThread,
        latestArgs("nested"),
        "nested at the same sequence",
      );
      expect(nested.profile.foldedEventCount).toBe(0);

      append(testThread, [
        itemRow("item/started", "turn-1", {
          approvalStatus: null,
          command: "ls",
          cwd: "/tmp/memo",
          id: "command-1",
          status: "pending",
          type: "commandExecution",
        }),
      ]);
      const command = expectWarmEqualsCold(testThread, args, "command");
      expect(command.profile.foldedEventCount).toBe(1);

      append(testThread, [
        { data: { reason: "manual-stop" }, type: "system/thread/interrupted" },
      ]);
      const rebuilt = expectWarmEqualsCold(testThread, args, "rebuilt");
      expect(selectionWasReused(rebuilt.profile)).toBe(false);
      expect(rebuilt.profile.foldedEventCount).toBe(
        rebuilt.profile.compactedEventCount,
      );
    });
  });

  it("rebuilds when a root delta arrives for an earlier turn outside the latest window", () => {
    withTestThread((testThread) => {
      const state = initialState();
      const args = latestArgs("default");
      append(testThread, [
        ...startTurn(state),
        messageStarted("turn-1", "message-1"),
        messageDelta("turn-1", "message-1", "old\n"),
        messageDelta("turn-1", "message-1", "partial"),
        completeTurn(state, "turn-1", "interrupted"),
        ...startTurn(state),
        messageStarted("turn-2", "message-2"),
        ...Array.from({ length: 40 }, (_, index) =>
          messageDelta("turn-2", "message-2", `w${index}\n`),
        ),
      ]);
      const before = expectWarmEqualsCold(testThread, args, "before");
      expect(before.response.timelinePage.returnedSegmentCount).toBe(1);
      append(testThread, [messageDelta("turn-2", "message-2", "tick\n")]);
      const tick = expectWarmEqualsCold(testThread, args, "tick");
      expect(selectionWasReused(tick.profile)).toBe(true);

      append(testThread, [messageDelta("turn-1", "message-1", " late\n")]);
      const late = expectWarmEqualsCold(testThread, args, "late delta");
      expect(selectionWasReused(late.profile)).toBe(false);
      append(testThread, [
        deltaRow(
          "item/commandExecution/outputDelta",
          "turn-1",
          "command-9",
          "late output\n",
        ),
      ]);
      const fetchedLate = expectWarmEqualsCold(
        testThread,
        args,
        "late delta for a fetched turn",
      );
      expect(selectionWasReused(fetchedLate.profile)).toBe(true);
    });
  });

  it("rebuilds when deltas arrive before their turn/started", () => {
    withTestThread((testThread) => {
      const args = latestArgs("default");
      append(testThread, [
        ...startTurn(initialState()),
        messageStarted("turn-1", "message-1"),
        messageDelta("turn-1", "message-1", "one\n"),
      ]);
      expectWarmEqualsCold(testThread, args, "initial");
      append(testThread, [messageDelta("turn-1", "message-1", "two\n")]);
      const tick = expectWarmEqualsCold(testThread, args, "tick");
      expect(selectionWasReused(tick.profile)).toBe(true);

      append(testThread, [messageDelta("turn-2", "message-9", "early\n")]);
      const early = expectWarmEqualsCold(testThread, args, "early delta");
      expect(selectionWasReused(early.profile)).toBe(false);
      append(testThread, [messageDelta("turn-2", "message-9", "again\n")]);
      const earlyAgain = expectWarmEqualsCold(testThread, args, "early again");
      expect(selectionWasReused(earlyAgain.profile)).toBe(false);

      append(testThread, [{ turnId: "turn-2", type: "turn/started" }]);
      expectWarmEqualsCold(testThread, args, "late started");
    });
  });

  it("rebuilds a snapshot below the head without leaking later head state, and reuses at the head", () => {
    withTestThread((testThread) => {
      const state = initialState();
      const args: BuildArgs = {
        ...singleSegmentArgs,
        extensionStateKinds: [CODEX_GOAL_KIND],
      };
      append(testThread, [
        ...startTurn(state),
        goalRow(testThread.thread.id, "first goal"),
        planStepsRow("turn-1", "plan-1", "Ship it"),
        itemRow("item/started", "turn-1", workflowTask("task:wf-1", false)),
        messageStarted("turn-1", "message-1"),
        messageDelta("turn-1", "message-1", "one\n"),
        itemRow("item/completed", "turn-1", {
          id: "message-1",
          text: "one\n",
          type: "agentMessage",
        }),
        completeTurn(state, "turn-1"),
        ...startTurn(state),
        messageStarted("turn-2", "message-2"),
        messageDelta("turn-2", "message-2", "two\n"),
      ]);
      const initial = expectWarmEqualsCold(testThread, args, "initial");
      expect({
        goal: initial.response.extensionStates[CODEX_GOAL_KIND],
        todos: initial.response.pendingTodos?.items.map((item) => item.text),
        workflows: initial.response.activeWorkflows.map((row) => row.itemId),
      }).toEqual({
        goal: expect.objectContaining({ objective: "first goal" }),
        todos: ["Ship it", "Ship it docs"],
        workflows: ["task:wf-1"],
      });

      const laggingSeq = append(testThread, [
        messageDelta("turn-2", "message-2", "three\n"),
      ]);
      append(testThread, [
        goalRow(testThread.thread.id, "second goal"),
        planStepsRow("turn-2", "plan-2", "Ship again"),
        workflowTaskUpdate("task:wf-1", true),
      ]);
      const lagging = expectWarmEqualsCold(
        testThread,
        { ...args, maxSeq: laggingSeq },
        "lagging snapshot",
      );
      expect(selectionWasReused(lagging.profile)).toBe(false);
      expect({
        activeWorkflows: lagging.response.activeWorkflows,
        extensionStates: lagging.response.extensionStates,
        maxSeq: lagging.response.maxSeq,
        pendingTodos: lagging.response.pendingTodos,
      }).toEqual({
        activeWorkflows: [],
        extensionStates: {},
        maxSeq: laggingSeq,
        pendingTodos: null,
      });

      expectWarmEqualsCold(testThread, args, "head snapshot");
      append(testThread, [messageDelta("turn-2", "message-2", "four\n")]);
      const head = expectWarmEqualsCold(testThread, args, "head");
      expect(selectionWasReused(head.profile)).toBe(true);
    });
  });

  it("reorders rows when a parented excluded row extends a delegating span past a user request", () => {
    withTestThread((testThread) => {
      const state = initialState();
      const args = latestArgs("default");
      const boundary = (maxSeq: number) =>
        getTimelineGroupingContext(testThread.coldDb, {
          maxSeq,
          sequenceStart: 0,
          threadId: testThread.thread.id,
        }).orderingBoundarySequence;
      const rowStarts = (page: BuiltTimelinePage) =>
        page.response.rows.map((row) => row.sourceSeqStart);
      const message = (id: string) =>
        itemRow("item/completed", "turn-1", {
          id,
          text: id,
          type: "agentMessage",
        });
      const steerSeq = append(testThread, [
        ...startTurn(state),
        agentToolCall("item/started", "turn-1", "agent-1"),
        userRequest(2, { kind: "new-turn" }, "Steer"),
      ]);
      const requestSeq = append(testThread, [
        acceptedInput(2, "turn-1"),
        message("message-1"),
        agentToolCall("item/started", "turn-1", "agent-2"),
        userRequest(3, { kind: "new-turn" }, "Queued"),
      ]);
      const beforeSeq = append(testThread, [
        message("message-2"),
        completeTurn(state, "turn-1"),
      ]);
      const before = expectWarmEqualsCold(testThread, args, "before");
      expect(boundary(beforeSeq)).toBe(requestSeq);
      expect(rowStarts(before)).toEqual([1, 4, 5, 8, 7, 9, 10]);

      const maxSeq = append(testThread, [
        contextUsage("turn-1", 42, "agent-1"),
      ]);
      const after = expectWarmEqualsCold(testThread, args, "after");
      expect(boundary(maxSeq)).toBe(steerSeq);
      expect(rowStarts(after)).toEqual([1, 4, 5, 7, 8, 9, 10]);
      expect(selectionWasReused(after.profile)).toBe(true);
    });
  });

  it.each([
    { itemId: "task:wf-1", itemKind: "backgroundTask", reused: false },
    { itemId: "agent-1", itemKind: "toolCall", reused: true },
  ] as const)(
    "handles a delta row whose item kind is $itemKind",
    (testCase) => {
      withTestThread((testThread) => {
        const args = latestArgs("default");
        append(testThread, [
          ...startTurn(initialState()),
          messageStarted("turn-1", "message-1"),
        ]);
        expectWarmEqualsCold(testThread, args, "before");
        append(testThread, [
          {
            data: { itemId: testCase.itemId, message: "working" },
            itemId: testCase.itemId,
            itemKind: testCase.itemKind,
            turnId: "turn-1",
            type: "item/toolCall/progress",
          },
        ]);
        const after = expectWarmEqualsCold(testThread, args, "after");
        expect(selectionWasReused(after.profile)).toBe(testCase.reused);
      });
    },
  );

  it("rebuilds when appended deltas move the budget floor past an anchor", () => {
    withTestThread((testThread) => {
      const state = initialState();
      const args = latestArgs("default");
      append(testThread, [
        ...startTurn(state),
        completeTurn(state, "turn-1"),
        ...startTurn(state),
        messageStarted("turn-2", "message-2"),
      ]);
      const before = expectWarmEqualsCold(testThread, args, "before floor");
      expect(before.response.timelinePage.returnedSegmentCount).toBe(2);

      let crossed = false;
      for (let index = 0; index < 20 && !crossed; index += 1) {
        append(testThread, [messageDelta("turn-2", "message-2", "word ")]);
        const page = expectWarmEqualsCold(testThread, args, `delta ${index}`);
        crossed = page.response.timelinePage.returnedSegmentCount === 1;
        if (crossed) {
          expect(selectionWasReused(page.profile)).toBe(false);
        }
      }
      expect(crossed).toBe(true);
    });
  });

  it.each([
    {
      name: "resolved deltas are pruned",
      rewrite: (testThread: TestThread) =>
        advanceSettledThreadPruning(testThread, "resolved-items").removed,
    },
    {
      name: "another connection deletes a delta",
      rewrite: (testThread: TestThread, sequence: number) =>
        testThread.coldDb.$client
          .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
          .run(testThread.thread.id, sequence).changes,
    },
  ])("rebuilds after $name", ({ rewrite }) => {
    withTestThread((testThread) => {
      const args = latestArgs("nested");
      append(testThread, [
        ...startTurn(initialState()),
        messageStarted("turn-1", "message-1"),
        messageStarted("turn-1", "message-2"),
        messageDelta("turn-1", "message-1", "one\n"),
      ]);
      const deletedSeq = append(testThread, [
        messageDelta("turn-1", "message-1", "two\n"),
      ]);
      append(testThread, [
        itemRow("item/completed", "turn-1", {
          id: "message-1",
          text: "one\ntwo\n",
          type: "agentMessage",
        }),
      ]);
      expectWarmEqualsCold(testThread, args, "completed");

      expect(rewrite(testThread, deletedSeq)).toBe(1);
      append(testThread, [messageDelta("turn-1", "message-2", "three")]);
      const rewritten = expectWarmEqualsCold(testThread, args, "rewritten");
      expect(selectionWasReused(rewritten.profile)).toBe(false);
    });
  });

  it("reuses the selection across status changes and caps idle entries", () => {
    withTestThread((testThread) => {
      const state = initialState();
      append(testThread, [
        ...startTurn(state),
        messageStarted("turn-1", "message-1"),
      ]);
      expectWarmEqualsCold(testThread, latestArgs("default"), "active");
      const idle: TestThread = {
        ...testThread,
        thread: { ...testThread.thread, status: "idle" },
      };
      append(idle, [
        messageDelta("turn-1", "message-1", "word"),
        completeTurn(state, "turn-1"),
      ]);
      const completed = expectWarmEqualsCold(
        idle,
        latestArgs("default"),
        "idle",
      );
      expect(selectionWasReused(completed.profile)).toBe(true);

      const idleThreads = Array.from(
        { length: TIMELINE_SELECTION_MEMO_MAX_IDLE_ENTRIES + 2 },
        () =>
          createThread(testThread.db, noopNotifier, {
            projectId: testThread.projectId,
            providerId: "codex",
            status: "idle",
          }),
      );
      for (const thread of idleThreads) {
        append({ db: testThread.db, thread }, startTurn(initialState()));
        buildRouteTimelinePage({
          ...latestArgs("default"),
          db: testThread.db,
          registry,
          thread,
        });
      }
      const active = createThread(testThread.db, noopNotifier, {
        projectId: testThread.projectId,
        providerId: "codex",
        status: "active",
      });
      append({ db: testThread.db, thread: active }, startTurn(initialState()));
      buildRouteTimelinePage({
        ...latestArgs("default"),
        db: testThread.db,
        registry,
        thread: active,
      });
      expect(countTimelineSelectionMemoEntries(testThread.db)).toBe(
        TIMELINE_SELECTION_MEMO_MAX_IDLE_ENTRIES + 1,
      );
    });
  });

  it("keeps one entry per thread across a context clear", () => {
    withTestThread((testThread) => {
      const state = initialState();
      append(testThread, startTurn(state));
      expectWarmEqualsCold(testThread, latestArgs("default"), "first epoch");
      append(testThread, [
        completeTurn(state, "turn-1"),
        contextClear("clear-1"),
        ...startTurn(state),
      ]);
      const second = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "second epoch",
      );
      expect(second.response.contextBoundarySeq).not.toBeNull();
      expect(countTimelineSelectionMemoEntries(testThread.db)).toBe(1);
    });
  });

  it("bounds the memo to its entry cap across threads", () => {
    withTestThread((testThread) => {
      for (
        let index = 0;
        index < TIMELINE_SELECTION_MEMO_MAX_ENTRIES + 4;
        index += 1
      ) {
        const thread = createThread(testThread.db, noopNotifier, {
          projectId: testThread.projectId,
          providerId: "codex",
          status: "active",
        });
        append({ db: testThread.db, thread }, startTurn(initialState()));
        buildRouteTimelinePage({
          ...latestArgs("default"),
          db: testThread.db,
          registry,
          thread,
        });
      }
      expect(countTimelineSelectionMemoEntries(testThread.db)).toBe(
        TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
      );
    });
  });
});
