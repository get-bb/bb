// @vitest-environment jsdom

import { useMemo, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createStore,
  Provider as JotaiProvider,
  useAtom,
  useAtomValue,
} from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import {
  buildMachineThreadGroups,
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
} from "@bb/client-core";
import {
  installTestPluginRuntime,
  renderSlot,
  type PluginSdkTestFakes,
} from "@get-bb/plugin-sdk/testing/app";
import {
  collapsedSidebarSectionIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarOrganizationModeAtom,
  sidebarSectionOrderAtom,
} from "../preferences/atoms.js";
import type { OrganizationMode as SidebarOrganizationMode } from "../../shared/preferences.js";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { sdkResult, toPluginSidebarThread } from "../model/fixtures.js";

vi.mock("@bb/client-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/client-core")>();
  return {
    ...actual,
    buildMachineThreadGroups: vi.fn(actual.buildMachineThreadGroups),
  };
});

installTestPluginRuntime();
const { ActiveSidebarModeSections, MachineModeSections } = await import(
  "./ProjectList.js"
);
const { useSidebarModeSectionOrder } = await import(
  "./useSidebarModeSectionOrder.js"
);

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

function MachineModeProbe({
  threads = [],
  selectedThreadId,
  status = "ready",
}: {
  threads?: ThreadListEntry[];
  selectedThreadId?: string;
  status?: "loading" | "ready" | "unavailable";
}) {
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
      <MachineModeSections
        threads={threads}
        draftThreadIds={new Set()}
        effectivePinnedThreadIds={new Set()}
        status={status}
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
        selectedThreadId={selectedThreadId}
      />
    </TooltipProvider>
  );
}

interface HarnessProps {
  store: ReturnType<typeof createStore>;
  children: ReactNode;
}

function Harness({ store, children }: HarnessProps) {
  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}

function renderMachineMode(
  store: ReturnType<typeof createStore>,
  threads: ThreadListEntry[] = [],
  {
    hosts = {},
    sdk,
    selectedThreadId,
    status,
  }: {
    hosts?: Record<string, string>;
    sdk?: PluginSdkTestFakes;
    selectedThreadId?: string;
    status?: "loading" | "ready" | "unavailable";
  } = {},
) {
  return renderSlot(
    { component: Harness },
    {
      store,
      children: (
        <MachineModeProbe
          threads={threads}
          selectedThreadId={selectedThreadId}
          status={status}
        />
      ),
    },
    {
      sidebarThreads: {
        threads: threads.map((thread) =>
          toPluginSidebarThread(
            thread,
            thread.environmentHostId !== null &&
              thread.environmentHostId in hosts
              ? {
                  id: thread.environmentHostId,
                  name: hosts[thread.environmentHostId] ?? "",
                }
              : null,
          ),
        ),
      },
      sdk,
    },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

    renderMachineMode(store);

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
    const hostUpdate = vi.fn(sdkResult({ ok: true }));
    store.set(sidebarMachineSectionOrderAtom, ["machine:host_rename"]);
    store.set(sidebarCollapsedMachinesAtom, ["host_rename"]);
    const { sdkCalls } = renderMachineMode(
      store,
      [makeThread({ environmentHostId: "host_rename" })],
      {
        hosts: { host_rename: "Work laptop" },
        sdk: { hosts: { update: hostUpdate } },
      },
    );

    fireEvent.doubleClick(screen.getByTitle("Work laptop"));
    const input = await screen.findByRole("textbox", { name: "Machine name" });
    expect(input.closest('[aria-disabled="true"]')).toBeNull();
    fireEvent.change(input, { target: { value: "Studio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(sdkCalls).toContainEqual({
        method: "hosts.update",
        args: [{ hostId: "host_rename", name: "Studio" }],
      }),
    );
    expect(store.get(sidebarCollapsedMachinesAtom)).toEqual(["host_rename"]);
  });

  it("does not offer inline rename on fallback machine headings", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);
    const { sdkCalls } = renderMachineMode(store, [makeThread()]);
    fireEvent.doubleClick(screen.getByTitle("No machine"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(sdkCalls).toEqual([]);
  });

  it("surfaces shared runtime activity for a collapsed machine section", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);

    renderMachineMode(store, [makeThread()]);

    expect(screen.queryByText("Machine activity")).toBeNull();
    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("shows a hidden section's loading state instead of New thread", async () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["threads", "pinned"]);
    store.set(sidebarHiddenGroupsAtom, ["threads"]);

    renderMachineMode(store, [], { status: "loading" });

    fireEvent.keyDown(screen.getByRole("button", { name: "More machines" }), {
      key: "Enter",
    });
    fireEvent.keyDown(
      await screen.findByRole("menuitem", { name: /Threads/ }),
      { key: "ArrowRight" },
    );
    expect(
      await screen.findByRole("button", { name: "Add to list" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
  });

  it("marks More and the hidden section as the breadcrumb to the selected thread", async () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine", "pinned"]);
    store.set(sidebarHiddenGroupsAtom, ["machine:no-machine"]);

    renderMachineMode(store, [makeThread()], {
      selectedThreadId: "thr_machine",
    });

    const more = screen.getByRole("button", { name: "More machines" });
    expect(more.getAttribute("data-selected")).toBe("true");
    fireEvent.keyDown(more, { key: "Enter" });
    const section = await screen.findByRole("menuitem", { name: /No machine/ });
    expect(section.getAttribute("data-selected")).toBe("true");
  });

  it("leaves More unselected when the selected thread is visible elsewhere", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine", "pinned"]);
    store.set(sidebarHiddenGroupsAtom, ["machine:no-machine"]);

    renderMachineMode(store, [makeThread()], {
      selectedThreadId: "thr_elsewhere",
    });

    expect(
      screen
        .getByRole("button", { name: "More machines" })
        .getAttribute("data-selected"),
    ).toBeNull();
  });

  it("keeps hidden machine activity in More and restores the saved collapse state", async () => {
    const store = createStore();
    const savedOrder = ["machine:no-machine", "pinned"];
    store.set(sidebarMachineSectionOrderAtom, savedOrder);
    store.set(sidebarHiddenGroupsAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);

    renderMachineMode(store, [makeThread()]);

    const more = screen.getByRole("button", { name: "More machines" });
    expect(within(more).getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByText("No machine")).toBeNull();
    expect(screen.queryByText("Machine activity")).toBeNull();

    fireEvent.keyDown(more, { key: "Enter" });
    const section = await screen.findByRole("menuitem", { name: /No machine/ });
    expect(screen.queryByText("Machine activity")).toBeNull();
    fireEvent.keyDown(section, { key: "ArrowRight" });
    expect(await screen.findByText("Machine activity")).not.toBeNull();
    expect(within(more).getByLabelText("Plan mode active")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));

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
