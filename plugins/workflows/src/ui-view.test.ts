import { describe, expect, it } from "vitest";
import type {
  WorkflowCallInspection,
  WorkflowRunInspection,
} from "./service.js";
import { buildWorkflowRunView } from "./ui-view.js";

function call(index: number, phase: string | null): WorkflowCallInspection {
  return {
    id: `wfc_${index}`,
    runId: "wfr_test",
    callIndex: index,
    cacheKey: `cache_${index}`,
    prompt: `Prompt ${index}`,
    optionsJson: "{}",
    resolvedProvider: "codex",
    resolvedModel: "gpt-test",
    resolvedReasoningLevel: "medium",
    resolvedPermissionMode: "full",
    status: "succeeded",
    childThreadId: `thr_${index}`,
    providerRetryAttempts: 0,
    repairAttempts: 0,
    resultJson: '"done"',
    error: null,
    replayedFromCallId: null,
    replaySource: null,
    createdAt: index,
    startedAt: index,
    lastActivityAt: index,
    finishedAt: index + 1,
    options: {
      selection: null,
      outputSchema: null,
      title: `Agent ${index}`,
      phase,
    },
    execution: {
      provider: "codex",
      model: "gpt-test",
      reasoningLevel: "medium",
      permissionMode: "full",
    },
    source: "live",
  };
}

function run(calls: WorkflowCallInspection[]): WorkflowRunInspection {
  return {
    id: "wfr_test",
    projectId: "proj_test",
    originThreadId: "thr_origin",
    environmentId: "env_test",
    originProvider: "codex",
    originModel: "gpt-test",
    originReasoningLevel: "medium",
    originPermissionMode: "full",
    name: "phase-test",
    source: `export const meta = {
      name: "phase-test",
      description: "Test phase presentation",
      phases: [{ title: "Declared", detail: "Declared first" }],
    };
    return null;`,
    sourceHash: "source_hash",
    argsJson: "null",
    settingsJson: "{}",
    status: "running",
    resumedFromRunId: null,
    resultJson: null,
    error: null,
    phase: "Empty Current",
    replaySafetyVersion: 1,
    replayBarrierIndex: null,
    notificationSent: false,
    notificationOutcome: "pending",
    notificationAttemptCount: 0,
    notificationNextAttemptAt: null,
    notificationError: null,
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    calls,
  };
}

describe("workflow UI view", () => {
  it("preserves distinct undeclared phases and an empty current phase", () => {
    const inspection = run([
      call(0, "Declared"),
      call(1, "Dynamic B"),
      call(2, null),
      call(3, "Dynamic A"),
    ]);

    const view = buildWorkflowRunView(inspection);

    expect(view.phases.map((phase) => phase.title)).toEqual([
      "Declared",
      "Dynamic B",
      "Dynamic A",
      "Empty Current",
    ]);
    expect(
      view.phases.map((phase) => phase.calls.map((entry) => entry.id)),
    ).toEqual([["wfc_0"], ["wfc_1"], ["wfc_3"], []]);
    expect(view.unphasedCalls.map((entry) => entry.id)).toEqual(["wfc_2"]);
  });

  it("truncates fallback labels by display width", () => {
    const workflowCall = call(0, null);
    workflowCall.prompt = "调".repeat(100);
    workflowCall.options.title = null;

    const view = buildWorkflowRunView(run([workflowCall]));

    expect(view.unphasedCalls[0]?.label).toBe(`${"调".repeat(39)}…`);
  });
});
