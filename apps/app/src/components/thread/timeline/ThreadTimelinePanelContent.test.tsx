// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { ThreadTimelinePanelContent } from "./ThreadTimelinePanelContent.js";
import type { UseThreadTimelineControllerResult } from "./useThreadTimelineController.js";

const mocks = vi.hoisted(() => ({
  displayStatus: "idle" as ThreadRuntimeDisplayStatus,
  threadStatus: "idle",
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      runtime: { displayStatus: mocks.displayStatus },
      status: mocks.threadStatus,
    },
    error: null,
  }),
}));

vi.mock("./ThreadTimelineSurface.js", () => ({
  ThreadTimelineSurface: ({
    ongoingIndicatorLabel,
    showOngoingIndicator,
  }: {
    ongoingIndicatorLabel?: string;
    showOngoingIndicator: boolean;
  }) => (
    <div>
      {showOngoingIndicator ? (
        <div>{ongoingIndicatorLabel ?? "Working..."}</div>
      ) : null}
    </div>
  ),
}));

vi.mock("./useThreadTimelineController.js", () => ({
  useThreadTimelineController: () => ({
    activePromptMode: null,
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    contextWindowUsage: undefined,
    goal: null,
    hasOlderTimelineRows: false,
    isLoadingOlderTimelineRows: false,
    loadOlderTimelineRows: vi.fn(),
    pendingTodos: null,
    timelineError: null,
    timelineLoading: false,
    timelineRows: [],
  }),
}));

vi.mock("@/components/ui/conversation.js", () => ({
  ConversationTimeline: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function workflowRow(): TimelineWorkflowWorkRow {
  return {
    id: "thr-test:workflow:task:wf-open",
    threadId: "thr-test",
    turnId: null,
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "work",
    status: "pending",
    workKind: "workflow",
    itemId: "task:wf-open",
    taskType: "local_workflow",
    workflowName: "fixture-mini",
    description: "fixture workflow",
    taskStatus: "running",
    workflow: null,
    usage: null,
    summary: null,
    error: null,
    completedAt: null,
  };
}

function baseTimeline(
  overrides: Partial<UseThreadTimelineControllerResult> = {},
): UseThreadTimelineControllerResult {
  return {
    activePromptMode: null,
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    contextWindowUsage: undefined,
    goal: null,
    hasOlderTimelineRows: false,
    isLoadingOlderTimelineRows: false,
    loadOlderTimelineRows: vi.fn(),
    pendingTodos: null,
    timelineError: null,
    timelineLoading: false,
    timelineRows: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mocks.displayStatus = "idle";
  mocks.threadStatus = "idle";
});

describe("ThreadTimelinePanelContent", () => {
  it("shows a background-only working indicator while runtime is idle", () => {
    render(
      <ThreadTimelinePanelContent
        threadId="thr-test"
        timeline={baseTimeline({ activeWorkflow: workflowRow() })}
      />,
    );

    expect(screen.getByText("Background work running")).not.toBeNull();
  });

  it("keeps the normal working label while runtime is active", () => {
    mocks.displayStatus = "active";

    render(
      <ThreadTimelinePanelContent
        threadId="thr-test"
        timeline={baseTimeline({ activeWorkflow: workflowRow() })}
      />,
    );

    expect(screen.queryByText("Background work running")).toBeNull();
    expect(screen.getByText("Working...")).not.toBeNull();
  });
});
