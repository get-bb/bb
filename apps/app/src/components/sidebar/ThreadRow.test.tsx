// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
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
  isEnvGrouped: false,
};

function renderThreadRow({
  isActive = false,
  options = DEFAULT_OPTIONS,
  thread = createThread(),
}: {
  isActive?: boolean;
  options?: ThreadRowOptions;
  thread?: ThreadListEntry;
}) {
  render(
    <MemoryRouter>
      <ThreadRow
        projectId={thread.projectId}
        thread={thread}
        isActive={isActive}
        hasComposerDraft={false}
        options={options}
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("ThreadRow", () => {
  it("uses the lighter selected sidebar row color", () => {
    renderThreadRow({
      isActive: true,
      thread: createThread({ title: "Selected thread" }),
    });

    const row = screen.getByLabelText("Open Selected thread").parentElement;
    expect(row?.className).toContain("bg-sidebar-accent");
    expect(row?.className).not.toContain("bg-sidebar-border");
  });

  it("shows a worktree icon before a managed-worktree thread title", () => {
    renderThreadRow({
      thread: createThread({
        title: "Managed worktree thread",
        environmentWorkspaceDisplayKind: "managed-worktree",
      }),
    });

    const worktreeIcon = screen.getByLabelText("Managed worktree environment");
    const title = screen.getByText("Managed worktree thread");
    expect(
      worktreeIcon.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("does not repeat the worktree icon under a worktree group", () => {
    renderThreadRow({
      options: { ...DEFAULT_OPTIONS, isCompact: true, isEnvGrouped: true },
      thread: createThread({
        title: "Grouped worktree thread",
        environmentWorkspaceDisplayKind: "managed-worktree",
      }),
    });

    expect(screen.queryByLabelText("Managed worktree environment")).toBeNull();
  });

  it("renders parent-thread carets after the thread title", () => {
    renderThreadRow({
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isEnvGrouped: false,
        isCollapsed: false,
        childCount: 1,
        childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
        onToggleCollapsed: vi.fn(),
      },
      thread: createThread({ title: "Parent thread" }),
    });

    const title = screen.getByText("Parent thread");
    const caret = screen.getByLabelText("Collapse Parent thread threads");
    expect(
      title.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(caret.className).toContain("bb-sidebar-hover-actions");
  });
});
