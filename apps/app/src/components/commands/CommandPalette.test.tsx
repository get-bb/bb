// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppDefaultKeybinding,
  type AppKeybinding,
  type ThreadListEntry,
} from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { CommandPalette } from "./CommandPalette";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const PALETTE_SHORTCUT = {
  key: "p",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: true,
};

const MAIN_SURFACE = { all: ["mainSurface" as const], none: [] };

const PALETTE_BINDING: AppKeybinding = {
  command: "palette.open",
  desktopOnly: false,
  shortcut: PALETTE_SHORTCUT,
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

const THREAD_NEW_BINDING: AppKeybinding = {
  command: "thread.new",
  desktopOnly: false,
  shortcut: {
    key: "o",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: true,
  },
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

const THREAD_SEARCH_BINDING: AppKeybinding = {
  command: "thread.search",
  desktopOnly: false,
  shortcut: {
    key: "k",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

function defaults(...commands: AppCommandId[]): AppDefaultKeybinding[] {
  return commands.map((command) => ({
    command,
    desktopOnly: false,
    shortcut: null,
    when: MAIN_SURFACE,
  }));
}

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  filesAvailable: false,
  plugins: [] as Array<{
    enabled: boolean;
    hasSettings: boolean;
    icon: string | null;
    id: string;
    name: string | null;
  }>,
}));
const modeState = vi.hoisted(() => ({
  activeRecents: [] as ThreadListEntry[],
  compact: false,
  searchResponse: undefined as ThreadSearchResponse | undefined,
}));
const openThreadInSplitMock = vi.hoisted(() => vi.fn());
const routeNavigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: false,
      },
      keybindings: [PALETTE_BINDING, THREAD_NEW_BINDING, THREAD_SEARCH_BINDING],
      defaultKeybindings: [
        PALETTE_BINDING,
        THREAD_SEARCH_BINDING,
        ...defaults(
          "thread.new",
          "thread.next",
          "panel.toggle",
          "terminal.open",
        ),
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({
    accessState: testState.filesAvailable
      ? "permission-required"
      : "unavailable",
  }),
}));

vi.mock("@/lib/app-query-client", () => ({
  appQueryClient: {
    fetchQuery: () => Promise.resolve(testState.plugins),
  },
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => modeState.compact,
}));

vi.mock("@/lib/split-layout/openThreadInSplit", () => ({
  openThreadInSplit: openThreadInSplitMock,
}));

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => routeNavigateMock,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      projects: [
        {
          id: "project-1",
          name: "Palette project",
          threads: modeState.activeRecents,
        },
      ],
      personalProject: { id: "proj_personal", name: "Personal", threads: [] },
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/queries/thread-queries")>();
  return {
    ...actual,
    useThreadSearch: ({ query }: { query: string }) => ({
      data: modeState.searchResponse,
      debouncedQuery: query.trim(),
      hasSearchableQuery: query.trim().length >= 2,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    }),
  };
});

function Handler({ command }: { command: AppCommandId }) {
  useAppCommandHandler(command, () => {
    testState.calls.push(command);
    return true;
  });
  return null;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function makeThread(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    projectId: "project-1",
    environmentId: null,
    providerId: "codex",
    title: `Title ${id}`,
    titleFallback: `Title ${id}`,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: Date.now(),
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentIsWorktree: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    queuedWork: "none",
    ...overrides,
  };
}

function renderPalette({ onSplit }: { onSplit?: () => void } = {}) {
  const result = render(
    <MemoryRouter>
      <AppCommandProvider>
        <button type="button" data-testid="origin">
          origin
        </button>
        <Handler command="thread.new" />
        <Handler command="thread.search" />
        <Handler command="thread.next" />
        <Handler command="panel.toggle" />
        <Handler command="terminal.open" />
        <CommandPalette threadId={null} projectId={null} onSplit={onSplit} />
        <LocationProbe />
      </AppCommandProvider>
    </MemoryRouter>,
  );
  screen.getByTestId("origin").focus();
  return result;
}

function openPalette(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "p",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? window).dispatchEvent(event);
  return event;
}

function openThreadSearch(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? window).dispatchEvent(event);
  return event;
}

const searchField = () => screen.getByRole("combobox");
const commandList = () => screen.getByRole("listbox", { name: "Commands" });
const bucketGroup = (name: string) =>
  within(commandList()).getByRole("group", { name });
const optionTitles = () =>
  screen.getAllByRole("option").map((option) => option.textContent);
const selectedOption = () =>
  screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("linear");
  removePluginSlotRegistrations("automations");
  resetPluginLogoStoreForTest();
  testState.calls.length = 0;
  testState.filesAvailable = false;
  testState.plugins.length = 0;
  modeState.activeRecents = [];
  modeState.compact = false;
  modeState.searchResponse = undefined;
  openThreadInSplitMock.mockReset();
  routeNavigateMock.mockReset();
  window.localStorage.clear();
});

describe("CommandPalette", () => {
  it("opens on its chord and lists the commands that apply", async () => {
    renderPalette();
    const event = openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    expect(event.defaultPrevented).toBe(true);
    const titles = optionTitles();
    expect(titles?.[0]).toContain("New thread");
    expect(titles).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Search threads"),
        expect.stringContaining("General settings"),
        expect.stringContaining("Open terminal"),
      ]),
    );
    expect(titles.length).toBeGreaterThan(5);
  });

  it("groups the resting root into three text buckets with producer metadata", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const groups = within(commandList()).getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("data-palette-bucket")),
    ).toEqual(["Threads", "Actions", "Plugins"]);
    for (const [index, label] of ["Threads", "Actions", "Plugins"].entries()) {
      const header = within(groups[index] as HTMLElement).getByText(label, {
        selector: "div",
      });
      for (const className of CHROME_SECTION_LABEL_CLASS.split(" ")) {
        expect(header.classList.contains(className)).toBe(true);
      }
      expect(header.classList.contains("px-2")).toBe(true);
    }

    const threadRows = within(bucketGroup("Threads")).getAllByRole("option");
    expect(threadRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New thread"),
      expect.stringContaining("Search threads"),
      expect.stringContaining("Next thread"),
    ]);
    for (const row of threadRows) {
      expect(within(row).queryByText("Threads")).toBeNull();
    }
    expect(threadRows[1]?.querySelector("kbd")).not.toBeNull();

    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).toContain("Window and layout");
    expect(actionRows[1]?.textContent).toContain("Workspace");
    for (const row of [...threadRows, ...actionRows]) {
      expect(row.classList.contains("px-2")).toBe(true);
    }
    expect(commandList().querySelector("[data-icon]")).toBeNull();
    expect(
      screen.getByTestId("command-palette").querySelector("svg"),
    ).toBeNull();
  });

  it("enters the registered thread mode from its existing command and pops one level per Escape", async () => {
    renderPalette();
    const event = openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(
      screen.getByText("Threads").closest("[data-palette-mode-chip]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Thread scope" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search commands" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Thread scope" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("enters the same registered mode by running Search threads from the root", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const searchCommand = within(bucketGroup("Threads"))
      .getAllByRole("option")
      .find((row) => row.textContent?.includes("Search threads"));
    expect(searchCommand).toBeDefined();
    fireEvent.click(searchCommand as HTMLElement);

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    expect(testState.calls).toEqual([]);
  });

  it("shows only active recents before typing even with cached archived matches", async () => {
    modeState.activeRecents = [makeThread("recent-active")];
    modeState.searchResponse = {
      active: { total: 0, results: [] },
      archived: {
        total: 1,
        results: [
          {
            thread: makeThread("cached-archived", { archivedAt: Date.now() }),
            matches: [],
          },
        ],
      },
    };
    renderPalette();
    openThreadSearch();
    await screen.findByRole("combobox", { name: "Search threads" });

    const rows = within(
      screen.getByRole("listbox", { name: "Threads" }),
    ).getAllByRole("option");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Title recent-active");
    expect(screen.queryByRole("button", { name: "Thread scope" })).toBeNull();
  });

  it("keeps active and archived search results and restores active recents on clear", async () => {
    modeState.activeRecents = [makeThread("recent-active")];
    modeState.searchResponse = {
      active: {
        total: 1,
        results: [{ thread: makeThread("active"), matches: [] }],
      },
      archived: {
        total: 1,
        results: [
          {
            thread: makeThread("archived", { archivedAt: Date.now() }),
            matches: [],
          },
        ],
      },
    };
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    fireEvent.change(input, { target: { value: "match" } });

    const results = screen.getByRole("listbox", { name: "Threads" });
    const rows = within(results).getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Title active");
    expect(rows[1]?.textContent).toContain("Title archived");
    expect(rows[1]?.textContent).toContain("Archived");

    fireEvent.keyDown(input, { key: "End" });
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.change(input, { target: { value: "" } });
    expect(within(results).getAllByRole("option")).toHaveLength(1);
    expect(within(results).getByRole("option").textContent).toContain(
      "recent-active",
    );
    expect(
      within(results).getByRole("option").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("opens a persisted thread result in a split with Command-Enter", async () => {
    modeState.searchResponse = {
      active: {
        total: 1,
        results: [{ thread: makeThread("matching-split"), matches: [] }],
      },
      archived: { total: 0, results: [] },
    };
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    fireEvent.change(input, { target: { value: "match" } });
    await waitFor(() =>
      expect(screen.getByRole("option").textContent).toContain(
        "matching-split",
      ),
    );

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(openThreadInSplitMock).toHaveBeenCalledTimes(1));
    expect(openThreadInSplitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        threadId: "matching-split",
      }),
    );
  });

  it.each([false, true])(
    "opens an archived message match with its anchor (split=%s)",
    async (split) => {
      modeState.searchResponse = {
        active: { total: 0, results: [] },
        archived: {
          total: 1,
          results: [
            {
              thread: makeThread("archived-message", {
                archivedAt: Date.now(),
              }),
              matches: [
                {
                  sourceKind: "user_message",
                  text: "matching archived message",
                  sourceSeq: 42,
                  highlightRanges: [{ start: 0, end: 8 }],
                },
              ],
            },
          ],
        },
      };
      renderPalette();
      openThreadSearch();
      const input = await screen.findByRole("combobox", {
        name: "Search threads",
      });
      fireEvent.change(input, { target: { value: "matching" } });
      expect(
        screen.getByRole("option").querySelector("mark")?.textContent,
      ).toBe("matching");
      fireEvent.keyDown(input, { key: "Enter", metaKey: split });

      const state = {
        searchMessageSeq: 42,
        searchThreadId: "archived-message",
      };
      await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
      if (split) {
        expect(openThreadInSplitMock).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            threadId: "archived-message",
            state,
          }),
        );
        expect(routeNavigateMock).not.toHaveBeenCalled();
      } else {
        expect(routeNavigateMock).toHaveBeenCalledWith(
          "/projects/project-1/threads/archived-message",
          { state },
        );
        expect(openThreadInSplitMock).not.toHaveBeenCalled();
      }
    },
  );

  it("filters as the user types and keeps the selection on a live row", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.change(searchField(), { target: { value: "terminal" } });

    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("Open terminal");
    expect(selectedOption()?.textContent).toContain("Workspace");
    expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
  });

  it("finds commands when the query starts with a space", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "> new thread" } });

    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("New thread");
  });

  it("wraps at both ends of the list", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    const lastTitle = optionTitles().at(-1);

    fireEvent.keyDown(searchField(), { key: "ArrowUp" });
    expect(selectedOption()?.textContent).toBe(lastTitle);

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    expect(selectedOption()?.textContent).toContain("New thread");
  });

  it.each(["Enter", "ArrowDown", "ArrowUp", "Home", "End"])(
    "leaves %s to an active IME composition",
    async (key) => {
      renderPalette();
      openPalette();
      await waitFor(() => expect(searchField()).toBeTruthy());
      fireEvent.keyDown(searchField(), { key: "ArrowDown" });
      fireEvent.keyDown(searchField(), { key: "ArrowDown" });
      const activeDescendant = searchField().getAttribute(
        "aria-activedescendant",
      );

      fireEvent.compositionStart(searchField());
      const composingKey = new KeyboardEvent("keydown", {
        key,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(searchField(), composingKey);

      expect(composingKey.defaultPrevented).toBe(false);

      expect(screen.getByRole("combobox")).toBeTruthy();
      expect(searchField().getAttribute("aria-activedescendant")).toBe(
        activeDescendant,
      );
      expect(testState.calls).toEqual([]);

      fireEvent.compositionEnd(searchField());
      if (key !== "Enter") {
        const navigation = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        });
        fireEvent(searchField(), navigation);

        expect(navigation.defaultPrevented).toBe(true);
        expect(searchField().getAttribute("aria-activedescendant")).not.toBe(
          activeDescendant,
        );
        expect(testState.calls).toEqual([]);
      }
    },
  );

  it("keeps composition confirmation separate from command activation", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    const input = searchField();
    fireEvent.compositionStart(input);
    const confirmation = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, confirmation);

    expect(confirmation.defaultPrevented).toBe(false);
    expect(screen.queryByRole("combobox")).toBe(input);
    expect(testState.calls).toEqual([]);

    fireEvent.compositionEnd(input);
    const activation = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, activation);

    expect(activation.defaultPrevented).toBe(true);
    await waitFor(() => expect(testState.calls).toEqual(["panel.toggle"]));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("runs the highlighted command, closes, and restores focus", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["panel.toggle"]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("origin"));
  });

  it("runs Split as an internal palette action without an app command", async () => {
    const onSplit = vi.fn();
    renderPalette({ onSplit });
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const splitRow = within(bucketGroup("Actions"))
      .getAllByRole("option")
      .find((row) => row.textContent?.includes("Split"));
    expect(splitRow?.textContent).toContain("Window and layout");

    fireEvent.change(searchField(), { target: { value: "split" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Split"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(onSplit).toHaveBeenCalledOnce());
    expect(testState.calls).toEqual([]);
  });

  it("offers the last command run first within its resting bucket", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).toContain("Toggle panel");
  });

  it("closes on Escape without running anything", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(testState.calls).toEqual([]);
  });

  it("suppresses app chords while open and releases them on close", async () => {
    renderPalette();
    const pressThreadNew = () =>
      fireEvent.keyDown(document.activeElement ?? window, {
        key: "o",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    pressThreadNew();
    expect(testState.calls).toEqual([]);

    fireEvent.keyDown(searchField(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    screen.getByTestId("origin").focus();
    pressThreadNew();
    await waitFor(() => expect(testState.calls).toEqual(["thread.new"]));
  });

  it("scrolls the highlighted row into view when arrowing, but not on hover", async () => {
    const scrollIntoView = vi.spyOn(
      Element.prototype,
      "scrollIntoView",
    ) as unknown as ReturnType<typeof vi.fn>;
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    scrollIntoView.mockClear();

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(selectedOption());
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    fireEvent.keyDown(searchField(), { key: "End" });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));

    scrollIntoView.mockClear();
    fireEvent.pointerMove(screen.getAllByRole("option")[0] as HTMLElement);
    expect(scrollIntoView).not.toHaveBeenCalled();

    scrollIntoView.mockRestore();
  });

  it.each([false, true])(
    "opens Installed plugins in Settings (compact: %s)",
    async (compact) => {
      modeState.compact = compact;
      renderPalette();
      openPalette();
      await waitFor(() => expect(searchField()).toBeTruthy());
      fireEvent.change(searchField(), {
        target: { value: "installed plugins" },
      });
      await waitFor(() =>
        expect(selectedOption()?.textContent).toContain("Installed plugins"),
      );
      fireEvent.keyDown(searchField(), { key: "Enter" });
      await waitFor(() =>
        expect(screen.getByTestId("location").textContent).toBe(
          "/settings/plugins",
        ),
      );
    },
  );

  it("opens a specific settings page", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), {
      target: { value: "keyboard settings" },
    });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Keyboard settings"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/settings/keyboard",
      ),
    );
  });

  it("only includes Files settings when local helper access is available", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), {
      target: { value: "files settings" },
    });
    await waitFor(() =>
      expect(screen.queryAllByRole("option")).toHaveLength(0),
    );

    fireEvent.keyDown(searchField(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    testState.filesAvailable = true;
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    fireEvent.change(searchField(), {
      target: { value: "files settings" },
    });

    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Files settings"),
    );
  });

  it("opens an installed plugin's settings page", async () => {
    testState.plugins.push({
      enabled: true,
      hasSettings: true,
      icon: null,
      id: "linear",
      name: "Linear",
    });
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), {
      target: { value: "linear settings" },
    });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Linear settings"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/settings/plugins/linear",
      ),
    );
  });

  it("opens a plugin page", async () => {
    setPluginSlotRegistrations(
      "automations",
      makePluginRegistrationSet({
        navPanels: [
          {
            id: "automations",
            title: "Automations",
            icon: "Calendar",
            path: "automations",
            component: () => null,
          },
        ],
        threadPanelActions: [],
        sidebarFooterActions: [],
        fileOpeners: [],
      }),
    );
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "automations" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Automations"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/automations/automations",
      ),
    );
  });

  it("lists a plugin's commandPaletteAction and runs it", async () => {
    setPluginLogoUrls(
      new Map([
        [
          "linear",
          {
            displayName: "Linear",
            icon: null,
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    setPluginSlotRegistrations(
      "linear",
      makePluginRegistrationSet({
        commandPaletteActions: [
          {
            id: "open-issue",
            title: "Open issue",
            run: () => {
              testState.calls.push("plugin-ran");
            },
          },
        ],
      }),
    );
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const pluginRow = within(bucketGroup("Plugins")).getByRole("option");
    expect(pluginRow.textContent).toContain("Open issue");
    expect(pluginRow.textContent).toContain("Linear");

    fireEvent.change(searchField(), { target: { value: "linear" } });
    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(optionTitles()?.[0]).toContain("Open issue");
    expect(optionTitles()?.[0]).toContain("Linear");
    expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["plugin-ran"]));
  });

  it("says so when nothing matches", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "zzzzz" } });

    await waitFor(() =>
      expect(screen.getByText("No matching commands")).toBeTruthy(),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(testState.calls).toEqual([]);
  });
});
