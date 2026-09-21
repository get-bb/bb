// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NewTabPage } from "./NewTabPage";
import { SidebarSplitContainer } from "./SidebarSplitContainer";

vi.mock("@/hooks/usePluginCommandBindings", () => {
  const bindings = [
    ["panel.previousNewTabItem", "ArrowUp"],
    ["panel.nextNewTabItem", "ArrowDown"],
  ].map(([command, key]) => ({
    command,
    desktopOnly: false,
    shortcut: { key, control: true, shift: true, mod: false, meta: false, alt: false },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  }));
  return { usePluginCommandBindings: () => ({ keybindings: bindings, defaults: bindings }) };
});

vi.mock("@/hooks/useFileSearchSuggestions", () => {
  const result = {
    suggestions: [],
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isUnavailable: false,
  };
  return { useFileSearchSuggestions: () => result };
});

const recentItems = [
  { source: "workspace" as const, path: "package.json", openedAt: 1 },
  { source: "workspace" as const, path: "README.md", openedAt: 1 },
];
vi.mock("./threadRecentItems", async (importOriginal) => ({
  ...await importOriginal<typeof import("./threadRecentItems")>(),
  useThreadRecentItems: () => recentItems,
}));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mountPage({ canNavigateTabs = true, selected = true, disabled = false } = {}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const onSelect = vi.fn();
  render(
    <Wrapper>
      <AppCommandProvider>
        <SidebarProvider>
          <TooltipProvider>
            <SidebarSplitContainer
              activeTabId="new-tab"
              canNavigateTabs={canNavigateTabs}
              isFullScreen={false}
              onActivateTab={() => {}}
              onGlobalTabReorder={() => {}}
              onToggleFullScreen={() => {}}
              panelStateId="new-tab-items"
              tabs={[{ id: "new-tab", label: "New tab", restoresPlacementAfterRemoval: false }]}
              renderPane={() => selected ? (
                <NewTabPage
                  autoFocus={false}
                  currentThreadId="thr_new_tab_items"
                  environmentId="env_1"
                  projectId="proj_1"
                  onAutoFocusHandled={() => {}}
                  onSelect={onSelect}
                  onStartTerminal={() => {}}
                  startTerminalDisabled={disabled}
                  pluginActions={[{
                    id: "side-chat",
                    pluginId: "side-chat",
                    icon: null,
                    title: "Start side chat",
                    onSelect: () => {},
                  }]}
                />
              ) : <input aria-label="Editor" />}
            />
          </TooltipProvider>
        </SidebarProvider>
      </AppCommandProvider>
    </Wrapper>,
  );
  return onSelect;
}

function move(key: "ArrowUp" | "ArrowDown") {
  const target = document.activeElement;
  if (!target) throw new Error("Missing focus target");
  return fireEvent.keyDown(target, { key, ctrlKey: true, shiftKey: true });
}

it("moves focus through search, actions and recents, skipping reorder handles", () => {
  const onSelect = mountPage();
  const search = screen.getByRole("combobox");
  const terminal = screen.getByRole("button", { name: "Start terminal" });
  const sideChat = screen.getByRole("button", { name: "Start side chat" });
  const [firstRecent, lastRecent] = screen.getAllByRole("option");
  act(() => search.focus());
  for (const target of [terminal, sideChat, firstRecent, lastRecent, search]) {
    expect(move("ArrowDown")).toBe(false);
    expect(document.activeElement).toBe(target);
  }
  move("ArrowUp");
  expect(document.activeElement).toBe(lastRecent);
  expect(lastRecent?.getAttribute("aria-selected")).toBe("true");
  if (lastRecent) fireEvent.click(lastRecent);
  expect(onSelect).toHaveBeenCalledWith({ source: "workspace", path: "README.md" });
});

it("skips disabled actions and follows the rendered search state", () => {
  mountPage({ disabled: true });
  const search = screen.getByRole("combobox");
  act(() => search.focus());
  move("ArrowDown");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start side chat" }));
  act(() => search.focus());
  fireEvent.change(search, { target: { value: "no matching files" } });
  move("ArrowDown");
  expect(document.activeElement).toBe(search);
  expect(screen.queryByRole("option")).toBeNull();
  expect(screen.queryByRole("button", { name: "Start side chat" })).toBeNull();
});

it.each([
  { canNavigateTabs: false, selected: true },
  { canNavigateTabs: true, selected: false },
])("leaves focus alone when the active panel has no navigable New tab page: %j", (options) => {
  mountPage(options);
  const input = screen.getByRole(options.selected ? "combobox" : "textbox");
  act(() => input.focus());
  move("ArrowDown");
  expect(document.activeElement).toBe(input);
});
