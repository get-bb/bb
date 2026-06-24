// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectRow, type ProjectThreadListState } from "./ProjectRow";

const mockUpdateEnvironment = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutate: mockUpdateEnvironment.mutate,
    reset: mockUpdateEnvironment.reset,
    variables: undefined,
  }),
}));

vi.mock("@/hooks/useCreateThreadInWorktree", () => ({
  useCreateThreadInWorktree: () => vi.fn(),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

function makeProject(): ProjectResponse {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Test thread",
    titleFallback: "Test thread",
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    activity: { activeWorkflowCount: 0 },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

function renderProjectRow(
  onToggleProjectCollapsed = vi.fn(),
  threadListState: ProjectThreadListState = { status: "ready", threads: [] },
  isActive = false,
) {
  const onToggleEnvironmentCollapsed = vi.fn();
  const result = render(
    <MemoryRouter>
      <ProjectRow
        project={makeProject()}
        threadListState={threadListState}
        isActive={isActive}
        isCollapsed={false}
        compareThreads={() => 0}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        isLocalPathInvalid={false}
        onToggleProjectCollapsed={onToggleProjectCollapsed}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      />
    </MemoryRouter>,
  );
  return { ...result, onToggleEnvironmentCollapsed, onToggleProjectCollapsed };
}

describe("ProjectRow interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not toggle collapse when the project row is clicked", () => {
    const { onToggleProjectCollapsed } = renderProjectRow();

    fireEvent.click(screen.getByText("Test project"));

    expect(onToggleProjectCollapsed).not.toHaveBeenCalled();
  });

  it("toggles collapse when the project chevron is clicked", () => {
    const { onToggleProjectCollapsed } = renderProjectRow();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Test project" }),
    );

    expect(onToggleProjectCollapsed).toHaveBeenCalledWith("proj_test");
  });

  it("keeps hover background scoped to the project chevron", () => {
    const { container } = renderProjectRow();

    const header = container.querySelector(".bb-sidebar-hover-actions-row");
    expect(header).not.toBeNull();
    expect(header?.className).not.toContain("hover:bg-sidebar-accent");

    const leadingIcon = container.querySelector('[aria-hidden="true"]');
    expect(leadingIcon?.className).not.toContain("group-hover/project-row");

    expect(
      screen.getByRole("button", { name: "Collapse Test project" }).className,
    ).toContain("hover:bg-sidebar-accent");
  });

  it("uses selected state on active project headers without row hover", () => {
    const { container } = renderProjectRow(
      vi.fn(),
      { status: "ready", threads: [] },
      true,
    );

    const header = container.querySelector(".bb-sidebar-hover-actions-row");
    expect(header).not.toBeNull();
    expect(header?.className).toContain("bg-sidebar-border");
    expect(header?.className).not.toContain("cursor-pointer");
    expect(header?.className).not.toContain("hover:bg-sidebar-accent");
  });

  it("keeps worktree group row static and scopes collapse to the chevron", () => {
    const { onToggleEnvironmentCollapsed } = renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_worktree_a",
            environmentId: "env_test",
            environmentName: "Feature workspace",
            environmentBranchName: "feat/menu-close",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
          makeThread({
            id: "thr_worktree_b",
            environmentId: "env_test",
            environmentName: "Feature workspace",
            environmentBranchName: "feat/menu-close",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ],
      },
    );
    const worktreeHeader = screen
      .getByText("Feature workspace")
      .closest(".bb-sidebar-hover-actions-row");

    expect(worktreeHeader).not.toBeNull();
    expect(worktreeHeader?.className).not.toContain("cursor-pointer");

    fireEvent.click(screen.getByText("Feature workspace"));
    expect(onToggleEnvironmentCollapsed).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse Feature workspace threads",
      }),
    );
    expect(onToggleEnvironmentCollapsed).toHaveBeenCalledWith("env_test");
  });

  it("closes the worktree actions menu after selecting rename", async () => {
    renderProjectRow(vi.fn(), {
      status: "ready",
      threads: [
        makeThread({
          id: "thr_worktree_a",
          environmentId: "env_test",
          environmentName: "Feature workspace",
          environmentBranchName: "feat/menu-close",
          environmentWorkspaceDisplayKind: "managed-worktree",
        }),
        makeThread({
          id: "thr_worktree_b",
          environmentId: "env_test",
          environmentName: "Feature workspace",
          environmentBranchName: "feat/menu-close",
          environmentWorkspaceDisplayKind: "managed-worktree",
        }),
      ],
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Worktree actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    expect(mockUpdateEnvironment.reset).toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", { name: "Rename environment" }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });
});
