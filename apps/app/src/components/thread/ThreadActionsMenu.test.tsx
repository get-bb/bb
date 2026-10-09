// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  experimental_THREAD_ACTION_GROUPS,
  type PluginThreadActionRegistration,
  type PluginThreadActionsInlineItem,
} from "@get-bb/plugin-sdk";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { getThreadRoutePath } from "@/lib/route-paths";
import type { SplitLayout } from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import {
  ThreadActionCollectors,
  ThreadActionSurfaceVisibility,
  resetThreadActionRegistryForTest,
  useThreadActionEntries,
  useThreadActionRegistrationInfos,
} from "@/lib/thread-actions/thread-action-registry";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { usePublishThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";

const hostActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestDelete: vi.fn(),
}));
const sdkThreads = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  unarchive: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));
const copyToClipboardWithToast = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboardWithToast }));
vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => hostActions,
}));

const moveRun = vi.fn();
const moveAction: PluginThreadActionRegistration = {
  id: "move",
  title: "Move to section",
  icon: "SectionMove",
  group: experimental_THREAD_ACTION_GROUPS.organize,
  order: 50,
  item: ({ thread }) =>
    thread.parentThreadId !== null || thread.archivedAt !== null
      ? null
      : {
          label: "Move to section",
          icon: "SectionMove",
          choices: {
            items: [
              { id: "sec_planning", label: "Planning", selected: true },
              { id: "sec_building", label: "Building" },
            ],
          },
          run: moveRun,
        },
};
const pluginGroupRun = vi.fn();
const pluginGroupAction: PluginThreadActionRegistration = {
  id: "notify",
  title: "Notifications",
  icon: "Notification",
  group: "5_plugin",
  item: () => ({
    label: "Notifications",
    icon: "Notification",
    run: pluginGroupRun,
  }),
};

const baseThread = makeThreadListEntry({
  id: "thr_target",
  projectId: "proj_a",
  sectionId: "sec_planning",
  pinnedAt: null,
  archivedAt: null,
  parentThreadId: null,
  lastReadAt: 10,
  latestAttentionAt: 5,
  environmentId: "env_a",
  environmentPath: "/repo",
});

interface SurfaceOptions {
  thread: ThreadListEntry;
  inline?: readonly PluginThreadActionsInlineItem[];
  requestRename?: (threadId: string) => void;
}

interface Surface {
  name: string;
  compact: boolean;
  render(options: SurfaceOptions): ReactElement;
  open(): Promise<void>;
}

const SURFACES: readonly Surface[] = [
  {
    name: "desktop dropdown",
    compact: false,
    render: ({ thread, inline, requestRename }) => (
      <ThreadActionsMenu
        thread={threadListEntryActionTarget(thread)}
        trigger={(props) => (
          <button {...props} type="button">
            Thread actions
          </button>
        )}
        inline={inline}
        requestRename={requestRename}
      />
    ),
    open: async () => {
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Thread actions" }),
        { button: 0 },
      );
    },
  },
  {
    name: "desktop context menu",
    compact: false,
    render: ({ thread, inline, requestRename }) => (
      <ThreadActionsContextMenu
        thread={threadListEntryActionTarget(thread)}
        inline={inline}
        requestRename={requestRename}
      >
        <div>Row</div>
      </ThreadActionsContextMenu>
    ),
    open: async () => {
      fireEvent.contextMenu(screen.getByText("Row"));
    },
  },
  {
    name: "compact drawer",
    compact: true,
    render: ({ thread, inline, requestRename }) => (
      <ThreadActionsMenu
        thread={threadListEntryActionTarget(thread)}
        trigger={(props) => (
          <button {...props} type="button">
            Thread actions
          </button>
        )}
        inline={inline}
        requestRename={requestRename}
      />
    ),
    open: async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
    },
  },
  {
    name: "compact long press",
    compact: true,
    render: ({ thread, inline, requestRename }) => (
      <ThreadActionsContextMenu
        thread={threadListEntryActionTarget(thread)}
        inline={inline}
        requestRename={requestRename}
      >
        <div>Row</div>
      </ThreadActionsContextMenu>
    ),
    open: async () => {
      fireEvent.contextMenu(screen.getByText("Row"));
    },
  },
];

const defaultRequestRename = vi.fn();

function twoPaneLayout(focusedPaneId: string): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          type: "pane",
          paneId: "pane_other",
          content: { kind: "thread", projectId: "proj_a", threadId: "thr_other" },
        },
        {
          type: "pane",
          paneId: "pane_target",
          content: {
            kind: "thread",
            projectId: baseThread.projectId,
            threadId: baseThread.id,
          },
        },
      ],
    },
    focusedPaneId,
  };
}

interface HostState {
  route?: string;
  layout?: SplitLayout | null;
  cached?: boolean;
  threadActions?: readonly PluginThreadActionRegistration[];
}

function renderSurface(
  surface: Surface,
  options: SurfaceOptions,
  {
    route = "/",
    layout = null,
    cached = true,
    threadActions = [],
  }: HostState = {},
) {
  const queryClient = new QueryClient();
  const store = createStore();
  if (layout !== null) store.set(splitLayoutAtom, layout);
  if (cached) {
    queryClient.setQueryData(threadQueryKey(options.thread.id), options.thread);
  }
  setPluginSlotRegistrations(
    "fixture",
    makePluginRegistrationSet({
      threadActions: [moveAction, pluginGroupAction, ...threadActions],
    }),
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>
          <CompactViewportOverrideProvider isCompactViewport={surface.compact}>
            <ThreadActionCollectors
              coreRegistrations={CORE_THREAD_ACTIONS}
              requestRename={defaultRequestRename}
            />
            {surface.render(options)}
          </CompactViewportOverrideProvider>
        </MemoryRouter>
      </Provider>
    </QueryClientProvider>,
  );
}

async function openMenu(): Promise<HTMLElement> {
  return waitFor(() => {
    const menu = screen.queryByRole("menu") ?? screen.queryByRole("dialog");
    if (menu?.querySelector('[role="menuitem"]') == null) {
      throw new Error("no open menu");
    }
    return menu;
  });
}

async function menuRows(): Promise<string[]> {
  const menu = await openMenu();
  return Array.from(
    menu.querySelectorAll('[role="menuitem"], [role="separator"]'),
  )
    .filter(
      (element) =>
        element.parentElement?.closest('[role="menu"], [role="dialog"]') ===
        menu,
    )
    .map((element) =>
      element.getAttribute("role") === "separator"
        ? "---"
        : (element.textContent?.trim() ?? ""),
    );
}

async function choose(surface: Surface, actionLabel: string, choice: string) {
  const trigger = await screen.findByRole("menuitem", { name: actionLabel });
  if (surface.compact) fireEvent.click(trigger);
  else fireEvent.keyDown(trigger, { key: "ArrowRight" });
  fireEvent.click(await screen.findByRole("menuitem", { name: choice }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetPluginSlotStoreForTest();
  resetThreadActionRegistryForTest();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const CUSTOMIZE: PluginThreadActionsInlineItem = {
  key: "surface/customize",
  group: experimental_THREAD_ACTION_GROUPS.settings,
  action: {
    label: "Customize row actions",
    icon: "FilterHorizontal",
    run: vi.fn(),
  },
};

describe.each(SURFACES)("thread actions on the $name", (surface) => {
  it.each([
    {
      state: "a top-level thread",
      thread: baseThread,
      route: "/",
      layout: null,
      desktop: [
        "Open in split",
        "---",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "---",
        "Customize row actions",
        "---",
        "Archive",
        "Delete",
        "---",
        "Notifications",
      ],
      compact: [
        "New thread in environment",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "Customize row actions",
        "Archive",
        "Delete",
        "Notifications",
      ],
    },
    {
      state: "an archived, pinned, unread child thread",
      thread: makeThreadListEntry({
        ...baseThread,
        archivedAt: 20,
        pinnedAt: 3,
        parentThreadId: "thr_parent",
        lastReadAt: 1,
        latestAttentionAt: 5,
        environmentPath: null,
      }),
      route: "/",
      layout: null,
      desktop: [
        "Open in split",
        "---",
        "Copy thread link",
        "Mark read",
        "Unpin",
        "Rename",
        "---",
        "Customize row actions",
        "---",
        "Unarchive",
        "Delete",
        "---",
        "Notifications",
      ],
      compact: [
        "Copy thread link",
        "Mark read",
        "Unpin",
        "Rename",
        "Customize row actions",
        "Unarchive",
        "Delete",
        "Notifications",
      ],
    },
    {
      state: "the thread already in view",
      thread: baseThread,
      route: getThreadRoutePath({
        projectId: baseThread.projectId,
        threadId: baseThread.id,
      }),
      layout: null,
      desktop: [
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "---",
        "Customize row actions",
        "---",
        "Archive",
        "Delete",
        "---",
        "Notifications",
      ],
      compact: [
        "New thread in environment",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "Customize row actions",
        "Archive",
        "Delete",
        "Notifications",
      ],
    },
    {
      state: "a thread open in another split pane",
      thread: baseThread,
      route: getThreadRoutePath({ projectId: "proj_a", threadId: "thr_other" }),
      layout: twoPaneLayout("pane_other"),
      desktop: [
        "Focus split",
        "---",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "---",
        "Customize row actions",
        "---",
        "Archive",
        "Delete",
        "---",
        "Notifications",
      ],
      compact: [
        "New thread in environment",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "Customize row actions",
        "Archive",
        "Delete",
        "Notifications",
      ],
    },
    {
      state: "the thread in the focused split pane",
      thread: baseThread,
      route: getThreadRoutePath({
        projectId: baseThread.projectId,
        threadId: baseThread.id,
      }),
      layout: twoPaneLayout("pane_target"),
      desktop: [
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "---",
        "Customize row actions",
        "---",
        "Archive",
        "Delete",
        "---",
        "Notifications",
      ],
      compact: [
        "New thread in environment",
        "Copy thread link",
        "Mark unread",
        "Pin",
        "Move to section",
        "Rename",
        "Customize row actions",
        "Archive",
        "Delete",
        "Notifications",
      ],
    },
  ])(
    "lists the items for $state",
    async ({ thread, route, layout, desktop, compact }) => {
      renderSurface(surface, { thread, inline: [CUSTOMIZE] }, { route, layout });
      await surface.open();
      expect(await menuRows()).toEqual(surface.compact ? compact : desktop);
    },
  );

  it("runs each action's effect", async () => {
    sdkThreads.pin.mockResolvedValue({ ...baseThread, pinnedAt: 9 });
    sdkThreads.markUnread.mockResolvedValue({
      ...baseThread,
      lastReadAt: null,
    });
    const requestRename = vi.fn();
    renderSurface(surface, { thread: baseThread, requestRename });

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));
    await waitFor(() =>
      expect(sdkThreads.pin).toHaveBeenCalledWith({ threadId: baseThread.id }),
    );

    await surface.open();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Mark unread" }),
    );
    await waitFor(() =>
      expect(sdkThreads.markUnread).toHaveBeenCalledWith({
        threadId: baseThread.id,
      }),
    );

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(requestRename).toHaveBeenCalledWith(baseThread.id);
    expect(defaultRequestRename).not.toHaveBeenCalled();

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(hostActions.requestArchive).toHaveBeenCalledWith(
        expect.objectContaining({ id: baseThread.id }),
      ),
    );

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(hostActions.requestDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: baseThread.id }),
      ),
    );

    await surface.open();
    await choose(surface, "Move to section", "Building");
    expect(moveRun).toHaveBeenCalledWith(
      expect.objectContaining({ value: "sec_building" }),
    );

    await surface.open();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy thread link" }),
    );
    expect(copyToClipboardWithToast).toHaveBeenCalledWith(
      `${window.location.origin}/projects/proj_a/threads/thr_target`,
      {
        successMessage: "Thread link copied",
        errorMessage: "Failed to copy thread link",
      },
    );
  });

  it("falls back to bb's rename dialog when the surface has no editor", async () => {
    renderSurface(surface, { thread: baseThread });
    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(defaultRequestRename).toHaveBeenCalledWith(baseThread.id);
  });

  it("drops a registration whose item throws and keeps the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      makePluginRegistrationSet({
        threadActions: [
          {
            id: "boom",
            title: "Boom",
            icon: "Zap",
            group: "2_organize",
            item: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    );
    renderSurface(surface, { thread: baseThread });
    await surface.open();
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Pin" })).not.toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Boom" })).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});

describe("thread action run containment", () => {
  it("contains a rejected run so the menu keeps working", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    pluginGroupRun.mockRejectedValueOnce(new Error("nope"));
    const [surface] = SURFACES;
    if (surface === undefined) throw new Error("no surface");
    renderSurface(surface, { thread: baseThread });
    await surface.open();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Notifications" }),
      );
    });
    await waitFor(() => expect(error).toHaveBeenCalled());
    await surface.open();
    expect(await screen.findByRole("menuitem", { name: "Pin" })).not.toBeNull();
  });
});

describe("thread actions menu trigger", () => {
  it("reports a trigger that replaces the host's classes", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [surface] = SURFACES;
    if (surface === undefined) throw new Error("no surface");
    renderSurface(
      {
        ...surface,
        render: ({ thread }) => (
          <ThreadActionsMenu
            thread={threadListEntryActionTarget(thread)}
            trigger={(props) => (
              <button {...props} type="button" className="mine">
                Thread actions
              </button>
            )}
          />
        ),
      },
      { thread: baseThread },
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("dropped the host's classes (select-none)"),
    );
  });

  it("keeps the host's classes on a trigger that merges them", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [surface] = SURFACES;
    if (surface === undefined) throw new Error("no surface");
    renderSurface(surface, { thread: baseThread });
    expect(
      screen
        .getByRole("button", { name: "Thread actions" })
        .classList.contains("select-none"),
    ).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a trigger that drops the props and ref it receives", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [surface] = SURFACES;
    if (surface === undefined) throw new Error("no surface");
    renderSurface(
      {
        ...surface,
        render: ({ thread }) => (
          <ThreadActionsMenu
            thread={threadListEntryActionTarget(thread)}
            trigger={() => <button type="button">Thread actions</button>}
          />
        ),
      },
      { thread: baseThread },
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("did not attach the ref"),
    );
  });
});

describe("thread action registrations", () => {
  function RegistrationList() {
    return (
      <ol>
        {useThreadActionRegistrationInfos().map((info) => (
          <li key={info.key}>{info.key}</li>
        ))}
      </ol>
    );
  }

  it("lists every registration in menu order, independent of any thread", () => {
    const [surface] = SURFACES;
    if (surface === undefined) throw new Error("no surface");
    renderSurface(
      { ...surface, render: () => <RegistrationList /> },
      { thread: baseThread },
    );
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "bb--core/split",
      "bb--core/newThreadInEnvironment",
      "bb--core/copyLink",
      "bb--core/read",
      "bb--core/pin",
      "fixture/move",
      "bb--core/rename",
      "bb--core/archive",
      "bb--core/delete",
      "fixture/notify",
    ]);
  });
});

describe("thread actions outside bb's own surfaces", () => {
  const [surface] = SURFACES;
  if (surface === undefined) throw new Error("no surface");

  it("fetches a thread bb has not cached once, then reuses it for later actions", async () => {
    sdkThreads.get.mockResolvedValue(baseThread);
    renderSurface(surface, { thread: baseThread }, { cached: false });

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(hostActions.requestArchive).toHaveBeenCalledWith(
        expect.objectContaining({ id: baseThread.id }),
      ),
    );

    await surface.open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(hostActions.requestDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: baseThread.id }),
      ),
    );
    expect(sdkThreads.get).toHaveBeenCalledTimes(1);
    expect(sdkThreads.get).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: baseThread.id }),
    );
  });

  it("opens a plugin's thread panel in the focused thread view", async () => {
    const opener = vi.fn(() => true);
    const opened = vi.fn();
    function FocusedThreadView() {
      usePublishThreadPanelOpener(opener, true);
      return null;
    }
    render(<FocusedThreadView />);
    renderSurface(
      surface,
      { thread: baseThread },
      {
        threadActions: [
          {
            id: "details",
            title: "Open details",
            icon: "Info",
            group: "5_plugin",
            item: ({ navigate }) => ({
              label: "Open details",
              icon: "Info",
              run: () => {
                opened(navigate.openThreadPanel({ actionId: "details" }));
              },
            }),
          },
        ],
      },
    );

    await surface.open();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open details" }),
    );
    await waitFor(() => expect(opened).toHaveBeenCalledWith(true));
    expect(opener).toHaveBeenCalledWith({
      actionId: "details",
      pluginId: "fixture",
    });
  });
});

describe("thread action data input", () => {
  function Row({ id }: { id: string }) {
    useThreadActionEntries(
      threadListEntryActionTarget({ ...baseThread, id }),
      {},
    );
    return null;
  }

  function renderRecorder() {
    const seen: (readonly string[])[] = [];
    const recorder: PluginThreadActionRegistration<null> = {
      id: "recorder",
      title: "Recorder",
      icon: "Notification",
      group: "5_plugin",
      useData: ({ threadIds }) => {
        if (seen.at(-1) !== threadIds) seen.push(threadIds);
        return null;
      },
      item: () => null,
    };
    setPluginSlotRegistrations(
      "fixture",
      makePluginRegistrationSet({ threadActions: [recorder] }),
    );
    const queryClient = new QueryClient();
    function Surface({
      ids,
      visible = true,
    }: {
      ids: readonly string[];
      visible?: boolean;
    }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ThreadActionCollectors
              coreRegistrations={[]}
              requestRename={defaultRequestRename}
            />
            <ThreadActionSurfaceVisibility visible={visible}>
              {ids.map((id, index) => (
                <Row key={`${id}-${index}`} id={id} />
              ))}
            </ThreadActionSurfaceVisibility>
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    return { seen, Surface };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it("passes the union of subscribed thread ids and drops released ones", async () => {
    const { seen, Surface } = renderRecorder();
    const view = render(<Surface ids={["thr_b", "thr_a", "thr_c", "thr_a"]} />);
    await waitFor(() =>
      expect(seen.at(-1)).toEqual(["thr_a", "thr_b", "thr_c"]),
    );
    view.rerender(<Surface ids={["thr_b", "thr_a"]} />);
    await waitFor(() => expect(seen.at(-1)).toEqual(["thr_a", "thr_b"]));
    view.rerender(<Surface ids={["thr_a", "thr_b"]} />);
    await settle();
    expect(seen).toEqual([[], ["thr_a", "thr_b", "thr_c"], ["thr_a", "thr_b"]]);
  });

  it("coalesces rows that mount a moment apart into one change", async () => {
    const { seen, Surface } = renderRecorder();
    const view = render(<Surface ids={["thr_a", "thr_b"]} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    view.rerender(<Surface ids={["thr_a", "thr_b", "thr_c"]} />);
    await settle();
    expect(seen).toEqual([[], ["thr_a", "thr_b", "thr_c"]]);
  });

  it("counts no ids from a hidden surface until it is shown", async () => {
    const { seen, Surface } = renderRecorder();
    const ids = Array.from({ length: 250 }, (_, index) => `thr_${index}`);
    const view = render(<Surface ids={ids} visible={false} />);
    await settle();
    expect(seen).toEqual([[]]);
    view.rerender(<Surface ids={ids.slice(0, 2)} visible />);
    await waitFor(() => expect(seen.at(-1)).toEqual(["thr_0", "thr_1"]));
  });
});
