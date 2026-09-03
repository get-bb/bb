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
import { emptyPromptDraftState } from "@bb/client-core";
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
import type { PaletteNewThreadDraft } from "@/lib/command-palette/palette-thread-search";

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
  archivedRecents: [] as ThreadListEntry[],
  drafts: [] as PaletteNewThreadDraft[],
  searchResponse: undefined as ThreadSearchResponse | undefined,
}));
const openPaneContentInSplitMock = vi.hoisted(() => vi.fn());
const openThreadInSplitMock = vi.hoisted(() => vi.fn());
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

function expectText(
  element: Element | null | undefined,
  text: string,
): void {
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
  useIsCompactViewport: () => false,
}));

vi.mock("@/lib/split-layout/openThreadInSplit", () => ({
  openThreadInSplit: openThreadInSplitMock,
}));

vi.mock("@/lib/split-layout/openPaneContentInSplit", () => ({
  openPaneContentInSplit: openPaneContentInSplitMock,
}));

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => routeNavigateMock,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: () => {
    const draft = modeState.drafts[0]?.draft ?? emptyPromptDraftState();
    return {
      text: draft.text,
      mentions: draft.mentions,
      attachments: draft.attachments,
    };
  },
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useRootComposeProjectId: () => ["project-1", vi.fn()],
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
    useArchivedThreads: () => ({
      data: { pages: [modeState.archivedRecents] },
      isLoading: false,
    }),
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
  modeState.archivedRecents = [];
  modeState.drafts = [];
  modeState.searchResponse = undefined;
  openPaneContentInSplitMock.mockReset();
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

  it("groups resting commands, hides empty plugins, and distinguishes drill-in rows", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const groups = within(commandList()).getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("data-palette-bucket")),
    ).toEqual(["Threads", "Actions"]);
    expect(
      within(commandList()).queryByRole("group", { name: "Plugins" }),
    ).toBeNull();
    for (const [index, label] of ["Threads", "Actions"].entries()) {
      const header = within(groups[index] as HTMLElement).getByText(label, {
        selector: "div",
      });
      for (const className of CHROME_SECTION_LABEL_CLASS.split(" ")) {
        expect(header.classList.contains(className)).toBe(true);
      }
      expectClasses(header, "px-3", "pb-1", "pt-3");
      expectNoClasses(header, "bg-muted/30");
    }
    expectClasses(commandList(), "p-2");
    expectClasses(commandList().parentElement, "overflow-hidden");
    expectClasses(
      screen.getByTestId("command-palette"),
      "max-w-[640px]",
      "overflow-hidden",
      "shadow-lg",
      "sm:rounded-xl",
    );
    expectClasses(
      searchField().closest("[data-palette-input-frame]"),
      "h-10",
      "px-3",
    );
    expectNoClasses(
      searchField().closest("[data-palette-input-frame]"),
      "border",
      "bg-command-palette-search",
      "rounded-md",
      "shadow-xs",
    );
    expectClasses(
      searchField().closest("[data-palette-input-band]"),
      "border-b",
      "bg-background",
      "px-3",
      "py-2",
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
    expectText(rootFooter, "Close");
    expect(rootFooter?.textContent).not.toContain("Select");
    expect(rootFooter?.textContent).not.toContain("Run");
    expectAttribute(rootFooter, "aria-hidden", "true");
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
    expectAttribute(
      searchThreadsRow,
      "data-palette-action-kind",
      "drill-in",
    );
    expectText(searchThreadsRow, "Search threads…");
    expect(
      searchThreadsRow.querySelector('[data-icon="ChevronRight"]'),
    ).toBeNull();
    expect(searchThreadsRow.textContent).toContain("Opens a search view");

    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).toContain("Window and layout");
    expect(actionRows[1]?.textContent).toContain("Workspace");
    for (const row of [...threadRows, ...actionRows]) {
      expect(row.classList.contains("px-3")).toBe(true);
    }
    expect(commandList().querySelector("[data-icon]")).toBeNull();
    expectClasses(threadRows[0], "bg-state-hover", "text-foreground");
    expectAttribute(
      actionRows[0],
      "data-palette-action-kind",
      "terminal",
    );
    expect(
      actionRows[0]?.querySelector('[data-icon="ChevronRight"]'),
    ).toBeNull();

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    expectClasses(searchThreadsRow, "bg-state-hover", "text-foreground");
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
    const modeSelect = screen.getByRole("button", { name: "Threads search" });
    expectAttribute(modeSelect, "aria-pressed", "true");
    expect(modeSelect.querySelector('[data-icon="Search"]')).not.toBeNull();
    expectClasses(modeSelect.parentElement, "bg-state-active");
    expectNoClasses(modeSelect.parentElement, "bg-background/70");
    expectAttribute(
      screen.getByRole("button", { name: "Return to commands" }),
      "data-tab-pill-close",
    );
    const scope = screen.getByRole("button", { name: "Thread scope" });
    expect(scope.textContent).toContain("All");
    expectClasses(scope, "text-subtle-foreground", "opacity-70");
    expectText(screen.getByTestId("command-palette"), "Split");
    const footer = screen
      .getByTestId("command-palette")
      .querySelector("[data-palette-footer]");
    expectClasses(
      footer,
      "flex-wrap",
      "bg-surface-recessed-soft-solid",
      "px-4",
      "py-2",
    );
    expectAttribute(footer, "aria-hidden", "true");
    for (const keycap of footer?.querySelectorAll("kbd") ?? []) {
      expectClasses(
        keycap,
        "rounded-sm",
        "bg-state-hover",
        "font-sans",
        "font-normal",
        "tabular-nums",
        "text-subtle-foreground",
        "opacity-60",
      );
      expectNoClasses(
        keycap,
        "border-border/70",
        "bg-background/70",
        "font-mono",
        "text-muted-foreground",
        "shadow-xs",
      );
    }
    for (const label of
      footer?.querySelectorAll("[data-palette-footer-label]") ?? []) {
      expectClasses(label, "opacity-70");
      expectClasses(
        label.closest("[data-palette-footer]"),
        "text-subtle-foreground",
      );
    }
    expect(footer?.textContent).not.toContain("Backspace");
    expect(footer?.textContent).not.toContain("Select");
    expect(footer?.textContent).not.toContain("Open");
    expectText(footer, "Esc");
    const threadInput = screen.getByRole("combobox", {
      name: "Search threads",
    });
    const threadDescriptionId = threadInput.getAttribute("aria-describedby");
    expect(threadDescriptionId).not.toBeNull();
    expectText(
      document.getElementById(threadDescriptionId ?? ""),
      "Use Command-Enter or Control-Enter to open the selected thread in a split. Use Escape to return to commands.",
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

  it("cycles the thread scope and resets it after leaving the mode", async () => {
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Thread scope" })).toBeTruthy(),
    );
    const scope = screen.getByRole("button", { name: "Thread scope" });
    scope.focus();
    fireEvent.keyDown(scope, { key: "ArrowDown" });
    expect(scope.textContent).toContain("Active");
    expect(
      screen.getByRole("listbox", { name: "Thread scope options" }),
    ).toBeTruthy();
    fireEvent.keyDown(scope, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("combobox"));

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search commands" }),
      ).toBeTruthy(),
    );
    const searchCommand = within(bucketGroup("Threads"))
      .getAllByRole("option")
      .find((row) => row.textContent?.includes("Search threads"));
    fireEvent.click(searchCommand as HTMLElement);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Thread scope" }).textContent,
      ).toContain("All"),
    );
  });

  it("opens the closed thread scope with Enter and returns to the input on the next Enter", async () => {
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    const scope = screen.getByRole("button", { name: "Thread scope" });

    scope.focus();
    fireEvent.keyDown(scope, { key: "Enter" });

    expect(scope.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("listbox", { name: "Thread scope options" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(scope);

    fireEvent.keyDown(scope, { key: "Enter" });

    expect(scope.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("listbox", { name: "Thread scope options" }),
    ).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("keeps the mode clear, input, and scope in a predictable tab sequence and applies every keyboard choice immediately", async () => {
    modeState.searchResponse = {
      active: {
        total: 1,
        results: [{ thread: makeThread("matching-active"), matches: [] }],
      },
      archived: {
        total: 1,
        results: [
          {
            thread: makeThread("matching-archived", {
              archivedAt: Date.now(),
            }),
            matches: [],
          },
        ],
      },
    };
    modeState.drafts = [
      {
        id: "matching-draft",
        title: "matching draft",
        draft: { ...emptyPromptDraftState(), text: "matching draft" },
        lastEditedAt: Date.now(),
        destination: { projectId: "project-1", sectionId: null },
      },
    ];
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    const input = screen.getByRole("combobox", { name: "Search threads" });
    const scope = screen.getByRole("button", { name: "Thread scope" });
    expect(scope.querySelector("[data-icon]")).toBeNull();
    const modeSelect = screen.getByRole("button", { name: "Threads search" });
    const clearMode = screen.getByRole("button", {
      name: "Return to commands",
    });
    const palette = screen.getByTestId("command-palette");
    expect(
      Array.from(
        palette.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ),
    ).toEqual([modeSelect, clearMode, input, scope]);

    fireEvent.change(input, { target: { value: "match" } });
    const results = screen.getByRole("listbox", { name: "Threads" });
    await waitFor(() =>
      expect(within(results).getAllByRole("option")).toHaveLength(3),
    );

    scope.focus();
    fireEvent.keyDown(scope, { key: "ArrowDown" });
    expect(scope.textContent).toContain("Active");
    const scopeOptions = screen.getByRole("listbox", {
      name: "Thread scope options",
    });
    expect(
      within(scopeOptions)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All", "Active", "Drafts", "Archived"]);
    expect(scopeOptions.querySelector("[data-icon]")).toBeNull();
    expect(within(results).getAllByRole("option")).toHaveLength(1);
    expect(within(results).getByRole("option").textContent).toContain(
      "matching-active",
    );
    fireEvent.keyDown(scope, { key: "Enter" });
    expect(document.activeElement).toBe(input);
    expect(
      screen.queryByRole("listbox", { name: "Thread scope options" }),
    ).toBeNull();

    scope.focus();
    fireEvent.keyDown(scope, { key: "ArrowDown" });
    expect(scope.textContent).toContain("Drafts");
    expect(within(results).getAllByRole("option")).toHaveLength(1);
    expect(within(results).getByRole("option").textContent).toContain(
      "matching draft",
    );
    expectText(
      within(results)
        .getByRole("option")
        .querySelector("[data-palette-thread-metadata]"),
      "Palette project · just now",
    );
    fireEvent.keyDown(scope, { key: "Escape" });
    expect(document.activeElement).toBe(input);

    fireEvent.click(within(results).getByRole("option"));
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Thread scope" }).textContent,
      ).toContain("All"),
    );
  });

  it("renders the resting thread mode as one unlabelled active, draft, archived list", async () => {
    modeState.activeRecents = [makeThread("recent-active")];
    modeState.archivedRecents = [
      makeThread("recent-archived", { archivedAt: Date.now() }),
    ];
    modeState.drafts = [
      {
        id: "recent-draft",
        title: "recent draft",
        draft: { ...emptyPromptDraftState(), text: "recent draft" },
        lastEditedAt: Date.now(),
        destination: { projectId: "project-1", sectionId: null },
      },
    ];
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );

    const results = screen.getByRole("listbox", { name: "Threads" });
    await waitFor(() =>
      expect(within(results).getAllByRole("option")).toHaveLength(3),
    );
    const rows = within(results).getAllByRole("option");
    expect(rows[0]?.textContent).toContain("Title recent-active");
    expect(rows[0]?.textContent).not.toContain("Active");
    expect(rows[1]?.textContent).toContain("recent draft");
    expect(rows[1]?.textContent).toContain("Draft");
    expect(rows[2]?.textContent).toContain("Title recent-archived");
    expect(rows[2]?.textContent).toContain("Archived");
    expect(results.querySelector("[data-palette-thread-state]")).toBeNull();
    expect(results.querySelector("[data-icon]")).toBeNull();
    for (const row of rows) {
      expectClasses(
        row.querySelector("[data-palette-thread-metadata]"),
        "text-subtle-foreground",
        "opacity-70",
      );
    }
    expect(
      rows[1]?.querySelector("[data-palette-thread-metadata]")?.textContent,
    ).toBe("Draft · Palette project · just now");
    expect(
      rows[2]?.querySelector("[data-palette-thread-metadata]")?.textContent,
    ).toBe("Archived · Palette project · just now");
    expect(within(results).queryAllByRole("group")).toHaveLength(0);
    expect(within(results).queryByText("Recent")).toBeNull();
  });

  it("renders search matches as one unlabelled active, draft, archived list", async () => {
    const active = makeThread("active", {
      title: "Matching active thread",
      titleFallback: "Matching active thread",
    });
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
    modeState.drafts = [
      {
        id: "draft-1",
        title: "matching draft",
        draft: { ...emptyPromptDraftState(), text: "matching draft" },
        lastEditedAt: Date.now(),
        destination: { projectId: "project-1", sectionId: null },
      },
    ];
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "match" },
    });

    const results = screen.getByRole("listbox", { name: "Threads" });
    await waitFor(() =>
      expect(within(results).getAllByRole("option")).toHaveLength(3),
    );
    const rows = within(results).getAllByRole("option");
    expect(rows[0]?.textContent).toContain("Matching active thread");
    expect(rows[1]?.textContent).toContain("matching draft");
    expect(rows[1]?.textContent).toContain("Draft");
    expect(rows[2]?.textContent).toContain("Title archived");
    expect(rows[2]?.textContent).toContain("Archived");
    expect(rows[0]?.textContent).not.toContain("Active");
    const activeMatch = rows[0]?.querySelector("mark");
    expectText(activeMatch, "Matching");
    expectClasses(
      activeMatch,
      "bg-[var(--sidebar-search-match)]",
      "text-foreground",
    );
    expectClasses(activeMatch?.parentElement, "text-foreground");
    for (const row of rows) {
      expectClasses(
        row.querySelector("[data-palette-thread-metadata]"),
        "text-subtle-foreground",
        "opacity-70",
      );
    }
    expect(
      rows[1]?.querySelector("[data-palette-thread-metadata]")?.textContent,
    ).toBe("Draft · Palette project · just now");
    expect(
      rows[2]?.querySelector("[data-palette-thread-metadata]")?.textContent,
    ).toBe("Archived · Palette project · just now");
    expect(results.querySelector("[data-palette-thread-state]")).toBeNull();
    expect(within(results).queryAllByRole("group")).toHaveLength(0);
    expect(within(results).queryByText("Recent")).toBeNull();
    expect(results.textContent).not.toContain("1/1");
    expect(results.querySelector("svg")).toBeNull();
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

  it("opens the current new-thread draft in a split", async () => {
    modeState.drafts = [
      {
        id: "draft-slot-exact",
        title: "split this draft",
        draft: { ...emptyPromptDraftState(), text: "split this draft" },
        lastEditedAt: Date.now(),
        destination: { projectId: "project-1", sectionId: null },
      },
    ];
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    await screen.findByRole("option", { name: /split this draft/i });

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(openPaneContentInSplitMock).toHaveBeenCalledTimes(1),
    );
    expect(openPaneContentInSplitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { kind: "new-thread" },
        enabled: true,
      }),
    );
    expect(routeNavigateMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary Enter on the current new-thread draft as normal navigation", async () => {
    modeState.drafts = [
      {
        id: "draft-slot-normal",
        title: "open this draft",
        draft: { ...emptyPromptDraftState(), text: "open this draft" },
        lastEditedAt: Date.now(),
        destination: { projectId: "project-1", sectionId: null },
      },
    ];
    renderPalette();
    openThreadSearch();
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    await screen.findByRole("option", { name: /open this draft/i });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(routeNavigateMock).toHaveBeenCalledTimes(1));
    expect(openPaneContentInSplitMock).not.toHaveBeenCalled();
    expect(routeNavigateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        state: expect.objectContaining({ focusPrompt: true }),
      }),
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
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));

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
    setPluginSlotRegistrations("automations", {
      homepageSections: [],
      settingsSections: [],
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
      messageDirectives: [],
      commandPaletteActions: [],
    });
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
    setPluginSlotRegistrations("linear", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
      commandPaletteActions: [
        {
          id: "open-issue",
          title: "Open issue",
          run: () => {
            testState.calls.push("plugin-ran");
          },
        },
      ],
    });
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
