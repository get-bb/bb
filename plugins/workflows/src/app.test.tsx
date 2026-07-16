// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { WorkflowRunView } from "./ui-contract.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const message = {
  id: "msg_1",
  threadId: "thr_origin",
  turnId: "turn_1",
  projectId: "proj_1",
};

const run: WorkflowRunView = {
  id: "wfr_11111111-1111-4111-8111-111111111111",
  name: "Review the release",
  description: "Run independent checks before shipping.",
  status: "running",
  currentPhase: "Review",
  phases: [
    {
      title: "Discover",
      detail: "Inspect the changed surface.",
      calls: [
        {
          id: "wfc_1",
          index: 0,
          label: "Inspect implementation",
          phase: "Discover",
          status: "succeeded",
          provider: "codex",
          model: "gpt-5.6",
          reasoningLevel: "medium",
          cached: false,
          childThreadId: "thr_worker_1",
          repairAttempts: 0,
          error: null,
          createdAt: 1_000,
          startedAt: 1_100,
          finishedAt: 2_100,
        },
      ],
    },
    {
      title: "Review",
      detail: "Challenge the combined result.",
      calls: [
        {
          id: "wfc_2",
          index: 1,
          label: "Adversarial review",
          phase: "Review",
          status: "running",
          provider: "claude",
          model: "claude-opus-4-6",
          reasoningLevel: "high",
          cached: false,
          childThreadId: "thr_worker_2",
          repairAttempts: 0,
          error: null,
          createdAt: 2_200,
          startedAt: 2_300,
          finishedAt: null,
        },
      ],
    },
  ],
  unphasedCalls: [],
  resultAvailable: false,
  error: null,
  createdAt: 900,
  startedAt: 1_000,
  finishedAt: null,
};

describe("workflows app registration", () => {
  it("registers the chat directive and thread panel action", () => {
    expect(app.messageDirectives.map((directive) => directive.id)).toEqual([
      "workflow-preview",
    ]);
    expect(app.threadPanelActions).toMatchObject([
      { id: "workflow-run", title: "Workflow run", icon: "Workflow" },
    ]);
  });
});

describe("workflow-preview directive", () => {
  it("rejects untrusted attributes before making an RPC call", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id, surprise: "true" },
        source: `::workflow-preview{run="${run.id}" surprise="true"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      { rpc: {} },
    );

    expect((await slot.findByRole("alert")).textContent).toMatch(
      /requires exactly one valid run attribute/i,
    );
    expect(slot.rpcCalls).toEqual([]);
  });

  it("renders live phases and opens the matching shared thread panel", async () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel,
      },
      {
        rpc: {
          workflowRunView: (input) => {
            expect(input).toEqual({ threadId: "thr_origin", runId: run.id });
            return { run };
          },
        },
      },
    );

    await slot.findByText("Review the release");
    expect(slot.getByText("Discover")).toBeTruthy();
    expect(slot.getAllByText("Review")).toHaveLength(1);
    expect(slot.getByText("Adversarial review")).toBeTruthy();
    expect(slot.getByText("claude · opus-4-6 · high")).toBeTruthy();

    const workflowToggle = slot.getByRole("button", {
      name: "Workflow: Review the release",
    });
    fireEvent.click(workflowToggle);
    expect(workflowToggle.getAttribute("aria-expanded")).toBe("false");
    const collapsedRegion = document.getElementById(
      workflowToggle.getAttribute("aria-controls")!,
    );
    expect(collapsedRegion?.getAttribute("role")).toBe("region");
    expect(collapsedRegion?.getAttribute("aria-labelledby")).toBe(
      workflowToggle.id,
    );
    expect(collapsedRegion?.hasAttribute("inert")).toBe(true);
    expect(
      collapsedRegion?.querySelector('button[aria-expanded="true"]'),
    ).toBeTruthy();
    fireEvent.click(workflowToggle);

    fireEvent.click(slot.getByRole("button", { name: /open in right panel/i }));
    expect(openThreadPanel).toHaveBeenCalledWith({
      actionId: "workflow-run",
      title: "Review the release",
      params: { runId: run.id },
    });
  });

  it("keeps workers outside declared phases visible", async () => {
    const unphasedRun: WorkflowRunView = {
      ...run,
      currentPhase: null,
      phases: run.phases.map((phase) => ({
        ...phase,
        calls: phase.calls.map((call) => ({
          ...call,
          status: "succeeded" as const,
          finishedAt: 3_000,
        })),
      })),
      unphasedCalls: [
        {
          ...run.phases[0]!.calls[0]!,
          id: "wfc_other",
          label: "Unphased verification",
          phase: null,
          status: "running",
          finishedAt: null,
        },
      ],
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      { rpc: { workflowRunView: () => ({ run: unphasedRun }) } },
    );

    await slot.findByText("Other work");
    expect(slot.getByText("Unphased verification")).toBeTruthy();
  });

  it("recovers from initial and active polling failures, then settles", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const terminalRun: WorkflowRunView = {
      ...run,
      status: "succeeded",
      phases: run.phases.map((phase) => ({
        ...phase,
        calls: phase.calls.map((call) => ({
          ...call,
          status: "succeeded" as const,
          finishedAt: 4_000,
        })),
      })),
      finishedAt: 4_000,
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      {
        rpc: {
          workflowRunView: () => {
            attempt += 1;
            if (attempt === 1) throw new Error("initial outage");
            if (attempt === 3) throw new Error("poll outage");
            return { run: attempt === 2 ? run : terminalRun };
          },
        },
      },
    );

    await act(async () => Promise.resolve());
    expect(slot.getByRole("alert").textContent).toMatch(/initial outage/i);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(slot.getByText("Running")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(slot.getByRole("status").textContent).toMatch(
      /poll outage.*retrying/i,
    );
    expect(slot.getByText("Running")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(slot.getByText("Complete")).toBeTruthy();
    expect(slot.queryByRole("status")).toBeNull();
    expect(attempt).toBe(4);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(attempt).toBe(4);
    slot.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(attempt).toBe(4);
  });

  it("does not overlap a poll that takes longer than the interval", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    let resolvePoll: ((value: { run: WorkflowRunView }) => void) | null = null;
    const delayedPoll = new Promise<{ run: WorkflowRunView }>((resolve) => {
      resolvePoll = resolve;
    });
    const terminalRun: WorkflowRunView = {
      ...run,
      status: "succeeded",
      phases: run.phases.map((phase) => ({
        ...phase,
        calls: phase.calls.map((call) => ({
          ...call,
          status: "succeeded" as const,
          finishedAt: 4_000,
        })),
      })),
      finishedAt: 4_000,
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      {
        rpc: {
          workflowRunView: () => {
            attempt += 1;
            if (attempt === 1) return { run };
            if (attempt === 2) return delayedPoll;
            throw new Error("polls overlapped");
          },
        },
      },
    );

    await act(async () => Promise.resolve());
    expect(slot.getByText("Running")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(attempt).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(attempt).toBe(2);

    await act(async () => {
      resolvePoll?.({ run: terminalRun });
      await delayedPoll;
    });
    expect(slot.getByText("Complete")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(attempt).toBe(2);
  });

  it("renders successful empty phases as settled", async () => {
    const succeededRun: WorkflowRunView = {
      ...run,
      status: "succeeded",
      currentPhase: "Empty phase",
      phases: [{ title: "Empty phase", detail: null, calls: [] }],
      finishedAt: 4_000,
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      { rpc: { workflowRunView: () => ({ run: succeededRun }) } },
    );

    await slot.findByText("Complete");
    expect(
      slot
        .getAllByText("Empty phase")
        .some((element) => element.className.includes("line-through")),
    ).toBe(false);
    expect(
      slot
        .getAllByText("Empty phase")
        .some((element) => element.className.includes("no-underline")),
    ).toBe(true);
    expect(slot.getByText("not started")).toBeTruthy();
  });

  it("uses cancelled presentation for the run, phase, and call", async () => {
    const cancelledCall = {
      ...run.phases[1]!.calls[0]!,
      status: "cancelled" as const,
      finishedAt: 4_000,
    };
    const cancelledRun: WorkflowRunView = {
      ...run,
      status: "cancelled",
      phases: [{ title: "Review", detail: null, calls: [cancelledCall] }],
      finishedAt: 4_000,
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
        openThreadPanel: null,
      },
      { rpc: { workflowRunView: () => ({ run: cancelledRun }) } },
    );

    await slot.findByText("Cancelled");
    // One Pause in the status pill, one on the cancelled call row.
    expect(slot.container.querySelectorAll('[data-icon="Pause"]')).toHaveLength(
      2,
    );
    expect(slot.container.querySelector('[data-icon="Check"]')).toBeNull();
  });
});

describe("workflow thread panel", () => {
  it("opens worker threads and stops an active run through typed RPC", async () => {
    let stopped = false;
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_origin", params: { runId: run.id } },
      {
        rpc: {
          workflowRunView: () => ({
            run: stopped ? { ...run, status: "cancelled" as const } : run,
          }),
          workflowStopRun: (input) => {
            expect(input).toEqual({ threadId: "thr_origin", runId: run.id });
            stopped = true;
            return {
              stopped: true,
              run: { ...run, status: "cancelled" as const },
            };
          },
        },
      },
    );

    await slot.findByText("Run independent checks before shipping.");
    // The settled Discover phase starts collapsed; the active phase is open.
    expect(slot.queryByText("Inspect implementation")).toBeNull();
    expect(slot.getByText("Adversarial review")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /Discover1\/1/ }));
    expect(slot.getByText("Inspect implementation")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /adversarial review/i }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_worker_2",
    });

    fireEvent.click(slot.getByRole("button", { name: "Stop workflow" }));
    await waitFor(() => {
      expect(
        slot.rpcCalls.some((call) => call.method === "workflowStopRun"),
      ).toBe(true);
      expect(slot.getByText("Cancelled")).toBeTruthy();
    });
  });

  it("rejects restored panel params with unknown fields", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      {
        threadId: "thr_origin",
        params: { runId: run.id, unexpected: true },
      },
      { rpc: {} },
    );

    expect((await slot.findByRole("alert")).textContent).toMatch(
      /invalid run parameters/i,
    );
    expect(slot.rpcCalls).toEqual([]);
  });
});
