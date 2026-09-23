// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Provider, createStore } from "jotai";
import {
  installTestPluginRuntime,
  renderSlot,
  type PluginSdkTestFakes,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { SectionThreadDndState } from "../dnd/useSectionThreadDnd.js";
import type { ProjectThreadListState } from "./ProjectRow.js";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import { buildSidebarEntitySectionId } from "../model/sidebar-section-order.js";
import {
  makeSidebarEnvironment,
  makeSidebarProject,
  makeSidebarThread,
  sdkResult,
  type SidebarThreadOverrides,
} from "../model/fixtures.js";
import {
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";

installTestPluginRuntime();
const {
  ChronologicalSectionThreadSections,
  ProjectRow,
  SectionThreadDragOverlay,
  ThreadTreeNodeRow,
} = await import("./ProjectRow.js");
const { useSidebarModeSectionOrder } =
  await import("./useSidebarModeSectionOrder.js");
const { SidebarHeaderControls } = await import("./SidebarHeaderControls.js");
const { ThreadListVisibilityMenuItems } =
  await import("./ThreadListVisibility.js");

function makeThread(overrides: SidebarThreadOverrides = {}): SidebarThread {
  return makeSidebarThread({
    id: "thr_test",
    title: "Test thread",
    titleFallback: "Test thread",
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  });
}

function makeSectionDnd(
  overrides: Partial<SectionThreadDndState> = {},
): SectionThreadDndState {
  return {
    activeItemId: null,
    activeThread: makeThread({
      id: "thr_dragged",
      title: "Dragged",
      titleFallback: "Dragged",
    }),
    consumeClickSuppression: () => false,
    dndContextProps: {},
    dragOverParentKey: null,
    unchangedParentKey: null,
    itemIdsByParentKey: new Map(),
    nestTarget: null,
    nestPreviewBeforeKey: null,
    onClickCapture: () => undefined,
    pinnedItemIds: [],
    pinnedReorderPending: false,
    reorderTarget: null,
    ...overrides,
  };
}

interface HarnessProps {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}

function Harness({ children, store }: HarnessProps) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

interface RenderTreeOptions {
  threads?: readonly SidebarThread[];
  draftThreadIds?: readonly string[];
  sdk?: PluginSdkTestFakes;
  store?: ReturnType<typeof createStore>;
}

function renderTree(
  children: ReactNode,
  { threads = [], draftThreadIds = [], sdk, store }: RenderTreeOptions = {},
): RenderedSlot {
  return renderSlot(
    { component: Harness },
    { children, store: store ?? createStore() },
    {
      sidebarThreads: {
        threads,
        projects: [makeSidebarProject()],
      },
      sidebarDraftThreadIds: draftThreadIds,
      sdk,
    },
  );
}

function renderPinnedParentWithChild({
  isCollapsed,
  sectionDnd,
}: {
  isCollapsed: boolean;
  sectionDnd: SectionThreadDndState;
}) {
  const parent = makeThread({
    id: "thr_parent",
    title: "Parent",
    titleFallback: "Parent",
    pinnedAt: 1,
  });
  const child = makeThread({
    id: "thr_child",
    title: "Child",
    titleFallback: "Child",
    parentThreadId: "thr_parent",
  });
  const node = buildPinnedSidebarState({ threads: [parent, child] })
    .rootNodes[0];
  const { container } = renderTree(
    <ThreadTreeNodeRow
      projectId="proj_test"
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      collapsedThreadIds={isCollapsed ? new Set(["thr_parent"]) : new Set()}
      collapsedEnvironmentIds={new Set()}
      variant="section"
      onToggleThreadCollapsed={vi.fn()}
      onToggleEnvironmentCollapsed={vi.fn()}
      sectionDnd={sectionDnd}
      sortableRef={() => undefined}
    />,
    { threads: [parent, child] },
  );
  return container;
}

function renderProjectRow(
  onToggleProjectCollapsed = vi.fn(),
  threadListState: ProjectThreadListState = { status: "ready", threads: [] },
  isActive = false,
  collapsedEnvironmentIds: Set<string> = new Set(),
  isCollapsed = false,
  options: Omit<RenderTreeOptions, "threads"> = {},
) {
  const onToggleEnvironmentCollapsed = vi.fn();
  const store = createStore();
  store.set(sidebarOrganizationModeAtom, "project");
  const result = renderTree(
    <ProjectRow
      project={makeSidebarProject()}
      threadListState={threadListState}
      isActive={isActive}
      isCollapsed={isCollapsed}
      compareThreads={() => 0}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
      onToggleThreadCollapsed={vi.fn()}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />,
    {
      threads:
        threadListState.status === "ready" ? threadListState.threads : [],
      store,
      ...options,
    },
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

function CustomSectionsVisibilityProbe({
  threads,
  onProjectSelect,
}: {
  threads: SidebarThread[];
  onProjectSelect: () => void;
}) {
  const { order, persistedOrder, onOrderChange } = useSidebarModeSectionOrder({
    mode: "chronological",
    entitySectionIds: ["section:sec_building", "section:sec_review"],
    showPinnedSection: false,
  });

  return (
    <ChronologicalSectionThreadSections
      threadListState={{ status: "ready", threads }}
      compareThreads={() => 0}
      sections={[
        { id: "sec_building", name: "Building" },
        { id: "sec_review", name: "Review" },
      ]}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={new Set()}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={vi.fn()}
      onToggleEnvironmentCollapsed={vi.fn()}
      topLevelSectionOrder={order}
      fullSectionOrder={persistedOrder}
      onTopLevelSectionOrderChange={onOrderChange}
      pinnedReorderPending={false}
      pinnedThreads={[]}
      onReorderPinnedThread={vi.fn()}
      builtInSections={{
        collapsedSectionIds: new Set(),
        onToggleCollapsed: vi.fn(),
        pinned: { label: "Pinned", content: null },
        threads: {
          label: "Threads",
          actions: (
            <SidebarHeaderControls label="Threads" showNewThread={false}>
              <ThreadListVisibilityMenuItems />
            </SidebarHeaderControls>
          ),
        },
      }}
    />
  );
}

function renderCollapsedSection(
  sectionId: string,
  name: string,
  thread: SidebarThread,
  draftThreadIds: readonly string[] = [],
) {
  renderTree(
    <ChronologicalSectionThreadSections
      threadListState={{ status: "ready", threads: [thread] }}
      compareThreads={() => 0}
      sections={[{ id: sectionId, name }]}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={new Set()}
      onToggleThreadCollapsed={vi.fn()}
      onToggleEnvironmentCollapsed={vi.fn()}
      topLevelSectionOrder={[buildSidebarEntitySectionId("section", sectionId)]}
      fullSectionOrder={[buildSidebarEntitySectionId("section", sectionId)]}
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
    />,
    { threads: [thread], draftThreadIds },
  );
  fireEvent.click(
    screen.getByRole("button", { name: `Collapse ${name} section` }),
  );
}

const ENVIRONMENT_THREADS = [
  makeThread({
    id: "thr_worktree_a",
    environment: makeSidebarEnvironment({
      id: "env_test",
      name: "Feature workspace",
      branchName: "feat/menu-close",
      providerId: "git-worktree",
      isWorktree: true,
    }),
    queuedWork: "none",
  }),
  makeThread({
    id: "thr_worktree_b",
    environment: makeSidebarEnvironment({
      id: "env_test",
      name: "Feature workspace",
      branchName: "feat/menu-close",
      providerId: "git-worktree",
      isWorktree: true,
    }),
    queuedWork: "none",
  }),
];

describe("ProjectRow interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("previews the dragged thread as a child of a valid nest target", () => {
    const container = renderPinnedParentWithChild({
      isCollapsed: false,
      sectionDnd: makeSectionDnd({
        nestTarget: { threadId: "thr_parent", state: "valid" },
        nestPreviewBeforeKey: "thread:thr_child",
      }),
    });

    const rows = [
      ...container.querySelectorAll(
        "[data-sidebar-thread-id], [data-sidebar-nest-drop-preview]",
      ),
    ];
    expect(
      rows.map(
        (row) => row.getAttribute("data-sidebar-thread-id") ?? row.textContent,
      ),
    ).toEqual(["thr_parent", "Dragged", "thr_child"]);
  });

  it("previews the dragged thread after the last child when it sorts last", () => {
    const container = renderPinnedParentWithChild({
      isCollapsed: false,
      sectionDnd: makeSectionDnd({
        nestTarget: { threadId: "thr_parent", state: "valid" },
        nestPreviewBeforeKey: null,
      }),
    });

    const rows = [
      ...container.querySelectorAll(
        "[data-sidebar-thread-id], [data-sidebar-nest-drop-preview]",
      ),
    ];
    expect(
      rows.map(
        (row) => row.getAttribute("data-sidebar-thread-id") ?? row.textContent,
      ),
    ).toEqual(["thr_parent", "thr_child", "Dragged"]);
  });

  it("leaves a blocked nest target without a child preview", () => {
    const container = renderPinnedParentWithChild({
      isCollapsed: false,
      sectionDnd: makeSectionDnd({
        nestTarget: { threadId: "thr_parent", state: "blocked" },
        nestPreviewBeforeKey: null,
      }),
    });

    expect(
      container.querySelector("[data-sidebar-nest-drop-preview]"),
    ).toBeNull();
  });

  it("anchors a pinned insert line below the subtree, not between parent and child", () => {
    const container = renderPinnedParentWithChild({
      isCollapsed: false,
      sectionDnd: makeSectionDnd({
        reorderTarget: { threadId: "thr_parent", placement: "after" },
      }),
    });

    expect(screen.getByText("Child")).not.toBeNull();
    expect(
      container.querySelector("[data-sidebar-reorder-placement]"),
    ).toBeNull();
    const group = container.querySelector<HTMLElement>(
      "[data-sidebar-sticky-group]",
    );
    expect(group?.className).toContain("after:-bottom-px");
    expect(group?.contains(screen.getByText("Child"))).toBe(true);
  });

  it("anchors a pinned insert line on the row when the subtree is collapsed", () => {
    const container = renderPinnedParentWithChild({
      isCollapsed: true,
      sectionDnd: makeSectionDnd({
        reorderTarget: { threadId: "thr_parent", placement: "after" },
      }),
    });

    expect(screen.queryByText("Child")).toBeNull();
    expect(
      container
        .querySelector("[data-sidebar-reorder-placement]")
        ?.getAttribute("data-sidebar-reorder-placement"),
    ).toBe("after");
  });

  it("renders the dragged copy as a compact opaque chip", () => {
    renderTree(<SectionThreadDragOverlay thread={makeThread()} />);

    const overlay = document.querySelector(
      '[data-sidebar-section-drag-overlay="true"]',
    );
    expect(overlay?.className).toContain("w-fit");
    expect(overlay?.className).toContain("max-w-56");
    expect(overlay?.className).not.toContain("opacity-");
  });

  it("keeps project header controls touch-accessible when their menu opens and closes", async () => {
    renderProjectRow();
    const trigger = screen.getByRole("button", {
      name: /^Test project actions(?:;|$)/,
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
    const update = vi.fn(sdkResult({ ok: true }));
    const { onToggleProjectCollapsed, sdkCalls } = renderProjectRow(
      vi.fn(),
      { status: "ready", threads: [] },
      false,
      new Set(),
      false,
      { sdk: { projects: { update } } },
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "  Renamed project  " } });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(input);
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(sdkCalls).toContainEqual({
        method: "projects.update",
        args: [{ projectId: "proj_test", name: "Renamed project" }],
      }),
    );
    expect(onToggleProjectCollapsed).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links project settings and confirms removal through the SDK", async () => {
    const remove = vi.fn(sdkResult({ ok: true }));
    const { sdkCalls } = renderProjectRow(
      vi.fn(),
      { status: "ready", threads: [] },
      false,
      new Set(),
      false,
      { sdk: { projects: { delete: remove } } },
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    const settings = await screen.findByRole("menuitem", {
      name: "Project settings",
    });
    expect(settings.getAttribute("href")).toBe("/settings/projects/proj_test");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove project" }),
    );
    await waitFor(() =>
      expect(sdkCalls).toContainEqual({
        method: "projects.delete",
        args: [{ projectId: "proj_test" }],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
      threadLink?.closest<HTMLElement>(".bb-sidebar-hover-actions-row")?.style
        .paddingLeft,
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
            environment: makeSidebarEnvironment({
              id: "env_test",
              name: "Feature workspace",
              branchName: "feat/menu-close",
              providerId: "git-worktree",
              isWorktree: true,
            }),
            queuedWork: "none",
            activity: {
              workflows: 1,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 0,
              goals: 0,
            },
            runtimeStatus: "active",
          }),
          makeThread({
            id: "thr_worktree_sibling",
            environment: makeSidebarEnvironment({
              id: "env_test",
              name: "Feature workspace",
              branchName: "feat/menu-close",
              providerId: "git-worktree",
              isWorktree: true,
            }),
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

  it.each([
    { isCollapsed: true, expectedHoverReveal: false },
    { isCollapsed: false, expectedHoverReveal: true },
  ])(
    "sets environment disclosure hover reveal to $expectedHoverReveal when collapsed is $isCollapsed",
    ({ expectedHoverReveal, isCollapsed }) => {
      const environment = makeSidebarEnvironment({
        id: "env_disclosure",
        name: "Disclosure workspace",
        providerId: "git-worktree",
        isWorktree: true,
      });
      renderProjectRow(
        vi.fn(),
        {
          status: "ready",
          threads: [
            makeThread({ id: "thr_disclosure_one", environment }),
            makeThread({ id: "thr_disclosure_two", environment }),
          ],
        },
        false,
        new Set(isCollapsed ? ["env_disclosure"] : []),
      );

      const toggle = screen.getByRole("button", {
        name: `${isCollapsed ? "Expand" : "Collapse"} Disclosure workspace threads`,
      });
      expect(toggle.classList.contains("bb-sidebar-hover-actions")).toBe(
        expectedHoverReveal,
      );
    },
  );

  it("shows a working draft before named work for a collapsed environment", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_worktree_plan",
            environment: makeSidebarEnvironment({
              id: "env_draft",
              name: "Draft workspace",
              providerId: "git-worktree",
              isWorktree: true,
            }),
            queuedWork: "none",
            activity: {
              workflows: 0,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 1,
              goals: 0,
            },
          }),
          makeThread({
            id: "thr_worktree_draft",
            environment: makeSidebarEnvironment({
              id: "env_draft",
              name: "Draft workspace",
              providerId: "git-worktree",
              isWorktree: true,
            }),
            queuedWork: "none",
          }),
        ],
      },
      false,
      new Set(["env_draft"]),
      false,
      { draftThreadIds: ["thr_worktree_draft"] },
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("keeps a duplicate section name in place until corrected", async () => {
    const update = vi.fn(sdkResult({ ok: true })).mockRejectedValueOnce(
      Object.assign(new Error("HTTP 409: Conflict"), {
        status: 409,
        code: "section_name_conflict",
      }),
    );
    const { sdkCalls } = renderTree(
      <CustomSectionsVisibilityProbe threads={[]} onProjectSelect={vi.fn()} />,
      { sdk: { threadSections: { update } } },
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Building section actions" }),
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
      expect(sdkCalls.at(-1)).toEqual({
        method: "threadSections.update",
        args: [{ id: "sec_building", name: "New section" }],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Section name" }),
      ).toBeNull(),
    );
  });

  it("uses shared runtime precedence when a top-level section is collapsed", () => {
    const sectionId = "sec_active";
    renderCollapsedSection(
      sectionId,
      "Active work",
      makeThread({
        id: "thr_section_active",
        sectionId,
        status: "active",
        runtimeStatus: "active",
        activity: {
          workflows: 0,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 1,
          goals: 1,
        },
      }),
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
    const sectionId = "sec_draft";
    renderCollapsedSection(
      sectionId,
      "Draft work",
      makeThread({
        id: "thr_section_draft",
        sectionId,
        activity: {
          workflows: 0,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 1,
          goals: 1,
        },
      }),
      ["thr_section_draft"],
    );

    expect(
      screen.getAllByLabelText("Thread working with unsubmitted draft"),
    ).not.toHaveLength(0);
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("hides loose Threads in More and restores them", async () => {
    const store = createStore();
    const savedOrder = ["section:sec_building", "pinned", "threads"];
    store.set(sidebarOrganizationModeAtom, "chronological");
    store.set(sidebarManualSectionOrderAtom, savedOrder);
    const threads = [
      makeThread({
        id: "thr_loose",
        title: "Loose thread",
        titleFallback: "Loose thread",
        sectionId: null,
      }),
    ];
    renderTree(
      <CustomSectionsVisibilityProbe
        threads={threads}
        onProjectSelect={vi.fn()}
      />,
      { threads, store },
    );

    expect(screen.getByText("Loose thread")).not.toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Threads actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from list" }),
    );

    expect(screen.queryByText("Loose thread")).toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["threads"]);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(savedOrder);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "More sections" }),
      ),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More sections" }), {
      key: "Enter",
    });
    const threadsGroup = await screen.findByRole("menuitem", {
      name: "Threads",
    });
    fireEvent.keyDown(threadsGroup, { key: "ArrowRight" });
    expect(await screen.findByText("Loose thread")).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More sections" }),
      ).toBeNull(),
    );
    expect(screen.getByText("Loose thread")).not.toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual([]);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(savedOrder);
  });

  it("hides a section with inherited descendants and restores its saved position", async () => {
    const store = createStore();
    const savedOrder = [
      "section:sec_review",
      "section:sec_building",
      "pinned",
      "threads",
    ];
    store.set(sidebarOrganizationModeAtom, "chronological");
    store.set(sidebarManualSectionOrderAtom, savedOrder);
    const onProjectSelect = vi.fn();
    const threads = [
      makeThread({
        id: "thr_review_parent",
        title: "Review parent",
        titleFallback: "Review parent",
        sectionId: "sec_review",
      }),
      makeThread({
        id: "thr_inherited_child",
        title: "Inherited child",
        titleFallback: "Inherited child",
        parentThreadId: "thr_review_parent",
        sectionId: null,
      }),
    ];
    const { container } = renderTree(
      <CustomSectionsVisibilityProbe
        threads={threads}
        onProjectSelect={onProjectSelect}
      />,
      { threads, store },
    );

    expect(screen.getByText("Review parent")).not.toBeNull();
    expect(screen.getByText("Inherited child")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "More sections" })).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Review section actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from list" }),
    );

    expect(screen.queryByText("Review parent")).toBeNull();
    expect(screen.queryByText("Inherited child")).toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["section:sec_review"]);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(savedOrder);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "More sections" }),
      ),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More sections" }), {
      key: "Enter",
    });
    const section = await screen.findByRole("menuitem", { name: "Review" });
    expect(screen.queryByText("Review parent")).toBeNull();
    fireEvent.keyDown(section, { key: "ArrowRight" });
    expect(await screen.findByText("Review parent")).not.toBeNull();
    fireEvent.click(
      await screen.findByRole("link", { name: "Open Inherited child" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "Hidden sections" }),
      ).toBeNull(),
    );
    expect(onProjectSelect).toHaveBeenCalledOnce();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["section:sec_review"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "More sections" }), {
      key: "Enter",
    });
    const reopenedSection = await screen.findByRole("menuitem", {
      name: "Review",
    });
    expect(screen.queryByText("Review parent")).toBeNull();
    fireEvent.keyDown(reopenedSection, { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More sections" }),
      ).toBeNull(),
    );
    expect(screen.getByText("Inherited child")).not.toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual([]);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(savedOrder);
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-sidebar-visibility-group]",
        ),
        (element) => element.dataset.sidebarVisibilityGroup,
      ),
    ).toEqual(["section:sec_review", "section:sec_building", "threads"]);
  });

  it("surfaces named activity when the project is collapsed", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            activity: {
              workflows: 0,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 0,
              goals: 1,
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
      { draftThreadIds: ["thr_project_draft"] },
    );

    expect(
      screen.getAllByLabelText("Unread thread succeeded"),
    ).not.toHaveLength(0);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it("excludes hidden side-chat activity from a collapsed project", () => {
    renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_side_chat",
            isHidden: true,
            activity: {
              workflows: 0,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 1,
              goals: 0,
            },
          }),
        ],
      },
      false,
      new Set(),
      true,
      { draftThreadIds: ["thr_side_chat"] },
    );

    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(document.querySelector('[data-icon="Edit"]')).toBeNull();
  });

  it.each([false, true])(
    "keeps environment actions touch-accessible when collapsed=%s",
    async (isCollapsed) => {
      const update = vi.fn(sdkResult({ ok: true }));
      const { sidebarActionCalls, sdkCalls } = renderProjectRow(
        vi.fn(),
        { status: "ready", threads: ENVIRONMENT_THREADS },
        false,
        isCollapsed ? new Set(["env_test"]) : new Set(),
        false,
        { sdk: { environments: { update } } },
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
      expect(sidebarActionCalls).toEqual([
        {
          method: "openNewThread",
          options: {
            projectId: "proj_test",
            environmentId: "env_test",
            focusPrompt: true,
          },
        },
      ]);

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
      await waitFor(() =>
        expect(sdkCalls).toContainEqual({
          method: "environments.update",
          args: [{ environmentId: "env_test", name: null }],
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
          environment: makeSidebarEnvironment({
            id: "env_checkout",
            branchName: "main",
            providerId: null,
          }),
          queuedWork: "none",
        }),
        makeThread({
          id: "thr_checkout_b",
          environment: makeSidebarEnvironment({
            id: "env_checkout",
            branchName: "main",
            providerId: null,
          }),
          queuedWork: "none",
        }),
      ],
    });

    expect(
      screen.queryByRole("button", { name: "Collapse main threads" }),
    ).toBeNull();
  });

  it("archives and renames an environment group from any provider", async () => {
    const archiveThreads = vi.fn(
      sdkResult({ ok: true, archivedThreadIds: [] }),
    );
    const update = vi.fn(sdkResult({ ok: true }));
    const { sdkCalls } = renderProjectRow(
      vi.fn(),
      {
        status: "ready",
        threads: [
          makeThread({
            id: "thr_plain_a",
            environment: makeSidebarEnvironment({
              id: "env_plain",
              branchName: "main",
              providerId: "personal-workspace",
              isWorktree: true,
            }),
            queuedWork: "none",
          }),
          makeThread({
            id: "thr_plain_b",
            environment: makeSidebarEnvironment({
              id: "env_plain",
              branchName: "main",
              providerId: "personal-workspace",
              isWorktree: true,
            }),
            queuedWork: "none",
          }),
        ],
      },
      false,
      new Set(),
      false,
      { sdk: { environments: { archiveThreads, update } } },
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Environment actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(sdkCalls).toContainEqual({
      method: "environments.archiveThreads",
      args: [{ environmentId: "env_plain" }],
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
      expect(sdkCalls).toContainEqual({
        method: "environments.update",
        args: [{ environmentId: "env_plain", name: "Release workspace" }],
      }),
    );
  });
});
