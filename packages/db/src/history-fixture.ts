import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import type { DbConnection } from "./connection.js";
import { createEnvironment } from "./data/environments.js";
import {
  appendStoredThreadEventsInTransaction,
  getHighWaterMarks,
  type AppendStoredThreadEventArgs,
} from "./data/events.js";
import { upsertHost } from "./data/hosts.js";
import { createProject } from "./data/projects.js";
import { createQueuedThreadMessage } from "./data/queued-thread-messages.js";
import { createThread } from "./data/threads.js";
import { noopNotifier } from "./notifier.js";

const TURNS_PER_BATCH = 250;

export interface HistoryTurn {
  turnId: string;
  requestId: ClientTurnRequestId;
  agentMessageItemId: string;
  commandItemIds: string[];
  steps: number;
  requestSequence: number;
  completedSequence: number;
}

export interface LiveTurn {
  threadId: string;
  providerThreadId: string;
  turnId: string;
  requestId: ClientTurnRequestId;
  requestSequence: number;
  commandItemIds: string[];
  runningCommandItemId: string;
  streamingMessageItemId: string;
  latestSequence: number;
}

export interface HistoryFixture {
  hostId: string;
  projectId: string;
  environmentId: string;
  threadId: string;
  providerThreadId: string;
  neighborThreadIds: string[];
  turns: HistoryTurn[];
  pendingRequestId: ClientTurnRequestId;
  liveTurn: LiveTurn;
  delegationItemIds: string[];
  backgroundTaskItemIds: string[];
  queuedRetryId: string;
  queuedMessageId: string;
  latestSequence: number;
}

interface TurnEventsArgs {
  threadId: string;
  providerThreadId: string;
  index: number;
  requestId: ClientTurnRequestId;
  turn: Pick<
    HistoryTurn,
    "turnId" | "agentMessageItemId" | "commandItemIds" | "steps"
  >;
}

interface TurnBodyArgs {
  threadId: string;
  providerThreadId: string;
  turnId: string;
  index: number;
}

const TEST_OUTPUT_LINE = "✓ test/query-plan-audit.test.ts (6 tests) 12ms\n";

let nextRequestNumber = 1;

function nextRequestId(): ClientTurnRequestId {
  const id = encodeClientTurnRequestIdNumber({ value: nextRequestNumber });
  nextRequestNumber += 1;
  return id;
}

function requestInput(index: number): PromptInput[] {
  return [
    {
      type: "text",
      text: `Turn ${index}: check the failing build, fix the cause, and rerun the targeted tests. `.repeat(
        4,
      ),
      mentions: [],
    },
  ];
}

function requestedEvent(
  threadId: string,
  requestId: ClientTurnRequestId,
  index: number,
): AppendStoredThreadEventArgs {
  return {
    threadId,
    scope: threadScope(),
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      requestId,
      input: requestInput(index),
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
        serviceTier: "default",
      },
    },
  };
}

function itemPair(
  threadId: string,
  providerThreadId: string,
  turnId: string,
  started: AppendStoredThreadEventArgs<"item/started">["data"]["item"],
  completed: AppendStoredThreadEventArgs<"item/completed">["data"]["item"],
): AppendStoredThreadEventArgs[] {
  return [
    {
      threadId,
      providerThreadId,
      scope: turnScope(turnId),
      type: "item/started",
      data: { providerThreadId, item: started },
    },
    {
      threadId,
      providerThreadId,
      scope: turnScope(turnId),
      type: "item/completed",
      data: { providerThreadId, item: completed },
    },
  ];
}

type TextDeltaType =
  | "item/agentMessage/delta"
  | "item/reasoning/summaryTextDelta"
  | "item/fileChange/outputDelta"
  | "item/commandExecution/outputDelta";

function textDelta(
  args: TurnBodyArgs,
  type: TextDeltaType,
  itemId: string,
  delta: string,
): AppendStoredThreadEventArgs {
  const { threadId, providerThreadId, turnId } = args;
  return {
    threadId,
    providerThreadId,
    scope: turnScope(turnId),
    type,
    data: { providerThreadId, itemId, delta },
  };
}

function commandEvents(
  args: TurnBodyArgs,
  itemId: string,
  outputDeltas: number,
  finished: boolean,
): AppendStoredThreadEventArgs[] {
  const { threadId, providerThreadId, turnId, index } = args;
  const command = {
    type: "commandExecution" as const,
    id: itemId,
    command: `pnpm exec turbo run test --filter=@bb/db -- test/${index}.test.ts`,
    cwd: "/workspace/bb",
    approvalStatus: null,
  };
  const started: AppendStoredThreadEventArgs = {
    threadId,
    providerThreadId,
    scope: turnScope(turnId),
    type: "item/started",
    data: { providerThreadId, item: { ...command, status: "pending" } },
  };
  const deltas = Array.from({ length: outputDeltas }, () =>
    textDelta(
      args,
      "item/commandExecution/outputDelta",
      itemId,
      TEST_OUTPUT_LINE,
    ),
  );
  if (!finished) return [started, ...deltas];
  return [
    started,
    ...deltas,
    {
      threadId,
      providerThreadId,
      scope: turnScope(turnId),
      type: "item/completed",
      data: {
        providerThreadId,
        item: {
          ...command,
          status: "completed",
          exitCode: 0,
          durationMs: 1800,
          aggregatedOutput: TEST_OUTPUT_LINE.repeat(8),
        },
      },
    },
  ];
}

function shortTurnBody(
  args: TurnBodyArgs,
  commandItemIds: readonly string[],
): AppendStoredThreadEventArgs[] {
  const { threadId, providerThreadId, turnId } = args;
  const reasoning = {
    type: "reasoning" as const,
    id: `${turnId}-reasoning`,
    summary: [],
    content: [],
  };
  return [
    ...itemPair(threadId, providerThreadId, turnId, reasoning, reasoning),
    ...commandItemIds.flatMap((itemId) => commandEvents(args, itemId, 1, true)),
  ];
}

function longTurnCommandItemId(turnId: string, step: number): string {
  return `${turnId}-s${step}-cmd`;
}

function commandItemIdsFor(turnId: string, steps: number): string[] {
  return steps === 0
    ? [`${turnId}-cmd1`, `${turnId}-cmd2`]
    : Array.from({ length: steps }, (_, step) =>
        longTurnCommandItemId(turnId, step),
      );
}

function streamingAgentMessage(
  args: TurnBodyArgs,
  itemId: string,
  deltas: number,
): AppendStoredThreadEventArgs[] {
  const { threadId, providerThreadId, turnId } = args;
  return [
    {
      threadId,
      providerThreadId,
      scope: turnScope(turnId),
      type: "item/started",
      data: {
        providerThreadId,
        item: { type: "agentMessage", id: itemId, text: "" },
      },
    },
    ...Array.from({ length: deltas }, () =>
      textDelta(
        args,
        "item/agentMessage/delta",
        itemId,
        "Checking the next failing test. ",
      ),
    ),
  ];
}

function longTurnStep(
  args: TurnBodyArgs,
  step: number,
): AppendStoredThreadEventArgs[] {
  const { threadId, providerThreadId, turnId } = args;
  const scope = turnScope(turnId);
  const prefix = `${turnId}-s${step}`;
  const reasoningId = `${prefix}-reasoning`;
  const events: AppendStoredThreadEventArgs[] = [
    {
      threadId,
      providerThreadId,
      scope,
      type: "item/started",
      data: {
        providerThreadId,
        item: { type: "reasoning", id: reasoningId, summary: [], content: [] },
      },
    },
    textDelta(
      args,
      "item/reasoning/summaryTextDelta",
      reasoningId,
      "Looking at the failing assertion. ",
    ),
    textDelta(
      args,
      "item/reasoning/summaryTextDelta",
      reasoningId,
      "The query plan changed after the migration.",
    ),
    {
      threadId,
      providerThreadId,
      scope,
      type: "item/completed",
      data: {
        providerThreadId,
        item: {
          type: "reasoning",
          id: reasoningId,
          summary: [
            "Looking at the failing assertion. The query plan changed after the migration.",
          ],
          content: [],
        },
      },
    },
    ...commandEvents(args, longTurnCommandItemId(turnId, step), 3, true),
  ];
  if (step % 4 === 0) {
    const fileChange = {
      type: "fileChange" as const,
      id: `${prefix}-edit`,
      changes: [
        {
          path: `packages/db/src/data/step-${step % 40}.ts`,
          kind: "update" as const,
          diff: "@@ -1,3 +1,3 @@\n-const limit = 10;\n+const limit = 20;\n",
        },
      ],
      approvalStatus: null,
    };
    events.push(
      {
        threadId,
        providerThreadId,
        scope,
        type: "item/started",
        data: { providerThreadId, item: { ...fileChange, status: "pending" } },
      },
      textDelta(
        args,
        "item/fileChange/outputDelta",
        fileChange.id,
        "Success. Updated the following files:\n",
      ),
      {
        threadId,
        providerThreadId,
        scope,
        type: "item/completed",
        data: {
          providerThreadId,
          item: { ...fileChange, status: "completed" },
        },
      },
    );
  }
  if (step % 5 === 0) {
    const messageId = `${prefix}-commentary`;
    events.push(...streamingAgentMessage(args, messageId, 3), {
      threadId,
      providerThreadId,
      scope,
      type: "item/completed",
      data: {
        providerThreadId,
        item: {
          type: "agentMessage",
          id: messageId,
          text: "Checking the next failing test. ".repeat(3),
        },
      },
    });
  }
  if (step % 25 === 0) {
    events.push({
      threadId,
      providerThreadId,
      scope,
      type: "turn/plan/updated",
      data: {
        providerThreadId,
        plan: [
          { step: "Reproduce", status: "completed" },
          { step: `Fix step ${step}`, status: "active" },
        ],
      },
    });
  }
  if (step % 50 === 25) {
    events.push(
      ...delegationEvents(
        threadId,
        providerThreadId,
        turnId,
        `${prefix}-delegation`,
      ),
    );
  }
  events.push({
    threadId,
    providerThreadId,
    scope,
    type: "thread/contextWindowUsage/updated",
    data: {
      providerThreadId,
      contextWindowUsage: {
        usedTokens: 40_000 + (step % 200) * 1_000,
        modelContextWindow: 258_400,
        estimated: false,
      },
    },
  });
  return events;
}

function turnEvents(args: TurnEventsArgs): AppendStoredThreadEventArgs[] {
  const { threadId, providerThreadId, index, requestId, turn } = args;
  const scope = turnScope(turn.turnId);
  const body = { threadId, providerThreadId, turnId: turn.turnId, index };
  const events: AppendStoredThreadEventArgs[] = [
    requestedEvent(threadId, requestId, index),
    {
      threadId,
      providerThreadId,
      scope,
      type: "turn/started",
      data: { providerThreadId },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "turn/input/accepted",
      data: { providerThreadId, clientRequestId: requestId },
    },
  ];
  events.push(
    ...(turn.steps === 0
      ? shortTurnBody(body, turn.commandItemIds)
      : Array.from({ length: turn.steps }, (_, step) =>
          longTurnStep(body, step),
        ).flat()),
  );
  if (index % 50 === 0) {
    events.push({
      threadId,
      providerThreadId,
      scope,
      type: "turn/plan/updated",
      data: {
        providerThreadId,
        plan: [
          { step: "Reproduce", status: "completed" },
          { step: "Fix", status: "active" },
        ],
      },
    });
  }
  events.push(
    {
      threadId,
      providerThreadId,
      scope,
      type: "item/agentMessage/delta",
      data: {
        providerThreadId,
        itemId: turn.agentMessageItemId,
        delta: "The build passes now.",
      },
    },
    ...itemPair(
      threadId,
      providerThreadId,
      turn.turnId,
      { type: "agentMessage", id: turn.agentMessageItemId, text: "" },
      {
        type: "agentMessage",
        id: turn.agentMessageItemId,
        text: `Turn ${index}: the build passes now. I changed the failing query and reran the targeted tests. `.repeat(
          3,
        ),
      },
    ),
    {
      threadId,
      providerThreadId,
      scope,
      type: "thread/tokenUsage/updated",
      data: {
        providerThreadId,
        tokenUsage: {
          total: {
            totalTokens: 1_000 * index,
            inputTokens: 900 * index,
            cachedInputTokens: 800 * index,
            cacheReadInputTokens: 800 * index,
            cacheWriteInputTokens: 0,
            outputTokens: 100 * index,
            reasoningOutputTokens: 50 * index,
          },
          last: {
            totalTokens: 1_000,
            inputTokens: 900,
            cachedInputTokens: 800,
            cacheReadInputTokens: 800,
            cacheWriteInputTokens: 0,
            outputTokens: 100,
            reasoningOutputTokens: 50,
          },
          modelContextWindow: 258_400,
        },
      },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "thread/contextWindowUsage/updated",
      data: {
        providerThreadId,
        contextWindowUsage: {
          usedTokens: 40_000 + (index % 200) * 1_000,
          modelContextWindow: 258_400,
          estimated: false,
        },
      },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "turn/completed",
      data: {
        providerThreadId,
        status: index % 200 === 0 ? "interrupted" : "completed",
        providerCheckpointId: `${turn.turnId}-checkpoint`,
      },
    },
  );
  return events;
}

function delegationEvents(
  threadId: string,
  providerThreadId: string,
  turnId: string,
  itemId: string,
): AppendStoredThreadEventArgs[] {
  const delegation = {
    type: "delegation" as const,
    id: itemId,
    childRef: `${itemId}-child`,
    label: "Review the change",
    background: false,
  };
  const child = {
    type: "commandExecution" as const,
    id: `${itemId}-command`,
    command: "git diff --stat",
    cwd: "/workspace/bb",
    approvalStatus: null,
    parentToolCallId: itemId,
  };
  return [
    ...itemPair(
      threadId,
      providerThreadId,
      turnId,
      { ...delegation, status: "pending" },
      { ...delegation, status: "completed", summary: "Looks good." },
    ),
    ...itemPair(
      threadId,
      providerThreadId,
      turnId,
      { ...child, status: "pending" },
      { ...child, status: "completed", exitCode: 0 },
    ),
  ];
}

function backgroundTaskEvents(
  threadId: string,
  providerThreadId: string,
  turnId: string,
  itemId: string,
  open: boolean,
): AppendStoredThreadEventArgs[] {
  const task = {
    type: "backgroundTask" as const,
    id: itemId,
    taskType: "local_bash",
    description: "pnpm dev",
    skipTranscript: false,
    foreground: false,
  };
  const started: AppendStoredThreadEventArgs = {
    threadId,
    providerThreadId,
    scope: turnScope(turnId),
    type: "item/started",
    data: {
      providerThreadId,
      item: { ...task, status: "pending", taskStatus: "running" },
    },
  };
  if (open) return [started];
  return [
    started,
    {
      threadId,
      providerThreadId,
      scope: turnScope(turnId),
      type: "item/backgroundTask/completed",
      data: {
        providerThreadId,
        item: { ...task, status: "completed", taskStatus: "completed" },
      },
    },
  ];
}

function appendHistory(
  db: DbConnection,
  args: {
    threadId: string;
    providerThreadId: string;
    turnCount: number;
    longTurnSteps: number;
    prefix: string;
  },
): {
  turns: HistoryTurn[];
  delegationItemIds: string[];
  backgroundTaskItemIds: string[];
} {
  const turns: HistoryTurn[] = [];
  const delegationItemIds: string[] = [];
  const backgroundTaskItemIds: string[] = [];
  db.transaction(
    (tx) =>
      appendStoredThreadEventsInTransaction(tx, [
        {
          threadId: args.threadId,
          providerThreadId: args.providerThreadId,
          scope: threadScope(),
          type: "thread/identity",
          data: { providerThreadId: args.providerThreadId },
        },
      ]),
    { behavior: "immediate" },
  );
  for (let start = 0; start < args.turnCount; start += TURNS_PER_BATCH) {
    db.transaction(
      (tx) => {
        const events: AppendStoredThreadEventArgs[] = [];
        const positions: { requested: number; completed: number }[] = [];
        const batchTurns: Omit<
          HistoryTurn,
          "requestSequence" | "completedSequence"
        >[] = [];
        const end = Math.min(start + TURNS_PER_BATCH, args.turnCount);
        for (let index = start + 1; index <= end; index += 1) {
          const turnId = `${args.prefix}-t${index}`;
          const steps =
            index === 1 || index === args.turnCount ? args.longTurnSteps : 0;
          const turn = {
            turnId,
            requestId: nextRequestId(),
            agentMessageItemId: `${turnId}-agent`,
            commandItemIds: commandItemIdsFor(turnId, steps),
            steps,
          };
          batchTurns.push(turn);
          const requested = events.length;
          const turnEventArgs = turnEvents({
            threadId: args.threadId,
            providerThreadId: args.providerThreadId,
            index,
            requestId: turn.requestId,
            turn,
          });
          const completed = turnEventArgs.splice(-1);
          events.push(...turnEventArgs);
          if (index % 100 === 0) {
            const itemId = `${turnId}-delegation`;
            delegationItemIds.push(itemId);
            events.push(
              ...delegationEvents(
                args.threadId,
                args.providerThreadId,
                turnId,
                itemId,
              ),
            );
          }
          if (index % 1_000 === 0) {
            const itemId = `${turnId}-task`;
            backgroundTaskItemIds.push(itemId);
            events.push(
              ...backgroundTaskEvents(
                args.threadId,
                args.providerThreadId,
                turnId,
                itemId,
                index === args.turnCount,
              ),
            );
          }
          if (index % 200 === 0) {
            events.push({
              threadId: args.threadId,
              scope: threadScope(),
              type: "system/thread/interrupted",
              data: {
                reason:
                  index % 1_000 === 0 ? "host-daemon-restarted" : "manual-stop",
              },
            });
          }
          positions.push({ requested, completed: events.length });
          events.push(...completed);
        }
        const sequences = appendStoredThreadEventsInTransaction(tx, events);
        batchTurns.forEach((turn, offset) => {
          const position = positions[offset];
          const requestSequence = sequences[position?.requested ?? -1];
          const completedSequence = sequences[position?.completed ?? -1];
          if (
            requestSequence === undefined ||
            completedSequence === undefined
          ) {
            throw new Error(`Expected sequences for ${turn.turnId}`);
          }
          turns.push({ ...turn, requestSequence, completedSequence });
        });
      },
      { behavior: "immediate" },
    );
  }
  return { turns, delegationItemIds, backgroundTaskItemIds };
}

const LIVE_THREAD_SETTLED_TURNS = 5;

function appendLiveThread(
  db: DbConnection,
  args: {
    projectId: string;
    environmentId: string;
    providerId: string;
    steps: number;
  },
): LiveTurn {
  const thread = createThread(db, noopNotifier, {
    projectId: args.projectId,
    environmentId: args.environmentId,
    providerId: args.providerId,
    status: "active",
  });
  const providerThreadId = "provider-live";
  appendHistory(db, {
    threadId: thread.id,
    providerThreadId,
    turnCount: LIVE_THREAD_SETTLED_TURNS,
    longTurnSteps: 0,
    prefix: "l",
  });
  const index = LIVE_THREAD_SETTLED_TURNS + 1;
  const turnId = `l-t${index}`;
  const requestId = nextRequestId();
  const body = { threadId: thread.id, providerThreadId, turnId, index };
  const scope = turnScope(turnId);
  const runningCommandItemId = `${turnId}-running-cmd`;
  const streamingMessageItemId = `${turnId}-agent`;
  const events: AppendStoredThreadEventArgs[] = [
    requestedEvent(thread.id, requestId, index),
    {
      threadId: thread.id,
      providerThreadId,
      scope,
      type: "turn/started",
      data: { providerThreadId },
    },
    {
      threadId: thread.id,
      providerThreadId,
      scope,
      type: "turn/input/accepted",
      data: { providerThreadId, clientRequestId: requestId },
    },
    ...Array.from({ length: args.steps }, (_, step) =>
      longTurnStep(body, step),
    ).flat(),
    ...commandEvents(body, runningCommandItemId, 3, false),
    ...streamingAgentMessage(body, streamingMessageItemId, 2),
  ];
  const sequences = db.transaction(
    (tx) => appendStoredThreadEventsInTransaction(tx, events),
    { behavior: "immediate" },
  );
  const requestSequence = sequences[0];
  const latestSequence = sequences.at(-1);
  if (requestSequence === undefined || latestSequence === undefined) {
    throw new Error("Expected live turn sequences");
  }
  return {
    threadId: thread.id,
    providerThreadId,
    turnId,
    requestId,
    requestSequence,
    commandItemIds: [
      ...Array.from({ length: args.steps }, (_, step) =>
        longTurnCommandItemId(turnId, step),
      ),
      runningCommandItemId,
    ],
    runningCommandItemId,
    streamingMessageItemId,
    latestSequence,
  };
}

export interface BuildHistoryFixtureArgs {
  historyTurns: number;
  longTurnSteps: number;
  neighborThreads: number;
  neighborTurns: number;
  providerId: string;
}

const LATEST_EVENT_AGE_MS = 60 * 60_000;
const EVENT_SPACING_MS = 30_000;

function spreadEventTimesOverHistory(
  db: DbConnection,
  threadIds: readonly string[],
): void {
  const latestAt = Date.now() - LATEST_EVENT_AGE_MS;
  const update = db.$client.prepare(
    "UPDATE events SET created_at = ? - (? - sequence) * ? WHERE thread_id = ?",
  );
  const highWaterMarks = getHighWaterMarks(db, [...threadIds]);
  for (const threadId of threadIds) {
    update.run(
      latestAt,
      highWaterMarks[threadId] ?? 0,
      EVENT_SPACING_MS,
      threadId,
    );
  }
}

export function buildHistoryFixture(
  db: DbConnection,
  args: BuildHistoryFixtureArgs,
): HistoryFixture {
  const {
    historyTurns,
    longTurnSteps,
    neighborThreads,
    neighborTurns,
    providerId,
  } = args;
  const host = upsertHost(db, noopNotifier, { name: "query-costs" });
  const { project } = createProject(db, noopNotifier, {
    name: "query-costs",
    source: { type: "local_path", hostId: host.id, path: "/workspace/bb" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: "/workspace/bb",
    providerOwnsPath: false,
    status: "ready",
  });
  const neighborThreadIds: string[] = [];
  for (let index = 0; index < neighborThreads; index += 1) {
    const neighbor = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId,
      status: "idle",
    });
    neighborThreadIds.push(neighbor.id);
    appendHistory(db, {
      threadId: neighbor.id,
      providerThreadId: `provider-neighbor-${index}`,
      turnCount: neighborTurns,
      longTurnSteps: 0,
      prefix: `n${index}`,
    });
  }
  const liveTurn = appendLiveThread(db, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
    steps: longTurnSteps,
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
    status: "idle",
  });
  const providerThreadId = "provider-history";
  const history = appendHistory(db, {
    threadId: thread.id,
    providerThreadId,
    turnCount: historyTurns,
    longTurnSteps,
    prefix: "h",
  });
  const pendingRequestId = nextRequestId();
  const [latestSequence] = db.transaction(
    (tx) =>
      appendStoredThreadEventsInTransaction(tx, [
        requestedEvent(thread.id, pendingRequestId, historyTurns + 1),
      ]),
    { behavior: "immediate" },
  );
  const execution = {
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "full" as const,
    serviceTier: "default",
    sendAt: null,
    systemNotice: null,
  };
  const retry = createQueuedThreadMessage(db, noopNotifier, {
    ...execution,
    threadId: thread.id,
    content: requestInput(historyTurns + 1),
    waitingOn: null,
    payload: {
      kind: "retry",
      retryOfTurnRequestId: pendingRequestId,
      attempt: 2,
      reason: "Rate limited",
    },
  });
  const queued = createQueuedThreadMessage(db, noopNotifier, {
    ...execution,
    threadId: thread.id,
    content: [{ type: "text", text: "Then update the docs.", mentions: [] }],
    waitingOn: null,
    payload: { kind: "inline" },
  });
  if (latestSequence === undefined) {
    throw new Error("Expected the pending request sequence");
  }
  spreadEventTimesOverHistory(db, [thread.id, ...neighborThreadIds]);
  return {
    hostId: host.id,
    projectId: project.id,
    environmentId: environment.id,
    threadId: thread.id,
    providerThreadId,
    neighborThreadIds,
    turns: history.turns,
    pendingRequestId,
    liveTurn,
    delegationItemIds: history.delegationItemIds,
    backgroundTaskItemIds: history.backgroundTaskItemIds,
    queuedRetryId: retry.id,
    queuedMessageId: queued.id,
    latestSequence,
  };
}
