import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  LOCAL_WORKFLOW_TASK_TYPE,
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
  type Thread,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestThreadSequence,
  insertEvents,
  migrate,
  noopNotifier,
  pruneContextWindowUsageEventsBeforeSequence,
  pruneResolvedItemDeltas,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { pruneThreadEventHistory } from "../../../src/services/system/event-pruning.js";
import { clearStoredEventDecodeCache } from "../../../src/services/threads/stored-event-decode-cache.js";
import { clearTimelineOrderingContextCache } from "../../../src/services/threads/timeline-context-order.js";
import {
  buildThreadTimelineWithProfile,
  type ThreadTimelineBuildProfile,
} from "../../../src/services/threads/timeline.js";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import { previewTimelineResponseOutputs } from "../../../src/services/threads/timeline-output-preview.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "../../../src/services/threads/timeline-output-truncation.js";
import {
  clearTimelineSelectionMemo,
  readTimelineSelectionMemoSize,
  TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
} from "../../../src/services/threads/timeline-selection-memo.js";

type EventInput = Parameters<typeof insertEvents>[2][number];
type Random = () => number;
type Variant = "default" | "nested";

interface TestThread {
  coldDb: DbConnection;
  db: DbConnection;
  dir: string;
  projectId: string;
  thread: Thread;
}

interface RowSpec {
  data: Record<string, unknown>;
  itemId?: string | null;
  itemKind?: ThreadEventItemType | null;
  parentToolCallId?: string | null;
  providerThreadId?: string | null;
  turnId?: string | null;
  type: ThreadEventType;
}

interface BuildArgs {
  eventBudget: number;
  includeDiagnosticOperations: boolean;
  maxSeq: number | null;
  page: ThreadTimelinePageRequest;
  variant: Variant;
}

interface BuiltPage {
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineResponse;
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
  openTaskId: string | null;
  openToolCallId: string | null;
  openTurnId: string | null;
  requestCounter: number;
  turnCounter: number;
}

const SEEDS = 5;
const STEPS = 70;
const providerThreadId = "provider-memo";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

let migratedImage: Buffer | null = null;

function readMigratedImage(): Buffer {
  if (migratedImage === null) {
    const db = createConnection(":memory:");
    migrate(db);
    migratedImage = db.$client.serialize();
    db.$client.close();
  }
  return migratedImage;
}

function setup(status: Thread["status"] = "active"): TestThread {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-memo-"));
  const file = path.join(dir, "bb.db");
  fs.writeFileSync(file, readMigratedImage());
  const db = createConnection(file);
  const host = upsertHost(db, noopNotifier, { name: "memo-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "memo-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/memo" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status,
  });
  return {
    coldDb: createConnection(file),
    db,
    dir,
    projectId: project.id,
    thread,
  };
}

function teardown(testThread: TestThread): void {
  testThread.coldDb.$client.close();
  testThread.db.$client.close();
  fs.rmSync(testThread.dir, { force: true, recursive: true });
}

function append(testThread: TestThread, specs: readonly RowSpec[]): number {
  let sequence = getLatestThreadSequence(testThread.db, {
    threadId: testThread.thread.id,
  });
  const rows: EventInput[] = specs.map((spec) => {
    sequence += 1;
    const turnId = spec.turnId ?? null;
    return {
      createdAt: 1_800_000_000_000 + sequence * 1_000,
      data: JSON.stringify(spec.data),
      itemId: spec.itemId ?? null,
      itemKind: spec.itemKind ?? null,
      parentToolCallId: spec.parentToolCallId ?? null,
      providerThreadId:
        spec.providerThreadId === undefined
          ? turnId === null
            ? null
            : providerThreadId
          : spec.providerThreadId,
      scope: turnId === null ? threadScope() : turnScope(turnId),
      sequence,
      threadId: testThread.thread.id,
      type: spec.type,
    };
  });
  insertEvents(testThread.db, noopNotifier, rows);
  return sequence;
}

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

function startTurn(state: SessionState): RowSpec[] {
  state.turnCounter += 1;
  state.requestCounter += 1;
  const turnId = `turn-${state.turnCounter}`;
  state.openTurnId = turnId;
  state.openMessage = null;
  state.openReasoningId = null;
  state.openCommandId = null;
  state.openToolCallId = null;
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
    deltaRow(
      "item/agentMessage/delta",
      closed.turnId,
      closed.messageId ?? nextItemId(state, "late-message"),
      random() < 0.5 ? "late line\n" : "late word ",
    ),
  ];
}

function earlyDeltaRows(state: SessionState): RowSpec[] {
  const turnNumber = state.turnCounter + 1;
  return [
    deltaRow(
      "item/agentMessage/delta",
      `turn-${turnNumber}`,
      `early-message-${turnNumber}`,
      "early ",
    ),
  ];
}

function randomSessionRows(state: SessionState, random: Random): RowSpec[] {
  const turnId = state.openTurnId;
  const outOfOrder = random();
  if (outOfOrder < 0.05 && state.closedTurns.length > 0) {
    return lateDeltaRows(state, random);
  }
  if (outOfOrder < 0.08) {
    return earlyDeltaRows(state);
  }
  if (turnId === null) {
    if (random() < 0.1) {
      return [
        {
          data: {
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: `clear-${state.itemCounter}`,
            status: "completed",
            message: "Fresh context",
          },
          type: "system/operation",
        },
      ];
    }
    return startTurn(state);
  }
  const choice = random();
  if (choice < 0.34) {
    const rows: RowSpec[] = [];
    if (state.openMessage === null) {
      state.openMessage = { id: nextItemId(state, "message"), text: "" };
      state.lastMessageId = state.openMessage.id;
      rows.push(
        itemRow("item/started", turnId, {
          id: state.openMessage.id,
          text: "",
          type: "agentMessage",
        }),
      );
    }
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const delta = random() < 0.3 ? `line ${index}\n` : `word${index} `;
      state.openMessage.text += delta;
      rows.push(
        deltaRow(
          "item/agentMessage/delta",
          turnId,
          state.openMessage.id,
          delta,
        ),
      );
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
    if (state.openCommandId === null) {
      state.openCommandId = nextItemId(state, "command");
      state.lastCommandId = state.openCommandId;
      rows.push(
        itemRow("item/started", turnId, {
          approvalStatus: null,
          command: "pnpm test",
          cwd: "/tmp/memo",
          id: state.openCommandId,
          status: "pending",
          type: "commandExecution",
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
          aggregatedOutput: "ok\n",
          approvalStatus: null,
          command: "pnpm test",
          cwd: "/tmp/memo",
          exitCode: 0,
          id: state.openCommandId,
          status: "completed",
          type: "commandExecution",
        }),
      );
      state.openCommandId = null;
    }
    return rows;
  }
  if (choice < 0.64) {
    if (state.openToolCallId === null) {
      state.openToolCallId = nextItemId(state, "agent");
      return [
        itemRow("item/started", turnId, {
          arguments: { prompt: "Investigate" },
          id: state.openToolCallId,
          status: "pending",
          tool: "Agent",
          type: "toolCall",
        }),
      ];
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
    if (roll < 0.75) {
      const childId = nextItemId(state, "child");
      return [
        itemRow(
          "item/completed",
          turnId,
          {
            aggregatedOutput: "child output\n",
            approvalStatus: null,
            command: "echo child",
            cwd: "/tmp/memo",
            exitCode: 0,
            id: childId,
            status: "completed",
            type: "commandExecution",
          },
          toolCallId,
        ),
      ];
    }
    state.openToolCallId = null;
    return [
      itemRow("item/completed", turnId, {
        arguments: { prompt: "Investigate" },
        id: toolCallId,
        result: "done",
        status: "completed",
        tool: "Agent",
        type: "toolCall",
      }),
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
      return [
        {
          data: {
            contextWindowUsage: {
              estimated: false,
              modelContextWindow: 200_000,
              usedTokens: state.itemCounter * 10,
            },
          },
          turnId,
          type: "thread/contextWindowUsage/updated",
        },
      ];
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
    const taskId = state.openTaskId ?? `task:${nextItemId(state, "wf")}`;
    const item = {
      description: "workflow",
      id: taskId,
      skipTranscript: false,
      taskType: LOCAL_WORKFLOW_TASK_TYPE,
      type: "backgroundTask",
      workflowName: "workflow",
    };
    if (state.openTaskId === null) {
      state.openTaskId = taskId;
      return [
        itemRow("item/started", turnId, {
          ...item,
          status: "pending",
          taskStatus: "running",
          type: "backgroundTask",
        }),
      ];
    }
    const completed = random() < 0.4;
    if (completed) state.openTaskId = null;
    return [
      {
        data: {
          item: {
            ...item,
            status: completed ? "completed" : "pending",
            taskStatus: completed ? "completed" : "running",
          },
        },
        itemId: taskId,
        itemKind: "backgroundTask",
        providerThreadId,
        type: completed
          ? "item/backgroundTask/completed"
          : "item/backgroundTask/progress",
      },
    ];
  }
  if (choice < 0.93) {
    closeTurn(state, turnId);
    return [{ data: { status: "completed" }, turnId, type: "turn/completed" }];
  }
  closeTurn(state, turnId);
  return [
    { data: { reason: "manual-stop" }, type: "system/thread/interrupted" },
  ];
}

function buildPage(
  db: DbConnection,
  thread: Thread,
  args: BuildArgs,
): BuiltPage {
  const includeNestedRows = args.variant === "nested";
  const { profile, response } = buildThreadTimelineWithProfile(db, thread, {
    eventBudget: args.eventBudget,
    includeDiagnosticOperations: args.includeDiagnosticOperations,
    includeNestedRows,
    maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
    maxSeq: args.maxSeq ?? getLatestThreadSequence(db, { threadId: thread.id }),
    page: args.page,
    providerDisplayName: "Codex",
    planCommand: null,
    summaryOnly: false,
  });
  const truncated = truncateTimelineResponseOutputs(
    response,
    DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  );
  return {
    profile,
    response: includeNestedRows
      ? truncated
      : previewTimelineResponseOutputs(truncated),
  };
}

function selectionWasReused(profile: ThreadTimelineBuildProfile): boolean {
  return (
    profile.stageTimings.some(
      (timing) => timing.stage === "selection-memo-lookup",
    ) &&
    !profile.stageTimings.some(
      (timing) =>
        timing.stage === "group-context-query" ||
        timing.stage === "ordering-context-query",
    )
  );
}

function buildColdPage(testThread: TestThread, args: BuildArgs): BuiltPage {
  clearTimelineOrderingContextCache(testThread.coldDb);
  clearTimelineSelectionMemo(testThread.coldDb);
  clearStoredEventDecodeCache(testThread.coldDb);
  const cold = buildPage(testThread.coldDb, testThread.thread, args);
  expect(selectionWasReused(cold.profile)).toBe(false);
  return cold;
}

function expectWarmEqualsCold(
  testThread: TestThread,
  args: BuildArgs,
  label: string,
): BuiltPage {
  const warm = buildPage(testThread.db, testThread.thread, args);
  const cold = buildColdPage(testThread, args);
  expect(JSON.stringify(warm.response), label).toBe(
    JSON.stringify(cold.response),
  );
  expect(
    {
      eventDataBytes: warm.profile.eventDataBytes,
      eventRowCount: warm.profile.eventRowCount,
      orderingBoundarySequence: warm.profile.orderingBoundarySequence,
      selectionStrategy: warm.profile.selectionStrategy,
    },
    label,
  ).toEqual({
    eventDataBytes: cold.profile.eventDataBytes,
    eventRowCount: cold.profile.eventRowCount,
    orderingBoundarySequence: cold.profile.orderingBoundarySequence,
    selectionStrategy: cold.profile.selectionStrategy,
  });
  return warm;
}

function walkOlderPages(
  testThread: TestThread,
  latest: BuiltPage,
  args: BuildArgs,
  label: string,
): void {
  let page = latest;
  for (let depth = 0; depth < 10; depth += 1) {
    const cursor = page.response.timelinePage.olderCursor;
    if (!page.response.timelinePage.hasOlderRows || cursor === null) return;
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

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
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
    openTaskId: null,
    openToolCallId: null,
    openTurnId: null,
    requestCounter: 0,
    turnCounter: 0,
  };
}

function latestArgs(
  variant: Variant,
  includeDiagnosticOperations = false,
): BuildArgs {
  return {
    eventBudget: 20,
    includeDiagnosticOperations,
    maxSeq: null,
    page: { kind: "latest", segmentLimit: 3 },
    variant,
  };
}

const singleSegmentArgs: BuildArgs = {
  eventBudget: 200,
  includeDiagnosticOperations: false,
  maxSeq: null,
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
  return {
    data: {
      providerThreadId,
      item: {
        type: "planSteps",
        id,
        steps: [
          { step, status: "active" },
          { step: `${step} docs`, status: "pending" },
        ],
        status: "completed",
      },
    },
    itemId: id,
    itemKind: "planSteps",
    turnId,
    type: "item/completed",
  };
}

function seedTwoTurns(
  testThread: TestThread,
  turnOneRows: readonly RowSpec[],
): void {
  const state = initialState();
  append(testThread, startTurn(state));
  append(testThread, turnOneRows);
  append(testThread, [
    itemRow("item/started", "turn-1", {
      id: "message-1",
      text: "",
      type: "agentMessage",
    }),
    deltaRow("item/agentMessage/delta", "turn-1", "message-1", "one\n"),
    itemRow("item/completed", "turn-1", {
      id: "message-1",
      text: "one\n",
      type: "agentMessage",
    }),
    { data: { status: "completed" }, turnId: "turn-1", type: "turn/completed" },
  ]);
  closeTurn(state, "turn-1");
  append(testThread, startTurn(state));
  append(testThread, [
    itemRow("item/started", "turn-2", {
      id: "message-2",
      text: "",
      type: "agentMessage",
    }),
    deltaRow("item/agentMessage/delta", "turn-2", "message-2", "two\n"),
  ]);
}

function expectLaggingSnapshotRebuilds(
  testThread: TestThread,
  rowsPastSnapshot: readonly RowSpec[],
): BuiltPage {
  const laggingSeq = append(testThread, [
    deltaRow("item/agentMessage/delta", "turn-2", "message-2", "three\n"),
  ]);
  append(testThread, rowsPastSnapshot);
  const lagging = expectWarmEqualsCold(
    testThread,
    { ...singleSegmentArgs, maxSeq: laggingSeq },
    "lagging snapshot",
  );
  expect(lagging.response.maxSeq).toBe(laggingSeq);
  expect(selectionWasReused(lagging.profile)).toBe(false);
  expectWarmEqualsCold(testThread, singleSegmentArgs, "head snapshot");
  return lagging;
}

describe("latest timeline selection memo", () => {
  it("matches a cold build over randomized streaming, out-of-order deltas, rewrites, prunes and context clears", () => {
    let reused = 0;
    let rebuilt = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = createRandom(seed);
      const testThread = setup();
      const state = initialState();
      try {
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
            pruneContextWindowUsageEventsBeforeSequence(testThread.db, {
              sequenceCutoff: latest,
              threadId: testThread.thread.id,
            });
          } else {
            append(testThread, randomSessionRows(state, random));
          }
          const label = JSON.stringify({ seed, step });
          const includeDiagnosticOperations = random() < 0.2;
          const warm = expectWarmEqualsCold(
            testThread,
            latestArgs("default", includeDiagnosticOperations),
            label,
          );
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
      } finally {
        teardown(testThread);
      }
    }
    expect(reused).toBeGreaterThan(SEEDS * 10);
    expect(rebuilt).toBeGreaterThan(SEEDS * 15);
  }, 120_000);

  it("reuses the selection for root deltas and rebuilds for lifecycle rows", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
      ]);
      const cold = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "initial",
      );
      expect(selectionWasReused(cold.profile)).toBe(false);

      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "Hello"),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", " world\n"),
        {
          data: {
            contextWindowUsage: {
              estimated: false,
              modelContextWindow: 200_000,
              usedTokens: 12,
            },
          },
          turnId: "turn-1",
          type: "thread/contextWindowUsage/updated",
        },
      ]);
      const delta = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "delta",
      );
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
      const lifecycle = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "lifecycle",
      );
      expect(selectionWasReused(lifecycle.profile)).toBe(false);

      append(testThread, [
        deltaRow(
          "item/commandExecution/outputDelta",
          "turn-1",
          "command-1",
          "file\n",
        ),
      ]);
      const outputDelta = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "output delta",
      );
      expect(selectionWasReused(outputDelta.profile)).toBe(true);

      append(testThread, [
        {
          data: { itemId: "message-1", delta: "nested" },
          itemId: "message-1",
          parentToolCallId: "agent-1",
          turnId: "turn-1",
          type: "item/agentMessage/delta",
        },
      ]);
      const parented = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "parented delta",
      );
      expect(selectionWasReused(parented.profile)).toBe(false);
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds when a root delta arrives for an earlier turn outside the latest window", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "old\n"),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "partial"),
        {
          data: { status: "interrupted" },
          turnId: "turn-1",
          type: "turn/completed",
        },
      ]);
      state.openTurnId = null;
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-2", {
          id: "message-2",
          text: "",
          type: "agentMessage",
        }),
      ]);
      for (let index = 0; index < 40; index += 1) {
        append(testThread, [
          deltaRow(
            "item/agentMessage/delta",
            "turn-2",
            "message-2",
            `w${index}\n`,
          ),
        ]);
      }
      const args = latestArgs("default");
      const before = expectWarmEqualsCold(testThread, args, "before");
      expect(before.response.timelinePage.returnedSegmentCount).toBe(1);
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-2", "message-2", "tick\n"),
      ]);
      const tick = expectWarmEqualsCold(testThread, args, "tick");
      expect(selectionWasReused(tick.profile)).toBe(true);

      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", " late\n"),
      ]);
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
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds when deltas arrive before their turn/started", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "one\n"),
      ]);
      const args = latestArgs("default");
      expectWarmEqualsCold(testThread, args, "initial");
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "two\n"),
      ]);
      const tick = expectWarmEqualsCold(testThread, args, "tick");
      expect(selectionWasReused(tick.profile)).toBe(true);

      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-2", "message-9", "early\n"),
      ]);
      const early = expectWarmEqualsCold(testThread, args, "early delta");
      expect(selectionWasReused(early.profile)).toBe(false);
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-2", "message-9", "again\n"),
      ]);
      const earlyAgain = expectWarmEqualsCold(testThread, args, "early again");
      expect(selectionWasReused(earlyAgain.profile)).toBe(false);

      append(testThread, [
        { data: {}, turnId: "turn-2", type: "turn/started" },
      ]);
      expectWarmEqualsCold(testThread, args, "late started");
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds a snapshot below the latest sequence and reuses at the head", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      const memoSeq = append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "one\n"),
      ]);
      expectWarmEqualsCold(testThread, latestArgs("default"), "initial");
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "two\n"),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "three\n"),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "four\n"),
      ]);
      const lagging = expectWarmEqualsCold(
        testThread,
        { ...latestArgs("default"), maxSeq: memoSeq + 1 },
        "lagging snapshot",
      );
      expect(lagging.response.maxSeq).toBe(memoSeq + 1);
      expect(selectionWasReused(lagging.profile)).toBe(false);
      const latest = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "latest snapshot",
      );
      expect(selectionWasReused(latest.profile)).toBe(true);
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds a lagging snapshot when a newer goal row lies past it", () => {
    const testThread = setup();
    try {
      seedTwoTurns(testThread, [goalRow(testThread.thread.id, "first goal")]);
      const initial = expectWarmEqualsCold(
        testThread,
        singleSegmentArgs,
        "initial",
      );
      expect(initial.response.goal?.objective).toBe("first goal");
      const lagging = expectLaggingSnapshotRebuilds(testThread, [
        goalRow(testThread.thread.id, "second goal"),
      ]);
      expect(lagging.response.goal).toBeNull();
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds a lagging snapshot when a newer plan snapshot lies past it", () => {
    const testThread = setup();
    try {
      seedTwoTurns(testThread, [planStepsRow("turn-1", "plan-1", "Ship it")]);
      const initial = expectWarmEqualsCold(
        testThread,
        singleSegmentArgs,
        "initial",
      );
      expect(
        initial.response.pendingTodos?.items.map((item) => item.text),
      ).toEqual(["Ship it", "Ship it docs"]);
      const lagging = expectLaggingSnapshotRebuilds(testThread, [
        planStepsRow("turn-2", "plan-2", "Ship again"),
      ]);
      expect(lagging.response.pendingTodos).toBeNull();
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds a lagging snapshot when a background task completes past it", () => {
    const testThread = setup();
    try {
      const task = {
        description: "workflow",
        id: "task:wf-1",
        skipTranscript: false,
        taskType: LOCAL_WORKFLOW_TASK_TYPE,
        type: "backgroundTask",
        workflowName: "workflow",
      } as const;
      seedTwoTurns(testThread, [
        itemRow("item/started", "turn-1", {
          ...task,
          status: "pending",
          taskStatus: "running",
        }),
      ]);
      const initial = expectWarmEqualsCold(
        testThread,
        singleSegmentArgs,
        "initial",
      );
      expect(
        initial.response.activeWorkflows.map((workflow) => workflow.itemId),
      ).toEqual([task.id]);
      const lagging = expectLaggingSnapshotRebuilds(testThread, [
        {
          data: {
            item: { ...task, status: "completed", taskStatus: "completed" },
          },
          itemId: task.id,
          itemKind: "backgroundTask",
          providerThreadId,
          type: "item/backgroundTask/completed",
        },
      ]);
      expect(lagging.response.activeWorkflows).toEqual([]);
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds when a parented excluded row extends a delegating span past a user request", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      const requestSeq = append(testThread, [
        itemRow("item/started", "turn-1", {
          arguments: { prompt: "Investigate" },
          id: "agent-1",
          status: "pending",
          tool: "Agent",
          type: "toolCall",
        }),
        itemRow(
          "item/completed",
          "turn-1",
          {
            aggregatedOutput: "child output\n",
            approvalStatus: null,
            command: "echo child",
            cwd: "/tmp/memo",
            exitCode: 0,
            id: "child-1",
            status: "completed",
            type: "commandExecution",
          },
          "agent-1",
        ),
        userRequest(2, { kind: "new-turn" }, "Queued"),
      ]);
      const args = latestArgs("default");
      const before = expectWarmEqualsCold(testThread, args, "before");
      expect(before.profile.orderingBoundarySequence).toBeNull();

      append(testThread, [
        {
          data: {
            contextWindowUsage: {
              estimated: false,
              modelContextWindow: 200_000,
              usedTokens: 42,
            },
          },
          parentToolCallId: "agent-1",
          turnId: "turn-1",
          type: "thread/contextWindowUsage/updated",
        },
      ]);
      const after = expectWarmEqualsCold(testThread, args, "after");
      expect(after.profile.orderingBoundarySequence).toBe(requestSeq);
      expect(selectionWasReused(after.profile)).toBe(false);
    } finally {
      teardown(testThread);
    }
  });

  it.each([
    { itemId: "task:wf-1", itemKind: "backgroundTask" },
    { itemId: "agent-1", itemKind: "toolCall" },
  ] as const)(
    "rebuilds for a delta row whose item kind is $itemKind",
    (testCase) => {
      const testThread = setup();
      const state = initialState();
      try {
        append(testThread, startTurn(state));
        const task = {
          description: "workflow",
          id: "task:wf-1",
          skipTranscript: false,
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
          workflowName: "workflow",
        };
        append(testThread, [
          itemRow("item/started", "turn-1", {
            ...task,
            status: "pending",
            taskStatus: "running",
            type: "backgroundTask",
          }),
          itemRow("item/started", "turn-1", {
            arguments: { prompt: "Investigate" },
            id: "agent-1",
            status: "pending",
            tool: "Agent",
            type: "toolCall",
          }),
          {
            data: {},
            parentToolCallId: "agent-1",
            providerThreadId: "provider-child",
            turnId: "child-turn-1",
            type: "turn/started",
          },
          itemRow(
            "item/completed",
            "child-turn-1",
            {
              aggregatedOutput: "child output\n",
              approvalStatus: null,
              command: "echo child",
              cwd: "/tmp/memo",
              exitCode: 0,
              id: "child-1",
              status: "completed",
              type: "commandExecution",
            },
            "agent-1",
          ),
          itemRow("item/completed", "turn-1", {
            arguments: { prompt: "Investigate" },
            id: "agent-1",
            result: "done",
            status: "completed",
            tool: "Agent",
            type: "toolCall",
          }),
          {
            data: {
              item: {
                ...task,
                status: "completed",
                taskStatus: "completed",
                type: "backgroundTask",
              },
            },
            itemId: "task:wf-1",
            itemKind: "backgroundTask",
            providerThreadId,
            type: "item/backgroundTask/completed",
          },
          {
            data: { status: "completed" },
            turnId: "turn-1",
            type: "turn/completed",
          },
        ]);
        state.openTurnId = null;
        append(testThread, startTurn(state));
        append(testThread, [
          itemRow("item/started", "turn-2", {
            id: "message-2",
            text: "",
            type: "agentMessage",
          }),
        ]);
        for (let index = 0; index < 30; index += 1) {
          append(testThread, [
            deltaRow(
              "item/agentMessage/delta",
              "turn-2",
              "message-2",
              `w${index}\n`,
            ),
          ]);
        }
        const args = latestArgs("default");
        expectWarmEqualsCold(testThread, args, "before");
        append(testThread, [
          {
            data: { itemId: testCase.itemId, message: "working" },
            itemId: testCase.itemId,
            itemKind: testCase.itemKind,
            turnId: "turn-2",
            type: "item/toolCall/progress",
          },
        ]);
        const after = expectWarmEqualsCold(testThread, args, "after");
        expect(selectionWasReused(after.profile)).toBe(false);
      } finally {
        teardown(testThread);
      }
    },
  );

  it("rebuilds when appended deltas move the budget floor past an anchor", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        {
          data: { status: "completed" },
          turnId: "turn-1",
          type: "turn/completed",
        },
      ]);
      state.openTurnId = null;
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-2", {
          id: "message-2",
          text: "",
          type: "agentMessage",
        }),
      ]);
      const args = latestArgs("default");
      const before = expectWarmEqualsCold(testThread, args, "before floor");
      expect(before.response.timelinePage.returnedSegmentCount).toBe(2);

      let crossed = false;
      for (let index = 0; index < 20 && !crossed; index += 1) {
        append(testThread, [
          deltaRow("item/agentMessage/delta", "turn-2", "message-2", "word "),
        ]);
        const page = expectWarmEqualsCold(testThread, args, `delta ${index}`);
        crossed = page.response.timelinePage.returnedSegmentCount === 1;
        if (crossed) {
          expect(selectionWasReused(page.profile)).toBe(false);
        }
      }
      expect(crossed).toBe(true);
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds after resolved deltas are pruned", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
        itemRow("item/started", "turn-1", {
          id: "message-2",
          text: "",
          type: "agentMessage",
        }),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "one\n"),
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "two\n"),
        itemRow("item/completed", "turn-1", {
          id: "message-1",
          text: "one\ntwo\n",
          type: "agentMessage",
        }),
      ]);
      const args = latestArgs("nested");
      expectWarmEqualsCold(testThread, args, "completed");

      expect(
        pruneResolvedItemDeltas(testThread.db, {
          threadId: testThread.thread.id,
        }),
      ).toBe(1);
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-2", "three"),
      ]);
      const pruned = expectWarmEqualsCold(testThread, args, "pruned");
      expect(selectionWasReused(pruned.profile)).toBe(false);
    } finally {
      teardown(testThread);
    }
  });

  it("rebuilds after another connection rewrites events", () => {
    const testThread = setup();
    const writer = createConnection(path.join(testThread.dir, "bb.db"));
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
      ]);
      const deletedSequence = append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "one\n"),
      ]);
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "two\n"),
      ]);
      const args = latestArgs("nested");
      expectWarmEqualsCold(testThread, args, "initial");

      writer.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
        .run(testThread.thread.id, deletedSequence);
      append(testThread, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "three"),
      ]);
      const rewritten = expectWarmEqualsCold(testThread, args, "rewritten");
      expect(selectionWasReused(rewritten.profile)).toBe(false);
    } finally {
      writer.$client.close();
      teardown(testThread);
    }
  });

  it("builds cold for idle threads and forgets a thread once it stops being active", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      append(testThread, [
        itemRow("item/started", "turn-1", {
          id: "message-1",
          text: "",
          type: "agentMessage",
        }),
      ]);
      expectWarmEqualsCold(testThread, latestArgs("default"), "active");
      expect(readTimelineSelectionMemoSize(testThread.db).entryCount).toBe(1);

      const idleThread: Thread = { ...testThread.thread, status: "idle" };
      const idle: TestThread = { ...testThread, thread: idleThread };
      append(idle, [
        deltaRow("item/agentMessage/delta", "turn-1", "message-1", "word"),
      ]);
      const page = expectWarmEqualsCold(idle, latestArgs("default"), "idle");
      expect(selectionWasReused(page.profile)).toBe(false);
      expect(readTimelineSelectionMemoSize(idle.db).entryCount).toBe(0);
    } finally {
      teardown(testThread);
    }
  });

  it("keeps one entry per thread across a context clear", () => {
    const testThread = setup();
    const state = initialState();
    try {
      append(testThread, startTurn(state));
      expectWarmEqualsCold(testThread, latestArgs("default"), "first epoch");
      append(testThread, [
        {
          data: { status: "completed" },
          turnId: "turn-1",
          type: "turn/completed",
        },
        {
          data: {
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: "clear-1",
            status: "completed",
            message: "Fresh context",
          },
          type: "system/operation",
        },
      ]);
      state.openTurnId = null;
      append(testThread, startTurn(state));
      const second = expectWarmEqualsCold(
        testThread,
        latestArgs("default"),
        "second epoch",
      );
      expect(second.response.contextBoundarySeq).not.toBeNull();
      expect(readTimelineSelectionMemoSize(testThread.db).entryCount).toBe(1);
    } finally {
      teardown(testThread);
    }
  });

  it("bounds the memo to its entry cap across threads", () => {
    const testThread = setup();
    try {
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
        const otherThread = { ...testThread, thread };
        append(otherThread, startTurn(initialState()));
        buildPage(testThread.db, thread, latestArgs("default"));
        expect(
          readTimelineSelectionMemoSize(testThread.db).entryCount,
        ).toBeLessThanOrEqual(TIMELINE_SELECTION_MEMO_MAX_ENTRIES);
      }
      expect(readTimelineSelectionMemoSize(testThread.db).entryCount).toBe(
        TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
      );
    } finally {
      teardown(testThread);
    }
  });
});
