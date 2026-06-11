// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createElement, type ReactNode } from "react";
import type {
  AppSearchSuggestion,
  FilePathSearchSuggestion,
  FileSearchSuggestion,
  UseFileSearchSuggestionsArgs,
  UseFileSearchSuggestionsResult,
} from "@/hooks/useFileSearchSuggestions";
import type { AppSummary, BbDesktopInfo } from "@bb/server-contract";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  NewTabActionMenu,
  NewTabFileSearch,
  type NewTabActionMenuProps,
  type NewTabFileSearchProps,
} from "./NewTabFileSearch";
import { getThreadRecentItemsStorageKey } from "./threadRecentItems";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
import type { PromptDraftState } from "@/lib/prompt-draft";

interface ProviderWrapperProps {
  children: ReactNode;
}

interface RenderLauncherArgs {
  projectId?: string;
  environmentId?: string | null;
  currentThreadId?: string;
  onSelect?: NewTabFileSearchProps["onSelect"];
}

interface RenderActionMenuArgs {
  projectId?: string;
  environmentId?: string | null;
  currentThreadId?: string;
  onSelect?: NewTabActionMenuProps["onSelect"];
  onOpenFileSearch?: NewTabActionMenuProps["onOpenFileSearch"];
  onCreateAppPromptPrefill?: NewTabActionMenuProps["onCreateAppPromptPrefill"];
  onOpenBrowser?: NewTabActionMenuProps["onOpenBrowser"];
  onStartTerminal?: NewTabActionMenuProps["onStartTerminal"];
  onCloseMenu?: NewTabActionMenuProps["onCloseMenu"];
}

type FileSearchMockState = UseFileSearchSuggestionsResult;

interface AppsQueryMockState {
  data: AppSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

interface PromptDraftMockState {
  currentDraft: PromptDraftState;
  setDrafts: PromptDraftState[];
}

const fileSearchMockState = vi.hoisted<FileSearchMockState>(() => ({
  suggestions: [],
  isLoading: false,
  appsError: false,
  fileSearchError: false,
  isDebouncing: false,
  isUnavailable: false,
}));

const fileSearchMockArgs = vi.hoisted<UseFileSearchSuggestionsArgs[]>(() => []);

const appsQueryMockState = vi.hoisted<AppsQueryMockState>(() => ({
  data: [],
  isLoading: false,
  isError: false,
}));

const promptDraftMockState = vi.hoisted<PromptDraftMockState>(() => ({
  currentDraft: { text: "", mentions: [], attachments: [] },
  setDrafts: [],
}));

// The launcher's data sources are the only external boundary here; stub them so
// the test focuses on the menu/search split and desktop Browser gating.
vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: (args: UseFileSearchSuggestionsArgs) => {
    fileSearchMockArgs.push(args);
    return fileSearchMockState;
  },
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useApps: () => appsQueryMockState,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: () => ({
    storageKey: "draft-key",
    getCurrent: () => promptDraftMockState.currentDraft,
    setDraft: (draft: PromptDraftState) => {
      promptDraftMockState.setDrafts.push(draft);
    },
  }),
}));

const DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

const APP_SUGGESTION = {
  source: "app",
  entryKind: "app",
  app: {
    applicationId: "status",
    name: "Review Board",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
    source: null,
  },
  applicationId: "status",
  name: "Review Board",
  score: 90,
} satisfies AppSearchSuggestion;

const FILE_SUGGESTION = {
  source: "workspace",
  entryKind: "file",
  path: "src/app.ts",
  name: "app.ts",
  score: 80,
  positions: [],
} satisfies FilePathSearchSuggestion;

const REPORT_FILE_SUGGESTION = {
  source: "workspace",
  entryKind: "file",
  path: "reports/desktop-size.html",
  name: "desktop-size.html",
  score: 80,
  positions: [],
} satisfies FilePathSearchSuggestion;

const DRAFT_WITH_ATTACHMENT = {
  text: "Keep this draft",
  mentions: [],
  attachments: [
    {
      type: "localFile",
      path: "/tmp/spec.md",
      name: "spec.md",
      sizeBytes: 42,
      mimeType: "text/markdown",
    },
  ],
} satisfies PromptDraftState;

function resetFileSearchMockState(): void {
  fileSearchMockState.suggestions = [];
  fileSearchMockState.isLoading = false;
  fileSearchMockState.appsError = false;
  fileSearchMockState.fileSearchError = false;
  fileSearchMockState.isDebouncing = false;
  fileSearchMockState.isUnavailable = false;
  fileSearchMockArgs.length = 0;
}

function resetAppsQueryMockState(): void {
  appsQueryMockState.data = [];
  appsQueryMockState.isLoading = false;
  appsQueryMockState.isError = false;
}

function resetPromptDraftMockState(): void {
  promptDraftMockState.currentDraft = {
    text: "",
    mentions: [],
    attachments: [],
  };
  promptDraftMockState.setDrafts = [];
}

function setAppSummaries(apps: readonly AppSummary[]): void {
  appsQueryMockState.data = [...apps];
}

function setFileSearchSuggestions(
  suggestions: readonly FileSearchSuggestion[],
): void {
  fileSearchMockState.suggestions = [...suggestions];
}

function renderLauncher(args: RenderLauncherArgs = {}) {
  const store = createStore();
  const wrapper = ({ children }: ProviderWrapperProps) =>
    createElement(Provider, { store }, children);
  return render(
    createElement(NewTabFileSearch, {
      projectId: args.projectId ?? "proj_1",
      environmentId: args.environmentId ?? null,
      currentThreadId: args.currentThreadId ?? "thr_1",
      focusRequest: 0,
      onSelect: args.onSelect ?? vi.fn(),
    }),
    { wrapper },
  );
}

function renderActionMenu(args: RenderActionMenuArgs = {}) {
  const store = createStore();
  const wrapper = ({ children }: ProviderWrapperProps) =>
    createElement(Provider, { store }, children);
  return render(
    createElement(NewTabActionMenu, {
      projectId: args.projectId ?? "proj_1",
      environmentId: args.environmentId ?? null,
      currentThreadId: args.currentThreadId ?? "thr_1",
      onSelect: args.onSelect ?? vi.fn(),
      onOpenFileSearch: args.onOpenFileSearch ?? vi.fn(),
      onCreateAppPromptPrefill: args.onCreateAppPromptPrefill,
      onOpenBrowser: args.onOpenBrowser,
      onStartTerminal: args.onStartTerminal,
      onCloseMenu: args.onCloseMenu ?? vi.fn(),
    }),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  localStorage.clear();
  resetFileSearchMockState();
  resetAppsQueryMockState();
  resetPromptDraftMockState();
});

describe("NewTabActionMenu", () => {
  it("does not render the old persistent apps-and-files search input", () => {
    renderActionMenu();

    expect(
      screen.queryByRole("textbox", { name: "Search apps and files" }),
    ).toBeNull();
  });

  it("omits the Apps header when Create App is the only app-related row", () => {
    renderActionMenu();

    expect(screen.getByRole("button", { name: "Create App..." })).toBeTruthy();
    expect(screen.queryByText("Apps")).toBeNull();
  });

  it("shows the Apps header when actual installed app rows are present", () => {
    setAppSummaries([APP_SUGGESTION.app]);

    renderActionMenu();

    expect(screen.getByText("Apps")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review Board/u })).toBeTruthy();
  });

  it("shows Open browser as a headerless action row on the desktop build", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);

    renderActionMenu({ onOpenBrowser: vi.fn() });

    expect(screen.getByRole("button", { name: /Open browser/u })).toBeTruthy();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("orders action rows as Open file, Open browser, Start terminal, Create App with no Apps section when no apps exist", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);

    renderActionMenu({ onOpenBrowser: vi.fn(), onStartTerminal: vi.fn() });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent ?? ""),
    ).toEqual(["Open file", "Open browser", "Start terminal", "Create App..."]);
    // No installed apps ⇒ no divider and no Apps title; Create App still trails.
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText("Apps")).toBeNull();
  });

  it("orders installed apps between the open actions and Create App, with a divider and Apps title", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);
    setAppSummaries([APP_SUGGESTION.app]);

    renderActionMenu({ onOpenBrowser: vi.fn(), onStartTerminal: vi.fn() });

    // Open file, Open browser, Start terminal, the installed app rows, then
    // Create App last.
    expect(
      screen.getAllByRole("button").map((button) => button.textContent ?? ""),
    ).toEqual([
      "Open file",
      "Open browser",
      "Start terminal",
      expect.stringContaining("Review Board"),
      "Create App...",
    ]);

    // Apps get their own divided, titled section after the open actions.
    const divider = screen.getByRole("separator");
    const appsTitle = screen.getByText("Apps");
    expect(appsTitle.parentElement?.className).toContain(
      CHROME_SECTION_LABEL_CLASS,
    );
    expect(divider.className).toContain("mx-2");
    expect(divider.className).toContain("w-auto");
    expect(divider.className).toContain("bg-border-seam");
    const startTerminal = screen.getByRole("button", {
      name: /Start terminal/u,
    });
    const appRow = screen.getByRole("button", { name: /Review Board/u });
    const orderedAfter = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Divider follows Start terminal; the Apps title follows the divider; the
    // app row follows the title.
    expect(orderedAfter(startTerminal, divider)).toBe(true);
    expect(orderedAfter(divider, appsTitle)).toBe(true);
    expect(orderedAfter(appsTitle, appRow)).toBe(true);
  });

  it("keeps Create App last while apps are loading", () => {
    appsQueryMockState.isLoading = true;
    appsQueryMockState.data = undefined;

    renderActionMenu();

    const menu = screen.getByTestId("new-tab-action-menu");
    const createApp = screen.getByRole("button", { name: "Create App..." });
    const status = screen.getByText("Loading apps...");

    // The loading notice renders above Create App, never after it, so Create
    // App stays visually last in the loading state.
    expect(
      Boolean(
        status.compareDocumentPosition(createApp) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        createApp.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(false);
    expect(within(menu).getAllByRole("button").at(-1)).toBe(createApp);
  });

  it("keeps Create App last when apps fail to load", () => {
    appsQueryMockState.isError = true;
    appsQueryMockState.data = undefined;

    renderActionMenu();

    const menu = screen.getByTestId("new-tab-action-menu");
    const createApp = screen.getByRole("button", { name: "Create App..." });
    const status = screen.getByText("Couldn't load apps.");

    // The error notice renders above Create App, never after it, so Create App
    // stays visually last in the error state.
    expect(
      Boolean(
        status.compareDocumentPosition(createApp) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        createApp.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(false);
    expect(within(menu).getAllByRole("button").at(-1)).toBe(createApp);
  });

  it("keeps menu actions compact with native button semantics and non-ring focus", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);

    renderActionMenu({ onOpenBrowser: vi.fn() });

    const menu = screen.getByTestId("new-tab-action-menu");
    expect(within(menu).queryByText(/Describe an idea/u)).toBeNull();
    expect(within(menu).queryByText(/Open a new web browser tab/u)).toBeNull();
    expect(
      within(menu).queryByText(/Search workspace and thread files/u),
    ).toBeNull();
    expect(within(menu).queryAllByRole("option")).toHaveLength(0);
    for (const button of within(menu).getAllByRole("button")) {
      expect(button.getAttribute("aria-selected")).toBeNull();
      expect(button.className).not.toContain("focus-visible:ring");
      // No row carries the active/selected highlight at rest — opening the menu
      // must not leave the first action looking hovered/selected by default —
      // while the non-ring keyboard-focus cue stays in place.
      expect(button.className).not.toContain("bg-state-active");
      expect(button.className).toContain("focus-visible:bg-state-hover");
    }
  });

  it("hides the Open browser entry on the web build", () => {
    renderActionMenu({ onOpenBrowser: vi.fn() });

    expect(screen.queryByText("Open browser")).toBeNull();
  });

  it("closes the popout before opening file search", () => {
    const calls: string[] = [];
    renderActionMenu({
      onCloseMenu: () => calls.push("close"),
      onOpenFileSearch: () => calls.push("open-file"),
    });

    fireEvent.click(screen.getByRole("button", { name: /Open file/u }));

    expect(calls).toEqual(["close", "open-file"]);
  });

  it("closes the popout before opening the browser", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);
    const calls: string[] = [];
    renderActionMenu({
      onCloseMenu: () => calls.push("close"),
      onOpenBrowser: () => calls.push("open-browser"),
    });

    fireEvent.click(screen.getByRole("button", { name: /Open browser/u }));

    expect(calls).toEqual(["close", "open-browser"]);
  });

  it("closes the popout before starting a terminal", () => {
    const calls: string[] = [];
    renderActionMenu({
      onCloseMenu: () => calls.push("close"),
      onStartTerminal: () => calls.push("start-terminal"),
    });

    fireEvent.click(screen.getByRole("button", { name: /Start terminal/u }));

    expect(calls).toEqual(["close", "start-terminal"]);
  });

  it("closes the popout before starting Create App", () => {
    const calls: string[] = [];
    renderActionMenu({
      onCloseMenu: () => calls.push("close"),
      onCreateAppPromptPrefill: () => calls.push("create-app"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Create App..." }));

    expect(calls).toEqual(["close", "create-app"]);
    expect(promptDraftMockState.setDrafts).toEqual([
      {
        text: expect.stringContaining("You are creating a new global bb app."),
        mentions: [],
        attachments: [],
      },
    ]);
  });

  it("leaves a non-empty composer draft unchanged when Create App replacement is canceled", () => {
    promptDraftMockState.currentDraft = DRAFT_WITH_ATTACHMENT;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onCreateAppPromptPrefill = vi.fn();

    renderActionMenu({ onCreateAppPromptPrefill });

    fireEvent.click(screen.getByRole("button", { name: "Create App..." }));

    expect(promptDraftMockState.setDrafts).toEqual([]);
    expect(onCreateAppPromptPrefill).not.toHaveBeenCalled();
  });
});

describe("NewTabFileSearch", () => {
  it("keeps app rows out of file search", () => {
    setFileSearchSuggestions([APP_SUGGESTION, FILE_SUGGESTION]);

    renderLauncher();

    expect(screen.queryByRole("option", { name: /Review Board/u })).toBeNull();
    expect(screen.getByRole("option", { name: /app\.ts/u })).toBeTruthy();
    expect(screen.queryByText("Apps")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Back to new tab menu" }),
    ).toBeNull();
  });

  it("wires the search box to a single combobox listbox that holds the active option", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher();

    const input = screen.getByRole("combobox", { name: "Search files" });
    // Exactly one listbox: the combobox controls a single popup spanning the
    // Files and Recent groups, so its active descendant always resolves within
    // the one controlled element rather than a detached or ambiguous listbox.
    const listboxes = screen.getAllByRole("listbox");
    expect(listboxes).toHaveLength(1);
    const listbox = listboxes[0];
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(
      within(listbox)
        .getAllByRole("option")
        .some((option) => option.id === activeId),
    ).toBe(true);
  });

  it("groups Files and Recent as labelled option groups inside the one listbox", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher();

    const listbox = screen.getByRole("listbox", {
      name: "File search results",
    });
    const filesGroup = within(listbox).getByRole("group", { name: "Files" });
    expect(
      within(filesGroup).getByRole("option", { name: /app\.ts/u }),
    ).toBeTruthy();
  });

  it("uses the same path visual for file results and recent rows", () => {
    const currentThreadId = "thr_icon_consistency";
    localStorage.setItem(
      getThreadRecentItemsStorageKey({ threadId: currentThreadId }),
      JSON.stringify([
        {
          source: "thread-storage",
          path: REPORT_FILE_SUGGESTION.path,
          openedAt: 1,
        },
      ]),
    );
    setFileSearchSuggestions([REPORT_FILE_SUGGESTION]);

    renderLauncher({ currentThreadId });

    const listbox = screen.getByRole("listbox", {
      name: "File search results",
    });
    const filesGroup = within(listbox).getByRole("group", { name: "Files" });
    const recentGroup = within(listbox).getByRole("group", { name: "Recent" });
    const fileRow = within(filesGroup).getByRole("option", {
      name: /desktop-size\.html/u,
    });
    const recentRow = within(recentGroup).getByRole("option", {
      name: /desktop-size\.html/u,
    });

    expect(fileRow.querySelector("[data-icon='ChartColumn']")).not.toBeNull();
    expect(recentRow.querySelector("[data-icon='ChartColumn']")).not.toBeNull();
    expect(within(recentRow).queryByText("Report")).toBeNull();
    expect(recentRow.textContent ?? "").not.toContain(String.fromCharCode(183));
  });

  it("surfaces workspace files for a projectless thread that has an environment", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({ projectId: PERSONAL_PROJECT_ID, environmentId: "env_1" });

    // The component forwards project and environment ids verbatim; the source
    // decision (search the environment workspace, not the personal "project")
    // lives in usePathSuggestions.
    expect(fileSearchMockArgs.at(-1)?.projectId).toBe(PERSONAL_PROJECT_ID);
    expect(fileSearchMockArgs.at(-1)?.environmentId).toBe("env_1");
    expect(screen.getByRole("option", { name: /app\.ts/u })).toBeTruthy();
  });

  it("hides workspace files for a projectless thread without an environment", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({ projectId: PERSONAL_PROJECT_ID, environmentId: null });

    // No project source and no environment ⇒ no workspace to search, so
    // workspace suggestions are filtered out of the results.
    expect(screen.queryByRole("option", { name: /app\.ts/u })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Search files" }),
    ).toHaveProperty("disabled", false);
  });
});
