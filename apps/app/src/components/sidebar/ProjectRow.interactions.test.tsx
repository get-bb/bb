// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { Provider, createStore } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChronologicalSectionThreadSections,
  DropPreviewRow,
  ProjectRow,
  SectionThreadDragOverlay,
  type ProjectThreadListState,
} from "./ProjectRow";
import { buildSidebarEntitySectionId } from "@bb/client-core";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeProjectResponse } from "@/test/fixtures/projects";

const mockUpdateEnvironment = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => undefined),
}));
const mockUpdateProject = vi.hoisted(() => vi.fn(async () => undefined));
const mockUpdateSection = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUpdateProject: () => ({ mutateAsync: mockUpdateProject }),
}));

vi.mock("@/hooks/mutations/thread-section-mutations", () => ({
  useUpdateThreadSection: () => ({ mutateAsync: mockUpdateSection }),
}));

const mockArchiveEnvironmentThreads = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ ok: true, archivedThreadIds: [] })),
}));
const mockDraftThreadIds = vi.hoisted(() => ({
  current: new Set<string>(),
}));
const mockCreateThreadInEnvironment = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutateAsync: mockArchiveEnvironmentThreads.mutateAsync,
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutateAsync: mockUpdateEnvironment.mutateAsync,
    variables: undefined,
  }),
}));

vi.mock("@/hooks/useCreateThreadInEnvironment", () => ({
  useCreateThreadInEnvironment: () => mockCreateThreadInEnvironment,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
  usePromptDraftInputThreadIds: () => mockDraftThreadIds.current,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_test",
    title: "Test thread",
    titleFallback: "Test thread",
    ...overrides,
  });
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
    <TooltipProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectRow
            project={makeProjectResponse()}
            threadListState={threadListState}
            isActive={isActive}
            isCollapsed={isCollapsed}
            compareThreads={() => 0}
            progressiveDisclosureEnabled
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            isLocalPathInvalid={false}
            onToggleProjectCollapsed={onToggleProjectCollapsed}
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
  return { ...result, onToggleEnvironmentCollapsed, onToggleProjectCollapsed };
}

function expectCollapsedActivityAtSidebarEdge(label: string) {
  const edgeSlot = screen
    .getAllByLabelText(label)
    .map((indicator) =>
      indicator.closest("[data-sidebar-collapsed-activity-edge]"),
    )
    .find((slot) => slot !== null);

  expect(edgeSlot).toBeInstanceOf(HTMLElement);
}

describe("ProjectRow interactions", () => {
  it("renders the destination gap as a muted copy of the dragged row", () => {
    render(<DropPreviewRow depth={0} thread={makeThread()} />);

    const preview = document.querySelector(
      '[data-sidebar-section-drop-preview="true"]',
    );
    expect(preview?.textContent).toBe("Test thread");
    expect(preview?.className).toContain("opacity-50");
    expect(preview?.className).not.toContain("border-dashed");
  });

  it("renders the dragged copy as a compact opaque chip", () => {
    render(<SectionThreadDragOverlay thread={makeThread()} />);

    const overlay = document.querySelector(
      '[data-sidebar-section-drag-overlay="true"]',
    );
    expect(overlay?.className).toContain("w-fit");
    expect(overlay?.className).toContain("max-w-56");
    expect(overlay?.className).not.toContain("opacity-");
  });

  afterEach(() => {
    cleanup();
    mockDraftThreadIds.current = new Set();
    vi.clearAllMocks();
  });

  it("keeps project header controls touch-accessible when their menu opens and closes", async () => {
    renderProjectRow();
    const trigger = screen.getByRole("button", {
      name: "Test project actions",
    });
    const actions = trigger.closest(".bb-sidebar-hover-actions");
    expect(actions?.getAttribute("data-sidebar-hover-actions-mobile")).toBe(
      "always",
    );
    expect(actions?.getAttribute("data-sidebar-hover-actions-open")).toBeNull();

    fireEvent.pointerDown(trigger, { button: 0 });
    const menu = await screen.findByRole("menu");
    expect(actions?.getAttribute("data-sidebar-hover-actions-mobile")).toBe(
      "always",
    );
    expect(actions?.getAttribute("data-sidebar-hover-actions-open")).toBe(
      "true",
    );

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(actions?.getAttribute("data-sidebar-hover-actions-mobile")).toBe(
      "always",
    );
    expect(actions?.getAttribute("data-sidebar-hover-actions-open")).toBeNull();
  });

  it("renames a project from its menu without collapsing its threads", async () => {
    const { onToggleProjectCollapsed } = renderProjectRow();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "  Renamed project  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockUpdateProject).toHaveBeenCalledWith({
        id: "proj_test",
        name: "Renamed project",
      }),
    );
    expect(onToggleProjectCollapsed).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains a failed project rename for retry and cancels without a second write", async () => {
    mockUpdateProject.mockRejectedValueOnce(new Error("Unavailable"));
    renderProjectRow();
    fireEvent.doubleClick(screen.getByTitle("Test project"));
    const input = await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: "Recovered draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(input).toHaveProperty("value", "Recovered draft");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
    expect(mockUpdateProject).toHaveBeenCalledOnce();
  });

  it("places the project disclosure after its label and keeps root threads flush", () => {
    const result = renderProjectRow(vi.fn(), {
      status: "ready",
      threads: [makeThread()],
    });

    const disclosure = screen.getByRole("button", {
      name: "Collapse Test project section",
    });
    const label = screen.getByTitle("Test project");
    const threadLink = result.container.querySelector(
      '[data-sidebar-thread-id="thr_test"]',
    );
    const projectGroup = result.container.querySelector(
      "[data-sidebar-sticky-project-item]",
    );

    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      (threadLink?.parentElement as HTMLElement | null)?.style.paddingLeft,
    ).toBe("8px");
    expect(projectGroup?.getAttribute("data-sidebar-project-id")).toBe(
      "proj_test",
    );
    expect(projectGroup?.hasAttribute("data-sidebar-section-id")).toBe(false);
  });

  it("shows generic runtime activity before a named workflow rollup", () => {
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
            environmentProviderId: "git-worktree",
            environmentIsWorktree: true,
            queuedWork: "none",
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
            environmentProviderId: "git-worktree",
            environmentIsWorktree: true,
            queuedWork: "none",
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
    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
  });

  it("shows a working draft before named work for a collapsed environment", () => {
    mockDraftThreadIds.current = new Set(["thr_worktree_draft"]);
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_worktree_plan",
            environmentId: "env_draft",
            environmentName: "Draft workspace",
            queuedWork: "none",
            environmentProviderId: "git-worktree",
            environmentIsWorktree: true,
            activity: {
              activeWorkflowCount: 0,
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activePlanModeCount: 1,
              activeGoalCount: 0,
            },
          }),
          makeThread({
            id: "thr_worktree_draft",
            environmentId: "env_draft",
            environmentName: "Draft workspace",
            queuedWork: "none",
            environmentProviderId: "git-worktree",
            environmentIsWorktree: true,
          }),
        ],
      },
      false,
      new Set(["env_draft"]),
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("keeps a duplicate section name in place until corrected", async () => {
    mockUpdateSection.mockRejectedValueOnce(
      new BbHttpError({
        status: 409,
        code: "section_name_conflict",
        message: "Conflict",
        body: null,
      }),
    );
    render(
      <TooltipProvider>
        <Provider store={createStore()}>
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
              <ChronologicalSectionThreadSections
                threadListState={{ status: "ready", threads: [] }}
                compareThreads={() => 0}
                sections={[{ id: "sec_rename", name: "Design" }]}
                collapsedThreadIds={new Set()}
                collapsedEnvironmentIds={new Set()}
                onToggleThreadCollapsed={vi.fn()}
                onToggleEnvironmentCollapsed={vi.fn()}
                topLevelSectionOrder={[
                  buildSidebarEntitySectionId("section", "sec_rename"),
                ]}
                onTopLevelSectionOrderChange={vi.fn()}
                pinnedReorderPending={false}
                pinnedThreads={[]}
                onReorderPinnedThread={vi.fn()}
                builtInSections={{
                  collapsedSectionIds: new Set(),
                  onToggleCollapsed: vi.fn(),
                  pinned: { label: "Pinned", content: null },
                  threads: { label: "Threads" },
                }}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </Provider>
      </TooltipProvider>,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Design section actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Section name" });
    fireEvent.change(input, { target: { value: "Existing section" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByText("A section with this name already exists."),
    ).not.toBeNull();
    expect(input).toHaveProperty("value", "Existing section");
    fireEvent.change(input, { target: { value: "New section" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockUpdateSection).toHaveBeenLastCalledWith({
        id: "sec_rename",
        name: "New section",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Section name" }),
      ).toBeNull(),
    );
  });

  it("uses shared runtime precedence when a top-level section is collapsed", () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const sectionId = "sec_active";
    const activeThread = makeThread({
      id: "thr_section_active",
      sectionId,
      status: "active",
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 0,
        activePlanModeCount: 1,
        activeGoalCount: 1,
      },
    });

    render(
      <TooltipProvider>
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <ChronologicalSectionThreadSections
                threadListState={{ status: "ready", threads: [activeThread] }}
                compareThreads={() => 0}
                sections={[{ id: sectionId, name: "Active work" }]}
                collapsedThreadIds={new Set()}
                collapsedEnvironmentIds={new Set()}
                onToggleThreadCollapsed={vi.fn()}
                onToggleEnvironmentCollapsed={vi.fn()}
                topLevelSectionOrder={[
                  buildSidebarEntitySectionId("section", sectionId),
                ]}
                onTopLevelSectionOrderChange={vi.fn()}
                pinnedReorderPending={false}
                pinnedThreads={[]}
                onReorderPinnedThread={vi.fn()}
                builtInSections={{
                  collapsedSectionIds: new Set(),
                  onToggleCollapsed: vi.fn(),
                  pinned: { label: "Pinned", content: null },
                  threads: { label: "Threads" },
                }}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </Provider>
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Active work section" }),
    );

    expect(
      screen
        .getByTitle("Active work")
        .closest("[data-sidebar-sticky-group]")
        ?.getAttribute("data-sidebar-section-id"),
    ).toBe(sectionId);

    expect(screen.queryByText("Test thread")).toBeNull();
    expect(screen.getAllByLabelText("Plan mode active")).not.toHaveLength(0);
    expectCollapsedActivityAtSidebarEdge("Plan mode active");
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("shows a working draft before Plan for a collapsed section", () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const sectionId = "sec_draft";
    const activeThread = makeThread({
      id: "thr_section_draft",
      sectionId,
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 0,
        activePlanModeCount: 1,
        activeGoalCount: 1,
      },
    });
    mockDraftThreadIds.current = new Set([activeThread.id]);

    render(
      <TooltipProvider>
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <ChronologicalSectionThreadSections
                threadListState={{ status: "ready", threads: [activeThread] }}
                compareThreads={() => 0}
                sections={[{ id: sectionId, name: "Draft work" }]}
                collapsedThreadIds={new Set()}
                collapsedEnvironmentIds={new Set()}
                onToggleThreadCollapsed={vi.fn()}
                onToggleEnvironmentCollapsed={vi.fn()}
                topLevelSectionOrder={[
                  buildSidebarEntitySectionId("section", sectionId),
                ]}
                onTopLevelSectionOrderChange={vi.fn()}
                pinnedReorderPending={false}
                pinnedThreads={[]}
                onReorderPinnedThread={vi.fn()}
                builtInSections={{
                  collapsedSectionIds: new Set(),
                  onToggleCollapsed: vi.fn(),
                  pinned: { label: "Pinned", content: null },
                  threads: { label: "Threads" },
                }}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </Provider>
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Draft work section" }),
    );

    expect(
      screen.getAllByLabelText("Thread working with unsubmitted draft"),
    ).not.toHaveLength(0);
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("surfaces named activity when the project is collapsed", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            activity: {
              activeWorkflowCount: 0,
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activePlanModeCount: 0,
              activeGoalCount: 1,
            },
          }),
        ],
      },
      false,
      new Set(),
      true,
    );

    expect(screen.queryByText("Test thread")).toBeNull();
    expect(screen.getAllByLabelText("Goal active")).not.toHaveLength(0);
    expectCollapsedActivityAtSidebarEdge("Goal active");
  });

  it("shows unread success before an idle draft for a collapsed project", () => {
    mockDraftThreadIds.current = new Set(["thr_project_draft"]);
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_project_draft",
            lastReadAt: 100,
            latestAttentionAt: 200,
          }),
        ],
      },
      false,
      new Set(),
      true,
    );

    expect(
      screen.getAllByLabelText("Unread thread succeeded"),
    ).not.toHaveLength(0);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it("excludes hidden side-chat activity from a collapsed project", () => {
    mockDraftThreadIds.current = new Set(["thr_side_chat"]);
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_side_chat",
            visibility: "hidden",
            activity: {
              activeWorkflowCount: 0,
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activePlanModeCount: 1,
              activeGoalCount: 0,
            },
          }),
        ],
      },
      false,
      new Set(),
      true,
    );

    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(document.querySelector('[data-icon="Edit"]')).toBeNull();
  });

  it.each([false, true])(
    "keeps environment actions touch-accessible when collapsed=%s",
    async (isCollapsed) => {
      renderProjectRow(
        vi.fn(),
        {
          status: "ready",
          threads: [
            makeThread({
              id: "thr_worktree_a",
              environmentId: "env_test",
              environmentName: "Feature workspace",
              environmentBranchName: "feat/menu-close",
              environmentProviderId: "git-worktree",
              environmentIsWorktree: true,
              queuedWork: "none",
            }),
            makeThread({
              id: "thr_worktree_b",
              environmentId: "env_test",
              environmentName: "Feature workspace",
              environmentBranchName: "feat/menu-close",
              environmentProviderId: "git-worktree",
              environmentIsWorktree: true,
              queuedWork: "none",
            }),
          ],
        },
        false,
        isCollapsed ? new Set(["env_test"]) : new Set(),
      );

      const createButton = screen.getByRole("button", {
        name: "New thread in environment",
      });
      const actions = createButton.closest(".bb-sidebar-hover-actions");
      expect(actions?.getAttribute("data-sidebar-hover-actions-mobile")).toBe(
        "always",
      );
      expect(
        actions?.contains(
          screen.getByRole("button", { name: "Environment actions" }),
        ),
      ).toBe(true);
      fireEvent.click(createButton);
      expect(mockCreateThreadInEnvironment).toHaveBeenCalledOnce();

      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Environment actions" }),
        { button: 0 },
      );
      const rename = await screen.findByRole("menuitem", { name: "Rename" });
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["Rename", "Archive"]);
      fireEvent.click(rename);

      const input = await screen.findByRole("textbox", {
        name: "Environment name",
      });
      expect(input.getAttribute("placeholder")).toBe("feat/menu-close");
      expect(input).toHaveProperty("value", "Feature workspace");
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => {
        expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
      });
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(await screen.findByText("Name cannot be empty.")).not.toBeNull();
      expect(mockUpdateEnvironment.mutateAsync).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Clear custom name" }),
      );
      await waitFor(() =>
        expect(mockUpdateEnvironment.mutateAsync).toHaveBeenCalledWith({
          id: "env_test",
          name: null,
        }),
      );
    },
  );

  it("leaves threads sharing the project checkout ungrouped", () => {
    renderProjectRow(vi.fn(), {
      status: "ready",
      threads: [
        makeThread({
          id: "thr_checkout_a",
          environmentId: "env_checkout",
          environmentBranchName: "main",
          environmentProviderId: null,
          queuedWork: "none",
        }),
        makeThread({
          id: "thr_checkout_b",
          environmentId: "env_checkout",
          environmentBranchName: "main",
          environmentProviderId: null,
          queuedWork: "none",
        }),
      ],
    });

    expect(
      screen.queryByRole("button", { name: "Collapse main threads" }),
    ).toBeNull();
  });

  it("archives and renames an environment group from any provider", async () => {
    mockArchiveEnvironmentThreads.mutateAsync.mockClear();
    renderProjectRow(vi.fn(), {
      status: "ready",
      threads: [
        makeThread({
          id: "thr_plain_a",
          environmentId: "env_plain",
          environmentBranchName: "main",
          environmentProviderId: "personal-workspace",
          environmentIsWorktree: true,
          queuedWork: "none",
        }),
        makeThread({
          id: "thr_plain_b",
          environmentId: "env_plain",
          environmentBranchName: "main",
          environmentProviderId: "personal-workspace",
          environmentIsWorktree: true,
          queuedWork: "none",
        }),
      ],
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Environment actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(mockArchiveEnvironmentThreads.mutateAsync).toHaveBeenCalledWith({
      id: "env_plain",
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Environment actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", {
      name: "Environment name",
    });
    fireEvent.change(input, { target: { value: "  Release workspace  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockUpdateEnvironment.mutateAsync).toHaveBeenCalledWith({
        id: "env_plain",
        name: "Release workspace",
      }),
    );
  });
});
