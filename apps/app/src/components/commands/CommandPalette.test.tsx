// @vitest-environment jsdom

import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createStore, Provider } from "jotai";
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
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
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
  showKeyboardHints: true,
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
  threadDraftIds: new Set<string>(),
  searchResponse: undefined as ThreadSearchResponse | undefined,
  recentLoading: false,
  recentError: false,
  searchLoading: false,
}));
const routeNavigateMock = vi.hoisted(() => vi.fn());

function expectClasses(
  element: Element | null | undefined,
  ...classNames: string[]
): void {
  expect(element).toBeTruthy();
  for (const className of classNames) {
    expect(element?.classList.contains(className)).toBe(true);
  }
}

function expectNoClasses(
  element: Element | null | undefined,
  ...classNames: string[]
): void {
  expect(element).toBeTruthy();
  for (const className of classNames) {
    expect(element?.classList.contains(className)).toBe(false);
  }
}

function expectText(element: Element | null | undefined, text: string): void {
  expect(element?.textContent).toContain(text);
}

function expectAttribute(
  element: Element | null | undefined,
  name: string,
  value?: string,
): void {
  expect(element).toBeTruthy();
  if (value === undefined) {
    expect(element?.hasAttribute(name)).toBe(true);
  } else {
    expect(element?.getAttribute(name)).toBe(value);
  }
}

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: testState.showKeyboardHints,
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
          "composer.focus",
          "browser.reload",
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

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => routeNavigateMock,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: (scope: { kind: string; threadId?: string }) =>
    scope.kind === "thread" &&
    modeState.threadDraftIds.has(scope.threadId ?? ""),
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
    isLoading: modeState.recentLoading,
    isError: modeState.recentError,
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
      isLoading: modeState.searchLoading,
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

function renderPalette({ compact = false }: { compact?: boolean } = {}) {
  const store = createStore();
  const result = render(
    <Provider store={store}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
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
            <Handler command="composer.focus" />
            <Handler command="browser.reload" />
            <CommandPalette
              threadId={null}
              projectId={null}
            />
            <LocationProbe />
          </AppCommandProvider>
        </MemoryRouter>
      </CompactViewportOverrideProvider>
    </Provider>,
  );
  screen.getByTestId("origin").focus();
  return { ...result, store };
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
  testState.showKeyboardHints = true;
  testState.plugins.length = 0;
  modeState.activeRecents = [];
  modeState.threadDraftIds.clear();
  modeState.searchResponse = undefined;
  modeState.recentLoading = false;
  modeState.recentError = false;
  modeState.searchLoading = false;
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

  it("groups resting commands, hides empty plugins, and distinguishes drill-in rows", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const groups = within(commandList()).getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("data-palette-bucket")),
    ).toEqual(["Threads", "Actions", "Settings"]);
    expect(
      within(commandList()).queryByRole("group", { name: "Plugins" }),
    ).toBeNull();
    for (const [index, label] of ["Threads", "Actions", "Settings"].entries()) {
      const header = within(groups[index] as HTMLElement).getByText(label, {
        selector: "div",
      });
      for (const className of CHROME_SECTION_LABEL_CLASS.split(" ")) {
        expect(header.classList.contains(className)).toBe(true);
      }
      expectClasses(header, "px-2", "py-1");
      expectNoClasses(header, "bg-muted/30");
    }
    expectClasses(commandList(), "p-1");
    expectClasses(commandList().parentElement, "overflow-hidden");
    expectClasses(
      screen.getByTestId("command-palette"),
      "max-w-[640px]",
      "shadow-lg",
      "sm:rounded-xl",
    );
    expectClasses(searchField().closest("[data-palette-input-frame]"), "h-10");
    expectNoClasses(
      searchField().closest("[data-palette-input-frame]"),
      "border",
      "bg-command-palette-search",
      "rounded-md",
      "shadow-xs",
      "px-3",
    );
    expectClasses(
      searchField().closest("[data-palette-input-band]"),
      "border-b",
      "bg-background",
      "px-3",
      "py-1",
    );
    expectClasses(
      searchField(),
      "placeholder:text-subtle-foreground",
      "placeholder:font-light",
      "placeholder:opacity-70",
    );
    expectClasses(commandList().parentElement, "bg-background");
    expect(
      commandList().querySelectorAll("[data-palette-scroll-sentinel]"),
    ).toHaveLength(2);

    const rootFooter = screen
      .getByTestId("command-palette")
      .querySelector("[data-palette-footer]");
    expect(rootFooter).toBeNull();
    const rootDescriptionId = searchField().getAttribute("aria-describedby");
    expect(rootDescriptionId).not.toBeNull();
    expectText(
      document.getElementById(rootDescriptionId ?? ""),
      "Use Escape to close the command palette.",
    );

    const threadRows = within(bucketGroup("Threads")).getAllByRole("option");
    expect(threadRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New thread"),
      expect.stringContaining("Search threads"),
      expect.stringContaining("Next thread"),
    ]);
    for (const row of threadRows) {
      expect(within(row).queryByText("Threads")).toBeNull();
    }
    const searchThreadsRow = threadRows[1] as HTMLElement;
    expect(searchThreadsRow.querySelector("kbd")).not.toBeNull();
    expectAttribute(searchThreadsRow, "data-palette-action-kind", "drill-in");
    expectText(searchThreadsRow, "Search threads…");
    expect(
      searchThreadsRow.querySelector('[data-icon="ChevronRight"]'),
    ).toBeNull();
    expect(searchThreadsRow.textContent).toContain("Opens a search view");

    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).not.toContain("Window and layout");
    expect(actionRows[1]?.textContent).not.toContain("Workspace");
    expect(actionRows[2]?.textContent).not.toContain("Composer and models");
    expect(actionRows[3]?.textContent).toContain("Browser");
    for (const row of [...threadRows, ...actionRows]) {
      expect(row.classList.contains("px-2")).toBe(true);
    }
    expect(commandList().querySelector("[data-icon]")).toBeNull();
    expectClasses(threadRows[0], "bg-state-hover", "text-foreground");
    expectAttribute(actionRows[0], "data-palette-action-kind", "terminal");
    expect(
      actionRows[0]?.querySelector('[data-icon="ChevronRight"]'),
    ).toBeNull();

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    expectClasses(searchThreadsRow, "bg-state-hover", "text-foreground");
  });

  it("enters the registered thread mode from its existing command and pops one level per Escape", async () => {
    modeState.activeRecents = [makeThread("selected")];
    renderPalette();
    const event = openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    expect(event.defaultPrevented).toBe(true);
    const modeSelect = screen.getByRole("button", { name: "Threads search" });
    expectAttribute(modeSelect, "aria-pressed", "true");
    expect(modeSelect.querySelector('[data-icon="Search"]')).not.toBeNull();
    expectClasses(modeSelect.parentElement, "bg-state-active");
    expectNoClasses(modeSelect.parentElement, "bg-background/70");
    expectAttribute(
      screen.getByRole("button", { name: "Return to commands" }),
      "data-tab-pill-close",
    );
    expect(screen.queryByRole("button", { name: "Thread scope" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open in split" })).toBeNull();
    expect(document.querySelector("[data-palette-footer]")).toBeNull();
    const threadInput = screen.getByRole("combobox", {
      name: "Search threads",
    });
    const threadDescriptionId = threadInput.getAttribute("aria-describedby");
    expect(threadDescriptionId).not.toBeNull();
    expectText(
      document.getElementById(threadDescriptionId ?? ""),
      "Use Escape to return to commands.",
    );

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

  it("uses the shared tab-pill clear affordance without running the mode command", async () => {
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );

    const clearMode = screen.getByRole("button", {
      name: "Return to commands",
    });
    expect(clearMode.querySelector('[data-icon="X"]')).not.toBeNull();
    expectClasses(
      clearMode,
      "opacity-0",
      "group-hover/tab-pill:opacity-100",
      "focus-visible:opacity-100",
    );
    fireEvent.click(clearMode);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search commands" }),
      ).toBeTruthy(),
    );
    expect(testState.calls).toEqual([]);
    const commandsAfterExit = optionTitles();
    expect(commandsAfterExit).toEqual(
      expect.arrayContaining([
        expect.stringContaining("New thread"),
        expect.stringContaining("General settings"),
      ]),
    );
    expect(
      screen
        .getByTestId("command-palette")
        .querySelector("[data-palette-footer]"),
    ).toBeNull();

    const searchCommand = within(bucketGroup("Threads"))
      .getAllByRole("option")
      .find((row) => row.textContent?.includes("Search threads"));
    fireEvent.click(searchCommand as HTMLElement);
    const clearAfterCommand = await screen.findByRole("button", {
      name: "Return to commands",
    });
    fireEvent.click(clearAfterCommand);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search commands" }),
      ).toBeTruthy(),
    );
    expect(testState.calls).toEqual([]);
    fireEvent.keyDown(searchField(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    expect(optionTitles()).toEqual(commandsAfterExit);
  });

  it.each(["", "no match"])(
    "shares the thread-list empty style for query '%s' without a create action",
    async (query) => {
      renderPalette();
      openThreadSearch();
      await screen.findByRole("combobox", { name: "Search threads" });
      fireEvent.change(searchField(), { target: { value: query } });
      const message = await screen.findByText(
        query === "" ? "No threads" : "No matching threads",
      );
      expectClasses(message.parentElement, "justify-center", "px-3", "py-4");
      expectClasses(message, "text-xs", "text-subtle-foreground/60");
      expect(
        message.parentElement?.querySelector('[data-icon="MessageSquare"]'),
      ).not.toBeNull();
      const palette = screen.getByTestId("command-palette");
      expect(within(palette).queryByText("New thread")).toBeNull();
      expect(screen.queryByRole("option")).toBeNull();
      expect(searchField().hasAttribute("aria-activedescendant")).toBe(false);
      expect(palette.querySelector("[data-palette-footer]")).toBeNull();
      fireEvent.keyDown(searchField(), { key: "Enter" });
      fireEvent.keyDown(searchField(), { key: "Enter", metaKey: true });
      fireEvent.keyDown(searchField(), { key: "Enter", ctrlKey: true });
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy();
      expect(testState.calls).toEqual([]);
      expect(routeNavigateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["loading", "Loading threads"],
    ["error", "Couldn’t load threads"],
  ])(
    "does not mistake %s for a genuinely empty account",
    async (state, message) => {
      modeState.recentLoading = state === "loading";
      modeState.recentError = state === "error";
      renderPalette();
      openThreadSearch();
      await screen.findByText(message);
      expect(screen.queryByText("No threads")).toBeNull();
      expect(screen.queryByRole("option")).toBeNull();
      expect(searchField().hasAttribute("aria-activedescendant")).toBe(false);
      expect(
        screen
          .getByTestId("command-palette")
          .querySelector("[data-palette-footer]"),
      ).toBeNull();
    },
  );

  it("explains Escape at the mode exit control without adding a footer hint", async () => {
    renderPalette();
    openThreadSearch();
    const close = await screen.findByRole("button", {
      name: "Return to commands",
    });
    act(() => close.focus());
    expectText(await screen.findByRole("tooltip"), "Return to commands (Esc)");
    expect(document.querySelector("[data-palette-footer]")).toBeNull();
    fireEvent.keyDown(close, { key: "Escape" });
    await screen.findByRole("combobox", { name: "Search commands" });
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

  it("returns from an empty thread query with Backspace", async () => {
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });

    fireEvent.keyDown(input, { key: "Backspace" });

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search commands" }),
      ).toBeTruthy(),
    );
    expect(testState.calls).toEqual([]);
  });

  it("shows active recents in update order with project metadata and follow-up status", async () => {
    modeState.activeRecents = [
      makeThread("older", { updatedAt: Date.now() - 100 }),
      makeThread("newer", { updatedAt: Date.now(), lastReadAt: Date.now() }),
    ];
    modeState.threadDraftIds.add("newer");
    modeState.searchResponse = {
      active: { total: 0, results: [] },
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
    await screen.findByRole("combobox", { name: "Search threads" });
    const results = screen.getByRole("listbox", { name: "Threads" });
    const rows = within(results).getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Title newer"),
      expect.stringContaining("Title older"),
    ]);
    expect(screen.queryByRole("button", { name: "Thread scope" })).toBeNull();
    expect(
      within(rows[0]).getByRole("img", {
        name: "Thread has unsubmitted draft",
      }),
    ).toBeTruthy();
    expect(rows[0].querySelector('[data-icon="Edit"]')).not.toBeNull();
    expect(results.querySelector('[data-icon="Folder"]')).toBeNull();
    expectClasses(results, "p-1");
    expectClasses(within(results).getByText("Recent"), "px-2", "py-1");
    for (const row of rows) {
      const metadata = row.querySelector("[data-palette-thread-metadata]");
      expectText(metadata, "Palette project");
      expectClasses(
        metadata,
        "block",
        "truncate",
        "text-subtle-foreground",
        "opacity-70",
      );
      expectClasses(row, "px-2", "py-1.5", "min-h-11");
    }
  });

  it("preserves title highlights and distinguishes archived matches in the status slot", async () => {
    const active = makeThread("active", { title: "Matching active thread" });
    const archived = makeThread("archived", { archivedAt: Date.now() });
    modeState.searchResponse = {
      active: {
        total: 1,
        results: [
          {
            thread: active,
            matches: [
              {
                sourceKind: "title",
                text: "Matching active thread",
                highlightRanges: [{ start: 0, end: 8 }],
                sourceSeq: null,
              },
            ],
          },
        ],
      },
      archived: { total: 1, results: [{ thread: archived, matches: [] }] },
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
    const match = rows[0].querySelector("mark");
    expectText(match, "Matching");
    expectClasses(match, "bg-[var(--sidebar-search-match)]", "text-foreground");
    expectClasses(match?.parentElement, "text-foreground");
    expect(
      within(rows[1]).getByRole("img", { name: "Archived thread" }),
    ).toBeTruthy();
    expect(rows[1].querySelector('[data-icon="Archive"]')).not.toBeNull();
    expect(
      rows[1].querySelector("[data-palette-thread-metadata]")?.textContent,
    ).toBe("Palette project · just now");
    expect(within(results).queryByText("Recent")).toBeNull();
    expect(
      results.querySelectorAll("[data-palette-thread-status]"),
    ).toHaveLength(2);
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
    expect(
      within(rows[1]).getByRole("img", { name: "Archived thread" }),
    ).toBeTruthy();

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

  it.each(["", "match"])(
    "shows live thread status in the trailing slot for query '%s'",
    async (query) => {
      const threads = [
        makeThread("idle", { lastReadAt: Date.now() }),
        makeThread("working", {
          lastReadAt: Date.now(),
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
        makeThread("draft", { lastReadAt: Date.now() }),
        makeThread("waiting", { hasPendingInteraction: true }),
      ];
      modeState.threadDraftIds.add("draft");
      modeState.activeRecents = threads;
      modeState.searchResponse = {
        active: {
          total: threads.length,
          results: threads.map((thread) => ({ thread, matches: [] })),
        },
        archived: { total: 0, results: [] },
      };
      renderPalette();
      openThreadSearch();
      const input = await screen.findByRole("combobox", {
        name: "Search threads",
      });
      fireEvent.change(input, { target: { value: query } });
      const results = screen.getByRole("listbox", { name: "Threads" });
      await waitFor(() =>
        expect(within(results).getAllByRole("option")).toHaveLength(4),
      );
      for (const [title, label, icon] of [
        ["Title idle", "Active thread", "MessageSquare"],
        ["Title working", "Thread working", "Loading"],
        ["Title draft", "Thread has unsubmitted draft", "Edit"],
        ["Title waiting", "Thread needs user input", "CircleQuestion"],
      ]) {
        const row = within(results).getByRole("option", {
          name: new RegExp(title),
        });
        const status = within(row).getByRole("img", { name: label });
        expect(row.lastElementChild).toBe(status);
        expectClasses(status, "size-4", "shrink-0");
        expect(status.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
        expect(status.hasAttribute("tabindex")).toBe(false);
        expect(row.querySelector('[data-icon="Folder"]')).toBeNull();
        expect(
          row.querySelector("[data-palette-thread-metadata]")?.textContent,
        ).toContain("Palette project");
      }
      expect(within(results).queryByText("Recent") !== null).toBe(query === "");
    },
  );

  it("opens an archived message match with its anchor", async () => {
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
      fireEvent.keyDown(input, { key: "Enter" });

      const state = {
        searchMessageSeq: 42,
        searchThreadId: "archived-message",
      };
      await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
      expect(routeNavigateMock).toHaveBeenCalledWith(
        "/projects/project-1/threads/archived-message",
        { state },
      );
  });

  it("filters as the user types and keeps the selection on a live row", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.change(searchField(), { target: { value: "terminal" } });

    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("Open terminal");
    expect(selectedOption()?.textContent).not.toContain("Workspace");
    expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
  });

  it("keeps hidden categories searchable and browser targets visible", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    for (const [query, title] of [
      ["window and layout", "Toggle panel"],
      ["workspace", "Open terminal"],
      ["composer and models", "Focus composer"],
    ]) {
      fireEvent.change(searchField(), { target: { value: query } });
      await waitFor(() => expect(optionTitles()).toHaveLength(1));
      expect(selectedOption()?.textContent).toContain(title);
      expect(selectedOption()?.textContent?.toLowerCase()).not.toContain(query);
      expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
    }

    fireEvent.change(searchField(), { target: { value: "reload" } });
    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("Reload page");
    expect(selectedOption()?.textContent).toContain("Browser");
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

  it("keeps the default catalog unchanged after running a command", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    const initialTitles = optionTitles();
    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    expect(optionTitles()).toEqual(initialTitles);
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
      renderPalette({ compact });
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

    const pluginSettingsRow = await within(bucketGroup("Settings")).findByRole(
      "option",
      { name: "Linear settings" },
    );
    expect(pluginSettingsRow.textContent).not.toContain("Plugin settings");

    fireEvent.change(searchField(), {
      target: { value: "linear settings" },
    });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Linear settings"),
    );
    expect(selectedOption()?.textContent).not.toContain("Plugin settings");
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

    const pluginPageRow = within(bucketGroup("Plugins")).getByRole("option");
    expect(pluginPageRow.textContent).toBe("Automations");

    fireEvent.change(searchField(), { target: { value: "automations" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Automations"),
    );
    expect(selectedOption()?.textContent).not.toContain("Plugin pages");
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
    expectClasses(screen.getByText("No matching commands"), "px-3", "py-4");
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(testState.calls).toEqual([]);
  });
});
