// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultStore } from "jotai";
import { DndContext, useDraggable } from "@dnd-kit/core";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { useSidebarReorderDnd } from "@/components/ui/use-sidebar-reorder-dnd";
import { SidebarTouchSensor } from "../dnd/sidebarTouchSensor.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarRenameProvider } from "./SidebarInlineRename.js";
import type {
  PluginSidebarProject,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
  PluginProvidersState,
  PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
  type PluginSdkTestFakes,
  type RenderedSlot,
  type TestThreadActionsResolver,
} from "@get-bb/plugin-sdk/testing/app";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "../model/thread-activity.js";
import {
  makeSidebarEnvironment,
  makeSidebarThread,
} from "../model/fixtures.js";
import { sidebarShowProviderIconsAtom } from "../preferences/atoms.js";
import {
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "@/components/ui/sidebar-row-classes";
import type { ThreadRowOptions } from "./ThreadRow.js";
import {
  preferenceValueAtom,
  resetPreferencesSyncForTest,
} from "../preferences/preferences-sync.js";
import {
  CustomizeRowActionsContext,
  ThreadRowActionsCustomizingContext,
} from "../list/customizeRowActionsContext.js";

installTestPluginRuntime();
const { SidebarDraftPresenceSync } =
  await import("../list/sidebarDraftPresence.js");
const { ThreadRowNavigationProvider } =
  await import("./threadRowNavigation.js");
const { resetSidebarTitleDoubleClickForTest, ThreadRow } =
  await import("./ThreadRow.js");

const DEFAULT_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function createThread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return makeSidebarThread(overrides);
}

function activity(
  overrides: Partial<PluginSidebarThread["activity"]>,
): PluginSidebarThread["activity"] {
  return {
    workflows: 0,
    backgroundAgents: 0,
    backgroundCommands: 0,
    planMode: 0,
    goals: 0,
    ...overrides,
  };
}

interface HarnessProps {
  thread: PluginSidebarThread;
  isCompactViewport?: boolean;
  crossProjectId?: string | null;
  isActive?: boolean;
  options?: ThreadRowOptions;
  onRowEvent?: () => void;
  onCustomizeRowActions?: (threadId: string) => void;
  onFinishCustomizingRowActions?: (restoreFocus: boolean) => void;
}

function ThreadRowHarness({
  thread,
  isCompactViewport,
  crossProjectId = null,
  isActive = false,
  options = DEFAULT_OPTIONS,
  onRowEvent,
  onCustomizeRowActions,
  onFinishCustomizingRowActions,
}: HarnessProps) {
  const row = (
    <ThreadRow
      thread={thread}
      crossProjectId={crossProjectId}
      isActive={isActive}
      options={options}
    />
  );
  const content = (
    <TooltipProvider>
      <SidebarDraftPresenceSync />
      <ThreadRowNavigationProvider>
        <SidebarRenameProvider>
          <CustomizeRowActionsContext.Provider
            value={onCustomizeRowActions ?? null}
          >
            <ThreadRowActionsCustomizingContext.Provider
              value={
                onFinishCustomizingRowActions
                  ? {
                      threadId: thread.id,
                      onDone: onFinishCustomizingRowActions,
                    }
                  : null
              }
            >
              <div
                onPointerDown={onRowEvent}
                onKeyDown={onRowEvent}
                onClick={onRowEvent}
              >
                {row}
              </div>
            </ThreadRowActionsCustomizingContext.Provider>
          </CustomizeRowActionsContext.Provider>
        </SidebarRenameProvider>
      </ThreadRowNavigationProvider>
    </TooltipProvider>
  );
  return isCompactViewport === undefined ? (
    content
  ) : (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      {content}
    </CompactViewportOverrideProvider>
  );
}

interface RenderThreadRowArgs extends Omit<HarnessProps, "thread"> {
  thread?: PluginSidebarThread;
  hasComposerDraft?: boolean;
  hiddenDraftThreadIds?: string[];
  shortcutKey?: string;
  pluginStatus?: PluginSidebarThreadRowStatus;
  splitLayout?: PluginSidebarSplitLayout;
  projects?: PluginSidebarProject[];
  providers?: PluginProvidersState["providers"];
  sdk?: PluginSdkTestFakes;
  threadActions?: TestThreadActionsResolver;
}

function renderThreadRow({
  thread = createThread(),
  hasComposerDraft = false,
  hiddenDraftThreadIds = [],
  shortcutKey,
  pluginStatus,
  splitLayout,
  projects = [],
  providers = [],
  sdk,
  threadActions = hostThreadActions(),
  ...harness
}: RenderThreadRowArgs = {}): RenderedSlot & {
  rerenderThreadRow(nextThread: PluginSidebarThread): void;
} {
  const slot = renderSlot(
    { component: ThreadRowHarness },
    { thread, ...harness },
    {
      sidebarThreads: { threads: [thread], projects },
      providers: { providers },
      sidebarDraftThreadIds: [
        ...(hasComposerDraft ? [thread.id] : []),
        ...hiddenDraftThreadIds,
      ],
      sidebarRowStatuses: pluginStatus ? { [thread.id]: pluginStatus } : {},
      sidebarShortcuts: shortcutKey
        ? {
            [thread.id]: {
              label: `⌘${shortcutKey}`,
              ariaKeyshortcuts: `Meta+${shortcutKey}`,
            },
          }
        : {},
      sidebarSplitLayout: splitLayout,
      sdk,
      threadActions,
    },
  );
  return Object.assign(slot, {
    rerenderThreadRow(nextThread: PluginSidebarThread) {
      slot.lifecycle.rerender(
        <ThreadRowHarness thread={nextThread} {...harness} />,
      );
    },
  });
}

function twoPaneLayout(threadId: string): PluginSidebarSplitLayout {
  return {
    panes: [
      {
        paneId: "pane-thread",
        rect: { x: 0, y: 0, width: 0.5, height: 1 },
        threadId,
        isFocused: true,
      },
      {
        paneId: "pane-compose",
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        threadId: null,
        isFocused: false,
      },
    ],
  };
}

function renderSplitThreadRow(args: RenderThreadRowArgs = {}) {
  const thread = args.thread ?? createThread();
  return renderThreadRow({
    ...args,
    thread,
    splitLayout: twoPaneLayout(thread.id),
  });
}

function openActionsMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Thread actions" }),
    {
      button: 0,
    },
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface RanThreadAction {
  key: string;
  threadId: string;
}

function hostThreadActions({
  ran = [],
  archiveRun,
}: {
  ran?: RanThreadAction[];
  archiveRun?: () => Promise<void>;
} = {}): TestThreadActionsResolver {
  return (thread, { requestRename }) => {
    const entry = (
      key: string,
      label: string,
      icon: string,
      run: () => Promise<void> = async () => {
        ran.push({ key, threadId: thread.id });
      },
    ): PluginThreadActionEntry => ({
      key,
      pluginId: key.split("/")[0] ?? "bb--core",
      group: "2_organize",
      action: {
        label,
        icon,
        run: () => run().catch(() => undefined),
      },
    });
    const isArchived = thread.archivedAt !== null;
    return [
      entry("bb--core/copyLink", "Copy thread link", "Copy"),
      entry(
        "bb--core/pin",
        thread.pinnedAt === null ? "Pin" : "Unpin",
        thread.pinnedAt === null ? "Pin" : "PinOff",
      ),
      ...(thread.parentThreadId === null && !isArchived
        ? [entry("thread-list/move", "Move to section", "SectionMove")]
        : []),
      entry("bb--core/rename", "Rename", "Edit", async () => {
        requestRename(thread.id);
      }),
      entry(
        "bb--core/archive",
        isArchived ? "Unarchive" : "Archive",
        isArchived ? "ArchiveRestore" : "Archive",
        archiveRun,
      ),
    ];
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetSidebarTitleDoubleClickForTest();
  resetPreferencesSyncForTest();
});

describe("ThreadRow", () => {
  it("shows the registered provider icon by default and keeps it visible during inline rename", async () => {
    const provider: PluginProvidersState["providers"][number] = {
      id: "provider-test",
      pluginId: "provider-test",
      displayName: "Test Provider",
      logoUrl: "/provider-test.svg",
      available: true,
      maintenance: { health: false, usage: false, installation: false },
      capabilities: {
        supportsThreadArchive: true,
        supportsThreadRename: true,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: true,
        supportsSessionRewind: false,
        modelCatalogScope: "workspace",
        permissionModes: ["accept-edits", "auto", "full"],
      },
      composerActions: [],
      completedTurnDisplay: "collapse",
    };
    const slot = renderThreadRow({ providers: [provider] });
    expect(screen.getByRole("img", { name: "Test Provider" })).toBeTruthy();
    expect(
      slot.container.querySelector('[data-provider-logo="/provider-test.svg"]'),
    ).toBeTruthy();

    fireEvent.doubleClick(screen.getByText("Thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(screen.getByRole("img", { name: "Test Provider" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "Scratch name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    expect(screen.getByRole("img", { name: "Test Provider" })).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);

    slot.rerenderThreadRow(createThread({ providerId: "missing" }));
    expect(screen.queryByRole("img", { name: "Test Provider" })).toBeNull();
    expect(
      slot.container.querySelector("[data-sidebar-thread-provider]"),
    ).toBeNull();

    slot.rerenderThreadRow(createThread());
    act(() => getDefaultStore().set(sidebarShowProviderIconsAtom, false));
    expect(
      slot.container.querySelector("[data-sidebar-thread-provider]"),
    ).toBeNull();
  });

  it("links the row to the thread href and leaves a plain click to the host", () => {
    const slot = renderThreadRow({
      thread: createThread({ href: "/projects/proj_test/threads/thr_test" }),
    });
    const link = screen.getByRole("link", { name: "Open Thread" });
    expect(link.getAttribute("href")).toBe(
      "/projects/proj_test/threads/thr_test",
    );
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_test");
    expect(link.getAttribute("data-sidebar-rename-anchor")).toBe("");
    expect(link.closest("[data-sidebar-rename-row]")).not.toBeNull();
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
  ])("opens the thread in a split on %s-click", (_label, modifier) => {
    const slot = renderThreadRow();
    const link = screen.getByRole("link", { name: "Open Thread" });
    const event = fireEvent.click(link, modifier);
    expect(event).toBe(false);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_test", options: { split: true } },
    ]);
  });

  it("keeps desktop restore available, hides it on mobile, and blocks row event propagation", async () => {
    const thread = createThread({ archivedAt: 1, isArchived: true });
    const rowEvent = vi.fn();
    const ran: RanThreadAction[] = [];
    renderThreadRow({
      thread,
      onRowEvent: rowEvent,
      threadActions: hostThreadActions({ ran }),
    });
    const restore = screen.getByRole("button", { name: "Unarchive" });
    expect(restore.querySelector('[data-icon="ArchiveRestore"]')).toBeTruthy();
    expect(restore.closest("[data-sidebar-hover-actions-open]")).toBeNull();
    expect(
      restore.closest(".\\[\\@media\\(hover\\:none\\)\\]\\:hidden"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    fireEvent.pointerDown(restore, { pointerType: "touch", button: 0 });
    fireEvent.keyDown(restore, { key: "Enter" });
    fireEvent.click(restore);
    await waitFor(() =>
      expect(ran).toEqual([{ key: "bb--core/archive", threadId: "thr_test" }]),
    );
    expect(rowEvent).not.toHaveBeenCalled();
  });

  it("disables a row action button while its run is in flight and recovers when it fails", async () => {
    const pending = deferred();
    const archiveRun = vi.fn(() => pending.promise);
    renderThreadRow({
      thread: createThread({ archivedAt: 1, isArchived: true }),
      threadActions: hostThreadActions({ archiveRun }),
    });
    const restore = screen.getByRole<HTMLButtonElement>("button", {
      name: "Unarchive",
    });
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(restore.disabled).toBe(true));
    fireEvent.click(restore);
    expect(archiveRun).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error("Unarchive failed"));
      await pending.promise.catch(() => undefined);
    });
    await waitFor(() => expect(restore.disabled).toBe(false));
  });

  it("shows the configured row actions in order and reserves their width", async () => {
    getDefaultStore().set(preferenceValueAtom("rowActions"), [
      "bb--core/pin",
      "bb--core/copyLink",
      "bb--core/archive",
    ]);
    const ran: RanThreadAction[] = [];
    renderThreadRow({ threadActions: hostThreadActions({ ran }) });
    const controls = document.querySelector("[data-sidebar-row-controls]");
    expect(
      Array.from(controls?.querySelectorAll("button") ?? []).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Pin", "Copy thread link", "Archive", "Thread actions"]);
    expect(
      document
        .querySelector<HTMLElement>(".bb-sidebar-hover-actions-inset")
        ?.style.getPropertyValue("--bb-sidebar-hover-actions-inset"),
    ).toBe("calc(var(--spacing) * 22.5)");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() =>
      expect(ran).toEqual([{ key: "bb--core/pin", threadId: "thr_test" }]),
    );
  });

  it("skips row action keys that have no action for the thread", () => {
    getDefaultStore().set(preferenceValueAtom("rowActions"), [
      "thread-list/move",
      "plugin-gone/action",
      "bb--core/archive",
    ]);
    renderThreadRow({
      thread: createThread({ parentThreadId: "thr_parent" }),
    });
    expect(
      screen.queryByRole("button", { name: "Move to section" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(
      document
        .querySelector<HTMLElement>(".bb-sidebar-hover-actions-inset")
        ?.style.getPropertyValue("--bb-sidebar-hover-actions-inset"),
    ).toBe("calc(var(--spacing) * 7.5)");
  });

  it("shows only the actions menu when every row action is turned off", () => {
    getDefaultStore().set(preferenceValueAtom("rowActions"), []);
    renderThreadRow();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.getByRole("button", { name: "Thread actions" })).toBeTruthy();
    expect(
      document
        .querySelector<HTMLElement>(".bb-sidebar-hover-actions-inset")
        ?.style.getPropertyValue("--bb-sidebar-hover-actions-inset"),
    ).toBe("calc(var(--spacing) * 0)");
  });

  it.each([
    [[]],
    [["bb--core/pin", "bb--core/copyLink", "bb--core/archive"]],
  ] as const)(
    "reserves one action for an archived row whatever the row actions (%j)",
    (rowActions) => {
      getDefaultStore().set(preferenceValueAtom("rowActions"), [...rowActions]);
      renderThreadRow({
        thread: createThread({ archivedAt: 1, isArchived: true }),
      });
      expect(
        document
          .querySelector<HTMLElement>(".bb-sidebar-hover-actions-inset")
          ?.style.getPropertyValue("--bb-sidebar-hover-actions-inset"),
      ).toBe("calc(var(--spacing) * 7.5)");
    },
  );

  it("starts the inline rename directly from a Rename row action", async () => {
    getDefaultStore().set(preferenceValueAtom("rowActions"), [
      "bb--core/rename",
    ]);
    renderThreadRow();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(
      await screen.findByRole("textbox", { name: "Thread name" }),
    ).toHaveProperty("value", "Thread");
  });

  it.each(["dropdown", "context"] as const)(
    "adds Customize row actions to the %s menu",
    async (surface) => {
      const customize = vi.fn();
      renderThreadRow({ onCustomizeRowActions: customize });
      if (surface === "dropdown") {
        fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
      } else {
        fireEvent.contextMenu(
          screen.getByRole("link", { name: "Open Thread" }),
        );
      }
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Customize row actions" }),
      );
      expect(customize).toHaveBeenCalledWith("thr_test");
    },
  );

  it("leaves Customize row actions out when the list cannot customize", async () => {
    renderThreadRow();
    fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
    await screen.findByRole("menuitem", { name: "Rename" });
    expect(
      screen.queryByRole("menuitem", { name: "Customize row actions" }),
    ).toBeNull();
  });

  it("customizes row actions on the real row until Done", () => {
    const finish = vi.fn();
    renderThreadRow({ onFinishCustomizingRowActions: finish });
    expect(screen.getByRole("link", { name: "Open Thread" })).toBeTruthy();
    expect(
      document
        .querySelector("[data-sidebar-thread-trailing]")
        ?.classList.contains("hidden"),
    ).toBe(true);
    expect(screen.getByRole("group", { name: "Row actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(finish).toHaveBeenCalledWith(true);
  });

  it.each(["dropdown", "context"] as const)(
    "starts an inline rename once the %s menu has closed",
    async (surface) => {
      renderThreadRow();
      if (surface === "dropdown") {
        fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
      } else {
        fireEvent.contextMenu(
          screen.getByRole("link", { name: "Open Thread" }),
        );
      }
      fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const input = await screen.findByRole("textbox", { name: "Thread name" });
      expect(input).toHaveProperty("value", "Thread");
    },
  );

  it("suppresses the context menu while the title is being edited", async () => {
    renderThreadRow();
    fireEvent.doubleClick(screen.getByText("Thread"));
    await screen.findByRole("textbox", { name: "Thread name" });
    expect(
      screen
        .getByTestId("bb-thread-actions-context-menu")
        .getAttribute("data-disabled"),
    ).toBe("true");
  });

  const splitWorkingCases: Array<{
    label: string;
    pluginStatus?: PluginSidebarThreadRowStatus;
    thread: PluginSidebarThread;
  }> = [
    {
      label: "runtime + pending input",
      thread: createThread({
        status: "active",
        runtimeStatus: "active",
        hasPendingInteraction: true,
      }),
    },
    {
      label: "workflow + pending input",
      thread: createThread({
        hasPendingInteraction: true,
        activity: activity({ workflows: 1 }),
      }),
    },
    {
      label: "background agent + unread error",
      thread: createThread({
        status: "error",
        activity: activity({ backgroundAgents: 1 }),
      }),
    },
    {
      label: "background command + pending input",
      thread: createThread({
        hasPendingInteraction: true,
        activity: activity({ backgroundCommands: 1 }),
      }),
    },
    {
      label: "plan mode + unread error",
      thread: createThread({
        status: "error",
        activity: activity({ planMode: 1 }),
      }),
    },
    {
      label: "goal + pending input",
      thread: createThread({
        hasPendingInteraction: true,
        activity: activity({ goals: 1 }),
      }),
    },
    {
      label: "plugin running + unread error",
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin running",
        tone: "running",
      },
      thread: createThread({ status: "error" }),
    },
  ];

  it.each(splitWorkingCases)(
    "shimmers the split map for $label",
    ({ pluginStatus, thread }) => {
      const { container } = renderSplitThreadRow({ pluginStatus, thread });

      const splitMap = screen.getByRole("img", { name: /open in split/ });
      expect(Array.from(splitMap.classList)).toContain("animate-shine-icon");
      expect(
        splitMap.closest("[data-sidebar-thread-trailing-indicator]"),
      ).not.toBeNull();
      expect(container.querySelector('[data-icon="Loading"]')).toBeNull();
    },
  );

  it.each([
    ["idle", createThread()],
    ["unread error only", createThread({ status: "error" })],
  ])("keeps the split map static for %s", (_label, thread) => {
    renderSplitThreadRow({ thread });

    const splitMap = screen.getByRole("img", { name: /open in split/ });
    expect(Array.from(splitMap.classList)).not.toContain("animate-shine-icon");
  });

  it("marks the row as open in a split and omits the map when the thread is in no pane", () => {
    const { container, unmount } = renderSplitThreadRow();
    expect(
      container.querySelector(".bb-sidebar-open-in-split-row"),
    ).not.toBeNull();
    unmount();

    const other = renderThreadRow({ splitLayout: twoPaneLayout("thr_other") });
    expect(screen.queryByRole("img", { name: /open in split/ })).toBeNull();
    expect(
      other.container.querySelector(".bb-sidebar-open-in-split-row"),
    ).toBeNull();
  });

  it.each([
    {
      label: "pending input",
      expectedStatus: "Thread needs user input",
      thread: createThread({ hasPendingInteraction: true }),
    },
    {
      label: "unread error",
      expectedStatus: "Unread thread failed",
      thread: createThread({ status: "error" }),
    },
    {
      label: "plugin status",
      expectedStatus: "Plugin improving draft",
      pluginStatus: {
        icon: "AiContentGenerator01" as const,
        label: "Plugin improving draft",
      },
      thread: createThread(),
    },
    {
      label: "collapsed child workflow",
      expectedStatus: "Workflow running",
      options: {
        kind: "parent" as const,
        depth: 1,
        isCompact: false,
        isCollapsed: true,
        childCount: 1,
        childActivity: {
          ...NO_COLLAPSED_CHILD_ACTIVITY,
          workflow: true,
        },
        onToggleCollapsed: vi.fn(),
      },
      thread: createThread(),
    },
  ])(
    "preserves the $label status in the split map accessible name",
    ({ expectedStatus, options, pluginStatus, thread }) => {
      renderSplitThreadRow({ options, pluginStatus, thread });

      expect(
        screen
          .getByRole("img", { name: /open in split/ })
          .getAttribute("aria-label"),
      ).toBe(`Thread — open in split; ${expectedStatus}`);
    },
  );

  it("puts the draft icon in the trailing status slot", () => {
    const { container } = renderThreadRow({
      hasComposerDraft: true,
      thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
    });

    const draftIcon = container.querySelector('[data-icon="Edit"]');
    expect(draftIcon).not.toBeNull();
    expect(
      draftIcon?.closest("[data-sidebar-thread-trailing-indicator]"),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Thread (unsubmitted draft)" }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
    expect(screen.queryByLabelText("Unread thread succeeded")).toBeNull();
  });

  it("replaces the draft icon with a plugin status and restores it without one", () => {
    const withStatus = renderThreadRow({
      hasComposerDraft: true,
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
      },
      thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
    });

    const runningIcon = screen.getByLabelText("Plugin improving draft");
    expect(runningIcon.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(withStatus.container.querySelector('[data-icon="Edit"]')).toBeNull();
    withStatus.unmount();

    const withoutStatus = renderThreadRow({
      hasComposerDraft: true,
      thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
    });
    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
    expect(
      withoutStatus.container.querySelector('[data-icon="Edit"]'),
    ).not.toBeNull();
  });

  it("shows a keyboard shortcut in place of a plugin status", () => {
    renderThreadRow({
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
      },
      shortcutKey: "3",
    });

    expect(screen.getByText("⌘3")).not.toBeNull();
    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
  });

  it("shows a keyboard shortcut in place of a split mini-map", () => {
    renderSplitThreadRow({ shortcutKey: "3" });

    expect(screen.getByText("⌘3")).not.toBeNull();
    expect(screen.queryByRole("img", { name: /open in split/ })).toBeNull();
  });

  it("renders a plugin status with the semantic success tone", () => {
    renderThreadRow({
      hasComposerDraft: true,
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
        tone: "success",
      },
    });

    const runningIcon = screen.getByLabelText("Plugin improving draft");
    expect(runningIcon.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(Array.from(runningIcon.classList)).toContain(
      SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
    );
    expect(Array.from(runningIcon.classList)).not.toContain(
      SIDEBAR_WORKING_STATUS_COLOR_CLASS,
    );
  });

  it("automatically shimmers a plugin status with the running tone", () => {
    renderThreadRow({
      hasComposerDraft: true,
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin running",
        tone: "running",
      },
    });

    const runningIcon = screen.getByLabelText("Plugin running");
    expect(runningIcon.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(Array.from(runningIcon.classList)).toContain("animate-shine-icon");
    expect(Array.from(runningIcon.parentElement?.classList ?? [])).toContain(
      "text-success",
    );
    expect(Array.from(runningIcon.parentElement?.classList ?? [])).toContain(
      "motion-safe:animate-pulse",
    );
  });

  it("renders a static destructive plugin status with the error tone", () => {
    renderThreadRow({
      hasComposerDraft: true,
      pluginStatus: {
        icon: "AlertCircle",
        label: "Plugin failed",
        tone: "error",
      },
    });

    const errorIcon = screen.getByLabelText("Plugin failed");
    expect(errorIcon.getAttribute("data-icon")).toBe("AlertCircle");
    expect(Array.from(errorIcon.classList)).toContain("text-destructive");
    expect(Array.from(errorIcon.classList)).not.toContain("animate-shine-icon");
  });

  it("disables runtime glyph rotation when reduced motion is requested", () => {
    renderThreadRow({
      thread: createThread({ status: "active", runtimeStatus: "active" }),
    });

    const runningIcon = screen.getByLabelText("Thread working");
    expect(runningIcon.getAttribute("data-icon")).toBe("Loading");
    expect(Array.from(runningIcon.classList)).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("keeps the runtime spinner ahead of a plugin status", () => {
    const { container } = renderThreadRow({
      pluginStatus: {
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
      },
      thread: createThread({ status: "active", runtimeStatus: "active" }),
    });

    const runningIcon = screen.getByLabelText("Thread working");
    expect(runningIcon.getAttribute("data-icon")).toBe("Loading");
    expect(Array.from(runningIcon.classList)).toContain("animate-spin");
    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-trailing-indicator]"),
    ).not.toBeNull();
  });

  it.each([true, false] as const)(
    "keeps the working-draft pencil ahead of the runtime spinner when isActive=%s",
    (isActive) => {
      renderThreadRow({
        hasComposerDraft: true,
        isActive,
        thread: createThread({ status: "active", runtimeStatus: "active" }),
      });

      const draftIcon = screen.getByLabelText(
        "Thread working with unsubmitted draft",
      );
      expect(draftIcon.getAttribute("data-icon")).toBe("Edit");
      expect(Array.from(draftIcon.classList)).toContain("animate-shine-icon");
      expect(Array.from(draftIcon.classList)).toContain(
        SIDEBAR_WORKING_STATUS_COLOR_CLASS,
      );
      expect(screen.queryByLabelText("Thread working")).toBeNull();
    },
  );

  it("renders the host title component and labels the row with the resolved display title", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        title: "Compare @thread:thr_mentioned in @project:proj_mentioned",
        titleFallback:
          "Compare @thread:thr_mentioned in @project:proj_mentioned",
        displayTitle: "Compare Mention target in Mention project",
      }),
    });

    expect(
      container.querySelector('[data-thread-title="thr_test"]')?.textContent,
    ).toBe("Compare Mention target in Mention project");
    expect(
      screen.getByRole("link", {
        name: "Open Compare Mention target in Mention project",
      }),
    ).not.toBeNull();
    expect(
      screen.getByTitle("Compare Mention target in Mention project"),
    ).not.toBeNull();
    expect(screen.queryByText(/@thread:thr_mentioned/)).toBeNull();
  });

  it("marks a child from another project with the project name", () => {
    const { container } = renderThreadRow({
      crossProjectId: "proj_other",
      projects: [
        {
          id: "proj_other",
          name: "Web App",
          isPersonal: false,
          href: "/projects/proj_other",
          settingsHref: "/projects/proj_other/settings",
        },
      ],
      thread: createThread({
        parentThreadId: "thr_parent",
        projectId: "proj_other",
      }),
    });

    const marker = container.querySelector(
      "[data-sidebar-thread-cross-project]",
    );
    expect(marker?.getAttribute("aria-label")).toBe("In project Web App");
    expect(marker?.querySelector('[data-icon="FolderExport"]')).not.toBeNull();
    expect(
      marker?.parentElement?.previousElementSibling?.querySelector(
        ".bb-thread-title",
      ),
    ).not.toBeNull();
    expect(
      marker?.closest("[data-sidebar-thread-trailing-indicator]"),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Thread" }).getAttribute("href"),
    ).toBe("/projects/proj_other/threads/thr_test");
  });

  it("falls back to a generic label when the other project is unknown", () => {
    const { container } = renderThreadRow({
      crossProjectId: "proj_unknown",
      thread: createThread({
        parentThreadId: "thr_parent",
        projectId: "proj_unknown",
      }),
    });

    expect(
      container
        .querySelector("[data-sidebar-thread-cross-project]")
        ?.getAttribute("aria-label"),
    ).toBe("In another project");
  });

  it("opens the thread when the cross-project marker is clicked", () => {
    const { container } = renderThreadRow({
      crossProjectId: "proj_other",
      thread: createThread({
        parentThreadId: "thr_parent",
        projectId: "proj_other",
      }),
    });
    const link = screen.getByRole("link", { name: "Open Thread" });
    const onLinkClick = vi.fn();
    link.addEventListener("click", onLinkClick);

    fireEvent.click(
      container.querySelector("[data-sidebar-thread-cross-project]")!,
    );

    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it("omits the cross-project marker for same-project rows", () => {
    const { container } = renderThreadRow({});
    expect(
      container.querySelector("[data-sidebar-thread-cross-project]"),
    ).toBeNull();
  });

  it("uses the circle-question glyph when the thread needs user input", () => {
    renderThreadRow({
      thread: createThread({ hasPendingInteraction: true }),
    });

    expect(
      screen
        .getByLabelText("Thread needs user input")
        .getAttribute("data-icon"),
    ).toBe("CircleQuestion");
  });

  it("clocks a thread with queued work, and drops the clock once it runs", () => {
    const { rerenderThreadRow } = renderThreadRow({
      thread: createThread({
        lastReadAt: 1,
        latestAttentionAt: 1,
        queuedWork: "waiting",
      }),
    });

    expect(
      screen
        .getByLabelText("Thread has a message waiting to send")
        .getAttribute("data-icon"),
    ).toBe("Clock");

    rerenderThreadRow(
      createThread({
        lastReadAt: 1,
        latestAttentionAt: 1,
        queuedWork: "waiting",
        runtimeStatus: "active",
      }),
    );
    expect(
      screen.queryByLabelText("Thread has a message waiting to send"),
    ).toBeNull();
    expect(
      screen.getByLabelText("Thread working").getAttribute("data-icon"),
    ).toBe("Loading");
  });

  it("shows unread success instead of queued work", () => {
    renderThreadRow({
      thread: createThread({
        status: "idle",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
        queuedWork: "waiting",
      }),
    });

    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
    expect(
      screen.queryByLabelText("Thread has a message waiting to send"),
    ).toBeNull();
  });

  it("gives a failed queued row the same glyph a failed thread gets", () => {
    renderThreadRow({
      thread: createThread({
        lastReadAt: 1,
        latestAttentionAt: 1,
        queuedWork: "failed",
      }),
    });
    const queueFailure = screen.getByLabelText("Queued message failed to send");

    cleanup();
    renderThreadRow({
      thread: createThread({
        status: "error",
        lastReadAt: 0,
        latestAttentionAt: 10,
      }),
    });
    const threadFailure = screen.getByLabelText("Unread thread failed");

    expect(queueFailure.getAttribute("data-icon")).toBe("CircleX");
    expect(threadFailure.getAttribute("data-icon")).toBe(
      queueFailure.getAttribute("data-icon"),
    );
    expect(queueFailure.getAttribute("class")).toBe(
      threadFailure.getAttribute("class"),
    );
  });

  it.each([true, false])(
    "reserves a stable action slot beside a parent disclosure (collapsed: %s)",
    (isCollapsed) => {
      const onToggleCollapsed = vi.fn();
      renderThreadRow({
        thread: createThread({
          title: "Nested discussion with enough text to fill the sidebar width",
          displayTitle:
            "Nested discussion with enough text to fill the sidebar width",
        }),
        options: {
          kind: "parent",
          depth: 1,
          isCompact: false,
          isCollapsed,
          childCount: 1,
          childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
          onToggleCollapsed,
        },
      });
      const toggle = screen.getByRole("button", {
        name: /(?:Expand|Collapse) Nested discussion/,
      });
      const titleContainer = toggle.parentElement;
      const link = screen.getByRole("link", {
        name: "Open Nested discussion with enough text to fill the sidebar width",
      });
      const navigationTarget = link.parentElement;
      const titleWrapper = link.nextElementSibling;
      expect(
        titleContainer?.classList.contains("bb-sidebar-hover-actions-inset"),
      ).toBe(false);
      expect(
        titleContainer?.classList.contains(
          "pr-(--bb-sidebar-hover-actions-inset)",
        ),
      ).toBe(true);
      expect(
        titleContainer?.style.getPropertyValue(
          "--bb-sidebar-hover-actions-inset",
        ),
      ).toBe("calc(var(--spacing) * 7.5)");
      expect(
        titleContainer?.classList.contains("[@media(hover:none)]:pr-0"),
      ).toBe(true);
      expect(navigationTarget?.classList.contains("flex-1")).toBe(true);
      expect(titleWrapper?.classList.contains("flex-1")).toBe(false);
      fireEvent.click(toggle);
      expect(onToggleCollapsed).toHaveBeenCalledWith("thr_test");
    },
  );

  it("routes a tap on the bare row through its navigation link", () => {
    renderThreadRow();
    const link = screen.getByRole("link", { name: "Open Thread" });
    const row = link.closest("[data-sidebar-rename-row]");
    expect(row).not.toBeNull();
    const clickLink = vi.spyOn(link, "click");

    fireEvent.click(row!);
    expect(clickLink).toHaveBeenCalledOnce();

    fireEvent.click(row!.querySelector("[data-sidebar-thread-trailing]")!);
    expect(clickLink).toHaveBeenCalledTimes(2);

    fireEvent.click(link);
    expect(clickLink).toHaveBeenCalledTimes(2);
  });

  it("does not route a suppressed drag click on the trailing area", () => {
    renderThreadRow({
      options: {
        ...DEFAULT_OPTIONS,
        consumeClickSuppression: vi.fn(() => true),
      },
    });
    const link = screen.getByRole("link", { name: "Open Thread" });
    const clickLink = vi.spyOn(link, "click");
    const trailing = link
      .closest("[data-sidebar-rename-row]")
      ?.querySelector("[data-sidebar-thread-trailing]");
    expect(trailing).not.toBeNull();

    fireEvent.click(trailing!);
    expect(clickLink).not.toHaveBeenCalled();
  });

  it("keeps the parent-thread disclosure caret visible on mobile", () => {
    renderThreadRow({
      thread: createThread({
        title: "Parent thread",
        displayTitle: "Parent thread",
      }),
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isCollapsed: false,
        childCount: 1,
        childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
        onToggleCollapsed: vi.fn(),
      },
    });

    expect(
      screen
        .getByRole("button", { name: "Collapse Parent thread threads" })
        .getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
  });

  it.each([
    { isCollapsed: true, expectedHoverReveal: false },
    { isCollapsed: false, expectedHoverReveal: true },
  ])(
    "sets parent-thread disclosure hover reveal to $expectedHoverReveal when collapsed is $isCollapsed",
    ({ expectedHoverReveal, isCollapsed }) => {
      renderThreadRow({
        thread: createThread({
          title: "Parent thread",
          displayTitle: "Parent thread",
        }),
        options: {
          kind: "parent",
          depth: 1,
          isCompact: false,
          isCollapsed,
          childCount: 1,
          childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
          onToggleCollapsed: vi.fn(),
        },
      });

      const toggle = screen.getByRole("button", {
        name: `${isCollapsed ? "Expand" : "Collapse"} Parent thread threads`,
      });
      expect(toggle.classList.contains("bb-sidebar-hover-actions")).toBe(
        expectedHoverReveal,
      );
    },
  );

  it("renders a sticky parent tier with its guide line", () => {
    const { container } = renderThreadRow({
      options: {
        kind: "parent",
        depth: 2,
        isCompact: false,
        isCollapsed: false,
        childCount: 1,
        childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
        stickyLevel: 1,
        onToggleCollapsed: vi.fn(),
      },
    });
    const tier = container.querySelector<HTMLElement>(
      '[data-sidebar-sticky-tier="parent"]',
    );
    expect(tier).not.toBeNull();
    expect(
      tier?.style.getPropertyValue("--bb-sidebar-sticky-parent-level"),
    ).toBe("1");
    expect(tier?.style.paddingLeft).toBe("56px");
    expect(tier?.querySelector('[aria-hidden="true"].w-px')).not.toBeNull();
  });

  it("shows its Command shortcut in place of an active indicator", () => {
    renderThreadRow({
      shortcutKey: "3",
      thread: createThread({ status: "active", runtimeStatus: "active" }),
    });

    const shortcut = screen.getByText("⌘3");
    expect(shortcut.className).toContain("px-1.5");
    expect(shortcut.className).toContain("py-1");
    expect(shortcut.className).toContain("opacity-60");
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Open Thread" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+3");
  });

  it("shows runtime work before workflow and background work", () => {
    renderThreadRow({
      thread: createThread({
        activity: activity({
          workflows: 1,
          backgroundAgents: 1,
          backgroundCommands: 1,
        }),
        runtimeStatus: "active",
      }),
    });

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Unread thread failed")).toBeNull();
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
    expect(document.querySelector('[data-icon="Edit"]')).toBeNull();
  });

  it("shows an animated working-colored workflow glyph for an idle thread with an active workflow", () => {
    renderThreadRow({
      thread: createThread({ activity: activity({ workflows: 1 }) }),
    });

    const workflowIcon = screen.getByLabelText("Workflow running");
    const workflowIconClasses = Array.from(workflowIcon.classList);
    expect(workflowIconClasses).toContain("animate-shine-icon");
    expect(workflowIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it.each([
    {
      activityKey: "backgroundAgents" as const,
      label: "Background agent running",
      icon: "UserRoundPlus",
      absent: ["Background command running", "Workflow running"],
    },
    {
      activityKey: "backgroundCommands" as const,
      label: "Background command running",
      icon: "Terminal",
      absent: ["Workflow running", "Agent working"],
    },
    {
      activityKey: "planMode" as const,
      label: "Plan mode active",
      icon: "ListTodo",
      absent: ["Background command running", "Workflow running"],
    },
    {
      activityKey: "goals" as const,
      label: "Goal active",
      icon: "Target",
      absent: ["Plan mode active", "Workflow running"],
    },
  ])(
    "shows an animated $label glyph",
    ({ activityKey, label, icon, absent }) => {
      renderThreadRow({
        thread: createThread({ activity: activity({ [activityKey]: 1 }) }),
      });

      const glyph = screen.getByLabelText(label);
      expect(glyph.getAttribute("data-icon")).toBe(icon);
      expect(Array.from(glyph.classList)).toContain("animate-shine-icon");
      expect(Array.from(glyph.classList)).toContain(
        SIDEBAR_WORKING_STATUS_COLOR_CLASS,
      );
      for (const missing of absent) {
        expect(screen.queryByLabelText(missing)).toBeNull();
      }
    },
  );

  it("shows workflow before background agent and command work", () => {
    renderThreadRow({
      thread: createThread({
        activity: activity({
          workflows: 1,
          backgroundAgents: 1,
          backgroundCommands: 1,
        }),
      }),
    });

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows background agent work before background command work", () => {
    renderThreadRow({
      thread: createThread({
        activity: activity({ backgroundAgents: 1, backgroundCommands: 1 }),
      }),
    });

    expect(screen.getByLabelText("Background agent running")).not.toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it.each([
    { flag: "workflow" as const, label: "Workflow running", icon: "Workflow" },
    {
      flag: "backgroundAgent" as const,
      label: "Background agent running",
      icon: "UserRoundPlus",
    },
    {
      flag: "backgroundCommand" as const,
      label: "Background command running",
      icon: "Terminal",
    },
    { flag: "planMode" as const, label: "Plan mode active", icon: "ListTodo" },
    { flag: "goal" as const, label: "Goal active", icon: "Target" },
  ])(
    "shows the $label glyph for collapsed parent rows with hidden child activity",
    ({ flag, icon, label }) => {
      renderThreadRow({
        thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
        options: {
          kind: "parent",
          depth: 1,
          isCompact: false,
          isCollapsed: true,
          childCount: 1,
          childActivity: {
            ...NO_COLLAPSED_CHILD_ACTIVITY,
            working: true,
            [flag]: true,
          },
          onToggleCollapsed: vi.fn(),
        },
      });

      expect(screen.getByLabelText(label).getAttribute("data-icon")).toBe(icon);
      expect(screen.queryByLabelText("Thread working")).toBeNull();
    },
  );

  it("shows a working draft for collapsed descendants before named work", () => {
    renderThreadRow({
      thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
      hiddenDraftThreadIds: ["thr_hidden_child"],
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isCollapsed: true,
        childCount: 1,
        childActivity: {
          ...NO_COLLAPSED_CHILD_ACTIVITY,
          threadIds: ["thr_hidden_child"],
          working: true,
          planMode: true,
          goal: true,
        },
        onToggleCollapsed: vi.fn(),
      },
    });

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("ignores hidden child activity once the parent is expanded", () => {
    renderThreadRow({
      thread: createThread({ lastReadAt: 1, latestAttentionAt: 1 }),
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isCollapsed: false,
        childCount: 1,
        childActivity: {
          ...NO_COLLAPSED_CHILD_ACTIVITY,
          working: true,
          workflow: true,
        },
        onToggleCollapsed: vi.fn(),
      },
    });

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

  it("switches directly from working to the settled done dot after finishing", () => {
    const thread = createThread({
      status: "active",
      runtimeStatus: "active",
      lastReadAt: 1_000,
      latestAttentionAt: 1_000,
    });
    const { container, rerenderThreadRow } = renderThreadRow({ thread });

    expect(screen.getByLabelText("Thread working")).not.toBeNull();

    rerenderThreadRow({
      ...thread,
      status: "idle",
      runtimeStatus: "idle",
      latestAttentionAt: 2_000,
      isUnread: true,
    });

    expect(container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
  });

  it("edits the row title inline after a double click and commits on Enter", async () => {
    const slot = renderThreadRow({
      sdk: { threads: { update: vi.fn().mockResolvedValue({}) } },
    });

    fireEvent.doubleClick(screen.getByText("Thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input).toHaveProperty("value", "Thread");

    fireEvent.change(input, { target: { value: "Renamed thread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(slot.inspection.sdkCalls).toEqual([
        {
          method: "threads.update",
          args: [{ threadId: "thr_test", title: "Renamed thread" }],
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    });
    expect(screen.getByText("Thread")).not.toBeNull();
  });

  it("navigates instead of renaming when the title is double-tapped on a compact viewport", async () => {
    renderThreadRow({ isCompactViewport: true });
    const link = screen.getByRole("link", { name: "Open Thread" });

    expect(fireEvent.click(link)).toBe(true);
    expect(fireEvent.click(link)).toBe(true);
    fireEvent.doubleClick(screen.getByText("Thread"));
    await act(async () => new Promise(requestAnimationFrame));

    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
  });

  it("does not start a sortable drag while editing the title", async () => {
    const onPointerDown = vi.fn();
    renderThreadRow({
      options: {
        ...DEFAULT_OPTIONS,
        dragBindings: {
          attributes: {
            role: "button",
            tabIndex: 0,
            "aria-disabled": false,
            "aria-pressed": undefined,
            "aria-roledescription": "sortable",
            "aria-describedby": "thread-sortable",
          },
          disabled: false,
          isDragging: false,
          listeners: { onPointerDown },
          setActivatorNodeRef: vi.fn(),
        },
      },
    });

    fireEvent.doubleClick(screen.getByText("Thread"));
    fireEvent.pointerDown(
      await screen.findByRole("textbox", { name: "Thread name" }),
    );

    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("restores the row when a long press opens its menu and still allows deliberate dragging", async () => {
    const onDragStart = vi.fn();
    const thread = createThread();
    function DraggableThread() {
      const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: thread.id,
      });
      return (
        <ThreadRowHarness
          thread={thread}
          options={{
            ...DEFAULT_OPTIONS,
            dragBindings: {
              attributes,
              listeners,
              setActivatorNodeRef: setNodeRef,
              isDragging,
              disabled: false,
            },
          }}
        />
      );
    }
    function Harness() {
      const { dndContextProps } = useSidebarReorderDnd({
        onDragStart,
        onDragEnd: vi.fn(),
        touchSensor: SidebarTouchSensor,
      });
      return (
        <CompactViewportOverrideProvider isCompactViewport>
          <DndContext {...dndContextProps}>
            <DraggableThread />
          </DndContext>
        </CompactViewportOverrideProvider>
      );
    }
    const slot = renderSlot(
      { component: Harness },
      {},
      {
        sidebarThreads: { threads: [thread], projects: [] },
      },
    );
    const link = screen.getByRole("link", { name: "Open Thread" });
    expect(link).toHaveProperty("draggable", false);
    fireEvent.pointerDown(link, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.touchStart(link, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(
      slot.container.querySelector("[data-sidebar-touch-armed=true]"),
    ).not.toBeNull();
    fireEvent.contextMenu(link);
    expect(await screen.findByRole("menu")).not.toBeNull();
    expect(
      slot.container.querySelector("[data-sidebar-touch-armed-chip]"),
    ).toBeNull();
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.touchMove(link, { touches: [{ clientX: 26, clientY: 10 }] });
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));
    expect(
      screen
        .getByTestId("bb-thread-actions-context-menu")
        .getAttribute("data-dragging"),
    ).toBe("true");
    fireEvent.touchEnd(link, { touches: [] });
  });

  it("starts touch reordering from the thread row", () => {
    const onTouchStart = vi.fn();
    renderThreadRow({
      options: {
        ...DEFAULT_OPTIONS,
        dragBindings: {
          attributes: {
            role: "button",
            tabIndex: 0,
            "aria-disabled": false,
            "aria-pressed": undefined,
            "aria-roledescription": "sortable",
            "aria-describedby": "thread-sortable",
          },
          disabled: false,
          isDragging: false,
          listeners: { onTouchStart },
          setActivatorNodeRef: vi.fn(),
        },
      },
    });

    fireEvent.touchStart(screen.getByRole("link", { name: "Open Thread" }));
    expect(onTouchStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Reorder Thread" })).toBeNull();
  });

  it("suppresses the click that follows a drag and drops the suppression afterwards", () => {
    const consumeClickSuppression = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const slot = renderThreadRow({
      options: { ...DEFAULT_OPTIONS, consumeClickSuppression },
    });
    const link = screen.getByRole("link", { name: "Open Thread" });

    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.click(link, { metaKey: true })).toBe(false);
    expect(consumeClickSuppression).toHaveBeenCalledTimes(2);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_test", options: { split: true } },
    ]);
  });

  it("starts a rename from a second click after the row remounts", async () => {
    const thread = createThread();
    const { rerenderThreadRow } = renderThreadRow({ thread });
    const link = screen.getByRole("link", { name: "Open Thread" });

    fireEvent.click(link);
    rerenderThreadRow(thread);
    fireEvent.click(screen.getByRole("link", { name: "Open Thread" }));

    expect(
      await screen.findByRole("textbox", { name: "Thread name" }),
    ).toHaveProperty("value", "Thread");
  });
});
