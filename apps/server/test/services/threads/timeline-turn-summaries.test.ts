import { prependOlderTimelineRows } from "@bb/client-core";
import { expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
} from "@bb/domain";
import {
  createProject,
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
  insertEvents,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { withTestHarness } from "../../helpers/test-app.js";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";

type TimelineModule =
  typeof import("../../../src/services/threads/timeline.js");
type EventInput = Parameters<typeof insertEvents>[2][number];
type EventSpec = Omit<EventInput, "sequence" | "threadId">;

const providerThreadId = "provider-root";
const TURN_ID = "turn-1";
const TASK_ID = "task-1";

function setup(): { db: DbConnection; thread: Thread } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { db, thread };
}

function insertAt(
  db: DbConnection,
  thread: Thread,
  firstSequence: number,
  specs: readonly (EventSpec | null)[],
): number {
  const events: EventInput[] = [];
  specs.forEach((spec, index) => {
    if (spec !== null) {
      events.push({
        ...spec,
        sequence: firstSequence + index,
        threadId: thread.id,
      });
    }
  });
  insertEvents(db, noopNotifier, events);
  return firstSequence + specs.length;
}

function turnScoped(
  type: EventSpec["type"],
  data: object,
  item: { id: string; kind: EventSpec["itemKind"] } | null = null,
): EventSpec {
  return {
    type,
    scope: turnScope(TURN_ID),
    providerThreadId,
    itemId: item?.id ?? null,
    itemKind: item?.kind ?? null,
    parentToolCallId: null,
    data: JSON.stringify(data),
  };
}

function turnStart(): EventSpec[] {
  const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  return [
    {
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Fix the bug", mentions: [] }],
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
    turnScoped("turn/started", {}),
    turnScoped("turn/input/accepted", { clientRequestId }),
  ];
}

function agentMessage(id: string, text: string): EventSpec {
  return turnScoped(
    "item/completed",
    { item: { type: "agentMessage", id, text } },
    { id, kind: "agentMessage" },
  );
}

function command(id: string): EventSpec[] {
  const base = {
    type: "commandExecution",
    id,
    command: `echo ${id}`,
    cwd: "/tmp/test",
    approvalStatus: null,
  };
  return [
    turnScoped(
      "item/started",
      { item: { ...base, status: "pending" } },
      { id, kind: "commandExecution" },
    ),
    turnScoped(
      "item/completed",
      {
        item: {
          ...base,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: id,
        },
      },
      { id, kind: "commandExecution" },
    ),
  ];
}

function backgroundTask(status: "pending" | "completed"): EventSpec {
  return {
    type:
      status === "pending" ? "item/started" : "item/backgroundTask/completed",
    scope: status === "pending" ? turnScope(TURN_ID) : threadScope(),
    providerThreadId,
    itemId: TASK_ID,
    itemKind: "backgroundTask",
    parentToolCallId: null,
    data: JSON.stringify({
      providerThreadId,
      item: {
        type: "backgroundTask",
        id: TASK_ID,
        taskType: "local_bash",
        description: "watch the build",
        status,
        taskStatus: status === "pending" ? "running" : "completed",
        skipTranscript: false,
        foreground: false,
      },
    }),
  };
}

function turnCompleted(): EventSpec {
  return turnScoped("turn/completed", {
    status: "completed",
    providerThreadId,
  });
}

async function freshTimeline(): Promise<TimelineModule> {
  vi.resetModules();
  return import("../../../src/services/threads/timeline.js");
}

function walk(
  timeline: TimelineModule,
  db: DbConnection,
  thread: Thread,
): TimelineRow[] {
  let rows: TimelineRow[] = [];
  let cursor: TimelinePaginationCursor | null = null;
  for (let page = 0; page < 20; page += 1) {
    const { response } = timeline.buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      eventBudget: 4,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: cursor
        ? { kind: "older", beforeCursor: cursor, segmentLimit: 1 }
        : { kind: "latest", segmentLimit: 1 },
    });
    rows = prependOlderTimelineRows({
      olderRows: response.rows,
      loadedRows: rows,
    });
    cursor = response.timelinePage.olderCursor;
    if (cursor === null) return rows;
  }
  throw new Error("walk did not finish");
}

function outlineIds(
  timeline: TimelineModule,
  db: DbConnection,
  thread: Thread,
): string[] {
  return timeline
    .loadThreadConversationOutline(db, thread, {
      completedTurnDisplay: "collapse",
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
      outlineSequence: getLatestStoredConversationOutlineSequence(db, {
        threadId: thread.id,
      }),
    })
    .items.map((item) => item.id);
}

function storedSummaryCount(db: DbConnection): number {
  const row = db.$client
    .prepare("SELECT COUNT(*) AS count FROM thread_turn_summaries")
    .get() as { count: number };
  return row.count;
}

function storedOutlineCount(db: DbConnection): number {
  const row = db.$client
    .prepare("SELECT COUNT(*) AS count FROM thread_conversation_outlines")
    .get() as { count: number };
  return row.count;
}

async function rebuiltWithoutStoredProjections(
  db: DbConnection,
  thread: Thread,
): Promise<{ outline: string[]; rows: TimelineRow[] }> {
  db.$client.exec(
    "DELETE FROM thread_turn_summaries; DELETE FROM thread_conversation_outlines;",
  );
  const timeline = await freshTimeline();
  return {
    outline: outlineIds(timeline, db, thread),
    rows: walk(timeline, db, thread),
  };
}

it("lists exactly the collapsed timeline's top-level messages in the outline", async () => {
  const { db, thread } = setup();
  insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("reading", "Reading the files now."),
    ...command("cmd-1"),
    agentMessage("found", "Found it."),
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  const timeline = await freshTimeline();

  const conversationIds = walk(timeline, db, thread)
    .filter((row) => row.kind === "conversation")
    .map((row) => row.id);
  const outline = outlineIds(timeline, db, thread);

  expect(outline).toEqual(conversationIds);
  expect(outline.some((id) => id.includes("item:reading"))).toBe(false);
  expect(outline.filter((id) => id.includes("assistant"))).toHaveLength(2);
});

it("rebuilds a stored summary when a background task finishes after its turn", async () => {
  const { db, thread } = setup();
  const next = insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("start", "Starting the build watcher."),
    backgroundTask("pending"),
    ...command("cmd-1"),
    agentMessage("answer", "Watching the build."),
    turnCompleted(),
  ]);
  const timeline = await freshTimeline();
  const rowsBefore = walk(timeline, db, thread);
  expect(storedSummaryCount(db)).toBe(1);

  insertAt(db, thread, next, [backgroundTask("completed")]);
  const rows = walk(timeline, db, thread);
  const outline = outlineIds(timeline, db, thread);

  const rebuilt = await rebuiltWithoutStoredProjections(db, thread);
  expect(rebuilt.rows).not.toEqual(rowsBefore);
  expect(rows).toEqual(rebuilt.rows);
  expect(outline).toEqual(rebuilt.outline);
});

it("drops stored summaries and outlines in the gap-fill transaction, so a restart cannot serve them", async () => {
  const { db, thread } = setup();
  const gap = 9;
  insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...command("cmd-1"),
    agentMessage("found", "Found it."),
    null,
    null,
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  const before = await freshTimeline();
  const rowsBefore = walk(before, db, thread);
  const outlineBefore = outlineIds(before, db, thread);
  expect(outlineBefore.some((id) => id.includes("item:found"))).toBe(true);
  expect(storedSummaryCount(db)).toBe(1);
  expect(storedOutlineCount(db)).toBe(1);

  insertAt(db, thread, gap, command("cmd-late"));
  expect(storedSummaryCount(db)).toBe(0);
  expect(storedOutlineCount(db)).toBe(0);

  const restarted = await freshTimeline();
  const rows = walk(restarted, db, thread);
  const outline = outlineIds(restarted, db, thread);

  const rebuilt = await rebuiltWithoutStoredProjections(db, thread);
  expect(rebuilt.rows).not.toEqual(rowsBefore);
  expect(rebuilt.outline).not.toEqual(outlineBefore);
  expect(rows).toEqual(rebuilt.rows);
  expect(outline).toEqual(rebuilt.outline);
});

it("ignores a stored summary after a suffix rewrite reuses the turn id and its last sequence", async () => {
  const { db, thread } = setup();
  const end = insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...command("cmd-1"),
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  const timeline = await freshTimeline();
  const rowsBefore = walk(timeline, db, thread);
  expect(storedSummaryCount(db)).toBe(1);

  db.transaction((tx) =>
    deleteThreadEventSuffixInTransaction(tx, {
      cutoffSequence: 4,
      oldMaxSequence: end - 1,
      threadId: thread.id,
    }),
  );
  expect(
    insertAt(db, thread, 4, [
      agentMessage("start", "Looking into it."),
      agentMessage("plan", "Planning the fix."),
      agentMessage("more", "Checking one more file."),
      agentMessage("answer", "Here is the fix."),
      turnCompleted(),
    ]),
  ).toBe(end);
  expect(storedSummaryCount(db)).toBe(0);
  const rows = walk(await freshTimeline(), db, thread);

  const rebuilt = await rebuiltWithoutStoredProjections(db, thread);
  expect(rebuilt.rows).not.toEqual(rowsBefore);
  expect(rows).toEqual(rebuilt.rows);
});

it("stores the summary from the kept selection when a watched turn completes", async () => {
  const { db, thread } = setup();
  const active: Thread = { ...thread, status: "active" };
  const next = insertAt(db, active, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...command("cmd-1"),
    agentMessage("answer", "Here is the fix."),
  ]);
  const timeline = await freshTimeline();
  const latest = () =>
    timeline.buildThreadTimelineWithProfile(db, active, {
      completedTurnDisplay: "collapse",
      eventBudget: 100,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
  latest();
  expect(storedSummaryCount(db)).toBe(0);

  insertAt(db, active, next, [turnCompleted()]);
  const completed = latest();
  expect(storedSummaryCount(db)).toBe(1);
  expect(
    completed.profile.stageTimings.some(
      (timing) => timing.stage === "turn-summary-build",
    ),
  ).toBe(false);

  const rows = walk(await freshTimeline(), db, active);
  const rebuilt = await rebuiltWithoutStoredProjections(db, active);
  expect(rows).toEqual(rebuilt.rows);
});

function inTurn(specs: readonly EventSpec[], turnId: string): EventSpec[] {
  return specs.map((spec) =>
    spec.scope.kind === "turn" ? { ...spec, scope: turnScope(turnId) } : spec,
  );
}

function followUpTurn(value: number, turnId: string): EventSpec[] {
  const [request, started, accepted] = turnStart();
  const requestData = JSON.parse(request!.data) as Record<string, unknown>;
  const clientRequestId = encodeClientTurnRequestIdNumber({ value });
  return [
    {
      ...request!,
      data: JSON.stringify({
        ...requestData,
        requestId: clientRequestId,
        target: { kind: "new-turn" },
      }),
    },
    { ...started!, scope: turnScope(turnId) },
    {
      ...accepted!,
      data: JSON.stringify({ clientRequestId }),
      scope: turnScope(turnId),
    },
  ];
}

function seedLongTurns(db: DbConnection, thread: Thread, commands: number) {
  let next = 1;
  for (const [index, turnId] of ["turn-1", "turn-2"].entries()) {
    next = insertAt(db, thread, next, [
      ...(index === 0 ? turnStart() : followUpTurn(index + 1, turnId)),
      ...inTurn(
        [
          agentMessage(`${turnId}-start`, "Looking into it."),
          ...Array.from({ length: commands }, (_, item) =>
            command(`${turnId}-cmd-${item}`),
          ).flat(),
          agentMessage(`${turnId}-answer`, "Here is the fix."),
          turnCompleted(),
        ],
        turnId,
      ),
    ]);
  }
}

it("serves the existing outline rule for unsummarized turns and fills them across loads", async () => {
  await withTestHarness(async (harness) => {
    const db = harness.deps.db;
    const { project } = createProject(db, noopNotifier, {
      name: "sweep-project",
      source: {
        type: "local_path",
        hostId: upsertHost(db, noopNotifier, { name: "sweep-host" }).id,
        path: "/tmp/sweep",
      },
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    seedLongTurns(db, thread, 600);
    const timeline = await freshTimeline();
    const load = () =>
      timeline.loadThreadConversationOutline(db, thread, {
        completedTurnDisplay: "collapse",
        includeClearedContextHistory: false,
        includeDiagnosticOperations: false,
        maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
        outlineSequence: getLatestStoredConversationOutlineSequence(db, {
          threadId: thread.id,
        }),
      });

    const before = load();
    expect(before.complete).toBe(false);
    expect(storedSummaryCount(db)).toBe(1);
    expect(before.items.some((item) => item.id.includes("turn-1-start"))).toBe(
      true,
    );
    expect(before.items.some((item) => item.id.includes("turn-2-start"))).toBe(
      false,
    );

    const after = load();
    expect(storedSummaryCount(db)).toBe(2);
    expect(after.complete).toBe(true);
    expect(after.items.map((item) => item.id)).toEqual(
      timeline
        .buildThreadConversationOutline(db, thread, {
          completedTurnDisplay: "collapse",
          includeClearedContextHistory: false,
          includeDiagnosticOperations: false,
          maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
        })
        .items.map((item) => item.id),
    );
    expect(after.items.some((item) => item.id.includes("turn-1-start"))).toBe(
      false,
    );
  });
});

it("stores the summary of a turn the first page only partly covers from that page's projection", async () => {
  const { db, thread } = setup();
  const [steerRequest, , steerAccepted] = followUpTurn(2, TURN_ID);
  insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...Array.from({ length: 20 }, (_, item) => command(`cmd-${item}`)).flat(),
    {
      ...steerRequest!,
      data: JSON.stringify({
        ...(JSON.parse(steerRequest!.data) as Record<string, unknown>),
        requestId: encodeClientTurnRequestIdNumber({ value: 2 }),
        target: { kind: "steer", expectedTurnId: TURN_ID },
      }),
    },
    steerAccepted!,
    ...command("after-steer"),
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  const timeline = await freshTimeline();
  const { profile, response } = timeline.buildThreadTimelineWithProfile(
    db,
    thread,
    {
      completedTurnDisplay: "collapse",
      eventBudget: 20,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 1 },
    },
  );
  expect(response.timelinePage.olderCursor).not.toBeNull();
  expect(
    db.$client
      .prepare("SELECT turn_id AS turnId FROM thread_turn_summaries")
      .all(),
  ).toEqual([{ turnId: TURN_ID }]);
  expect(
    profile.stageTimings.some(
      (timing) => timing.stage === "turn-summary-build",
    ),
  ).toBe(false);

  const rows = walk(await freshTimeline(), db, thread);
  expect(rows).toEqual(
    (await rebuiltWithoutStoredProjections(db, thread)).rows,
  );
});

it("records a summary's validation once more than 1,024 later events have been checked", async () => {
  const { db, thread } = setup();
  const next = insertAt(db, thread, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...command("cmd-1"),
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  walk(await freshTimeline(), db, thread);
  const validatedThrough = () =>
    db.$client
      .prepare(
        "SELECT validated_through AS value FROM thread_turn_summaries WHERE turn_id = ?",
      )
      .get(TURN_ID) as { value: number };
  expect(validatedThrough().value).toBe(next - 1);

  const last = insertAt(db, thread, next, [
    ...followUpTurn(2, "turn-2"),
    ...inTurn(
      [
        ...Array.from({ length: 520 }, (_, item) =>
          command(`late-${item}`),
        ).flat(),
        turnCompleted(),
      ],
      "turn-2",
    ),
  ]);
  walk(await freshTimeline(), db, thread);
  expect(validatedThrough().value).toBe(last - 1);
});

it("absorbs late events into a finished turn's kept selection", async () => {
  const { db, thread } = setup();
  const active: Thread = { ...thread, status: "active" };
  const [steerRequest, , steerAccepted] = followUpTurn(2, TURN_ID);
  const steerRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
  const next = insertAt(db, active, 1, [
    ...turnStart(),
    agentMessage("start", "Looking into it."),
    ...command("cmd-1"),
    {
      ...steerRequest!,
      data: JSON.stringify({
        ...(JSON.parse(steerRequest!.data) as Record<string, unknown>),
        requestId: steerRequestId,
        target: { kind: "steer", expectedTurnId: TURN_ID },
      }),
    },
    steerAccepted!,
    ...command("cmd-2"),
    agentMessage("answer", "Here is the fix."),
    turnCompleted(),
  ]);
  walk(await freshTimeline(), db, active);
  expect(storedSummaryCount(db)).toBe(1);
  const timeline = await freshTimeline();
  const latest = () =>
    timeline.buildThreadTimelineWithProfile(db, active, {
      completedTurnDisplay: "collapse",
      eventBudget: 100,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 1 },
    });
  latest();
  const reused = (profile: { stageTimings: { stage: string }[] }) =>
    !profile.stageTimings.some(
      (timing) => timing.stage === "group-context-query",
    );

  insertAt(db, active, next, command("late-1"));
  const promoted = latest();
  expect(reused(promoted.profile)).toBe(false);
  insertAt(db, active, next + 2, command("late-2"));
  const extended = latest();
  expect(reused(extended.profile)).toBe(true);

  const rebuilt = await rebuiltWithoutStoredProjections(db, active);
  expect(walk(await freshTimeline(), db, active)).toEqual(rebuilt.rows);
  expect(extended.response.rows).toEqual(
    (await freshTimeline()).buildThreadTimelineWithProfile(db, active, {
      completedTurnDisplay: "collapse",
      eventBudget: 100,
      includeClearedContextHistory: false,
      includeDiagnosticOperations: false,
      compactionOfferEnabled: false,
      summarizeShellCommands: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 1 },
    }).response.rows,
  );
});
