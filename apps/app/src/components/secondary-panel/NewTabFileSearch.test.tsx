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
  FilePathSearchSuggestion,
  FileSearchSuggestion,
  UseFileSearchSuggestionsArgs,
  UseFileSearchSuggestionsResult,
} from "@/hooks/useFileSearchSuggestions";
import type { BbDesktopInfo } from "@bb/server-contract";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  NewTabActions,
  NewTabFileSearch,
  type NewTabActionsProps,
  type NewTabFileSearchProps,
} from "./NewTabFileSearch";
import { getThreadRecentItemsStorageKey } from "./threadRecentItems";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";

interface ProviderWrapperProps {
  children: ReactNode;
}

interface RenderLauncherArgs {
  projectId?: string;
  environmentId?: string | null;
  currentThreadId?: string;
  initialQuery?: string;
  onSelect?: NewTabFileSearchProps["onSelect"];
}

interface RenderActionsArgs {
  onOpenBrowser?: NewTabActionsProps["onOpenBrowser"];
  onStartTerminal?: NewTabActionsProps["onStartTerminal"];
}

type FileSearchMockState = UseFileSearchSuggestionsResult;

const fileSearchMockState = vi.hoisted<FileSearchMockState>(() => ({
  suggestions: [],
  isLoading: false,
  fileSearchError: false,
  isDebouncing: false,
  isUnavailable: false,
}));

const fileSearchMockArgs = vi.hoisted<UseFileSearchSuggestionsArgs[]>(() => []);

// The launcher's data sources are the only external boundary here; stub them so
// the test focuses on the menu/search split and desktop Browser gating.
vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: (args: UseFileSearchSuggestionsArgs) => {
    fileSearchMockArgs.push(args);
    return fileSearchMockState;
  },
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

function resetFileSearchMockState(): void {
  fileSearchMockState.suggestions = [];
  fileSearchMockState.isLoading = false;
  fileSearchMockState.fileSearchError = false;
  fileSearchMockState.isDebouncing = false;
  fileSearchMockState.isUnavailable = false;
  fileSearchMockArgs.length = 0;
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
      initialQuery: args.initialQuery,
      onSelect: args.onSelect ?? vi.fn(),
    }),
    { wrapper },
  );
}

function renderActions(args: RenderActionsArgs = {}) {
  const store = createStore();
  const wrapper = ({ children }: ProviderWrapperProps) =>
    createElement(Provider, { store }, children);
  return render(
    createElement(NewTabActions, {
      onOpenBrowser: args.onOpenBrowser,
      onStartTerminal: args.onStartTerminal,
    }),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  localStorage.clear();
  resetFileSearchMockState();
});

describe("NewTabActions", () => {
  it("does not render the old persistent search input", () => {
    renderActions();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("orders action rows as Open browser, then Start terminal", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);

    renderActions({ onOpenBrowser: vi.fn(), onStartTerminal: vi.fn() });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent ?? ""),
    ).toEqual(["Open browser", "Start terminal"]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("keeps page actions compact with native button semantics and non-ring focus", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);

    renderActions({ onOpenBrowser: vi.fn() });

    const actions = screen.getByTestId("new-tab-actions");
    expect(within(actions).queryByText(/Describe an idea/u)).toBeNull();
    expect(
      within(actions).queryByText(/Open a new web browser tab/u),
    ).toBeNull();
    expect(
      within(actions).queryByText(/Search workspace and thread files/u),
    ).toBeNull();
    expect(within(actions).queryAllByRole("option")).toHaveLength(0);
    for (const button of within(actions).getAllByRole("button")) {
      expect(button.getAttribute("aria-selected")).toBeNull();
      expect(button.className).not.toContain("focus-visible:ring");
      // No row carries the active/selected highlight at rest; the non-ring
      // keyboard-focus cue stays in place.
      expect(button.className).not.toContain("bg-state-active");
      expect(button.className).toContain("focus-visible:bg-state-hover");
    }
  });

  it("hides the Open browser entry on the web build", () => {
    renderActions({ onOpenBrowser: vi.fn() });

    expect(screen.queryByText("Open browser")).toBeNull();
  });

  it("opens the browser directly", () => {
    window.bbDesktop = createBbDesktopApi(DESKTOP_INFO);
    const onOpenBrowser = vi.fn();
    renderActions({ onOpenBrowser });

    fireEvent.click(screen.getByRole("button", { name: /Open browser/u }));

    expect(onOpenBrowser).toHaveBeenCalledTimes(1);
  });

  it("starts a terminal directly", () => {
    const onStartTerminal = vi.fn();
    renderActions({ onStartTerminal });

    fireEvent.click(screen.getByRole("button", { name: /Start terminal/u }));

    expect(onStartTerminal).toHaveBeenCalledTimes(1);
  });

});

describe("NewTabFileSearch", () => {
  it("wires the search box to a single combobox listbox that holds the active option", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({ initialQuery: "app" });

    const input = screen.getByRole("combobox", {
      name: "Search files",
    });
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

  it("groups Files as a labelled option group inside the one listbox", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({ initialQuery: "app" });

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

    renderLauncher({ currentThreadId, initialQuery: "desktop" });

    const listbox = screen.getByRole("listbox", {
      name: "File search results",
    });
    const filesGroup = within(listbox).getByRole("group", { name: "Files" });
    const fileRow = within(filesGroup).getByRole("option", {
      name: /desktop-size\.html/u,
    });

    expect(fileRow.querySelector("[data-icon='ChartColumn']")).not.toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Search files" }), {
      target: { value: "" },
    });

    const recentGroup = within(
      screen.getByRole("listbox", {
        name: "File search results",
      }),
    ).getByRole("group", { name: "Recent" });
    const recentRow = within(recentGroup).getByRole("option", {
      name: /desktop-size\.html/u,
    });

    expect(recentRow.querySelector("[data-icon='ChartColumn']")).not.toBeNull();
    expect(within(recentRow).queryByText("Report")).toBeNull();
    expect(recentRow.textContent ?? "").not.toContain(String.fromCharCode(183));
  });

  it("surfaces workspace files for a projectless thread that has an environment", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({
      projectId: PERSONAL_PROJECT_ID,
      environmentId: "env_1",
      initialQuery: "app",
    });

    // The component forwards project and environment ids verbatim; the source
    // decision (search the environment workspace, not the personal "project")
    // lives in usePathSuggestions.
    expect(fileSearchMockArgs.at(-1)?.projectId).toBe(PERSONAL_PROJECT_ID);
    expect(fileSearchMockArgs.at(-1)?.environmentId).toBe("env_1");
    expect(screen.getByRole("option", { name: /app\.ts/u })).toBeTruthy();
  });

  it("forwards projectless threads without an environment to the suggestion hook", () => {
    setFileSearchSuggestions([FILE_SUGGESTION]);

    renderLauncher({
      projectId: PERSONAL_PROJECT_ID,
      environmentId: null,
      initialQuery: "app",
    });

    expect(fileSearchMockArgs.at(-1)?.projectId).toBe(PERSONAL_PROJECT_ID);
    expect(fileSearchMockArgs.at(-1)?.environmentId).toBeNull();
    expect(screen.getByRole("option", { name: /app\.ts/u })).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Search files" }),
    ).toHaveProperty("disabled", false);
  });
});
