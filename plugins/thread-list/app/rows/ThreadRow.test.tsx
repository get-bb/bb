// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  PluginProvidersState,
  PluginSidebarProject,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
  type PluginSdkTestFakes,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "../model/thread-activity.js";
import { makeSidebarThread } from "../model/fixtures.js";
import {
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "./sidebarRowClasses.js";
import type { ThreadSectionMoveDestination } from "./ThreadSectionMoveProvider.js";
import type { ThreadRowOptions } from "./ThreadRow.js";

installTestPluginRuntime();
const { ThreadSectionMoveProvider } = await import(
  "./ThreadSectionMoveProvider.js"
);
const { resetSidebarTitleDoubleClickForTest, ThreadRow } = await import(
  "./ThreadRow.js"
);

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
  crossProjectId?: string | null;
  isActive?: boolean;
  options?: ThreadRowOptions;
  onRowEvent?: () => void;
  sectionDestinations?: readonly ThreadSectionMoveDestination[];
}

function ThreadRowHarness({
  thread,
  crossProjectId = null,
  isActive = false,
  options = DEFAULT_OPTIONS,
  onRowEvent,
  sectionDestinations,
}: HarnessProps) {
  const row = (
    <ThreadRow
      projectId={thread.projectId}
      thread={thread}
      crossProjectId={crossProjectId}
      isActive={isActive}
      options={options}
    />
  );
  return (
    <TooltipProvider>
      <div onPointerDown={onRowEvent} onKeyDown={onRowEvent} onClick={onRowEvent}>
        {sectionDestinations ? (
          <ThreadSectionMoveProvider destinations={sectionDestinations}>
            {row}
          </ThreadSectionMoveProvider>
        ) : (
          row
        )}
      </div>
    </TooltipProvider>
  );
}

interface RenderThreadRowArgs extends Omit<HarnessProps, "thread"> {
  thread?: PluginSidebarThread;
  hasComposerDraft?: boolean;
  shortcutKey?: string;
  pluginStatus?: PluginSidebarThreadRowStatus;
  splitLayout?: PluginSidebarSplitLayout;
  projects?: PluginSidebarProject[];
  providers?: Partial<PluginProvidersState>;
  sdk?: PluginSdkTestFakes;
}

function makeProvider(
  id: string,
  displayName: string,
): PluginProvidersState["providers"][number] {
  return {
    id,
    pluginId: `provider-${id}`,
    displayName,
    logoUrl: `/api/v1/system/providers/${id}/logo`,
    available: true,
    maintenance: { health: false, usage: false, installation: false },
    composerActions: [],
    completedTurnDisplay: "collapse",
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
  };
}

function renderThreadRow({
  thread = createThread(),
  hasComposerDraft = false,
  shortcutKey,
  pluginStatus,
  splitLayout,
  projects = [],
  providers,
  sdk,
  ...harness
}: RenderThreadRowArgs = {}): RenderedSlot & {
  rerenderThreadRow(nextThread: PluginSidebarThread): void;
} {
  const slot = renderSlot(
    { component: ThreadRowHarness },
    { thread, ...harness },
    {
      providers,
      sidebarThreads: { threads: [thread], projects },
      sidebarDraftThreadIds: hasComposerDraft ? [thread.id] : [],
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
  fireEvent.pointerDown(screen.getByRole("button", { name: "Thread actions" }), {
    button: 0,
  });
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetSidebarTitleDoubleClickForTest();
});

describe("ThreadRow", () => {
  it("links the row to the thread href and leaves a plain click to the host", () => {
    const slot = renderThreadRow({ thread: createThread({ href: "/projects/proj_test/threads/thr_test" }) });
    const link = screen.getByRole("link", { name: "Open Thread" });
    expect(link.getAttribute("href")).toBe("/projects/proj_test/threads/thr_test");
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_test");
    expect(link.getAttribute("data-sidebar-rename-anchor")).toBe("");
    expect(link.closest("[data-sidebar-rename-row]")).not.toBeNull();
    fireEvent.click(link);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
  ])("opens the thread in a split on %s-click", (_label, modifier) => {
    const slot = renderThreadRow();
    const link = screen.getByRole("link", { name: "Open Thread" });
    const event = fireEvent.click(link, modifier);
    expect(event).toBe(false);
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "open", threadId: "thr_test", options: { split: true } },
    ]);
  });

  it("keeps desktop restore available, hides it on mobile, and blocks row event propagation", async () => {
    const thread = createThread({ archivedAt: 1, isArchived: true });
    const rowEvent = vi.fn();
    const unarchive = vi.fn().mockResolvedValue({ ok: true });
    const slot = renderThreadRow({
      thread,
      onRowEvent: rowEvent,
      sdk: { threads: { unarchive } },
    });
    const restore = screen.getByRole("button", { name: "Unarchive thread" });
    expect(restore.querySelector('[data-icon="ArchiveRestore"]')).toBeTruthy();
    expect(restore.classList.contains("bg-state-hover")).toBe(false);
    expect(restore.classList.contains("bg-state-active")).toBe(false);
    expect(restore.closest("[data-sidebar-hover-actions-open]")).toBeNull();
    expect(restore.closest(".max-md\\:pointer-coarse\\:hidden")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Archive thread" })).toBeNull();
    fireEvent.pointerDown(restore, { pointerType: "touch", button: 0 });
    fireEvent.keyDown(restore, { key: "Enter" });
    fireEvent.click(restore);
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toEqual([
        { method: "threads.unarchive", args: [{ threadId: "thr_test" }] },
      ]),
    );
    expect(rowEvent).not.toHaveBeenCalled();
  });

  it("disables the restore button while its unarchive is in flight and recovers when it fails", async () => {
    const pending = deferred();
    const unarchive = vi.fn().mockReturnValue(pending.promise);
    renderThreadRow({
      thread: createThread({ archivedAt: 1, isArchived: true }),
      sdk: { threads: { unarchive } },
    });
    const restore = screen.getByRole<HTMLButtonElement>("button", {
      name: "Unarchive thread",
    });
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(restore.disabled).toBe(true));
    fireEvent.click(restore);
    expect(unarchive).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error("Unarchive failed"));
      await pending.promise.catch(() => undefined);
    });
    await waitFor(() => expect(restore.disabled).toBe(false));
    fireEvent.click(restore);
    expect(unarchive).toHaveBeenCalledTimes(2);
  });

  it("archives through the host action from the hover control", () => {
    const slot = renderThreadRow();
    fireEvent.click(screen.getByRole("button", { name: "Archive thread" }));
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "archive", threadId: "thr_test" },
    ]);
  });

  it.each([
    { item: "Mark read", thread: createThread(), call: { method: "setRead", threadId: "thr_test", read: true } },
    { item: "Mark unread", thread: createThread({ lastReadAt: 5, latestAttentionAt: 1 }), call: { method: "setRead", threadId: "thr_test", read: false } },
    { item: "Pin", thread: createThread(), call: { method: "setPinned", threadId: "thr_test", pinned: true } },
    { item: "Unpin", thread: createThread({ pinnedAt: 3, isPinned: true }), call: { method: "setPinned", threadId: "thr_test", pinned: false } },
    { item: "Archive", thread: createThread(), call: { method: "archive", threadId: "thr_test" } },
  ])("routes the $item menu item to the host action", async ({ item, thread, call }) => {
    const slot = renderThreadRow({ thread });
    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toEqual([call]),
    );
  });

  it("asks the host to confirm deletion from the menu", async () => {
    const slot = renderThreadRow();
    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "requestDelete", threadId: "thr_test" },
      ]),
    );
  });

  it("opens in a split from the menu and unarchives through the sdk", async () => {
    const unarchive = vi.fn().mockResolvedValue({ ok: true });
    const slot = renderThreadRow({
      thread: createThread({ archivedAt: 1, isArchived: true }),
      sdk: { threads: { unarchive } },
    });
    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in split" }));
    expect(
      slot.inspection.sidebarActionCalls.filter((call) => call.options),
    ).toEqual([
      { method: "open", threadId: "thr_test", options: { split: true } },
    ]);
    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive" }));
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toEqual([
        { method: "threads.unarchive", args: [{ threadId: "thr_test" }] },
      ]),
    );
  });

  it("copies the canonical thread URL built from the href", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderThreadRow({
      thread: createThread({ href: "/projects/proj_test/threads/thr_test" }),
    });
    openActionsMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy thread link" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/projects/proj_test/threads/thr_test`,
      ),
    );
    vi.unstubAllGlobals();
  });

  it("moves the thread to another section through the sdk", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true });
    const slot = renderThreadRow({
      thread: createThread({ sectionId: "sec_planning" }),
      sdk: { threads: { update } },
      sectionDestinations: [
        { label: "Planning", sectionId: "sec_planning" },
        { label: "Building", sectionId: "sec_building" },
        { label: "Threads", sectionId: null },
      ],
    });
    openActionsMenu();
    const trigger = await screen.findByRole("menuitem", { name: "Move to section" });
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    const current = await screen.findByRole("menuitem", { name: "Planning" });
    expect(current.getAttribute("aria-current")).toBe("true");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Building" }));
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toEqual([
        {
          method: "threads.update",
          args: [{ threadId: "thr_test", sectionId: "sec_building" }],
        },
      ]),
    );
  });

  it("unpins before moving a pinned thread and only unpins for its current section", async () => {
    const unpin = vi.fn().mockResolvedValue({ ok: true });
    const update = vi.fn().mockResolvedValue({ ok: true });
    const destinations = [
      { label: "Planning", sectionId: "sec_planning" },
      { label: "Threads", sectionId: null },
    ];
    const slot = renderThreadRow({
      thread: createThread({ sectionId: "sec_planning", pinnedAt: 2, isPinned: true }),
      sdk: { threads: { unpin, update } },
      sectionDestinations: destinations,
    });
    openActionsMenu();
    fireEvent.keyDown(
      await screen.findByRole("menuitem", { name: "Move to section" }),
      { key: "ArrowRight" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Threads" }));
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toEqual([
        { method: "threads.unpin", args: [{ threadId: "thr_test" }] },
        {
          method: "threads.update",
          args: [{ threadId: "thr_test", sectionId: null }],
        },
      ]),
    );
    openActionsMenu();
    fireEvent.keyDown(
      await screen.findByRole("menuitem", { name: "Move to section" }),
      { key: "ArrowRight" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Planning" }));
    await waitFor(() => expect(unpin).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("opens the context menu on right click and starts an inline rename from it", async () => {
    const slot = renderThreadRow();
    fireEvent.contextMenu(screen.getByRole("link", { name: "Open Thread" }));
    const item = await screen.findByRole("menuitem", { name: "Rename" });
    fireEvent.keyDown(item, { key: "Enter" });
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input).toHaveProperty("value", "Thread");
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
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
    expect(container.querySelector(".bb-sidebar-open-in-split-row")).not.toBeNull();
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

  it.each([
    "workflows",
    "backgroundAgents",
    "backgroundCommands",
    "planMode",
    "goals",
  ] as const)("uses the shimmering draft pencil with %s", (activityKey) => {
    renderThreadRow({
      hasComposerDraft: true,
      thread: createThread({ activity: activity({ [activityKey]: 1 }) }),
    });

    const draftIcon = screen.getByLabelText(
      "Thread working with unsubmitted draft",
    );
    expect(Array.from(draftIcon.classList)).toContain("animate-shine-icon");
    expect(Array.from(draftIcon.classList)).toContain(
      SIDEBAR_WORKING_STATUS_COLOR_CLASS,
    );
  });

  it("renders the host title component and labels the row with the resolved display title", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        title: "Compare @thread:thr_mentioned in @project:proj_mentioned",
        titleFallback: "Compare @thread:thr_mentioned in @project:proj_mentioned",
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
      marker?.closest("[data-sidebar-thread-trailing-indicator]"),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Thread" }).getAttribute("href"),
    ).toBe("/projects/proj_other/threads/thr_test");
  });

  it("falls back to a generic label when the other project is unknown", () => {
    const { container } = renderThreadRow({
      crossProjectId: "proj_unknown",
      thread: createThread({ parentThreadId: "thr_parent", projectId: "proj_unknown" }),
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

  it("shows the provider mark and the thread's model under the title", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        providerId: "codex",
        model: "openai-codex/gpt-5.6-sol",
      }),
      providers: {
        providers: [
          makeProvider("codex", "Codex"),
          makeProvider("claude-code", "Claude Code"),
        ],
      },
    });

    const mark = container.querySelector("[data-sidebar-thread-provider]");
    expect(mark).not.toBeNull();
    expect(
      mark
        ?.querySelector("[data-provider-id]")
        ?.getAttribute("data-provider-id"),
    ).toBe("codex");
    expect(
      container.querySelector("[data-sidebar-thread-model]")?.textContent,
    ).toBe("gpt-5.6-sol");
  });

  it("shows the provider mark alone when the thread has no model yet", () => {
    const { container } = renderThreadRow({
      thread: createThread({ providerId: "codex", model: null }),
      providers: { providers: [makeProvider("codex", "Codex")] },
    });

    const mark = container.querySelector("[data-sidebar-thread-provider]");
    expect(mark?.querySelector('[aria-label="Codex"]')).not.toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-model]"),
    ).toBeNull();
  });

  it("treats a missing model as absent instead of crashing the row", () => {
    const { container } = renderThreadRow({
      thread: createThread({ providerId: "codex", model: undefined }),
      providers: { providers: [makeProvider("codex", "Codex")] },
    });

    const mark = container.querySelector("[data-sidebar-thread-provider]");
    expect(mark?.querySelector('[aria-label="Codex"]')).not.toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-model]"),
    ).toBeNull();
  });

  it("shows only the model when the thread's provider is unknown", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        providerId: "codex",
        model: "openai-codex/gpt-5.6-sol",
      }),
      providers: { providers: [makeProvider("claude-code", "Claude Code")] },
    });

    expect(
      container.querySelector("[data-sidebar-thread-provider]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-model]")?.textContent,
    ).toBe("gpt-5.6-sol");
  });

  it("omits the mark when the thread has neither a known provider nor a model", () => {
    const { container } = renderThreadRow({
      thread: createThread({ providerId: "codex", model: null }),
      providers: { providers: [makeProvider("claude-code", "Claude Code")] },
    });

    expect(
      container.querySelector("[data-sidebar-thread-provider]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-model]"),
    ).toBeNull();
  });

  it("opens the thread when the provider mark is clicked", () => {
    const { container } = renderThreadRow({
      thread: createThread({ providerId: "codex" }),
      providers: { providers: [makeProvider("codex", "Codex")] },
    });
    const link = screen.getByRole("link", { name: "Open Thread" });
    const onLinkClick = vi.fn();
    link.addEventListener("click", onLinkClick);

    fireEvent.click(container.querySelector("[data-sidebar-thread-provider]")!);

    expect(onLinkClick).toHaveBeenCalledTimes(1);
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
      expect(titleContainer?.classList.contains("pr-7.5")).toBe(true);
      expect(
        titleContainer?.classList.contains("max-md:pointer-coarse:pr-0"),
      ).toBe(true);
      expect(navigationTarget?.classList.contains("flex-1")).toBe(true);
      expect(titleWrapper?.classList.contains("flex-1")).toBe(false);
      fireEvent.click(toggle);
      expect(onToggleCollapsed).toHaveBeenCalledWith("thr_test");
    },
  );

  it("gives a parent thread's model line the full row width", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        providerId: "codex",
        model: "openai-codex/gpt-5.6-sol",
        title: "Parent thread",
        displayTitle: "Parent thread",
      }),
      providers: { providers: [makeProvider("codex", "Codex")] },
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

    const line = container.querySelector("[data-sidebar-thread-model]")
      ?.parentElement;
    const link = screen.getByRole("link", { name: "Open Parent thread" });
    expect(line?.classList.contains("w-full")).toBe(true);
    expect(line?.classList.contains("pb-1.5")).toBe(true);
    expect(line?.classList.contains("pl-5")).toBe(true);
    expect(line?.parentElement).toBe(link.parentElement);
  });

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
      thread: createThread({ title: "Parent thread", displayTitle: "Parent thread" }),
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
        thread: createThread({ title: "Parent thread", displayTitle: "Parent thread" }),
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
    expect(tier?.style.getPropertyValue("--bb-sidebar-sticky-parent-level")).toBe("1");
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

  it("shows the pending-input glyph while the runtime is still active", () => {
    renderThreadRow({
      thread: createThread({
        hasPendingInteraction: true,
        runtimeStatus: "active",
      }),
    });

    expect(screen.getByLabelText("Thread needs user input")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("shows runtime work before workflow and background work", () => {
    renderThreadRow({
      thread: createThread({
        activity: activity({ workflows: 1, backgroundAgents: 1, backgroundCommands: 1 }),
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
    ["workflows", "Workflow running"],
    ["backgroundAgents", "Background agent running"],
    ["backgroundCommands", "Background command running"],
  ] as const)(
    "shows runtime work before concurrent %s activity",
    (activityKey, secondaryLabel) => {
      renderThreadRow({
        thread: createThread({
          status: "active",
          runtimeStatus: "active",
          activity: activity({ [activityKey]: 1 }),
        }),
      });

      expect(screen.getByLabelText("Thread working")).not.toBeNull();
      expect(screen.queryByLabelText(secondaryLabel)).toBeNull();
    },
  );

  it.each([
    ["planMode", "Plan mode active"],
    ["goals", "Goal active"],
  ] as const)(
    "shows concurrent %s activity before runtime work",
    (activityKey, modeLabel) => {
      renderThreadRow({
        thread: createThread({
          status: "active",
          runtimeStatus: "active",
          activity: activity({ [activityKey]: 1 }),
        }),
      });

      expect(screen.getByLabelText(modeLabel)).not.toBeNull();
      expect(screen.queryByLabelText("Thread working")).toBeNull();
    },
  );

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
  ])("shows an animated $label glyph", ({ activityKey, label, icon, absent }) => {
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
  });

  it("shows workflow before background agent and command work", () => {
    renderThreadRow({
      thread: createThread({
        activity: activity({ workflows: 1, backgroundAgents: 1, backgroundCommands: 1 }),
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

  it("shows Plan before a concurrent Goal", () => {
    renderThreadRow({
      thread: createThread({ activity: activity({ planMode: 1, goals: 1 }) }),
    });

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
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
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isCollapsed: true,
        childCount: 1,
        childActivity: {
          ...NO_COLLAPSED_CHILD_ACTIVITY,
          working: true,
          hasUnsubmittedDraft: true,
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
        childActivity: { ...NO_COLLAPSED_CHILD_ACTIVITY, working: true, workflow: true },
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
    const slot = renderThreadRow();

    fireEvent.doubleClick(screen.getByText("Thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input).toHaveProperty("value", "Thread");

    fireEvent.change(input, { target: { value: "Renamed thread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(slot.inspection.sidebarActionCalls).toEqual([
        { method: "rename", threadId: "thr_test", title: "Renamed thread" },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    });
    expect(screen.getByText("Thread")).not.toBeNull();
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
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "open", threadId: "thr_test", options: { split: true } },
    ]);
  });

  it("cancels an inline row rename on Escape without saving", async () => {
    const slot = renderThreadRow();

    fireEvent.doubleClick(screen.getByText("Thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "Scratch name" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    expect(screen.getByText("Thread")).not.toBeNull();
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
