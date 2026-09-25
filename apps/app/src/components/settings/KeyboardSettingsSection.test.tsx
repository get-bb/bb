// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
} from "@bb/domain";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import {
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { KeyboardSettingsSection } from "./KeyboardSettingsSection";

const testState = vi.hoisted(() => {
  const defaultKeybindings = [
    {
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
    },
    {
      command: "thread.new",
      desktopOnly: true,
      shortcut: {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "thread.rename",
      desktopOnly: false,
      shortcut: null,
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "thread.archive",
      desktopOnly: false,
      shortcut: null,
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "thread.jump.1",
      desktopOnly: false,
      shortcut: {
        key: "1",
        mod: false,
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface", "webSurface", "macPlatform"],
        none: ["modalOpen"],
      },
    },
    {
      command: "thread.jump.1",
      desktopOnly: false,
      shortcut: {
        key: "1",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: {
        all: ["mainSurface", "webSurface"],
        none: ["modalOpen", "macPlatform"],
      },
    },
    {
      command: "thread.jump.1",
      desktopOnly: true,
      shortcut: {
        key: "1",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "app.back",
      desktopOnly: false,
      shortcut: {
        key: "Escape",
        mod: false,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "question.select.1",
      desktopOnly: false,
      shortcut: {
        key: "1",
        mod: false,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface", "questionOpen"],
        none: ["modalOpen", "editableFocus"],
      },
    },
  ] as AppDefaultKeybindings;
  return {
    defaultKeybindings,
    generalMutate: vi.fn(),
    initialDefaultKeybindings: defaultKeybindings,
    isDesktop: false,
    keybindingOverrides: [] as AppKeybindingOverrides,
    keyboardPending: false,
    recorderButtonCalls: new Map<string, number>(),
    mutate:
      vi.fn<
        (
          overrides: AppKeybindingOverrides,
          options: { onError(): void },
        ) => void
      >(),
  };
});

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      defaultKeybindings: testState.defaultKeybindings,
      generalSettings: defaultAppSettings,
      keybindingOverrides: testState.keybindingOverrides,
    },
  }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: false,
    mutate: testState.generalMutate,
  }),
  useUpdateKeyboardSettings: () => ({
    isPending: testState.keyboardPending,
    mutate: testState.mutate,
  }),
}));

vi.mock("@bb/shared-ui/button", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/shared-ui/button")>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const label = props["aria-label"];
      if (
        typeof label === "string" &&
        label.startsWith("Record shortcut for ")
      ) {
        testState.recorderButtonCalls.set(
          label,
          (testState.recorderButtonCalls.get(label) ?? 0) + 1,
        );
      }
      return createElement(actual.Button, props);
    },
  };
});

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (testState.isDesktop ? {} : null),
}));

afterEach(() => {
  removePluginSlotRegistrations("test-shortcuts");
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  testState.defaultKeybindings = testState.initialDefaultKeybindings;
  testState.isDesktop = false;
  testState.keybindingOverrides = [];
  testState.keyboardPending = false;
  testState.recorderButtonCalls.clear();
});

describe("KeyboardSettingsSection", () => {
  it("ranks visible label matches ahead of description matches across groups", () => {
    render(<KeyboardSettingsSection />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search keyboard shortcuts" }),
      {
        target: { value: "  SiDeBaR  " },
      },
    );

    expect(
      screen
        .getAllByRole("button", { name: /^Record shortcut for / })[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/^Record shortcut for Toggle sidebar,/);
  });

  it("ranks exact labels, label prefixes, label substrings, IDs, and descriptions in order", () => {
    setPluginSlotRegistrations(
      "test-shortcuts",
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          for (const [id, title] of [
            ["sidebar-open", "Open navigation"],
            ["tools", "Sidebar tools"],
            ["exact", "Sidebar"],
            ["settings", "Sidebar settings"],
          ]) {
            app.commands.register({ id, title, run() {} });
          }
        },
      }),
    );
    render(<KeyboardSettingsSection />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search keyboard shortcuts" }),
      {
        target: { value: "sidebar" },
      },
    );

    const labels = screen
      .getAllByRole("button", { name: /^Record shortcut for / })
      .map(
        (recorder) =>
          recorder.getAttribute("aria-label")?.split(", current shortcut")[0],
      );
    expect(labels.slice(0, 6)).toEqual([
      "Record shortcut for Sidebar",
      "Record shortcut for Sidebar tools",
      "Record shortcut for Sidebar settings",
      "Record shortcut for Toggle sidebar",
      "Record shortcut for Open navigation",
      "Record shortcut for Previous thread",
    ]);
  });

  it("finds commands by their shortcut keys and modifiers", () => {
    render(<KeyboardSettingsSection />);
    const search = screen.getByRole("textbox", {
      name: "Search keyboard shortcuts",
    });

    fireEvent.change(search, { target: { value: "escape" } });
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Back to app, current shortcut Escape",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", {
        name: /^Record shortcut for New thread,/,
      }),
    ).toBeNull();

    fireEvent.change(search, { target: { value: "ctrl+shift+o" } });
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
      }),
    ).toBeDefined();

    fireEvent.change(search, { target: { value: "ctrl+shift+u" } });
    expect(
      screen.getByText("No shortcuts match “ctrl+shift+u”."),
    ).toBeDefined();
  });

  it("restores category and command order when the search is cleared", () => {
    render(<KeyboardSettingsSection />);
    const originalLabels = screen
      .getAllByRole("button", { name: /^Record shortcut for / })
      .map((recorder) => recorder.getAttribute("aria-label"));
    const originalHeadings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    const search = screen.getByRole("textbox", {
      name: "Search keyboard shortcuts",
    });

    fireEvent.change(search, { target: { value: "sidebar" } });
    fireEvent.change(search, { target: { value: "  " } });

    expect(
      screen
        .getAllByRole("button", { name: /^Record shortcut for / })
        .map((recorder) => recorder.getAttribute("aria-label")),
    ).toEqual(originalLabels);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(originalHeadings);
  });

  it("shows the empty state when no shortcut matches", () => {
    render(<KeyboardSettingsSection />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search keyboard shortcuts" }),
      {
        target: { value: "nonexistent-shortcut" },
      },
    );

    expect(
      screen.getByText("No shortcuts match “nonexistent-shortcut”."),
    ).toBeDefined();
    expect(
      screen.queryAllByRole("button", { name: /^Record shortcut for / }),
    ).toHaveLength(0);
  });

  it("lists commands without defaults and persists bindings under stable plugin IDs", () => {
    setPluginSlotRegistrations(
      "test-shortcuts",
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.commands.register({
            id: "open",
            title: "Open plugin issue",
            run() {},
          });
        },
      }),
    );
    render(<KeyboardSettingsSection />);
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for Open plugin issue, current shortcut unassigned",
    });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: "i", ctrlKey: true, shiftKey: true });
    expect(testState.mutate.mock.lastCall?.[0]).toEqual([
      {
        command: "plugin:test-shortcuts/open",
        shortcut: expect.objectContaining({ key: "i", mod: true, shift: true }),
      },
    ]);
  });

  it("explains when a plugin default conflicts with a core shortcut", () => {
    setPluginSlotRegistrations(
      "test-shortcuts",
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.commands.register({
            id: "open",
            title: "Open plugin issue",
            defaultShortcut: { key: "o", mod: true, shift: true },
            run() {},
          });
        },
      }),
    );
    render(<KeyboardSettingsSection />);
    expect(
      screen.getByText(
        /Default shortcut left unbound: also used by New thread/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Open plugin issue, current shortcut unassigned",
      }),
    ).toBeTruthy();
  });

  it("turns keyboard hints off while preserving the full settings contract", () => {
    render(<KeyboardSettingsSection />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Show keyboard hints when holding CMD / Control",
      }),
    );

    expect(testState.generalMutate).toHaveBeenCalledWith({
      ...defaultAppSettings,
      showKeyboardHints: false,
    });
  });

  it("records, clears, and resets a command shortcut", () => {
    render(<KeyboardSettingsSection />);
    const defaults = screen.getByLabelText("Default shortcuts for New thread");
    const webLabel = within(defaults).getByText("Web");
    const webGroup = webLabel.parentElement;
    const webDefault = within(webGroup!).getByText("Ctrl + Shift + O");
    expect(webDefault.tagName).toBe("KBD");
    expect(webDefault.getAttribute("aria-hidden")).toBe("false");
    const desktopLabel = within(defaults).getByText("Desktop");
    const desktopGroup = desktopLabel.parentElement;
    expect(within(desktopGroup!).getByText("Ctrl + N")).toBeDefined();
    expect(within(defaults).queryByText("macOS web")).toBeNull();
    expect(within(defaults).queryByText("Windows/Linux web")).toBeNull();
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
    });
    const recorderShortcut = within(recorder).getByText("Ctrl + Shift + O");
    expect(recorderShortcut.tagName).toBe("KBD");
    expect(recorderShortcut.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(recorder);
    expect(screen.getByText("Press keys")).toBeDefined();
    fireEvent.keyDown(recorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [
        {
          command: "thread.new",
          shortcut: {
            key: "u",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        },
      ],
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear shortcut for New thread",
      }),
    );
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [{ command: "thread.new", shortcut: null }],
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset shortcut for New thread",
      }),
    );
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("lets users assign a command that has no default shortcut", () => {
    render(<KeyboardSettingsSection />);
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for Rename thread, current shortcut unassigned",
    });
    expect(recorder.hasAttribute("disabled")).toBe(false);
    expect(within(recorder).getByText("Unassigned")).toBeDefined();

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, {
      key: "R",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(testState.mutate).toHaveBeenLastCalledWith(
      [
        {
          command: "thread.rename",
          shortcut: {
            key: "r",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        },
      ],
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("keeps unaffected shortcut controls stable while saving", () => {
    const { rerender } = render(<KeyboardSettingsSection />);
    const recorder = screen.getByRole("button", {
      name: /^Record shortcut for New thread,/,
    });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: "U", ctrlKey: true, shiftKey: true });
    const assigned = testState.mutate.mock.lastCall?.[0];
    if (!assigned) throw new Error("Expected shortcut mutation");
    testState.keybindingOverrides = structuredClone(assigned);
    rerender(<KeyboardSettingsSection />);
    testState.recorderButtonCalls.clear();
    testState.keyboardPending = true;
    rerender(<KeyboardSettingsSection />);
    expect(testState.recorderButtonCalls.size).toBe(0);
    expect(recorder.matches(":disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /^Record shortcut for Search threads/ })
        .closest('[aria-busy="true"]'),
    ).toBeNull();
    testState.keyboardPending = false;
    rerender(<KeyboardSettingsSection />);
    expect(recorder.matches(":disabled")).toBe(false);
    expect(recorder.closest('[aria-busy="true"]')).toBeNull();
  });

  it("asks before replacing a conflicting assignment and supports cancel", () => {
    render(<KeyboardSettingsSection />);
    const newThreadRecorder = screen.getByRole("button", {
      name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
    });
    fireEvent.click(newThreadRecorder);
    fireEvent.keyDown(newThreadRecorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });

    const jumpRecorder = screen.getByRole("button", {
      name: "Record shortcut for Open thread 1, current shortcut Ctrl + Shift + 1",
    });
    fireEvent.click(jumpRecorder);
    testState.recorderButtonCalls.clear();
    fireEvent.keyDown(jumpRecorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(screen.getByRole("alert").textContent).toContain("New thread");
    expect(testState.mutate.mock.lastCall?.[0]).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(jumpRecorder);
    fireEvent.keyDown(jumpRecorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace binding" }));
    expect(testState.mutate.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([
        { command: "thread.new", shortcut: null },
        {
          command: "thread.jump.1",
          shortcut: expect.objectContaining({ key: "u" }),
        },
      ]),
    );
  });

  it("rolls reset-all draft state back when the mutation fails", () => {
    render(<KeyboardSettingsSection />);
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
    });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(testState.mutate.mock.lastCall?.[0]).toEqual([]);
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
      }),
    ).toBeDefined();

    const rollback = testState.mutate.mock.lastCall?.[1].onError;
    if (rollback === undefined) throw new Error("Expected rollback handler");
    act(() => rollback());

    expect(
      screen.getByRole("button", {
        name: "Record shortcut for New thread, current shortcut Ctrl + Shift + U",
      }),
    ).toBeDefined();
  });

  it("shows web and desktop defaults without OS-specific groups", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<KeyboardSettingsSection />);

    const defaults = screen.getByLabelText(
      "Default shortcuts for Open thread 1",
    );
    const webGroup = within(defaults).getByText("Web").parentElement;
    expect(within(webGroup!).getByText("⌃ 1")).toBeDefined();
    const desktopGroup = within(defaults).getByText("Desktop").parentElement;
    expect(within(desktopGroup!).getByText("⌘ 1")).toBeDefined();
    expect(within(defaults).queryByText("macOS web")).toBeNull();
    expect(within(defaults).queryByText("Windows/Linux web")).toBeNull();
    expect(within(defaults).queryByText("Ctrl + Shift + 1")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Open thread 1, current shortcut ⌃ 1",
      }),
    ).toBeDefined();
  });

  it("selects the active desktop shortcut from the displayed surface defaults", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    testState.isDesktop = true;
    render(<KeyboardSettingsSection />);

    const defaults = screen.getByLabelText(
      "Default shortcuts for Open thread 1",
    );
    const webGroup = within(defaults).getByText("Web").parentElement;
    expect(within(webGroup!).getByText("⌃ 1")).toBeDefined();
    const desktopGroup = within(defaults).getByText("Desktop").parentElement;
    expect(within(desktopGroup!).getByText("⌘ 1")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Open thread 1, current shortcut ⌘ 1",
      }),
    ).toBeDefined();
  });

  it("shows one unlabeled default when web and desktop match", () => {
    render(<KeyboardSettingsSection />);

    const defaults = screen.getByLabelText(
      "Default shortcut for Choose answer 1",
    );
    expect(within(defaults).getByText("1")).toBeDefined();
    expect(within(defaults).queryByText("Web")).toBeNull();
    expect(within(defaults).queryByText("Desktop")).toBeNull();
  });
});
