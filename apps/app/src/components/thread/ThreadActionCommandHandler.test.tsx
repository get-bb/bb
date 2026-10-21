// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type Thread } from "@bb/domain";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  AppCommandProvider,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { THREAD_ACTION_COMMAND_IDS } from "@/lib/thread-actions/thread-action-commands";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
} from "@/lib/thread-actions/thread-action-registry";
import { toThreadActionTarget } from "@/lib/thread-actions/thread-action-target";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { PaneThreadActionCommandHandler } from "@/views/thread-detail/PaneThreadActionCommandHandler";
import { ThreadActionCommandHandler } from "./ThreadActionCommandHandler";
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
const keybindings = vi.hoisted(() => {
  const binding = (
    command:
      | "thread.archive"
      | "thread.markRead"
      | "thread.pin"
      | "thread.rename",
    key: string,
  ) => ({
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
  });
  return [
    binding("thread.archive", "a"),
    binding("thread.markRead", "m"),
    binding("thread.pin", "p"),
    binding("thread.rename", "r"),
  ];
});

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));
vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => hostActions,
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings,
      defaultKeybindings: keybindings,
    },
  }),
}));
vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return makeThread({
    id,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  });
}

const menuThread = thread("thr_menu");
const rowThread = thread("thr_row");
const paneThread = thread("thr_pane");
const defaultRequestRename = vi.fn();
const menuRequestRename = vi.fn();

const focusedPane: PaneContextValue = {
  beginPaneDrag: undefined,
  isBoundedPane: true,
  isFocused: true,
  isMaximized: false,
  isSplitPane: false,
  isTopRow: true,
  navigateInPane: vi.fn(),
  onMoveToSide: undefined,
  onRequestClose: null,
  onToggleMaximize: null,
  ownsWindowTopLeft: true,
  paneId: "pane_main",
  reservesWindowPanelToggle: false,
  secondaryPanelHost: null,
};

const harness: { runner: AppCommandRunner | null } = { runner: null };

function RunnerProbe() {
  const runner = useAppCommandRunner();
  useEffect(() => {
    harness.runner = runner;
  }, [runner]);
  return null;
}

function runner(): AppCommandRunner {
  if (harness.runner === null) throw new Error("runner not mounted");
  return harness.runner;
}

interface HarnessOptions {
  menu?: Thread;
  row?: Thread;
  pane?: Thread | null;
  cached?: readonly Thread[];
}

function renderHandlers({
  menu = menuThread,
  row = rowThread,
  pane = paneThread,
  cached = [menu, row, ...(pane === null ? [] : [pane])],
}: HarnessOptions = {}) {
  const queryClient = new QueryClient();
  for (const entry of cached) {
    queryClient.setQueryData(threadQueryKey(entry.id), entry);
  }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <ThreadActionCollectors
            coreRegistrations={CORE_THREAD_ACTIONS}
            requestRename={defaultRequestRename}
          />
          <AppCommandProvider>
            <RunnerProbe />
            <ThreadActionCommandHandler />
            {pane === null ? null : (
              <PaneContext.Provider value={focusedPane}>
                <PaneThreadActionCommandHandler
                  thread={toThreadActionTarget(pane, null)}
                />
              </PaneContext.Provider>
            )}
            <a href="#row" data-sidebar-thread-id={row.id}>
              Row link
            </a>
            <ThreadActionsMenu
              thread={toThreadActionTarget(menu, null)}
              requestRename={menuRequestRename}
              trigger={(props) => (
                <button {...props} type="button">
                  Thread actions
                </button>
              )}
            />
            <ThreadActionsContextMenu
              thread={toThreadActionTarget(menu, null)}
              requestRename={menuRequestRename}
            >
              <div>Context target</div>
            </ThreadActionsContextMenu>
          </AppCommandProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowLink(): HTMLElement {
  return screen.getByRole("link", { name: "Row link" });
}

function press(target: Element, letter: "A" | "M" | "P" | "R"): boolean {
  return fireEvent.keyDown(target, {
    key: letter,
    code: `Key${letter}`,
    ctrlKey: true,
    shiftKey: true,
  });
}

async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

const MENU_SURFACES = [
  {
    name: "desktop dropdown",
    open: () =>
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Thread actions" }),
        { button: 0 },
      ),
  },
  {
    name: "desktop context menu",
    open: () => fireEvent.contextMenu(screen.getByText("Context target")),
  },
];

beforeEach(() => {
  sdkThreads.pin.mockImplementation(async ({ threadId }) =>
    thread(threadId, { pinnedAt: 9 }),
  );
  sdkThreads.unpin.mockImplementation(async ({ threadId }) =>
    thread(threadId, { pinnedAt: null }),
  );
  sdkThreads.markRead.mockImplementation(async ({ threadId }) =>
    thread(threadId, { lastReadAt: 9 }),
  );
});

afterEach(() => {
  cleanup();
  harness.runner = null;
  resetThreadActionRegistryForTest();
  vi.clearAllMocks();
});

describe("thread action command targeting", () => {
  it.each(MENU_SURFACES)(
    "targets the thread whose $name is open, closes it, then falls back to the row and pane",
    async ({ open }) => {
      renderHandlers();
      open();
      const menu = await screen.findByRole("menu");
      await waitFor(() =>
        expect(menu.contains(document.activeElement)).toBe(true),
      );

      expect(press(document.activeElement ?? menu, "P")).toBe(false);
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(press(rowLink(), "M")).toBe(false);
      expect(press(document.body, "P")).toBe(false);

      await waitFor(() => {
        expect(sdkThreads.pin.mock.calls).toEqual([
          [{ threadId: menuThread.id }],
          [{ threadId: paneThread.id }],
        ]);
        expect(sdkThreads.markRead.mock.calls).toEqual([
          [{ threadId: rowThread.id }],
        ]);
      });
    },
  );

  it.each([
    { cache: "cached", cached: undefined, fetches: false },
    { cache: "uncached", cached: [paneThread], fetches: true },
  ])(
    "targets the focused sidebar row over the pane when the row's thread is $cache",
    async ({ cached, fetches }) => {
      sdkThreads.get.mockResolvedValue(rowThread);
      renderHandlers({ cached });
      const row = rowLink();
      row.focus();

      expect(press(row, "P")).toBe(false);
      expect(press(row, "A")).toBe(false);

      await waitFor(() => {
        expect(sdkThreads.pin.mock.calls).toEqual([
          [{ threadId: rowThread.id }],
        ]);
        expect(
          hostActions.requestArchive.mock.calls.map(
            ([archived]) => archived.id,
          ),
        ).toEqual([rowThread.id]);
      });
      expect(
        new Set(sdkThreads.get.mock.calls.map(([args]) => args.threadId)),
      ).toEqual(new Set(fetches ? [rowThread.id] : []));
    },
  );

  it("declines without a menu, row, or focused pane so the palette hides the commands", () => {
    renderHandlers({ pane: null });

    for (const command of THREAD_ACTION_COMMAND_IDS) {
      expect(runner().isCommandAvailable(command, document.body)).toBe(false);
      expect(runner().dispatch(command, document.body)).toBe(false);
      expect(runner().isCommandAvailable(command, rowLink())).toBe(true);
    }
    expect(press(document.body, "P")).toBe(true);
    expect(sdkThreads.pin).not.toHaveBeenCalled();
  });

  it.each([
    {
      tier: "open menu",
      options: { menu: thread("thr_menu", { archivedAt: 20, pinnedAt: 3 }) },
      target: async () => {
        fireEvent.contextMenu(screen.getByText("Context target"));
        return screen.findByRole("menu");
      },
      threadId: menuThread.id,
    },
    {
      tier: "focused row",
      options: { row: thread("thr_row", { archivedAt: 20, pinnedAt: 3 }) },
      target: async () => rowLink(),
      threadId: rowThread.id,
    },
  ])(
    "keeps archive away from an archived $tier target and the pane behind it, but still toggles its pin",
    async ({ options, target, threadId }) => {
      renderHandlers(options);
      const element = await target();

      expect(runner().isCommandAvailable("thread.archive", element)).toBe(
        false,
      );
      expect(runner().isCommandAvailable("thread.pin", element)).toBe(true);
      expect(press(element, "A")).toBe(true);
      expect(press(element, "P")).toBe(false);

      await waitFor(() =>
        expect(sdkThreads.unpin.mock.calls).toEqual([[{ threadId }]]),
      );
      await settle();
      expect(hostActions.requestArchive).not.toHaveBeenCalled();
      expect(sdkThreads.unarchive).not.toHaveBeenCalled();
    },
  );

  it.each(MENU_SURFACES)(
    "renames the thread whose $name is open with that menu's editor",
    async ({ open }) => {
      renderHandlers();
      open();
      const menu = await screen.findByRole("menu");
      await waitFor(() =>
        expect(menu.contains(document.activeElement)).toBe(true),
      );

      expect(press(document.activeElement ?? menu, "R")).toBe(false);

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(menuRequestRename.mock.calls).toEqual([[menuThread.id]]);
      expect(defaultRequestRename).not.toHaveBeenCalled();
    },
  );

  it("renames the focused sidebar row with bb's rename dialog", async () => {
    renderHandlers();
    const row = rowLink();
    row.focus();

    expect(press(row, "R")).toBe(false);

    await waitFor(() =>
      expect(defaultRequestRename.mock.calls).toEqual([[rowThread.id]]),
    );
    expect(menuRequestRename).not.toHaveBeenCalled();
  });

  it("leaves thread.rename to the thread header when no menu or row is targeted", () => {
    renderHandlers({ pane: null });

    expect(runner().isCommandAvailable("thread.rename", document.body)).toBe(
      false,
    );
    expect(press(document.body, "R")).toBe(true);
    expect(defaultRequestRename).not.toHaveBeenCalled();
    expect(menuRequestRename).not.toHaveBeenCalled();
  });
});
