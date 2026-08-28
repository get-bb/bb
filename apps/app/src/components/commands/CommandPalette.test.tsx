// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppDefaultKeybinding,
  type AppKeybinding,
} from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as threadPaletteResults from "./ThreadPaletteResults";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { CommandPalette } from "./CommandPalette";

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

function defaults(...commands: AppCommandId[]): AppDefaultKeybinding[] {
  return commands.map((command) => ({
    command,
    desktopOnly: false,
    shortcut: null,
    when: MAIN_SURFACE,
  }));
}

interface CommandPaletteTestState {
  calls: string[];
}

interface CommandPaletteLocation {
  pathname: string;
  state: {
    searchMessageSeq: number;
    searchThreadId: string;
  };
}

const testState: CommandPaletteTestState = { calls: [] };
const { queryClient } = createQueryClientTestHarness();

vi.spyOn(threadPaletteResults, "ThreadPaletteResults").mockImplementation(
  ({ onSelect, query }) => (
    <button
      type="button"
      role="option"
      aria-selected="true"
      onClick={() =>
        onSelect({
          id: "active:thr_message",
          optionId: "thread-option",
          projectId: "proj_search",
          threadId: "thr_message",
          messageSeq: 7,
        })
      }
    >
      Matched thread {query}
    </button>
  ),
);

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </output>
  );
}

function Handler({ command }: { command: AppCommandId }) {
  useAppCommandHandler(command, () => {
    testState.calls.push(command);
    return true;
  });
  return null;
}

function renderPalette(isCompactViewport = false) {
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: false,
      },
      keybindings: [PALETTE_BINDING, THREAD_SEARCH_BINDING, THREAD_NEW_BINDING],
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
    }),
  );
  const result = render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AppCommandProvider>
            <button type="button" data-testid="origin">
              origin
            </button>
            <Handler command="thread.new" />
            <Handler command="thread.next" />
            <Handler command="panel.toggle" />
            <Handler command="terminal.open" />
            <CommandPalette threadId={null} projectId={null} />
            <LocationProbe />
          </AppCommandProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </CompactViewportOverrideProvider>,
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
const optionTitles = () =>
  screen.getAllByRole("option").map((option) => option.textContent);
const selectedOption = () =>
  screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("linear");
  testState.calls.length = 0;
  queryClient.clear();
  window.localStorage.clear();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("CommandPalette", () => {
  it("opens on its chord and lists the commands that apply", async () => {
    renderPalette();
    const event = openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    expect(event.defaultPrevented).toBe(true);
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        searchField() as HTMLInputElement
      ).value,
    ).toBe(">");
    const titles = optionTitles();
    expect(titles?.[0]).toContain("New thread");
    expect(titles).toHaveLength(5);
  });

  it("filters as the user types and keeps the selection on a live row", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.change(searchField(), { target: { value: ">terminal" } });

    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("Open terminal");
  });

  it("wraps at both ends of the list", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowUp" });
    expect(selectedOption()?.textContent).toContain("Open terminal");

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    expect(selectedOption()?.textContent).toContain("New thread");
  });

  it("runs the highlighted command, closes, and restores focus", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: ">toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["panel.toggle"]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("origin"));
  });

  it("runs a compact selection once after restoring focus", async () => {
    renderPalette(true);
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: ">toggle panel" } });
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["panel.toggle"]));
    expect(document.activeElement).toBe(screen.getByTestId("origin"));
  });

  it("offers the last command run first the next time it opens", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    fireEvent.change(searchField(), { target: { value: ">toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    expect(optionTitles()?.[0]).toContain("Toggle panel");
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
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
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
    fireEvent.pointerMove(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ screen.getAllByRole(
        "option",
      )[0] as HTMLElement,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("lists a plugin's commandPaletteAction and runs it", async () => {
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
          title: "Linear: open issue",
          run: () => {
            testState.calls.push("plugin-ran");
          },
        },
      ],
    });
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: ">linear" } });
    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(optionTitles()?.[0]).toContain("Linear: open issue");
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["plugin-ran"]));
  });

  it("says so when nothing matches", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: ">zzzzz" } });

    await waitFor(() =>
      expect(screen.getByText("No matching commands")).toBeTruthy(),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(testState.calls).toEqual([]);
  });

  it("opens thread search without a prefix", async () => {
    renderPalette();
    const event = openThreadSearch();

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search threads" }),
      ).toBeTruthy(),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        searchField() as HTMLInputElement
      ).value,
    ).toBe("");
    expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe(
      "Thread search results",
    );
  });

  it("switches the open command palette to thread search", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: ">search threads" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Search threads"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        screen.getByRole("combobox", {
          name: "Search threads",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("opens a matched thread at its matched message", async () => {
    renderPalette();
    openThreadSearch();
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /Matched thread/u }),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("option", { name: /Matched thread/u }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain(
        "thr_message",
      ),
    );
    const location =
      /* SAFETY: The test controls this fixture and verifies its behavior. */ JSON.parse(
        screen.getByTestId("location").textContent ?? "{}",
      ) as CommandPaletteLocation;
    expect(location.pathname).toContain("thr_message");
    expect(location.state).toEqual({
      searchMessageSeq: 7,
      searchThreadId: "thr_message",
    });
  });
});
