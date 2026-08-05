// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AutomationDetailView } from "../detail-view.js";
import type { AutomationResponse, AutomationRunResponse } from "./rpc-types.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

const automation: AutomationResponse = {
  id: "auto_status",
  projectId: "proj_test",
  name: "Status check",
  enabled: true,
  trigger: {
    triggerType: "schedule",
    cron: "* * * * *",
    timezone: "UTC",
  },
  execution: {
    mode: "agent",
    prompt: "Run",
    providerId: "codex",
    model: "gpt-5",
    permissionMode: "auto",
    environment: { type: "project-default" },
  },
  origin: "human",
  createdByThreadId: null,
  nextRunAt: 2_000,
  lastRunAt: 1_000,
  runCount: 2,
  lastRunStatus: "succeeded",
  lastRunThreadId: "thr_status",
  lastError: null,
  createdAt: 1,
  updatedAt: 2,
};

function run(id: string, terminalToken: string | null): AutomationRunResponse {
  return {
    id,
    automationId: automation.id,
    runMode: "agent",
    threadId: `thr_${id}`,
    status: "succeeded",
    trigger: "schedule",
    skipReason: null,
    error: null,
    output: null,
    exitCode: null,
    terminalToken,
    scheduledFor: 1_000,
    startedAt: 1_000,
    finishedAt: 2_000,
  };
}

describe("automation run transport and domain labels", () => {
  it("renders explicit accessible labels and omits absent domains", () => {
    render(
      <AutomationDetailView
        automation={automation}
        projectLabel="Test"
        runsState={{
          runs: [run("domain", "TASK_COMPLETE"), run("legacy", null)],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: vi.fn(),
          retry: vi.fn(),
        }}
        actionPending={false}
        executionOptions={null}
        executionOptionsError={null}
        permissionModes={["auto"]}
        editing={false}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onUpdateAgent={vi.fn()}
        onRunNow={vi.fn()}
        onDelete={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/^transport=succeeded/u)).toHaveLength(2);
    expect(screen.getByText("domain=TASK_COMPLETE")).toBeTruthy();
    expect(
      screen.getAllByRole("img", { name: "transport=succeeded" }),
    ).toHaveLength(2);
    expect(screen.queryAllByText(/^domain=/u)).toHaveLength(1);
  });
});
