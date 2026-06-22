// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
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
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: { activeWorkflowCount: 0, activeBackgroundSubagentCount: 0 },
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
  it("shows a workflow glyph for an idle thread with an active workflow", () => {
    renderThreadRow({
      thread: createThread({
        title: "Workflow thread",
        activity: { activeWorkflowCount: 1, activeBackgroundSubagentCount: 0 },
      }),
    });

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("keeps the spinner for active runtime work even with an active workflow", () => {
    renderThreadRow({
      thread: createThread({
        title: "Active workflow thread",
        status: "active",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
        activity: { activeWorkflowCount: 1, activeBackgroundSubagentCount: 0 },
      }),
    });

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
  });

  it("renders an already-unread successful thread as a settled dot on initial load", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        status: "idle",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
      }),
    });

    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
    expect(container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
  });

  it("shows the success checkmark when a mounted row becomes unread after finishing", async () => {
    vi.useFakeTimers();
    try {
      const thread = createThread({
        status: "active",
        lastReadAt: 1_000,
        latestAttentionAt: 1_000,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      });
      const { container, rerenderThreadRow } = renderThreadRow({ thread });

      expect(screen.getByLabelText("Thread working")).not.toBeNull();

      rerenderThreadRow({
        ...thread,
        status: "idle",
        latestAttentionAt: 2_000,
        runtime: {
          displayStatus: "idle",
          hostReconnectGraceExpiresAt: null,
        },
      });

      expect(
        container.querySelector('[data-icon="CircleCheck"]'),
      ).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });

      expect(container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
      expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
