// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ThreadActionsMenu: () => null,
}));

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

const DEFAULT_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function ThreadRowTestHarness({
  isActive = false,
  options = DEFAULT_OPTIONS,
  thread,
}: {
  isActive?: boolean;
  options?: ThreadRowOptions;
  thread: ThreadListEntry;
}) {
  return (
    <MemoryRouter>
      <ThreadRow
        projectId={thread.projectId}
        thread={thread}
        isActive={isActive}
        hasComposerDraft={false}
        options={options}
      />
    </MemoryRouter>
  );
}

function renderThreadRow({
  isActive = false,
  options = DEFAULT_OPTIONS,
  thread = createThread(),
}: {
  isActive?: boolean;
  options?: ThreadRowOptions;
  thread?: ThreadListEntry;
}) {
  const result = render(
    <ThreadRowTestHarness
      isActive={isActive}
      options={options}
      thread={thread}
    />,
  );
  return {
    ...result,
    rerenderThreadRow(nextThread: ThreadListEntry) {
      result.rerender(
        <ThreadRowTestHarness
          isActive={isActive}
          options={options}
          thread={nextThread}
        />,
      );
    },
  };
}

afterEach(cleanup);

describe("ThreadRow", () => {
  it("shows an unread error before pending or active work", () => {
    renderThreadRow({
      thread: createThread({
        status: "error",
        hasPendingInteraction: true,
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    });

    expect(screen.getByLabelText("Unread thread failed")).not.toBeNull();
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows workflow activity for an idle thread with an active workflow", () => {
    renderThreadRow({
      thread: createThread({
        title: "Workflow thread",
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows foreground agent work before active workflow work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Active workflow thread",
        status: "active",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Agent working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("shows active background agent work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Background agent thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Background agent running")).not.toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows workflow before background agent and command work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Many background tasks thread",
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows background agent work before background command work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Agent and command thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Background agent running")).not.toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows active background command work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Background command thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Background command running")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows plan-mode activity when the plan banner is active", () => {
    renderThreadRow({
      thread: createThread({
        title: "Plan mode thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 1,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows goal activity when the goal banner is active", () => {
    renderThreadRow({
      thread: createThread({
        title: "Goal thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 1,
        },
      }),
    });

    expect(screen.getByLabelText("Goal active")).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it.each([
    {
      flag: "backgroundAgent" as const,
      label: "Background agent running",
    },
    {
      flag: "backgroundCommand" as const,
      label: "Background command running",
    },
    {
      flag: "planMode" as const,
      label: "Plan mode active",
    },
    {
      flag: "goal" as const,
      label: "Goal active",
    },
  ])(
    "shows the $label glyph for collapsed parent rows with hidden child activity",
    ({ flag, label }) => {
      renderThreadRow({
        thread: createThread({
          title: "Parent thread",
          lastReadAt: 1,
          latestAttentionAt: 1,
        }),
        options: {
          kind: "parent",
          depth: 1,
          isCompact: false,
          isCollapsed: true,
          childCount: 1,
          childActivity: {
            pending: false,
            working: true,
            runtimeWorking: false,
            workflow: false,
            backgroundAgent: false,
            backgroundCommand: false,
            planMode: false,
            goal: false,
            unread: false,
            unreadError: false,
            [flag]: true,
          },
          onToggleCollapsed: vi.fn(),
        },
      });

      expect(screen.getByLabelText(label)).not.toBeNull();
      expect(screen.queryByLabelText("Thread working")).toBeNull();
    },
  );

  it("renders an already-unread successful thread as a settled dot on initial load", () => {
    renderThreadRow({
      thread: createThread({
        status: "idle",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
      }),
    });

    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
  });

  it("switches directly from working to the settled done dot after finishing", () => {
    const thread = createThread({
      status: "active",
      lastReadAt: 1_000,
      latestAttentionAt: 1_000,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    });
    const { rerenderThreadRow } = renderThreadRow({ thread });

    expect(screen.getByLabelText("Agent working")).not.toBeNull();

    rerenderThreadRow({
      ...thread,
      status: "idle",
      latestAttentionAt: 2_000,
      runtime: {
        displayStatus: "idle",
        hostReconnectGraceExpiresAt: null,
      },
    });

    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
  });
});
