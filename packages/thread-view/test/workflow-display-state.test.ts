import { workflowRunStatusValues, workflowAgentStateValues } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  deriveWorkflowAgentDisplayState,
  workflowRunDisplayState,
  type WorkflowRunDisplayState,
} from "../src/index.js";

describe("workflowRunDisplayState", () => {
  it("maps every run status to its canonical display run state", () => {
    const expected: Record<
      (typeof workflowRunStatusValues)[number],
      WorkflowRunDisplayState
    > = {
      created: "running",
      starting: "running",
      running: "running",
      interrupted: "paused",
      completed: "settled",
      failed: "settled",
      cancelled: "settled",
    };
    for (const status of workflowRunStatusValues) {
      expect(workflowRunDisplayState(status)).toBe(expected[status]);
    }
  });
});

describe("deriveWorkflowAgentDisplayState", () => {
  it("keeps settled agent states regardless of the run state", () => {
    for (const runState of ["running", "paused", "settled"] as const) {
      expect(deriveWorkflowAgentDisplayState("done", runState)).toBe("done");
      expect(deriveWorkflowAgentDisplayState("failed", runState)).toBe(
        "failed",
      );
      expect(deriveWorkflowAgentDisplayState("skipped", runState)).toBe(
        "skipped",
      );
    }
  });

  it("renders running agents of a paused run as paused while queued agents stay queued", () => {
    expect(deriveWorkflowAgentDisplayState("running", "paused")).toBe("paused");
    expect(deriveWorkflowAgentDisplayState("queued", "paused")).toBe("queued");
  });

  it("renders leftover non-settled agents of a settled run as interrupted", () => {
    expect(deriveWorkflowAgentDisplayState("running", "settled")).toBe(
      "interrupted",
    );
    expect(deriveWorkflowAgentDisplayState("queued", "settled")).toBe(
      "interrupted",
    );
  });

  it("passes every snapshot state through unchanged while the run is live", () => {
    for (const state of workflowAgentStateValues) {
      expect(deriveWorkflowAgentDisplayState(state, "running")).toBe(state);
    }
  });
});
