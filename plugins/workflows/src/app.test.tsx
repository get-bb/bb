// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { workflowUiRpcContract } from "./ui-contract.js";
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
          providerRetryAttempts: 0,
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
          providerRetryAttempts: 0,
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

describe("workflow composer banner", () => {
  const banner = app.composerCustomizations[0]!.banners![0]!;

  it("renders active runs for the composer scope thread", async () => {
    const queuedRun: WorkflowRunView = {
      ...run,
      id: "wfr_22222222-2222-4222-8222-222222222222",
      name: "Queue release notes",
      status: "queued",
      currentPhase: null,
      phases: [],
      startedAt: null,
    };
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: {
          workflowActiveRuns: (input) => {
            expect(input).toEqual({ threadId: "thr_scope" });
            return { runs: [run, queuedRun] };
          },
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "2 workflows running. Show all",
      }),
    );
    expect(slot.getByText("Review the release")).toBeTruthy();
    expect(slot.getByText("Queue release notes")).toBeTruthy();
    expect(slot.getByText("Review")).toBeTruthy();
    expect(slot.getByText("1/2 agents")).toBeTruthy();
    expect(slot.getAllByRole("region", { name: "Workflow" })).toHaveLength(2);
    expect(
      slot.getByRole("button", {
        name: /open workflow review.*in side panel/i,
      }),
    ).toBeTruthy();
  });

  it("auto-collapses multiple active runs into a stack that expands to every run", async () => {
    const runs = [1, 2, 3, 4].map((index) => ({
      ...run,
      id: `wfr_${index}1111111-1111-4111-8111-111111111111`,
      name: `Build ${index}`,
    }));
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: { workflowActiveRuns: () => ({ runs }) },
      },
    );

    const stack = await slot.findByRole("button", {
      name: "4 workflows running. Show all",
    });
    expect(stack.getAttribute("aria-expanded")).toBe("false");
    expect(slot.getByText("4")).toBeTruthy();
    expect(
      slot.container.querySelectorAll("[data-prompt-stack-peek]"),
    ).toHaveLength(2);
    expect(slot.queryAllByRole("region", { name: "Workflow" })).toHaveLength(0);

    fireEvent.click(stack);
    expect(slot.getAllByRole("region", { name: "Workflow" })).toHaveLength(4);
    const collapse = slot.getByRole("button", { name: "Collapse 4 workflows" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(collapse);
    expect(
      slot.container.querySelectorAll("[data-prompt-stack-peek]"),
    ).toHaveLength(0);

    fireEvent.click(collapse);
    expect(slot.queryAllByRole("region", { name: "Workflow" })).toHaveLength(0);
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "4 workflows running. Show all" }),
    );
  });

  it("re-collapses the stack after every run finishes and new runs start", async () => {
    const runs = [1, 2].map((index) => ({
      ...run,
      id: `wfr_${index}1111111-1111-4111-8111-111111111111`,
      name: `Build ${index}`,
    }));
    let current: WorkflowRunView[] = runs;
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: { workflowActiveRuns: () => ({ runs: current }) },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "2 workflows running. Show all",
      }),
    );
    expect(
      slot.getByRole("button", { name: "Collapse 2 workflows" }),
    ).toBeTruthy();

    current = [];
    await act(async () => slot.experimental_invalidateRpc(["runs:thr_scope"]));
    await waitFor(() =>
      expect(
        slot.queryByRole("button", { name: "Collapse 2 workflows" }),
      ).toBeNull(),
    );

    current = runs;
    await act(async () => slot.experimental_invalidateRpc(["runs:thr_scope"]));
    expect(
      await slot.findByRole("button", {
        name: "2 workflows running. Show all",
      }),
    ).toBeTruthy();
  });

  it("expands from the card and collapses from the chevron row with focus following", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: { workflowActiveRuns: () => ({ runs: [run] }) },
      },
    );

    const toggle = await slot.findByRole("button", {
      name: "Workflow: Review the release",
    });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    const body = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(body?.getAttribute("role")).toBe("region");
    expect(body?.getAttribute("aria-labelledby")).toBe(toggle.id);
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(body?.className).toContain("grid-rows-[0fr]");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.getAttribute("aria-hidden")).toBe("false");
    expect(body?.className).toContain("grid-rows-[1fr]");
    expect(slot.getByText("Adversarial review")).toBeTruthy();
    expect(slot.getByRole("button", { name: /Review0\/1/ })).toBeTruthy();
    const collapse = slot.getByRole("button", {
      name: "Collapse workflow Review the release",
    });
    expect(document.activeElement).toBe(collapse);

    fireEvent.click(collapse);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(body?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("preserves each run's expansion state after another client updates it", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: {
          workflowActiveRuns: () => {
            return { runs: [{ ...run }] };
          },
        },
      },
    );

    const toggle = await slot.findByRole("button", {
      name: "Workflow: Review the release",
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await act(async () => slot.experimental_invalidateRpc(["runs:thr_scope"]));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    slot.unmount();
  });

  it("renders null when the scope thread has no active runs", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_idle" },
        },
        experimental_rpcContract: workflowUiRpcContract,
        rpc: { workflowActiveRuns: () => ({ runs: [] }) },
      },
    );

    await waitFor(() => expect(slot.rpcCalls).toHaveLength(1));
    expect(slot.container.childElementCount).toBe(0);
  });

  it("shows and removes active runs changed by another client", async () => {
    let runs: WorkflowRunView[] = [];
    const slot = renderSlot(
      banner,
      {},
      {
        experimental_rpcContract: workflowUiRpcContract,
        composer: { scope: { kind: "thread", threadId: "thr_idle" } },
        rpc: { workflowActiveRuns: () => ({ runs }) },
      },
    );
    await waitFor(() => expect(slot.container.childElementCount).toBe(0));
    await act(async () => Promise.resolve());
    runs = [run];
    await act(async () => slot.experimental_invalidateRpc(["runs:thr_idle"]));
    await slot.findByText(run.name);
    runs = [];
    await act(async () => slot.experimental_invalidateRpc(["runs:thr_idle"]));
    await waitFor(() => expect(slot.queryByText(run.name)).toBeNull());
  });

  it("opens the run in the workflow side panel without stopping it", async () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = renderSlot(
      banner,
      {},
      {
        composer: {
          scope: { kind: "thread", threadId: "thr_scope" },
        },
        openThreadPanel,
        experimental_rpcContract: workflowUiRpcContract,
        rpc: {
          workflowActiveRuns: () => ({ runs: [run] }),
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: /open workflow review.*in side panel/i,
      }),
    );
    expect(openThreadPanel).toHaveBeenCalledWith({
      actionId: "workflow-run",
      title: "Review the release",
      params: { runId: run.id },
    });
    expect(
      slot.rpcCalls.some((call) => call.method === "workflowStopRun"),
    ).toBe(false);
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
      },
      {
        openThreadPanel,
        experimental_rpcContract: workflowUiRpcContract,
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
    expect(slot.queryByText("Running")).toBeNull();
    expect(
      slot.getByText("Review the release").className.includes("animate-shine"),
    ).toBe(true);
    expect(
      slot.getByText("Adversarial review").className.includes("animate-shine"),
    ).toBe(false);
    expect(
      slot.getAllByText("Review")[0]!.className.includes("animate-shine"),
    ).toBe(false);

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

  it("opens actionable worker rows and leaves rows without a child thread inert", async () => {
    const runWithInertWorker: WorkflowRunView = {
      ...run,
      phases: run.phases.map((phase) => ({
        ...phase,
        calls: phase.calls.map((call) =>
          call.id === "wfc_1" ? { ...call, childThreadId: null } : call,
        ),
      })),
    };
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { run: run.id },
        source: `::workflow-preview{run="${run.id}"}`,
        message,
        openWorkspaceFile: null,
      },
      { rpc: { workflowRunView: () => ({ run: runWithInertWorker }) } },
    );

    await slot.findByText("Adversarial review");
    fireEvent.click(slot.getByRole("button", { name: /adversarial review/i }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_worker_2",
    });

    fireEvent.click(slot.getByRole("button", { name: /Discover1\/1/ }));
    const inertWorker = slot.getByText("Inspect implementation").parentElement;
    expect(inertWorker?.tagName).toBe("DIV");
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
      },
      { rpc: { workflowRunView: () => ({ run: unphasedRun }) } },
    );

    await slot.findByText("Other work");
    expect(slot.getByText("Unphased verification")).toBeTruthy();
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
      },
      { rpc: { workflowRunView: () => ({ run: cancelledRun }) } },
    );

    await slot.findByText("Cancelled");
    expect(slot.container.querySelectorAll('[data-icon="Pause"]')).toHaveLength(
      2,
    );
    expect(slot.container.querySelector('[data-icon="Check"]')).toBeNull();
  });
});

describe("workflow thread panel", () => {
  it.each([true, false])(
    "opens workers and refreshes after Stop returns stopped=%s",
    async (didStop) => {
      let stopped = false;
      const slot = renderSlot(
        app.threadPanelActions[0]!,
        { threadId: "thr_origin", params: { runId: run.id } },
        {
          experimental_rpcContract: workflowUiRpcContract,
          rpc: {
            workflowRunView: () => ({
              run: stopped ? { ...run, status: "cancelled" as const } : run,
            }),
            workflowStopRun: (input) => {
              expect(input).toEqual({ threadId: "thr_origin", runId: run.id });
              stopped = true;
              return {
                stopped: didStop,
                run: { ...run, status: "cancelled" as const },
              };
            },
          },
        },
      );

      await slot.findByText("Run independent checks before shipping.");
      const scrollArea = slot.container.querySelector(
        '[data-detail-scroll-area="workflow-panel"]',
      );
      expect(scrollArea?.className).toContain("p-4");
      expect(scrollArea?.parentElement?.className).toContain("bg-border");
      expect(slot.queryByText("Inspect implementation")).toBeNull();
      expect(slot.getByText("Adversarial review")).toBeTruthy();
      fireEvent.click(slot.getByRole("button", { name: /Discover1\/1/ }));
      expect(slot.getByText("Inspect implementation")).toBeTruthy();
      fireEvent.click(
        slot.getByRole("button", { name: /adversarial review/i }),
      );
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
    },
  );

  it.each([
    ["loading", () => new Promise<never>(() => undefined)],
    ["an initial RPC error", () => Promise.reject(new Error("Unavailable"))],
    ["no matching run", () => ({ run: null })],
  ])("keeps local spacing while showing %s", async (_name, workflowRunView) => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_origin", params: { runId: run.id } },
      {
        experimental_rpcContract: workflowUiRpcContract,
        rpc: { workflowRunView },
      },
    );

    await waitFor(() => {
      const state =
        slot.container.querySelector('[aria-busy="true"]') ??
        slot.container.querySelector('[role="alert"]');
      expect(state?.parentElement?.className).toContain("p-4");
      expect(state?.className).not.toMatch(
        /\b(?:bg-muted|border|p-3|px-3|rounded-lg|rounded-md)\b/,
      );
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
    expect(slot.getByRole("alert").parentElement?.className).toContain("p-4");
    expect(slot.rpcCalls).toEqual([]);
  });
});

const previewProps = {
  attributes: { run: run.id },
  source: `::workflow-preview{run="${run.id}"}`,
  message,
  openWorkspaceFile: null,
};

it.each(["preview", "panel", "banner"] as const)(
  "%s offers Retry on initial and refresh errors and keeps loaded content",
  async (surface) => {
    let failing = true;
    const options = {
      experimental_rpcContract: workflowUiRpcContract,
      composer: {
        scope: { kind: "thread" as const, threadId: message.threadId },
      },
      rpc: {
        workflowRunView: () => {
          if (failing) throw new Error("History unavailable");
          return { run };
        },
        workflowActiveRuns: () => {
          if (failing) throw new Error("History unavailable");
          return { runs: [run] };
        },
      },
    };
    const slot =
      surface === "preview"
        ? renderSlot(app.messageDirectives[0]!, previewProps, options)
        : surface === "panel"
          ? renderSlot(
              app.threadPanelActions[0]!,
              { threadId: message.threadId, params: { runId: run.id } },
              options,
            )
          : renderSlot(
              app.composerCustomizations[0]!.banners![0]!,
              {},
              options,
            );
    await slot.findByText(/History unavailable/, {}, { timeout: 10_000 });
    expect(slot.queryByText(/retrying/i)).toBeNull();
    failing = false;
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    const name = await slot.findByText(run.name);
    await waitFor(() =>
      expect(slot.queryByText(/History unavailable/)).toBeNull(),
    );
    failing = true;
    await act(async () =>
      slot.experimental_invalidateRpc([`runs:${message.threadId}`]),
    );
    await slot.findByText(/History unavailable/, {}, { timeout: 10_000 });
    expect(name.isConnected).toBe(true);
    expect(slot.queryByText(/retrying/i)).toBeNull();
    failing = false;
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(slot.queryByText(/History unavailable/)).toBeNull(),
    );
  },
);

it.each(["preview", "panel"] as const)(
  "%s surfaces a refresh failure after an empty result and recovers with Retry",
  async (surface) => {
    let failing = false;
    const options = {
      experimental_rpcContract: workflowUiRpcContract,
      rpc: {
        workflowRunView: () => {
          if (failing) throw new Error("History unavailable");
          return { run: null };
        },
      },
    };
    const slot =
      surface === "preview"
        ? renderSlot(app.messageDirectives[0]!, previewProps, options)
        : renderSlot(
            app.threadPanelActions[0]!,
            { threadId: message.threadId, params: { runId: run.id } },
            options,
          );
    const empty =
      surface === "preview"
        ? "Workflow run not found."
        : "No workflow runs were found for this thread.";
    await slot.findByText(empty);
    failing = true;
    await act(async () =>
      slot.experimental_invalidateRpc([`runs:${message.threadId}`]),
    );
    await slot.findByText(/History unavailable/, {}, { timeout: 10_000 });
    expect(slot.queryByText(empty)).toBeNull();
    failing = false;
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await slot.findByText(empty);
  },
);

it.each(["preview", "panel"] as const)(
  "%s updates elapsed time without a data refresh and freezes it on completion",
  async (surface) => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    let current: WorkflowRunView = { ...run, startedAt: 10_000 };
    const options = {
      experimental_rpcContract: workflowUiRpcContract,
      rpc: { workflowRunView: () => ({ run: current }) },
    };
    const slot =
      surface === "preview"
        ? renderSlot(app.messageDirectives[0]!, previewProps, options)
        : renderSlot(
            app.threadPanelActions[0]!,
            { threadId: message.threadId, params: { runId: run.id } },
            options,
          );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(
      slot.getByText(
        surface === "preview" ? "30s" : "1/2 agents · 30s elapsed",
      ),
    ).toBeTruthy();
    current = { ...current, status: "succeeded", finishedAt: 40_000 };
    await act(async () =>
      slot.experimental_invalidateRpc([`runs:${message.threadId}`]),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(
      slot.getByText(surface === "preview" ? "30s" : "1/2 agents · 30s total"),
    ).toBeTruthy();
  },
);
