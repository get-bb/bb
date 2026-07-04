// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectResponse,
  ProjectRunCommandTargetState,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectRow, type ProjectThreadListState } from "./ProjectRow";

const mockUpdateEnvironment = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
}));

const mockProjectRunCommandMutations = vi.hoisted(() => ({
  start: {
    isPending: false,
    mutate: vi.fn(),
  },
  stop: {
    isPending: false,
    mutate: vi.fn(),
  },
}));

const mockSetActiveRunTerminal = vi.hoisted(() => vi.fn());

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

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useStartProjectRunCommand: () => mockProjectRunCommandMutations.start,
  useStopProjectRunCommand: () => mockProjectRunCommandMutations.stop,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
}));

vi.mock("@/lib/fixed-panel-tabs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/fixed-panel-tabs")>();
  return {
    ...actual,
    useSetFixedRightTerminalActiveTerminal: () => mockSetActiveRunTerminal,
  };
});

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

function makeProject(
  overrides: Partial<ProjectResponse> & {
    runCommandStates?: ProjectRunCommandTargetState[];
  } = {},
): ProjectResponse & {
  runCommandStates?: ProjectRunCommandTargetState[];
} {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    runCommand: null,
    worktreeInitScript: null,
    worktreeTeardownScript: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
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
    originPluginId: null,
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
  collapsedEnvironmentIds: Set<string> = new Set(),
  project = makeProject(),
) {
  const onToggleEnvironmentCollapsed = vi.fn();
  const result = render(
    <MemoryRouter>
      <TooltipProvider>
        <ProjectRow
          project={project}
          threadListState={threadListState}
          isActive={isActive}
          isCollapsed={false}
          compareThreads={() => 0}
          collapsedThreadIds={new Set()}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          isLocalPathInvalid={false}
          onToggleProjectCollapsed={onToggleProjectCollapsed}
          onToggleThreadCollapsed={vi.fn()}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { ...result, onToggleEnvironmentCollapsed, onToggleProjectCollapsed };
}

describe("ProjectRow interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts and stops configured project run commands", () => {
    renderProjectRow(
      vi.fn(),
      { status: "ready", threads: [] },
      false,
      new Set(),
      makeProject({ runCommand: "pnpm dev" }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start Test project run command",
      }),
    );

    expect(mockProjectRunCommandMutations.start.mutate).toHaveBeenCalledTimes(
      1,
    );
    expect(
      mockProjectRunCommandMutations.start.mutate.mock.calls[0]?.[0],
    ).toEqual({
      projectId: "proj_test",
      target: { kind: "project" },
    });
    // Starting no longer pins the run onto the compose page; the thread's
    // terminal dock discovers the session from the published run-command state.
    expect(
      mockProjectRunCommandMutations.start.mutate.mock.calls[0],
    ).toHaveLength(1);
    expect(mockSetActiveRunTerminal).not.toHaveBeenCalled();

    cleanup();
    renderProjectRow(
      vi.fn(),
      { status: "ready", threads: [makeThread({ id: "thr_root" })] },
      false,
      new Set(),
      makeProject({
        runCommand: "pnpm dev",
        runCommandStates: [
          {
            target: { kind: "project" },
            status: "running",
            terminalSessionId: "term_run",
            terminalTarget: {
              kind: "host_path",
              hostId: "host_test",
              cwd: "/repo",
            },
            updatedAt: 1,
          },
        ],
      }),
    );

    // With a non-worktree thread present, Open navigates to that thread's
    // terminal pane instead of pinning the run onto the compose page.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Test project run terminal",
      }),
    );

    expect(mockSetActiveRunTerminal).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop Test project run command",
      }),
    );

    expect(mockProjectRunCommandMutations.stop.mutate).toHaveBeenCalledWith({
      projectId: "proj_test",
      target: { kind: "project" },
    });
  });

  it("starts configured worktree run commands from ungrouped worktree thread rows", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            environmentId: "env_worktree",
            environmentBranchName: "feature/run",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ],
      },
      false,
      new Set(),
      makeProject({ runCommand: "pnpm dev" }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start worktree run command",
      }),
    );

    expect(mockProjectRunCommandMutations.start.mutate).toHaveBeenCalledWith({
      projectId: "proj_test",
      target: { kind: "environment", environmentId: "env_worktree" },
    });
  });

  it("opens a worktree run terminal in its thread instead of pinning compose", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            environmentId: "env_worktree",
            environmentBranchName: "feature/run",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ],
      },
      false,
      new Set(),
      makeProject({
        runCommand: "pnpm dev",
        runCommandStates: [
          {
            target: { kind: "environment", environmentId: "env_worktree" },
            status: "running",
            terminalSessionId: "term_run",
            terminalTarget: {
              kind: "environment",
              environmentId: "env_worktree",
            },
            updatedAt: 1,
          },
        ],
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open worktree run terminal" }),
    );

    // The thread's bottom terminal dock surfaces the run, so opening navigates
    // to the thread rather than pinning the session onto the compose page.
    expect(mockSetActiveRunTerminal).not.toHaveBeenCalled();
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

  it("shows workflow rollup instead of the generic spinner for collapsed worktree workflow activity", () => {
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
            activity: { activeWorkflowCount: 1 },
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
    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
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

    expect(mockUpdateEnvironment.reset).toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", { name: "Rename environment" }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });
});
