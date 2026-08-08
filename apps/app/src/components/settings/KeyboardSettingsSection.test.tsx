// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppDefaultKeybindings } from "@bb/domain";
import { KeyboardSettingsSection } from "./KeyboardSettingsSection";

const testState = vi.hoisted(() => ({
  defaultKeybindings: [
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
  ] as AppDefaultKeybindings,
  generalMutate: vi.fn(),
  isDesktop: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      defaultKeybindings: testState.defaultKeybindings,
      generalSettings: defaultAppSettings,
      keybindingOverrides: [],
    },
  }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: false,
    mutate: testState.generalMutate,
  }),
  useUpdateKeyboardSettings: () => ({
    isPending: false,
    mutate: testState.mutate,
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (testState.isDesktop ? {} : null),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  testState.isDesktop = false;
});

describe("KeyboardSettingsSection", () => {
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
    expect(webDefault.className).toContain("font-sans");
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
    expect(recorderShortcut.className).toContain("font-sans");
    expect(recorderShortcut.className).toContain("bg-transparent");
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
