import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  threadScope,
} from "@bb/domain";
import type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventItem,
} from "@bb/domain";
import { createClaudeCodeProviderAdapter } from "./adapter.js";
import { CLAUDE_TASK_PROGRESS_THROTTLE_MS } from "./task-translation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../__fixtures__/claude-code");

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
    const adapter = createClaudeCodeProviderAdapter();
    const allEvents: ThreadEvent[] = [];

    for (const message of loadSessionFixture("workflow-mini.ndjson")) {
      // Real capture batches arrive faster than the throttle; spread them out
      // so every progress message is emission-eligible.
      advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
      allEvents.push(
        ...adapter.translateEvent(message, { threadId: "bb-thread-1" }),
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
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);

    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    // Batch 1: phases seeded + agents 1 and 2.
    const batch1 = adapter.translateEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    const batch1Item = backgroundTaskItem(batch1[0]!);
    expect(batch1Item.workflow?.agents).toHaveLength(2);

    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    // Batch 2: only agent 1's progress record — agent 2 must survive the fold.
    const batch2 = adapter.translateEvent(
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
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);

    // Within the throttle window: folded but not emitted.
    advanceClock(100);
    const throttled = adapter.translateEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    expect(collectTaskEvents(throttled)).toHaveLength(0);

    // Still within the window, but a status transition flushes immediately —
    // and the snapshot carries the previously folded (unemitted) records.
    advanceClock(100);
    const updated = adapter.translateEvent(
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
    const flushed = adapter.translateEvent(
      loadFixture("task-progress-workflow-delta.json"),
      context,
    );
    expect(collectTaskEvents(flushed)).toHaveLength(1);
  });

  it("maps killed to a failed item and stopped to an interrupted item", () => {
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);
    const killed = adapter.translateEvent(
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

    const stopped = adapter.translateEvent(
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
    const adapter = createClaudeCodeProviderAdapter();
    const allEvents: ThreadEvent[] = [];

    for (const message of loadSessionFixture("subagent-foreground.ndjson")) {
      advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
      allEvents.push(
        ...adapter.translateEvent(message, { threadId: "bb-thread-1" }),
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
    const adapter = createClaudeCodeProviderAdapter();
    const events = adapter.translateEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      { threadId: "bb-thread-1" },
    );
    expect(events).toHaveLength(0);
  });

  it("preserves skip_transcript on the item", () => {
    const adapter = createClaudeCodeProviderAdapter();
    const started = adapter.translateEvent(
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
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);

    const events = adapter.translateAcceptedCommand({
      command: {
        type: "thread/resume",
        threadId: "bb-thread-1",
        cwd: "/tmp/bb-fixture/workspace",
        providerThreadId: "claude-session-1",
        options: {
          claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructionMode: "append",
      },
    });

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
    const repeat = adapter.translateAcceptedCommand({
      command: {
        type: "thread/resume",
        threadId: "bb-thread-1",
        cwd: "/tmp/bb-fixture/workspace",
        providerThreadId: "claude-session-1",
        options: {
          claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructionMode: "append",
      },
    });
    expect(
      repeat.filter((event) => event.type === "item/backgroundTask/completed"),
    ).toHaveLength(0);
  });

  it("settling preserves an already-completed status reported before the terminal notification", () => {
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);
    // task_updated may report "completed" minutes before task_notification
    // arrives; a settle inside that window must not flip the workflow to
    // interrupted.
    adapter.translateEvent(
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

    const events = adapter.translateAcceptedCommand({
      command: {
        type: "thread/resume",
        threadId: "bb-thread-1",
        cwd: "/tmp/bb-fixture/workspace",
        providerThreadId: "claude-session-1",
        options: {
          claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructionMode: "append",
      },
    });

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
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);

    const events =
      adapter.buildThreadDetachedEvents?.({ threadId: "bb-thread-1" }) ?? [];
    const completed = events.filter(
      (event) => event.type === "item/backgroundTask/completed",
    );
    expect(completed).toHaveLength(1);
    expect(backgroundTaskItem(completed[0]!).status).toBe("interrupted");

    // Threads without state produce nothing.
    expect(
      adapter.buildThreadDetachedEvents?.({ threadId: "bb-thread-other" }),
    ).toEqual([]);
  });

  it("settled tasks ignore late events; a repeated start reopens a new generation", () => {
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    adapter.translateEvent(loadFixture("task-started-workflow.json"), context);
    adapter.translateEvent(
      loadFixture("task-notification-workflow.json"),
      context,
    );

    // Late progress for the settled task: dropped.
    advanceClock(CLAUDE_TASK_PROGRESS_THROTTLE_MS + 1);
    const late = adapter.translateEvent(
      loadFixture("task-progress-workflow-batch1.json"),
      context,
    );
    expect(collectTaskEvents(late)).toHaveLength(0);

    // A fresh task_started for the same id starts a new item generation.
    const reopened = adapter.translateEvent(
      loadFixture("task-started-workflow.json"),
      context,
    );
    const reopenedStarted = collectTaskEvents(reopened).filter(
      (event) => event.type === "item/started",
    );
    expect(reopenedStarted).toHaveLength(1);
    expect(backgroundTaskItem(reopenedStarted[0]!).id).toBe("task:wu7ol9ras#2");
  });

  it("materializes a backgrounded shell command (task_type local_bash)", () => {
    const adapter = createClaudeCodeProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    const started = adapter.translateEvent(
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
    const notified = adapter.translateEvent(
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
    const adapter = createClaudeCodeProviderAdapter();
    const events = adapter.translateEvent(
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
});
