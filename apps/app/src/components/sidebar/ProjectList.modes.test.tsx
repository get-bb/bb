// @vitest-environment jsdom

import { useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createStore,
  Provider as JotaiProvider,
  useAtom,
  useAtomValue,
} from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host, ThreadListEntry } from "@bb/domain";
import { ActiveSidebarModeSections, MachineModeSections } from "./ProjectList";
import { buildMachineThreadGroups } from "@bb/client-core";
import {
  collapsedSidebarSectionIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarOrganizationModeAtom,
  sidebarSectionOrderAtom,
  type CollapsibleSidebarSectionId,
  type SidebarOrganizationMode,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder";
import {
  makeHost,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";

const mockUseHosts = vi.hoisted(() =>
  vi.fn<() => { data: Host[] }>(() => ({ data: [] })),
);
const mockRenameHost = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/hooks/mutations/host-mutations", () => ({
  useRenameHost: () => ({ mutateAsync: mockRenameHost }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: mockUseHosts,
  usePrimaryHost: vi.fn(() => undefined),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
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

const queryClient = new QueryClient();

vi.mock("@bb/client-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/client-core")>();
  return {
    ...actual,
    buildMachineThreadGroups: vi.fn(actual.buildMachineThreadGroups),
  };
});

const mockBuildMachineThreadGroups = vi.mocked(buildMachineThreadGroups);

function getModeOrderProbeConfig(mode: SidebarOrganizationMode): {
  entitySectionIds: SidebarSectionId[];
  hasThreadsSection?: boolean;
} {
  switch (mode) {
    case "project":
      return { entitySectionIds: ["project:a"] };
    case "chronological":
      return { entitySectionIds: ["section:a"] };
    case "machine":
      return { entitySectionIds: [], hasThreadsSection: true };
  }
}

function ModeOrderProbe({ mode }: { mode: SidebarOrganizationMode }) {
  const config = getModeOrderProbeConfig(mode);
  const { order } = useSidebarModeSectionOrder({
    mode,
    entitySectionIds: config.entitySectionIds,
    hasThreadsSection: config.hasThreadsSection,
    showPinnedSection: true,
  });

  return <div data-testid={`${mode}-order`}>{order.join(",")}</div>;
}

interface ActiveModeOrderProbeProps {
  mode: SidebarOrganizationMode;
  renderChronological?: () => ReactNode;
  renderMachine?: () => ReactNode;
  renderProject?: () => ReactNode;
}

function ActiveModeOrderProbe({
  mode,
  renderChronological = () => (
    <ModeOrderProbe key="chronological" mode="chronological" />
  ),
  renderMachine = () => <ModeOrderProbe key="machine" mode="machine" />,
  renderProject = () => <ModeOrderProbe key="project" mode="project" />,
}: ActiveModeOrderProbeProps) {
  return (
    <ActiveSidebarModeSections
      mode={mode}
      renderChronological={renderChronological}
      renderMachine={renderMachine}
      renderProject={renderProject}
    />
  );
}

function StoredActiveModeOrderProbe() {
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  return <ActiveModeOrderProbe mode={mode} />;
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_machine",
    projectId: "proj_machine",
    title: "Machine activity",
    titleFallback: "Machine activity",
    status: "active",
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 0,
    },
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  });
}

function MachineModeProbe({ threads = [] }: { threads?: ThreadListEntry[] }) {
  const [collapsedSectionIds, setCollapsedSectionIds] = useAtom(
    collapsedSidebarSectionIdsAtom,
  );
  const collapsedSectionIdSet = useMemo(
    () => new Set(collapsedSectionIds),
    [collapsedSectionIds],
  );
  const handleToggleCollapsed = (id: CollapsibleSidebarSectionId) => {
    setCollapsedSectionIds((current) =>
      current.includes(id)
        ? current.filter((sectionId) => sectionId !== id)
        : [...current, id],
    );
  };

  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MachineModeSections
            threads={threads}
            draftThreadIds={new Set()}
            effectivePinnedThreadIds={new Set()}
            status="ready"
            showPinnedSection={false}
            pinnedSection={{ label: "Pinned", content: null }}
            pinnedReorderPending={false}
            pinnedRootNodes={[]}
            pinnedThreads={[]}
            onReorderPinnedThread={vi.fn()}
            threadsSection={{ label: "Threads" }}
            collapsedSectionIds={collapsedSectionIdSet}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            compareThreads={() => 0}
            renderSectionDisplayOptions={() => null}
            isSectionDisplayOptionsOpen={() => false}
            onToggleCollapsed={handleToggleCollapsed}
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseHosts.mockReturnValue({ data: [] });
  window.localStorage.clear();
});

describe("sidebar organization mode sections", () => {
  it("does not mount inactive ordering or machine-grouping work", async () => {
    const store = createStore();
    store.set(sidebarSectionOrderAtom, ["threads", "project:a", "pinned"]);
    store.set(sidebarManualSectionOrderAtom, ["section:stale"]);
    store.set(sidebarMachineSectionOrderAtom, ["machine:stale"]);
    const renderChronological = vi.fn(() => (
      <ModeOrderProbe mode="chronological" />
    ));
    const renderMachine = vi.fn(() => <MachineModeProbe />);
    const renderProject = vi.fn(() => <ModeOrderProbe mode="project" />);

    render(
      <JotaiProvider store={store}>
        <ActiveModeOrderProbe
          mode="project"
          renderChronological={renderChronological}
          renderMachine={renderMachine}
          renderProject={renderProject}
        />
      </JotaiProvider>,
    );

    await screen.findByTestId("project-order");
    expect(renderProject).toHaveBeenCalledOnce();
    expect(renderChronological).not.toHaveBeenCalled();
    expect(renderMachine).not.toHaveBeenCalled();
    expect(mockUseHosts).not.toHaveBeenCalled();
    expect(mockBuildMachineThreadGroups).not.toHaveBeenCalled();
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(["section:stale"]);
    expect(store.get(sidebarMachineSectionOrderAtom)).toEqual([
      "machine:stale",
    ]);
  });

  it("preserves each persisted order while switching modes", async () => {
    const store = createStore();
    const projectOrder = ["threads", "project:a", "pinned"];
    const sectionOrder = ["section:a", "pinned", "threads"];
    const machineOrder = ["threads", "pinned"];
    store.set(sidebarSectionOrderAtom, projectOrder);
    store.set(sidebarManualSectionOrderAtom, sectionOrder);
    store.set(sidebarMachineSectionOrderAtom, machineOrder);
    store.set(sidebarOrganizationModeAtom, "project");
    render(
      <JotaiProvider store={store}>
        <StoredActiveModeOrderProbe />
      </JotaiProvider>,
    );

    expect(await screen.findByTestId("project-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "chronological"));
    expect(await screen.findByTestId("chronological-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "machine"));
    expect(await screen.findByTestId("machine-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "project"));
    expect(await screen.findByTestId("project-order")).not.toBeNull();

    await waitFor(() => {
      expect(store.get(sidebarSectionOrderAtom)).toEqual(projectOrder);
      expect(store.get(sidebarManualSectionOrderAtom)).toEqual(sectionOrder);
      expect(store.get(sidebarMachineSectionOrderAtom)).toEqual(machineOrder);
    });
  });

  it("collapses and expands empty-machine Threads", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["threads"]);
    store.set(collapsedSidebarSectionIdsAtom, []);

    render(
      <JotaiProvider store={store}>
        <MachineModeProbe />
      </JotaiProvider>,
    );

    expect(screen.getByText("No threads")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Threads section" }),
    );
    expect(screen.queryByText("No threads")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Threads section" }),
    );
    expect(screen.getByText("No threads")).not.toBeNull();
    expect(mockBuildMachineThreadGroups).toHaveBeenCalledWith([], []);
  });

  it("renames a resolved machine heading without expanding the group", async () => {
    const store = createStore();
    const host = makeHost({ id: "host_rename", name: "Work laptop" });
    mockUseHosts.mockReturnValue({ data: [host] });
    store.set(sidebarMachineSectionOrderAtom, ["machine:host_rename"]);
    store.set(sidebarCollapsedMachinesAtom, ["host_rename"]);
    render(
      <JotaiProvider store={store}>
        <MachineModeProbe
          threads={[makeThread({ environmentHostId: host.id })]}
        />
      </JotaiProvider>,
    );

    fireEvent.doubleClick(screen.getByTitle("Work laptop"));
    const input = await screen.findByRole("textbox", { name: "Machine name" });
    expect(input.closest('[aria-disabled="true"]')).toBeNull();
    fireEvent.change(input, { target: { value: "Studio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockRenameHost).toHaveBeenCalledWith({
        hostId: host.id,
        name: "Studio",
      }),
    );
    expect(store.get(sidebarCollapsedMachinesAtom)).toEqual([host.id]);
  });

  it("does not offer inline rename on fallback machine headings", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);
    render(
      <JotaiProvider store={store}>
        <MachineModeProbe threads={[makeThread()]} />
      </JotaiProvider>,
    );
    fireEvent.doubleClick(screen.getByTitle("No machine"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mockRenameHost).not.toHaveBeenCalled();
  });

  it("surfaces shared runtime activity for a collapsed machine section", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);

    render(
      <JotaiProvider store={store}>
        <MachineModeProbe threads={[makeThread()]} />
      </JotaiProvider>,
    );

    expect(screen.queryByText("Machine activity")).toBeNull();
    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("keeps hidden machine activity in More and restores the saved collapse state", async () => {
    const store = createStore();
    const savedOrder = ["machine:no-machine", "pinned"];
    store.set(sidebarMachineSectionOrderAtom, savedOrder);
    store.set(sidebarHiddenGroupsAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);

    render(
      <JotaiProvider store={store}>
        <MachineModeProbe threads={[makeThread()]} />
      </JotaiProvider>,
    );

    const more = screen.getByRole("button", { name: "More machines" });
    expect(within(more).getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByText("No machine")).toBeNull();
    expect(screen.queryByText("Machine activity")).toBeNull();

    fireEvent.click(more);
    const hiddenMachines = await screen.findByRole("list", {
      name: "Hidden machines",
    });
    expect(within(hiddenMachines).getByText("Machine activity")).not.toBeNull();
    fireEvent.click(
      within(hiddenMachines).getByRole("button", {
        name: "Collapse No machine section",
      }),
    );
    expect(within(hiddenMachines).queryByText("Machine activity")).toBeNull();
    fireEvent.click(
      within(hiddenMachines).getByRole("button", {
        name: "Expand No machine section",
      }),
    );
    expect(within(hiddenMachines).getByText("Machine activity")).not.toBeNull();
    expect(within(more).getByLabelText("Plan mode active")).not.toBeNull();
    fireEvent.keyDown(
      within(hiddenMachines).getByRole("button", {
        name: "No machine options",
      }),
      { key: "Enter" },
    );
    const restore = await screen.findByRole("menuitem", {
      name: "Add to sidebar",
    });
    expect(
      screen.getByRole("list", { name: "Hidden machines" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Customize list" }),
    ).not.toBeNull();
    fireEvent.click(restore);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More machines" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Expand No machine section" }),
    ).not.toBeNull();
    expect(screen.queryByText("Machine activity")).toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual([]);
    expect(store.get(sidebarCollapsedMachinesAtom)).toEqual(["no-machine"]);
    expect(store.get(sidebarMachineSectionOrderAtom)).toEqual(savedOrder);
  });
});
