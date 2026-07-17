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

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
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
    gitRemoteUrl: null,
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
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
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
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

function renderProjectRow(
  onToggleProjectCollapsed = vi.fn(),
  threadListState: ProjectThreadListState = { status: "ready", threads: [] },
  isActive = false,
  collapsedEnvironmentIds: Set<string> = new Set(),
  isCollapsed = false,
) {
  const onToggleEnvironmentCollapsed = vi.fn();
  const result = render(
    <MemoryRouter>
      <ProjectRow
        project={makeProject()}
        threadListState={threadListState}
        isActive={isActive}
        isCollapsed={isCollapsed}
        compareThreads={() => 0}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
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

  it("shows foreground agent rollup before workflow activity", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_worktree_workflow",
            status: "active",
            environmentId: "env_test",
            environmentName: "Feature workspace",
            environmentBranchName: "feat/menu-close",
            environmentWorkspaceDisplayKind: "managed-worktree",
            activity: {
              activeWorkflowCount: 1,
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activePlanModeCount: 0,
              activeGoalCount: 0,
            },
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }),
          makeThread({
            id: "thr_worktree_sibling",
            environmentId: "env_test",
            environmentName: "Feature workspace",
            environmentBranchName: "feat/menu-close",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ],
      },
      false,
      new Set(["env_test"]),
    );

    expect(
      screen.getByRole("button", {
        name: "Expand Feature workspace threads",
      }),
    ).not.toBeNull();
    expect(screen.getByLabelText("Agent working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
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

    expect(
      await screen.findByRole("dialog", { name: "Rename environment" }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });
});
