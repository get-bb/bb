/**
 * Claude background-task invariants — task items, open-work tracking, settle
 * on session replace / thread detach, and the turn-completion rules that
 * decide which kinds of background work hold a bb turn open.
 *
 * The legacy claude-code adapter is gone; these invariants now live on the
 * bridge-shared `createClaudeEventTranslator`, which is what the canonical
 * bridge runs every session-scoped Claude notification through. The tests
 * construct that same translator directly.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventItem,
} from "@bb/domain";
import {
  createClaudeEventTranslator,
  type ClaudeEventTranslator,
} from "./event-translation.js";
import {
  buildInterruptedClaudeTaskEvents,
  hasOpenClaudeBackgroundTasks,
  CLAUDE_TASK_PROGRESS_THROTTLE_MS,
} from "./task-translation.js";

function createTranslator(): ClaudeEventTranslator {
  return createClaudeEventTranslator({
    providerId: "claude-code",
    // The canonical bridge injects per-session entropy here (#1224); these
    // fixed prefixes reproduce the legacy id scheme so the assertions stay
    // readable.
    turnIdPrefix: "turn-",
    itemIdPrefix: "claude-",
    synthesizeItemStarted: true,
  });
}

/**
 * The open-work rule the bridge applies: unsettled background tasks — visible
 * or opaque (monitors) — keep the thread busy.
 */
function hasOpenThreadWork(
  translator: ClaudeEventTranslator,
  threadId: string,
): boolean {
  const state = translator.turnState.get({ threadId });
  return (
    state !== null &&
    (hasOpenClaudeBackgroundTasks(state.tasksById) ||
      state.opaqueTaskIds.size > 0)
  );
}

/**
 * The shared session-replace / thread-detach settle the bridge performs:
 * replacing or losing the CLI session kills its background tasks with it, so
 * every still-open task settles before the session/replaced (or detach)
 * announcement.
 */
function settleOpenClaudeTasks(
  translator: ClaudeEventTranslator,
  threadId: string,
): ThreadEvent[] {
  const state = translator.turnState.get({ threadId });
  if (state === null) {
    return [];
  }
  const events = buildInterruptedClaudeTaskEvents({
    tasks: state.tasksById,
    threadId,
  });
  state.opaqueTaskIds.clear();
  return events;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "./__fixtures__");

function isFixtureObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(FIXTURES, name), "utf8"),
  );
  if (!isFixtureObject(parsed)) {
    throw new Error(`Fixture ${name} did not contain an object`);
  }
  return parsed;
}

function loadSessionFixture(name: string): Record<string, unknown>[] {
  return readFileSync(resolve(FIXTURES, "sessions", name), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isFixtureObject(parsed)) {
        throw new Error(`Session fixture ${name} contained a non-object line`);
      }
      return parsed;
    });
}

function isBackgroundTaskItem(
  item: ThreadEventItem,
): item is ThreadEventBackgroundTaskItem {
  return item.type === "backgroundTask";
}

function backgroundTaskItem(event: ThreadEvent): ThreadEventBackgroundTaskItem {
  if (
    (event.type === "item/started" ||
      event.type === "item/backgroundTask/progress" ||
      event.type === "item/backgroundTask/completed") &&
    isBackgroundTaskItem(event.item)
  ) {
    return event.item;
  }
  throw new Error(`Event ${event.type} did not carry a backgroundTask item`);
}

const TASK_EVENT_TYPES = [
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] as const;

function collectTaskEvents(events: ThreadEvent[]): ThreadEvent[] {
  return events.filter(
    (event) =>
      (TASK_EVENT_TYPES as readonly string[]).includes(event.type) ||
      (event.type === "item/started" && isBackgroundTaskItem(event.item)),
  );
}

describe("claude-code background task translation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advanceClock(ms: number): void {
    vi.setSystemTime(Date.now() + ms);
  }

  it("translates a captured workflow session into one started/progress/completed lifecycle", () => {
    const translator = createTranslator();
    const allEvents: ThreadEvent[] = [];

    for (const message of loadSessionFixture("workflow-mini.ndjson")) {
      // Real capture batches arrive faster than the throttle; spread them out
      // so every progress message is emission-eligible.
      advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
      allEvents.push(
        ...translator.translateClaudeEvent(message, {
          threadId: "bb-thread-1",
        }),
      );
    }

    const taskEvents = collectTaskEvents(allEvents);
    const started = taskEvents.filter((e) => e.type === "item/started");
    const progress = taskEvents.filter(
      (e) => e.type === "item/backgroundTask/progress",
    );
    const completed = taskEvents.filter(
      (e) => e.type === "item/backgroundTask/completed",
    );

    expect(started).toHaveLength(1);
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(completed).toHaveLength(1);

    const startedItem = backgroundTaskItem(started[0]!);
    expect(startedItem).toMatchObject({
      id: "task:wu7ol9ras",
      taskType: "local_workflow",
      workflowName: "fixture-mini",
      status: "pending",
      taskStatus: "running",
      skipTranscript: false,
      parentToolCallId: "toolu_012BkJCmbBgNqL6SXPKNfPvE",
    });
    // The spawning turn places the item; progress/completed are thread-scoped.
    expect(started[0]!.scope.kind).toBe("turn");
    for (const event of [...progress, ...completed]) {
      expect(event.scope).toEqual(threadScope());
    }

    const finalItem = backgroundTaskItem(completed[0]!);
    expect(finalItem.status).toBe("completed");
    expect(finalItem.taskStatus).toBe("completed");
    expect(finalItem.summary).toBe(
      'Dynamic workflow "Tiny fixture workflow for BB capture" completed',
    );
    expect(finalItem.usage).toEqual({
      totalTokens: 26674,
      toolUses: 0,
      durationMs: 3277,
    });
    // Delta batches folded across events: all 3 agents and both phases
    // survive even though later batches only carried changed records.
    expect(finalItem.workflow?.agents.map((a) => a.label)).toEqual([
      "alpha",
      "bravo",
      "combine",
    ]);
    expect(finalItem.workflow?.agents.map((a) => a.state)).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(finalItem.workflow?.phases.map((p) => p.title)).toEqual([
      "Scan",
      "Summarize",
    ]);
  });

  it("folds delta batches: agents from earlier batches survive later partial batches", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );

    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    // Batch 1: phases seeded + agents 1 and 2.
    const batch1 = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    const batch1Item = backgroundTaskItem(batch1[0]!);
    expect(batch1Item.workflow?.agents).toHaveLength(2);

    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    // Batch 2: only agent 1's progress record — agent 2 must survive the fold.
    const batch2 = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-delta.json"),
      context,
    );
    const batch2Item = backgroundTaskItem(batch2[0]!);
    expect(batch2Item.workflow?.agents.map((a) => a.label)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(batch2Item.workflow?.agents[0]).toMatchObject({
      state: "running",
      tokens: 8886,
    });
    // Agent 2's batch-1 records (queued, then started) survive untouched —
    // batch 2 carried nothing for it.
    expect(batch2Item.workflow?.agents[1]).toMatchObject({
      state: "running",
      label: "bravo",
    });
    expect(batch2Item.workflow?.agents[1]?.tokens).toBeUndefined();
    expect(batch2Item.workflow?.phases).toHaveLength(2);
  });

  it("throttles progress events but flushes status transitions immediately", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );

    // Within the throttle window: folded but not emitted.
    advanceClock(100);
    const throttled = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    expect(collectTaskEvents(throttled)).toHaveLength(0);

    // Still within the window, but a status transition flushes immediately —
    // and the snapshot carries the previously folded (unemitted) records.
    advanceClock(100);
    const updated = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_updated",
        task_id: "wu7ol9ras",
        patch: { status: "paused" },
        uuid: "u-1",
        session_id: "s-1",
      },
      context,
    );
    const updatedTaskEvents = collectTaskEvents(updated);
    expect(updatedTaskEvents).toHaveLength(1);
    const pausedItem = backgroundTaskItem(updatedTaskEvents[0]!);
    expect(pausedItem.taskStatus).toBe("paused");
    expect(pausedItem.status).toBe("pending");
    expect(pausedItem.workflow?.agents).toHaveLength(2);

    // After the window, progress emits again.
    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    const flushed = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-delta.json"),
      context,
    );
    expect(collectTaskEvents(flushed)).toHaveLength(1);
  });

  it("maps killed to a failed item and stopped to an interrupted item", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );
    const killed = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_updated",
        task_id: "wu7ol9ras",
        patch: { status: "killed", error: "killed by user" },
        uuid: "u-1",
        session_id: "s-1",
      },
      context,
    );
    const killedItem = backgroundTaskItem(collectTaskEvents(killed)[0]!);
    expect(killedItem.status).toBe("failed");
    expect(killedItem.taskStatus).toBe("killed");
    expect(killedItem.error).toBe("killed by user");

    const stopped = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_notification",
        task_id: "wu7ol9ras",
        status: "stopped",
        output_file: "",
        summary: "Dynamic workflow stopped",
        uuid: "u-2",
        session_id: "s-1",
      },
      context,
    );
    const stoppedEvents = collectTaskEvents(stopped);
    expect(stoppedEvents[0]?.type).toBe("item/backgroundTask/completed");
    const stoppedItem = backgroundTaskItem(stoppedEvents[0]!);
    expect(stoppedItem.status).toBe("interrupted");
    expect(stoppedItem.taskStatus).toBe("stopped");
    // Empty output_file stays absent rather than persisting "".
    expect(stoppedItem.outputFile).toBeUndefined();
  });

  it("materializes subagent tasks while preserving the delegation tool call", () => {
    const translator = createTranslator();
    const allEvents: ThreadEvent[] = [];

    for (const message of loadSessionFixture("subagent-foreground.ndjson")) {
      advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
      allEvents.push(
        ...translator.translateClaudeEvent(message, {
          threadId: "bb-thread-1",
        }),
      );
    }

    const taskEvents = collectTaskEvents(allEvents);
    expect(taskEvents.map((event) => event.type)).toEqual([
      "item/started",
      "item/backgroundTask/completed",
    ]);
    expect(backgroundTaskItem(taskEvents[0]!)).toMatchObject({
      id: "task:a35aa0d9e98a8e8e6",
      taskType: "local_agent",
      description: "Single subagent reply test",
      status: "pending",
      taskStatus: "running",
      parentToolCallId: "toolu_01W1cLr7AsTRvbya9LM5LSAV",
    });
    expect(backgroundTaskItem(taskEvents[1]!)).toMatchObject({
      id: "task:a35aa0d9e98a8e8e6",
      taskType: "local_agent",
      status: "completed",
      taskStatus: "completed",
      summary: "Single subagent reply test",
    });
    // The session still renders: the Task tool call itself is a started item.
    expect(
      allEvents.some(
        (event) =>
          event.type === "item/started" && event.item.type === "toolCall",
      ),
    ).toBe(true);
  });

  it("ignores progress for unknown task ids (daemon restarted mid-run)", () => {
    const translator = createTranslator();
    const events = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      { threadId: "bb-thread-1" },
    );
    expect(events).toHaveLength(0);
  });

  it("tracks monitors as open work without timeline rows", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-monitor" };

    const started = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_started",
        task_id: "monitor-1",
        description: "Watch the build",
        task_type: "monitor",
        uuid: "u-monitor-1",
        session_id: "s-monitor-1",
      },
      context,
    );

    expect(started).toEqual([]);
    expect(hasOpenThreadWork(translator, context.threadId)).toBe(true);

    const completed = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_notification",
        task_id: "monitor-1",
        status: "completed",
        output_file: "",
        summary: "Build complete",
        uuid: "u-monitor-2",
        session_id: "s-monitor-1",
      },
      context,
    );

    expect(completed).toEqual([]);
    expect(hasOpenThreadWork(translator, context.threadId)).toBe(false);
  });

  it("preserves skip_transcript on the item", () => {
    const translator = createTranslator();
    const started = translator.translateClaudeEvent(
      {
        ...loadFixture("task-started-workflow.json"),
        skip_transcript: true,
      },
      { threadId: "bb-thread-1" },
    );
    const item = backgroundTaskItem(collectTaskEvents(started)[0]!);
    expect(item.skipTranscript).toBe(true);
  });

  it("settles open tasks as interrupted when the thread resumes", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );

    const events = settleOpenClaudeTasks(translator, "bb-thread-1");

    const completed = events.filter(
      (event) => event.type === "item/backgroundTask/completed",
    );
    expect(completed).toHaveLength(1);
    const item = backgroundTaskItem(completed[0]!);
    expect(item).toMatchObject({
      id: "task:wu7ol9ras",
      status: "interrupted",
      taskStatus: "stopped",
    });
    expect(completed[0]?.threadId).toBe("bb-thread-1");

    // Idempotent: a second resume has nothing left to settle.
    const repeat = settleOpenClaudeTasks(translator, "bb-thread-1");
    expect(
      repeat.filter((event) => event.type === "item/backgroundTask/completed"),
    ).toHaveLength(0);
  });

  it("settling preserves an already-completed status reported before the terminal notification", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );
    // task_updated may report "completed" minutes before task_notification
    // arrives; a settle inside that window must not flip the workflow to
    // interrupted.
    translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_updated",
        task_id: "wu7ol9ras",
        patch: { status: "completed" },
        uuid: "u-1",
        session_id: "s-1",
      },
      context,
    );

    const events = settleOpenClaudeTasks(translator, "bb-thread-1");

    const completed = events.filter(
      (event) => event.type === "item/backgroundTask/completed",
    );
    expect(completed).toHaveLength(1);
    expect(backgroundTaskItem(completed[0]!)).toMatchObject({
      id: "task:wu7ol9ras",
      status: "completed",
      taskStatus: "completed",
    });
  });

  it("settles open tasks as interrupted when the thread detaches (process exit)", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );

    const events = settleOpenClaudeTasks(translator, "bb-thread-1");
    const completed = events.filter(
      (event) => event.type === "item/backgroundTask/completed",
    );
    expect(completed).toHaveLength(1);
    expect(backgroundTaskItem(completed[0]!).status).toBe("interrupted");

    // Threads without state produce nothing.
    expect(settleOpenClaudeTasks(translator, "bb-thread-other")).toEqual([]);
  });

  it("preserves the parent link when a settled Claude task restarts", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );
    translator.translateClaudeEvent(
      loadFixture("task-notification-workflow.json"),
      context,
    );

    // Late progress for the settled task: dropped.
    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    const late = translator.translateClaudeEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    expect(collectTaskEvents(late)).toHaveLength(0);

    // A fresh task_started for the same id starts a new item generation.
    const reopened = translator.translateClaudeEvent(
      {
        ...loadFixture("task-started-workflow.json"),
        tool_use_id: "toolu_send_message_1",
      },
      context,
    );
    const reopenedStarted = collectTaskEvents(reopened).filter(
      (event) => event.type === "item/started",
    );
    expect(reopenedStarted).toHaveLength(1);
    expect(backgroundTaskItem(reopenedStarted[0]!)).toMatchObject({
      id: "task:wu7ol9ras#2",
      parentToolCallId: "toolu_send_message_1",
    });
  });

  it("materializes a backgrounded shell command (task_type local_bash)", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    const started = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_started",
        task_id: "bmn5wv33k",
        tool_use_id: "toolu_bash_1",
        description: "Count ticks from 1 to 6 with 1 second delays",
        task_type: "local_bash",
        uuid: "u-1",
        session_id: "s-1",
      },
      context,
    );
    const startedTask = collectTaskEvents(started);
    expect(startedTask).toHaveLength(1);
    expect(startedTask[0]!.type).toBe("item/started");
    const startedItem = backgroundTaskItem(startedTask[0]!);
    expect(startedItem).toMatchObject({
      id: "task:bmn5wv33k",
      taskType: "local_bash",
      description: "Count ticks from 1 to 6 with 1 second delays",
      status: "pending",
      taskStatus: "running",
      skipTranscript: false,
      parentToolCallId: "toolu_bash_1",
    });
    // A shell command carries no workflow phase/agent tree.
    expect(startedItem.workflow).toBeUndefined();
    expect(startedItem.workflowName).toBeUndefined();

    // The terminal notification settles the row as completed with the provider
    // summary (which embeds the exit code).
    const notified = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_notification",
        task_id: "bmn5wv33k",
        tool_use_id: "toolu_bash_1",
        status: "completed",
        output_file: "/tmp/tasks/bmn5wv33k.output",
        summary:
          'Background command "Count ticks from 1 to 6 with 1 second delays" completed (exit code 0)',
        uuid: "u-2",
        session_id: "s-1",
      },
      context,
    );
    const completed = notified.filter(
      (event) => event.type === "item/backgroundTask/completed",
    );
    expect(completed).toHaveLength(1);
    expect(backgroundTaskItem(completed[0]!)).toMatchObject({
      id: "task:bmn5wv33k",
      taskType: "local_bash",
      status: "completed",
      taskStatus: "completed",
      summary:
        'Background command "Count ticks from 1 to 6 with 1 second delays" completed (exit code 0)',
    });
  });

  it("materializes background subagents with legacy task_type local_subagent", () => {
    const translator = createTranslator();
    const events = translator.translateClaudeEvent(
      {
        type: "system",
        subtype: "task_started",
        task_id: "sub-1",
        tool_use_id: "toolu_sub_1",
        description: "background subagent",
        task_type: "local_subagent",
        subagent_type: "Explore",
        uuid: "u-1",
        session_id: "s-1",
      },
      { threadId: "bb-thread-1" },
    );

    const taskEvents = collectTaskEvents(events);
    expect(taskEvents).toHaveLength(1);
    expect(backgroundTaskItem(taskEvents[0]!)).toMatchObject({
      id: "task:sub-1",
      taskType: "local_subagent",
      description: "background subagent",
      status: "pending",
      taskStatus: "running",
      parentToolCallId: "toolu_sub_1",
    });
  });

  // -- turn completion vs. open background work -----------------------------

  it("keeps one logical turn open across Claude background-agent reinvocations", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will wait for the agent." }],
        },
        session_id: "sess-1",
      },
      context,
    );
    translator.translateClaudeEvent(
      loadFixture("task-started-subagent.json"),
      context,
    );

    const intermediateResult = translator.translateClaudeEvent(
      {
        type: "result",
        subtype: "end_turn",
        session_id: "sess-1",
      },
      context,
    );
    expect(intermediateResult).not.toContainEqual(
      expect.objectContaining({ type: "turn/completed" }),
    );

    translator.translateClaudeEvent(
      loadFixture("task-notification-subagent.json"),
      context,
    );
    const resumed = translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The agent finished." }],
        },
        session_id: "sess-1",
      },
      context,
    );
    expect(resumed).not.toContainEqual(
      expect.objectContaining({ type: "turn/started" }),
    );
    expect(resumed).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "agentMessage",
          text: "The agent finished.",
        }),
      }),
    );

    const finalResult = translator.translateClaudeEvent(
      {
        type: "result",
        subtype: "end_turn",
        session_id: "sess-1",
      },
      context,
    );
    expect(finalResult).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
  });

  it("treats legacy subagents as completion-blocking", () => {
    const blockingTasks = [
      {
        type: "system",
        subtype: "task_started",
        task_id: "subagent-1",
        tool_use_id: "tool-subagent-1",
        description: "Legacy subagent",
        task_type: "local_subagent",
        subagent_type: "Explore",
        uuid: "uuid-subagent-1",
        session_id: "sess-1",
      },
    ];

    for (const [index, task] of blockingTasks.entries()) {
      const translator = createTranslator();
      const context = { threadId: `bb-thread-${index}` };
      translator.translateClaudeEvent(
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "waiting" }],
          },
          session_id: "sess-1",
        },
        context,
      );
      translator.translateClaudeEvent(task, context);

      const events = translator.translateClaudeEvent(
        {
          type: "result",
          subtype: "end_turn",
          session_id: "sess-1",
        },
        context,
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "turn/completed" }),
      );
    }
  });

  it("does not let detached or ambient tasks block turn completion", () => {
    for (const task of [
      {
        task_id: "bash-1",
        task_type: "local_bash",
        description: "Run a detached server",
      },
      {
        task_id: "ambient-agent-1",
        task_type: "local_agent",
        description: "Ambient agent",
        skip_transcript: true,
      },
    ]) {
      const translator = createTranslator();
      const context = { threadId: `bb-thread-${task.task_id}` };
      translator.translateClaudeEvent(
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
          },
          session_id: "sess-1",
        },
        context,
      );
      translator.translateClaudeEvent(
        {
          type: "system",
          subtype: "task_started",
          tool_use_id: `tool-${task.task_id}`,
          uuid: `uuid-${task.task_id}`,
          session_id: "sess-1",
          ...task,
        },
        context,
      );

      const events = translator.translateClaudeEvent(
        {
          type: "result",
          subtype: "end_turn",
          session_id: "sess-1",
        },
        context,
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn/completed",
          scope: turnScope("turn-1"),
          status: "completed",
        }),
      );
    }
  });

  it("completes the turn while a workflow keeps running, leaving the task open", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-workflow" };
    translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "started the workflow" }],
        },
        session_id: "sess-1",
      },
      context,
    );
    const started = translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );

    const events = translator.translateClaudeEvent(
      {
        type: "result",
        subtype: "end_turn",
        session_id: "sess-1",
      },
      context,
    );

    // The turn ends so the thread goes idle and the composer sends instead of
    // queueing, while the still-pending task keeps driving the workflow
    // indicators.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
    expect(started).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "backgroundTask",
          taskType: "local_workflow",
          status: "pending",
        }),
      }),
    );
  });

  it("opens a fresh turn when a settled workflow reinvokes the model", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-workflow-settle" };
    translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "started the workflow" }],
        },
        session_id: "sess-1",
      },
      context,
    );
    translator.translateClaudeEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );
    translator.translateClaudeEvent(
      { type: "result", subtype: "end_turn", session_id: "sess-1" },
      context,
    );

    translator.translateClaudeEvent(
      loadFixture("task-notification-workflow.json"),
      context,
    );
    const reinvoked = translator.translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The workflow finished." }],
        },
        session_id: "sess-1",
      },
      context,
    );

    // The first turn already closed, so the workflow's follow-up work gets its
    // own turn instead of reopening the settled one.
    expect(reinvoked).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-2"),
      }),
    );
    expect(
      translator.translateClaudeEvent(
        { type: "result", subtype: "end_turn", session_id: "sess-1" },
        context,
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-2"),
        status: "completed",
      }),
    );
  });

  it("closes a failed result even while a background agent is open", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };
    translator.translateClaudeEvent(
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "x" }] },
        session_id: "sess-1",
      },
      context,
    );
    translator.translateClaudeEvent(
      loadFixture("task-started-subagent.json"),
      context,
    );

    const events = translator.translateClaudeEvent(
      {
        type: "result",
        subtype: "error",
        session_id: "sess-1",
      },
      context,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
      }),
    );
  });
});
