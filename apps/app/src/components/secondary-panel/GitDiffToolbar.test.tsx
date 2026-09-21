// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { GitDiffToolbar } from "./GitDiffToolbar";

const DIFF_SEARCH_KEYBINDING = {
  command: "diff.search" as const,
  desktopOnly: false,
  shortcut: {
    key: "f",
    mod: false,
    meta: false,
    control: true,
    alt: false,
    shift: false,
  },
  when: {
    all: ["mainSurface" as const],
    none: [
      "modalOpen" as const,
      "terminalFocus" as const,
      "browserFocus" as const,
    ],
  },
};

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings: [DIFF_SEARCH_KEYBINDING],
      defaultKeybindings: [DIFF_SEARCH_KEYBINDING],
      keybindingOverrides: [],
    },
  }),
}));

const noop = () => {};

function renderToolbar(isFocused: boolean) {
  return render(
    <AppCommandProvider>
      <GitDiffToolbar
        selectionValue="all"
        selectionOptions={[{ value: "all", label: "All changes" }]}
        onSelectionChange={noop}
        isSelectorDisabled={false}
        stats={{ filesCount: 1, insertions: 2, deletions: 1 }}
        isTruncated={false}
        searchQuery="needle"
        onSearchQueryChange={noop}
        isSearching={false}
        totalFilesCount={2}
        isFocused={isFocused}
        areAllFilesCollapsed={false}
        isCollapseAllDisabled={false}
        onToggleAllCollapsed={noop}
        displayMode="unified"
        onDisplayModeChange={noop}
        lineOverflowMode="wrap"
        onLineOverflowModeChange={noop}
      />
      <button type="button">Outside diff</button>
    </AppCommandProvider>,
  );
}

afterEach(cleanup);

describe("GitDiffToolbar", () => {
  it("focuses the active pane's search and selects its query with Control+F", () => {
    renderToolbar(true);
    const outside = screen.getByRole("button", { name: "Outside diff" });
    const search = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Search changed files",
    });
    outside.focus();

    fireEvent.keyDown(outside, { key: "f", code: "KeyF", ctrlKey: true });

    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe(search.value.length);
  });

  it("leaves Control+F unhandled when its pane is not focused", () => {
    renderToolbar(false);
    const outside = screen.getByRole("button", { name: "Outside diff" });
    outside.focus();

    fireEvent.keyDown(outside, { key: "f", code: "KeyF", ctrlKey: true });

    expect(document.activeElement).toBe(outside);
  });
});
