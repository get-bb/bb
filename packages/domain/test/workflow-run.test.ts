import { describe, expect, it } from "vitest";
import { BB_WORKFLOW_TASK_TYPE } from "../src/background-task.js";
import { canonicalizeWorkflowRunEventPayload } from "../src/producer-event-payload.js";
import {
  getWorkflowRunEventAgentIndex,
  WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
  WORKFLOW_RUN_TERMINAL_EVENT_TYPES,
  workflowRunEventSchema,
  workflowRunJournalEntrySchema,
  workflowRunStatusValues,
  type WorkflowRunEvent,
  type WorkflowRunEventType,
  type WorkflowRunJournalEntry,
} from "../src/workflow-run.js";

const completedEntry: WorkflowRunJournalEntry = {
  key: "bb1:abc123",
  agentIndex: 1,
  branchKey: "root",
  status: "completed",
  resultText: "done",
  structured: { findings: ["a", "b"] },
  usage: { inputTokens: 120, outputTokens: 30 },
  provider: "fake-provider",
  model: "fake-model",
  worktreeBranch: "wf/wfr_abc-1",
  durationMs: 4200,
};

const failedEntry: WorkflowRunJournalEntry = {
  key: "bb1:def456",
  agentIndex: 2,
  branchKey: "root/p0",
  status: "failed",
  resultText: "",
  usage: { inputTokens: 50, outputTokens: 5 },
  provider: "fake-provider",
  durationMs: 900,
};

const agentMeta = {
  agentIndex: 1,
  label: "researcher",
  provider: "fake-provider",
  model: "fake-model",
  phaseIndex: 1,
  phaseTitle: "Research",
} as const;

/**
 * One fixture per union member. The exhaustiveness test below forces this map
 * to grow whenever the event union does, so every durable event type always
 * has a parse-covered fixture.
 */
const eventFixturesByType: Record<WorkflowRunEventType, WorkflowRunEvent> = {
  "run/started": { type: "run/started", runId: "wfr_abc" },
  "phase/started": { type: "phase/started", phaseIndex: 1, title: "Research" },
  "agent/queued": {
    type: "agent/queued",
    promptPreview: "Research topic X",
    ...agentMeta,
  },
  "agent/started": { type: "agent/started", ...agentMeta },
  "agent/progress": {
    type: "agent/progress",
    lastToolName: "read_file",
    inputTokens: 10,
    outputTokens: 2,
    ...agentMeta,
  },
  "agent/completed": {
    type: "agent/completed",
    cached: false,
    entry: completedEntry,
    ...agentMeta,
  },
  "agent/failed": {
    type: "agent/failed",
    error: "provider exploded",
    entry: failedEntry,
    ...agentMeta,
    agentIndex: 2,
  },
  log: { type: "log", message: "starting fan-out" },
  "run/completed": {
    type: "run/completed",
    result: { summary: "ok" },
    usage: { inputTokens: 170, outputTokens: 35 },
  },
  "run/failed": {
    type: "run/failed",
    error: "budget exceeded",
    usage: { inputTokens: 200, outputTokens: 90 },
  },
  "run/cancelled": {
    type: "run/cancelled",
    usage: { inputTokens: 20, outputTokens: 1 },
  },
};

describe("workflowRunEventSchema", () => {
  it.each(Object.entries(eventFixturesByType))(
    "round-trips a %s event",
    (_type, event) => {
      expect(workflowRunEventSchema.parse(event)).toEqual(event);
    },
  );

  it("covers every union member with a fixture", () => {
    const unionTypes = workflowRunEventSchema.options
      .map((option) => option.shape.type.value)
      .sort();
    expect(Object.keys(eventFixturesByType).sort()).toEqual(unionTypes);
  });

  it("rejects unknown event types", () => {
    expect(
      workflowRunEventSchema.safeParse({ type: "run/paused" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict payloads hash-stably)", () => {
    expect(
      workflowRunEventSchema.safeParse({
        type: "log",
        message: "hi",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("carries the full journal entry on agent/failed (failure entries pin index and billed usage)", () => {
    const parsed = workflowRunEventSchema.parse(
      eventFixturesByType["agent/failed"],
    );
    if (parsed.type !== "agent/failed") {
      throw new Error("expected agent/failed");
    }
    expect(parsed.entry).toEqual(failedEntry);
    expect(parsed.entry.usage.inputTokens).toBe(50);
  });

  it("accepts any non-empty provider string (domain cannot depend on the provider catalog)", () => {
    const event = { ...eventFixturesByType["agent/started"], provider: "pi" };
    expect(workflowRunEventSchema.parse(event)).toEqual(event);
    expect(
      workflowRunJournalEntrySchema.safeParse({
        ...completedEntry,
        provider: "",
      }).success,
    ).toBe(false);
  });
});

describe("workflow run event helpers", () => {
  it("derives the persisted agentIndex per event type", () => {
    const expectedByType: Record<WorkflowRunEventType, number | null> = {
      "run/started": null,
      "phase/started": null,
      "agent/queued": 1,
      "agent/started": 1,
      "agent/progress": 1,
      "agent/completed": 1,
      "agent/failed": 2,
      log: null,
      "run/completed": null,
      "run/failed": null,
      "run/cancelled": null,
    };
    for (const [type, event] of Object.entries(eventFixturesByType)) {
      expect(getWorkflowRunEventAgentIndex(event), type).toBe(
        expectedByType[type as WorkflowRunEventType],
      );
    }
  });

  it("rebuilds the journal from completed AND failed events", () => {
    expect([...WORKFLOW_RUN_JOURNAL_EVENT_TYPES]).toEqual([
      "agent/completed",
      "agent/failed",
    ]);
  });

  it("declares the three run-terminal event types", () => {
    expect([...WORKFLOW_RUN_TERMINAL_EVENT_TYPES]).toEqual([
      "run/completed",
      "run/failed",
      "run/cancelled",
    ]);
  });

  it("keeps the status enum to the plan's current-state values", () => {
    expect([...workflowRunStatusValues]).toEqual([
      "created",
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]);
  });
});

describe("canonicalizeWorkflowRunEventPayload", () => {
  it("is stable under object key ordering", () => {
    const reordered: WorkflowRunEvent = {
      usage: { outputTokens: 35, inputTokens: 170 },
      result: { summary: "ok" },
      type: "run/completed",
    };
    expect(
      canonicalizeWorkflowRunEventPayload({
        event: eventFixturesByType["run/completed"],
        runId: "wfr_abc",
      }),
    ).toBe(
      canonicalizeWorkflowRunEventPayload({ event: reordered, runId: "wfr_abc" }),
    );
  });

  it("binds the hash input to the run id", () => {
    const event = eventFixturesByType.log;
    expect(
      canonicalizeWorkflowRunEventPayload({ event, runId: "wfr_abc" }),
    ).not.toBe(canonicalizeWorkflowRunEventPayload({ event, runId: "wfr_def" }));
  });
});

describe("workflow background-task discriminant", () => {
  it("is the bb_workflow task type", () => {
    expect(BB_WORKFLOW_TASK_TYPE).toBe("bb_workflow");
  });
});
