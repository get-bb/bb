// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  WorkflowAgentSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import type { WorkflowRunDisplayState } from "@bb/thread-view";
import { WorkflowAgentTree } from "./WorkflowAgentTree";

const PUBLIC_HAIKU_MODEL = "claude-haiku-4-5-20251001";

const doneAgent: WorkflowAgentSnapshot = {
  index: 1,
  label: "alpha",
  state: "done",
  model: PUBLIC_HAIKU_MODEL,
  attempt: 1,
  cached: false,
  lastProgressAt: 1_000,
  phaseIndex: 1,
  agentType: "reviewer",
  tokens: 8_886,
  toolCalls: 2,
  durationMs: 1_358,
};

const runningAgent: WorkflowAgentSnapshot = {
  index: 2,
  label: "bravo",
  state: "running",
  model: PUBLIC_HAIKU_MODEL,
  attempt: 2,
  cached: false,
  lastProgressAt: 1_100,
  phaseIndex: 1,
};

const queuedAgent: WorkflowAgentSnapshot = {
  index: 3,
  label: "combine",
  state: "queued",
  model: "haiku",
  attempt: 1,
  cached: false,
  lastProgressAt: 1_200,
  phaseIndex: 2,
};

const unphasedCachedAgent: WorkflowAgentSnapshot = {
  index: 4,
  label: "loose-end",
  state: "done",
  model: PUBLIC_HAIKU_MODEL,
  attempt: 1,
  cached: true,
  lastProgressAt: 1_300,
  tokens: 500,
};

const snapshot: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Scan" },
    { index: 2, title: "Summarize" },
    { index: 3, title: "Wrap up" },
  ],
  agents: [doneAgent, runningAgent, queuedAgent, unphasedCachedAgent],
};

function renderTree(runState: WorkflowRunDisplayState) {
  return render(<WorkflowAgentTree runState={runState} snapshot={snapshot} />);
}

afterEach(() => {
  cleanup();
});

describe("WorkflowAgentTree", () => {
  it("groups agents under declared phases with settled-count progress labels", () => {
    renderTree("running");

    // Phase headers carry settled/total progress; a declared-but-unstarted
    // phase reads "not started"; phase-less agents trail without a header.
    expect(screen.getByText("Scan")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("Summarize")).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
    expect(screen.getByText("Wrap up")).toBeTruthy();
    expect(screen.getByText("not started")).toBeTruthy();

    for (const label of ["alpha", "bravo", "combine", "loose-end"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("renders per-agent stat lines from the snapshot", () => {
    renderTree("running");

    // agentType · short model · compact tokens · tools · duration.
    expect(
      screen.getByText("reviewer · haiku · 8.9k tok · 2 tools · 1s"),
    ).toBeTruthy();
    // Running agents render as-is while the run is live; attempt > 1 shows.
    expect(screen.getByText("haiku · attempt 2")).toBeTruthy();
    expect(screen.getByText("haiku · queued")).toBeTruthy();
    expect(screen.getByText("haiku · 500 tok · cached")).toBeTruthy();
  });

  it("renders running agents as paused (and queued agents as queued) when the run is paused", () => {
    renderTree("paused");

    expect(screen.getByText("haiku · attempt 2 · paused")).toBeTruthy();
    expect(screen.getByText("haiku · queued")).toBeTruthy();
    // Settled agents are unaffected by the run state.
    expect(
      screen.getByText("reviewer · haiku · 8.9k tok · 2 tools · 1s"),
    ).toBeTruthy();
  });

  it("renders leftover non-settled agents as stopped when the run is settled", () => {
    renderTree("settled");

    expect(screen.getByText("haiku · attempt 2 · stopped")).toBeTruthy();
    expect(screen.getByText("haiku · stopped")).toBeTruthy();
    expect(screen.queryByText("haiku · queued")).toBeNull();
    expect(
      screen.getByText("reviewer · haiku · 8.9k tok · 2 tools · 1s"),
    ).toBeTruthy();
  });

  it("renders a failed agent's error message", () => {
    const failedSnapshot: WorkflowProgressSnapshot = {
      phases: [],
      agents: [
        {
          ...runningAgent,
          state: "failed",
          attempt: 3,
          error: "agent abandoned: retries exhausted",
        },
      ],
    };
    render(<WorkflowAgentTree runState="settled" snapshot={failedSnapshot} />);

    expect(
      screen.getByText("— agent abandoned: retries exhausted"),
    ).toBeTruthy();
  });
});
